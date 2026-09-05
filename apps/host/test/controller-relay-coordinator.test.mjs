import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'

import { createMachineTlsIdentityFile } from '@codetether/machine-transport'
import { RelayClientError } from '@codetether/relay-client'

import { SecureControllerRelayCoordinator } from '../dist/api/controller-relay-coordinator.js'
import { ConversationStore } from '../dist/persistence/index.js'

const timestamp = '2026-09-03T15:00:00.000Z'
const relayFingerprint = 'r'.repeat(43)
const enrollmentToken = `relay_enroll_${'t'.repeat(43)}`

test('Controller config verifies Relay identity and retains no enrollment token', async () => {
  await withFixture(async (fixture) => {
    const calls = []
    const coordinator = await SecureControllerRelayCoordinator.create({
      persistence: fixture.store,
      clientBuildIdentity: 'phase7a-test',
      credentialDirectory: fixture.credentialDirectory,
      connect: async (options) => {
        calls.push(options)
        throw new RelayClientError(
          'relay_enrollment_required',
          'safe test classification',
        )
      },
      now: () => new Date(timestamp),
    })

    assert.deepEqual(
      await coordinator.configure(fixture.trust, {
        endpoint: {
          host: '39.104.94.53',
          port: 443,
          transportSecurity: 'pinned_identity',
        },
        relayIdentityFingerprint: relayFingerprint,
        displayLabel: 'Owner Relay',
      }),
      {
        state: 'enrollment_required',
        enrollment: 'required',
        nodePresence: 'not_observed',
        internetExecutionEnabled: false,
        endpoint: {
          host: '39.104.94.53',
          port: 443,
          transportSecurity: 'pinned_identity',
        },
        relayIdentityFingerprint: relayFingerprint,
        displayLabel: 'Owner Relay',
      },
    )
    assert.equal(calls.length, 1)
    assert.equal(calls[0].identity.role, 'controller')
    assert.equal(
      calls[0].identity.publicKeyFingerprint,
      fixture.identity.publicKeyFingerprint,
    )
    assert.equal(calls[0].enrollmentToken, undefined)
    assert.equal(
      JSON.stringify(
        fixture.store.getMachineRelayConfiguration(fixture.machineId),
      ).includes(enrollmentToken),
      false,
    )
    await coordinator.close()
  })
})

test('explicit enrollment authenticates first, consumes a token only when required, and observes one trusted Node', async () => {
  await withFixture(async (fixture) => {
    const calls = []
    let onlineListener
    const connection = controlledConnection((fingerprint, listener) => {
      assert.equal(fingerprint, fixture.trust.peerKeyFingerprint)
      onlineListener = listener
    })
    const coordinator = await SecureControllerRelayCoordinator.create({
      persistence: fixture.store,
      clientBuildIdentity: 'phase7a-test',
      credentialDirectory: fixture.credentialDirectory,
      connect: async (options) => {
        calls.push(options)
        if (calls.length < 3) {
          throw new RelayClientError(
            'relay_enrollment_required',
            'safe test classification',
          )
        }
        return connectedResult(connection, options, true)
      },
      now: () => new Date(timestamp),
      reconnectInitialDelayMs: 5,
      reconnectMaximumDelayMs: 10,
    })

    await coordinator.configure(fixture.trust, {
      endpoint: {
        host: '39.104.94.53',
        port: 443,
        transportSecurity: 'pinned_identity',
      },
      relayIdentityFingerprint: relayFingerprint,
    })
    const enrolled = await coordinator.enroll(fixture.trust, enrollmentToken)
    assert.equal(enrolled.enrollment, 'enrolled')
    assert.equal(calls.length, 3)
    assert.equal(calls[0].enrollmentToken, undefined)
    assert.equal(calls[1].enrollmentToken, undefined)
    assert.equal(calls[2].enrollmentToken, enrollmentToken)

    await waitFor(
      () => coordinator.status(fixture.machineId).state === 'connected',
    )
    onlineListener({ state: 'online' })
    assert.equal(coordinator.status(fixture.machineId).nodePresence, 'online')
    onlineListener({ state: 'unavailable' })
    assert.equal(
      coordinator.status(fixture.machineId).nodePresence,
      'unauthorized',
    )
    assert.equal(
      fixture.store.getMachineRelayConfiguration(fixture.machineId)
        .enrollmentState,
      'enrolled',
    )
    assert.equal(
      JSON.stringify(
        fixture.store.getMachineRelayConfiguration(fixture.machineId),
      ).includes(enrollmentToken),
      false,
    )
    await coordinator.close()
  })
})

test('revoked Controller requires an explicit fresh token and reuses the exact Machine trust identity', async () => {
  await withFixture(async (fixture) => {
    fixture.store.configureMachineRelay(
      fixture.machineId,
      {
        host: '39.104.94.53',
        port: 443,
        transportSecurity: 'pinned_identity',
      },
      relayFingerprint,
      timestamp,
    )
    fixture.store.markMachineRelayEnrolled(fixture.machineId, timestamp)
    fixture.store.markMachineRelayRevoked(fixture.machineId, timestamp)
    const trustBefore = fixture.store.getTrustedMachinePeer(fixture.machineId)
    const calls = []
    const accepted = controlledConnection()
    const coordinator = await SecureControllerRelayCoordinator.create({
      persistence: fixture.store,
      clientBuildIdentity: 'phase7a-test',
      credentialDirectory: fixture.credentialDirectory,
      connect: async (options) => {
        calls.push(options)
        return connectedResult(accepted, options, true)
      },
      now: () => new Date(timestamp),
    })

    await coordinator.enroll(fixture.trust, enrollmentToken)
    await waitFor(
      () => coordinator.status(fixture.machineId).state === 'connected',
    )
    assert.equal(calls.length, 1)
    assert.equal(calls[0].enrollmentToken, enrollmentToken)
    assert.equal(
      calls[0].identity.publicKeyFingerprint,
      fixture.identity.publicKeyFingerprint,
    )
    assert.equal(
      fixture.store.getMachineRelayConfiguration(fixture.machineId)
        .enrollmentState,
      'enrolled',
    )
    assert.deepEqual(
      fixture.store.getTrustedMachinePeer(fixture.machineId),
      trustBefore,
    )
    await coordinator.close()
  })
})

test('Relay identity mismatch fails closed without trusting the endpoint', async () => {
  await withFixture(async (fixture) => {
    const coordinator = await SecureControllerRelayCoordinator.create({
      persistence: fixture.store,
      clientBuildIdentity: 'phase7a-test',
      credentialDirectory: fixture.credentialDirectory,
      connect: async () => {
        throw new RelayClientError(
          'relay_identity_mismatch',
          'safe test classification',
        )
      },
      now: () => new Date(timestamp),
    })

    await assert.rejects(
      coordinator.configure(fixture.trust, {
        endpoint: {
          host: 'relay.invalid.test',
          port: 443,
          transportSecurity: 'public_ca',
        },
        relayIdentityFingerprint: relayFingerprint,
      }),
      (error) => error?.reason === 'relay_identity_mismatch',
    )
    assert.equal(
      fixture.store.getMachineRelayConfiguration(fixture.machineId),
      undefined,
    )
    assert.equal(fixture.trust.trustState, 'active')
    await coordinator.close()
  })
})

test('restart reconnect uses the enrolled Controller identity without a token', async () => {
  await withFixture(async (fixture) => {
    fixture.store.configureMachineRelay(
      fixture.machineId,
      {
        host: '39.104.94.53',
        port: 443,
        transportSecurity: 'pinned_identity',
      },
      relayFingerprint,
      timestamp,
    )
    fixture.store.markMachineRelayEnrolled(fixture.machineId, timestamp)
    const calls = []
    const connection = controlledConnection()
    const coordinator = await SecureControllerRelayCoordinator.create({
      persistence: fixture.store,
      clientBuildIdentity: 'phase7a-test',
      credentialDirectory: fixture.credentialDirectory,
      connect: async (options) => {
        calls.push(options)
        return connectedResult(connection, options, false)
      },
      now: () => new Date(timestamp),
      reconnectInitialDelayMs: 5,
      reconnectMaximumDelayMs: 10,
    })

    await waitFor(
      () => coordinator.status(fixture.machineId).state === 'connected',
    )
    assert.equal(calls.length, 1)
    assert.equal(calls[0].enrollmentToken, undefined)
    assert.equal(
      calls[0].identity.publicKeyFingerprint,
      fixture.identity.publicKeyFingerprint,
    )
    await coordinator.close()
  })
})

test('revoking trust admits only the dedicated Relay Machine teardown channel', async () => {
  await withFixture(async (fixture) => {
    fixture.store.configureMachineRelay(
      fixture.machineId,
      {
        host: '39.104.94.53',
        port: 443,
        transportSecurity: 'pinned_identity',
      },
      relayFingerprint,
      timestamp,
    )
    fixture.store.markMachineRelayEnrolled(fixture.machineId, timestamp)
    let presence
    const connection = controlledConnection((_fingerprint, listener) => {
      presence = listener
    })
    const coordinator = await SecureControllerRelayCoordinator.create({
      persistence: fixture.store,
      clientBuildIdentity: 'phase7b-test',
      credentialDirectory: fixture.credentialDirectory,
      connect: async (options) => connectedResult(connection, options, false),
      now: () => new Date(timestamp),
      reconnectInitialDelayMs: 5,
      reconnectMaximumDelayMs: 10,
    })
    await waitFor(
      () => coordinator.status(fixture.machineId).state === 'connected',
    )
    presence({ state: 'online' })

    const revoking = fixture.store.markTrustedMachinePeerRevoking(
      fixture.machineId,
      timestamp,
    )
    await assert.rejects(
      coordinator.openMachineChannel(fixture.trust),
      (error) => error?.reason === 'relay_authentication_failed',
    )
    const channel = await coordinator.openMachineRevocationChannel(revoking)
    assert.equal(connection.machineChannelOpens, 1)
    channel.destroy()
    await coordinator.close()
  })
})

test('failed candidate verification restores the prior enrolled Relay worker', async () => {
  await withFixture(async (fixture) => {
    const priorEndpoint = {
      host: 'relay.current.test',
      port: 443,
      transportSecurity: 'pinned_identity',
    }
    fixture.store.configureMachineRelay(
      fixture.machineId,
      priorEndpoint,
      relayFingerprint,
      timestamp,
    )
    fixture.store.markMachineRelayEnrolled(fixture.machineId, timestamp)
    const first = controlledConnection()
    const restored = controlledConnection()
    const calls = []
    const coordinator = await SecureControllerRelayCoordinator.create({
      persistence: fixture.store,
      clientBuildIdentity: 'phase7a-test',
      credentialDirectory: fixture.credentialDirectory,
      connect: async (options) => {
        calls.push(options)
        if (calls.length === 1) return connectedResult(first, options, false)
        if (calls.length === 2) {
          throw new RelayClientError(
            'relay_identity_mismatch',
            'safe test classification',
          )
        }
        return connectedResult(restored, options, false)
      },
      now: () => new Date(timestamp),
      reconnectInitialDelayMs: 5,
      reconnectMaximumDelayMs: 10,
    })

    await waitFor(
      () => coordinator.status(fixture.machineId).state === 'connected',
    )
    await assert.rejects(
      coordinator.configure(fixture.trust, {
        endpoint: {
          host: 'relay.candidate.test',
          port: 443,
          transportSecurity: 'pinned_identity',
        },
        relayIdentityFingerprint: 'x'.repeat(43),
      }),
      (error) => error?.reason === 'relay_identity_mismatch',
    )
    await waitFor(
      () =>
        calls.length === 3 &&
        coordinator.status(fixture.machineId).state === 'connected',
    )
    assert.deepEqual(calls[2].endpoint, {
      host: priorEndpoint.host,
      port: priorEndpoint.port,
    })
    assert.equal(calls[2].expectedRelayIdentityFingerprint, relayFingerprint)
    assert.equal(first.closed, true)
    assert.deepEqual(
      fixture.store.getMachineRelayConfiguration(fixture.machineId).endpoint,
      priorEndpoint,
    )
    await coordinator.close()
  })
})

test('configure closes an authenticated connection when durable adoption fails', async () => {
  await withFixture(async (fixture) => {
    const accepted = controlledConnection()
    const coordinator = await SecureControllerRelayCoordinator.create({
      persistence: fixture.store,
      clientBuildIdentity: 'phase7a-test',
      credentialDirectory: fixture.credentialDirectory,
      connect: async (options) => connectedResult(accepted, options, false),
      now: () => new Date(timestamp),
    })
    fixture.store.configureMachineRelay = () => {
      throw new Error('simulated Relay persistence failure')
    }

    await assert.rejects(
      coordinator.configure(fixture.trust, {
        endpoint: {
          host: 'relay.candidate.test',
          port: 443,
          transportSecurity: 'pinned_identity',
        },
        relayIdentityFingerprint: relayFingerprint,
      }),
      /simulated Relay persistence failure/,
    )
    assert.equal(accepted.closed, true)
    assert.equal(coordinator.status(fixture.machineId).state, 'not_configured')
    await coordinator.close()
  })
})

test('enroll closes an authenticated connection when durable adoption fails', async () => {
  await withFixture(async (fixture) => {
    fixture.store.configureMachineRelay(
      fixture.machineId,
      {
        host: 'relay.current.test',
        port: 443,
        transportSecurity: 'pinned_identity',
      },
      relayFingerprint,
      timestamp,
    )
    const accepted = controlledConnection()
    let calls = 0
    const coordinator = await SecureControllerRelayCoordinator.create({
      persistence: fixture.store,
      clientBuildIdentity: 'phase7a-test',
      credentialDirectory: fixture.credentialDirectory,
      connect: async (options) => {
        calls += 1
        if (calls === 1) {
          throw new RelayClientError(
            'relay_enrollment_required',
            'safe test classification',
          )
        }
        return connectedResult(accepted, options, true)
      },
      now: () => new Date(timestamp),
    })
    fixture.store.markMachineRelayEnrolled = () => {
      throw new Error('simulated Relay enrollment persistence failure')
    }

    await assert.rejects(
      coordinator.enroll(fixture.trust, enrollmentToken),
      /simulated Relay enrollment persistence failure/,
    )
    assert.equal(calls, 2)
    assert.equal(accepted.closed, true)
    assert.equal(
      coordinator.status(fixture.machineId).state,
      'enrollment_required',
    )
    await coordinator.close()
  })
})

test('1000 Host recovery signals coalesce into one Controller Relay replacement', async () => {
  await withFixture(async (fixture) => {
    fixture.store.configureMachineRelay(
      fixture.machineId,
      {
        host: '39.104.94.53',
        port: 443,
        transportSecurity: 'pinned_identity',
      },
      relayFingerprint,
      timestamp,
    )
    fixture.store.markMachineRelayEnrolled(fixture.machineId, timestamp)
    const connections = []
    const coordinator = await SecureControllerRelayCoordinator.create({
      persistence: fixture.store,
      clientBuildIdentity: 'phase7d-test',
      credentialDirectory: fixture.credentialDirectory,
      reconnectInitialDelayMs: 60_000,
      reconnectMaximumDelayMs: 60_000,
      random: () => 0.5,
      connect: async (options) => {
        const connection = controlledConnection()
        connections.push(connection)
        return connectedResult(connection, options, false)
      },
    })
    await waitFor(
      () =>
        connections.length === 1 &&
        coordinator.status(fixture.machineId).state === 'connected',
    )

    let accepted = 0
    for (let signal = 0; signal < 1_000; signal += 1) {
      accepted += coordinator.requestReconnect()
    }
    assert.equal(accepted, 1)
    await waitFor(
      () =>
        connections.length === 2 &&
        coordinator.status(fixture.machineId).state === 'connected',
    )
    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.equal(connections.length, 2)
    assert.equal(connections[0].closed, true)

    await coordinator.close()
    assert.equal(connections[1].closed, true)
    assert.equal(coordinator.requestReconnect(), 0)
  })
})

test('Controller reconnects after a transient hostname failure with the same durable identity and enrollment', async () => {
  await withFixture(async (fixture) => {
    const endpoint = {
      host: 'relay.roaming.test',
      port: 443,
      transportSecurity: 'public_ca',
    }
    fixture.store.configureMachineRelay(
      fixture.machineId,
      endpoint,
      relayFingerprint,
      timestamp,
    )
    fixture.store.markMachineRelayEnrolled(fixture.machineId, timestamp)
    const trustBefore = fixture.store.getTrustedMachinePeer(fixture.machineId)
    const connection = controlledConnection()
    const sourceRoutes = ['fixture-source-route-a', 'fixture-source-route-b']
    const attempts = []
    const coordinator = await SecureControllerRelayCoordinator.create({
      persistence: fixture.store,
      clientBuildIdentity: 'phase7d-test',
      credentialDirectory: fixture.credentialDirectory,
      reconnectInitialDelayMs: 5,
      reconnectMaximumDelayMs: 10,
      random: () => 0.5,
      connect: async (options) => {
        attempts.push({
          options,
          sourceRoute: sourceRoutes[attempts.length],
        })
        if (attempts.length === 1) {
          throw new RelayClientError(
            'relay_unreachable',
            'temporary hostname resolution failure',
          )
        }
        return connectedResult(connection, options, false)
      },
    })

    await waitFor(
      () =>
        attempts.length === 2 &&
        coordinator.status(fixture.machineId).state === 'connected',
    )
    assert.deepEqual(
      attempts.map(({ sourceRoute }) => sourceRoute),
      sourceRoutes,
      'the deterministic fixture crossed a simulated source-route change',
    )
    for (const { options } of attempts) {
      assert.deepEqual(options.endpoint, {
        host: endpoint.host,
        port: endpoint.port,
      })
      assert.equal(options.tls.serverName, endpoint.host)
      assert.equal(
        options.identity.publicKeyFingerprint,
        fixture.identity.publicKeyFingerprint,
      )
      assert.equal(options.expectedRelayIdentityFingerprint, relayFingerprint)
      assert.equal(options.enrollmentToken, undefined)
    }
    assert.equal(
      fixture.store.getMachineRelayConfiguration(fixture.machineId)
        .enrollmentState,
      'enrolled',
    )
    assert.deepEqual(
      fixture.store.getTrustedMachinePeer(fixture.machineId),
      trustBefore,
    )
    assert.deepEqual(coordinator.status(fixture.machineId).endpoint, endpoint)
    await coordinator.close()
  })
})

test('Controller recovery synchronously revokes stale Relay channel and presence ownership', async () => {
  await withFixture(async (fixture) => {
    fixture.store.configureMachineRelay(
      fixture.machineId,
      {
        host: '39.104.94.53',
        port: 443,
        transportSecurity: 'pinned_identity',
      },
      relayFingerprint,
      timestamp,
    )
    fixture.store.markMachineRelayEnrolled(fixture.machineId, timestamp)
    let stalePresence
    let replacementPresence
    let releaseChannel
    const channelGate = new Promise((resolve) => {
      releaseChannel = resolve
    })
    const staleStream = new PassThrough()
    const current = controlledConnection((_fingerprint, listener) => {
      stalePresence = listener
    }, 'relay_connection_stale01')
    current.openMachineChannel = async () => {
      current.machineChannelOpens += 1
      await channelGate
      return staleStream
    }
    const replacement = controlledConnection((_fingerprint, listener) => {
      replacementPresence = listener
    }, 'relay_connection_current01')
    let calls = 0
    const coordinator = await SecureControllerRelayCoordinator.create({
      persistence: fixture.store,
      clientBuildIdentity: 'phase7d-test',
      credentialDirectory: fixture.credentialDirectory,
      reconnectInitialDelayMs: 60_000,
      reconnectMaximumDelayMs: 60_000,
      random: () => 0.5,
      connect: async (options) =>
        connectedResult(calls++ === 0 ? current : replacement, options, false),
    })
    await waitFor(
      () => coordinator.status(fixture.machineId).state === 'connected',
    )
    stalePresence({ state: 'online' })
    assert.equal(
      coordinator.status(fixture.machineId).internetExecutionEnabled,
      true,
    )

    const staleOpen = coordinator.openMachineChannel(fixture.trust)
    await waitFor(() => current.machineChannelOpens === 1)
    assert.equal(coordinator.requestReconnect(), 1)
    assert.equal(coordinator.connectionEpoch(fixture.machineId), undefined)
    assert.equal(coordinator.status(fixture.machineId).state, 'reconnecting')
    stalePresence({ state: 'online' })
    assert.equal(coordinator.status(fixture.machineId).state, 'reconnecting')
    await assert.rejects(
      coordinator.openMachineChannel(fixture.trust),
      (error) => error?.reason === 'relay_unreachable',
    )

    releaseChannel()
    await assert.rejects(
      staleOpen,
      (error) => error?.reason === 'relay_channel_lost',
    )
    assert.equal(staleStream.destroyed, true)
    await waitFor(
      () =>
        calls === 2 &&
        coordinator.status(fixture.machineId).state === 'connected',
    )
    replacementPresence({ state: 'online' })
    const replacementStatus = coordinator.status(fixture.machineId)
    assert.equal(replacementStatus.nodePresence, 'online')
    assert.equal(replacementStatus.internetExecutionEnabled, true)
    assert.equal(
      coordinator.connectionEpoch(fixture.machineId),
      replacement.connectionEpoch,
    )

    stalePresence({ state: 'offline' })
    assert.deepEqual(
      coordinator.status(fixture.machineId),
      replacementStatus,
      'an offline event from the old connection cannot mutate the replacement generation',
    )
    await coordinator.close()
  })
})

test('a late Controller Relay dial from an invalidated generation is closed and never adopted', async () => {
  await withFixture(async (fixture) => {
    fixture.store.configureMachineRelay(
      fixture.machineId,
      {
        host: '39.104.94.53',
        port: 443,
        transportSecurity: 'pinned_identity',
      },
      relayFingerprint,
      timestamp,
    )
    fixture.store.markMachineRelayEnrolled(fixture.machineId, timestamp)
    const stale = controlledConnection()
    const replacement = controlledConnection()
    let firstOptions
    let resolveFirst
    let calls = 0
    const coordinator = await SecureControllerRelayCoordinator.create({
      persistence: fixture.store,
      clientBuildIdentity: 'phase7d-test',
      credentialDirectory: fixture.credentialDirectory,
      reconnectInitialDelayMs: 60_000,
      reconnectMaximumDelayMs: 60_000,
      random: () => 0.5,
      connect: async (options) => {
        calls += 1
        if (calls === 1) {
          firstOptions = options
          return await new Promise((resolve) => {
            resolveFirst = resolve
          })
        }
        return connectedResult(replacement, options, false)
      },
    })
    await waitFor(() => calls === 1)
    assert.equal(coordinator.requestReconnect(), 1)
    resolveFirst(connectedResult(stale, firstOptions, false))

    await waitFor(
      () =>
        calls === 2 &&
        coordinator.status(fixture.machineId).state === 'connected',
    )
    assert.equal(stale.closed, true)
    assert.equal(
      coordinator.connectionEpoch(fixture.machineId),
      replacement.connectionEpoch,
    )

    await coordinator.close()
  })
})

test('a later recovery signal invalidates a replacement Relay dial already in progress', async () => {
  await withFixture(async (fixture) => {
    fixture.store.configureMachineRelay(
      fixture.machineId,
      {
        host: '39.104.94.53',
        port: 443,
        transportSecurity: 'pinned_identity',
      },
      relayFingerprint,
      timestamp,
    )
    fixture.store.markMachineRelayEnrolled(fixture.machineId, timestamp)
    const first = controlledConnection()
    const staleReplacement = controlledConnection()
    const current = controlledConnection()
    let releaseStaleReplacement
    const staleReplacementGate = new Promise((resolve) => {
      releaseStaleReplacement = resolve
    })
    let staleOptions
    let calls = 0
    const coordinator = await SecureControllerRelayCoordinator.create({
      persistence: fixture.store,
      clientBuildIdentity: 'phase7d-test',
      credentialDirectory: fixture.credentialDirectory,
      reconnectInitialDelayMs: 60_000,
      reconnectMaximumDelayMs: 60_000,
      random: () => 0.5,
      connect: async (options) => {
        calls += 1
        if (calls === 1) return connectedResult(first, options, false)
        if (calls === 2) {
          staleOptions = options
          await staleReplacementGate
          return connectedResult(staleReplacement, staleOptions, false)
        }
        return connectedResult(current, options, false)
      },
    })
    await waitFor(
      () => coordinator.status(fixture.machineId).state === 'connected',
    )

    assert.equal(coordinator.requestReconnect(), 1)
    await waitFor(() => calls === 2)
    assert.equal(coordinator.requestReconnect(), 1)
    releaseStaleReplacement()

    await waitFor(
      () =>
        calls === 3 &&
        coordinator.status(fixture.machineId).state === 'connected',
    )
    assert.equal(staleReplacement.closed, true)
    assert.equal(
      coordinator.connectionEpoch(fixture.machineId),
      current.connectionEpoch,
    )
    await coordinator.close()
  })
})

function controlledConnection(
  onSubscribe = () => undefined,
  connectionEpoch = 'relay_connection_fixture01',
) {
  let resolveClosed
  let closed = false
  const completion = new Promise((resolve) => {
    resolveClosed = resolve
  })
  const connection = {
    peerId: 'relay_peer_controllerfixture01',
    role: 'controller',
    connectionEpoch,
    async subscribeToNode(fingerprint, listener) {
      onSubscribe(fingerprint, listener)
      return async () => undefined
    },
    async replaceAuthorizedController() {},
    machineChannelOpens: 0,
    async openMachineChannel() {
      this.machineChannelOpens += 1
      return new PassThrough()
    },
    async waitUntilClosed() {
      await completion
    },
    async close() {
      if (!closed) {
        closed = true
        resolveClosed()
      }
      await completion
    },
    get closed() {
      return closed
    },
  }
  return connection
}

function connectedResult(connection, options, enrolled) {
  return {
    connection,
    registration: {
      relayId: 'relay_fixture01',
      relayIdentityFingerprint: options.expectedRelayIdentityFingerprint,
      peerId: connection.peerId,
      authenticatedAt: timestamp,
    },
    enrolled,
  }
}

async function waitFor(predicate) {
  const deadline = Date.now() + 1_000
  while (!predicate()) {
    if (Date.now() >= deadline)
      throw new Error('Timed out waiting for Relay state')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

async function withFixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'codetether-controller-relay-'))
  const databasePath = join(directory, 'codetether.sqlite3')
  const credentialDirectory = join(directory, 'machine-credentials')
  let store
  let runError
  try {
    await mkdir(credentialDirectory, { recursive: true })
    const controllerId = 'controller_relayfixture01'
    const credentialRef = `${controllerId}.json`
    const identity = await createMachineTlsIdentityFile(
      join(credentialDirectory, credentialRef),
      'CodeTether Controller',
    )
    store = ConversationStore.open({ databasePath })
    const machineId = 'machine_controllerrelay01'
    const candidate = {
      machine: {
        machineId,
        displayName: 'Relay coordinator fixture',
        kind: 'remote',
        platform: 'Linux',
        architecture: 'x64',
        createdAt: timestamp,
      },
      trust: {
        machineId,
        nodeIdentity: 'node_relayfixture01',
        peerPublicKeySpki: new Uint8Array(64).fill(1),
        peerKeyFingerprint: 'n'.repeat(43),
        controllerCredentialRef: credentialRef,
        controllerKeyFingerprint: identity.publicKeyFingerprint,
        trustState: 'pending',
        protocolVersion: 1,
        address: { host: '192.0.2.40', port: 43_217 },
        pairedAt: timestamp,
        updatedAt: timestamp,
      },
    }
    store.createRemoteMachineWithTrust(candidate.machine, candidate.trust)
    store.activateTrustedMachinePeer(machineId, timestamp)
    const trust = store.getTrustedMachinePeer(machineId)
    assert.ok(trust)
    await run({
      directory,
      databasePath,
      credentialDirectory,
      identity,
      machineId,
      store,
      trust,
    })
  } catch (error) {
    runError = error
  }

  try {
    store?.close()
  } catch (cleanupError) {
    if (runError === undefined) runError = cleanupError
  }
  try {
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    })
  } catch (cleanupError) {
    if (runError === undefined) runError = cleanupError
  }
  if (runError !== undefined) throw runError
}
