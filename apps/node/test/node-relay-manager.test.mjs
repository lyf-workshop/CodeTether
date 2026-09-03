import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

test('30 Relay disconnects reuse one bounded Node reconnect worker', async (t) => {
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
  for (let cycle = 0; cycle < 30; cycle += 1) {
    await waitFor(
      () => connections.length === cycle + 1 && manager.status === 'connected',
    )
    assert.equal(manager.workerActive, true)
    connections[cycle].disconnect()
  }
  await waitFor(() => connections.length === 31)
  assert.equal(manager.workerActive, true)
  await manager.close()
  assert.equal(manager.workerActive, false)
  assert.equal(
    connections.every(({ closed }) => closed),
    true,
  )
})
