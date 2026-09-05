import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'

import { newControllerId } from '@codetether/machine-transport'
import { RelayClientError } from '@codetether/relay-client'

import { NodeRelayManager } from '../dist/node-relay-manager.js'
import { CodeTetherNodeService } from '../dist/node-service.js'
import {
  NODE_RELAY_ENROLLMENT_TOKEN_FILE,
  NODE_RELAY_PENDING_ENROLLMENT_TOKEN_FILE,
  NODE_RELAY_REGISTRATION_FILE,
  readNodeRelayEnrollmentToken,
  readNodeRelayRegistration,
  writeNodeRelayRegistration,
} from '../dist/relay-state.js'
import { NodeStateStore } from '../dist/state-store.js'

const relayFingerprint = 'R'.repeat(43)
const controllerFingerprint = 'C'.repeat(43)
const token = `relay_enroll_${'T'.repeat(43)}`

function configuration() {
  return {
    schemaVersion: 1,
    enabled: true,
    endpoint: { host: 'relay.example.test', port: 443 },
    relayIdentityFingerprint: relayFingerprint,
    tls: { mode: 'public_ca', serverName: 'relay.example.test' },
  }
}

function registration() {
  return {
    relayId: 'relay_abcdef',
    relayIdentityFingerprint: relayFingerprint,
    peerId: 'relay_peer_abcdef',
    authenticatedAt: '2026-09-03T12:00:00.000Z',
  }
}

class FakeRelayConnection {
  grants = []
  closed = false
  machineChannelHandler
  #resolve
  #reject
  #lifetime = new Promise((resolve, reject) => {
    this.#resolve = resolve
    this.#reject = reject
  })

  async replaceAuthorizedController(fingerprint) {
    if (this.closed) throw new Error('closed')
    this.grants.push(fingerprint)
  }

  async waitUntilClosed() {
    await this.#lifetime
  }

  setMachineChannelHandler(handler) {
    assert.equal(this.machineChannelHandler, undefined)
    this.machineChannelHandler = handler
    let removed = false
    return () => {
      if (removed) return
      removed = true
      if (this.machineChannelHandler === handler) {
        this.machineChannelHandler = undefined
      }
    }
  }

  async offerMachineChannel(offer) {
    assert.notEqual(this.machineChannelHandler, undefined)
    await this.machineChannelHandler(offer)
  }

  disconnect() {
    this.#reject(
      new RelayClientError(
        'relay_unreachable',
        'Internet Relay is unreachable',
      ),
    )
  }

  async close() {
    if (this.closed) return
    this.closed = true
    this.#resolve()
  }
}

class DeferredGrantRelayConnection extends FakeRelayConnection {
  activeGrants = 0
  maximumActiveGrants = 0
  #grantReleases = []

  async replaceAuthorizedController(fingerprint) {
    if (this.closed) throw new Error('closed')
    this.grants.push(fingerprint)
    this.activeGrants += 1
    this.maximumActiveGrants = Math.max(
      this.maximumActiveGrants,
      this.activeGrants,
    )
    await new Promise((resolve) => this.#grantReleases.push(resolve))
    this.activeGrants -= 1
  }

  releaseGrant() {
    const release = this.#grantReleases.shift()
    assert.notEqual(release, undefined)
    release()
  }
}

async function openNodeState(directory) {
  return await NodeStateStore.open({
    dataDirectory: directory,
    displayName: 'Relay Node fixture',
    platform: 'Linux',
    architecture: 'x64',
  })
}

async function waitFor(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('condition timed out')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function machineChannelOffer(controllerFingerprintValue, acceptGate) {
  const stream = new PassThrough()
  const state = {
    accepts: 0,
    rejections: [],
  }
  return {
    stream,
    get accepts() {
      return state.accepts
    },
    get rejections() {
      return state.rejections
    },
    offer: {
      controllerFingerprint: controllerFingerprintValue,
      controllerConnectionEpoch: 'relay_conn_controller_fixture',
      nodeConnectionEpoch: 'relay_conn_node_fixture',
      async accept() {
        state.accepts += 1
        await acceptGate
        return stream
      },
      async reject(reason = 'not_available') {
        state.rejections.push(reason)
      },
    },
  }
}

test('Node Relay manager recovers unknown enrollment, consumes one-use token, and owns one worker', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-node-relay-'))
  const state = await openNodeState(directory)
  t.after(async () => {
    await state.close().catch(() => undefined)
    await import('node:fs/promises').then(async ({ rm }) =>
      rm(directory, { recursive: true, force: true }),
    )
  })
  await state.trustController({
    controllerId: newControllerId(),
    publicKeyFingerprint: controllerFingerprint,
    pairedAt: new Date().toISOString(),
  })
  await writeFile(
    join(directory, NODE_RELAY_ENROLLMENT_TOKEN_FILE),
    `${token}\n`,
    { mode: 0o600 },
  )
  const calls = []
  const connection = new FakeRelayConnection()
  const statuses = []
  const manager = new NodeRelayManager({
    state,
    configuration: configuration(),
    clientBuildIdentity: 'git-cb2c412def81',
    reconnectInitialDelayMs: 1,
    reconnectMaximumDelayMs: 2,
    random: () => 0.5,
    onStatus: (status) => statuses.push(status),
    connect: async (options) => {
      calls.push(options)
      if (calls.length === 1) {
        throw new RelayClientError(
          'relay_authentication_failed',
          'Internet Relay authentication failed',
        )
      }
      return {
        connection,
        registration: registration(),
        enrolled: true,
      }
    },
  })
  for (let index = 0; index < 20; index += 1) manager.start()
  await waitFor(() => manager.status === 'connected')
  assert.equal(manager.workerActive, true)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].enrollmentToken, undefined)
  assert.equal(calls[1].enrollmentToken, token)
  assert.equal(
    calls[1].identity.publicKeyFingerprint,
    state.identity.publicKeyFingerprint,
  )
  assert.equal(calls[1].authorizedControllerFingerprint, controllerFingerprint)
  assert.deepEqual(connection.grants, [controllerFingerprint])
  assert.equal(
    statuses.some(({ status }) => status === 'connected'),
    true,
  )
  await assert.rejects(
    access(join(directory, NODE_RELAY_ENROLLMENT_TOKEN_FILE)),
  )
  assert.deepEqual(await readNodeRelayRegistration(directory), {
    schemaVersion: 1,
    relayId: registration().relayId,
    relayIdentityFingerprint: registration().relayIdentityFingerprint,
    peerId: registration().peerId,
    observedAt: registration().authenticatedAt,
  })
  await manager.close()
  assert.equal(manager.workerActive, false)
})

test('Node Relay manager recovers a lost enrollment response by identity before token replay', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-node-relay-loss-'))
  const state = await openNodeState(directory)
  t.after(async () => {
    await state.close().catch(() => undefined)
    await import('node:fs/promises').then(async ({ rm }) =>
      rm(directory, { recursive: true, force: true }),
    )
  })
  await writeFile(
    join(directory, NODE_RELAY_ENROLLMENT_TOKEN_FILE),
    `${token}\n`,
    { mode: 0o600 },
  )
  const calls = []
  const connection = new FakeRelayConnection()
  const manager = new NodeRelayManager({
    state,
    configuration: configuration(),
    clientBuildIdentity: 'git-cb2c412def81',
    reconnectInitialDelayMs: 1,
    reconnectMaximumDelayMs: 2,
    random: () => 0.5,
    connect: async (options) => {
      calls.push(options)
      if (calls.length === 1) {
        throw new RelayClientError(
          'relay_authentication_failed',
          'Internet Relay authentication failed',
        )
      }
      if (calls.length === 2) {
        assert.equal(options.enrollmentToken, token)
        throw new RelayClientError(
          'relay_unreachable',
          'Internet Relay is unreachable',
        )
      }
      assert.equal(options.enrollmentToken, undefined)
      return {
        connection,
        registration: registration(),
        enrolled: false,
      }
    },
  })
  manager.start()
  await waitFor(() => manager.status === 'connected')
  assert.equal(calls.length, 3)
  await assert.rejects(
    access(join(directory, NODE_RELAY_ENROLLMENT_TOKEN_FILE)),
  )
  assert.notEqual(await readNodeRelayRegistration(directory), undefined)
  await manager.close()
})

test('revoked Node reconnect stays denied until a fresh token explicitly re-enrolls the same durable identity', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'codetether-node-relay-reenrollment-'),
  )
  const state = await openNodeState(directory)
  t.after(async () => {
    await state.close().catch(() => undefined)
    await import('node:fs/promises').then(async ({ rm }) =>
      rm(directory, { recursive: true, force: true }),
    )
  })
  await state.trustController({
    controllerId: newControllerId(),
    publicKeyFingerprint: controllerFingerprint,
    pairedAt: new Date().toISOString(),
  })
  const trustBefore = state.trustedController()
  await writeNodeRelayRegistration(directory, {
    schemaVersion: 1,
    relayId: registration().relayId,
    relayIdentityFingerprint: registration().relayIdentityFingerprint,
    peerId: registration().peerId,
    observedAt: registration().authenticatedAt,
  })
  await writeFile(
    join(directory, NODE_RELAY_ENROLLMENT_TOKEN_FILE),
    `${token}\n`,
    { mode: 0o600 },
  )
  const calls = []
  const connection = new FakeRelayConnection()
  const manager = new NodeRelayManager({
    state,
    configuration: configuration(),
    clientBuildIdentity: 'git-cb2c412def81',
    connect: async (options) => {
      calls.push(options)
      if (calls.length === 1) {
        throw new RelayClientError(
          'relay_revoked',
          'Internet Relay enrollment was revoked',
        )
      }
      return {
        connection,
        registration: registration(),
        enrolled: true,
      }
    },
  })

  manager.start()
  await waitFor(() => manager.status === 'connected')
  assert.equal(calls.length, 2)
  assert.equal(calls[0].enrollmentToken, undefined)
  assert.equal(calls[1].enrollmentToken, token)
  assert.equal(
    calls[1].identity.publicKeyFingerprint,
    state.identity.publicKeyFingerprint,
  )
  assert.equal(calls[1].expectedRelayId, registration().relayId)
  assert.deepEqual(state.trustedController(), trustBefore)
  await assert.rejects(
    access(join(directory, NODE_RELAY_ENROLLMENT_TOKEN_FILE)),
  )
  await assert.rejects(
    access(join(directory, NODE_RELAY_PENDING_ENROLLMENT_TOKEN_FILE)),
  )
  await manager.close()
})

test('revoked Node without a fresh token remains revoked and does not reconnect', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'codetether-node-relay-revoked-'),
  )
  const state = await openNodeState(directory)
  t.after(async () => {
    await state.close().catch(() => undefined)
    await import('node:fs/promises').then(async ({ rm }) =>
      rm(directory, { recursive: true, force: true }),
    )
  })
  await writeNodeRelayRegistration(directory, {
    schemaVersion: 1,
    relayId: registration().relayId,
    relayIdentityFingerprint: registration().relayIdentityFingerprint,
    peerId: registration().peerId,
    observedAt: registration().authenticatedAt,
  })
  let calls = 0
  const manager = new NodeRelayManager({
    state,
    configuration: configuration(),
    clientBuildIdentity: 'git-cb2c412def81',
    connect: async () => {
      calls += 1
      throw new RelayClientError(
        'relay_revoked',
        'Internet Relay enrollment was revoked',
      )
    },
  })

  manager.start()
  await waitFor(() => manager.status === 'revoked' && !manager.workerActive)
  assert.equal(calls, 1)
  await manager.close()
})

test('Node restart clears only its exact previously claimed enrollment input after identity recovery', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'codetether-node-relay-enrollment-restart-'),
  )
  const state = await openNodeState(directory)
  t.after(async () => {
    await state.close().catch(() => undefined)
    await import('node:fs/promises').then(async ({ rm }) =>
      rm(directory, { recursive: true, force: true }),
    )
  })
  const replacement = `relay_enroll_${'N'.repeat(43)}`
  await writeFile(
    join(directory, NODE_RELAY_ENROLLMENT_TOKEN_FILE),
    `${token}\n`,
    { mode: 0o600 },
  )
  await readNodeRelayEnrollmentToken(directory)
  await writeFile(
    join(directory, NODE_RELAY_ENROLLMENT_TOKEN_FILE),
    `${replacement}\n`,
    { mode: 0o600 },
  )
  const connection = new FakeRelayConnection()
  const manager = new NodeRelayManager({
    state,
    configuration: configuration(),
    clientBuildIdentity: 'git-cb2c412def81',
    connect: async (options) => {
      assert.equal(options.enrollmentToken, undefined)
      return {
        connection,
        registration: registration(),
        enrolled: false,
      }
    },
  })
  manager.start()
  await waitFor(() => manager.status === 'connected')
  await assert.rejects(
    access(join(directory, NODE_RELAY_PENDING_ENROLLMENT_TOKEN_FILE)),
  )
  assert.equal(
    (
      await readFile(join(directory, NODE_RELAY_ENROLLMENT_TOKEN_FILE), 'utf8')
    ).trim(),
    replacement,
  )
  await manager.close()
})

test('accepted Relay connection is closed when registration persistence fails', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'codetether-node-relay-registration-failure-'),
  )
  const state = await openNodeState(directory)
  t.after(async () => {
    await state.close().catch(() => undefined)
    await import('node:fs/promises').then(async ({ rm }) =>
      rm(directory, { recursive: true, force: true }),
    )
  })
  await writeFile(
    join(directory, NODE_RELAY_ENROLLMENT_TOKEN_FILE),
    `${token}\n`,
    { mode: 0o600 },
  )
  const accepted = new FakeRelayConnection()
  let calls = 0
  const manager = new NodeRelayManager({
    state,
    configuration: configuration(),
    clientBuildIdentity: 'git-cb2c412def81',
    reconnectInitialDelayMs: 10_000,
    reconnectMaximumDelayMs: 10_000,
    connect: async () => {
      calls += 1
      if (calls === 1) {
        throw new RelayClientError(
          'relay_authentication_failed',
          'Internet Relay authentication failed',
        )
      }
      return {
        connection: accepted,
        registration: registration(),
        enrolled: true,
      }
    },
    writeRegistration: async () => {
      throw new Error('simulated durable registration failure')
    },
  })
  t.after(async () => manager.close())
  manager.start()
  await waitFor(() => accepted.closed)
  assert.equal(calls, 2)
  assert.equal(manager.status, 'offline')
  await manager.close()
})

test('restart after shutdown between durable registration and token cleanup removes only the claimed token', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'codetether-node-relay-registration-close-race-'),
  )
  const state = await openNodeState(directory)
  t.after(async () => {
    await state.close().catch(() => undefined)
    await import('node:fs/promises').then(async ({ rm }) =>
      rm(directory, { recursive: true, force: true }),
    )
  })
  await writeFile(
    join(directory, NODE_RELAY_ENROLLMENT_TOKEN_FILE),
    `${token}\n`,
    { mode: 0o600 },
  )
  const accepted = new FakeRelayConnection()
  let releaseRegistration
  const registrationRelease = new Promise((resolve) => {
    releaseRegistration = resolve
  })
  let registrationStarted
  const registrationStart = new Promise((resolve) => {
    registrationStarted = resolve
  })
  let calls = 0
  const manager = new NodeRelayManager({
    state,
    configuration: configuration(),
    clientBuildIdentity: 'git-cb2c412def81',
    connect: async () => {
      calls += 1
      if (calls === 1) {
        throw new RelayClientError(
          'relay_authentication_failed',
          'Internet Relay authentication failed',
        )
      }
      return {
        connection: accepted,
        registration: registration(),
        enrolled: true,
      }
    },
    writeRegistration: async (dataDirectory, nextRegistration) => {
      await writeNodeRelayRegistration(dataDirectory, nextRegistration)
      registrationStarted()
      await registrationRelease
    },
  })

  manager.start()
  await registrationStart
  const closeTask = manager.close()
  assert.equal(accepted.closed, false)
  releaseRegistration()
  await closeTask
  assert.equal(accepted.closed, true)
  assert.equal(manager.workerActive, false)
  assert.equal(manager.status, 'closed')
  assert.deepEqual(await readNodeRelayRegistration(directory), {
    schemaVersion: 1,
    relayId: registration().relayId,
    relayIdentityFingerprint: registration().relayIdentityFingerprint,
    peerId: registration().peerId,
    observedAt: registration().authenticatedAt,
  })
  await assert.rejects(
    access(join(directory, NODE_RELAY_ENROLLMENT_TOKEN_FILE)),
  )
  assert.equal(
    (
      await readFile(
        join(directory, NODE_RELAY_PENDING_ENROLLMENT_TOKEN_FILE),
        'utf8',
      )
    ).trim(),
    token,
  )

  const recovered = new FakeRelayConnection()
  const restarted = new NodeRelayManager({
    state,
    configuration: configuration(),
    clientBuildIdentity: 'git-cb2c412def81',
    connect: async (options) => {
      assert.equal(options.enrollmentToken, undefined)
      return {
        connection: recovered,
        registration: registration(),
        enrolled: false,
      }
    },
  })
  restarted.start()
  await waitFor(() => restarted.status === 'connected')
  await assert.rejects(
    access(join(directory, NODE_RELAY_PENDING_ENROLLMENT_TOKEN_FILE)),
  )
  await restarted.close()
  assert.equal(recovered.closed, true)
})

test('definitively rejected enrollment stops without replay and clears only claimed input', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'codetether-node-relay-enrollment-rejected-'),
  )
  const state = await openNodeState(directory)
  t.after(async () => {
    await state.close().catch(() => undefined)
    await import('node:fs/promises').then(async ({ rm }) =>
      rm(directory, { recursive: true, force: true }),
    )
  })
  await writeFile(
    join(directory, NODE_RELAY_ENROLLMENT_TOKEN_FILE),
    `${token}\n`,
    { mode: 0o600 },
  )
  let calls = 0
  const manager = new NodeRelayManager({
    state,
    configuration: configuration(),
    clientBuildIdentity: 'git-cb2c412def81',
    reconnectInitialDelayMs: 1,
    reconnectMaximumDelayMs: 2,
    connect: async () => {
      calls += 1
      throw new RelayClientError(
        calls === 1
          ? 'relay_authentication_failed'
          : 'relay_enrollment_required',
        'controlled test failure',
      )
    },
  })
  manager.start()
  await waitFor(
    () => manager.status === 'enrollment_required' && !manager.workerActive,
  )
  assert.equal(calls, 2)
  await assert.rejects(
    access(join(directory, NODE_RELAY_PENDING_ENROLLMENT_TOKEN_FILE)),
  )
  await assert.rejects(
    access(join(directory, NODE_RELAY_ENROLLMENT_TOKEN_FILE)),
  )
  await manager.close()
})

test('Machine unpair removes only the Relay rendezvous grant, not Relay enrollment', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'codetether-node-relay-unpair-'),
  )
  const state = await openNodeState(directory)
  t.after(async () => {
    await state.close().catch(() => undefined)
    await import('node:fs/promises').then(async ({ rm }) =>
      rm(directory, { recursive: true, force: true }),
    )
  })
  const controllerId = newControllerId()
  await state.trustController({
    controllerId,
    publicKeyFingerprint: controllerFingerprint,
    pairedAt: new Date().toISOString(),
  })
  const connection = new FakeRelayConnection()
  const manager = new NodeRelayManager({
    state,
    configuration: configuration(),
    clientBuildIdentity: 'git-cb2c412def81',
    connect: async () => ({
      connection,
      registration: registration(),
      enrolled: false,
    }),
  })
  await writeNodeRelayRegistration(directory, {
    schemaVersion: 1,
    relayId: registration().relayId,
    relayIdentityFingerprint: registration().relayIdentityFingerprint,
    peerId: registration().peerId,
    observedAt: registration().authenticatedAt,
  })
  manager.start()
  await waitFor(() => manager.status === 'connected')
  assert.deepEqual(connection.grants, [controllerFingerprint])
  await state.revokeController(controllerId)
  manager.synchronizeMachineTrust()
  await waitFor(() => connection.grants.length === 2)
  assert.deepEqual(connection.grants, [controllerFingerprint, undefined])
  assert.equal(
    await access(join(directory, NODE_RELAY_REGISTRATION_FILE)).then(
      () => true,
      () => false,
    ),
    true,
  )
  await manager.close()
})

test('Relay Machine offers require the exact paired Controller and unpair closes accepted channels', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'codetether-node-relay-machine-channel-'),
  )
  const state = await openNodeState(directory)
  t.after(async () => {
    await state.close().catch(() => undefined)
    await import('node:fs/promises').then(async ({ rm }) =>
      rm(directory, { recursive: true, force: true }),
    )
  })
  const controllerId = newControllerId()
  await state.trustController({
    controllerId,
    publicKeyFingerprint: controllerFingerprint,
    pairedAt: new Date().toISOString(),
  })
  await writeNodeRelayRegistration(directory, {
    schemaVersion: 1,
    relayId: registration().relayId,
    relayIdentityFingerprint: registration().relayIdentityFingerprint,
    peerId: registration().peerId,
    observedAt: registration().authenticatedAt,
  })
  const connection = new FakeRelayConnection()
  const manager = new NodeRelayManager({
    state,
    configuration: configuration(),
    clientBuildIdentity: 'git-cb2c412def81',
    connect: async () => ({
      connection,
      registration: registration(),
      enrolled: false,
    }),
  })
  const handled = []
  manager.setMachineChannelHandler((channel) => handled.push(channel))
  manager.start()
  await waitFor(() => manager.status === 'connected')

  const unexpected = machineChannelOffer('U'.repeat(43))
  await connection.offerMachineChannel(unexpected.offer)
  assert.equal(unexpected.accepts, 0)
  assert.deepEqual(unexpected.rejections, ['not_available'])
  assert.equal(handled.length, 0)

  const expected = machineChannelOffer(controllerFingerprint)
  await connection.offerMachineChannel(expected.offer)
  assert.equal(expected.accepts, 1)
  assert.deepEqual(expected.rejections, [])
  assert.equal(handled.length, 1)
  assert.equal(handled[0].stream, expected.stream)
  assert.equal(handled[0].controllerFingerprint, controllerFingerprint)
  assert.equal(manager.activeMachineChannelCount, 1)

  await state.revokeController(controllerId)
  manager.synchronizeMachineTrust()
  await waitFor(() => expected.stream.destroyed)
  await waitFor(() => manager.activeMachineChannelCount === 0)
  assert.equal(
    await access(join(directory, NODE_RELAY_REGISTRATION_FILE)).then(
      () => true,
      () => false,
    ),
    true,
  )
  await manager.close()
})

test('Node recovery rejects a Machine offer from the invalidated Relay generation', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'codetether-node-relay-stale-offer-'),
  )
  const state = await openNodeState(directory)
  t.after(async () => {
    await state.close().catch(() => undefined)
    await import('node:fs/promises').then(async ({ rm }) =>
      rm(directory, { recursive: true, force: true }),
    )
  })
  await state.trustController({
    controllerId: newControllerId(),
    publicKeyFingerprint: controllerFingerprint,
    pairedAt: new Date().toISOString(),
  })
  await writeNodeRelayRegistration(directory, {
    schemaVersion: 1,
    relayId: registration().relayId,
    relayIdentityFingerprint: registration().relayIdentityFingerprint,
    peerId: registration().peerId,
    observedAt: registration().authenticatedAt,
  })
  const connections = [new FakeRelayConnection(), new FakeRelayConnection()]
  let connectIndex = 0
  const manager = new NodeRelayManager({
    state,
    configuration: configuration(),
    clientBuildIdentity: 'phase7d-test',
    reconnectInitialDelayMs: 60_000,
    reconnectMaximumDelayMs: 60_000,
    random: () => 0.5,
    connect: async () => ({
      connection: connections[connectIndex++],
      registration: registration(),
      enrolled: false,
    }),
  })
  const handled = []
  manager.setMachineChannelHandler((channel) => handled.push(channel))
  manager.start()
  await waitFor(() => manager.status === 'connected')

  let releaseAccept
  const acceptGate = new Promise((resolve) => {
    releaseAccept = resolve
  })
  const stale = machineChannelOffer(controllerFingerprint, acceptGate)
  const handling = connections[0].offerMachineChannel(stale.offer)
  await waitFor(() => stale.accepts === 1)
  assert.equal(manager.requestReconnect(), true)
  assert.equal(manager.status, 'reconnecting')
  releaseAccept()
  await handling

  assert.equal(stale.stream.destroyed, true)
  assert.equal(handled.length, 0)
  await waitFor(() => connectIndex === 2 && manager.status === 'connected')
  await manager.close()
})

test('Relay reconnect replacement and manager close destroy their exact Machine channels', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'codetether-node-relay-channel-reconnect-'),
  )
  const state = await openNodeState(directory)
  t.after(async () => {
    await state.close().catch(() => undefined)
    await import('node:fs/promises').then(async ({ rm }) =>
      rm(directory, { recursive: true, force: true }),
    )
  })
  await state.trustController({
    controllerId: newControllerId(),
    publicKeyFingerprint: controllerFingerprint,
    pairedAt: new Date().toISOString(),
  })
  await writeNodeRelayRegistration(directory, {
    schemaVersion: 1,
    relayId: registration().relayId,
    relayIdentityFingerprint: registration().relayIdentityFingerprint,
    peerId: registration().peerId,
    observedAt: registration().authenticatedAt,
  })
  const connections = [new FakeRelayConnection(), new FakeRelayConnection()]
  let connectIndex = 0
  const manager = new NodeRelayManager({
    state,
    configuration: configuration(),
    clientBuildIdentity: 'git-cb2c412def81',
    reconnectInitialDelayMs: 1,
    reconnectMaximumDelayMs: 2,
    random: () => 0.5,
    connect: async () => ({
      connection: connections[connectIndex++],
      registration: registration(),
      enrolled: false,
    }),
  })
  manager.setMachineChannelHandler(() => undefined)
  manager.start()
  await waitFor(() => manager.status === 'connected')
  const first = machineChannelOffer(controllerFingerprint)
  await connections[0].offerMachineChannel(first.offer)
  assert.equal(manager.activeMachineChannelCount, 1)
  connections[0].disconnect()
  await waitFor(() => connectIndex === 2 && manager.status === 'connected')
  await waitFor(() => first.stream.destroyed)
  assert.equal(connections[0].machineChannelHandler, undefined)

  const second = machineChannelOffer(controllerFingerprint)
  await connections[1].offerMachineChannel(second.offer)
  assert.equal(manager.activeMachineChannelCount, 1)
  await manager.close()
  await waitFor(() => second.stream.destroyed)
  assert.equal(manager.activeMachineChannelCount, 0)
  assert.equal(connections[1].machineChannelHandler, undefined)
})

test('rapid Machine trust notifications coalesce behind one bounded grant writer', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'codetether-node-relay-grant-coalesce-'),
  )
  const state = await openNodeState(directory)
  t.after(async () => {
    await state.close().catch(() => undefined)
    await import('node:fs/promises').then(async ({ rm }) =>
      rm(directory, { recursive: true, force: true }),
    )
  })
  await state.trustController({
    controllerId: newControllerId(),
    publicKeyFingerprint: controllerFingerprint,
    pairedAt: new Date().toISOString(),
  })
  await writeNodeRelayRegistration(directory, {
    schemaVersion: 1,
    relayId: registration().relayId,
    relayIdentityFingerprint: registration().relayIdentityFingerprint,
    peerId: registration().peerId,
    observedAt: registration().authenticatedAt,
  })
  const connection = new DeferredGrantRelayConnection()
  const manager = new NodeRelayManager({
    state,
    configuration: configuration(),
    clientBuildIdentity: 'git-cb2c412def81',
    connect: async () => ({
      connection,
      registration: registration(),
      enrolled: false,
    }),
  })
  manager.start()
  await waitFor(() => connection.activeGrants === 1)
  for (let index = 0; index < 50; index += 1) {
    manager.synchronizeMachineTrust()
  }
  assert.equal(connection.maximumActiveGrants, 1)
  connection.releaseGrant()
  await waitFor(() => connection.grants.length === 2)
  assert.equal(connection.activeGrants, 1)
  assert.equal(connection.maximumActiveGrants, 1)
  connection.releaseGrant()
  await waitFor(() => manager.status === 'connected')
  assert.equal(connection.maximumActiveGrants, 1)
  assert.deepEqual(connection.grants, [
    controllerFingerprint,
    controllerFingerprint,
  ])
  await manager.close()
})

test('permanent Relay identity mismatch stops without a reconnect storm', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-node-relay-pin-'))
  const state = await openNodeState(directory)
  t.after(async () => {
    await state.close().catch(() => undefined)
    await import('node:fs/promises').then(async ({ rm }) =>
      rm(directory, { recursive: true, force: true }),
    )
  })
  let calls = 0
  const manager = new NodeRelayManager({
    state,
    configuration: configuration(),
    clientBuildIdentity: 'git-cb2c412def81',
    connect: async () => {
      calls += 1
      throw new RelayClientError(
        'relay_identity_mismatch',
        'Internet Relay identity did not match its pin',
      )
    },
  })
  manager.start()
  await waitFor(() => manager.status === 'identity_mismatch')
  await new Promise((resolve) => setTimeout(resolve, 25))
  assert.equal(calls, 1)
  assert.equal(manager.workerActive, false)
  await manager.close()
})

test('Node restart reuses the exact Node identity and Relay registration without a token', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'codetether-node-relay-restart-'),
  )
  t.after(async () => {
    await import('node:fs/promises').then(async ({ rm }) =>
      rm(directory, { recursive: true, force: true }),
    )
  })
  const firstState = await openNodeState(directory)
  await writeNodeRelayRegistration(directory, {
    schemaVersion: 1,
    relayId: registration().relayId,
    relayIdentityFingerprint: registration().relayIdentityFingerprint,
    peerId: registration().peerId,
    observedAt: registration().authenticatedAt,
  })
  const calls = []
  const firstConnection = new FakeRelayConnection()
  const firstManager = new NodeRelayManager({
    state: firstState,
    configuration: configuration(),
    clientBuildIdentity: 'git-cb2c412def81',
    connect: async (options) => {
      calls.push(options)
      return {
        connection: firstConnection,
        registration: registration(),
        enrolled: false,
      }
    },
  })
  firstManager.start()
  await waitFor(() => firstManager.status === 'connected')
  const durableFingerprint = firstState.identity.publicKeyFingerprint
  await firstManager.close()
  await firstState.close()

  const secondState = await openNodeState(directory)
  const secondConnection = new FakeRelayConnection()
  const secondManager = new NodeRelayManager({
    state: secondState,
    configuration: configuration(),
    clientBuildIdentity: 'git-cb2c412def81',
    connect: async (options) => {
      calls.push(options)
      return {
        connection: secondConnection,
        registration: registration(),
        enrolled: false,
      }
    },
  })
  secondManager.start()
  await waitFor(() => secondManager.status === 'connected')
  assert.equal(secondState.identity.publicKeyFingerprint, durableFingerprint)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].identity.publicKeyFingerprint, durableFingerprint)
  assert.equal(calls[1].identity.publicKeyFingerprint, durableFingerprint)
  assert.equal(calls[0].enrollmentToken, undefined)
  assert.equal(calls[1].enrollmentToken, undefined)
  assert.equal(calls[1].expectedRelayId, registration().relayId)
  await secondManager.close()
  await secondState.close()
})

test('registered Node starts offline, retries within its cap, and recovers without enrollment or identity change', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'codetether-node-relay-offline-start-'),
  )
  const state = await openNodeState(directory)
  t.after(async () => {
    await state.close().catch(() => undefined)
    await import('node:fs/promises').then(async ({ rm }) =>
      rm(directory, { recursive: true, force: true }),
    )
  })
  await state.trustController({
    controllerId: newControllerId(),
    publicKeyFingerprint: controllerFingerprint,
    pairedAt: new Date().toISOString(),
  })
  const trustBefore = state.trustedController()
  const identityBefore = state.identity.publicKeyFingerprint
  const durableRegistration = {
    schemaVersion: 1,
    relayId: registration().relayId,
    relayIdentityFingerprint: registration().relayIdentityFingerprint,
    peerId: registration().peerId,
    observedAt: registration().authenticatedAt,
  }
  await writeNodeRelayRegistration(directory, durableRegistration)

  const calls = []
  const attemptsAt = []
  let tokenReads = 0
  let registrationWrites = 0
  const recovered = new FakeRelayConnection()
  const statuses = []
  const manager = new NodeRelayManager({
    state,
    configuration: configuration(),
    clientBuildIdentity: 'phase7d-test',
    reconnectInitialDelayMs: 1,
    reconnectMaximumDelayMs: 2,
    random: () => 1,
    onStatus: ({ status }) => statuses.push(status),
    readEnrollmentToken: async () => {
      tokenReads += 1
      return undefined
    },
    writeRegistration: async () => {
      registrationWrites += 1
    },
    connect: async (options) => {
      calls.push(options)
      attemptsAt.push(performance.now())
      if (calls.length <= 6) {
        throw new RelayClientError(
          'relay_unreachable',
          'Internet Relay is unreachable',
        )
      }
      return {
        connection: recovered,
        registration: registration(),
        enrolled: false,
      }
    },
  })

  manager.start()
  await waitFor(() => manager.status === 'connected')

  assert.equal(calls.length, 7)
  assert.equal(tokenReads, 0)
  assert.equal(registrationWrites, 0)
  assert.equal(state.identity.publicKeyFingerprint, identityBefore)
  assert.deepEqual(state.trustedController(), trustBefore)
  assert.deepEqual(
    await readNodeRelayRegistration(directory),
    durableRegistration,
  )
  assert.equal(
    calls.every(
      (options) =>
        options.enrollmentToken === undefined &&
        options.expectedRelayId === durableRegistration.relayId &&
        options.identity.publicKeyFingerprint === identityBefore,
    ),
    true,
  )
  assert.equal(statuses.includes('offline'), true)
  assert.equal(statuses.at(-1), 'connected')
  for (let index = 2; index < attemptsAt.length; index += 1) {
    assert.ok(attemptsAt[index] - attemptsAt[index - 1] < 100)
  }

  await manager.close()
  assert.equal(manager.workerActive, false)
  assert.equal(recovered.closed, true)
})

test('Node service shutdown closes Relay control and still releases direct Node state', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'codetether-node-relay-close-'),
  )
  t.after(async () => {
    await import('node:fs/promises').then(async ({ rm }) =>
      rm(directory, { recursive: true, force: true }),
    )
  })
  const state = await openNodeState(directory)
  let relayCloses = 0
  const service = new CodeTetherNodeService({
    state,
    bindAddress: '127.0.0.1',
    port: 0,
    relayControl: {
      close: async () => {
        relayCloses += 1
      },
    },
  })
  await service.listen()
  await service.close()
  await service.close()
  assert.equal(relayCloses, 1)
  const reopened = await openNodeState(directory)
  await reopened.close()
})

test('100 Relay disconnects reuse one bounded Node reconnect worker', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-node-relay-flap-'))
  const state = await openNodeState(directory)
  t.after(async () => {
    await state.close().catch(() => undefined)
    await import('node:fs/promises').then(async ({ rm }) =>
      rm(directory, { recursive: true, force: true }),
    )
  })
  const connections = []
  const manager = new NodeRelayManager({
    state,
    configuration: configuration(),
    clientBuildIdentity: 'git-cb2c412def81',
    reconnectInitialDelayMs: 1,
    reconnectMaximumDelayMs: 2,
    random: () => 0.5,
    readRegistration: async () => ({
      schemaVersion: 1,
      relayId: registration().relayId,
      relayIdentityFingerprint: registration().relayIdentityFingerprint,
      peerId: registration().peerId,
      observedAt: registration().authenticatedAt,
    }),
    connect: async () => {
      const connection = new FakeRelayConnection()
      connections.push(connection)
      return {
        connection,
        registration: registration(),
        enrolled: false,
      }
    },
  })
  manager.start()
  for (let cycle = 0; cycle < 100; cycle += 1) {
    await waitFor(
      () => connections.length === cycle + 1 && manager.status === 'connected',
    )
    assert.equal(manager.workerActive, true)
    connections[cycle].disconnect()
  }
  await waitFor(() => connections.length === 101)
  assert.equal(manager.workerActive, true)
  await manager.close()
  assert.equal(manager.workerActive, false)
  assert.equal(
    connections.every(({ closed }) => closed),
    true,
  )
})

test('1000 reconnect wake signals coalesce into one Node Relay replacement', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-node-relay-wake-'))
  const state = await openNodeState(directory)
  t.after(async () => {
    await state.close().catch(() => undefined)
    await import('node:fs/promises').then(async ({ rm }) =>
      rm(directory, { recursive: true, force: true }),
    )
  })
  const connections = []
  const statuses = []
  const manager = new NodeRelayManager({
    state,
    configuration: configuration(),
    clientBuildIdentity: 'git-f42a98800900',
    reconnectInitialDelayMs: 60_000,
    reconnectMaximumDelayMs: 60_000,
    random: () => 0.5,
    onStatus: (observation) => statuses.push(observation.status),
    readRegistration: async () => ({
      schemaVersion: 1,
      relayId: registration().relayId,
      relayIdentityFingerprint: registration().relayIdentityFingerprint,
      peerId: registration().peerId,
      observedAt: registration().authenticatedAt,
    }),
    connect: async () => {
      const connection = new FakeRelayConnection()
      connections.push(connection)
      return {
        connection,
        registration: registration(),
        enrolled: false,
      }
    },
  })
  manager.start()
  await waitFor(
    () => connections.length === 1 && manager.status === 'connected',
  )
  const recoveryStatusStart = statuses.length

  let accepted = 0
  for (let signal = 0; signal < 1_000; signal += 1) {
    if (manager.requestReconnect()) accepted += 1
  }
  assert.equal(accepted, 1)
  await waitFor(
    () => connections.length === 2 && manager.status === 'connected',
  )
  await new Promise((resolve) => setTimeout(resolve, 25))
  assert.equal(connections.length, 2)
  assert.equal(connections[0].closed, true)
  assert.equal(manager.workerActive, true)
  assert.equal(statuses.slice(recoveryStatusStart).includes('offline'), false)
  assert.equal(statuses[recoveryStatusStart], 'reconnecting')
  assert.equal(statuses.at(-1), 'connected')

  await manager.close()
  assert.equal(manager.workerActive, false)
  assert.equal(manager.requestReconnect(), false)
})

test('reconnect wakes abort one stale in-flight dial before opening its replacement', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'codetether-node-relay-dial-wake-'),
  )
  const state = await openNodeState(directory)
  t.after(async () => {
    await state.close().catch(() => undefined)
    await import('node:fs/promises').then(async ({ rm }) =>
      rm(directory, { recursive: true, force: true }),
    )
  })
  let calls = 0
  let activeDials = 0
  let maximumActiveDials = 0
  const replacement = new FakeRelayConnection()
  const manager = new NodeRelayManager({
    state,
    configuration: configuration(),
    clientBuildIdentity: 'git-f42a98800900',
    reconnectInitialDelayMs: 60_000,
    reconnectMaximumDelayMs: 60_000,
    random: () => 0.5,
    readRegistration: async () => ({
      schemaVersion: 1,
      relayId: registration().relayId,
      relayIdentityFingerprint: registration().relayIdentityFingerprint,
      peerId: registration().peerId,
      observedAt: registration().authenticatedAt,
    }),
    connect: async (options) => {
      calls += 1
      activeDials += 1
      maximumActiveDials = Math.max(maximumActiveDials, activeDials)
      try {
        if (calls === 1) {
          await new Promise((resolve, reject) => {
            const abort = () => reject(new Error('controlled dial abort'))
            options.signal.addEventListener('abort', abort, { once: true })
          })
        }
        return {
          connection: replacement,
          registration: registration(),
          enrolled: false,
        }
      } finally {
        activeDials -= 1
      }
    },
  })
  manager.start()
  await waitFor(() => calls === 1 && activeDials === 1)

  let accepted = 0
  for (let signal = 0; signal < 1_000; signal += 1) {
    if (manager.requestReconnect()) accepted += 1
  }
  assert.equal(accepted, 1)
  await waitFor(() => calls === 2 && manager.status === 'connected')
  assert.equal(maximumActiveDials, 1)
  assert.equal(activeDials, 0)

  await manager.close()
  assert.equal(replacement.closed, true)
})

test('a later Node recovery signal invalidates a replacement dial already in progress', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'codetether-node-relay-second-dial-wake-'),
  )
  const state = await openNodeState(directory)
  t.after(async () => {
    await state.close().catch(() => undefined)
    await import('node:fs/promises').then(async ({ rm }) =>
      rm(directory, { recursive: true, force: true }),
    )
  })
  await writeNodeRelayRegistration(directory, {
    schemaVersion: 1,
    relayId: registration().relayId,
    relayIdentityFingerprint: registration().relayIdentityFingerprint,
    peerId: registration().peerId,
    observedAt: registration().authenticatedAt,
  })
  const first = new FakeRelayConnection()
  const staleReplacement = new FakeRelayConnection()
  const current = new FakeRelayConnection()
  let releaseStaleReplacement
  const staleReplacementGate = new Promise((resolve) => {
    releaseStaleReplacement = resolve
  })
  let calls = 0
  const manager = new NodeRelayManager({
    state,
    configuration: configuration(),
    clientBuildIdentity: 'phase7d-test',
    reconnectInitialDelayMs: 60_000,
    reconnectMaximumDelayMs: 60_000,
    random: () => 0.5,
    connect: async () => {
      calls += 1
      if (calls === 1) {
        return {
          connection: first,
          registration: registration(),
          enrolled: false,
        }
      }
      if (calls === 2) {
        await staleReplacementGate
        return {
          connection: staleReplacement,
          registration: registration(),
          enrolled: false,
        }
      }
      return {
        connection: current,
        registration: registration(),
        enrolled: false,
      }
    },
  })
  manager.start()
  await waitFor(() => manager.status === 'connected')

  assert.equal(manager.requestReconnect(), true)
  await waitFor(() => calls === 2)
  assert.equal(manager.requestReconnect(), true)
  releaseStaleReplacement()

  await waitFor(() => calls === 3 && manager.status === 'connected')
  assert.equal(staleReplacement.closed, true)
  await manager.close()
  assert.equal(current.closed, true)
})

test('Node Relay shutdown cancels a long reconnect delay without another dial', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'codetether-node-relay-wait-close-'),
  )
  const state = await openNodeState(directory)
  t.after(async () => {
    await state.close().catch(() => undefined)
    await import('node:fs/promises').then(async ({ rm }) =>
      rm(directory, { recursive: true, force: true }),
    )
  })
  let calls = 0
  const manager = new NodeRelayManager({
    state,
    configuration: configuration(),
    clientBuildIdentity: 'git-f42a98800900',
    reconnectInitialDelayMs: 60_000,
    reconnectMaximumDelayMs: 60_000,
    random: () => 0.5,
    readRegistration: async () => ({
      schemaVersion: 1,
      relayId: registration().relayId,
      relayIdentityFingerprint: registration().relayIdentityFingerprint,
      peerId: registration().peerId,
      observedAt: registration().authenticatedAt,
    }),
    connect: async () => {
      calls += 1
      throw new RelayClientError(
        'relay_unreachable',
        'Internet Relay is unreachable',
      )
    },
  })
  manager.start()
  await waitFor(() => manager.status === 'offline' && manager.workerActive)
  const startedAt = Date.now()
  await manager.close()
  assert.ok(Date.now() - startedAt < 1_000)
  assert.equal(calls, 1)
  assert.equal(manager.workerActive, false)
  assert.equal(manager.status, 'closed')
})
