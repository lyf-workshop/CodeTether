import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { canonicalFailure } from '@codetether/agent-core'

import { HostEventPublisher } from '../dist/api/host-event-publisher.js'
import {
  HostService,
  HostServiceError,
  newEpoch,
} from '../dist/api/host-service.js'
import { WorkspacePolicy } from '../dist/api/workspace-policy.js'
import { UnavailableAgentRuntime } from '../dist/api/unavailable-agent-runtime.js'
import { ConversationStore } from '../dist/persistence/conversation-store.js'

const capabilities = {
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

class MixedRuntime {
  constructor(provider, sessionId = 'shared-provider-session') {
    this.provider = provider
    this.sessionId = sessionId
    this.available = true
    this.descriptor = {
      provider,
      displayName: provider === 'codex' ? 'Codex' : 'Claude Code',
      availability: 'available',
      capabilities: {
        ...capabilities,
        interrupt: provider === 'codex',
        approvals: provider === 'codex',
        fileEdit: provider === 'codex',
        shell: provider === 'codex',
        diff: provider === 'codex',
        modelSelection: provider === 'codex',
        reasoningControl: provider === 'codex',
      },
    }
    this.events = new Set()
    this.failures = new Set()
    this.turnCalls = []
    this.turnSequence = 0
    this.closeCalls = 0
    this.closeError = undefined
  }

  subscribeEvents(listener) {
    this.events.add(listener)
    return () => this.events.delete(listener)
  }

  subscribeFailures(listener) {
    this.failures.add(listener)
    return () => this.failures.delete(listener)
  }

  subscribeApprovals() {
    return () => undefined
  }

  async startConversation() {
    return { providerThreadId: this.sessionId }
  }

  async resumeConversation(options) {
    return { providerThreadId: options.providerThreadId }
  }

  async startTurn(options) {
    this.turnSequence += 1
    this.turnCalls.push(options)
    return { providerTurnId: `${this.provider}-turn-${this.turnSequence}` }
  }

  async interruptTurn() {}
  async close() {
    this.closeCalls += 1
    if (this.closeError !== undefined) throw this.closeError
  }

  fail(error) {
    for (const listener of this.failures) listener(error)
  }

  completeLast(message = 'Recovered explicitly') {
    const turn = this.turnCalls.at(-1)
    if (turn === undefined) throw new Error('No Provider Turn to complete')
    for (const listener of this.events) {
      listener({
        provider: this.provider,
        timestamp: '2026-09-02T22:00:00.000Z',
        threadId: turn.providerThreadId,
        turnId: `${this.provider}-turn-${this.turnSequence}`,
        itemId: `${this.provider}-message-${this.turnSequence}`,
        type: 'message.delta',
        delta: message,
      })
      listener({
        provider: this.provider,
        timestamp: '2026-09-02T22:00:00.000Z',
        threadId: turn.providerThreadId,
        turnId: `${this.provider}-turn-${this.turnSequence}`,
        itemId: `${this.provider}-message-${this.turnSequence}`,
        type: 'message.completed',
        message,
      })
      listener({
        provider: this.provider,
        timestamp: '2026-09-02T22:00:00.000Z',
        threadId: turn.providerThreadId,
        turnId: `${this.provider}-turn-${this.turnSequence}`,
        type: 'turn.completed',
        finalMessage: message,
      })
    }
  }
}

class MaterializationRuntime extends MixedRuntime {
  constructor() {
    super('claude-code')
    this.resumeCalls = []
    this.disposeCalls = []
    this.sessionSequence = 0
  }

  async startConversation() {
    this.sessionSequence += 1
    return { providerThreadId: `claude-session-${this.sessionSequence}` }
  }

  async resumeConversation(options) {
    this.resumeCalls.push(options)
    return { providerThreadId: options.providerThreadId }
  }

  async disposeConversation(options) {
    this.disposeCalls.push(options)
  }
}

test('routes mixed Conversations through Provider-scoped sessions and failures', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'codetether-providers-'))
  const codex = new MixedRuntime('codex')
  const claude = new MixedRuntime('claude-code')
  const service = new HostService({
    runtimes: [codex, claude],
    workspacePolicy: await WorkspacePolicy.create([workspace]),
    publisher: new HostEventPublisher({ epoch: newEpoch() }),
    hostVersion: 'test',
    maxConversations: 2,
  })

  try {
    await service.registerInitialProjectRoots([workspace])
    const project = (await service.listProjects()).projects[0]
    const machine = service.listMachines().machines[0]
    assert.ok(project)
    assert.ok(machine)

    const codexConversation = await service.createConversation({
      actionId: 'act_mixed_codex_create',
      projectId: project.projectId,
      machineId: machine.machineId,
      provider: 'codex',
    })
    const claudeConversation = await service.createConversation({
      actionId: 'act_mixed_claude_create',
      projectId: project.projectId,
      machineId: machine.machineId,
      provider: 'claude-code',
    })
    assert.equal(codexConversation.data.conversation.provider, 'codex')
    assert.equal(claudeConversation.data.conversation.provider, 'claude-code')

    const codexTurn = await service.startTurn(
      codexConversation.data.conversation.conversationId,
      {
        actionId: 'act_mixed_codex_turn',
        input: { type: 'text', text: 'Codex turn' },
      },
    )
    const claudeTurn = await service.startTurn(
      claudeConversation.data.conversation.conversationId,
      {
        actionId: 'act_mixed_claude_turn',
        input: { type: 'text', text: 'Claude turn' },
      },
    )
    assert.equal(codex.turnCalls.length, 1)
    assert.equal(claude.turnCalls.length, 1)
    assert.equal(codex.turnCalls[0].cwd, workspace)
    assert.equal(claude.turnCalls[0].cwd, workspace)

    claude.fail(new Error('claude process failed'))
    const snapshot = service.snapshot()
    assert.equal(
      snapshot.activeTurns.some(
        (turn) => turn.turnId === codexTurn.data.turn.turnId,
      ),
      true,
    )
    assert.equal(
      snapshot.activeTurns.some(
        (turn) => turn.turnId === claudeTurn.data.turn.turnId,
      ),
      false,
    )
    assert.equal(service.bootstrap().capabilities.codex, true)
    assert.equal(
      service
        .bootstrap()
        .providers?.find((provider) => provider.provider === 'codex')
        ?.availability,
      'available',
    )
    assert.equal(
      service
        .bootstrap()
        .providers?.find((provider) => provider.provider === 'claude-code')
        ?.availability,
      'available',
    )
    assert.equal(
      service
        .bootstrap()
        .providers?.find((provider) => provider.provider === 'claude-code')
        ?.executionHealth?.failure?.reason,
      'runtime_error',
    )

    await assert.rejects(
      service.createConversation({
        actionId: 'act_mixed_capacity',
        projectId: project.projectId,
        machineId: machine.machineId,
        provider: 'codex',
      }),
      (error) =>
        error instanceof HostServiceError &&
        error.code === 'runtime_unavailable',
    )
  } finally {
    await service.close().catch(() => undefined)
    await rm(workspace, { recursive: true, force: true })
  }
})

test('marks a restarted zero-Turn Provider session as not materialized', async () => {
  const workspace = await mkdtemp(
    join(tmpdir(), 'codetether-zero-turn-restart-'),
  )
  const databasePath = join(workspace, 'host.sqlite')
  let conversationId
  let projectId

  try {
    const firstRuntime = new MaterializationRuntime()
    const firstService = new HostService({
      runtimes: [firstRuntime],
      workspacePolicy: await WorkspacePolicy.create([workspace]),
      publisher: new HostEventPublisher({ epoch: newEpoch() }),
      hostVersion: 'test',
      persistence: ConversationStore.open({ databasePath }),
    })
    await firstService.registerInitialProjectRoots([workspace])
    projectId = (await firstService.listProjects()).projects[0].projectId
    const machine = firstService.listMachines().machines[0]
    assert.ok(machine)
    conversationId = (
      await firstService.createConversation({
        actionId: 'act_zero_turn_restart_create',
        projectId,
        machineId: machine.machineId,
        provider: 'claude-code',
      })
    ).data.conversation.conversationId
    await firstService.close()

    const restartedRuntime = new MaterializationRuntime()
    const restartedService = new HostService({
      runtimes: [restartedRuntime],
      workspacePolicy: await WorkspacePolicy.create([workspace]),
      publisher: new HostEventPublisher({ epoch: newEpoch() }),
      hostVersion: 'test',
      persistence: ConversationStore.open({ databasePath }),
    })
    try {
      await restartedService.startTurn(conversationId, {
        actionId: 'act_zero_turn_restart_start',
        input: { type: 'text', text: 'first durable Turn' },
      })
      assert.equal(restartedRuntime.resumeCalls.length, 1)
      assert.equal(
        restartedRuntime.resumeCalls[0].providerSessionMaterialized,
        false,
      )
    } finally {
      await restartedService.close().catch(() => undefined)
    }
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('marks an evicted zero-Turn Provider session as not materialized', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'codetether-zero-turn-evict-'))
  const runtime = new MaterializationRuntime()
  const service = new HostService({
    runtimes: [runtime],
    workspacePolicy: await WorkspacePolicy.create([workspace]),
    publisher: new HostEventPublisher({ epoch: newEpoch() }),
    hostVersion: 'test',
    maxConversations: 1,
    persistence: ConversationStore.open({
      databasePath: join(workspace, 'host.sqlite'),
    }),
  })

  try {
    await service.registerInitialProjectRoots([workspace])
    const projectId = (await service.listProjects()).projects[0].projectId
    const machine = service.listMachines().machines[0]
    assert.ok(machine)
    const first = await service.createConversation({
      actionId: 'act_zero_turn_evict_first',
      projectId,
      machineId: machine.machineId,
      provider: 'claude-code',
    })
    await service.createConversation({
      actionId: 'act_zero_turn_evict_second',
      projectId,
      machineId: machine.machineId,
      provider: 'claude-code',
    })
    await service.startTurn(first.data.conversation.conversationId, {
      actionId: 'act_zero_turn_evict_start',
      input: { type: 'text', text: 'first durable Turn after eviction' },
    })

    assert.equal(runtime.disposeCalls.length >= 1, true)
    assert.equal(runtime.resumeCalls.length, 1)
    assert.equal(runtime.resumeCalls[0].providerSessionMaterialized, false)
  } finally {
    await service.close().catch(() => undefined)
    await rm(workspace, { recursive: true, force: true })
  }
})

test('an explicit local Turn replaces one crashed runtime and resets health only after success', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'codetether-local-recovery-'))
  const crashed = new MixedRuntime('codex', 'local-recovery-session')
  const recovered = new MixedRuntime('codex', 'local-recovery-session')
  let refreshCalls = 0
  const service = new HostService({
    runtimes: [crashed],
    workspacePolicy: await WorkspacePolicy.create([workspace]),
    publisher: new HostEventPublisher({ epoch: newEpoch() }),
    hostVersion: 'test',
    persistence: ConversationStore.open({
      databasePath: join(workspace, 'host.sqlite'),
    }),
    refreshUnavailableLocalProvider: async (provider) => {
      assert.equal(provider, 'codex')
      refreshCalls += 1
      return recovered
    },
  })

  try {
    await service.registerInitialProjectRoots([workspace])
    const project = (await service.listProjects()).projects[0]
    const machine = service.listMachines().machines[0]
    const conversation = await service.createConversation({
      actionId: 'act_local_crash_recovery_create',
      projectId: project.projectId,
      machineId: machine.machineId,
      provider: 'codex',
    })
    const fatalFailure = Object.assign(
      new Error('PRIVATE fatal Provider detail'),
      { failureReason: 'provider_crashed' },
    )
    crashed.closeError = fatalFailure
    crashed.fail(fatalFailure)

    const started = await service.startTurn(
      conversation.data.conversation.conversationId,
      {
        actionId: 'act_local_crash_recovery_turn',
        input: { type: 'text', text: 'fresh explicit request only' },
      },
    )
    assert.equal(refreshCalls, 1)
    assert.equal(crashed.closeCalls, 1)
    assert.equal(recovered.turnCalls.length, 1)
    assert.equal(recovered.turnCalls[0].input, 'fresh explicit request only')
    recovered.completeLast()

    const detail = service.getConversation(
      conversation.data.conversation.conversationId,
    )
    assert.equal(detail.runtime.turns.at(-1)?.turnId, started.data.turn.turnId)
    assert.equal(detail.runtime.turns.at(-1)?.status, 'completed')
    const provider = (await service.getMachine(machine.machineId)).providers[0]
    assert.equal(provider.executionHealth?.state, 'healthy')
    assert.equal(provider.executionHealth?.failure, undefined)
  } finally {
    await service.close().catch(() => undefined)
    await rm(workspace, { recursive: true, force: true })
  }
})

test('explicit local Conversation creation re-probes a repaired login once', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'codetether-login-recovery-'))
  const observedAt = '2026-09-02T21:00:00.000Z'
  const unavailable = new UnavailableAgentRuntime('claude-code', {
    provider: 'claude-code',
    displayName: 'Claude Code',
    availability: 'available',
    capabilities,
    executionHealth: {
      state: 'unavailable',
      freshness: 'current',
      observedAt,
      failure: canonicalFailure('login_required', observedAt),
    },
  })
  const recovered = new MixedRuntime('claude-code', 'login-recovery-session')
  let refreshCalls = 0
  const service = new HostService({
    runtimes: [unavailable],
    workspacePolicy: await WorkspacePolicy.create([workspace]),
    publisher: new HostEventPublisher({ epoch: newEpoch() }),
    hostVersion: 'test',
    refreshUnavailableLocalProvider: async (provider) => {
      assert.equal(provider, 'claude-code')
      refreshCalls += 1
      return recovered
    },
  })

  try {
    await service.registerInitialProjectRoots([workspace])
    const project = (await service.listProjects()).projects[0]
    const machine = service.listMachines().machines[0]
    const created = await service.createConversation({
      actionId: 'act_local_login_recovery_create',
      projectId: project.projectId,
      machineId: machine.machineId,
      provider: 'claude-code',
    })

    assert.equal(refreshCalls, 1)
    assert.equal(created.data.conversation.provider, 'claude-code')
    assert.equal(recovered.turnCalls.length, 0)
  } finally {
    await service.close().catch(() => undefined)
    await rm(workspace, { recursive: true, force: true })
  }
})
