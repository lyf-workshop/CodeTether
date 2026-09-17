import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'

import {
  beginRemoteMachinePairingOverStream,
  connectTrustedRemoteMachineOverStream,
  generateMachineTlsIdentity,
  machineProtocolVersion,
  newControllerId,
} from '@codetether/machine-transport'
import { connectRelayControl, RelayClientError } from '@codetether/relay-client'
import {
  RelayClientMessageSchema,
  newRelayRequestId,
  relayProtocolVersion,
  relayPublicKeySpkiFromCertificate,
} from '@codetether/relay-protocol'

import {
  RelayService,
  RelayStateStore,
  generateRelayPinnedTlsIdentity,
} from '../../relay/dist/index.js'
import { CodeTetherNodeService } from '../dist/node-service.js'
import { NodeRelayManager } from '../dist/node-relay-manager.js'
import { NodeStateStore } from '../dist/state-store.js'

test('real Relay brokers the existing pinned Machine TLS protocol without a direct dial or implicit resume', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codetether-relay-machine-e2e-'))
  const relayStore = new RelayStateStore(join(root, 'relay-state'))
  const relayTls = await generateRelayPinnedTlsIdentity(relayStore.identity)
  const relay = new RelayService({
    stateStore: relayStore,
    tls: relayTls,
    host: '127.0.0.1',
    port: 0,
    managementPort: null,
    heartbeatIntervalMs: 100,
    heartbeatTimeoutMs: 300,
    logger: { log() {} },
  })
  const nodeState = await NodeStateStore.open({
    dataDirectory: join(root, 'node-state'),
    displayName: 'Relay-only Machine',
    platform: 'Linux',
    architecture: 'x64',
  })
  const controller = {
    controllerId: newControllerId(),
    tls: await generateMachineTlsIdentity('CodeTether Controller'),
  }
  await nodeState.trustController({
    controllerId: controller.controllerId,
    publicKeyFingerprint: controller.tls.publicKeyFingerprint,
    pairedAt: new Date().toISOString(),
  })
  const nodeService = new CodeTetherNodeService({
    state: nodeState,
    bindAddress: '127.0.0.1',
    port: 0,
  })

  let controllerRelay
  let nodeRelay
  let recoveredNodeRelay
  let machine
  let recoveredMachine
  let controllerChannel
  let recoveredControllerChannel
  let nodeChannel
  let recoveredNodeChannel
  let removeNodeHandler
  let removeRecoveredNodeHandler
  try {
    await relay.start()
    const endpoint = {
      host: '127.0.0.1',
      port: relay.listeningAddress.port,
    }
    const common = {
      endpoint,
      tls: {
        mode: 'pinned_certificate',
        certificatePublicKeyFingerprint: relay.relayFingerprint,
      },
      expectedRelayIdentityFingerprint: relay.relayFingerprint,
      clientBuildIdentity: 'relay-machine-transport-integration',
    }
    const controllerRelayIdentity = machineRelayIdentity(
      'controller',
      controller.tls,
    )
    const nodeRelayIdentity = machineRelayIdentity('node', nodeState.identity)

    nodeRelay = await connectRelayControl({
      ...common,
      identity: nodeRelayIdentity,
      enrollmentToken: relayStore.createEnrollmentToken('node'),
      authorizedControllerFingerprint: controller.tls.publicKeyFingerprint,
    })
    controllerRelay = await connectRelayControl({
      ...common,
      identity: controllerRelayIdentity,
      enrollmentToken: relayStore.createEnrollmentToken('controller'),
    })

    assert.equal(
      nodeRelayIdentity.publicKeyFingerprint,
      nodeState.identity.publicKeyFingerprint,
    )
    assert.equal(
      controllerRelayIdentity.publicKeyFingerprint,
      controller.tls.publicKeyFingerprint,
    )
    assert.equal(
      relayStore.canControllerObserveNode(
        controller.tls.publicKeyFingerprint,
        nodeState.identity.publicKeyFingerprint,
      ),
      true,
    )
    assert.equal(
      nodeState.controllerByFingerprint(controller.tls.publicKeyFingerprint)
        ?.controllerId,
      controller.controllerId,
    )

    const offers = []
    removeNodeHandler = nodeRelay.connection.setMachineChannelHandler(
      createNodeChannelHandler({
        nodeService,
        expectedControllerFingerprint: controller.tls.publicKeyFingerprint,
        offers,
        onChannel(channel) {
          nodeChannel = channel
        },
      }),
    )

    const unrelatedIdentity = await generateMachineTlsIdentity(
      'Unrelated CodeTether Node',
    )
    await assert.rejects(
      controllerRelay.connection.openMachineChannel(
        unrelatedIdentity.publicKeyFingerprint,
      ),
      (error) =>
        error instanceof RelayClientError &&
        error.code === 'relay_channel_open_failed',
    )
    assert.equal(offers.length, 0)

    controllerChannel = await controllerRelay.connection.openMachineChannel(
      nodeState.identity.publicKeyFingerprint,
    )
    controllerChannel.on('error', () => undefined)
    machine = await connectTrustedRemoteMachineOverStream({
      stream: controllerChannel,
      controller,
      peer: relayOnlyPeer(nodeState, controller.controllerId),
    })

    assert.deepEqual(machine.machine, nodeState.machine)
    assert.equal(offers.length, 1)
    assert.equal(
      offers[0].controllerFingerprint,
      controller.tls.publicKeyFingerprint,
    )
    assert.equal(
      offers[0].controllerConnectionEpoch,
      controllerRelay.connection.connectionEpoch,
    )
    assert.equal(
      offers[0].nodeConnectionEpoch,
      nodeRelay.connection.connectionEpoch,
    )
    await machine.ping()

    const projectRoot = join(root, 'relay-project')
    await mkdir(projectRoot, { recursive: true })
    const location = await machine.validateProjectLocation(projectRoot)
    assert.equal(location.exists, true)
    assert.equal(location.directory, true)
    assert.equal(location.basename, 'relay-project')

    assertControlSchemaHasNoGenericPayload(
      controllerRelay.connection.connectionEpoch,
      nodeState.identity.publicKeyFingerprint,
    )
    assert.equal(controllerRelay.connection.openChannel, undefined)
    assert.equal(controllerRelay.connection.send, undefined)

    await nodeRelay.connection.close()
    await waitFor(
      () =>
        controllerChannel.destroyed === true && nodeChannel?.destroyed === true,
    )
    await assert.rejects(machine.ping(AbortSignal.timeout(1_000)))
    await delay(25)
    assert.equal(offers.length, 1)

    recoveredNodeRelay = await connectRelayControl({
      ...common,
      identity: nodeRelayIdentity,
    })
    assert.equal(
      recoveredNodeRelay.registration.peerId,
      nodeRelay.registration.peerId,
    )
    assert.notEqual(
      recoveredNodeRelay.connection.connectionEpoch,
      nodeRelay.connection.connectionEpoch,
    )
    removeRecoveredNodeHandler =
      recoveredNodeRelay.connection.setMachineChannelHandler(
        createNodeChannelHandler({
          nodeService,
          expectedControllerFingerprint: controller.tls.publicKeyFingerprint,
          offers,
          onChannel(channel) {
            recoveredNodeChannel = channel
          },
        }),
      )
    await delay(25)
    assert.equal(offers.length, 1)

    recoveredControllerChannel =
      await controllerRelay.connection.openMachineChannel(
        nodeState.identity.publicKeyFingerprint,
      )
    recoveredControllerChannel.on('error', () => undefined)
    recoveredMachine = await connectTrustedRemoteMachineOverStream({
      stream: recoveredControllerChannel,
      controller,
      peer: relayOnlyPeer(nodeState, controller.controllerId),
    })
    await recoveredMachine.ping()
    assert.equal(offers.length, 2)
    assert.equal(recoveredNodeChannel?.destroyed, false)
  } finally {
    removeRecoveredNodeHandler?.()
    removeNodeHandler?.()
    recoveredMachine?.close()
    machine?.close()
    recoveredControllerChannel?.destroy()
    controllerChannel?.destroy()
    recoveredNodeChannel?.destroy()
    nodeChannel?.destroy()
    await recoveredNodeRelay?.connection.close().catch(() => undefined)
    await nodeRelay?.connection.close().catch(() => undefined)
    await controllerRelay?.connection.close().catch(() => undefined)
    await nodeService.close().catch(() => undefined)
    await relay.close().catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})

test('Relay-assisted first pairing preserves OPAQUE confirmation and transitions to trusted Machine TLS', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codetether-relay-pairing-e2e-'))
  const relayStore = new RelayStateStore(join(root, 'relay-state'))
  const relayTls = await generateRelayPinnedTlsIdentity(relayStore.identity)
  const relay = new RelayService({
    stateStore: relayStore,
    tls: relayTls,
    host: '127.0.0.1',
    port: 0,
    managementPort: null,
    heartbeatIntervalMs: 100,
    heartbeatTimeoutMs: 3_000,
  })
  const nodeState = await NodeStateStore.open({
    dataDirectory: join(root, 'node-state'),
    displayName: 'Loopback-only pairing Machine',
    platform: 'macOS',
    architecture: 'arm64',
  })
  const controller = {
    controllerId: newControllerId(),
    tls: await generateMachineTlsIdentity('CodeTether Controller'),
  }
  const rejectedController = {
    controllerId: newControllerId(),
    tls: await generateMachineTlsIdentity('Rejected CodeTether Controller'),
  }
  let nodeRelayManager
  let nodeService
  let rejectedPairingRelay
  let rejectedPairingChannel
  let pairingRelay
  let trustedRelay
  let pairingMachine
  let trustedMachine
  let pairingChannel
  let trustedChannel
  let pairingTarget
  try {
    await relay.start()
    const endpoint = {
      host: '127.0.0.1',
      port: relay.listeningAddress.port,
    }
    const relayTlsPolicy = {
      mode: 'pinned_certificate',
      certificatePublicKeyFingerprint: relay.relayFingerprint,
    }
    const nodeEnrollmentToken = relayStore.createEnrollmentToken('node')
    let enrollmentAvailable = true
    nodeRelayManager = new NodeRelayManager({
      state: nodeState,
      configuration: {
        schemaVersion: 1,
        enabled: true,
        endpoint,
        relayIdentityFingerprint: relay.relayFingerprint,
        tls: relayTlsPolicy,
      },
      clientBuildIdentity: 'relay-pairing-integration',
      reconnectInitialDelayMs: 10,
      reconnectMaximumDelayMs: 20,
      reconnectStableResetMs: 50,
      async readEnrollmentToken() {
        if (!enrollmentAvailable) return undefined
        return {
          secret: nodeEnrollmentToken,
          contentDigest: Buffer.alloc(32),
        }
      },
      async readPendingEnrollmentToken() {
        return undefined
      },
      async consumeEnrollmentToken() {
        enrollmentAvailable = false
      },
      async readRegistration() {
        return undefined
      },
      async writeRegistration() {},
    })
    nodeService = new CodeTetherNodeService({
      state: nodeState,
      bindAddress: '127.0.0.1',
      port: 0,
      relayControl: nodeRelayManager,
    })
    nodeRelayManager.setMachineChannelHandler(
      async (channel) => await nodeService.acceptRelayMachineChannel(channel),
    )
    nodeRelayManager.setPairingChannelHandler(
      async (channel) => await nodeService.acceptRelayPairingChannel(channel),
    )
    nodeService.on('paired', () => nodeRelayManager.synchronizeMachineTrust())
    const directAddress = await nodeService.listen()
    assert.equal(directAddress.address, '127.0.0.1')
    assert.equal(nodeState.trustedControllerCount, 0)

    nodeRelayManager.start()
    await waitFor(() => nodeRelayManager.status === 'connected')
    const pairing = await nodeService.enablePairing()
    const pairingTargetAvailable = new Promise((resolve) => {
      nodeRelayManager.enablePairingRendezvous(pairing.expiresAt, resolve)
    })
    pairingTarget = await pairingTargetAvailable
    assert.equal(pairingTarget.kind, 'relay')
    assert.equal(
      pairingTarget.nodeFingerprint,
      nodeState.identity.publicKeyFingerprint,
    )
    rejectedPairingRelay = await connectRelayControl({
      endpoint,
      tls: relayTlsPolicy,
      expectedRelayIdentityFingerprint: relay.relayFingerprint,
      identity: machineRelayIdentity('controller', rejectedController.tls),
      clientBuildIdentity: 'relay-pairing-integration',
      pairing: {
        rendezvousId: pairingTarget.rendezvousId,
        rendezvousCapability: pairingTarget.rendezvousCapability,
        targetNodeFingerprint: pairingTarget.nodeFingerprint,
      },
    })
    rejectedPairingChannel =
      await rejectedPairingRelay.connection.openPairingChannel(
        pairingTarget.nodeFingerprint,
        pairingTarget.rendezvousId,
      )
    rejectedPairingChannel.on('error', () => undefined)
    await assert.rejects(
      beginRemoteMachinePairingOverStream({
        stream: rejectedPairingChannel,
        pairingCode: pairing.code === '000000' ? '111111' : '000000',
        controller: rejectedController,
      }),
      (error) => error?.code === 'pairing_failed',
    )
    rejectedPairingChannel = undefined
    await assert.rejects(
      rejectedPairingRelay.connection.openPairingChannel(
        pairingTarget.nodeFingerprint,
        pairingTarget.rendezvousId,
      ),
      (error) =>
        error instanceof RelayClientError &&
        error.code === 'relay_channel_open_failed',
    )
    await rejectedPairingRelay.connection.close()
    rejectedPairingRelay = undefined
    assert.equal(nodeState.trustedControllerCount, 0)
    assert.equal(
      relayStore.getPeerByFingerprint(
        rejectedController.tls.publicKeyFingerprint,
      ),
      undefined,
    )

    pairingTarget = await new Promise((resolve) => {
      nodeRelayManager.enablePairingRendezvous(pairing.expiresAt, resolve)
    })
    const pairingCommon = {
      endpoint,
      tls: relayTlsPolicy,
      expectedRelayIdentityFingerprint: relay.relayFingerprint,
      identity: machineRelayIdentity('controller', controller.tls),
      clientBuildIdentity: 'relay-pairing-integration',
      pairing: {
        rendezvousId: pairingTarget.rendezvousId,
        rendezvousCapability: pairingTarget.rendezvousCapability,
        targetNodeFingerprint: pairingTarget.nodeFingerprint,
      },
    }
    pairingRelay = await connectRelayControl(pairingCommon)
    assert.equal(pairingRelay.connection.scope, 'pairing')
    await assert.rejects(
      pairingRelay.connection.subscribeToNode(
        pairingTarget.nodeFingerprint,
        () => undefined,
      ),
      (error) =>
        error instanceof RelayClientError &&
        error.code === 'relay_protocol_error',
    )
    await assert.rejects(
      pairingRelay.connection.openMachineChannel(pairingTarget.nodeFingerprint),
      (error) =>
        error instanceof RelayClientError &&
        error.code === 'relay_protocol_error',
    )

    pairingChannel = await pairingRelay.connection.openPairingChannel(
      pairingTarget.nodeFingerprint,
      pairingTarget.rendezvousId,
    )
    pairingChannel.on('error', () => undefined)
    pairingMachine = await beginRemoteMachinePairingOverStream({
      stream: pairingChannel,
      pairingCode: pairing.code,
      controller,
    })
    pairingChannel = undefined
    assert.deepEqual(pairingMachine.machine, nodeState.machine)
    assert.equal(pairingMachine.endpoint, undefined)
    assert.equal(nodeState.trustedControllerCount, 0)
    assert.equal(
      pairingMachine.trustCandidate.controllerId,
      controller.controllerId,
    )

    const confirmed = await pairingMachine.confirm()
    pairingMachine = undefined
    assert.deepEqual(confirmed.machine, nodeState.machine)
    assert.equal(nodeState.trustedControllerCount, 1)
    assert.equal(
      nodeState.trustedController()?.controllerId,
      controller.controllerId,
    )
    assert.equal(
      nodeState.trustedController()?.publicKeyFingerprint,
      controller.tls.publicKeyFingerprint,
    )
    assert.equal(
      nodeState.trustedController()?.publicKeySpki,
      relayPublicKeySpkiFromCertificate(controller.tls.certificatePem),
    )
    await assert.rejects(
      pairingRelay.connection.openPairingChannel(
        pairingTarget.nodeFingerprint,
        pairingTarget.rendezvousId,
      ),
      (error) =>
        error instanceof RelayClientError &&
        error.code === 'relay_channel_open_failed',
    )
    await pairingRelay.connection.close()
    pairingRelay = undefined

    trustedRelay = await connectRelayControl({
      endpoint,
      tls: relayTlsPolicy,
      expectedRelayIdentityFingerprint: relay.relayFingerprint,
      identity: machineRelayIdentity('controller', controller.tls),
      clientBuildIdentity: 'relay-pairing-integration',
    })
    assert.equal(trustedRelay.connection.scope, 'trusted')
    trustedChannel = await trustedRelay.connection.openMachineChannel(
      nodeState.identity.publicKeyFingerprint,
    )
    trustedChannel.on('error', () => undefined)
    trustedMachine = await connectTrustedRemoteMachineOverStream({
      stream: trustedChannel,
      controller,
      peer: {
        machine: nodeState.machine,
        nodeFingerprint: nodeState.identity.publicKeyFingerprint,
        protocolVersion: machineProtocolVersion,
        controllerId: controller.controllerId,
      },
    })
    trustedChannel = undefined
    await trustedMachine.ping()
    assert.deepEqual(trustedMachine.machine, nodeState.machine)
    assert.equal(
      relayStore.canControllerObserveNode(
        controller.tls.publicKeyFingerprint,
        nodeState.identity.publicKeyFingerprint,
      ),
      true,
    )
  } finally {
    trustedMachine?.close()
    await pairingMachine?.cancel().catch(() => undefined)
    trustedChannel?.destroy()
    pairingChannel?.destroy()
    rejectedPairingChannel?.destroy()
    await trustedRelay?.connection.close().catch(() => undefined)
    await pairingRelay?.connection.close().catch(() => undefined)
    await rejectedPairingRelay?.connection.close().catch(() => undefined)
    await nodeService?.close().catch(() => undefined)
    await nodeRelayManager?.close().catch(() => undefined)
    await nodeState.close().catch(() => undefined)
    await relay.close().catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})

function machineRelayIdentity(role, identity) {
  return {
    role,
    privateKeyPem: identity.privateKeyPem,
    publicKeySpki: relayPublicKeySpkiFromCertificate(identity.certificatePem),
    publicKeyFingerprint: identity.publicKeyFingerprint,
  }
}

function relayOnlyPeer(state, controllerId) {
  return {
    machine: state.machine,
    // This endpoint is intentionally unusable. The over-stream API must not
    // attempt direct TCP dialing while exercising the Relay-owned Duplex.
    endpoint: { host: '127.0.0.1', port: 0 },
    nodeFingerprint: state.identity.publicKeyFingerprint,
    protocolVersion: machineProtocolVersion,
    controllerId,
  }
}

function createNodeChannelHandler(options) {
  return async (offer) => {
    options.offers.push({
      controllerFingerprint: offer.controllerFingerprint,
      controllerConnectionEpoch: offer.controllerConnectionEpoch,
      nodeConnectionEpoch: offer.nodeConnectionEpoch,
    })
    if (offer.controllerFingerprint !== options.expectedControllerFingerprint) {
      await offer.reject('not_available')
      return
    }
    const channel = await offer.accept()
    channel.on('error', () => undefined)
    options.onChannel(channel)
    await options.nodeService.acceptRelayMachineChannel({
      stream: channel,
      controllerFingerprint: offer.controllerFingerprint,
    })
  }
}

function assertControlSchemaHasNoGenericPayload(
  connectionEpoch,
  targetNodeFingerprint,
) {
  const boundedOpen = {
    type: 'channel.open',
    protocolVersion: relayProtocolVersion,
    connectionEpoch,
    requestId: newRelayRequestId(),
    targetNodeFingerprint,
    purpose: 'machine_tls_v1',
  }
  assert.equal(RelayClientMessageSchema.safeParse(boundedOpen).success, true)
  assert.equal(
    RelayClientMessageSchema.safeParse({
      ...boundedOpen,
      requestId: newRelayRequestId(),
      purpose: 'arbitrary_tunnel',
    }).success,
    false,
  )
  assert.equal(
    RelayClientMessageSchema.safeParse({
      ...boundedOpen,
      requestId: newRelayRequestId(),
      payload: 'execute provider command',
    }).success,
    false,
  )
}

async function waitFor(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for state')
    await delay(5)
  }
}
