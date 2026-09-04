import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { HostEventPublisher } from '../dist/api/host-event-publisher.js'
import {
  HostService,
  HostServiceError,
  newEpoch,
} from '../dist/api/host-service.js'
import { WorkspacePolicy } from '../dist/api/workspace-policy.js'
import { ConversationStore } from '../dist/persistence/conversation-store.js'
import { normalizeTrustedProjectRoot } from '../dist/project-path.js'

const timestamp = '2026-09-04T12:00:00.000Z'
const machineId = 'machine_phase7bcross01'
const projectId = 'proj_phase7bcross01'
const remoteRoot = '/srv/projects/phase7b-cross-transport'

test('a Relay-labelled Start action replays its exact Turn after Direct becomes current', async (t) => {
  const fixture = await createFixture(t)
  const turnEvents = fixture.coordinator.holdTurnEvents()
  const request = {
    actionId: 'act_phase7b_relay_replay01',
    input: {
      type: 'text',
      text: 'Execute exactly once across transport state',
    },
  }

  fixture.coordinator.setExecutionTransport('relay')
  const first = await fixture.service.startTurn(fixture.conversationId, request)
  fixture.coordinator.setExecutionTransport('direct')
  const replay = await fixture.service.startTurn(
    fixture.conversationId,
    request,
  )

  assert.deepEqual(replay, first)
  assert.equal(
    fixture.coordinator.connectionDetails(machineId).executionTransport,
    'direct',
  )
  assert.deepEqual(
    fixture.coordinator.providerSessionOpens.map((open) => open.transport),
    ['relay'],
  )
  assert.equal(fixture.coordinator.relaySessionOpens, 1)
  assert.equal(fixture.coordinator.directSessionOpens, 0)
  assert.equal(fixture.coordinator.providerTurnStarts.length, 1)
  assert.equal(
    fixture.coordinator.providerTurnStarts[0].actionId,
    request.actionId,
  )
  assert.equal(
    fixture.coordinator.providerTurnStarts[0].turnId,
    first.data.turn.turnId,
  )

  await assert.rejects(
    fixture.service.startTurn(fixture.conversationId, {
      ...request,
      input: { type: 'text', text: 'A changed Prompt must conflict' },
    }),
    (error) =>
      error instanceof HostServiceError &&
      error.code === 'conflict' &&
      error.httpStatus === 409,
  )
  assert.equal(fixture.coordinator.providerSessionOpens.length, 1)
  assert.equal(fixture.coordinator.providerTurnStarts.length, 1)

  turnEvents.release()
  const completed = await waitForConversationStatus(
    fixture.service,
    fixture.conversationId,
    'completed',
  )
  assert.equal(completed.runtime.turns.length, 1)
  assert.equal(completed.runtime.turns[0].turnId, first.data.turn.turnId)
})

test('simultaneous Direct/Relay Start actions admit one Provider Turn and one transport open', async (t) => {
  const fixture = await createFixture(t)
  const turnEvents = fixture.coordinator.holdTurnEvents()
  const opening = fixture.coordinator.holdNextProviderSessionOpen()
  fixture.coordinator.setExecutionTransport('relay')

  const relayLabelled = fixture.service.startTurn(fixture.conversationId, {
    actionId: 'act_phase7b_racing_relay01',
    input: { type: 'text', text: 'First racing request' },
  })
  const competing = fixture.service.startTurn(fixture.conversationId, {
    actionId: 'act_phase7b_racing_direct01',
    input: { type: 'text', text: 'Second racing request' },
  })
  const outcomes = Promise.allSettled([relayLabelled, competing])

  await opening.started
  assert.equal(fixture.coordinator.providerSessionOpens.length, 1)
  fixture.coordinator.setExecutionTransport('direct')
  fixture.coordinator.setExecutionTransport('relay')
  fixture.coordinator.setExecutionTransport('direct')
  opening.release()

  const settled = await outcomes
  const fulfilled = settled.filter((result) => result.status === 'fulfilled')
  const rejected = settled.filter((result) => result.status === 'rejected')
  assert.equal(fulfilled.length, 1)
  assert.equal(rejected.length, 1)
  assert.equal(
    rejected[0].reason instanceof HostServiceError &&
      rejected[0].reason.code === 'conflict' &&
      rejected[0].reason.failure?.reason === 'conversation_busy',
    true,
  )
  assert.equal(fixture.coordinator.providerSessionOpens.length, 1)
  assert.equal(
    fixture.coordinator.relaySessionOpens +
      fixture.coordinator.directSessionOpens,
    1,
  )
  assert.equal(fixture.coordinator.providerTurnStarts.length, 1)
  assert.equal(
    fixture.service.getConversation(fixture.conversationId).runtime.turns
      .length,
    1,
  )

  turnEvents.release()
  await waitForConversationStatus(
    fixture.service,
    fixture.conversationId,
    'completed',
  )
})

test('cold remote Search, organization, and detail reads never open a Machine channel or Provider session', async (t) => {
  const fixture = await createFixture(t)
  const title = 'Relay cold history marker'

  const initial = fixture.service.getConversation(fixture.conversationId)
  assert.equal(initial.conversation.conversationId, fixture.conversationId)
  await fixture.service.renameConversation(fixture.conversationId, {
    actionId: 'act_phase7b_cold_rename01',
    title,
  })
  await fixture.service.pinConversation(fixture.conversationId, {
    actionId: 'act_phase7b_cold_pin01',
  })
  const active = await fixture.service.listProjectConversations(projectId, {
    archived: 'false',
    limit: 25,
  })
  const search = await fixture.service.searchProjectConversations(projectId, {
    q: 'relay cold history',
    archive: 'active',
    limit: 25,
  })
  const machine = await fixture.service.getMachine(machineId)
  const project = await fixture.service.getProject(projectId)
  assert.equal(active.conversations[0]?.title, title)
  assert.equal(search.results[0]?.conversation.title, title)
  assert.equal(machine.machine.machineId, machineId)
  assert.equal(project.project.projectId, projectId)

  await fixture.service.archiveConversation(fixture.conversationId, {
    actionId: 'act_phase7b_cold_archive01',
  })
  const archived = fixture.service.getConversation(fixture.conversationId)
  const archivedSearch = await fixture.service.searchProjectConversations(
    projectId,
    { q: 'relay cold history', archive: 'archived', limit: 25 },
  )
  assert.ok(archived.conversation.archivedAt)
  assert.equal(
    archivedSearch.results[0]?.conversation.conversationId,
    fixture.conversationId,
  )

  assert.equal(fixture.coordinator.locationValidations.length, 0)
  assert.equal(fixture.coordinator.providerSessionOpens.length, 0)
  assert.equal(fixture.coordinator.relaySessionOpens, 0)
  assert.equal(fixture.coordinator.directSessionOpens, 0)
  assert.equal(fixture.coordinator.providerTurnStarts.length, 0)
})

async function createFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-phase7b-host-'))
  const workspace = join(directory, 'workspace')
  const databasePath = join(directory, 'codetether.sqlite3')
  await mkdir(workspace, { recursive: true })

  const persistence = ConversationStore.open({ databasePath })
  const localMachine = persistence.listMachines()[0]
  assert.ok(localMachine)
  const localRoot = normalizeTrustedProjectRoot(workspace)
  persistence.createProject({
    projectId,
    name: 'Phase 7B cross-transport fixture',
    locations: [
      {
        projectId,
        machineId: localMachine.machineId,
        rootPath: localRoot.rootPath,
        rootPathKey: localRoot.rootPathKey,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  persistence.createRemoteMachineWithTrust(
    {
      machineId,
      displayName: 'Phase 7B Relay Machine',
      kind: 'remote',
      platform: 'Linux',
      architecture: 'x64',
      createdAt: timestamp,
    },
    {
      machineId,
      nodeIdentity: 'node_phase7bcross01',
      peerPublicKeySpki: new Uint8Array(64).fill(7),
      peerKeyFingerprint: 'N'.repeat(43),
      controllerCredentialRef: 'controller_phase7bcross01.json',
      controllerKeyFingerprint: 'C'.repeat(43),
      trustState: 'pending',
      protocolVersion: 1,
      address: { host: '192.0.2.71', port: 43_217 },
      pairedAt: timestamp,
      updatedAt: timestamp,
    },
  )
  persistence.activateTrustedMachinePeer(machineId, timestamp)
  persistence.createProjectLocation({
    projectId,
    machineId,
    rootPath: remoteRoot,
    rootPathKey: remoteRoot,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  persistence.recordRemoteProviderObservation({
    machineId,
    providers: remoteProviderDescriptors(),
    observedAt: timestamp,
  })

  const coordinator = new CrossTransportRemoteCoordinator()
  const service = new HostService({
    runtimes: [new InertLocalRuntime()],
    workspacePolicy: await WorkspacePolicy.create([workspace]),
    publisher: new HostEventPublisher({ epoch: newEpoch() }),
    hostVersion: '0.0.0-phase7b-cross-transport-test',
    now: () => new Date(timestamp),
    persistence,
    remoteMachineCoordinator: coordinator,
    persistenceFlushMs: 0,
  })
  const created = await service.createConversation({
    actionId: 'act_phase7b_cross_create01',
    machineId,
    projectId,
    provider: 'codex',
  })
  coordinator.resetObservedOperations()

  const fixture = {
    service,
    coordinator,
    conversationId: created.data.conversation.conversationId,
  }
  t.after(async () => {
    coordinator.releaseAllGates()
    await service.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  })
  return fixture
}

class CrossTransportRemoteCoordinator {
  constructor() {
    this.executionTransport = 'relay'
    this.statusListeners = new Set()
    this.discoveryListeners = new Set()
    this.providerSessionOpens = []
    this.providerTurnStarts = []
    this.locationValidations = []
    this.relaySessionOpens = 0
    this.directSessionOpens = 0
    this.nextProviderSessionOpenGate = undefined
    this.turnEventGate = undefined
    this.gates = new Set()
  }

  connectionState(candidateMachineId) {
    return candidateMachineId === machineId ? 'online' : 'offline'
  }

  connectionDetails(candidateMachineId) {
    if (candidateMachineId !== machineId) return undefined
    return {
      state: 'online',
      directState: this.executionTransport === 'direct' ? 'online' : 'offline',
      executionTransport: this.executionTransport,
      currentEndpoint: { host: '192.0.2.71', port: 43_217 },
      lastAttemptAt: timestamp,
      lastSuccessfulAt: timestamp,
    }
  }

  providerExecutionAvailable(candidateMachineId, provider) {
    return candidateMachineId === machineId && provider === 'codex'
  }

  relayExecutionAvailable(candidateMachineId) {
    return (
      candidateMachineId === machineId && this.executionTransport === 'relay'
    )
  }

  providerDiscoveryCurrent(candidateMachineId, observedAt) {
    return candidateMachineId === machineId && observedAt === timestamp
  }

  subscribeStatus(listener) {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  subscribeProviderDiscovery(listener) {
    this.discoveryListeners.add(listener)
    return () => this.discoveryListeners.delete(listener)
  }

  setExecutionTransport(transport) {
    this.executionTransport = transport
    for (const listener of this.statusListeners) listener(machineId, 'online')
  }

  async validateProjectLocation(machine, trust, path) {
    assert.equal(machine.machineId, machineId)
    assert.equal(trust.machineId, machineId)
    assert.equal(path, remoteRoot)
    this.locationValidations.push({ transport: this.executionTransport, path })
    return {
      canonicalPath: path,
      basename: 'phase7b-cross-transport',
      exists: true,
      directory: true,
    }
  }

  async openCodexSession(machine, trust, input) {
    assert.equal(machine.machineId, machineId)
    assert.equal(trust.machineId, machineId)
    const transport = this.executionTransport
    this.providerSessionOpens.push({ transport, input })
    if (transport === 'relay') this.relaySessionOpens += 1
    else this.directSessionOpens += 1

    const opening = this.nextProviderSessionOpenGate
    this.nextProviderSessionOpenGate = undefined
    if (opening !== undefined) {
      opening.started.resolve()
      await opening.released.promise
    }

    let closed = false
    return {
      machineId,
      conversationId: input.conversationId,
      providerThreadId:
        input.providerThreadId ?? 'native-phase7b-cross-transport-thread',
      get closed() {
        return closed
      },
      startTurn: async (turn) => {
        this.providerTurnStarts.push({ ...turn })
        const eventGate = this.turnEventGate?.promise
        return {
          async *events() {
            await eventGate
            if (closed) throw new Error('Controlled closed remote session')
            yield { type: 'message.delta', text: 'completed', sequence: 1 }
            yield { type: 'message.completed', sequence: 2 }
            yield { type: 'turn.completed', sequence: 3 }
          },
        }
      },
      async close() {
        closed = true
      },
    }
  }

  holdNextProviderSessionOpen() {
    const gate = { started: deferred(), released: deferred() }
    this.nextProviderSessionOpenGate = gate
    this.gates.add(gate.started)
    this.gates.add(gate.released)
    return {
      started: gate.started.promise,
      release: () => gate.released.resolve(),
    }
  }

  holdTurnEvents() {
    const gate = deferred()
    this.turnEventGate = gate
    this.gates.add(gate)
    return { release: () => gate.resolve() }
  }

  resetObservedOperations() {
    this.providerSessionOpens.length = 0
    this.providerTurnStarts.length = 0
    this.locationValidations.length = 0
    this.relaySessionOpens = 0
    this.directSessionOpens = 0
  }

  releaseAllGates() {
    for (const gate of this.gates) gate.resolve()
    this.gates.clear()
  }

  async close() {
    this.releaseAllGates()
  }
}

class InertLocalRuntime {
  constructor() {
    this.provider = 'codex'
    this.descriptor = remoteProviderDescriptors()[0]
    this.eventListeners = new Set()
    this.failureListeners = new Set()
    this.approvalListeners = new Set()
  }

  subscribeEvents(listener) {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  subscribeFailures(listener) {
    this.failureListeners.add(listener)
    return () => this.failureListeners.delete(listener)
  }

  subscribeApprovals(onRequest, onResolved) {
    const listeners = { onRequest, onResolved }
    this.approvalListeners.add(listeners)
    return () => this.approvalListeners.delete(listeners)
  }

  async startConversation() {
    throw new Error('Local Provider execution is outside this fixture')
  }

  async resumeConversation() {
    throw new Error('Local Provider execution is outside this fixture')
  }

  async startTurn() {
    throw new Error('Local Provider execution is outside this fixture')
  }

  async interruptTurn() {
    throw new Error('Local Provider execution is outside this fixture')
  }

  async close() {}
}

function remoteProviderDescriptors() {
  const none = {
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
  return [
    {
      provider: 'codex',
      displayName: 'Codex',
      availability: 'available',
      version: '1.2.3',
      capabilities: { ...none, streaming: true, resume: true },
    },
    {
      provider: 'claude-code',
      displayName: 'Claude Code',
      availability: 'not_installed',
      capabilities: none,
    },
  ]
}

function deferred() {
  let resolve
  const promise = new Promise((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

async function waitForConversationStatus(service, conversationId, status) {
  let last
  for (let attempt = 0; attempt < 200; attempt += 1) {
    last = service.getConversation(conversationId)
    if (last.conversation.status === status) return last
    await new Promise((resolve) => setImmediate(resolve))
  }
  throw new Error(
    `Timed out waiting for Conversation ${status}: ${JSON.stringify(last)}`,
  )
}
