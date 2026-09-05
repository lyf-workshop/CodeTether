import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'

import {
  MachineTransportError,
  createMachineTlsIdentityFile,
} from '@codetether/machine-transport'

import {
  RemoteMachineRevocationPendingError,
  SecureRemoteMachineCoordinator,
} from '../dist/api/remote-machine-coordinator.js'
import { ConversationStore } from '../dist/persistence/index.js'

const timestamp = '2026-09-03T12:00:00.000Z'

test('direct-first selects exactly one successful direct session path', async () => {
  await withRoutingFixture(async (fixture) => {
    const coordinator = await fixture.createCoordinator('direct_first')
    await fixture.waitUntilReady(coordinator)
    await waitFor(
      () => coordinator.relayExecutionAvailable(fixture.machine.machineId),
      'independent Relay Machine verification',
    )
    const before = fixture.snapshot()
    assert.equal(
      coordinator.relayExecutionAvailable(fixture.machine.machineId),
      true,
      'a bounded inner Machine handshake verifies Relay independently',
    )

    const session = await coordinator.openCodexSession(
      fixture.machine,
      fixture.trust(),
      codexSessionInput('direct'),
    )

    assert.equal(
      fixture.counts.directCodexSessions,
      before.directCodexSessions + 1,
    )
    assert.equal(fixture.counts.relayChannels, before.relayChannels)
    assert.equal(fixture.counts.relayCodexSessions, before.relayCodexSessions)
    assert.deepEqual(coordinator.connectionDetails(fixture.machine.machineId), {
      state: 'online',
      directState: 'online',
      executionTransport: 'direct',
      currentEndpoint: fixture.endpoint,
      lastSuccessfulAt: timestamp,
      lastAttemptAt: timestamp,
    })
    await session.close()
    await coordinator.close()
  })
})

test('Relay unavailable selects one Direct session and never opens a Relay channel', async () => {
  await withRoutingFixture(async (fixture) => {
    const coordinator = await fixture.createCoordinator('direct_first')
    await fixture.waitUntilReady(coordinator)
    fixture.setRelayEnabled(false)
    const before = fixture.snapshot()

    const session = await coordinator.openCodexSession(
      fixture.machine,
      fixture.trust(),
      codexSessionInput('relay-unavailable-direct'),
    )

    assert.equal(
      fixture.counts.directCodexSessions,
      before.directCodexSessions + 1,
    )
    assert.equal(fixture.counts.relayChannels, before.relayChannels)
    assert.equal(fixture.counts.relayCodexSessions, before.relayCodexSessions)
    assert.equal(
      coordinator.connectionDetails(fixture.machine.machineId)
        ?.executionTransport,
      'direct',
    )
    await session.close()
    await coordinator.close()
  })
})

test('both unavailable fails the session selector without opening Relay or starting a Turn', async () => {
  await withRoutingFixture(async (fixture) => {
    const coordinator = await fixture.createCoordinator('direct_first')
    await fixture.waitUntilReady(coordinator)
    fixture.setRelayEnabled(false)
    fixture.behavior.directCodexSessionError = new MachineTransportError(
      'connection_failed',
      'direct route unavailable in deterministic fixture',
    )
    const before = fixture.snapshot()

    await assert.rejects(
      coordinator.openCodexSession(
        fixture.machine,
        fixture.trust(),
        codexSessionInput('both-unavailable'),
      ),
      (error) =>
        error?.code === 'connection_failed' &&
        error?.message === 'Remote Machine connection failed',
    )

    assert.equal(
      fixture.counts.directCodexSessions,
      before.directCodexSessions + 1,
    )
    assert.equal(fixture.counts.relayChannels, before.relayChannels)
    assert.equal(fixture.counts.relayCodexSessions, before.relayCodexSessions)
    assert.deepEqual(fixture.turnStarts, [])
    await coordinator.close()
  })
})

test('relay-only uses only the purpose-bound over-stream session seams and preserves Turn action identity', async () => {
  await withRoutingFixture(async (fixture) => {
    const coordinator = await fixture.createCoordinator('relay_only')
    await fixture.waitUntilReady(coordinator)
    const before = fixture.snapshot()

    const codex = await coordinator.openCodexSession(
      fixture.machine,
      fixture.trust(),
      codexSessionInput('relay-only-codex'),
    )
    const claude = await coordinator.openClaudeSession(
      fixture.machine,
      fixture.trust(),
      {
        conversationId: 'conv_relay_only_claude',
        projectId: 'proj_relay_only_claude',
        rootPath: '/srv/projects/relay-only',
        effort: 'high',
      },
    )

    assert.equal(fixture.counts.directCodexSessions, before.directCodexSessions)
    assert.equal(
      fixture.counts.directClaudeSessions,
      before.directClaudeSessions,
    )
    assert.equal(fixture.counts.relayChannels, before.relayChannels + 2)
    assert.equal(
      fixture.counts.relayCodexSessions,
      before.relayCodexSessions + 1,
    )
    assert.equal(
      fixture.counts.relayClaudeSessions,
      before.relayClaudeSessions + 1,
    )

    const action = {
      actionId: 'act_relay_transport_action01',
      turnId: 'turn_relay_transport_action01',
      prompt: 'safe routing fixture',
    }
    await codex.startTurn(action)
    assert.deepEqual(fixture.turnStarts, [action])

    await codex.close()
    await claude.close()
    await coordinator.close()
  })
})

test('direct-first falls back to Relay only before Machine peer authentication', async () => {
  await withRoutingFixture(async (fixture) => {
    const coordinator = await fixture.createCoordinator('direct_first')
    await fixture.waitUntilReady(coordinator)
    fixture.behavior.directCodexSessionError = new MachineTransportError(
      'connection_failed',
      'direct socket was unavailable before authentication',
    )
    const before = fixture.snapshot()

    const session = await coordinator.openCodexSession(
      fixture.machine,
      fixture.trust(),
      codexSessionInput('pre-auth-fallback'),
    )

    assert.equal(
      fixture.counts.directCodexSessions,
      before.directCodexSessions + 1,
    )
    assert.equal(fixture.counts.relayChannels, before.relayChannels + 1)
    assert.equal(
      fixture.counts.relayCodexSessions,
      before.relayCodexSessions + 1,
    )
    await session.close()
    await coordinator.close()
  })
})

test('direct identity or protocol failures stop before Relay for ordinary Machine operations', async () => {
  for (const code of ['identity_mismatch', 'protocol_incompatible']) {
    await withRoutingFixture(async (fixture) => {
      fixture.behavior.directConnectionError = new MachineTransportError(
        code,
        `private ${code} detail`,
      )
      const coordinator = await fixture.createCoordinator('direct_first')
      await assert.rejects(
        coordinator.validateProjectLocation(
          fixture.machine,
          fixture.trust(),
          '/srv/projects/relay-routing',
        ),
        (error) => error.code === code,
      )

      assert.ok(fixture.counts.directConnections >= 1)
      assert.equal(fixture.counts.relayChannels, 0)
      assert.equal(fixture.counts.relayConnections, 0)
      await coordinator.close()
    })
  }
})

test('an active Relay Turn never migrates to an available Direct path after channel loss', async () => {
  await withRoutingFixture(async (fixture) => {
    const coordinator = await fixture.createCoordinator('direct_first')
    await fixture.waitUntilReady(coordinator)
    fixture.behavior.directCodexSessionError = new MachineTransportError(
      'connection_failed',
      'direct unavailable before authentication',
    )
    const session = await coordinator.openCodexSession(
      fixture.machine,
      fixture.trust(),
      codexSessionInput('relay-loss'),
    )
    fixture.behavior.directCodexSessionError = undefined
    const directConnectionsBeforeRecovery = fixture.counts.directConnections
    assert.equal(coordinator.requestReconnect(), 1)
    await waitFor(
      () =>
        fixture.counts.directConnections ===
          directConnectionsBeforeRecovery + 1 &&
        coordinator.connectionDetails(fixture.machine.machineId)
          ?.directState === 'online',
      'alternate Direct transport requalification',
    )
    fixture.behavior.turnEventError = new MachineTransportError(
      'connection_failed',
      'raw Relay stream failure',
      { peerAuthenticated: true },
    )
    const afterOpen = fixture.snapshot()
    const action = {
      actionId: 'act_relay_loss_action01',
      turnId: 'turn_relay_loss_action01',
      prompt: 'execute once through the selected Relay transport',
    }

    const turn = await session.startTurn(action)
    const events = []
    for await (const event of turn.events()) events.push(event)

    assert.equal(events.length, 1)
    assert.equal(events[0]?.type, 'turn.failed')
    assert.equal(events[0]?.code, 'remote_execution_lost')
    assert.equal(events[0]?.failure?.reason, 'relay_channel_lost')
    assert.equal(events[0]?.failure?.retryability, 'not_retryable')
    assert.equal(events[0]?.failure?.source, 'relay')
    assert.doesNotMatch(JSON.stringify(events), /raw Relay stream failure/u)
    assert.deepEqual(fixture.turnStarts, [action])
    assert.deepEqual(fixture.snapshot(), afterOpen)

    await session.close()
    await coordinator.close()
  })
})

test('an active Direct Turn never migrates to an available Relay path after transport loss', async () => {
  await withRoutingFixture(async (fixture) => {
    const coordinator = await fixture.createCoordinator('direct_first')
    await fixture.waitUntilReady(coordinator)
    await waitFor(
      () => coordinator.relayExecutionAvailable(fixture.machine.machineId),
      'available alternate Relay transport',
    )
    const session = await coordinator.openCodexSession(
      fixture.machine,
      fixture.trust(),
      codexSessionInput('direct-loss'),
    )
    assert.equal(
      coordinator.connectionDetails(fixture.machine.machineId)
        ?.executionTransport,
      'direct',
    )
    fixture.behavior.turnEventError = new MachineTransportError(
      'connection_failed',
      'raw Direct stream failure',
      { peerAuthenticated: true },
    )
    const afterOpen = fixture.snapshot()
    const action = {
      actionId: 'act_direct_loss_action01',
      turnId: 'turn_direct_loss_action01',
      prompt: 'execute once through the selected Direct transport',
    }

    const turn = await session.startTurn(action)
    await assert.rejects(
      async () => {
        for await (const event of turn.events()) {
          // The deterministic transport fails before publishing an event.
          void event
        }
      },
      (error) => error === fixture.behavior.turnEventError,
    )

    assert.deepEqual(fixture.turnStarts, [action])
    assert.deepEqual(fixture.snapshot(), afterOpen)
    await session.close()
    await coordinator.close()
  })
})

test('an uncertain direct session open after peer authentication never falls back or poisons endpoint health', async () => {
  await withRoutingFixture(async (fixture) => {
    const coordinator = await fixture.createCoordinator('direct_first')
    await fixture.waitUntilReady(coordinator)
    fixture.behavior.directCodexSessionError = new MachineTransportError(
      'connection_failed',
      'private lost acknowledgement detail',
      { peerAuthenticated: true },
    )
    const before = fixture.snapshot()
    const endpointBefore = fixture.trust().endpoints[0]

    await assert.rejects(
      coordinator.openCodexSession(
        fixture.machine,
        fixture.trust(),
        codexSessionInput('authenticated-uncertainty'),
      ),
      (error) =>
        error.code === 'connection_failed' &&
        error.message === 'Remote Machine connection failed' &&
        !error.message.includes('private lost acknowledgement'),
    )

    assert.equal(
      fixture.counts.directCodexSessions,
      before.directCodexSessions + 1,
    )
    assert.equal(fixture.counts.relayChannels, before.relayChannels)
    assert.equal(fixture.counts.relayCodexSessions, before.relayCodexSessions)
    assert.equal(
      fixture.trust().endpoints[0]?.lastFailureAt,
      endpointBefore?.lastFailureAt,
    )
    await coordinator.close()
  })
})

test('effective Relay availability retains the failed direct state separately', async () => {
  await withRoutingFixture(async (fixture) => {
    fixture.behavior.directConnectionError = new MachineTransportError(
      'connection_failed',
      'direct network unavailable',
    )
    const coordinator = await fixture.createCoordinator('direct_first')
    await fixture.waitUntilReady(coordinator)

    const details = coordinator.connectionDetails(fixture.machine.machineId)
    assert.equal(details?.state, 'online')
    assert.equal(details?.directState, 'offline')
    assert.equal(details?.executionTransport, 'relay')
    assert.ok(fixture.counts.directConnections >= 1)
    assert.ok(fixture.counts.relayConnections >= 1)
    assert.equal(
      coordinator.relayExecutionAvailable(fixture.machine.machineId),
      true,
      'the inner paired Machine handshake establishes Relay eligibility',
    )
    fixture.setRelayEnabled(false)
    assert.equal(
      coordinator.relayExecutionAvailable(fixture.machine.machineId),
      false,
      'a Relay epoch loss invalidates the prior Machine authentication proof',
    )

    await coordinator.close()
  })
})

test('duplicate Relay-ready signals retain one pending Machine reconnect worker', async () => {
  await withRoutingFixture(async (fixture) => {
    const coordinator = await fixture.createCoordinator('direct_first')
    await fixture.waitUntilReady(coordinator)
    let releaseReplacement
    const replacementGate = new Promise((resolve) => {
      releaseReplacement = resolve
    })
    fixture.behavior.directConnectionGates.push(replacementGate)
    const before = fixture.snapshot()

    assert.equal(coordinator.requestReconnect(), 1)
    await waitFor(
      () => fixture.counts.directConnections === before.directConnections + 1,
      'held replacement Direct dial',
    )
    fixture.setRelayEnabled(true)
    fixture.setRelayEnabled(true)
    releaseReplacement()

    await waitFor(
      () => coordinator.connectionState(fixture.machine.machineId) === 'online',
      'single replacement Machine route',
    )
    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.equal(fixture.counts.directConnections, before.directConnections + 1)
    await coordinator.close()
  })
})

test('Relay verification restarts after a reconnect races an in-flight verification', async () => {
  await withRoutingFixture(async (fixture) => {
    fixture.behavior.ignoreRelayVerificationAbort = true
    let releaseRelayHandshake
    fixture.behavior.relayConnectionGate = new Promise((resolve) => {
      releaseRelayHandshake = resolve
    })
    const coordinator = await fixture.createCoordinator('direct_first')
    await fixture.waitUntilReady(coordinator)
    await waitFor(
      () => fixture.counts.relayConnections === 1,
      'in-flight Relay Machine verification',
    )

    fixture.setRelayEnabled(false)
    fixture.setRelayEnabled(true)
    releaseRelayHandshake()

    await waitFor(
      () => coordinator.relayExecutionAvailable(fixture.machine.machineId),
      'replacement Relay Machine verification',
    )
    assert.equal(
      fixture.counts.relayConnections,
      2,
      'the current Relay epoch receives a fresh inner Machine authentication',
    )
    await coordinator.close()
  })
})

for (const provider of ['codex', 'claude']) {
  test(`${provider} session authentication from an old Relay epoch cannot qualify its replacement`, async () => {
    await withRoutingFixture(async (fixture) => {
      const coordinator = await fixture.createCoordinator('relay_only')
      await fixture.waitUntilReady(coordinator)
      const sessionGate = deferred()
      const replacementVerificationGate = deferred()
      if (provider === 'codex') {
        fixture.behavior.relayCodexSessionGate = sessionGate.promise
      } else {
        fixture.behavior.relayClaudeSessionGate = sessionGate.promise
      }
      fixture.behavior.relayConnectionGates.push(
        replacementVerificationGate.promise,
      )
      const sessionCount =
        provider === 'codex'
          ? fixture.counts.relayCodexSessions
          : fixture.counts.relayClaudeSessions
      const verificationCount = fixture.counts.relayConnections
      const opening =
        provider === 'codex'
          ? coordinator.openCodexSession(
              fixture.machine,
              fixture.trust(),
              codexSessionInput('stale-epoch-codex'),
            )
          : coordinator.openClaudeSession(fixture.machine, fixture.trust(), {
              conversationId: 'conv_relay_stale_epoch_claude',
              projectId: 'proj_relay_stale_epoch_claude',
              rootPath: '/srv/projects/relay-routing',
              effort: 'high',
            })

      await waitFor(
        () =>
          (provider === 'codex'
            ? fixture.counts.relayCodexSessions
            : fixture.counts.relayClaudeSessions) ===
          sessionCount + 1,
        `${provider} inner Machine authentication`,
      )
      const staleStream = fixture.latestRelayStream()
      assert.ok(staleStream)

      fixture.setRelayEnabled(false)
      fixture.setRelayEnabled(true)
      await waitFor(
        () => fixture.counts.relayConnections === verificationCount + 1,
        'replacement Relay epoch verification',
      )
      sessionGate.resolve()

      await assert.rejects(
        opening,
        (error) =>
          error?.code === 'connection_failed' &&
          error?.failure?.source === 'relay',
      )
      assert.equal(staleStream.destroyed, true)
      assert.equal(
        coordinator.relayExecutionAvailable(fixture.machine.machineId),
        false,
        'the old inner authentication cannot qualify the replacement epoch',
      )

      replacementVerificationGate.resolve()
      await waitFor(
        () => coordinator.relayExecutionAvailable(fixture.machine.machineId),
        'current Relay epoch verification',
      )
      await coordinator.close()
    })
  })
}

test('generic Machine authentication from an old Relay epoch is discarded with its stream', async () => {
  await withRoutingFixture(async (fixture) => {
    const coordinator = await fixture.createCoordinator('relay_only')
    await fixture.waitUntilReady(coordinator)
    const staleConnectionGate = deferred()
    const replacementVerificationGate = deferred()
    fixture.behavior.relayConnectionGates.push(
      staleConnectionGate.promise,
      replacementVerificationGate.promise,
    )
    const connectionCount = fixture.counts.relayConnections
    const validating = coordinator.validateProjectLocation(
      fixture.machine,
      fixture.trust(),
      '/srv/projects/relay-routing',
    )

    await waitFor(
      () => fixture.counts.relayConnections === connectionCount + 1,
      'generic inner Machine authentication',
    )
    const staleStream = fixture.latestRelayStream()
    assert.ok(staleStream)

    fixture.setRelayEnabled(false)
    fixture.setRelayEnabled(true)
    await waitFor(
      () => fixture.counts.relayConnections === connectionCount + 2,
      'replacement generic Relay verification',
    )
    staleConnectionGate.resolve()

    await assert.rejects(
      validating,
      (error) =>
        error?.code === 'connection_failed' &&
        error?.failure?.source === 'relay',
    )
    assert.equal(staleStream.destroyed, true)
    assert.equal(
      coordinator.relayExecutionAvailable(fixture.machine.machineId),
      false,
      'the stale generic route cannot qualify the replacement epoch',
    )

    replacementVerificationGate.resolve()
    await waitFor(
      () => coordinator.relayExecutionAvailable(fixture.machine.machineId),
      'replacement generic Relay verification completion',
    )
    await coordinator.close()
  })
})

test('coordinator close cannot restart an aborted Relay verification', async () => {
  await withRoutingFixture(async (fixture) => {
    let releaseRelayHandshake
    fixture.behavior.relayConnectionGate = new Promise((resolve) => {
      releaseRelayHandshake = resolve
    })
    const coordinator = await fixture.createCoordinator('direct_first')
    await fixture.waitUntilReady(coordinator)
    await waitFor(
      () => fixture.counts.relayConnections === 1,
      'in-flight Relay Machine verification',
    )

    fixture.setRelayEnabled(false)
    const closing = coordinator.close()
    releaseRelayHandshake()
    await closing
    fixture.setRelayEnabled(true)
    await new Promise((resolve) => setTimeout(resolve, 20))

    assert.equal(fixture.counts.relayConnections, 1)
    assert.equal(
      coordinator.relayExecutionAvailable(fixture.machine.machineId),
      false,
    )
  })
})

test('the last execution-session release publishes an idle-route failure that was suppressed during work', async () => {
  await withRoutingFixture(async (fixture) => {
    fixture.setRelayEnabled(false)
    const coordinator = await fixture.createCoordinator('direct_only', {
      heartbeatIntervalMs: 5,
    })
    await fixture.waitUntilReady(coordinator)
    const session = await coordinator.openCodexSession(
      fixture.machine,
      fixture.trust(),
      codexSessionInput('idle-route-loss'),
    )
    const beforePing = fixture.counts.pings
    fixture.behavior.machinePingError = new MachineTransportError(
      'identity_mismatch',
      'idle route reached the wrong peer',
      { peerAuthenticated: true },
    )

    await waitFor(
      () => fixture.counts.pings > beforePing,
      'idle route failure during an active execution session',
    )
    assert.equal(
      coordinator.connectionState(fixture.machine.machineId),
      'online',
      'the independent live execution session keeps the Machine online',
    )

    await session.close()
    await waitFor(
      () =>
        coordinator.connectionState(fixture.machine.machineId) ===
        'authentication_failed',
      'deferred idle route failure after the last session release',
    )
    await coordinator.close()
  })
})

test('Relay channel failures map only to bounded canonical diagnostics', async () => {
  await withRoutingFixture(async (fixture) => {
    const coordinator = await fixture.createCoordinator('direct_first')
    await fixture.waitUntilReady(coordinator)
    fixture.behavior.directCodexSessionError = new MachineTransportError(
      'connection_failed',
      'direct unavailable',
    )

    for (const [relayError, expectedReason] of [
      [
        {
          reason: 'relay_peer_offline',
          message: '<script>fake login</script>\nAuthorization: Bearer secret',
        },
        'relay_peer_offline',
      ],
      [
        new Error('ECONNRESET raw Relay socket detail'),
        'relay_channel_open_failed',
      ],
      [
        {
          reason: 'provider_crashed',
          message: 'a non-Relay reason must not cross the Relay boundary',
        },
        'relay_channel_open_failed',
      ],
    ]) {
      fixture.behavior.relayChannelError = relayError
      await assert.rejects(
        coordinator.openCodexSession(
          fixture.machine,
          fixture.trust(),
          codexSessionInput(`failure-${expectedReason}`),
        ),
        (error) => {
          const publicDiagnostic = JSON.stringify({
            code: error.code,
            message: error.message,
            failure: error.failure,
          })
          return (
            error.code === 'connection_failed' &&
            error.message ===
              'Internet Relay Machine transport is unavailable' &&
            error.failure?.reason === expectedReason &&
            error.failure?.source === 'relay' &&
            error.failure?.technicalCode === expectedReason &&
            !/script|Authorization|Bearer|secret|ECONNRESET|socket detail/iu.test(
              publicDiagnostic,
            )
          )
        },
      )
    }

    await coordinator.close()
  })
})

test('cold Machine status and Provider eligibility reads never open a Relay channel', async () => {
  await withRoutingFixture(async (fixture) => {
    const coordinator = await fixture.createCoordinator('direct_first')
    await fixture.waitUntilReady(coordinator)
    const before = fixture.snapshot()

    for (let index = 0; index < 100; index += 1) {
      assert.equal(
        coordinator.connectionState(fixture.machine.machineId),
        'online',
      )
      assert.equal(
        coordinator.connectionDetails(fixture.machine.machineId)
          ?.executionTransport,
        'direct',
      )
      assert.equal(
        coordinator.providerExecutionAvailable(
          fixture.machine.machineId,
          'codex',
        ),
        true,
      )
    }

    assert.deepEqual(fixture.snapshot(), before)
    await coordinator.close()
  })
})

test('relay-only unpair uses one dedicated revocation channel without Provider execution', async () => {
  await withRoutingFixture(async (fixture) => {
    const coordinator = await fixture.createCoordinator('relay_only')
    await fixture.waitUntilReady(coordinator)
    const before = fixture.snapshot()
    const revoking = fixture.beginRevoking()

    await coordinator.unpair(fixture.machine, revoking)

    assert.equal(
      fixture.counts.relayRevocationChannels,
      before.relayRevocationChannels + 1,
    )
    assert.equal(fixture.counts.revocations, before.revocations + 1)
    assert.equal(fixture.counts.directConnections, before.directConnections)
    assert.equal(fixture.counts.directCodexSessions, before.directCodexSessions)
    assert.equal(fixture.counts.relayCodexSessions, before.relayCodexSessions)
    await coordinator.close()
  })
})

test('Host restart resumes an exact durable Relay revocation without restoring active trust', async () => {
  await withRoutingFixture(async (fixture) => {
    fixture.beginRevoking()
    const coordinator = await fixture.createCoordinator('relay_only')

    await waitFor(
      () => fixture.machineExists() === false,
      'durable Relay revocation recovery',
    )
    assert.equal(fixture.counts.relayRevocationChannels, 1)
    assert.equal(fixture.counts.revocations, 1)
    assert.equal(fixture.counts.directConnections, 0)
    await coordinator.close()
  })
})

test('lost Relay revocation acknowledgement stays durably revoking without Direct fallback or replay', async () => {
  await withRoutingFixture(async (fixture) => {
    const coordinator = await fixture.createCoordinator('relay_only')
    await fixture.waitUntilReady(coordinator)
    const before = fixture.snapshot()
    const revoking = fixture.beginRevoking()
    fixture.behavior.revocationError = new MachineTransportError(
      'connection_failed',
      'private acknowledgement loss after trust.revoke write',
      { peerAuthenticated: true },
    )
    fixture.behavior.disableRelayAfterRevocationError = true

    await assert.rejects(
      coordinator.unpair(fixture.machine, revoking),
      (error) => error instanceof RemoteMachineRevocationPendingError,
    )

    assert.equal(fixture.trust().trustState, 'revoking')
    assert.equal(
      fixture.counts.relayRevocationChannels,
      before.relayRevocationChannels + 1,
    )
    assert.equal(fixture.counts.revocations, before.revocations + 1)
    assert.equal(fixture.counts.directConnections, before.directConnections)
    assert.equal(fixture.machineExists(), true)
    await coordinator.close()
  })
})

async function withRoutingFixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-relay-routing-'))
  const credentialDirectory = join(directory, 'machine-credentials')
  await mkdir(credentialDirectory, { recursive: true })
  const credentialRef = 'controller_relayrouting01.json'
  const controllerIdentity = await createMachineTlsIdentityFile(
    join(credentialDirectory, credentialRef),
    'CodeTether Controller',
  )
  const store = ConversationStore.open({
    databasePath: join(directory, 'codetether.sqlite3'),
  })
  const machine = {
    machineId: 'machine_relayrouting01',
    displayName: 'Relay routing fixture',
    kind: 'remote',
    platform: 'Linux',
    architecture: 'x64',
    createdAt: timestamp,
  }
  const endpoint = { host: '192.0.2.40', port: 43_217 }
  store.createRemoteMachineWithTrust(machine, {
    machineId: machine.machineId,
    nodeIdentity: 'node_relayrouting01',
    peerPublicKeySpki: new Uint8Array(64).fill(7),
    peerKeyFingerprint: 'N'.repeat(43),
    controllerCredentialRef: credentialRef,
    controllerKeyFingerprint: controllerIdentity.publicKeyFingerprint,
    trustState: 'pending',
    protocolVersion: 1,
    address: endpoint,
    pairedAt: timestamp,
    updatedAt: timestamp,
  })
  store.activateTrustedMachinePeer(machine.machineId, timestamp)

  const behavior = {
    relayEnabled: true,
    relayEpoch: 1,
    directConnectionError: undefined,
    directConnectionGates: [],
    relayConnectionError: undefined,
    relayConnectionGate: undefined,
    relayConnectionGates: [],
    ignoreRelayVerificationAbort: false,
    directCodexSessionError: undefined,
    directClaudeSessionError: undefined,
    relayCodexSessionError: undefined,
    relayClaudeSessionError: undefined,
    relayCodexSessionGate: undefined,
    relayClaudeSessionGate: undefined,
    relayChannelError: undefined,
    machinePingError: undefined,
    turnEventError: undefined,
    revocationError: undefined,
    disableRelayAfterRevocationError: false,
  }
  const counts = {
    directConnections: 0,
    relayConnections: 0,
    directCodexSessions: 0,
    relayCodexSessions: 0,
    directClaudeSessions: 0,
    relayClaudeSessions: 0,
    relayChannels: 0,
    relayRevocationChannels: 0,
    revocations: 0,
    discoveries: 0,
    pings: 0,
  }
  const turnStarts = []
  const relayStreams = new Set()
  const relayStreamHistory = []
  const relayListeners = new Set()
  const transport = {
    async beginPairing() {
      throw new Error('Pairing is outside the Relay routing fixture')
    },
    async connectTrusted(input) {
      counts.directConnections += 1
      await behavior.directConnectionGates.shift()
      if (behavior.directConnectionError !== undefined) {
        throw behavior.directConnectionError
      }
      return machineConnection(input)
    },
    async connectTrustedOverStream(input) {
      counts.relayConnections += 1
      await (behavior.relayConnectionGates.shift() ??
        behavior.relayConnectionGate)
      if (
        input.signal?.aborted === true &&
        !behavior.ignoreRelayVerificationAbort
      ) {
        throw new Error('Relay Machine verification was aborted')
      }
      if (behavior.relayConnectionError !== undefined) {
        throw behavior.relayConnectionError
      }
      return machineConnection(input, input.stream)
    },
    async openCodexSession(input) {
      counts.directCodexSessions += 1
      if (behavior.directCodexSessionError !== undefined) {
        throw behavior.directCodexSessionError
      }
      return codexSession(input)
    },
    async openCodexSessionOverStream(input) {
      counts.relayCodexSessions += 1
      await behavior.relayCodexSessionGate
      if (behavior.relayCodexSessionError !== undefined) {
        throw behavior.relayCodexSessionError
      }
      return codexSession(input, input.stream)
    },
    async openClaudeSession(input) {
      counts.directClaudeSessions += 1
      if (behavior.directClaudeSessionError !== undefined) {
        throw behavior.directClaudeSessionError
      }
      return claudeSession(input)
    },
    async openClaudeSessionOverStream(input) {
      counts.relayClaudeSessions += 1
      await behavior.relayClaudeSessionGate
      if (behavior.relayClaudeSessionError !== undefined) {
        throw behavior.relayClaudeSessionError
      }
      return claudeSession(input, input.stream)
    },
  }
  const relayTransport = {
    status() {
      return { internetExecutionEnabled: behavior.relayEnabled }
    },
    connectionEpoch() {
      return behavior.relayEnabled
        ? `relay_connection_fixture_${behavior.relayEpoch}`
        : undefined
    },
    async openMachineChannel(_trust, signal) {
      counts.relayChannels += 1
      if (signal?.aborted === true) throw new Error('Relay channel aborted')
      if (behavior.relayChannelError !== undefined) {
        throw behavior.relayChannelError
      }
      const stream = new PassThrough()
      relayStreams.add(stream)
      relayStreamHistory.push(stream)
      stream.once('close', () => relayStreams.delete(stream))
      return stream
    },
    async openMachineRevocationChannel(_trust, signal) {
      counts.relayRevocationChannels += 1
      if (signal?.aborted === true) throw new Error('Relay channel aborted')
      const stream = new PassThrough()
      relayStreams.add(stream)
      relayStreamHistory.push(stream)
      stream.once('close', () => relayStreams.delete(stream))
      return stream
    },
    subscribe(listener) {
      relayListeners.add(listener)
      return () => relayListeners.delete(listener)
    },
  }
  const coordinators = new Set()

  const fixture = {
    behavior,
    counts,
    endpoint,
    machine,
    turnStarts,
    trust() {
      const trust = store.getTrustedMachinePeer(machine.machineId)
      assert.ok(trust)
      return trust
    },
    beginRevoking() {
      return store.markTrustedMachinePeerRevoking(machine.machineId, timestamp)
    },
    machineExists() {
      return store.getMachine(machine.machineId) !== undefined
    },
    latestRelayStream() {
      return relayStreamHistory.at(-1)
    },
    snapshot() {
      return { ...counts }
    },
    setRelayEnabled(enabled) {
      if (enabled && !behavior.relayEnabled) behavior.relayEpoch += 1
      behavior.relayEnabled = enabled
      for (const listener of relayListeners) listener(machine.machineId)
    },
    async createCoordinator(transportPolicy, options = {}) {
      const coordinator = await SecureRemoteMachineCoordinator.create({
        persistence: store,
        credentialDirectory,
        transport,
        relayTransport,
        transportPolicy,
        heartbeatIntervalMs: options.heartbeatIntervalMs ?? 60_000,
        reconnectMaximumDelayMs: 20,
        now: () => new Date(timestamp),
        random: () => 0.5,
      })
      coordinators.add(coordinator)
      return coordinator
    },
    async waitUntilReady(coordinator) {
      await waitFor(
        () => coordinator.connectionState(machine.machineId) === 'online',
        'Machine online',
      )
      await waitFor(
        () =>
          coordinator.providerExecutionAvailable(machine.machineId, 'codex') &&
          coordinator.providerExecutionAvailable(
            machine.machineId,
            'claude-code',
          ),
        'Provider discovery',
      )
    },
  }

  let failure
  try {
    await run(fixture)
  } catch (error) {
    failure = error
  }
  for (const coordinator of coordinators) {
    await coordinator.close().catch(() => undefined)
  }
  for (const stream of relayStreams) stream.destroy()
  store.close()
  await rm(directory, { recursive: true, force: true })
  if (failure !== undefined) throw failure

  function machineConnection(_input, stream) {
    let closed = false
    return {
      async ping() {
        counts.pings += 1
        if (behavior.machinePingError !== undefined) {
          throw behavior.machinePingError
        }
      },
      async validateProjectLocation(rootPath) {
        return {
          canonicalPath: rootPath,
          basename: 'project',
          exists: true,
          directory: true,
        }
      },
      async discoverProviders() {
        counts.discoveries += 1
        return remoteProviderDiscovery()
      },
      async revoke() {
        counts.revocations += 1
        if (behavior.revocationError !== undefined) {
          if (behavior.disableRelayAfterRevocationError) {
            behavior.relayEnabled = false
          }
          throw behavior.revocationError
        }
      },
      close() {
        if (closed) return
        closed = true
        stream?.destroy()
      },
    }
  }

  function codexSession(input, stream) {
    return providerSession({
      input,
      stream,
      providerIdentity: input.providerThreadId ?? 'thread_relay_routing01',
      providerIdentityKey: 'providerThreadId',
      executionProfile: 'codex-text-v1',
    })
  }

  function claudeSession(input, stream) {
    return providerSession({
      input,
      stream,
      providerIdentity:
        input.providerSessionId ?? '123e4567-e89b-42d3-a456-426614174000',
      providerIdentityKey: 'providerSessionId',
      executionProfile: 'claude-restricted-read-search-v1',
    })
  }

  function providerSession({
    executionProfile,
    input,
    providerIdentity,
    providerIdentityKey,
    stream,
  }) {
    let closed = false
    return {
      machine: {
        machineId: machine.machineId,
        nodeId: 'node_relayrouting01',
        displayName: machine.displayName,
        platform: machine.platform,
        architecture: machine.architecture,
      },
      conversationId: input.conversationId,
      [providerIdentityKey]: providerIdentity,
      resumed: false,
      executionProfile,
      ...(input.effort === undefined ? {} : { effort: input.effort }),
      get closed() {
        return closed
      },
      async startTurn(turnInput) {
        turnStarts.push({ ...turnInput })
        return {
          events() {
            let finished = false
            return {
              [Symbol.asyncIterator]() {
                return this
              },
              async next() {
                if (finished) return { done: true, value: undefined }
                finished = true
                if (behavior.turnEventError !== undefined) {
                  throw behavior.turnEventError
                }
                return { done: true, value: undefined }
              },
            }
          },
        }
      },
      async close() {
        if (closed) return
        closed = true
        stream?.destroy()
      },
    }
  }
}

function codexSessionInput(suffix) {
  return {
    conversationId: `conv_relay_${suffix}`,
    projectId: `proj_relay_${suffix}`,
    rootPath: '/srv/projects/relay-routing',
  }
}

function remoteProviderDiscovery() {
  const unavailableCapabilities = {
    streaming: false,
    resume: false,
    interrupt: false,
    approvals: false,
    fileRead: false,
    fileEdit: false,
    shell: false,
    search: false,
    diff: false,
    toolEvents: false,
    modelSelection: false,
    reasoningControl: false,
  }
  return {
    providers: [
      {
        provider: 'codex',
        displayName: 'Codex',
        availability: 'available',
        version: '1.2.3',
        capabilities: {
          ...unavailableCapabilities,
          streaming: true,
          resume: true,
        },
      },
      {
        provider: 'claude-code',
        displayName: 'Claude Code',
        availability: 'available',
        version: '2.1.251',
        capabilities: {
          ...unavailableCapabilities,
          streaming: true,
          resume: true,
          fileRead: true,
          search: true,
          toolEvents: true,
          reasoningControl: true,
        },
        reasoningLabel: '思考强度',
        reasoningOptions: [
          { id: 'low', label: '低' },
          { id: 'medium', label: '中' },
          { id: 'high', label: '高' },
          { id: 'xhigh', label: '超高' },
          { id: 'max', label: '最大' },
        ],
      },
    ],
    observedAt: timestamp,
  }
}

async function waitFor(predicate, label, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out: ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
