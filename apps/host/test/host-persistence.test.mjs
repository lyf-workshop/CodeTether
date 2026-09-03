import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { canonicalFailure } from '@codetether/agent-core'

import { ProviderConversationUnavailableError } from '../dist/api/agent-runtime.js'
import { HostEventPublisher } from '../dist/api/host-event-publisher.js'
import { HostService, HostServiceError } from '../dist/api/host-service.js'
import { WorkspacePolicy } from '../dist/api/workspace-policy.js'
import {
  ConversationStore,
  DURABLE_TURN_SNAPSHOT_VERSION,
  initialTurnPresentation,
  readDurableConversationDetail,
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
  beforeTurnReturn = undefined
  disposeCalls = []
  disposeError = undefined
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
    this.beforeTurnReturn?.({ options, providerTurnId })
    return { providerTurnId }
  }

  async disposeConversation(options) {
    this.disposeCalls.push(options)
    if (this.disposeError !== undefined) throw this.disposeError
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

async function createService(
  environment,
  epoch,
  runtime = new FakeRuntime(),
  now = () => new Date(timestamp),
) {
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
    now,
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
        model: 'gpt-5.6-sol',
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

test('completed Start action replay survives Host restart without Provider hydration or resend', async () => {
  const environment = await createEnvironment()
  try {
    const first = await createService(
      environment,
      '12121212-1212-4212-8212-121212121212',
    )
    const created = await createConversation(
      first.service,
      environment.workspace,
      'act_restart_replay_create01',
    )
    const other = await createConversation(
      first.service,
      environment.workspace,
      'act_restart_replay_create02',
    )
    const conversationId = created.data.conversation.conversationId
    const actionId = 'act_restart_replay_turn01'
    const text = 'Execute this durable action exactly once'
    const started = await startTurn(
      first.service,
      conversationId,
      actionId,
      text,
    )
    completeRichTurn(
      first.runtime,
      'provider-thread-1',
      first.runtime.turnCalls[0].providerTurnId,
      'durable-action',
    )
    await first.service.close()

    const runtime = new FakeRuntime()
    const second = await createService(
      environment,
      '13131313-1313-4313-8313-131313131313',
      runtime,
    )
    const replay = await startTurn(
      second.service,
      conversationId,
      actionId,
      text,
    )
    assert.equal(replay.data.turn.turnId, started.data.turn.turnId)
    assert.equal(replay.data.turn.status, 'completed')
    assert.equal(replay.data.turn.finalMessage, 'Finished durable-action')
    assert.equal(runtime.resumeCalls.length, 0)
    assert.equal(runtime.turnCalls.length, 0)
    await second.service.close()

    const changedRuntime = new FakeRuntime()
    const changed = await createService(
      environment,
      '16161616-1616-4616-8616-161616161616',
      changedRuntime,
    )
    await assert.rejects(
      startTurn(changed.service, conversationId, actionId, 'Changed input'),
      (error) => error instanceof HostServiceError && error.code === 'conflict',
    )
    assert.equal(changedRuntime.resumeCalls.length, 0)
    assert.equal(changedRuntime.turnCalls.length, 0)
    await changed.service.close()

    const otherRuntime = new FakeRuntime()
    const otherConversation = await createService(
      environment,
      '17171717-1717-4717-8717-171717171717',
      otherRuntime,
    )
    await assert.rejects(
      startTurn(
        otherConversation.service,
        other.data.conversation.conversationId,
        actionId,
        text,
      ),
      (error) => error instanceof HostServiceError && error.code === 'conflict',
    )
    assert.equal(otherRuntime.resumeCalls.length, 0)
    assert.equal(otherRuntime.turnCalls.length, 0)
    assert.equal(otherConversation.store.countTurns(conversationId), 1)
    assert.equal(
      otherConversation.store.countTurns(
        other.data.conversation.conversationId,
      ),
      0,
    )
    await otherConversation.service.close()
  } finally {
    await removeEnvironment(environment.directory)
  }
})

test('interrupted Start action closes the Host-restart window without Prompt resend', async () => {
  const environment = await createEnvironment()
  try {
    const first = await createService(
      environment,
      '14141414-1414-4414-8414-141414141414',
    )
    const created = await createConversation(
      first.service,
      environment.workspace,
      'act_restart_window_create01',
    )
    const conversationId = created.data.conversation.conversationId
    const actionId = 'act_restart_window_turn01'
    const text = 'Do not deliver this Prompt twice after restart'
    const started = await startTurn(
      first.service,
      conversationId,
      actionId,
      text,
    )
    assert.equal(first.runtime.turnCalls.length, 1)
    await first.service.close()

    const runtime = new FakeRuntime()
    const second = await createService(
      environment,
      '15151515-1515-4515-8515-151515151515',
      runtime,
    )
    const replay = await startTurn(
      second.service,
      conversationId,
      actionId,
      text,
    )
    assert.equal(replay.data.turn.turnId, started.data.turn.turnId)
    assert.equal(replay.data.turn.status, 'interrupted')
    assert.notEqual(replay.data.turn.status, 'failed')
    assert.notEqual(replay.data.turn.status, 'completed')
    const restartFailure = canonicalFailure(
      'execution_ownership_uncertain',
      timestamp,
    )
    assert.deepEqual(replay.data.turn.error, {
      code: 'provider_unavailable',
      message: 'Codex execution could not be verified after Host restart',
      failure: restartFailure,
    })
    assert.equal(runtime.resumeCalls.length, 0)
    assert.equal(runtime.turnCalls.length, 0)
    assert.equal(second.store.countTurns(conversationId), 1)
    assert.deepEqual(
      second.store.getTurn(started.data.turn.turnId).snapshot.turn.error,
      replay.data.turn.error,
    )
    assert.equal(second.store.listAttentionItems({ type: 'failed' }).length, 0)
    await second.service.close()
  } finally {
    await removeEnvironment(environment.directory)
  }
})

test('canonical Provider failure and recovered health remain durable without rewriting history', async () => {
  const environment = await createEnvironment()
  const failedAt = '2026-08-27T08:01:00.000Z'
  const recoveredAt = '2026-08-27T08:02:00.000Z'
  try {
    const first = await createService(
      environment,
      '18181818-1818-4818-8818-181818181810',
    )
    const created = await createConversation(
      first.service,
      environment.workspace,
      'act_failure_health_create01',
    )
    const conversationId = created.data.conversation.conversationId
    const machineId = created.data.conversation.machineId
    const failedTurn = await startTurn(
      first.service,
      conversationId,
      'act_failure_health_turn01',
      'Fail with a classified Provider condition',
    )
    const failure = canonicalFailure('rate_limited', failedAt)
    const failedIdentity = first.runtime.turnCalls[0]
    first.runtime.emit(
      providerEvent(
        'turn.failed',
        'provider-thread-1',
        failedIdentity.providerTurnId,
        {
          timestamp: failedAt,
          error: {
            message: 'private Provider diagnostics must stay private',
            failure,
          },
        },
      ),
    )
    first.runtime.emit(
      providerEvent(
        'turn.failed',
        'provider-thread-1',
        failedIdentity.providerTurnId,
        {
          timestamp: '2026-08-27T08:01:30.000Z',
          error: { message: 'stale duplicate terminal' },
        },
      ),
    )

    const expectedError = {
      code: 'provider_error',
      message: 'Codex is temporarily rate limited',
      failure,
    }
    const durableFailure = first.store.getTurn(failedTurn.data.turn.turnId)
    assert.deepEqual(durableFailure.snapshot.turn.error, expectedError)
    assert.equal(
      first.publisher
        .replayAfter({ epoch: first.publisher.epoch, seq: 0 })
        .events.filter(
          (event) =>
            event.type === 'turn.failed' &&
            event.turnId === failedTurn.data.turn.turnId,
        ).length,
      1,
    )
    const failedAttention = first.store.listAttentionItems({
      type: 'failed',
      status: 'open',
    })
    assert.equal(failedAttention.length, 1)
    assert.deepEqual(failedAttention[0].payload.error, expectedError)
    assert.deepEqual(
      (await first.service.getMachine(machineId)).providers.find(
        ({ provider }) => provider === 'codex',
      ).executionHealth,
      {
        state: 'degraded',
        freshness: 'current',
        observedAt: timestamp,
        failure,
      },
    )

    await startTurn(
      first.service,
      conversationId,
      'act_failure_health_turn02',
      'Recover explicitly with a later Turn',
    )
    const recoveredIdentity = first.runtime.turnCalls[1]
    first.runtime.emit(
      providerEvent(
        'turn.completed',
        'provider-thread-1',
        recoveredIdentity.providerTurnId,
        { timestamp: recoveredAt, finalMessage: 'Recovered' },
      ),
    )
    assert.deepEqual(
      (await first.service.getMachine(machineId)).providers.find(
        ({ provider }) => provider === 'codex',
      ).executionHealth,
      {
        state: 'healthy',
        freshness: 'current',
        observedAt: timestamp,
      },
    )
    assert.deepEqual(
      first.store.getTurn(failedTurn.data.turn.turnId).snapshot.turn.error,
      expectedError,
    )
    await first.service.close()

    const second = await createService(
      environment,
      '19191919-1919-4919-8919-191919191910',
      new FakeRuntime(),
    )
    assert.deepEqual(
      (await second.service.getMachine(machineId)).providers.find(
        ({ provider }) => provider === 'codex',
      ).executionHealth,
      {
        state: 'healthy',
        freshness: 'last_known',
        observedAt: timestamp,
      },
    )
    assert.deepEqual(
      second.store.getTurn(failedTurn.data.turn.turnId).snapshot.turn.error,
      expectedError,
    )
    assert.deepEqual(
      second.store.listAttentionItems({ type: 'failed', status: 'open' })[0]
        .payload.error,
      expectedError,
    )
    assert.equal(second.runtime.resumeCalls.length, 0)
    assert.equal(second.runtime.turnCalls.length, 0)
    await second.service.archiveConversation(conversationId, {
      actionId: 'act_failure_health_archive01',
    })
    assert.deepEqual(
      (await second.service.getConversation(conversationId)).runtime.turns[0]
        .error,
      expectedError,
    )
    await second.service.close()

    const coldStore = ConversationStore.open({
      databasePath: environment.databasePath,
    })
    const coldDetail = readDurableConversationDetail(coldStore, conversationId)
    assert.ok(coldDetail)
    assert.equal(typeof coldDetail.record.archivedAt, 'string')
    assert.deepEqual(coldDetail.runtime.turns[0].error, expectedError)
    assert.deepEqual(coldStore.getProviderExecutionHealth(machineId, 'codex'), {
      machineId,
      provider: 'codex',
      state: 'healthy',
      observedAt: timestamp,
    })
    coldStore.close()
  } finally {
    await removeEnvironment(environment.directory)
  }
})

test('login, quota, and Provider crash recovery require fresh explicit Turns and preserve each failure', async () => {
  const environment = await createEnvironment()
  let fixture
  const scenarios = [
    {
      key: 'login',
      reason: 'login_required',
      expectedHealth: 'unavailable',
    },
    {
      key: 'quota',
      reason: 'usage_limit_reached',
      expectedHealth: 'degraded',
    },
    {
      key: 'crash',
      reason: 'provider_crashed',
      expectedHealth: 'degraded',
    },
  ]
  try {
    fixture = await createService(
      environment,
      '20202020-2020-4020-8020-202020202020',
    )

    for (const [index, scenario] of scenarios.entries()) {
      const created = await createConversation(
        fixture.service,
        environment.workspace,
        `act_recovery_${scenario.key}_create`,
      )
      const conversationId = created.data.conversation.conversationId
      const machineId = created.data.conversation.machineId
      const prompt = `Explicit ${scenario.key} recovery request`
      const failed = await startTurn(
        fixture.service,
        conversationId,
        `act_recovery_${scenario.key}_failed`,
        prompt,
      )
      const failedCall = fixture.runtime.turnCalls.at(-1)
      assert.ok(failedCall)
      const failureMinute = 10 + index * 10
      const failure = canonicalFailure(
        scenario.reason,
        `2026-08-27T08:${String(failureMinute)}:00.000Z`,
      )
      fixture.runtime.emit(
        providerEvent(
          'turn.failed',
          `provider-thread-${String(index + 1)}`,
          failedCall.providerTurnId,
          {
            timestamp: failure.occurredAt,
            error: {
              message: 'private raw Provider diagnostic',
              failure,
            },
          },
        ),
      )

      const failedSnapshot = fixture.store.getTurn(failed.data.turn.turnId)
        .snapshot.turn
      assert.equal(failedSnapshot.status, 'failed')
      assert.deepEqual(failedSnapshot.error?.failure, failure)
      assert.deepEqual(
        (await fixture.service.getMachine(machineId)).providers.find(
          ({ provider }) => provider === 'codex',
        ).executionHealth,
        {
          state: scenario.expectedHealth,
          freshness: 'current',
          observedAt: timestamp,
          failure,
        },
      )

      const callsBeforeExplicitRecovery = fixture.runtime.turnCalls.length
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(
        fixture.runtime.turnCalls.length,
        callsBeforeExplicitRecovery,
      )

      const recovered = await startTurn(
        fixture.service,
        conversationId,
        `act_recovery_${scenario.key}_success`,
        prompt,
      )
      assert.notEqual(recovered.data.turn.turnId, failed.data.turn.turnId)
      assert.equal(
        fixture.runtime.turnCalls.length,
        callsBeforeExplicitRecovery + 1,
      )
      const recoveredCall = fixture.runtime.turnCalls.at(-1)
      assert.ok(recoveredCall)
      assert.equal(recoveredCall.options.input, prompt)
      const recoveredAt = `2026-08-27T08:${String(failureMinute + 1)}:00.000Z`
      fixture.runtime.emit(
        providerEvent(
          'turn.completed',
          `provider-thread-${String(index + 1)}`,
          recoveredCall.providerTurnId,
          { timestamp: recoveredAt, finalMessage: 'Recovered explicitly' },
        ),
      )

      const detail = fixture.service.getConversation(conversationId)
      assert.deepEqual(
        detail.runtime.turns.map((turn) => [
          turn.turnId,
          turn.status,
          turn.input.text,
          turn.error?.failure?.reason,
        ]),
        [
          [failed.data.turn.turnId, 'failed', prompt, scenario.reason],
          [recovered.data.turn.turnId, 'completed', prompt, undefined],
        ],
      )
      assert.deepEqual(
        fixture.store.getTurn(failed.data.turn.turnId).snapshot.turn,
        failedSnapshot,
      )
      assert.deepEqual(
        (await fixture.service.getMachine(machineId)).providers.find(
          ({ provider }) => provider === 'codex',
        ).executionHealth,
        {
          state: 'healthy',
          freshness: 'current',
          observedAt: timestamp,
        },
      )
    }

    assert.equal(
      fixture.store.listAttentionItems({ type: 'failed', status: 'open' })
        .length,
      scenarios.length,
    )
    await fixture.service.close()
    fixture = undefined
  } finally {
    await fixture?.service.close().catch(() => undefined)
    await removeEnvironment(environment.directory)
  }
})

test('Provider health ordering uses the Host receipt clock instead of a remote failure clock', async () => {
  const environment = await createEnvironment()
  let fixture
  let clock = new Date('2026-08-27T09:00:00.000Z')
  try {
    fixture = await createService(
      environment,
      '21212121-2121-4121-8121-212121212121',
      new FakeRuntime(),
      () => new Date(clock),
    )
    const created = await createConversation(
      fixture.service,
      environment.workspace,
      'act_health_clock_create01',
    )
    const conversationId = created.data.conversation.conversationId
    const machineId = created.data.conversation.machineId
    const failed = await startTurn(
      fixture.service,
      conversationId,
      'act_health_clock_turn01',
      'Observe a bounded failure',
    )
    const failedCall = fixture.runtime.turnCalls.at(-1)
    assert.ok(failedCall)
    const futureFailure = canonicalFailure(
      'rate_limited',
      '2099-01-01T00:00:00.000Z',
    )
    fixture.runtime.emit(
      providerEvent(
        'turn.failed',
        'provider-thread-1',
        failedCall.providerTurnId,
        {
          timestamp: clock.toISOString(),
          error: {
            message: 'private remote diagnostic',
            failure: futureFailure,
          },
        },
      ),
    )

    assert.deepEqual(
      (await fixture.service.getMachine(machineId)).providers.find(
        ({ provider }) => provider === 'codex',
      ).executionHealth,
      {
        state: 'degraded',
        freshness: 'current',
        observedAt: '2026-08-27T09:00:00.000Z',
        failure: futureFailure,
      },
    )

    clock = new Date('2026-08-27T09:01:00.000Z')
    await startTurn(
      fixture.service,
      conversationId,
      'act_health_clock_turn02',
      'Explicitly recover after the observation',
    )
    const recoveredCall = fixture.runtime.turnCalls.at(-1)
    assert.ok(recoveredCall)
    fixture.runtime.emit(
      providerEvent(
        'turn.completed',
        'provider-thread-1',
        recoveredCall.providerTurnId,
        {
          timestamp: clock.toISOString(),
          finalMessage: 'Recovered explicitly',
        },
      ),
    )

    assert.deepEqual(
      (await fixture.service.getMachine(machineId)).providers.find(
        ({ provider }) => provider === 'codex',
      ).executionHealth,
      {
        state: 'healthy',
        freshness: 'current',
        observedAt: '2026-08-27T09:01:00.000Z',
      },
    )
    assert.deepEqual(
      fixture.store.getTurn(failed.data.turn.turnId).snapshot.turn.error
        .failure,
      futureFailure,
    )
  } finally {
    await fixture?.service.close().catch(() => undefined)
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
    const after = second.service.getConversation(conversationId)
    assert.equal(after.runtime.turns.length, 2)
    assert.equal(after.runtime.turns[0].status, 'completed')
    assert.equal(after.runtime.turns[1].status, 'failed')
    assert.equal(
      after.runtime.turns[1].error?.failure?.reason,
      'provider_session_lost',
    )
    const providerHealth = (
      await second.service.getMachine(
        second.service.listMachines().machines[0].machineId,
      )
    ).providers.find(({ provider }) => provider === 'codex')?.executionHealth
    assert.equal(providerHealth?.failure?.reason, 'provider_session_lost')
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
    getTurnForStartAction: () => undefined,
    getProviderExecutionHealth: () => undefined,
    createTurnForStartAction: () => {
      throw new Error('disk full')
    },
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
        error instanceof HostServiceError &&
        error.code === 'provider_start_failed' &&
        error.failure?.reason === 'provider_start_failed',
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
    assert.doesNotThrow(() =>
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

test('startup event overflow disposes only the owning session and records one durable failure', async () => {
  const environment = await createEnvironment()
  try {
    const fixture = await createService(
      environment,
      '18181818-1818-4818-8818-181818181818',
    )
    const affected = await createConversation(
      fixture.service,
      environment.workspace,
      'act_start_overflow_create01',
    )
    const unaffected = await createConversation(
      fixture.service,
      environment.workspace,
      'act_start_overflow_create02',
    )
    const events = []
    const unsubscribe = fixture.publisher.subscribe((event) =>
      events.push(event),
    )
    let callbackError
    fixture.runtime.beforeTurnReturn = ({ options, providerTurnId }) => {
      fixture.runtime.beforeTurnReturn = undefined
      try {
        for (let index = 0; index <= 512; index += 1) {
          fixture.runtime.emit(
            providerEvent(
              'message.delta',
              options.providerThreadId,
              providerTurnId,
              {
                itemId: 'provider-message-start-overflow',
                delta: 'x',
              },
            ),
          )
        }
        fixture.runtime.emit(
          providerEvent(
            'turn.completed',
            options.providerThreadId,
            providerTurnId,
            { finalMessage: 'must not complete' },
          ),
        )
      } catch (error) {
        callbackError = error
      }
    }

    const actionId = 'act_start_overflow_turn01'
    await assert.rejects(
      startTurn(
        fixture.service,
        affected.data.conversation.conversationId,
        actionId,
        'Exercise bounded startup events',
      ),
      (error) =>
        error instanceof HostServiceError &&
        error.code === 'provider_error' &&
        error.failure?.reason === 'protocol_limit_exceeded',
    )
    assert.equal(callbackError, undefined)
    assert.deepEqual(fixture.runtime.disposeCalls, [
      { providerThreadId: 'provider-thread-1' },
    ])

    const failed = fixture.store.getTurnForStartAction(actionId)
    assert.ok(failed)
    assert.equal(failed.status, 'failed')
    assert.equal(
      failed.snapshot.turn.error.failure.reason,
      'protocol_limit_exceeded',
    )
    assert.equal(fixture.store.listIncompleteTurns().length, 0)
    const terminalEvents = events.filter(
      (event) =>
        event.turnId === failed.turnId &&
        (event.type === 'turn.completed' || event.type === 'turn.failed'),
    )
    assert.deepEqual(
      terminalEvents.map((event) => event.type),
      ['turn.failed'],
    )

    const unaffectedTurn = await startTurn(
      fixture.service,
      unaffected.data.conversation.conversationId,
      'act_start_overflow_turn02',
      'Remain isolated',
    )
    const unaffectedCall = fixture.runtime.turnCalls.at(-1)
    fixture.runtime.emit(
      providerEvent(
        'turn.completed',
        unaffectedCall.options.providerThreadId,
        unaffectedCall.providerTurnId,
        { finalMessage: 'unaffected' },
      ),
    )
    assert.equal(
      fixture.store.getTurn(unaffectedTurn.data.turn.turnId).status,
      'completed',
    )
    unsubscribe()
    await fixture.service.close()
  } finally {
    await removeEnvironment(environment.directory)
  }
})

test('startup overflow cleanup rejection leaves a durable failure and blocks a new Turn', async () => {
  const environment = await createEnvironment()
  try {
    const fixture = await createService(
      environment,
      '19191919-1919-4919-8919-191919191919',
    )
    const created = await createConversation(
      fixture.service,
      environment.workspace,
      'act_start_cleanup_create01',
    )
    fixture.runtime.disposeError = new Error('private cleanup failure')
    fixture.runtime.beforeTurnReturn = ({ options, providerTurnId }) => {
      fixture.runtime.beforeTurnReturn = undefined
      for (let index = 0; index <= 512; index += 1) {
        fixture.runtime.emit(
          providerEvent(
            'message.delta',
            options.providerThreadId,
            providerTurnId,
            {
              itemId: 'provider-message-cleanup-failure',
              delta: 'x',
            },
          ),
        )
      }
    }

    const actionId = 'act_start_cleanup_turn01'
    await assert.rejects(
      startTurn(
        fixture.service,
        created.data.conversation.conversationId,
        actionId,
        'Exercise failed exact cleanup',
      ),
      (error) =>
        error instanceof HostServiceError &&
        error.code === 'provider_unavailable' &&
        error.failure?.reason === 'execution_ownership_uncertain',
    )
    const failed = fixture.store.getTurnForStartAction(actionId)
    assert.ok(failed)
    assert.equal(failed.status, 'failed')
    assert.equal(
      failed.snapshot.turn.error.failure.reason,
      'execution_ownership_uncertain',
    )
    assert.equal(fixture.store.listIncompleteTurns().length, 0)
    assert.equal(fixture.runtime.turnCalls.length, 1)
    assert.deepEqual(fixture.runtime.disposeCalls, [
      { providerThreadId: 'provider-thread-1' },
    ])

    await assert.rejects(
      startTurn(
        fixture.service,
        created.data.conversation.conversationId,
        'act_start_cleanup_turn02',
        'Must remain blocked after uncertain cleanup',
      ),
      (error) =>
        error instanceof HostServiceError &&
        error.code === 'provider_session_lost',
    )
    assert.equal(fixture.runtime.turnCalls.length, 1)
    assert.equal(
      fixture.store.countTurns(created.data.conversation.conversationId),
      2,
    )
    assert.equal(
      fixture.store.getTurnForStartAction('act_start_cleanup_turn02')?.snapshot
        .turn.error.failure.reason,
      'provider_session_lost',
    )
    await fixture.service.close().catch(() => undefined)
    const reopened = ConversationStore.open({
      databasePath: environment.databasePath,
    })
    try {
      assert.equal(
        reopened.getTurnForStartAction(actionId)?.snapshot.turn.error.failure
          .reason,
        'execution_ownership_uncertain',
      )
    } finally {
      reopened.close()
    }
  } finally {
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
