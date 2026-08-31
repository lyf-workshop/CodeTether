import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { ProviderConversationUnavailableError } from '../dist/api/agent-runtime.js'
import { HostEventPublisher } from '../dist/api/host-event-publisher.js'
import { HostService, HostServiceError } from '../dist/api/host-service.js'
import { WorkspacePolicy } from '../dist/api/workspace-policy.js'
import {
  ConversationStore,
  DURABLE_TURN_SNAPSHOT_VERSION,
  initialTurnPresentation,
} from '../dist/persistence/index.js'
import { normalizeTrustedProjectRoot } from '../dist/project-path.js'

const timestamp = '2026-08-27T08:00:00.000Z'

class FakeRuntime {
  provider = 'codex'
  conversationCalls = []
  resumeCalls = []
  turnCalls = []
  interruptCalls = []
  approvalDecisions = []
  closeCalls = 0
  conversationError = undefined
  turnPrefix = 'provider-turn'
  resumeError = undefined
  #eventListeners = new Set()
  #failureListeners = new Set()
  #approvalListeners = new Set()

  subscribeEvents(listener) {
    this.#eventListeners.add(listener)
    return () => this.#eventListeners.delete(listener)
  }

  subscribeFailures(listener) {
    this.#failureListeners.add(listener)
    return () => this.#failureListeners.delete(listener)
  }

  subscribeApprovals(onRequest, onResolved) {
    const value = { onRequest, onResolved }
    this.#approvalListeners.add(value)
    return () => this.#approvalListeners.delete(value)
  }

  async startConversation(options) {
    this.conversationCalls.push(options)
    if (this.conversationError !== undefined) throw this.conversationError
    return {
      providerThreadId: `provider-thread-${String(this.conversationCalls.length)}`,
      model: options.model ?? 'gpt-5.6-sol',
    }
  }

  async resumeConversation(options) {
    this.resumeCalls.push(options)
    if (this.resumeError !== undefined) throw this.resumeError
    return {
      providerThreadId: options.providerThreadId,
      model: 'gpt-5.6-sol',
    }
  }

  async startTurn(options) {
    const providerTurnId = `${this.turnPrefix}-${String(this.turnCalls.length + 1)}`
    this.turnCalls.push({ options, providerTurnId })
    return { providerTurnId }
  }

  async interruptTurn(options) {
    this.interruptCalls.push(options)
  }

  async close() {
    this.closeCalls += 1
  }

  emit(event) {
    for (const listener of this.#eventListeners) listener(event)
  }

  requestApproval(options) {
    for (const listeners of this.#approvalListeners) {
      listeners.onRequest({
        providerRequestId: options.providerRequestId,
        providerApprovalId: options.providerApprovalId,
        providerThreadId: options.providerThreadId,
        providerTurnId: options.providerTurnId,
        providerItemId: options.providerItemId,
        kind: 'command',
        summary: 'Run a safe command',
        respond: (decision) => {
          this.approvalDecisions.push(decision)
          if (options.autoResolve === true) {
            this.resolveApproval({
              providerRequestId: options.providerRequestId,
              providerApprovalId: options.providerApprovalId,
              providerThreadId: options.providerThreadId,
              providerTurnId: options.providerTurnId,
              providerItemId: options.providerItemId,
              decision,
            })
          }
        },
      })
    }
  }

  resolveApproval(resolution) {
    for (const listeners of this.#approvalListeners) {
      listeners.onResolved(resolution)
    }
  }
}

async function createEnvironment() {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-host-durable-'))
  const workspace = join(directory, 'workspace')
  const databasePath = join(directory, 'data', 'codetether.sqlite3')
  await import('node:fs/promises').then(({ mkdir }) =>
    mkdir(workspace, { recursive: true }),
  )
  return { directory, workspace, databasePath }
}

async function createService(environment, epoch, runtime = new FakeRuntime()) {
  const store = ConversationStore.open({
    databasePath: environment.databasePath,
  })
  const workspacePolicy = await WorkspacePolicy.create([environment.workspace])
  const publisher = new HostEventPublisher({ epoch })
  const service = new HostService({
    runtime,
    workspacePolicy,
    publisher,
    persistence: store,
    hostVersion: '0.0.0-test',
    now: () => new Date(timestamp),
    persistenceFlushMs: 5,
  })
  await service.registerInitialProjectRoots([environment.workspace])
  return { store, runtime, publisher, service }
}

async function createConversation(
  service,
  cwd,
  actionId = 'act_persist_create01',
) {
  const machine = service.listMachines().machines[0]
  assert.ok(machine)
  return await service.createConversation({
    actionId,
    provider: 'codex',
    machineId: machine.machineId,
    cwd,
  })
}

async function startTurn(service, conversationId, actionId, text) {
  return await service.startTurn(conversationId, {
    actionId,
    input: { type: 'text', text },
  })
}

function providerEvent(type, threadId, turnId, fields = {}) {
  return {
    type,
    provider: 'codex',
    threadId,
    turnId,
    timestamp,
    ...fields,
  }
}

function completeRichTurn(runtime, threadId, turnId, suffix) {
  runtime.emit(
    providerEvent('message.delta', threadId, turnId, {
      itemId: `provider-message-${suffix}`,
      delta: `Answer ${suffix}`,
    }),
  )
  runtime.emit(
    providerEvent('message.completed', threadId, turnId, {
      itemId: `provider-message-${suffix}`,
      message: `Answer ${suffix}`,
    }),
  )
  runtime.emit(
    providerEvent('tool.started', threadId, turnId, {
      itemId: `provider-tool-${suffix}`,
      name: 'git status --short',
      summary: 'Inspect Git status',
    }),
  )
  runtime.emit(
    providerEvent('tool.output', threadId, turnId, {
      itemId: `provider-tool-${suffix}`,
      output: `src/example.ts ${suffix}\n`,
      stream: 'stdout',
    }),
  )
  runtime.emit(
    providerEvent('tool.completed', threadId, turnId, {
      itemId: `provider-tool-${suffix}`,
      name: 'git status --short',
      success: true,
      summary: 'Git status completed',
    }),
  )
  runtime.emit(
    providerEvent('file.changed', threadId, turnId, {
      itemId: `provider-file-${suffix}`,
      path: 'src/example.ts',
      kind: 'modified',
      diff: `+// durable ${suffix}`,
    }),
  )
  runtime.emit(
    providerEvent('turn.completed', threadId, turnId, {
      finalMessage: `Finished ${suffix}`,
    }),
  )
}

test('Conversation identity, rich multi-Turn history, and Provider identity survive restart', async () => {
  const environment = await createEnvironment()
  try {
    const first = await createService(
      environment,
      '11111111-1111-4111-8111-111111111111',
    )
    const created = await createConversation(
      first.service,
      environment.workspace,
    )
    const conversationId = created.data.conversation.conversationId
    assert.equal(created.data.conversation.title, '新会话')
    assert.equal(first.store.getConversation(conversationId).title, '新会话')
    const providerThreadId = first.runtime.conversationCalls[0]
      ? 'provider-thread-1'
      : undefined
    assert.equal(providerThreadId, 'provider-thread-1')

    const turnOne = await startTurn(
      first.service,
      conversationId,
      'act_persist_turn001',
      'Remember marker DURABLE-ALPHA',
    )
    const titleAfterFirstInput = first.store.getConversation(conversationId)
    assert.equal(titleAfterFirstInput.title, 'Remember marker DURABLE-ALPHA')
    assert.equal(
      first.service.snapshot().conversations[0].title,
      titleAfterFirstInput.title,
    )
    completeRichTurn(
      first.runtime,
      providerThreadId,
      first.runtime.turnCalls[0].providerTurnId ?? 'provider-turn-1',
      'one',
    )
    const turnTwo = await startTurn(
      first.service,
      conversationId,
      'act_persist_turn002',
      'Use the marker from Turn 1',
    )
    assert.equal(
      first.store.getConversation(conversationId).title,
      titleAfterFirstInput.title,
    )
    completeRichTurn(
      first.runtime,
      providerThreadId,
      first.runtime.turnCalls[1].providerTurnId ?? 'provider-turn-2',
      'two',
    )
    const before = first.service.snapshot()
    assert.deepEqual(
      before.conversationRuntimes[0].turns.map((turn) => turn.input.text),
      ['Remember marker DURABLE-ALPHA', 'Use the marker from Turn 1'],
    )
    assert.equal(before.conversationRuntimes[0].tools.length, 2)
    assert.equal(before.conversationRuntimes[0].changes.length, 2)
    assert.match(before.conversationRuntimes[0].terminal.text, /example\.ts/)
    assert.equal(turnOne.data.turn.status, 'running')
    assert.equal(turnTwo.data.turn.status, 'running')
    await first.service.close()

    const resumedRuntime = new FakeRuntime()
    resumedRuntime.turnPrefix = 'provider-resumed-turn'
    const second = await createService(
      environment,
      '22222222-2222-4222-8222-222222222222',
      resumedRuntime,
    )
    const after = second.service.snapshot()
    assert.equal(after.epoch, '22222222-2222-4222-8222-222222222222')
    assert.equal(after.conversations[0].conversationId, conversationId)
    assert.equal(after.conversations[0].title, titleAfterFirstInput.title)
    assert.equal(
      second.store.getConversation(conversationId).title,
      titleAfterFirstInput.title,
    )
    assert.deepEqual(after.conversationRuntimes, before.conversationRuntimes)
    assert.equal(after.activeTurns.length, 0)
    assert.equal(after.pendingApprovals.length, 0)

    await startTurn(
      second.service,
      conversationId,
      'act_persist_turn003',
      'What marker did I ask you to remember?',
    )
    assert.deepEqual(second.runtime.resumeCalls, [
      {
        providerThreadId,
        cwd: environment.workspace,
        providerSessionMaterialized: true,
      },
    ])
    assert.equal(second.runtime.turnCalls.length, 1)
    completeRichTurn(
      second.runtime,
      providerThreadId,
      second.runtime.turnCalls[0].providerTurnId,
      'three',
    )
    await startTurn(
      second.service,
      conversationId,
      'act_persist_turn004',
      'Continue once more',
    )
    assert.equal(second.runtime.resumeCalls.length, 1)
    await second.service.close()
    assert.throws(() => second.store.listConversations(), /closed/)
  } finally {
    await removeEnvironment(environment.directory)
  }
})

test('graceful close declines Provider but expires pending Approval only on restart', async () => {
  const environment = await createEnvironment()
  try {
    const first = await createService(
      environment,
      '33333333-3333-4333-8333-333333333333',
    )
    const created = await createConversation(
      first.service,
      environment.workspace,
      'act_pending_create',
    )
    const conversationId = created.data.conversation.conversationId
    const started = await startTurn(
      first.service,
      conversationId,
      'act_pending_turn01',
      'Request approval safely',
    )
    first.runtime.requestApproval({
      providerRequestId: 42,
      providerApprovalId: 'provider-approval-42',
      providerThreadId: 'provider-thread-1',
      providerTurnId: 'provider-turn-1',
      providerItemId: 'provider-tool-approval',
      autoResolve: true,
    })
    const pendingApproval = first.service.snapshot().pendingApprovals[0]
    assert.ok(pendingApproval)
    const openAttention = first.store.listAttentionItems({
      type: 'approval',
      status: 'open',
    })
    assert.equal(openAttention.length, 1)
    assert.equal(
      openAttention[0].payload.approvalId,
      pendingApproval.approvalId,
    )
    await first.service.close()
    assert.deepEqual(first.runtime.approvalDecisions, ['decline'])

    const second = await createService(
      environment,
      '44444444-4444-4444-8444-444444444444',
    )
    const snapshot = second.service.snapshot()
    assert.equal(snapshot.conversations[0].status, 'idle')
    assert.equal(snapshot.activeTurns.length, 0)
    assert.equal(snapshot.pendingApprovals.length, 0)
    assert.equal(
      snapshot.conversationRuntimes[0].turns[0].status,
      'interrupted',
    )
    const durable = second.store.getTurn(started.data.turn.turnId)
    assert.equal(durable.status, 'interrupted')
    assert.equal(durable.snapshot.interruptionReason, 'host_restart')
    assert.equal(durable.snapshot.approvals[0].lifecycle, 'expired')
    assert.equal(durable.snapshot.approvals[0].reason, 'host_restart')
    const expiredAttention = second.store.getAttentionItem(
      openAttention[0].attentionId,
    )
    assert.equal(expiredAttention.status, 'expired')
    assert.equal(expiredAttention.payload.decision, undefined)
    assert.equal(expiredAttention.payload.expirationReason, 'host_restart')
    assert.equal(
      second.store.listAttentionItems({
        type: 'approval',
        status: 'resolved',
      }).length,
      0,
    )
    await assert.rejects(
      second.service.resolveApproval(pendingApproval.approvalId, {
        actionId: 'act_expired_approval01',
        decision: 'accept',
      }),
      (error) => {
        assert.ok(error instanceof HostServiceError)
        assert.equal(error.code, 'not_found')
        assert.equal(error.httpStatus, 404)
        return true
      },
    )
    assert.deepEqual(second.runtime.approvalDecisions, [])
    await second.service.close()
  } finally {
    await removeEnvironment(environment.directory)
  }
})

test('missing Provider Thread preserves local history and returns a specific safe error', async () => {
  const environment = await createEnvironment()
  try {
    const first = await createService(
      environment,
      '55555555-5555-4555-8555-555555555555',
    )
    const created = await createConversation(
      first.service,
      environment.workspace,
      'act_missing_create',
    )
    const conversationId = created.data.conversation.conversationId
    await startTurn(
      first.service,
      conversationId,
      'act_missing_turn01',
      'Durable local history',
    )
    completeRichTurn(
      first.runtime,
      'provider-thread-1',
      'provider-turn-1',
      'missing',
    )
    await first.service.close()

    const runtime = new FakeRuntime()
    runtime.resumeError = new ProviderConversationUnavailableError(
      'codex',
      'provider-thread-1',
    )
    const second = await createService(
      environment,
      '66666666-6666-4666-8666-666666666666',
      runtime,
    )
    const before = second.service.snapshot().conversationRuntimes[0]
    await assert.rejects(
      startTurn(
        second.service,
        conversationId,
        'act_missing_turn02',
        'Try to continue',
      ),
      (error) =>
        error instanceof HostServiceError &&
        error.code === 'provider_session_lost',
    )
    assert.equal(runtime.turnCalls.length, 0)
    assert.deepEqual(second.service.snapshot().conversationRuntimes[0], before)
    await second.service.close()
  } finally {
    await removeEnvironment(environment.directory)
  }
})

test('durable write failure prevents Provider Turn start', async () => {
  const environment = await createEnvironment()
  const runtime = new FakeRuntime()
  const durableMachine = {
    machineId: 'machine_writefailure01',
    displayName: 'Local computer',
    kind: 'local',
    platform: 'Windows',
    architecture: 'x64',
    createdAt: timestamp,
    lastSeenAt: timestamp,
  }
  const failingStore = {
    listMachines: () => [durableMachine],
    listTrustedMachinePeers: () => [],
    updateMachineLastSeen: (_machineId, lastSeenAt) => ({
      ...durableMachine,
      lastSeenAt,
    }),
    listProjects: () => [],
    listConversations: () => [],
    listIncompleteTurns: () => [],
    runInTransaction: (operation) => operation(),
    expireOpenApprovalAttentionItems: () => 0,
    createProject: () => undefined,
    countConversationsForProject: () => 0,
    createConversation: () => undefined,
    updateConversation: () => undefined,
    deleteConversation: () => true,
    createTurn: () => {
      throw new Error('disk full')
    },
    close: () => undefined,
  }
  const workspacePolicy = await WorkspacePolicy.create([environment.workspace])
  const service = new HostService({
    runtime,
    workspacePolicy,
    publisher: new HostEventPublisher({
      epoch: '77777777-7777-4777-8777-777777777777',
    }),
    persistence: failingStore,
    hostVersion: '0.0.0-test',
    now: () => new Date(timestamp),
  })
  try {
    await service.registerInitialProjectRoots([environment.workspace])
    const created = await createConversation(
      service,
      environment.workspace,
      'act_writefail_create',
    )
    await assert.rejects(
      startTurn(
        service,
        created.data.conversation.conversationId,
        'act_writefail_turn01',
        'Must never reach Codex',
      ),
      (error) =>
        error instanceof HostServiceError &&
        error.code === 'runtime_unavailable',
    )
    assert.equal(runtime.turnCalls.length, 0)
    assert.equal(service.bootstrap().capabilities.codex, false)
  } finally {
    await service.close().catch(() => undefined)
    await removeEnvironment(environment.directory)
  }
})

test('Provider conversation creation failure rolls back the creating row', async () => {
  const environment = await createEnvironment()
  const runtime = new FakeRuntime()
  runtime.conversationError = new Error('provider unavailable')
  try {
    const fixture = await createService(
      environment,
      '99999999-9999-4999-8999-999999999999',
      runtime,
    )
    await assert.rejects(
      createConversation(
        fixture.service,
        environment.workspace,
        'act_create_rollback01',
      ),
      (error) =>
        error instanceof HostServiceError && error.code === 'provider_error',
    )
    assert.equal(fixture.store.listConversations().length, 0)
    await fixture.service.close()
  } finally {
    await removeEnvironment(environment.directory)
  }
})

test('streaming deltas are throttled while terminal state flushes synchronously', async () => {
  const environment = await createEnvironment()
  try {
    const fixture = await createService(
      environment,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    )
    const created = await createConversation(
      fixture.service,
      environment.workspace,
      'act_flush_create01',
    )
    const started = await startTurn(
      fixture.service,
      created.data.conversation.conversationId,
      'act_flush_turn001',
      'Stream one answer',
    )
    fixture.runtime.emit(
      providerEvent('message.delta', 'provider-thread-1', 'provider-turn-1', {
        itemId: 'provider-message-flush',
        delta: 'durable delta',
      }),
    )
    assert.equal(
      fixture.store.getTurn(started.data.turn.turnId).snapshot.messages.length,
      0,
    )
    fixture.runtime.emit(
      providerEvent('turn.completed', 'provider-thread-1', 'provider-turn-1', {
        finalMessage: 'durable delta',
      }),
    )
    const durable = fixture.store.getTurn(started.data.turn.turnId)
    assert.equal(durable.status, 'completed')
    assert.equal(durable.snapshot.messages[0].text, 'durable delta')
    assert.equal(durable.snapshot.turn.finalMessage, 'durable delta')
    await fixture.service.close()
  } finally {
    await removeEnvironment(environment.directory)
  }
})

test('scheduled persistence flush stores active streaming state after the throttle window', async () => {
  const environment = await createEnvironment()
  try {
    const fixture = await createService(
      environment,
      '99999999-9999-4999-8999-999999999999',
    )
    const created = await createConversation(
      fixture.service,
      environment.workspace,
      'act_scheduled_flush_create',
    )
    const started = await startTurn(
      fixture.service,
      created.data.conversation.conversationId,
      'act_scheduled_flush_turn',
      'Stream before the timer flushes',
    )
    fixture.runtime.emit(
      providerEvent('message.delta', 'provider-thread-1', 'provider-turn-1', {
        itemId: 'provider-message-scheduled',
        delta: 'scheduled durable delta',
      }),
    )
    assert.equal(
      fixture.store.getTurn(started.data.turn.turnId).snapshot.messages.length,
      0,
    )

    await waitFor(() =>
      fixture.store
        .getTurn(started.data.turn.turnId)
        .snapshot.messages.some(
          (message) => message.text === 'scheduled durable delta',
        ),
    )
    await fixture.service.close()
  } finally {
    await removeEnvironment(environment.directory)
  }
})

test('graceful shutdown flushes dirty streaming state before the throttle window', async () => {
  const environment = await createEnvironment()
  try {
    const store = ConversationStore.open({
      databasePath: environment.databasePath,
    })
    const runtime = new FakeRuntime()
    const workspacePolicy = await WorkspacePolicy.create([
      environment.workspace,
    ])
    const service = new HostService({
      runtime,
      workspacePolicy,
      publisher: new HostEventPublisher({
        epoch: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }),
      persistence: store,
      persistenceFlushMs: 60_000,
      hostVersion: '0.0.0-test',
      now: () => new Date(timestamp),
    })
    await service.registerInitialProjectRoots([environment.workspace])
    const created = await createConversation(
      service,
      environment.workspace,
      'act_shutdown_flush_create',
    )
    const started = await startTurn(
      service,
      created.data.conversation.conversationId,
      'act_shutdown_flush_turn',
      'Flush this during shutdown',
    )
    runtime.emit(
      providerEvent('message.delta', 'provider-thread-1', 'provider-turn-1', {
        itemId: 'provider-message-shutdown',
        delta: 'graceful shutdown delta',
      }),
    )
    assert.equal(
      store.getTurn(started.data.turn.turnId).snapshot.messages.length,
      0,
    )
    await service.close()

    const reopened = ConversationStore.open({
      databasePath: environment.databasePath,
    })
    assert.equal(
      reopened.getTurn(started.data.turn.turnId).snapshot.messages[0].text,
      'graceful shutdown delta',
    )
    reopened.close()
  } finally {
    await removeEnvironment(environment.directory)
  }
})

test('session-ending close flushes dirty streaming state before waiting on runtime teardown', async () => {
  const environment = await createEnvironment()
  try {
    const store = ConversationStore.open({
      databasePath: environment.databasePath,
    })
    const runtime = new FakeRuntime()
    let releaseRuntimeClose
    const runtimeCloseGate = new Promise((resolveClose) => {
      releaseRuntimeClose = resolveClose
    })
    runtime.close = async () => {
      runtime.closeCalls += 1
      await runtimeCloseGate
    }
    const workspacePolicy = await WorkspacePolicy.create([
      environment.workspace,
    ])
    const service = new HostService({
      runtime,
      workspacePolicy,
      publisher: new HostEventPublisher({
        epoch: 'abababab-abab-4bab-8bab-abababababab',
      }),
      persistence: store,
      persistenceFlushMs: 60_000,
      hostVersion: '0.0.0-test',
      now: () => new Date(timestamp),
    })
    await service.registerInitialProjectRoots([environment.workspace])
    const created = await createConversation(
      service,
      environment.workspace,
      'act_session_flush_create',
    )
    const started = await startTurn(
      service,
      created.data.conversation.conversationId,
      'act_session_flush_turn',
      'Flush before the bounded session-end drain',
    )
    runtime.emit(
      providerEvent('message.delta', 'provider-thread-1', 'provider-turn-1', {
        itemId: 'provider-message-session-ending',
        delta: 'session ending durable delta',
      }),
    )
    assert.equal(
      store.getTurn(started.data.turn.turnId).snapshot.messages.length,
      0,
    )

    const closing = service.close()
    await new Promise((resolveTurn) => setImmediate(resolveTurn))
    assert.equal(runtime.closeCalls, 1)
    assert.equal(
      store.getTurn(started.data.turn.turnId).snapshot.messages[0].text,
      'session ending durable delta',
    )

    releaseRuntimeClose()
    await closing
  } finally {
    await removeEnvironment(environment.directory)
  }
})

test('terminal durability failure emits failure instead of a false completed event', async () => {
  const environment = await createEnvironment()
  const actualStore = ConversationStore.open({
    databasePath: environment.databasePath,
  })
  const store = new Proxy(actualStore, {
    get(target, property) {
      if (property === 'updateTurn') {
        return (turn) => {
          if (turn.status === 'completed')
            throw new Error('terminal disk error')
          return target.updateTurn(turn)
        }
      }
      const value = Reflect.get(target, property)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const runtime = new FakeRuntime()
  const workspacePolicy = await WorkspacePolicy.create([environment.workspace])
  const publisher = new HostEventPublisher({
    epoch: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  })
  const service = new HostService({
    runtime,
    workspacePolicy,
    publisher,
    persistence: store,
    hostVersion: '0.0.0-test',
    now: () => new Date(timestamp),
  })
  const events = []
  const unsubscribe = publisher.subscribe((event) => events.push(event))
  try {
    await service.registerInitialProjectRoots([environment.workspace])
    const created = await createConversation(
      service,
      environment.workspace,
      'act_terminal_fail_create',
    )
    await startTurn(
      service,
      created.data.conversation.conversationId,
      'act_terminal_fail_turn',
      'Complete safely',
    )
    assert.throws(() =>
      runtime.emit(
        providerEvent(
          'turn.completed',
          'provider-thread-1',
          'provider-turn-1',
          { finalMessage: 'must be durable' },
        ),
      ),
    )
    assert.equal(
      events.some((event) => event.type === 'turn.completed'),
      false,
    )
    assert.equal(
      events.some((event) => event.type === 'turn.failed'),
      true,
    )
    assert.equal(service.bootstrap().capabilities.codex, false)
  } finally {
    unsubscribe()
    await service.close().catch(() => undefined)
    await removeEnvironment(environment.directory)
  }
})

test('startup loads only the recent runtime window while SQLite keeps full history', async () => {
  const environment = await createEnvironment()
  try {
    const store = ConversationStore.open({
      databasePath: environment.databasePath,
    })
    const conversationId = 'conv_retained_history01'
    const projectId = 'proj_retained_history01'
    const projectRoot = normalizeTrustedProjectRoot(environment.workspace)
    const machine = store.listMachines()[0]
    assert.ok(machine)
    store.createProject({
      projectId,
      name: 'workspace',
      location: {
        projectId,
        machineId: machine.machineId,
        rootPath: projectRoot.rootPath,
        rootPathKey: projectRoot.rootPathKey,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    store.createConversation({
      conversationId,
      projectId,
      machineId: machine.machineId,
      title: '新会话',
      provider: 'codex',
      providerThreadId: 'provider-thread-retained',
      cwd: environment.workspace,
      status: 'completed',
      createdAt: timestamp,
      updatedAt: timestamp,
      lastActivityAt: timestamp,
    })
    for (let index = 0; index < 25; index += 1) {
      const turnId = `turn_retained_${String(index).padStart(3, '0')}`
      const input = {
        type: 'text',
        text: `Prompt ${String(index)}`,
        timestamp,
      }
      const turn = {
        turnId,
        conversationId,
        status: 'completed',
        input,
        startedAt: timestamp,
        completedAt: timestamp,
        finalMessage: `Result ${String(index)}`,
      }
      store.createTurn({
        turnId,
        conversationId,
        providerTurnId: `provider-turn-${String(index)}`,
        input,
        status: 'completed',
        startedAt: timestamp,
        completedAt: timestamp,
        snapshotVersion: DURABLE_TURN_SNAPSHOT_VERSION,
        snapshot: initialTurnPresentation(turn),
      })
    }
    store.close()

    const serviceFixture = await createService(
      environment,
      '88888888-8888-4888-8888-888888888888',
    )
    const runtime = serviceFixture.service.snapshot().conversationRuntimes[0]
    assert.equal(runtime.turns.length, 20)
    assert.equal(runtime.history.evictedTurns, 5)
    assert.equal(serviceFixture.store.countTurns(conversationId), 25)
    await serviceFixture.service.close()
  } finally {
    await removeEnvironment(environment.directory)
  }
})

async function removeEnvironment(directory) {
  await rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  })
}

async function waitFor(condition, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.fail(`Condition was not met within ${String(timeoutMs)}ms`)
}
