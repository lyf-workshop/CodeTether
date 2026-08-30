import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import test from 'node:test'

import { HostEventPublisher } from '../dist/api/host-event-publisher.js'
import {
  HostService,
  HostServiceError,
  newEpoch,
} from '../dist/api/host-service.js'
import { LocalHttpServer } from '../dist/api/local-http-server.js'
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

async function createService(options) {
  const service = new HostService({
    runtimes: options.runtimes,
    workspacePolicy: await WorkspacePolicy.create([options.workspace]),
    publisher: new HostEventPublisher({ epoch: newEpoch() }),
    hostVersion: '0.0.0-machine-test',
    now: () => new Date(timestamp),
    maxConversations: options.maxConversations,
    persistence: ConversationStore.open({ databasePath: options.databasePath }),
  })
  if (options.registerRoot !== false) {
    await service.registerInitialProjectRoots([options.workspace])
  }
  return service
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
