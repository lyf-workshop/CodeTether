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
  const persistence = ConversationStore.open({ databasePath })
  const coordinator = new FakeRemoteMachineCoordinator(persistence)
  let service
  let server
  try {
    service = await createService({
      workspace,
      databasePath,
      runtimes: [runtime],
      maxConversations: 1,
      remoteMachineCoordinator: coordinator,
      persistence,
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
    assert.deepEqual(remoteDetail.providerDiscovery, {
      state: 'not_observed',
    })
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

    const remoteRead = await requestJson(
      baseUrl,
      `/api/v1/machines/${coordinator.machineId}`,
    )
    assert.equal(remoteRead.status, 200)
    assert.equal(remoteRead.body.connection.state, 'offline')
    assert.equal(remoteRead.body.machine.connectionState, 'offline')
    assert.equal(JSON.stringify(remoteRead.body).includes('endpoints'), false)
    assert.equal(JSON.stringify(remoteRead.body).includes('trustState'), true)
    assert.equal(
      JSON.stringify(remoteRead.body).includes('controllerCredentialRef'),
      false,
    )

    const retry = await requestJson(
      baseUrl,
      `/api/v1/machines/${coordinator.machineId}/connection/retry`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId: 'act_remote_connection_retry01' }),
      },
    )
    assert.equal(retry.status, 202)
    assert.equal(retry.body.status, 'accepted')
    assert.equal(retry.body.data.machine.connectionState, 'connecting')
    assert.equal(retry.body.data.connection.state, 'connecting')
    assert.equal(coordinator.retryCalls.length, 1)

    const updated = await requestJson(
      baseUrl,
      `/api/v1/machines/${coordinator.machineId}/connection/address`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionId: 'act_remote_connection_address01',
          address: { host: '192.0.2.11', port: 43_217 },
        }),
      },
    )
    assert.equal(updated.status, 200)
    assert.equal(updated.body.status, 'completed')
    assert.equal(updated.body.data.machine.connectionState, 'online')
    assert.deepEqual(updated.body.data.connection.currentEndpoint, {
      host: '192.0.2.11',
      port: 43_217,
    })
    assert.equal(coordinator.addressUpdates.length, 1)
    assert.equal(JSON.stringify(updated.body).includes('endpoints'), false)

    const refreshedProviders = await requestJson(
      baseUrl,
      `/api/v1/machines/${coordinator.machineId}/providers/refresh`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId: 'act_remote_provider_refresh01' }),
      },
    )
    assert.equal(refreshedProviders.status, 200)
    assert.equal(refreshedProviders.body.status, 'completed')
    assert.equal(
      refreshedProviders.body.data.providerDiscovery.state,
      'current',
    )
    assert.deepEqual(
      refreshedProviders.body.data.providers.map(({ provider }) => provider),
      ['codex', 'claude-code'],
    )
    assert.equal(coordinator.discoveryCalls, 1)
    const discoveredDetail = await service.getMachine(coordinator.machineId)
    assert.equal(discoveredDetail.providerDiscovery.state, 'current')
    assert.equal(discoveredDetail.providers[0].version, '1.2.3')
    coordinator.connection = { state: 'offline' }
    const offlineDetail = await service.getMachine(coordinator.machineId)
    assert.equal(offlineDetail.providerDiscovery.state, 'last_known')
    assert.equal(offlineDetail.providers[0].version, '1.2.3')
    const offlineRefresh = await requestJson(
      baseUrl,
      `/api/v1/machines/${coordinator.machineId}/providers/refresh`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId: 'act_remote_provider_refresh02' }),
      },
    )
    assert.equal(offlineRefresh.status, 503)
    assert.equal(offlineRefresh.body.code, 'machine_unreachable')
    assert.equal(coordinator.discoveryCalls, 1)
    coordinator.connection = updated.body.data.connection

    coordinator.failAddressUpdate = true
    const identityMismatch = await requestJson(
      baseUrl,
      `/api/v1/machines/${coordinator.machineId}/connection/address`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionId: 'act_remote_connection_address02',
          address: { host: '192.0.2.12', port: 43_217 },
        }),
      },
    )
    assert.equal(identityMismatch.status, 409)
    assert.equal(identityMismatch.body.code, 'machine_identity_mismatch')
    coordinator.failAddressUpdate = false

    const [localMachine] = service.listMachines().machines
    assert.ok(localMachine)
    const localRetry = await requestJson(
      baseUrl,
      `/api/v1/machines/${localMachine.machineId}/connection/retry`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId: 'act_local_connection_retry01' }),
      },
    )
    assert.equal(localRetry.status, 409)
    assert.equal(localRetry.body.code, 'conflict')
    const missingRetry = await requestJson(
      baseUrl,
      '/api/v1/machines/machine_missingremote01/connection/retry',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId: 'act_missing_connection_retry01' }),
      },
    )
    assert.equal(missingRetry.status, 404)
    assert.equal(missingRetry.body.code, 'not_found')
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
      ['machine.updated', 'machine.updated', 'machine.removed'],
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

test('remote ProjectLocation API requires active online trust, stays idempotent, and never hydrates Providers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-location-api-'))
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
    server = new LocalHttpServer({
      service,
      allowedOrigins: ['http://localhost:5173'],
      heartbeatMs: 60_000,
    })
    const baseUrl = await server.start(0)
    const project = (await service.listProjects()).projects[0]
    const localMachine = service.listMachines().machines[0]
    assert.ok(project)
    assert.ok(localMachine)

    const begun = await requestJson(baseUrl, '/api/v1/machine-pairings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actionId: 'act_location_pair01',
        address: { host: '192.0.2.10', port: 43_217 },
        pairingCode: '482 731',
      }),
    })
    assert.equal(begun.status, 202)
    const confirmed = await requestJson(
      baseUrl,
      `/api/v1/machine-pairings/${coordinator.attemptId}/confirm`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId: 'act_location_confirm1' }),
      },
    )
    assert.equal(confirmed.status, 200)
    const connected = await requestJson(
      baseUrl,
      `/api/v1/machines/${coordinator.machineId}/connection/address`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionId: 'act_location_online01',
          address: { host: '192.0.2.11', port: 43_217 },
        }),
      },
    )
    assert.equal(connected.status, 200)
    const remoteMachine = service
      .listMachines()
      .machines.find((machine) => machine.machineId === coordinator.machineId)
    assert.ok(remoteMachine)
    assert.equal(remoteMachine.capabilities.projectAccess, true)
    assert.equal(remoteMachine.capabilities.providerExecution, false)

    coordinator.validationError = new RemoteMachineCoordinatorError(
      'project_location_missing',
      'Controlled missing remote directory',
    )
    const missing = await requestJson(
      baseUrl,
      `/api/v1/projects/${project.projectId}/locations`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionId: 'act_location_missing1',
          machineId: coordinator.machineId,
          path: '/srv/projects/missing',
        }),
      },
    )
    assert.equal(missing.status, 404)
    assert.equal(missing.body.code, 'project_location_missing')
    assert.equal(
      (await service.getProject(project.projectId)).project.locations.length,
      1,
    )

    coordinator.validationError = undefined
    coordinator.validationCanonicalPath =
      '/srv/projects/项目 with spaces/codetether'
    const requestedPath = '/srv/project-links/codetether'
    const created = await requestJson(
      baseUrl,
      `/api/v1/projects/${project.projectId}/locations`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionId: 'act_location_create01',
          machineId: coordinator.machineId,
          path: requestedPath,
        }),
      },
    )
    assert.equal(created.status, 201)
    assert.equal(created.body.data.created, true)
    assert.equal(
      created.body.data.location.rootPath,
      coordinator.validationCanonicalPath,
    )
    assert.equal(created.body.data.project.locations.length, 2)
    assert.equal(coordinator.validationCalls.at(-1).path, requestedPath)
    assert.equal(
      coordinator.validationCalls.at(-1).machine.machineId,
      coordinator.machineId,
    )
    assert.equal(coordinator.validationCalls.at(-1).trust.trustState, 'active')

    const validationCountAfterCreate = coordinator.validationCalls.length
    const replayed = await requestJson(
      baseUrl,
      `/api/v1/projects/${project.projectId}/locations`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionId: 'act_location_create01',
          machineId: coordinator.machineId,
          path: requestedPath,
        }),
      },
    )
    assert.equal(replayed.status, 201)
    assert.deepEqual(replayed.body, created.body)
    assert.equal(coordinator.validationCalls.length, validationCountAfterCreate)

    const duplicate = await requestJson(
      baseUrl,
      `/api/v1/projects/${project.projectId}/locations`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionId: 'act_location_repeat01',
          machineId: coordinator.machineId,
          path: requestedPath,
        }),
      },
    )
    assert.equal(duplicate.status, 200)
    assert.equal(duplicate.body.data.created, false)
    assert.equal(duplicate.body.data.project.locations.length, 2)

    coordinator.validationCanonicalPath = undefined
    const conflict = await requestJson(
      baseUrl,
      `/api/v1/projects/${project.projectId}/locations`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionId: 'act_location_conflict1',
          machineId: coordinator.machineId,
          path: '/srv/projects/a-different-checkout',
        }),
      },
    )
    assert.equal(conflict.status, 409)
    assert.equal(conflict.body.code, 'project_location_conflict')

    const localTrustRequired = await requestJson(
      baseUrl,
      `/api/v1/projects/${project.projectId}/locations`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionId: 'act_location_local001',
          machineId: localMachine.machineId,
          path: workspace,
        }),
      },
    )
    assert.equal(localTrustRequired.status, 409)
    assert.equal(localTrustRequired.body.code, 'conflict')

    const machineDetail = await service.getMachine(coordinator.machineId)
    assert.equal(machineDetail.projects.length, 1)
    assert.equal(machineDetail.projects[0].projectId, project.projectId)
    assert.deepEqual(
      machineDetail.projects[0].locations.map((location) => location.machineId),
      [coordinator.machineId],
    )

    const validationCountBeforeOffline = coordinator.validationCalls.length
    coordinator.connection = { state: 'offline' }
    const offline = await requestJson(
      baseUrl,
      `/api/v1/projects/${project.projectId}/locations`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionId: 'act_location_offline1',
          machineId: coordinator.machineId,
          path: '/srv/projects/offline',
        }),
      },
    )
    assert.equal(offline.status, 503)
    assert.equal(
      coordinator.validationCalls.length,
      validationCountBeforeOffline,
    )
    assert.equal(
      (await service.getProject(project.projectId)).project.locations.length,
      2,
    )

    const blockedUnpair = await requestJson(
      baseUrl,
      `/api/v1/machines/${coordinator.machineId}/trust`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId: 'act_location_unpair01' }),
      },
    )
    assert.equal(blockedUnpair.status, 409)
    assert.equal(blockedUnpair.body.code, 'machine_has_project_locations')
    assert.equal(blockedUnpair.body.details.locationCount, 1)
    assert.equal(coordinator.unpairCalls, 0)

    const validationCountBeforeRemoval = coordinator.validationCalls.length
    const removed = await requestJson(
      baseUrl,
      `/api/v1/projects/${project.projectId}/locations/${coordinator.machineId}`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId: 'act_location_remove01' }),
      },
    )
    assert.equal(removed.status, 200)
    assert.equal(removed.body.data.machineId, coordinator.machineId)
    assert.deepEqual(
      removed.body.data.project.locations.map((location) => location.machineId),
      [localMachine.machineId],
    )
    assert.equal(
      coordinator.validationCalls.length,
      validationCountBeforeRemoval,
    )
    assert.equal(
      service
        .listMachines()
        .machines.filter(
          (machine) => machine.machineId === coordinator.machineId,
        ).length,
      1,
    )
    assert.equal(
      (await service.getMachine(coordinator.machineId)).projects.length,
      0,
    )

    const replayedRemoval = await requestJson(
      baseUrl,
      `/api/v1/projects/${project.projectId}/locations/${coordinator.machineId}`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId: 'act_location_remove01' }),
      },
    )
    assert.deepEqual(replayedRemoval.body, removed.body)
    const missingRemoval = await requestJson(
      baseUrl,
      `/api/v1/projects/${project.projectId}/locations/${coordinator.machineId}`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId: 'act_location_remove02' }),
      },
    )
    assert.equal(missingRemoval.status, 404)
    assert.equal(missingRemoval.body.code, 'project_location_not_found')

    const localRemoval = await requestJson(
      baseUrl,
      `/api/v1/projects/${project.projectId}/locations/${localMachine.machineId}`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId: 'act_location_remove03' }),
      },
    )
    assert.equal(localRemoval.status, 409)
    assert.equal(localRemoval.body.code, 'project_location_local_required')

    const unpaired = await requestJson(
      baseUrl,
      `/api/v1/machines/${coordinator.machineId}/trust`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId: 'act_location_unpair02' }),
      },
    )
    assert.equal(unpaired.status, 200)
    assert.equal(unpaired.body.data.machineId, coordinator.machineId)
    assert.equal(coordinator.unpairCalls, 1)
    assert.equal(
      service
        .listMachines()
        .machines.some(
          (machine) => machine.machineId === coordinator.machineId,
        ),
      false,
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

test('remote Codex creation is lazy, idempotent, Machine-scoped, and resumes after Host and Node restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-remote-codex-'))
  const workspace = join(directory, 'workspace')
  const databasePath = join(directory, 'data', 'codetether.sqlite3')
  await mkdir(workspace, { recursive: true })
  const remoteRoot = '/srv/projects/codetether-remote'
  let firstService
  let secondService
  try {
    const firstPersistence = ConversationStore.open({ databasePath })
    const firstCoordinator = new FakeRemoteMachineCoordinator(firstPersistence)
    firstCoordinator.remoteExecution = true
    const firstLocalRuntime = new TrackingRuntime('codex')
    firstService = await createService({
      workspace,
      databasePath,
      runtimes: [firstLocalRuntime],
      maxConversations: 1,
      remoteMachineCoordinator: firstCoordinator,
      persistence: firstPersistence,
    })
    const project = (await firstService.listProjects()).projects[0]
    assert.ok(project)
    await firstService.beginRemoteMachinePairing({
      actionId: 'act_remote_exec_pair01',
      address: { host: '192.0.2.10', port: 43_217 },
      pairingCode: '482731',
    })
    await firstService.confirmRemoteMachinePairing(firstCoordinator.attemptId, {
      actionId: 'act_remote_exec_confirm01',
    })
    await firstService.updateMachineConnectionAddress(
      firstCoordinator.machineId,
      {
        actionId: 'act_remote_exec_online01',
        address: { host: '192.0.2.11', port: 43_217 },
      },
    )
    await firstService.refreshMachineProviders(firstCoordinator.machineId, {
      actionId: 'act_remote_exec_detect01',
    })
    firstCoordinator.validationCanonicalPath = remoteRoot
    await firstService.registerProjectLocation(project.projectId, {
      actionId: 'act_remote_exec_location01',
      machineId: firstCoordinator.machineId,
      path: remoteRoot,
    })

    const createRequest = {
      actionId: 'act_remote_exec_create01',
      machineId: firstCoordinator.machineId,
      projectId: project.projectId,
      provider: 'codex',
    }
    const created = await firstService.createConversation(createRequest)
    const duplicateCreate = await firstService.createConversation(createRequest)
    assert.deepEqual(duplicateCreate, created)
    assert.equal(firstCoordinator.openCodexCalls.length, 0)
    assert.equal(firstLocalRuntime.startConversationCalls.length, 0)
    assert.equal(
      created.data.conversation.machineId,
      firstCoordinator.machineId,
    )

    const firstTurnRequest = {
      actionId: 'act_remote_exec_turn01',
      input: {
        type: 'text',
        text: 'remember marker REMOTE-CODEX-FOUNDATION',
      },
    }
    const firstTurn = await firstService.startTurn(
      created.data.conversation.conversationId,
      firstTurnRequest,
    )
    const duplicateTurn = await firstService.startTurn(
      created.data.conversation.conversationId,
      firstTurnRequest,
    )
    assert.deepEqual(duplicateTurn, firstTurn)
    assert.equal(firstCoordinator.openCodexCalls.length, 1)
    assert.equal(firstCoordinator.openCodexCalls[0].providerThreadId, undefined)
    assert.equal(firstCoordinator.remoteTurnCalls.length, 1)
    await waitForConversationIdle(
      firstService,
      created.data.conversation.conversationId,
    )
    const durableFirst = firstPersistence.getConversation(
      created.data.conversation.conversationId,
    )
    assert.ok(durableFirst.providerThreadId)
    assert.equal(
      durableFirst.providerThreadId.includes(
        'remote-native-session-machine-api',
      ),
      false,
    )
    assert.equal(
      JSON.stringify(
        firstService.getConversation(created.data.conversation.conversationId),
      ).includes('providerThreadId'),
      false,
    )
    await firstService.close()
    firstService = undefined

    const secondPersistence = ConversationStore.open({ databasePath })
    const secondCoordinator = new FakeRemoteMachineCoordinator(
      secondPersistence,
    )
    secondCoordinator.remoteExecution = true
    secondCoordinator.connection = { state: 'online' }
    secondCoordinator.currentProviderObservedAt = timestamp
    const secondLocalRuntime = new TrackingRuntime('codex')
    secondService = await createService({
      workspace,
      databasePath,
      runtimes: [secondLocalRuntime],
      maxConversations: 1,
      remoteMachineCoordinator: secondCoordinator,
      persistence: secondPersistence,
      registerRoot: false,
    })
    const coldDetail = secondService.getConversation(
      created.data.conversation.conversationId,
    )
    assert.equal(coldDetail.conversation.machineId, secondCoordinator.machineId)
    assert.equal(secondCoordinator.openCodexCalls.length, 0)

    await secondService.startTurn(created.data.conversation.conversationId, {
      actionId: 'act_remote_exec_turn02',
      input: { type: 'text', text: 'recall the marker' },
    })
    assert.equal(secondCoordinator.openCodexCalls.length, 1)
    assert.equal(
      secondCoordinator.openCodexCalls[0].providerThreadId,
      'remote-native-session-machine-api',
    )
    await waitForConversationIdle(
      secondService,
      created.data.conversation.conversationId,
    )

    const turnsBeforeIdleClose = secondService.getConversation(
      created.data.conversation.conversationId,
    ).runtime.turns.length
    const idleSession = secondCoordinator.remoteSessions.at(-1)
    assert.ok(idleSession)
    idleSession.simulateIdleClose()
    await secondService.startTurn(created.data.conversation.conversationId, {
      actionId: 'act_remote_exec_idle_resume01',
      input: { type: 'text', text: 'resume before sending this prompt' },
    })
    assert.equal(secondCoordinator.openCodexCalls.length, 2)
    assert.equal(
      secondCoordinator.openCodexCalls[1].providerThreadId,
      'remote-native-session-machine-api',
    )
    assert.equal(secondCoordinator.remoteTurnCalls.length, 2)
    const afterIdleResume = await waitForConversationIdle(
      secondService,
      created.data.conversation.conversationId,
    )
    assert.equal(afterIdleResume.runtime.turns.length, turnsBeforeIdleClose + 1)
    assert.equal(afterIdleResume.runtime.turns.at(-1)?.status, 'completed')
    assert.equal(
      afterIdleResume.runtime.turns.some((turn) => turn.status === 'failed'),
      false,
    )

    secondCoordinator.setConnection('offline')
    secondCoordinator.setConnection('online')
    await secondService.startTurn(created.data.conversation.conversationId, {
      actionId: 'act_remote_exec_turn03',
      input: {
        type: 'text',
        text: 'resume after controlled Node restart',
      },
    })
    assert.equal(secondCoordinator.openCodexCalls.length, 3)
    assert.equal(
      secondCoordinator.openCodexCalls[2].providerThreadId,
      'remote-native-session-machine-api',
    )
    await waitForConversationIdle(
      secondService,
      created.data.conversation.conversationId,
    )
    assert.equal(secondService.snapshot().conversations.length, 1)

    secondCoordinator.offlineAfterStart = true
    const lostTurnRequest = {
      actionId: 'act_remote_exec_turn04',
      input: { type: 'text', text: 'one prompt across a lost connection' },
    }
    const lostTurn = await secondService.startTurn(
      created.data.conversation.conversationId,
      lostTurnRequest,
    )
    assert.deepEqual(
      await secondService.startTurn(
        created.data.conversation.conversationId,
        lostTurnRequest,
      ),
      lostTurn,
    )
    assert.equal(secondCoordinator.remoteTurnCalls.length, 4)
    const failed = await waitForConversationStatus(
      secondService,
      created.data.conversation.conversationId,
      'failed',
    )
    assert.equal(failed.runtime.turns.at(-1)?.status, 'failed')
    assert.equal(secondCoordinator.remoteTurnCalls.length, 4)

    await secondService.createConversation({
      actionId: 'act_remote_exec_local01',
      machineId: secondService.listMachines().machines[0].machineId,
      projectId: project.projectId,
      provider: 'codex',
    })
    assert.equal(secondService.snapshot().conversations.length, 1)
    assert.equal(secondLocalRuntime.startConversationCalls.length, 1)
    assert.ok(secondCoordinator.remoteSessionCloseCalls >= 1)
  } finally {
    await secondService?.close().catch(() => undefined)
    await firstService?.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})

test('remote Claude creation stays lazy and effort-bound while safe Tools, idempotency, and native resume remain canonical', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-remote-claude-'))
  const workspace = join(directory, 'workspace')
  const databasePath = join(directory, 'data', 'codetether.sqlite3')
  await mkdir(workspace, { recursive: true })
  const remoteRoot = '/srv/projects/codetether-remote-claude'
  let service
  try {
    const persistence = ConversationStore.open({ databasePath })
    const coordinator = new FakeRemoteMachineCoordinator(persistence)
    coordinator.remoteClaudeExecution = true
    const localRuntime = new TrackingRuntime('codex')
    service = await createService({
      workspace,
      databasePath,
      runtimes: [localRuntime],
      maxConversations: 2,
      remoteMachineCoordinator: coordinator,
      persistence,
    })
    const project = (await service.listProjects()).projects[0]
    assert.ok(project)
    await service.beginRemoteMachinePairing({
      actionId: 'act_remote_claude_pair01',
      address: { host: '192.0.2.10', port: 43_217 },
      pairingCode: '482731',
    })
    await service.confirmRemoteMachinePairing(coordinator.attemptId, {
      actionId: 'act_remote_claude_confirm01',
    })
    await service.updateMachineConnectionAddress(coordinator.machineId, {
      actionId: 'act_remote_claude_online01',
      address: { host: '192.0.2.11', port: 43_217 },
    })
    await service.refreshMachineProviders(coordinator.machineId, {
      actionId: 'act_remote_claude_detect01',
    })
    coordinator.validationCanonicalPath = remoteRoot
    await service.registerProjectLocation(project.projectId, {
      actionId: 'act_remote_claude_location01',
      machineId: coordinator.machineId,
      path: remoteRoot,
    })

    await assert.rejects(
      service.createConversation({
        actionId: 'act_remote_claude_invalid_effort01',
        machineId: coordinator.machineId,
        projectId: project.projectId,
        provider: 'claude-code',
        reasoning: 'ultra',
      }),
      (error) => error.code === 'invalid_request',
    )
    assert.equal(coordinator.openClaudeCalls.length, 0)

    const createRequest = {
      actionId: 'act_remote_claude_create01',
      machineId: coordinator.machineId,
      projectId: project.projectId,
      provider: 'claude-code',
      reasoning: 'high',
    }
    const created = await service.createConversation(createRequest)
    assert.deepEqual(await service.createConversation(createRequest), created)
    assert.equal(created.data.conversation.provider, 'claude-code')
    assert.equal(created.data.conversation.machineId, coordinator.machineId)
    assert.equal(created.data.conversation.reasoning, 'high')
    assert.equal(coordinator.openClaudeCalls.length, 0)
    assert.equal(localRuntime.startConversationCalls.length, 0)

    const conversationId = created.data.conversation.conversationId
    service.getConversation(conversationId)
    await service.renameConversation(conversationId, {
      actionId: 'act_remote_claude_cold_rename01',
      title: 'Remote Claude cold metadata',
    })
    const search = await service.searchProjectConversations(project.projectId, {
      q: 'remote claude cold',
      archive: 'active',
      limit: 25,
    })
    assert.equal(search.results[0]?.conversation.conversationId, conversationId)
    assert.equal(coordinator.openClaudeCalls.length, 0)

    const turnRequest = {
      actionId: 'act_remote_claude_turn01',
      input: { type: 'text', text: 'Inspect fixture.txt safely' },
    }
    const [firstTurn, duplicateTurn] = await Promise.all([
      service.startTurn(conversationId, turnRequest),
      service.startTurn(conversationId, turnRequest),
    ])
    assert.deepEqual(duplicateTurn, firstTurn)
    assert.equal(coordinator.openClaudeCalls.length, 1)
    assert.equal(coordinator.openClaudeCalls[0].providerSessionId, undefined)
    assert.equal(
      coordinator.openClaudeCalls[0].providerSessionMaterialized,
      undefined,
    )
    assert.equal(coordinator.openClaudeCalls[0].effort, 'high')
    assert.equal(coordinator.remoteClaudeTurnCalls.length, 1)
    await assert.rejects(
      service.startTurn(conversationId, {
        ...turnRequest,
        input: { type: 'text', text: 'changed input' },
      }),
      (error) => error.code === 'conflict',
    )

    const completed = await waitForConversationIdle(service, conversationId)
    assert.equal(completed.conversation.status, 'completed')
    assert.equal(completed.runtime.turns.length, 1)
    assert.equal(completed.runtime.messages[0]?.text, 'remote complete')
    assert.equal(completed.runtime.tools.length, 1)
    assert.equal(completed.runtime.tools[0]?.kind, 'read')
    assert.equal(completed.runtime.tools[0]?.status, 'completed')
    assert.equal(completed.runtime.tools[0]?.success, true)
    assert.equal(
      JSON.stringify(completed).includes(
        '123e4567-e89b-42d3-a456-426614174000',
      ),
      false,
    )
    const attention = service.listAttention({ status: 'open', limit: 50 })
    assert.equal(
      attention.items.filter(
        (item) =>
          item.conversationId === conversationId &&
          item.type === 'completed_review',
      ).length,
      1,
    )

    coordinator.remoteClaudeSessions.at(-1)?.simulateIdleClose()
    await service.startTurn(conversationId, {
      actionId: 'act_remote_claude_resume01',
      input: { type: 'text', text: 'Continue the native session' },
    })
    assert.equal(coordinator.openClaudeCalls.length, 2)
    assert.equal(
      coordinator.openClaudeCalls[1].providerSessionId,
      '123e4567-e89b-42d3-a456-426614174000',
    )
    assert.equal(
      coordinator.openClaudeCalls[1].providerSessionMaterialized,
      true,
    )
    assert.equal(coordinator.openClaudeCalls[1].effort, 'high')
    await waitForConversationIdle(service, conversationId)
    assert.equal(coordinator.remoteClaudeTurnCalls.length, 2)
    assert.equal(localRuntime.startConversationCalls.length, 0)
  } finally {
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
    persistence:
      options.persistence ??
      ConversationStore.open({ databasePath: options.databasePath }),
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
  constructor(persistence) {
    this.persistence = persistence
    this.attemptId = 'pairing_remoteapi01'
    this.machineId = 'machine_remoteapi01'
    this.failUnpair = false
    this.failAddressUpdate = false
    this.connection = { state: 'offline' }
    this.retryCalls = []
    this.addressUpdates = []
    this.validationCalls = []
    this.validationCanonicalPath = undefined
    this.validationError = undefined
    this.unpairCalls = 0
    this.discoveryCalls = 0
    this.discoveryListeners = new Set()
    this.currentProviderObservedAt = undefined
    this.remoteExecution = false
    this.remoteClaudeExecution = false
    this.openCodexCalls = []
    this.openClaudeCalls = []
    this.remoteTurnCalls = []
    this.remoteClaudeTurnCalls = []
    this.remoteSessionCloseCalls = 0
    this.remoteClaudeSessionCloseCalls = 0
    this.remoteSessions = []
    this.remoteClaudeSessions = []
    this.openError = undefined
    this.offlineAfterStart = false
    this.statusListeners = new Set()
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
    return this.connection.state
  }

  providerExecutionAvailable(machineId) {
    return (
      (this.remoteExecution || this.remoteClaudeExecution) &&
      machineId === this.machineId &&
      this.connection.state === 'online' &&
      this.currentProviderObservedAt !== undefined
    )
  }

  subscribeStatus(listener) {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  setConnection(state) {
    this.connection = { state }
    for (const listener of this.statusListeners) listener(this.machineId, state)
  }

  connectionDetails() {
    return this.connection
  }

  subscribeProviderDiscovery(listener) {
    this.discoveryListeners.add(listener)
    return () => this.discoveryListeners.delete(listener)
  }

  providerDiscoveryCurrent(machineId, observedAt) {
    return (
      machineId === this.machineId &&
      this.connection.state === 'online' &&
      observedAt === this.currentProviderObservedAt
    )
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
    this.unpairCalls += 1
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

  async retry(machine, trust) {
    this.retryCalls.push({ machine, trust })
    this.connection = {
      state: 'connecting',
      lastAttemptAt: timestamp,
    }
    return this.connection
  }

  async updateAddress(machine, trust, address) {
    this.addressUpdates.push({ machine, trust, address })
    if (this.failAddressUpdate) {
      throw new RemoteMachineCoordinatorError(
        'identity_mismatch',
        'Controlled endpoint identity mismatch',
      )
    }
    this.connection = {
      state: 'online',
      currentEndpoint: address,
      lastAttemptAt: timestamp,
      lastSuccessfulAt: timestamp,
    }
    return this.connection
  }

  async discoverProviders(machine, trust) {
    assert.equal(machine.machineId, this.machineId)
    assert.equal(trust.machineId, this.machineId)
    this.discoveryCalls += 1
    const observation = this.persistence.recordRemoteProviderObservation({
      machineId: this.machineId,
      providers: remoteProviderDescriptors(
        this.remoteExecution,
        this.remoteClaudeExecution,
      ),
      observedAt: timestamp,
    })
    this.currentProviderObservedAt = observation.observedAt
    for (const listener of this.discoveryListeners) listener(observation)
    return observation
  }

  async validateProjectLocation(machine, trust, path) {
    this.validationCalls.push({ machine, trust, path })
    if (this.validationError !== undefined) throw this.validationError
    const canonicalPath = this.validationCanonicalPath ?? path
    return {
      canonicalPath,
      basename: canonicalPath.split('/').filter(Boolean).at(-1) ?? '/',
      exists: true,
      directory: true,
    }
  }

  async openCodexSession(machine, trust, input) {
    assert.equal(machine.machineId, this.machineId)
    assert.equal(trust.machineId, this.machineId)
    if (!this.remoteExecution) {
      throw new RemoteMachineCoordinatorError(
        'remote_execution_unavailable',
        'Controlled unavailable remote execution',
      )
    }
    if (this.openError !== undefined) throw this.openError
    this.openCodexCalls.push(input)
    const providerThreadId =
      input.providerThreadId ?? 'remote-native-session-machine-api'
    let closed = false
    const session = {
      machineId: this.machineId,
      conversationId: input.conversationId,
      providerThreadId,
      get closed() {
        return closed
      },
      simulateIdleClose() {
        closed = true
      },
      startTurn: async (turn) => {
        this.remoteTurnCalls.push(turn)
        if (this.offlineAfterStart) {
          this.offlineAfterStart = false
          this.setConnection('offline')
        }
        return {
          async *events() {
            if (closed) throw new Error('controlled Node disconnect')
            yield { type: 'message.delta', text: 'remote ', sequence: 1 }
            yield { type: 'message.delta', text: 'complete', sequence: 2 }
            yield { type: 'message.completed', sequence: 3 }
            yield { type: 'turn.completed', sequence: 4 }
          },
        }
      },
      close: async () => {
        closed = true
        this.remoteSessionCloseCalls += 1
      },
    }
    this.remoteSessions.push(session)
    return session
  }

  async openClaudeSession(machine, trust, input) {
    assert.equal(machine.machineId, this.machineId)
    assert.equal(trust.machineId, this.machineId)
    if (!this.remoteClaudeExecution) {
      throw new RemoteMachineCoordinatorError(
        'remote_execution_unavailable',
        'Controlled unavailable remote Claude execution',
      )
    }
    if (this.openError !== undefined) throw this.openError
    this.openClaudeCalls.push(input)
    const providerSessionId =
      input.providerSessionId ?? '123e4567-e89b-42d3-a456-426614174000'
    let closed = false
    const session = {
      machineId: this.machineId,
      conversationId: input.conversationId,
      providerSessionId,
      effort: input.effort,
      get closed() {
        return closed
      },
      simulateIdleClose() {
        closed = true
      },
      startTurn: async (turn) => {
        this.remoteClaudeTurnCalls.push(turn)
        return {
          async *events() {
            if (closed) throw new Error('controlled Claude Node disconnect')
            yield { type: 'message.delta', text: 'remote ', sequence: 1 }
            yield {
              type: 'tool.started',
              itemId: 'read-item-1',
              kind: 'read',
              name: 'Read',
              command: 'fixture.txt',
              sequence: 2,
            }
            yield {
              type: 'tool.output',
              itemId: 'read-item-1',
              output: 'known marker',
              sequence: 3,
            }
            yield {
              type: 'tool.completed',
              itemId: 'read-item-1',
              kind: 'read',
              name: 'Read',
              command: 'fixture.txt',
              success: true,
              sequence: 4,
            }
            yield { type: 'message.delta', text: 'complete', sequence: 5 }
            yield { type: 'message.completed', sequence: 6 }
            yield { type: 'turn.completed', sequence: 7 }
          },
        }
      },
      close: async () => {
        closed = true
        this.remoteClaudeSessionCloseCalls += 1
      },
    }
    this.remoteClaudeSessions.push(session)
    return session
  }

  async close() {}
}

function remoteProviderDescriptors(
  remoteExecution = false,
  remoteClaudeExecution = false,
) {
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
  return [
    {
      provider: 'codex',
      displayName: 'Codex',
      availability: 'available',
      version: '1.2.3',
      capabilities: {
        ...unavailableCapabilities,
        streaming: remoteExecution,
        resume: remoteExecution,
      },
    },
    {
      provider: 'claude-code',
      displayName: 'Claude Code',
      availability: remoteClaudeExecution ? 'available' : 'not_installed',
      capabilities: {
        ...unavailableCapabilities,
        streaming: remoteClaudeExecution,
        resume: remoteClaudeExecution,
        fileRead: remoteClaudeExecution,
        search: remoteClaudeExecution,
        toolEvents: remoteClaudeExecution,
        reasoningControl: remoteClaudeExecution,
      },
      ...(remoteClaudeExecution
        ? {
            reasoningLabel: '思考强度',
            reasoningOptions: [
              ['low', '低'],
              ['medium', '中'],
              ['high', '高'],
              ['xhigh', '超高'],
              ['max', '最大'],
            ].map(([id, label]) => ({ id, label })),
          }
        : {}),
    },
  ]
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

async function waitForConversationIdle(service, conversationId) {
  return await waitForConversationStatus(service, conversationId, 'completed')
}

async function waitForConversationStatus(service, conversationId, status) {
  let lastDetail
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const detail = service.getConversation(conversationId)
    if (detail.conversation.status === status) return detail
    lastDetail = detail
    await new Promise((resolve) => setImmediate(resolve))
  }
  throw new Error(
    `Timed out waiting for remote Conversation ${status}: ${JSON.stringify(lastDetail)}`,
  )
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
