import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  MachineTransportError,
  deleteMachineTlsIdentityFile,
  generateMachineTlsIdentity,
} from '@codetether/machine-transport'

import {
  RemoteMachineRevocationPendingError,
  SecureRemoteMachineCoordinator,
} from '../dist/api/remote-machine-coordinator.js'
import { ConversationStore } from '../dist/persistence/index.js'

async function fixture(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-host-remote-'))
  const store = ConversationStore.open({
    databasePath: join(directory, 'codetether.sqlite3'),
  })
  const nodeIdentity = await generateMachineTlsIdentity('CodeTether Node')
  const machine = {
    machineId: 'machine_remote_fixture',
    nodeId: 'node_remote_fixture',
    displayName: 'Remote fixture',
    platform: 'Linux',
    architecture: 'x64',
  }
  let beginCalls = 0
  let connectCalls = 0
  let revokeCalls = 0
  const connections = []
  const transport = {
    async beginPairing(input) {
      beginCalls += 1
      if (options.beginError !== undefined) throw options.beginError
      const trustCandidate = {
        machine,
        endpoint: input.endpoint,
        nodeFingerprint: nodeIdentity.publicKeyFingerprint,
        nodeCertificatePem: nodeIdentity.certificatePem,
        protocolVersion: 1,
        controllerId: input.controller.controllerId,
      }
      return {
        pairingAttemptId:
          options.pairingAttemptId ?? `pairing_fixture_${beginCalls}`,
        machine,
        endpoint: input.endpoint,
        expiresAt: new Date(Date.now() + 60_000),
        verificationCode: '123456',
        trustCandidate,
        async confirm() {
          if (options.confirmError !== undefined) throw options.confirmError
          return trustCandidate
        },
        async cancel() {},
      }
    },
    async connectTrusted(input) {
      connectCalls += 1
      if (options.connectError !== undefined) throw options.connectError
      assert.equal(
        input.peer.nodeFingerprint,
        nodeIdentity.publicKeyFingerprint,
      )
      assert.equal(
        input.controller.tls.publicKeyFingerprint,
        input.peer.controllerId === input.controller.controllerId
          ? input.controller.tls.publicKeyFingerprint
          : 'mismatch',
      )
      const connection = {
        async ping() {},
        async revoke() {
          revokeCalls += 1
          if (options.revokeError !== undefined) {
            if (options.connectErrorAfterRevoke !== undefined) {
              options.connectError = options.connectErrorAfterRevoke
            }
            throw options.revokeError
          }
        },
        close() {},
      }
      connections.push(connection)
      return connection
    },
  }
  return {
    directory,
    store,
    transport,
    machine,
    counts: {
      get begin() {
        return beginCalls
      },
      get connect() {
        return connectCalls
      },
      get revoke() {
        return revokeCalls
      },
    },
    async close(coordinator) {
      await coordinator?.close().catch(() => undefined)
      store.close()
      await rm(directory, { recursive: true, force: true })
    },
  }
}

async function waitFor(predicate, label) {
  const deadline = Date.now() + 2_000
  while (!predicate()) {
    if (Date.now() >= deadline)
      throw new Error(`Timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

test('rejects public and loopback endpoints before transport, with explicit test-only loopback opt-in', async () => {
  const f = await fixture()
  let coordinator
  let loopbackCoordinator
  try {
    coordinator = await SecureRemoteMachineCoordinator.create({
      persistence: f.store,
      transport: f.transport,
    })
    await assert.rejects(
      coordinator.beginPairing({
        address: { host: '8.8.8.8', port: 4319 },
        pairingCode: '123456',
      }),
      /private LAN/u,
    )
    await assert.rejects(
      coordinator.beginPairing({
        address: { host: '127.0.0.1', port: 4319 },
        pairingCode: '123456',
      }),
      /private LAN/u,
    )
    assert.equal(f.counts.begin, 0)

    await coordinator.close()
    coordinator = undefined
    loopbackCoordinator = await SecureRemoteMachineCoordinator.create({
      persistence: f.store,
      transport: f.transport,
      allowLoopbackForTests: true,
    })
    const candidate = await loopbackCoordinator.beginPairing({
      address: { host: '127.0.0.1', port: 4319 },
      pairingCode: '123456',
    })
    assert.equal(candidate.verificationCode, '123 456')
    assert.equal(f.counts.begin, 1)
    await loopbackCoordinator.cancelPairing(candidate.pairingAttemptId)
    assert.deepEqual(
      (await readdir(join(f.directory, 'machine-credentials'))).filter((name) =>
        name.endsWith('.json'),
      ),
      [],
    )
  } finally {
    await loopbackCoordinator?.close().catch(() => undefined)
    await f.close(coordinator)
  }
})

test('stages before confirmation, recovers pending trust, reconnects once after restart, and unpairs with revocation first', async () => {
  const confirmationLost = new MachineTransportError(
    'connection_failed',
    'acknowledgement lost',
  )
  const f = await fixture({ confirmError: confirmationLost })
  let coordinator
  try {
    coordinator = await SecureRemoteMachineCoordinator.create({
      persistence: f.store,
      transport: f.transport,
      heartbeatIntervalMs: 1_000,
      reconnectMaximumDelayMs: 20,
    })
    const candidate = await coordinator.beginPairing({
      address: { host: '192.168.50.10', port: 4319 },
      pairingCode: '123456',
    })
    await assert.rejects(
      coordinator.confirmPairing(candidate.pairingAttemptId, (staged) => {
        f.store.createRemoteMachineWithTrust(staged.machine, staged.trust)
      }),
      /connection/u,
    )
    assert.equal(
      f.store.getTrustedMachinePeer(f.machine.machineId)?.trustState,
      'pending',
    )
    await waitFor(
      () =>
        f.store.getTrustedMachinePeer(f.machine.machineId)?.trustState ===
          'active' &&
        coordinator.connectionState(f.machine.machineId) === 'online',
      'pending trust recovery',
    )
    assert.equal(
      f.store.listMachines().filter((entry) => entry.kind === 'remote').length,
      1,
    )

    await coordinator.close()
    coordinator = await SecureRemoteMachineCoordinator.create({
      persistence: f.store,
      transport: f.transport,
      heartbeatIntervalMs: 1_000,
      reconnectMaximumDelayMs: 20,
    })
    await waitFor(
      () => coordinator.connectionState(f.machine.machineId) === 'online',
      'restart reconnect',
    )
    assert.equal(
      f.store.listMachines().filter((entry) => entry.kind === 'remote').length,
      1,
    )

    const machine = f.store.getMachine(f.machine.machineId)
    const trust = f.store.markTrustedMachinePeerRevoking(
      f.machine.machineId,
      new Date().toISOString(),
    )
    const connectsBeforeUnpair = f.counts.connect
    await coordinator.unpair(machine, trust)
    assert.equal(f.counts.connect, connectsBeforeUnpair + 1)
    assert.equal(f.counts.revoke, 1)
    assert.equal(f.store.deleteRemoteMachine(f.machine.machineId), true)
    assert.equal(f.store.getMachine(f.machine.machineId), undefined)
  } finally {
    await f.close(coordinator)
  }
})

test('rejects a duplicate live pairing attempt without replacing the original', async () => {
  const f = await fixture({ pairingAttemptId: 'pairing_duplicate_fixture' })
  let coordinator
  try {
    coordinator = await SecureRemoteMachineCoordinator.create({
      persistence: f.store,
      transport: f.transport,
    })
    const first = await coordinator.beginPairing({
      address: { host: '10.1.2.3', port: 4319 },
      pairingCode: '123456',
    })
    await assert.rejects(
      coordinator.beginPairing({
        address: { host: '10.1.2.4', port: 4319 },
        pairingCode: '123456',
      }),
      /reused/u,
    )
    await coordinator.cancelPairing(first.pairingAttemptId)
    assert.equal(f.counts.begin, 2)
  } finally {
    await f.close(coordinator)
  }
})

test('maps disabled pairing mode to an expired pairing error', async () => {
  const f = await fixture({
    beginError: new MachineTransportError(
      'pairing_disabled',
      'pairing disabled',
    ),
  })
  let coordinator
  try {
    coordinator = await SecureRemoteMachineCoordinator.create({
      persistence: f.store,
      transport: f.transport,
    })
    await assert.rejects(
      coordinator.beginPairing({
        address: { host: '192.168.1.8', port: 4319 },
        pairingCode: '123456',
      }),
      (error) => error.code === 'pairing_code_expired',
    )
  } finally {
    await f.close(coordinator)
  }
})

test('wrong pinned identity becomes a terminal authentication state without reconnect storm', async () => {
  const good = await fixture()
  let coordinator
  try {
    coordinator = await SecureRemoteMachineCoordinator.create({
      persistence: good.store,
      transport: good.transport,
      heartbeatIntervalMs: 1_000,
      reconnectMaximumDelayMs: 10,
    })
    const candidate = await coordinator.beginPairing({
      address: { host: '10.20.30.40', port: 4319 },
      pairingCode: '123456',
    })
    const confirmed = await coordinator.confirmPairing(
      candidate.pairingAttemptId,
      (staged) =>
        good.store.createRemoteMachineWithTrust(staged.machine, staged.trust),
    )
    good.store.activateTrustedMachinePeer(
      confirmed.machine.machineId,
      new Date().toISOString(),
    )
    await coordinator.close()

    let attempts = 0
    coordinator = await SecureRemoteMachineCoordinator.create({
      persistence: good.store,
      transport: {
        ...good.transport,
        async connectTrusted() {
          attempts += 1
          throw new MachineTransportError('identity_mismatch', 'wrong identity')
        },
      },
      reconnectMaximumDelayMs: 10,
    })
    await waitFor(
      () =>
        coordinator.connectionState(good.machine.machineId) ===
        'authentication_failed',
      'terminal identity state',
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(attempts, 1)
    assert.equal(
      good.store.getTrustedMachinePeer(good.machine.machineId)?.trustState,
      'active',
    )
  } finally {
    await good.close(coordinator)
  }
})

test('startup deterministically finishes a durable revoking record', async () => {
  const f = await fixture()
  let coordinator
  try {
    coordinator = await SecureRemoteMachineCoordinator.create({
      persistence: f.store,
      transport: f.transport,
    })
    const candidate = await coordinator.beginPairing({
      address: { host: '172.20.1.5', port: 4319 },
      pairingCode: '123456',
    })
    const confirmed = await coordinator.confirmPairing(
      candidate.pairingAttemptId,
      (staged) =>
        f.store.createRemoteMachineWithTrust(staged.machine, staged.trust),
    )
    f.store.activateTrustedMachinePeer(
      confirmed.machine.machineId,
      new Date().toISOString(),
    )
    await coordinator.close()
    coordinator = undefined
    f.store.markTrustedMachinePeerRevoking(
      confirmed.machine.machineId,
      new Date().toISOString(),
    )

    coordinator = await SecureRemoteMachineCoordinator.create({
      persistence: f.store,
      transport: f.transport,
    })
    await waitFor(
      () => f.store.getMachine(confirmed.machine.machineId) === undefined,
      'durable revocation recovery',
    )
    assert.ok(f.counts.revoke >= 1)
  } finally {
    await f.close(coordinator)
  }
})

test('lost revoke acknowledgement never restores an already-revoked peer to active trust', async () => {
  const options = {}
  const f = await fixture(options)
  let coordinator
  try {
    coordinator = await SecureRemoteMachineCoordinator.create({
      persistence: f.store,
      transport: f.transport,
      reconnectMaximumDelayMs: 10,
    })
    const candidate = await coordinator.beginPairing({
      address: { host: '172.20.1.6', port: 4319 },
      pairingCode: '123456',
    })
    const confirmed = await coordinator.confirmPairing(
      candidate.pairingAttemptId,
      (staged) =>
        f.store.createRemoteMachineWithTrust(staged.machine, staged.trust),
    )
    f.store.activateTrustedMachinePeer(
      confirmed.machine.machineId,
      new Date().toISOString(),
    )
    await coordinator.close()
    coordinator = undefined
    f.store.markTrustedMachinePeerRevoking(
      confirmed.machine.machineId,
      new Date().toISOString(),
    )

    options.connectError = new MachineTransportError(
      'authentication_failed',
      'the Node already committed the revocation',
    )
    coordinator = await SecureRemoteMachineCoordinator.create({
      persistence: f.store,
      transport: f.transport,
      reconnectMaximumDelayMs: 10,
    })
    await waitFor(
      () => f.store.getMachine(confirmed.machine.machineId) === undefined,
      'local revocation recovery',
    )
    assert.equal(
      f.store.getTrustedMachinePeer(confirmed.machine.machineId),
      undefined,
    )
  } finally {
    await f.close(coordinator)
  }
})

test('a revoke acknowledgement lost during the live operation becomes irreversible cleanup', async () => {
  const options = {}
  const f = await fixture(options)
  let coordinator
  try {
    coordinator = await SecureRemoteMachineCoordinator.create({
      persistence: f.store,
      transport: f.transport,
      reconnectMaximumDelayMs: 10,
    })
    const candidate = await coordinator.beginPairing({
      address: { host: '172.20.1.8', port: 4319 },
      pairingCode: '123456',
    })
    const confirmed = await coordinator.confirmPairing(
      candidate.pairingAttemptId,
      (staged) =>
        f.store.createRemoteMachineWithTrust(staged.machine, staged.trust),
    )
    f.store.activateTrustedMachinePeer(
      confirmed.machine.machineId,
      new Date().toISOString(),
    )
    const trust = f.store.markTrustedMachinePeerRevoking(
      confirmed.machine.machineId,
      new Date().toISOString(),
    )
    options.revokeError = new MachineTransportError(
      'connection_failed',
      'revocation acknowledgement was lost',
    )
    options.connectErrorAfterRevoke = new MachineTransportError(
      'authentication_failed',
      'the Node already removed controller trust',
    )

    await assert.rejects(
      coordinator.unpair(confirmed.machine, trust),
      (error) => error instanceof RemoteMachineRevocationPendingError,
    )
    await waitFor(
      () => f.store.getMachine(confirmed.machine.machineId) === undefined,
      'live lost-ack revocation cleanup',
    )
    assert.equal(
      f.store.getTrustedMachinePeer(confirmed.machine.machineId),
      undefined,
    )
  } finally {
    await f.close(coordinator)
  }
})

test('credential deletion failure keeps revocation durable until bounded cleanup succeeds', async () => {
  const f = await fixture()
  let coordinator
  let blockCredentialDeletion = true
  try {
    coordinator = await SecureRemoteMachineCoordinator.create({
      persistence: f.store,
      transport: f.transport,
      reconnectMaximumDelayMs: 10,
      deleteCredentialFile: async (path) => {
        if (blockCredentialDeletion) {
          const error = new Error('controlled credential unlink failure')
          error.code = 'EACCES'
          throw error
        }
        await deleteMachineTlsIdentityFile(path)
      },
    })
    const candidate = await coordinator.beginPairing({
      address: { host: '172.20.1.7', port: 4319 },
      pairingCode: '123456',
    })
    const confirmed = await coordinator.confirmPairing(
      candidate.pairingAttemptId,
      (staged) =>
        f.store.createRemoteMachineWithTrust(staged.machine, staged.trust),
    )
    f.store.activateTrustedMachinePeer(
      confirmed.machine.machineId,
      new Date().toISOString(),
    )
    const trust = f.store.markTrustedMachinePeerRevoking(
      confirmed.machine.machineId,
      new Date().toISOString(),
    )
    const removed = new Promise((resolve) =>
      coordinator.subscribeRemoval((machineId) => resolve(machineId)),
    )

    await assert.rejects(
      coordinator.unpair(confirmed.machine, trust),
      (error) => error instanceof RemoteMachineRevocationPendingError,
    )
    assert.equal(
      f.store.getTrustedMachinePeer(confirmed.machine.machineId)?.trustState,
      'revoking',
    )
    assert.ok(f.store.getMachine(confirmed.machine.machineId))

    blockCredentialDeletion = false
    assert.equal(await removed, confirmed.machine.machineId)
    assert.equal(f.store.getMachine(confirmed.machine.machineId), undefined)
    assert.equal(
      f.store.getTrustedMachinePeer(confirmed.machine.machineId),
      undefined,
    )
  } finally {
    await f.close(coordinator)
  }
})
