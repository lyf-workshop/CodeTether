import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
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
  async close() {}

  fail(error) {
    for (const listener of this.failures) listener(error)
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
    assert.ok(project)

    const codexConversation = await service.createConversation({
      actionId: 'act_mixed_codex_create',
      projectId: project.projectId,
      provider: 'codex',
    })
    const claudeConversation = await service.createConversation({
      actionId: 'act_mixed_claude_create',
      projectId: project.projectId,
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
      'unavailable',
    )

    await assert.rejects(
      service.createConversation({
        actionId: 'act_mixed_capacity',
        projectId: project.projectId,
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
    conversationId = (
      await firstService.createConversation({
        actionId: 'act_zero_turn_restart_create',
        projectId,
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
    const first = await service.createConversation({
      actionId: 'act_zero_turn_evict_first',
      projectId,
      provider: 'claude-code',
    })
    await service.createConversation({
      actionId: 'act_zero_turn_evict_second',
      projectId,
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
