import assert from 'node:assert/strict'
import { X509Certificate, createHash, randomBytes } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { connect as connectTls } from 'node:tls'
import test from 'node:test'

import {
  FramedRelayConnection,
  RelayChallengeMessageSchema,
  RelayServerMessageSchema,
  generateRelayApplicationIdentity,
  newRelayChannelGeneration,
  newRelayChannelId,
  newRelayConnectionEpoch,
  newRelayRequestId,
  relayAuthenticationTranscript,
  relayChallengeTranscript,
  relayEnrollmentTranscript,
  relayProtocolAlpn,
  relayProtocolLimits,
  relayProtocolVersion,
  signRelayTranscript,
  verifyRelayTranscript,
} from '@codetether/relay-protocol'

import {
  RelayService,
  RelayStateStore,
  createJsonRelayLogger,
  generateRelayPinnedTlsIdentity,
} from '../dist/index.js'

const silentLogger = { log() {} }

async function withService(run, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'codetether-relay-channel-'))
  const store = new RelayStateStore(join(root, 'state'))
  const tls = await generateRelayPinnedTlsIdentity(store.identity)
  const service = new RelayService({
    stateStore: store,
    tls,
    host: '127.0.0.1',
    port: 0,
    managementHost: '127.0.0.1',
    managementPort: 0,
    heartbeatIntervalMs: 10_000,
    heartbeatTimeoutMs: 20_000,
    logger: silentLogger,
    ...overrides,
  })
  try {
    await service.start()
    await run({ root, store, service, tls })
  } finally {
    await service.close()
    await rm(root, { recursive: true, force: true })
  }
}

async function openChallenge(service, tlsFingerprint) {
  const socket = connectTls({
    host: '127.0.0.1',
    port: service.listeningAddress.port,
    rejectUnauthorized: false,
    ALPNProtocols: [relayProtocolAlpn],
  })
  await new Promise((resolve, reject) => {
    socket.once('secureConnect', resolve)
    socket.once('error', reject)
  })
  const certificate = new X509Certificate(socket.getPeerCertificate(true).raw)
  assert.equal(
    createHash('sha256')
      .update(certificate.publicKey.export({ type: 'spki', format: 'der' }))
      .digest('base64url'),
    tlsFingerprint,
  )
  const channel = new FramedRelayConnection(socket)
  const challenge = await channel.receive(RelayChallengeMessageSchema, {
    timeoutMs: 2_000,
  })
  const { signature, ...unsigned } = challenge
  assert.equal(
    verifyRelayTranscript(
      challenge.relayPublicKeySpki,
      relayChallengeTranscript(unsigned),
      signature,
    ),
    true,
  )
  return { channel, challenge }
}

async function enrollPeer(
  service,
  tlsFingerprint,
  token,
  role,
  identity,
  authorizedControllerFingerprint,
) {
  const opened = await openChallenge(service, tlsFingerprint)
  const transcript = {
    challenge: opened.challenge,
    role,
    enrollmentToken: token,
    peerPublicKeySpki: identity.publicKeySpki,
    peerFingerprint: identity.publicKeyFingerprint,
    clientBuildIdentity: 'channel-test',
    ...(authorizedControllerFingerprint === undefined
      ? {}
      : { authorizedControllerFingerprint }),
  }
  await opened.channel.send({
    type: 'peer.enroll',
    protocolVersion: relayProtocolVersion,
    role,
    enrollmentToken: token,
    peerPublicKeySpki: identity.publicKeySpki,
    peerFingerprint: identity.publicKeyFingerprint,
    clientBuildIdentity: 'channel-test',
    ...(role === 'node' && authorizedControllerFingerprint !== undefined
      ? { authorizedControllerFingerprint }
      : {}),
    signature: signRelayTranscript(
      identity.privateKeyPem,
      relayEnrollmentTranscript(transcript),
    ),
  })
  return {
    ...opened,
    identity,
    ready: await receiveType(opened.channel, 'peer.ready'),
  }
}

async function authenticatePeer(service, tlsFingerprint, role, identity) {
  const opened = await openChallenge(service, tlsFingerprint)
  const transcript = {
    challenge: opened.challenge,
    peerFingerprint: identity.publicKeyFingerprint,
    role,
    clientBuildIdentity: 'channel-test',
  }
  await opened.channel.send({
    type: 'peer.authenticate',
    protocolVersion: relayProtocolVersion,
    peerFingerprint: identity.publicKeyFingerprint,
    role,
    clientBuildIdentity: 'channel-test',
    signature: signRelayTranscript(
      identity.privateKeyPem,
      relayAuthenticationTranscript(transcript),
    ),
  })
  return {
    ...opened,
    identity,
    ready: await receiveType(opened.channel, 'peer.ready'),
  }
}

async function receiveType(channel, expectedType, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const message = await channel.receive(RelayServerMessageSchema, {
      timeoutMs: Math.max(1, deadline - Date.now()),
    })
    if (message.type === 'heartbeat.ping') {
      await channel.send({
        type: 'heartbeat.pong',
        protocolVersion: relayProtocolVersion,
        connectionEpoch: message.connectionEpoch,
        pingId: message.pingId,
      })
      continue
    }
    assert.equal(message.type, expectedType)
    return message
  }
  throw new Error(`Timed out waiting for ${expectedType}`)
}

async function waitForCondition(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'Timed out waiting for Relay test state')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

async function expectNoMessage(channel, timeoutMs = 80) {
  await assert.rejects(
    channel.receive(RelayServerMessageSchema, { timeoutMs }),
    (error) => error?.code === 'timeout',
  )
}

async function openMachineChannel(controller, node, targetNodeFingerprint) {
  const requestId = newRelayRequestId()
  await controller.channel.send({
    type: 'channel.open',
    protocolVersion: relayProtocolVersion,
    connectionEpoch: controller.ready.connectionEpoch,
    requestId,
    targetNodeFingerprint,
    purpose: 'machine_tls_v1',
  })
  const offer = await receiveType(node.channel, 'channel.offer')
  assert.equal(offer.requestId, requestId)
  await node.channel.send({
    type: 'channel.accept',
    protocolVersion: relayProtocolVersion,
    connectionEpoch: node.ready.connectionEpoch,
    requestId,
    channelId: offer.channelId,
    channelGeneration: offer.channelGeneration,
    controllerConnectionEpoch: offer.controllerConnectionEpoch,
    nodeConnectionEpoch: offer.nodeConnectionEpoch,
  })
  const [controllerOpened, nodeOpened] = await Promise.all([
    receiveType(controller.channel, 'channel.opened'),
    receiveType(node.channel, 'channel.opened'),
  ])
  assert.equal(controllerOpened.channelId, offer.channelId)
  assert.equal(nodeOpened.channelGeneration, offer.channelGeneration)
  return { requestId, offer, controllerOpened, nodeOpened }
}

function channelBinding(opened, connectionEpoch) {
  return {
    protocolVersion: relayProtocolVersion,
    connectionEpoch,
    channelId: opened.channelId,
    channelGeneration: opened.channelGeneration,
    controllerConnectionEpoch: opened.controllerConnectionEpoch,
    nodeConnectionEpoch: opened.nodeConnectionEpoch,
  }
}

async function closePeer(peer) {
  if (peer.channel.closed) return
  await peer.channel
    .send({
      type: 'peer.goodbye',
      protocolVersion: relayProtocolVersion,
      connectionEpoch: peer.ready.connectionEpoch,
    })
    .catch(() => undefined)
  peer.channel.end()
}

test('authorized machine TLS channel forwards bounded data and ACKs without becoming a generic proxy', async () => {
  await withService(async ({ store, service, tls }) => {
    const controllerIdentity = generateRelayApplicationIdentity()
    const unauthorizedIdentity = generateRelayApplicationIdentity()
    const nodeIdentity = generateRelayApplicationIdentity()
    const controller = await enrollPeer(
      service,
      tls.publicKeySpkiFingerprint,
      store.createEnrollmentToken('controller'),
      'controller',
      controllerIdentity,
    )
    const unauthorized = await enrollPeer(
      service,
      tls.publicKeySpkiFingerprint,
      store.createEnrollmentToken('controller'),
      'controller',
      unauthorizedIdentity,
    )
    const node = await enrollPeer(
      service,
      tls.publicKeySpkiFingerprint,
      store.createEnrollmentToken('node'),
      'node',
      nodeIdentity,
      controllerIdentity.publicKeyFingerprint,
    )

    const unauthorizedRequest = newRelayRequestId()
    await unauthorized.channel.send({
      type: 'channel.open',
      protocolVersion: relayProtocolVersion,
      connectionEpoch: unauthorized.ready.connectionEpoch,
      requestId: unauthorizedRequest,
      targetNodeFingerprint: nodeIdentity.publicKeyFingerprint,
      purpose: 'machine_tls_v1',
    })
    const unauthorizedError = await receiveType(
      unauthorized.channel,
      'channel.error',
    )
    assert.deepEqual(
      {
        requestId: unauthorizedError.requestId,
        code: unauthorizedError.code,
      },
      { requestId: unauthorizedRequest, code: 'not_authorized' },
    )
    const unknownRequest = newRelayRequestId()
    await unauthorized.channel.send({
      type: 'channel.open',
      protocolVersion: relayProtocolVersion,
      connectionEpoch: unauthorized.ready.connectionEpoch,
      requestId: unknownRequest,
      targetNodeFingerprint:
        generateRelayApplicationIdentity().publicKeyFingerprint,
      purpose: 'machine_tls_v1',
    })
    const unknownError = await receiveType(
      unauthorized.channel,
      'channel.error',
    )
    assert.equal(unknownError.code, unauthorizedError.code)

    const opened = await openMachineChannel(
      controller,
      node,
      nodeIdentity.publicKeyFingerprint,
    )
    const controllerData = Buffer.from('controller TLS record').toString(
      'base64url',
    )
    await controller.channel.send({
      type: 'channel.data',
      ...channelBinding(
        opened.controllerOpened,
        controller.ready.connectionEpoch,
      ),
      sequence: 1,
      data: controllerData,
    })
    const nodeData = await receiveType(node.channel, 'channel.data')
    assert.equal(nodeData.data, controllerData)
    assert.equal(service.metrics().pendingChannelDataFrames, 1)
    assert.equal(
      service.metrics().pendingChannelDataBytes,
      Buffer.byteLength('controller TLS record'),
    )
    await node.channel.send({
      type: 'channel.data.ack',
      ...channelBinding(opened.nodeOpened, node.ready.connectionEpoch),
      acknowledgedSequence: 1,
    })
    assert.equal(
      (await receiveType(controller.channel, 'channel.data.ack'))
        .acknowledgedSequence,
      1,
    )
    assert.equal(service.metrics().pendingChannelDataFrames, 0)
    assert.equal(service.metrics().pendingChannelDataBytes, 0)

    const nodePayload = Buffer.from('node TLS record').toString('base64url')
    await node.channel.send({
      type: 'channel.data',
      ...channelBinding(opened.nodeOpened, node.ready.connectionEpoch),
      sequence: 1,
      data: nodePayload,
    })
    assert.equal(
      (await receiveType(controller.channel, 'channel.data')).data,
      nodePayload,
    )
    assert.equal(service.metrics().pendingChannelDataFrames, 1)
    assert.equal(
      service.metrics().pendingChannelDataBytes,
      Buffer.byteLength('node TLS record'),
    )
    await controller.channel.send({
      type: 'channel.data.ack',
      ...channelBinding(
        opened.controllerOpened,
        controller.ready.connectionEpoch,
      ),
      acknowledgedSequence: 1,
    })
    await receiveType(node.channel, 'channel.data.ack')

    await controller.channel.send({
      type: 'channel.close',
      ...channelBinding(
        opened.controllerOpened,
        controller.ready.connectionEpoch,
      ),
      reason: 'completed',
    })
    const [controllerClosed, nodeClosed] = await Promise.all([
      receiveType(controller.channel, 'channel.closed'),
      receiveType(node.channel, 'channel.closed'),
    ])
    assert.equal(controllerClosed.reason, 'peer_closed')
    assert.equal(nodeClosed.requestId, opened.requestId)
    assert.deepEqual(
      {
        activeChannels: service.metrics().activeChannels,
        pendingChannelDataFrames: service.metrics().pendingChannelDataFrames,
        pendingChannelDataBytes: service.metrics().pendingChannelDataBytes,
        pendingChannelDataFramesHighWaterMark:
          service.metrics().pendingChannelDataFramesHighWaterMark,
        pendingChannelDataBytesHighWaterMark:
          service.metrics().pendingChannelDataBytesHighWaterMark,
        channelDataFramesForwarded:
          service.metrics().channelDataFramesForwarded,
        channelDataBytesForwarded: service.metrics().channelDataBytesForwarded,
        controllerToRelayChannelBytes:
          service.metrics().controllerToRelayChannelBytes,
        relayToNodeChannelBytes: service.metrics().relayToNodeChannelBytes,
        nodeToRelayChannelBytes: service.metrics().nodeToRelayChannelBytes,
        relayToControllerChannelBytes:
          service.metrics().relayToControllerChannelBytes,
      },
      {
        activeChannels: 0,
        pendingChannelDataFrames: 0,
        pendingChannelDataBytes: 0,
        pendingChannelDataFramesHighWaterMark: 1,
        pendingChannelDataBytesHighWaterMark: Math.max(
          Buffer.byteLength('controller TLS record'),
          Buffer.byteLength('node TLS record'),
        ),
        channelDataFramesForwarded: 2,
        channelDataBytesForwarded:
          Buffer.byteLength('controller TLS record') +
          Buffer.byteLength('node TLS record'),
        controllerToRelayChannelBytes: Buffer.byteLength(
          'controller TLS record',
        ),
        relayToNodeChannelBytes: Buffer.byteLength('controller TLS record'),
        nodeToRelayChannelBytes: Buffer.byteLength('node TLS record'),
        relayToControllerChannelBytes: Buffer.byteLength('node TLS record'),
      },
    )
    const safeMetrics = JSON.stringify(service.metrics())
    assert.equal(service.metrics().framedQueueFrames, 0)
    assert.equal(service.metrics().framedQueueBytes, 0)
    assert.equal(service.metrics().framedQueueFramesHighWaterMark >= 1, true)
    assert.equal(service.metrics().framedQueueBytesHighWaterMark > 0, true)
    assert.equal(safeMetrics.includes(controllerData), false)
    assert.equal(safeMetrics.includes(nodePayload), false)
    assert.equal(safeMetrics.includes(opened.offer.channelId), false)
    assert.equal(
      safeMetrics.includes(controllerIdentity.publicKeyFingerprint),
      false,
    )
    const database = new DatabaseSync(store.databasePath, { readOnly: true })
    const tableNames = database
      .prepare(
        `SELECT name
           FROM sqlite_schema
          WHERE type = 'table'
          ORDER BY name ASC`,
      )
      .all()
      .map((row) => row.name)
    database.close()
    assert.deepEqual(tableNames, [
      'enrollment_tokens',
      'peers',
      'relay_metadata',
      'rendezvous_grants',
    ])
    assert.equal(
      tableNames.some((name) => name.includes('channel')),
      false,
    )

    await closePeer(node)
    const offlineRequest = newRelayRequestId()
    await controller.channel.send({
      type: 'channel.open',
      protocolVersion: relayProtocolVersion,
      connectionEpoch: controller.ready.connectionEpoch,
      requestId: offlineRequest,
      targetNodeFingerprint: nodeIdentity.publicKeyFingerprint,
      purpose: 'machine_tls_v1',
    })
    const offline = await receiveType(controller.channel, 'channel.error')
    assert.equal(offline.code, 'peer_unavailable')

    await closePeer(unauthorized)
    await closePeer(controller)
  })
})

test('opaque channel payload is absent from Relay logs, metrics, and persistence', async () => {
  const marker = `phase7c-sentinel-${randomBytes(18).toString('base64url')}`
  const encodedMarker = Buffer.from(marker, 'utf8').toString('base64url')
  const logLines = []
  const logger = createJsonRelayLogger((line) => logLines.push(line))

  await withService(
    async ({ root, store, service, tls }) => {
      const controllerIdentity = generateRelayApplicationIdentity()
      const nodeIdentity = generateRelayApplicationIdentity()
      const controller = await enrollPeer(
        service,
        tls.publicKeySpkiFingerprint,
        store.createEnrollmentToken('controller'),
        'controller',
        controllerIdentity,
      )
      const node = await enrollPeer(
        service,
        tls.publicKeySpkiFingerprint,
        store.createEnrollmentToken('node'),
        'node',
        nodeIdentity,
        controllerIdentity.publicKeyFingerprint,
      )
      const opened = await openMachineChannel(
        controller,
        node,
        nodeIdentity.publicKeyFingerprint,
      )

      await controller.channel.send({
        type: 'channel.data',
        ...channelBinding(
          opened.controllerOpened,
          controller.ready.connectionEpoch,
        ),
        sequence: 1,
        data: encodedMarker,
      })
      const forwarded = await receiveType(node.channel, 'channel.data')
      assert.equal(forwarded.data, encodedMarker)
      await node.channel.send({
        type: 'channel.data.ack',
        ...channelBinding(opened.nodeOpened, node.ready.connectionEpoch),
        acknowledgedSequence: 1,
      })
      await receiveType(controller.channel, 'channel.data.ack')

      await controller.channel.send({
        type: 'channel.close',
        ...channelBinding(
          opened.controllerOpened,
          controller.ready.connectionEpoch,
        ),
        reason: 'completed',
      })
      await Promise.all([
        receiveType(controller.channel, 'channel.closed'),
        receiveType(node.channel, 'channel.closed'),
      ])

      const metrics = JSON.stringify(service.metrics())
      assert.equal(metrics.includes(marker), false)
      assert.equal(metrics.includes(encodedMarker), false)

      const stateDirectory = join(root, 'state')
      const stateFiles = await readdir(stateDirectory)
      const persisted = Buffer.concat(
        await Promise.all(
          stateFiles.map(
            async (name) => await readFile(join(stateDirectory, name)),
          ),
        ),
      )
      assert.equal(persisted.includes(Buffer.from(marker, 'utf8')), false)
      assert.equal(
        persisted.includes(Buffer.from(encodedMarker, 'utf8')),
        false,
      )

      await Promise.all([closePeer(controller), closePeer(node)])
    },
    { logger },
  )

  const logs = logLines.join('')
  assert.equal(logs.includes(marker), false)
  assert.equal(logs.includes(encodedMarker), false)
})

test('two authorized Controller and Node pairs multiplex isolated Machine channels without cross-peer access', async () => {
  await withService(async ({ store, service, tls }) => {
    const controllerAIdentity = generateRelayApplicationIdentity()
    const controllerBIdentity = generateRelayApplicationIdentity()
    const nodeAIdentity = generateRelayApplicationIdentity()
    const nodeBIdentity = generateRelayApplicationIdentity()
    const controllerA = await enrollPeer(
      service,
      tls.publicKeySpkiFingerprint,
      store.createEnrollmentToken('controller'),
      'controller',
      controllerAIdentity,
    )
    const controllerB = await enrollPeer(
      service,
      tls.publicKeySpkiFingerprint,
      store.createEnrollmentToken('controller'),
      'controller',
      controllerBIdentity,
    )
    const nodeA = await enrollPeer(
      service,
      tls.publicKeySpkiFingerprint,
      store.createEnrollmentToken('node'),
      'node',
      nodeAIdentity,
      controllerAIdentity.publicKeyFingerprint,
    )
    const nodeB = await enrollPeer(
      service,
      tls.publicKeySpkiFingerprint,
      store.createEnrollmentToken('node'),
      'node',
      nodeBIdentity,
      controllerBIdentity.publicKeyFingerprint,
    )

    const [openedA, openedB] = await Promise.all([
      openMachineChannel(
        controllerA,
        nodeA,
        nodeAIdentity.publicKeyFingerprint,
      ),
      openMachineChannel(
        controllerB,
        nodeB,
        nodeBIdentity.publicKeyFingerprint,
      ),
    ])
    assert.equal(service.metrics().activeChannels, 2)
    assert.notEqual(openedA.offer.channelId, openedB.offer.channelId)

    const controllerMarkerA = Buffer.from('controller-A-to-node-A').toString(
      'base64url',
    )
    const controllerMarkerB = Buffer.from('controller-B-to-node-B').toString(
      'base64url',
    )
    await Promise.all([
      controllerA.channel.send({
        type: 'channel.data',
        ...channelBinding(
          openedA.controllerOpened,
          controllerA.ready.connectionEpoch,
        ),
        sequence: 1,
        data: controllerMarkerA,
      }),
      controllerB.channel.send({
        type: 'channel.data',
        ...channelBinding(
          openedB.controllerOpened,
          controllerB.ready.connectionEpoch,
        ),
        sequence: 1,
        data: controllerMarkerB,
      }),
    ])
    const [nodeDataA, nodeDataB] = await Promise.all([
      receiveType(nodeA.channel, 'channel.data'),
      receiveType(nodeB.channel, 'channel.data'),
    ])
    assert.equal(nodeDataA.data, controllerMarkerA)
    assert.equal(nodeDataB.data, controllerMarkerB)
    assert.notEqual(nodeDataA.data, controllerMarkerB)
    assert.notEqual(nodeDataB.data, controllerMarkerA)

    await Promise.all([
      nodeA.channel.send({
        type: 'channel.data.ack',
        ...channelBinding(openedA.nodeOpened, nodeA.ready.connectionEpoch),
        acknowledgedSequence: 1,
      }),
      nodeB.channel.send({
        type: 'channel.data.ack',
        ...channelBinding(openedB.nodeOpened, nodeB.ready.connectionEpoch),
        acknowledgedSequence: 1,
      }),
    ])
    await Promise.all([
      receiveType(controllerA.channel, 'channel.data.ack'),
      receiveType(controllerB.channel, 'channel.data.ack'),
    ])

    const nodeMarkerA = Buffer.from('node-A-to-controller-A').toString(
      'base64url',
    )
    const nodeMarkerB = Buffer.from('node-B-to-controller-B').toString(
      'base64url',
    )
    await Promise.all([
      nodeA.channel.send({
        type: 'channel.data',
        ...channelBinding(openedA.nodeOpened, nodeA.ready.connectionEpoch),
        sequence: 1,
        data: nodeMarkerA,
      }),
      nodeB.channel.send({
        type: 'channel.data',
        ...channelBinding(openedB.nodeOpened, nodeB.ready.connectionEpoch),
        sequence: 1,
        data: nodeMarkerB,
      }),
    ])
    const [controllerDataA, controllerDataB] = await Promise.all([
      receiveType(controllerA.channel, 'channel.data'),
      receiveType(controllerB.channel, 'channel.data'),
    ])
    assert.equal(controllerDataA.data, nodeMarkerA)
    assert.equal(controllerDataB.data, nodeMarkerB)
    assert.notEqual(controllerDataA.data, nodeMarkerB)
    assert.notEqual(controllerDataB.data, nodeMarkerA)

    await Promise.all([
      controllerA.channel.send({
        type: 'channel.data.ack',
        ...channelBinding(
          openedA.controllerOpened,
          controllerA.ready.connectionEpoch,
        ),
        acknowledgedSequence: 1,
      }),
      controllerB.channel.send({
        type: 'channel.data.ack',
        ...channelBinding(
          openedB.controllerOpened,
          controllerB.ready.connectionEpoch,
        ),
        acknowledgedSequence: 1,
      }),
    ])
    await Promise.all([
      receiveType(nodeA.channel, 'channel.data.ack'),
      receiveType(nodeB.channel, 'channel.data.ack'),
    ])

    const crossRequestA = newRelayRequestId()
    const crossRequestB = newRelayRequestId()
    await Promise.all([
      controllerA.channel.send({
        type: 'channel.open',
        protocolVersion: relayProtocolVersion,
        connectionEpoch: controllerA.ready.connectionEpoch,
        requestId: crossRequestA,
        targetNodeFingerprint: nodeBIdentity.publicKeyFingerprint,
        purpose: 'machine_tls_v1',
      }),
      controllerB.channel.send({
        type: 'channel.open',
        protocolVersion: relayProtocolVersion,
        connectionEpoch: controllerB.ready.connectionEpoch,
        requestId: crossRequestB,
        targetNodeFingerprint: nodeAIdentity.publicKeyFingerprint,
        purpose: 'machine_tls_v1',
      }),
    ])
    const [crossFailureA, crossFailureB] = await Promise.all([
      receiveType(controllerA.channel, 'channel.error'),
      receiveType(controllerB.channel, 'channel.error'),
    ])
    assert.deepEqual(
      { requestId: crossFailureA.requestId, code: crossFailureA.code },
      { requestId: crossRequestA, code: 'not_authorized' },
    )
    assert.deepEqual(
      { requestId: crossFailureB.requestId, code: crossFailureB.code },
      { requestId: crossRequestB, code: 'not_authorized' },
    )
    await Promise.all([
      expectNoMessage(nodeA.channel),
      expectNoMessage(nodeB.channel),
    ])

    await Promise.all([
      controllerA.channel.send({
        type: 'channel.close',
        ...channelBinding(
          openedA.controllerOpened,
          controllerA.ready.connectionEpoch,
        ),
        reason: 'completed',
      }),
      controllerB.channel.send({
        type: 'channel.close',
        ...channelBinding(
          openedB.controllerOpened,
          controllerB.ready.connectionEpoch,
        ),
        reason: 'completed',
      }),
    ])
    await Promise.all([
      receiveType(controllerA.channel, 'channel.closed'),
      receiveType(nodeA.channel, 'channel.closed'),
      receiveType(controllerB.channel, 'channel.closed'),
      receiveType(nodeB.channel, 'channel.closed'),
    ])
    assert.equal(service.metrics().activeChannels, 0)
    assert.equal(service.metrics().pendingChannelDataFrames, 0)
    assert.equal(service.metrics().pendingChannelDataBytes, 0)

    await Promise.all([
      closePeer(controllerA),
      closePeer(controllerB),
      closePeer(nodeA),
      closePeer(nodeB),
    ])
  })
})

test('cross-peer, guessed, and stop-and-wait violations cannot mutate another channel', async () => {
  await withService(
    async ({ store, service, tls }) => {
      const controllerIdentity = generateRelayApplicationIdentity()
      const attackerIdentity = generateRelayApplicationIdentity()
      const nodeIdentity = generateRelayApplicationIdentity()
      const controller = await enrollPeer(
        service,
        tls.publicKeySpkiFingerprint,
        store.createEnrollmentToken('controller'),
        'controller',
        controllerIdentity,
      )
      const attacker = await enrollPeer(
        service,
        tls.publicKeySpkiFingerprint,
        store.createEnrollmentToken('controller'),
        'controller',
        attackerIdentity,
      )
      const node = await enrollPeer(
        service,
        tls.publicKeySpkiFingerprint,
        store.createEnrollmentToken('node'),
        'node',
        nodeIdentity,
        controllerIdentity.publicKeyFingerprint,
      )
      const opened = await openMachineChannel(
        controller,
        node,
        nodeIdentity.publicKeyFingerprint,
      )
      const attackerBinding = channelBinding(
        opened.controllerOpened,
        attacker.ready.connectionEpoch,
      )
      await attacker.channel.send({
        type: 'channel.data',
        ...attackerBinding,
        sequence: 1,
        data: 'AA',
      })
      await expectNoMessage(attacker.channel)
      await attacker.channel.send({
        type: 'channel.data',
        ...attackerBinding,
        channelId: newRelayChannelId(),
        channelGeneration: newRelayChannelGeneration(),
        sequence: 1,
        data: 'AA',
      })
      await expectNoMessage(attacker.channel)

      const binding = channelBinding(
        opened.controllerOpened,
        controller.ready.connectionEpoch,
      )
      await controller.channel.send({
        type: 'channel.data',
        ...binding,
        sequence: 1,
        data: 'AA',
      })
      assert.equal((await receiveType(node.channel, 'channel.data')).data, 'AA')
      await controller.channel.send({
        type: 'channel.data',
        ...binding,
        sequence: 2,
        data: 'AQ',
      })
      const [controllerError, nodeError] = await Promise.all([
        receiveType(controller.channel, 'channel.error'),
        receiveType(node.channel, 'channel.error'),
      ])
      assert.equal(controllerError.code, 'flow_control_violation')
      assert.equal(nodeError.code, 'flow_control_violation')
      assert.equal(service.metrics().activeChannels, 0)
      assert.equal(service.metrics().staleChannelFrames, 2)
      assert.equal(service.metrics().channelBackpressureFailures, 1)

      const timed = await openMachineChannel(
        controller,
        node,
        nodeIdentity.publicKeyFingerprint,
      )
      await controller.channel.send({
        type: 'channel.data',
        ...channelBinding(
          timed.controllerOpened,
          controller.ready.connectionEpoch,
        ),
        sequence: 1,
        data: 'AA',
      })
      await receiveType(node.channel, 'channel.data')
      const [timedControllerError, timedNodeError] = await Promise.all([
        receiveType(controller.channel, 'channel.error'),
        receiveType(node.channel, 'channel.error'),
      ])
      assert.equal(timedControllerError.code, 'flow_control_violation')
      assert.equal(timedNodeError.code, 'flow_control_violation')

      const stale = await openMachineChannel(
        controller,
        node,
        nodeIdentity.publicKeyFingerprint,
      )
      await controller.channel.send({
        type: 'channel.data',
        ...channelBinding(
          stale.controllerOpened,
          controller.ready.connectionEpoch,
        ),
        nodeConnectionEpoch: newRelayConnectionEpoch(),
        sequence: 1,
        data: 'AA',
      })
      const [staleControllerError, staleNodeError] = await Promise.all([
        receiveType(controller.channel, 'channel.error'),
        receiveType(node.channel, 'channel.error'),
      ])
      assert.equal(staleControllerError.code, 'stale_channel')
      assert.equal(staleNodeError.code, 'stale_channel')
      assert.equal(service.metrics().activeChannels, 0)
      assert.equal(service.metrics().staleChannelFrames, 3)
      assert.equal(service.metrics().channelBackpressureFailures, 2)

      await closePeer(node)
      await closePeer(attacker)
      await closePeer(controller)
    },
    { channelAcknowledgementTimeoutMs: 80 },
  )
})

test('exact terminal channel frames are tombstoned without weakening stale-binding strikes', async () => {
  await withService(async ({ store, service, tls }) => {
    const controllerIdentity = generateRelayApplicationIdentity()
    const nodeIdentity = generateRelayApplicationIdentity()
    const controller = await enrollPeer(
      service,
      tls.publicKeySpkiFingerprint,
      store.createEnrollmentToken('controller'),
      'controller',
      controllerIdentity,
    )
    const node = await enrollPeer(
      service,
      tls.publicKeySpkiFingerprint,
      store.createEnrollmentToken('node'),
      'node',
      nodeIdentity,
      controllerIdentity.publicKeyFingerprint,
    )
    const closed = await openMachineChannel(
      controller,
      node,
      nodeIdentity.publicKeyFingerprint,
    )
    const surviving = await openMachineChannel(
      controller,
      node,
      nodeIdentity.publicKeyFingerprint,
    )
    const closedControllerBinding = channelBinding(
      closed.controllerOpened,
      controller.ready.connectionEpoch,
    )
    const closedNodeBinding = channelBinding(
      closed.nodeOpened,
      node.ready.connectionEpoch,
    )

    await controller.channel.send({
      type: 'channel.close',
      ...closedControllerBinding,
      reason: 'completed',
    })
    await Promise.all([
      receiveType(controller.channel, 'channel.closed'),
      receiveType(node.channel, 'channel.closed'),
    ])
    assert.equal(service.metrics().activeChannels, 1)
    assert.equal(service.metrics().terminalChannelTombstones, 1)
    const staleBeforeTerminalFrames = service.metrics().staleChannelFrames

    await node.channel.send({
      type: 'channel.data.ack',
      ...closedNodeBinding,
      acknowledgedSequence: 1,
    })
    await controller.channel.send({
      type: 'channel.close',
      ...closedControllerBinding,
      reason: 'completed',
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(
      service.metrics().staleChannelFrames,
      staleBeforeTerminalFrames,
    )
    assert.equal(service.metrics().authenticatedControllers, 1)
    assert.equal(service.metrics().authenticatedNodes, 1)

    await controller.channel.send({
      type: 'channel.close',
      ...closedControllerBinding,
      channelGeneration: newRelayChannelGeneration(),
      reason: 'completed',
    })
    await waitForCondition(
      () =>
        service.metrics().staleChannelFrames === staleBeforeTerminalFrames + 1,
    )
    assert.equal(
      service.metrics().staleChannelFrames,
      staleBeforeTerminalFrames + 1,
    )
    assert.equal(service.metrics().authenticatedControllers, 1)
    assert.equal(service.metrics().authenticatedNodes, 1)

    const survivingBinding = channelBinding(
      surviving.controllerOpened,
      controller.ready.connectionEpoch,
    )
    await controller.channel.send({
      type: 'channel.data',
      ...survivingBinding,
      sequence: 1,
      data: Buffer.from('still-live').toString('base64url'),
    })
    assert.equal(
      Buffer.from(
        (await receiveType(node.channel, 'channel.data')).data,
        'base64url',
      ).toString(),
      'still-live',
    )
    await node.channel.send({
      type: 'channel.data.ack',
      ...channelBinding(surviving.nodeOpened, node.ready.connectionEpoch),
      acknowledgedSequence: 1,
    })
    await receiveType(controller.channel, 'channel.data.ack')
    await controller.channel.send({
      type: 'channel.close',
      ...survivingBinding,
      reason: 'completed',
    })
    await Promise.all([
      receiveType(controller.channel, 'channel.closed'),
      receiveType(node.channel, 'channel.closed'),
    ])

    await closePeer(node)
    await closePeer(controller)
  })
})

test('a stale-channel frame flood disconnects only the offending authenticated peer', async () => {
  await withService(async ({ store, service, tls }) => {
    const controllerIdentity = generateRelayApplicationIdentity()
    const attackerIdentity = generateRelayApplicationIdentity()
    const nodeIdentity = generateRelayApplicationIdentity()
    const controller = await enrollPeer(
      service,
      tls.publicKeySpkiFingerprint,
      store.createEnrollmentToken('controller'),
      'controller',
      controllerIdentity,
    )
    const attacker = await enrollPeer(
      service,
      tls.publicKeySpkiFingerprint,
      store.createEnrollmentToken('controller'),
      'controller',
      attackerIdentity,
    )
    const node = await enrollPeer(
      service,
      tls.publicKeySpkiFingerprint,
      store.createEnrollmentToken('node'),
      'node',
      nodeIdentity,
      controllerIdentity.publicKeyFingerprint,
    )
    const opened = await openMachineChannel(
      controller,
      node,
      nodeIdentity.publicKeyFingerprint,
    )
    const foreignBinding = channelBinding(
      opened.controllerOpened,
      attacker.ready.connectionEpoch,
    )

    for (
      let index = 0;
      index < relayProtocolLimits.maximumStaleChannelFramesPerConnection;
      index += 1
    ) {
      await attacker.channel
        .send({
          type: 'channel.data',
          ...foreignBinding,
          sequence: 1,
          data: 'AA',
        })
        .catch((error) => {
          if (
            index + 1 <
            relayProtocolLimits.maximumStaleChannelFramesPerConnection
          ) {
            throw error
          }
        })
    }
    await assert.rejects(
      attacker.channel.receive(RelayServerMessageSchema, { timeoutMs: 2_000 }),
    )
    await new Promise((resolve) => setTimeout(resolve, 20))

    assert.equal(
      service.metrics().staleChannelFrames,
      relayProtocolLimits.maximumStaleChannelFramesPerConnection,
    )
    assert.equal(service.metrics().rateLimitEvents, 1)
    assert.equal(service.metrics().authenticatedControllers, 1)
    assert.equal(service.metrics().authenticatedNodes, 1)

    const binding = channelBinding(
      opened.controllerOpened,
      controller.ready.connectionEpoch,
    )
    await controller.channel.send({
      type: 'channel.data',
      ...binding,
      sequence: 1,
      data: 'AA',
    })
    await receiveType(node.channel, 'channel.data')
    await node.channel.send({
      type: 'channel.data.ack',
      ...channelBinding(opened.nodeOpened, node.ready.connectionEpoch),
      acknowledgedSequence: 1,
    })
    await receiveType(controller.channel, 'channel.data.ack')
    await controller.channel.send({
      type: 'channel.close',
      ...binding,
      reason: 'completed',
    })
    await Promise.all([
      receiveType(controller.channel, 'channel.closed'),
      receiveType(node.channel, 'channel.closed'),
    ])

    await closePeer(node)
    await closePeer(attacker)
    await closePeer(controller)
  })
})

test('per-identity channel-open rate limiting closes only the abusive connection', async () => {
  await withService(
    async ({ store, service, tls }) => {
      const controllerIdentity = generateRelayApplicationIdentity()
      const nodeIdentity = generateRelayApplicationIdentity()
      const unknownNodeIdentity = generateRelayApplicationIdentity()
      const controller = await enrollPeer(
        service,
        tls.publicKeySpkiFingerprint,
        store.createEnrollmentToken('controller'),
        'controller',
        controllerIdentity,
      )
      const node = await enrollPeer(
        service,
        tls.publicKeySpkiFingerprint,
        store.createEnrollmentToken('node'),
        'node',
        nodeIdentity,
        controllerIdentity.publicKeyFingerprint,
      )

      for (let index = 0; index < 3; index += 1) {
        await controller.channel.send({
          type: 'channel.open',
          protocolVersion: relayProtocolVersion,
          connectionEpoch: controller.ready.connectionEpoch,
          requestId: newRelayRequestId(),
          targetNodeFingerprint: unknownNodeIdentity.publicKeyFingerprint,
          purpose: 'machine_tls_v1',
        })
        assert.equal(
          (await receiveType(controller.channel, 'channel.error')).code,
          'not_authorized',
        )
      }
      await controller.channel.send({
        type: 'channel.open',
        protocolVersion: relayProtocolVersion,
        connectionEpoch: controller.ready.connectionEpoch,
        requestId: newRelayRequestId(),
        targetNodeFingerprint: unknownNodeIdentity.publicKeyFingerprint,
        purpose: 'machine_tls_v1',
      })
      assert.equal(
        (await receiveType(controller.channel, 'relay.error')).code,
        'rate_limited',
      )
      await new Promise((resolve) => setTimeout(resolve, 20))

      assert.equal(service.metrics().channelOpenRequests, 4)
      assert.equal(service.metrics().rateLimitEvents, 1)
      assert.equal(service.metrics().authenticatedControllers, 0)
      assert.equal(service.metrics().authenticatedNodes, 1)
      assert.equal(service.metrics().activeChannels, 0)

      await closePeer(node)
      await closePeer(controller)
    },
    { maximumChannelOpenAttemptsPerMinute: 3 },
  )
})

test('capacity, open timeout, grants, replacement, and revocation clean exact ephemeral channels', async () => {
  await withService(
    async ({ store, service, tls }) => {
      const controllerIdentity = generateRelayApplicationIdentity()
      const nodeIdentity = generateRelayApplicationIdentity()
      const controller = await enrollPeer(
        service,
        tls.publicKeySpkiFingerprint,
        store.createEnrollmentToken('controller'),
        'controller',
        controllerIdentity,
      )
      let node = await enrollPeer(
        service,
        tls.publicKeySpkiFingerprint,
        store.createEnrollmentToken('node'),
        'node',
        nodeIdentity,
        controllerIdentity.publicKeyFingerprint,
      )

      const firstRequest = newRelayRequestId()
      await controller.channel.send({
        type: 'channel.open',
        protocolVersion: relayProtocolVersion,
        connectionEpoch: controller.ready.connectionEpoch,
        requestId: firstRequest,
        targetNodeFingerprint: nodeIdentity.publicKeyFingerprint,
        purpose: 'machine_tls_v1',
      })
      await receiveType(node.channel, 'channel.offer')
      const secondRequest = newRelayRequestId()
      await controller.channel.send({
        type: 'channel.open',
        protocolVersion: relayProtocolVersion,
        connectionEpoch: controller.ready.connectionEpoch,
        requestId: secondRequest,
        targetNodeFingerprint: nodeIdentity.publicKeyFingerprint,
        purpose: 'machine_tls_v1',
      })
      const capacity = await receiveType(controller.channel, 'channel.error')
      assert.equal(capacity.code, 'capacity_reached')
      assert.equal(service.metrics().activeChannels, 1)
      const [controllerTimeout, nodeTimeout] = await Promise.all([
        receiveType(controller.channel, 'channel.closed'),
        receiveType(node.channel, 'channel.closed'),
      ])
      assert.equal(controllerTimeout.reason, 'timeout')
      assert.equal(nodeTimeout.reason, 'timeout')
      assert.equal(service.metrics().activeChannels, 0)

      const grantChannel = await openMachineChannel(
        controller,
        node,
        nodeIdentity.publicKeyFingerprint,
      )
      await node.channel.send({
        type: 'grant.replace',
        protocolVersion: relayProtocolVersion,
        connectionEpoch: node.ready.connectionEpoch,
        requestId: newRelayRequestId(),
      })
      const [grantControllerClosed, grantNodeClosed] = await Promise.all([
        receiveType(controller.channel, 'channel.closed'),
        receiveType(node.channel, 'channel.closed'),
      ])
      assert.equal(grantControllerClosed.requestId, grantChannel.requestId)
      assert.equal(grantControllerClosed.reason, 'authorization_revoked')
      assert.equal(grantNodeClosed.reason, 'authorization_revoked')
      await receiveType(node.channel, 'grant.replaced')

      const replaceGrantRequest = newRelayRequestId()
      await node.channel.send({
        type: 'grant.replace',
        protocolVersion: relayProtocolVersion,
        connectionEpoch: node.ready.connectionEpoch,
        requestId: replaceGrantRequest,
        authorizedControllerFingerprint:
          controllerIdentity.publicKeyFingerprint,
      })
      await receiveType(node.channel, 'grant.replaced')
      const replacementChannel = await openMachineChannel(
        controller,
        node,
        nodeIdentity.publicKeyFingerprint,
      )
      const replacement = await authenticatePeer(
        service,
        tls.publicKeySpkiFingerprint,
        'node',
        nodeIdentity,
      )
      const replacedClosed = await receiveType(
        controller.channel,
        'channel.closed',
      )
      assert.equal(replacedClosed.requestId, replacementChannel.requestId)
      assert.equal(replacedClosed.reason, 'connection_replaced')
      await node.channel
        .send({
          type: 'grant.replace',
          protocolVersion: relayProtocolVersion,
          connectionEpoch: node.ready.connectionEpoch,
          requestId: newRelayRequestId(),
        })
        .catch(() => undefined)
      await new Promise((resolve) => setTimeout(resolve, 30))
      assert.equal(
        store.canControllerObserveNode(
          controllerIdentity.publicKeyFingerprint,
          nodeIdentity.publicKeyFingerprint,
        ),
        true,
      )
      node = replacement

      const revokedChannel = await openMachineChannel(
        controller,
        node,
        nodeIdentity.publicKeyFingerprint,
      )
      assert.equal(service.revokePeer(node.ready.peerId), true)
      const revokedClosed = await receiveType(
        controller.channel,
        'channel.closed',
      )
      assert.equal(revokedClosed.requestId, revokedChannel.requestId)
      assert.equal(revokedClosed.reason, 'authorization_revoked')
      assert.equal(service.metrics().activeChannels, 0)

      await closePeer(controller)
    },
    {
      maximumChannels: 1,
      maximumChannelsPerPeer: 1,
      channelOpenTimeoutMs: 80,
    },
  )
})

test('100 accepted channel lifecycles return all channel state and timers to bounded idle', async () => {
  await withService(async ({ store, service, tls }) => {
    const controllerIdentity = generateRelayApplicationIdentity()
    const nodeIdentity = generateRelayApplicationIdentity()
    const controller = await enrollPeer(
      service,
      tls.publicKeySpkiFingerprint,
      store.createEnrollmentToken('controller'),
      'controller',
      controllerIdentity,
    )
    const node = await enrollPeer(
      service,
      tls.publicKeySpkiFingerprint,
      store.createEnrollmentToken('node'),
      'node',
      nodeIdentity,
      controllerIdentity.publicKeyFingerprint,
    )
    for (let index = 0; index < 100; index += 1) {
      const opened = await openMachineChannel(
        controller,
        node,
        nodeIdentity.publicKeyFingerprint,
      )
      await controller.channel.send({
        type: 'channel.close',
        ...channelBinding(
          opened.controllerOpened,
          controller.ready.connectionEpoch,
        ),
        reason: 'completed',
      })
      await Promise.all([
        receiveType(controller.channel, 'channel.closed'),
        receiveType(node.channel, 'channel.closed'),
      ])
    }
    assert.equal(service.metrics().activeChannels, 0)
    assert.equal(service.metrics().openingChannels, 0)
    assert.equal(service.metrics().pendingChannelDataFrames, 0)
    assert.equal(service.metrics().channelAccepted, 100)
    assert.equal(service.metrics().channelClosed, 100)
    await closePeer(node)
    await closePeer(controller)
  })
})
