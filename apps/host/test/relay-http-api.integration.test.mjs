import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  CodeTetherClient,
  CodeTetherResponseError,
} from '../../../packages/client/dist/index.js'

import { ControllerRelayCoordinatorError } from '../dist/api/controller-relay-coordinator.js'
import { HostEventPublisher } from '../dist/api/host-event-publisher.js'
import { HostService, newEpoch } from '../dist/api/host-service.js'
import { LocalHttpServer } from '../dist/api/local-http-server.js'
import { WorkspacePolicy } from '../dist/api/workspace-policy.js'
import { ConversationStore } from '../dist/persistence/index.js'

const timestamp = '2026-09-03T18:00:00.000Z'
const machineId = 'machine_relayhttpapi01'
const fingerprint = 'r'.repeat(43)
const enrollmentToken = `relay_enroll_${'t'.repeat(43)}`

test('Host and typed Client expose only bounded Relay control operations', async () => {
  const fixture = await createFixture()
  try {
    const initial = await fixture.client.getMachine(machineId)
    assert.deepEqual(initial.relay, notConfigured())

    const configured = await fixture.client.configureMachineRelay(machineId, {
      actionId: 'act_relayhttpconfigure01',
      endpoint: {
        host: '39.104.94.53',
        port: 443,
        transportSecurity: 'pinned_identity',
      },
      relayIdentityFingerprint: fingerprint,
      displayLabel: 'Owner Relay',
    })
    assert.equal(configured.data.relay.state, 'enrollment_required')

    const duplicate = await fixture.client.configureMachineRelay(machineId, {
      actionId: 'act_relayhttpconfigure01',
      endpoint: {
        host: '39.104.94.53',
        port: 443,
        transportSecurity: 'pinned_identity',
      },
      relayIdentityFingerprint: fingerprint,
      displayLabel: 'Owner Relay',
    })
    assert.deepEqual(duplicate, configured)
    assert.equal(
      fixture.relay.calls.filter((call) => call.type === 'configure').length,
      1,
    )

    const enrolled = await fixture.client.enrollMachineRelay(machineId, {
      actionId: 'act_relayhttpenroll01',
      enrollmentToken,
    })
    assert.equal(enrolled.data.relay.state, 'connected')
    assert.equal(enrolled.data.relay.internetExecutionEnabled, false)
    assert.equal(fixture.relay.calls.at(-1).type, 'enroll')
    assert.equal(fixture.relay.calls.at(-1).token, enrollmentToken)

    assert.equal(
      (
        await fixture.client.disconnectMachineRelay(machineId, {
          actionId: 'act_relayhttpdisconnect01',
        })
      ).data.relay.state,
      'offline',
    )
    assert.equal(
      (
        await fixture.client.retryMachineRelay(machineId, {
          actionId: 'act_relayhttpretry01',
        })
      ).data.relay.state,
      'reconnecting',
    )
    assert.deepEqual(
      (
        await fixture.client.removeMachineRelay(machineId, {
          actionId: 'act_relayhttpremove01',
        })
      ).data.relay,
      notConfigured(),
    )

    const detail = await fixture.client.getMachine(machineId)
    assert.deepEqual(detail.relay, notConfigured())
    assert.equal(detail.machine.connectionState, 'offline')
    assert.equal(detail.machine.capabilities.providerExecution, false)
  } finally {
    await fixture.close()
  }
})

test('Relay boundary maps private connection failures to canonical safe diagnostics', async () => {
  const fixture = await createFixture()
  try {
    fixture.relay.configureFailure = new ControllerRelayCoordinatorError(
      'relay_identity_mismatch',
      'PRIVATE TLS socket details Authorization: secret',
    )
    await assert.rejects(
      fixture.client.configureMachineRelay(machineId, {
        actionId: 'act_relayhttpfailure01',
        endpoint: {
          host: 'relay.example.test',
          port: 443,
          transportSecurity: 'public_ca',
        },
        relayIdentityFingerprint: fingerprint,
      }),
      (error) => {
        assert.ok(error instanceof CodeTetherResponseError)
        assert.equal(error.envelope.code, 'relay_identity_mismatch')
        assert.equal(error.envelope.failure.reason, 'relay_identity_mismatch')
        assert.equal(error.envelope.failure.source, 'relay')
        assert.doesNotMatch(
          JSON.stringify(error.envelope),
          /PRIVATE|TLS socket|Authorization|secret/u,
        )
        return true
      },
    )
  } finally {
    await fixture.close()
  }
})

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-relay-http-'))
  const persistence = ConversationStore.open({
    databasePath: join(directory, 'codetether.sqlite3'),
  })
  const candidate = remoteCandidate()
  persistence.createRemoteMachineWithTrust(candidate.machine, candidate.trust)
  persistence.activateTrustedMachinePeer(machineId, timestamp)
  const relay = new FakeControllerRelayCoordinator()
  const service = new HostService({
    runtime: new ReadOnlyRuntime(),
    workspacePolicy: await WorkspacePolicy.create([]),
    publisher: new HostEventPublisher({ epoch: newEpoch() }),
    hostVersion: 'phase7a-relay-http-test',
    now: () => new Date(timestamp),
    persistence,
    remoteMachineCoordinator: new OfflineRemoteMachineCoordinator(),
    controllerRelayCoordinator: relay,
  })
  const server = new LocalHttpServer({
    service,
    allowedOrigins: [],
  })
  const baseUrl = await server.start(0)
  const client = new CodeTetherClient({ baseUrl })
  return {
    client,
    relay,
    async close() {
      await server.close().catch(() => undefined)
      await service.close().catch(() => undefined)
      await rm(directory, { recursive: true, force: true })
    },
  }
}

class FakeControllerRelayCoordinator {
  calls = []
  configureFailure = undefined
  #status = notConfigured()
  #listeners = new Set()

  status() {
    return this.#status
  }

  subscribe(listener) {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async configure(_trust, input) {
    this.calls.push({ type: 'configure', input })
    if (this.configureFailure !== undefined) throw this.configureFailure
    return this.#set({
      ...configuredBase(input),
      state: 'enrollment_required',
      enrollment: 'required',
    })
  }

  async enroll(_trust, token) {
    this.calls.push({ type: 'enroll', token })
    return this.#set({
      ...this.#status,
      state: 'connected',
      enrollment: 'enrolled',
      nodePresence: 'online',
    })
  }

  async retry() {
    this.calls.push({ type: 'retry' })
    return this.#set({
      ...this.#status,
      state: 'reconnecting',
      enrollment: 'enrolled',
      nodePresence: 'not_observed',
    })
  }

  async disconnect() {
    this.calls.push({ type: 'disconnect' })
    return this.#set({
      ...this.#status,
      state: 'offline',
      enrollment: 'enrolled',
      nodePresence: 'not_observed',
    })
  }

  async remove() {
    this.calls.push({ type: 'remove' })
    return this.#set(notConfigured())
  }

  async close() {}

  #set(status) {
    this.#status = status
    for (const listener of this.#listeners) listener(machineId, status)
    return status
  }
}

class OfflineRemoteMachineCoordinator {
  connectionState(id) {
    return id === machineId ? 'offline' : undefined
  }

  connectionDetails(id) {
    return id === machineId ? { state: 'offline' } : undefined
  }

  subscribeStatus() {
    return () => undefined
  }

  async close() {}
}

class ReadOnlyRuntime {
  provider = 'codex'
  descriptor = {
    provider: 'codex',
    displayName: 'Codex',
    availability: 'available',
    capabilities: {
      streaming: true,
      resume: true,
      interrupt: true,
      approvals: true,
      fileRead: true,
      fileEdit: true,
      shell: true,
      search: true,
      diff: true,
      toolEvents: true,
      modelSelection: true,
      reasoningControl: true,
    },
  }

  subscribeEvents() {
    return () => undefined
  }

  subscribeFailures() {
    return () => undefined
  }

  subscribeApprovals() {
    return () => undefined
  }

  async close() {}
}

function configuredBase(input) {
  return {
    endpoint: input.endpoint,
    relayIdentityFingerprint: input.relayIdentityFingerprint,
    ...(input.displayLabel === undefined
      ? {}
      : { displayLabel: input.displayLabel }),
    nodePresence: 'not_observed',
    internetExecutionEnabled: false,
  }
}

function notConfigured() {
  return {
    state: 'not_configured',
    enrollment: 'not_configured',
    nodePresence: 'not_observed',
    internetExecutionEnabled: false,
  }
}

function remoteCandidate() {
  return {
    machine: {
      machineId,
      displayName: 'Relay HTTP fixture',
      kind: 'remote',
      platform: 'Linux',
      architecture: 'x64',
      createdAt: timestamp,
    },
    trust: {
      machineId,
      nodeIdentity: 'node_relayhttpapi01',
      peerPublicKeySpki: new Uint8Array(64).fill(1),
      peerKeyFingerprint: 'n'.repeat(43),
      controllerCredentialRef: 'controller_relayhttpapi01.json',
      controllerKeyFingerprint: 'c'.repeat(43),
      trustState: 'pending',
      protocolVersion: 1,
      address: { host: '192.0.2.50', port: 43_217 },
      pairedAt: timestamp,
      updatedAt: timestamp,
    },
  }
}
