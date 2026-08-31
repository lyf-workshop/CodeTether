import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import { HostEventPublisher } from '../dist/api/host-event-publisher.js'
import {
  HostService,
  HostServiceError,
  newEpoch,
} from '../dist/api/host-service.js'
import { LocalHttpServer } from '../dist/api/local-http-server.js'
import {
  RemoteMachineCoordinatorError,
  RemoteMachineRevocationPendingError,
} from '../dist/api/remote-machine-coordinator.js'
import { WorkspacePolicy } from '../dist/api/workspace-policy.js'
import { ConversationStore } from '../dist/persistence/conversation-store.js'

const timestamp = '2026-08-30T12:00:00.000Z'
const availableCapabilities = {
  streaming: true,
  resume: true,
  interrupt: false,
  approvals: false,
  fileRead: true,
  fileEdit: false,
  shell: false,
  search: true,
  diff: false,
  toolEvents: true,
  modelSelection: false,
  reasoningControl: false,
}

class TrackingRuntime {
  constructor(provider) {
    this.provider = provider
    this.available = true
    this.startConversationCalls = []
    this.resumeConversationCalls = []
    this.startTurnCalls = []
    this.closeCalls = 0
    this.descriptor = {
      provider,
      displayName: provider === 'codex' ? 'Codex' : 'Claude Code',
      availability: 'available',
      version: 'test-public-version',
      testedVersion: 'test-public-version',
      capabilities: {
        ...availableCapabilities,
        interrupt: provider === 'codex',
        approvals: provider === 'codex',
        fileEdit: provider === 'codex',
        shell: provider === 'codex',
        diff: provider === 'codex',
        modelSelection: provider === 'codex',
        reasoningControl: provider === 'codex',
      },
    }
    this.eventListeners = new Set()
    this.approvalListeners = new Set()
    this.failureListeners = new Set()
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

  async startConversation(options) {
    this.startConversationCalls.push(options)
    return {
      providerThreadId: `${this.provider}-private-session-${String(this.startConversationCalls.length)}`,
    }
  }

  async resumeConversation(options) {
    this.resumeConversationCalls.push(options)
    return { providerThreadId: options.providerThreadId }
  }

  async startTurn(options) {
    this.startTurnCalls.push(options)
    return {
      providerTurnId: `${this.provider}-private-turn-${String(this.startTurnCalls.length)}`,
    }
  }

  async interruptTurn() {}

  async close() {
    this.closeCalls += 1
    this.eventListeners.clear()
    this.approvalListeners.clear()
    this.failureListeners.clear()
  }
}

test('Machine API exposes one stable local Machine with mixed-Provider durable bindings and cold-read isolation', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-machine-api-'))
  const workspace = join(directory, 'workspace')
  const databasePath = join(directory, 'data', 'codetether.sqlite3')
  await mkdir(workspace, { recursive: true })

  let firstService
  let secondService
  let server
  try {
    const firstRuntimes = [
      new TrackingRuntime('codex'),
      new TrackingRuntime('claude-code'),
    ]
    firstService = await createService({
      workspace,
      databasePath,
      runtimes: firstRuntimes,
      maxConversations: 2,
    })

    const firstMachines = firstService.listMachines()
    assert.equal(firstMachines.machines.length, 1)
    const machineId = firstMachines.machines[0].machineId
    const project = (await firstService.listProjects()).projects[0]
    assert.ok(project)
    assert.deepEqual(
      project.locations.map((location) => location.machineId),
      [machineId],
    )
    assert.equal(project.locations[0].rootPath, workspace)

    const codex = await firstService.createConversation({
      actionId: 'act_machine_codex_create',
      machineId,
      projectId: project.projectId,
      provider: 'codex',
    })
    const claude = await firstService.createConversation({
      actionId: 'act_machine_claude_create',
      machineId,
      projectId: project.projectId,
      provider: 'claude-code',
    })
    assert.equal(codex.data.conversation.machineId, machineId)
    assert.equal(claude.data.conversation.machineId, machineId)

    await firstService.close()
    firstService = undefined

    const restartedCodex = new TrackingRuntime('codex')
    const restartedClaude = new TrackingRuntime('claude-code')
    secondService = await createService({
      workspace,
      databasePath,
      runtimes: [restartedCodex, restartedClaude],
      maxConversations: 1,
      registerRoot: false,
    })

    const restartedMachines = secondService.listMachines()
    assert.equal(restartedMachines.machines.length, 1)
    assert.equal(restartedMachines.machines[0].machineId, machineId)

    const runtimeSnapshot = secondService.snapshot()
    assert.equal(runtimeSnapshot.conversations.length, 1)
    const detail = await secondService.getMachine(machineId)
    assert.equal(detail.machine.machineId, machineId)
    assert.equal(detail.machine.kind, 'local')
    assert.equal(detail.machine.isLocal, true)
    assert.equal(detail.machine.availability, 'available')
    assert.equal(detail.projects.length, 1)
    assert.equal(detail.projects[0].projectId, project.projectId)
    assert.deepEqual(
      detail.projects[0].locations.map((location) => location.machineId),
      [machineId],
    )
    assert.deepEqual(
      new Set(
        detail.conversations.map((conversation) => conversation.provider),
      ),
      new Set(['codex', 'claude-code']),
    )
    assert.equal(
      detail.conversations.every(
        (conversation) => conversation.machineId === machineId,
      ),
      true,
    )
    assert.deepEqual(
      detail.providers.map((provider) => provider.provider),
      ['codex', 'claude-code'],
    )
    assert.equal(restartedCodex.resumeConversationCalls.length, 0)
    assert.equal(restartedClaude.resumeConversationCalls.length, 0)
    assert.equal(restartedCodex.startConversationCalls.length, 0)
    assert.equal(restartedClaude.startConversationCalls.length, 0)

    const readTimings = []
    for (let index = 0; index < 25; index += 1) {
      const startedAt = performance.now()
      await secondService.getMachine(machineId)
      readTimings.push(performance.now() - startedAt)
    }
    readTimings.sort((left, right) => left - right)
    context.diagnostic(
      `25 Machine detail reads: median=${percentile(readTimings, 0.5).toFixed(3)}ms p95=${percentile(readTimings, 0.95).toFixed(3)}ms`,
    )

    const privateMachineEnvelope = JSON.stringify({
      machine: detail.machine,
      providers: detail.providers,
    })
    assert.equal(privateMachineEnvelope.includes(workspace), false)
    assert.equal(privateMachineEnvelope.includes('private-session'), false)
    assert.equal(privateMachineEnvelope.includes('providerThreadId'), false)
    assert.equal(privateMachineEnvelope.includes('providerSessionId'), false)
    assert.equal(hasInternalProcessIdentity(detail.machine), false)
    assert.equal(detail.providers.some(hasInternalProcessIdentity), false)

    const hydratedIds = new Set(
      runtimeSnapshot.conversations.map(
        (conversation) => conversation.conversationId,
      ),
    )
    const coldConversation = detail.conversations.find(
      (conversation) => !hydratedIds.has(conversation.conversationId),
    )
    assert.ok(coldConversation)
    const renamed = await secondService.renameConversation(
      coldConversation.conversationId,
      {
        actionId: 'act_machine_cold_rename',
        title: 'Cold machine-bound Conversation',
      },
    )
    assert.equal(renamed.data.conversation.machineId, machineId)
    const pinned = await secondService.pinConversation(
      coldConversation.conversationId,
      { actionId: 'act_machine_cold_pin' },
    )
    assert.equal(pinned.data.conversation.machineId, machineId)
    assert.equal(restartedCodex.resumeConversationCalls.length, 0)
    assert.equal(restartedClaude.resumeConversationCalls.length, 0)

    const unknownMachineId = 'machine_unknown000001'
    await assert.rejects(
      secondService.getMachine(unknownMachineId),
      (error) =>
        error instanceof HostServiceError &&
        error.code === 'not_found' &&
        error.httpStatus === 404,
    )
    const startCallCount =
      restartedCodex.startConversationCalls.length +
      restartedClaude.startConversationCalls.length
    await assert.rejects(
      secondService.createConversation({
        actionId: 'act_machine_unknown_create',
        machineId: unknownMachineId,
        projectId: project.projectId,
        provider: 'codex',
      }),
      (error) =>
        error instanceof HostServiceError &&
        error.code === 'not_found' &&
        error.httpStatus === 404,
    )
    assert.equal(
      restartedCodex.startConversationCalls.length +
        restartedClaude.startConversationCalls.length,
      startCallCount,
    )

    restartedClaude.available = false
    await assert.rejects(
      secondService.createConversation({
        actionId: 'act_machine_unavailable_provider',
        machineId,
        projectId: project.projectId,
        provider: 'claude-code',
      }),
      (error) =>
        error instanceof HostServiceError &&
        error.code === 'provider_unavailable' &&
        error.httpStatus === 503,
    )
    assert.equal(restartedClaude.startConversationCalls.length, 0)

    server = new LocalHttpServer({
      service: secondService,
      allowedOrigins: ['http://localhost:5173'],
      heartbeatMs: 60_000,
    })
    const baseUrl = await server.start(0)
    const machineListResponse = await getJson(baseUrl, '/api/v1/machines')
    assert.equal(machineListResponse.status, 200)
    assert.deepEqual(
      machineListResponse.body.machines.map((machine) => machine.machineId),
      [machineId],
    )
    const machineDetailResponse = await getJson(
      baseUrl,
      `/api/v1/machines/${machineId}`,
    )
    assert.equal(machineDetailResponse.status, 200)
    assert.equal(machineDetailResponse.body.machine.machineId, machineId)
    assert.equal(machineDetailResponse.body.conversations.length, 2)

    const unknownMachineResponse = await getJson(
      baseUrl,
      '/api/v1/machines/machine_unknown000002',
    )
    assert.equal(unknownMachineResponse.status, 404)
    assert.equal(unknownMachineResponse.body.code, 'not_found')

    const immutableResponse = await requestJson(
      baseUrl,
      `/api/v1/conversations/${coldConversation.conversationId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionId: 'act_machine_mutation_rejected',
          title: 'Must not move',
          machineId: unknownMachineId,
        }),
      },
    )
    assert.equal(immutableResponse.status, 422)
    assert.equal(immutableResponse.body.code, 'invalid_request')
    const afterRejectedMutation = await secondService.getConversation(
      coldConversation.conversationId,
    )
    assert.equal(afterRejectedMutation.conversation.machineId, machineId)
    assert.equal(restartedCodex.resumeConversationCalls.length, 0)
    assert.equal(restartedClaude.resumeConversationCalls.length, 0)
  } finally {
    if (server !== undefined) {
      await server.close().catch(() => undefined)
      secondService = undefined
    }
    await secondService?.close().catch(() => undefined)
    await firstService?.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})

test('remote pairing stages private trust before publication and unpair rolls back on revoke failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-remote-api-'))
  const workspace = join(directory, 'workspace')
  const databasePath = join(directory, 'data', 'codetether.sqlite3')
  await mkdir(workspace, { recursive: true })
  const runtime = new TrackingRuntime('codex')
  const coordinator = new FakeRemoteMachineCoordinator()
  let service
  let server
  try {
    service = await createService({
      workspace,
      databasePath,
      runtimes: [runtime],
      maxConversations: 1,
      remoteMachineCoordinator: coordinator,
    })
    const events = []
    service.publisher.subscribe((event) => events.push(event))
    server = new LocalHttpServer({
      service,
      allowedOrigins: ['http://localhost:5173'],
      heartbeatMs: 60_000,
    })
    const baseUrl = await server.start(0)

    const begun = await requestJson(baseUrl, '/api/v1/machine-pairings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actionId: 'act_remote_pair_begin01',
        address: { host: '192.0.2.10', port: 43_217 },
        pairingCode: '482 731',
      }),
    })
    assert.equal(begun.status, 202)
    assert.equal(
      begun.body.data.candidate.pairingAttemptId,
      coordinator.attemptId,
    )
    assert.equal(service.listMachines().machines.length, 1)

    const confirmed = await requestJson(
      baseUrl,
      `/api/v1/machine-pairings/${coordinator.attemptId}/confirm`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId: 'act_remote_pair_confirm01' }),
      },
    )
    assert.equal(confirmed.status, 200)
    assert.equal(confirmed.body.data.machine.kind, 'remote')
    assert.equal(confirmed.body.data.machine.connectionState, 'offline')
    assert.equal(service.listMachines().machines.length, 2)
    const remoteDetail = await service.getMachine(coordinator.machineId)
    assert.deepEqual(remoteDetail.providers, [])
    assert.deepEqual(remoteDetail.projects, [])
    assert.deepEqual(remoteDetail.conversations, [])
    const publicRemoteJson = JSON.stringify(remoteDetail)
    for (const privateField of [
      'nodeIdentity',
      'peerPublicKeySpki',
      'peerKeyFingerprint',
      'controllerCredentialRef',
      'controllerKeyFingerprint',
      'endpointHost',
    ]) {
      assert.equal(publicRemoteJson.includes(privateField), false)
    }
    assert.equal(runtime.startConversationCalls.length, 0)
    assert.equal(runtime.resumeConversationCalls.length, 0)

    coordinator.failUnpair = true
    const failed = await requestJson(
      baseUrl,
      `/api/v1/machines/${coordinator.machineId}/trust`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId: 'act_remote_unpair_fail01' }),
      },
    )
    assert.equal(failed.status, 503)
    assert.equal(failed.body.code, 'machine_connection_failed')
    assert.equal(service.listMachines().machines.length, 2)
    const inspectRollback = new DatabaseSync(databasePath)
    assert.equal(
      inspectRollback
        .prepare(
          'SELECT trust_state FROM trusted_machine_peers WHERE machine_id = ?',
        )
        .get(coordinator.machineId).trust_state,
      'active',
    )
    inspectRollback.close()
    assert.equal(
      (await service.getMachine(coordinator.machineId)).machine.kind,
      'remote',
    )

    coordinator.failUnpair = false
    coordinator.pendingUnpair = true
    const pending = await requestJson(
      baseUrl,
      `/api/v1/machines/${coordinator.machineId}/trust`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId: 'act_remote_unpair_pending01' }),
      },
    )
    assert.equal(pending.status, 503)
    assert.equal(pending.body.code, 'machine_connection_failed')
    assert.equal(service.listMachines().machines.length, 2)
    const inspectPending = new DatabaseSync(databasePath)
    assert.equal(
      inspectPending
        .prepare(
          'SELECT trust_state FROM trusted_machine_peers WHERE machine_id = ?',
        )
        .get(coordinator.machineId).trust_state,
      'revoking',
    )
    inspectPending.close()

    coordinator.pendingUnpair = false
    const removed = await requestJson(
      baseUrl,
      `/api/v1/machines/${coordinator.machineId}/trust`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId: 'act_remote_unpair_ok01' }),
      },
    )
    assert.equal(removed.status, 200)
    assert.equal(removed.body.data.machineId, coordinator.machineId)
    assert.equal(service.listMachines().machines.length, 1)
    assert.deepEqual(
      events
        .filter((event) => event.type.startsWith('machine.'))
        .map((event) => event.type),
      ['machine.updated', 'machine.removed'],
    )
    assert.equal(runtime.startConversationCalls.length, 0)
    assert.equal(runtime.resumeConversationCalls.length, 0)
  } finally {
    if (server !== undefined) {
      await server.close().catch(() => undefined)
      service = undefined
    }
    await service?.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})

async function createService(options) {
  const service = new HostService({
    runtimes: options.runtimes,
    workspacePolicy: await WorkspacePolicy.create([options.workspace]),
    publisher: new HostEventPublisher({ epoch: newEpoch() }),
    hostVersion: '0.0.0-machine-test',
    now: () => new Date(timestamp),
    maxConversations: options.maxConversations,
    persistence: ConversationStore.open({ databasePath: options.databasePath }),
    ...(options.remoteMachineCoordinator === undefined
      ? {}
      : { remoteMachineCoordinator: options.remoteMachineCoordinator }),
  })
  if (options.registerRoot !== false) {
    await service.registerInitialProjectRoots([options.workspace])
  }
  return service
}

class FakeRemoteMachineCoordinator {
  constructor() {
    this.attemptId = 'pairing_remoteapi01'
    this.machineId = 'machine_remoteapi01'
    this.failUnpair = false
    this.confirmed = {
      machine: {
        machineId: this.machineId,
        displayName: 'Development server',
        kind: 'remote',
        platform: 'Linux',
        architecture: 'x64',
        createdAt: timestamp,
      },
      trust: {
        machineId: this.machineId,
        nodeIdentity: 'node_identity_remote_api',
        peerPublicKeySpki: new Uint8Array(64).fill(1),
        peerKeyFingerprint: 'a'.repeat(43),
        controllerCredentialRef: 'controller_remote_api.json',
        controllerKeyFingerprint: 'b'.repeat(43),
        trustState: 'pending',
        protocolVersion: 1,
        address: { host: '192.0.2.10', port: 43_217 },
        pairedAt: timestamp,
        updatedAt: timestamp,
      },
    }
  }

  connectionState() {
    return 'offline'
  }

  async beginPairing(input) {
    assert.deepEqual(input, {
      address: { host: '192.0.2.10', port: 43_217 },
      pairingCode: '482731',
    })
    return {
      pairingAttemptId: this.attemptId,
      machineId: this.machineId,
      displayName: this.confirmed.machine.displayName,
      platform: this.confirmed.machine.platform,
      architecture: this.confirmed.machine.architecture,
      address: input.address,
      protocolVersion: 1,
      expiresAt: '2026-08-30T12:05:00.000Z',
      verificationCode: '482 731',
    }
  }

  async confirmPairing(pairingAttemptId, stageTrust) {
    assert.equal(pairingAttemptId, this.attemptId)
    await stageTrust(this.confirmed)
    return this.confirmed
  }

  async cancelPairing() {}

  async unpair() {
    if (this.pendingUnpair) {
      throw new RemoteMachineRevocationPendingError()
    }
    if (this.failUnpair) {
      throw new RemoteMachineCoordinatorError(
        'connection_failed',
        'Controlled revoke failure',
      )
    }
  }

  async close() {}
}

function hasInternalProcessIdentity(value) {
  if (value === null || typeof value !== 'object') return false
  for (const [key, child] of Object.entries(value)) {
    if (
      key === 'pid' ||
      key === 'processId' ||
      key === 'desktopPid' ||
      key === 'hostPid' ||
      key === 'providerThreadId' ||
      key === 'providerSessionId'
    ) {
      return true
    }
    if (hasInternalProcessIdentity(child)) return true
  }
  return false
}

function percentile(values, quantile) {
  return values[
    Math.min(values.length - 1, Math.floor(values.length * quantile))
  ]
}

async function getJson(baseUrl, path) {
  return await requestJson(baseUrl, path)
}

async function requestJson(baseUrl, path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, init)
  return {
    status: response.status,
    body: await response.json(),
  }
}
