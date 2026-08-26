import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'

import { HostSnapshotSchema } from '@codetether/protocol'

import { MAX_CANONICAL_TURN_INPUT_BYTES } from '../dist/api/conversation-runtime-history.js'
import { HostEventPublisher } from '../dist/api/host-event-publisher.js'
import { HostService, HostServiceError } from '../dist/api/host-service.js'
import { WorkspacePolicy } from '../dist/api/workspace-policy.js'

const epoch = '33333333-3333-4333-8333-333333333333'
const timestamp = '2026-08-26T08:00:00.000Z'

class FakeRuntime {
  provider = 'codex'
  conversationCalls = []
  turnCalls = []
  interruptCalls = []
  approvalDecisions = []
  lifecycle = []
  closeCalls = 0
  closeError = undefined
  nextProviderThreadId = undefined
  nextProviderTurnId = undefined
  nextProviderModel = undefined
  #conversationSequence = 0
  #turnSequence = 0
  #eventListeners = new Set()
  #approvalListeners = new Set()
  #failureListeners = new Set()

  subscribeEvents(listener) {
    this.#eventListeners.add(listener)
    return () => {
      this.#eventListeners.delete(listener)
      this.lifecycle.push('unsubscribe-events')
    }
  }

  subscribeFailures(listener) {
    this.#failureListeners.add(listener)
    return () => {
      this.#failureListeners.delete(listener)
      this.lifecycle.push('unsubscribe-failures')
    }
  }

  subscribeApprovals(onRequest, onResolved) {
    const listeners = { onRequest, onResolved }
    this.#approvalListeners.add(listeners)
    return () => {
      this.#approvalListeners.delete(listeners)
      this.lifecycle.push('unsubscribe-approvals')
    }
  }

  async startConversation(options) {
    const generated = `provider-thread-secret-${++this.#conversationSequence}`
    const providerThreadId = this.nextProviderThreadId ?? generated
    this.nextProviderThreadId = undefined
    this.conversationCalls.push({ options, providerThreadId })
    const model = this.nextProviderModel ?? options.model
    this.nextProviderModel = undefined
    return {
      providerThreadId,
      ...(model === undefined ? {} : { model }),
    }
  }

  async startTurn(options) {
    const generated = `provider-turn-secret-${++this.#turnSequence}`
    const providerTurnId = this.nextProviderTurnId ?? generated
    this.nextProviderTurnId = undefined
    this.turnCalls.push({ options, providerTurnId })
    return { providerTurnId }
  }

  async interruptTurn(options) {
    this.interruptCalls.push(options)
  }

  async close() {
    this.closeCalls += 1
    this.lifecycle.push('runtime-close')
    if (this.closeError !== undefined) throw this.closeError
  }

  emitEvent(event) {
    for (const listener of [...this.#eventListeners]) listener(event)
  }

  requestApproval(options) {
    const decisions = this.approvalDecisions
    const request = {
      providerRequestId: options.providerRequestId,
      providerApprovalId: options.providerApprovalId,
      providerThreadId: options.providerThreadId,
      providerTurnId: options.providerTurnId,
      ...(options.providerItemId === undefined
        ? {}
        : { providerItemId: options.providerItemId }),
      kind: options.kind ?? 'command',
      summary: options.summary ?? 'Run the safe command',
      respond: (decision) => {
        decisions.push({
          providerRequestId: options.providerRequestId,
          decision,
        })
        this.lifecycle.push(`approval:${decision}`)
        if (options.autoResolve === true) {
          this.resolveApproval({
            providerRequestId: options.providerRequestId,
            providerApprovalId: options.providerApprovalId,
            providerThreadId: options.providerThreadId,
            providerTurnId: options.providerTurnId,
            ...(options.providerItemId === undefined
              ? {}
              : { providerItemId: options.providerItemId }),
            decision,
          })
        }
      },
    }
    for (const listeners of [...this.#approvalListeners]) {
      listeners.onRequest(request)
    }
  }

  resolveApproval(resolution) {
    for (const listeners of [...this.#approvalListeners]) {
      listeners.onResolved(resolution)
    }
  }

  fail(error) {
    for (const listener of [...this.#failureListeners]) listener(error)
  }

  get subscriptionCount() {
    return (
      this.#eventListeners.size +
      this.#approvalListeners.size +
      this.#failureListeners.size
    )
  }
}

async function createFixture(t, options = {}) {
  const workspace = await mkdtemp(resolve(tmpdir(), 'codetether-service-'))
  const runtime = new FakeRuntime()
  const publisher = new HostEventPublisher({ epoch })
  const workspacePolicy = await WorkspacePolicy.create([workspace])
  const service = new HostService({
    runtime,
    publisher,
    workspacePolicy,
    hostVersion: '0.0.0-test',
    now: () => new Date(timestamp),
    ...(options.historyLimits === undefined
      ? {}
      : { historyLimits: options.historyLimits }),
  })
  const events = []
  const unsubscribe = publisher.subscribe((event) => events.push(event))
  t.after(async () => {
    unsubscribe()
    await service.close().catch(() => undefined)
    await rm(workspace, { recursive: true, force: true })
  })
  return { workspace, workspacePolicy, runtime, publisher, service, events }
}

async function createConversation(fixture, actionId, options = {}) {
  return await fixture.service.createConversation({
    actionId,
    provider: 'codex',
    cwd: fixture.workspace,
    ...options,
  })
}

async function startTurn(fixture, conversationId, actionId, text = 'Inspect') {
  return await fixture.service.startTurn(conversationId, {
    actionId,
    input: { type: 'text', text },
  })
}

test('bootstrap reports only implemented runtime capabilities', async (t) => {
  const fixture = await createFixture(t)

  assert.deepEqual(fixture.service.bootstrap().capabilities, {
    codex: true,
    approvals: true,
    interrupt: true,
    resume: false,
    diff: true,
    streaming: true,
  })
})

test('provider Thread identities must be non-empty and globally unique', async (t) => {
  const fixture = await createFixture(t)
  await createConversation(fixture, 'act_create11')

  fixture.runtime.nextProviderThreadId = 'provider-thread-secret-1'
  await assert.rejects(
    createConversation(fixture, 'act_create12'),
    (error) =>
      error instanceof HostServiceError && error.code === 'provider_error',
  )
  fixture.runtime.nextProviderThreadId = '   '
  await assert.rejects(
    createConversation(fixture, 'act_create13'),
    (error) =>
      error instanceof HostServiceError && error.code === 'provider_error',
  )

  assert.equal(fixture.service.snapshot().conversations.length, 1)
})

test('validates provider conversation metadata before committing state', async (t) => {
  const fixture = await createFixture(t)
  fixture.runtime.nextProviderModel = '   '

  await assert.rejects(
    createConversation(fixture, 'act_create24'),
    (error) =>
      error instanceof HostServiceError && error.code === 'provider_error',
  )

  assert.deepEqual(fixture.service.snapshot().conversations, [])
  assert.equal(fixture.events.length, 0)
})

test('provider Turn identities must be non-empty and unique per Conversation', async (t) => {
  const fixture = await createFixture(t)
  const created = await createConversation(fixture, 'act_create14')
  const conversationId = created.data.conversation.conversationId
  await startTurn(fixture, conversationId, 'act_start014')
  fixture.runtime.emitEvent({
    provider: 'codex',
    timestamp,
    threadId: 'provider-thread-secret-1',
    turnId: 'provider-turn-secret-1',
    type: 'turn.completed',
  })

  fixture.runtime.nextProviderTurnId = 'provider-turn-secret-1'
  await assert.rejects(
    startTurn(fixture, conversationId, 'act_start015'),
    (error) =>
      error instanceof HostServiceError && error.code === 'provider_error',
  )
  fixture.runtime.nextProviderTurnId = ''
  await assert.rejects(
    startTurn(fixture, conversationId, 'act_start016'),
    (error) =>
      error instanceof HostServiceError && error.code === 'provider_error',
  )

  const next = await startTurn(fixture, conversationId, 'act_start017')
  assert.equal(next.data.turn.status, 'running')
  assert.equal(fixture.service.snapshot().activeTurns.length, 1)
})

test('rejects an oversized canonical Turn input before calling the provider', async (t) => {
  const fixture = await createFixture(t)
  const created = await createConversation(fixture, 'act_input_create01')
  const conversationId = created.data.conversation.conversationId
  const oversized = '界'.repeat(
    Math.floor(MAX_CANONICAL_TURN_INPUT_BYTES / 3) + 1,
  )

  await assert.rejects(
    startTurn(fixture, conversationId, 'act_input_start01', oversized),
    (error) =>
      error instanceof HostServiceError &&
      error.code === 'invalid_request' &&
      error.httpStatus === 422 &&
      error.details.maxBytes === MAX_CANONICAL_TURN_INPUT_BYTES,
  )
  assert.equal(fixture.runtime.turnCalls.length, 0)
  assert.equal(fixture.service.snapshot().activeTurns.length, 0)
  assert.equal(
    fixture.service.snapshot().conversationRuntimes[0].turns.length,
    0,
  )
})

test('reserves terminal runtime overhead when the Conversation byte budget is small', async (t) => {
  const fixture = await createFixture(t, {
    historyLimits: { maxConversationBytes: 1024 },
  })
  const created = await createConversation(fixture, 'act_input_create02')

  await assert.rejects(
    startTurn(
      fixture,
      created.data.conversation.conversationId,
      'act_input_start02',
      'x'.repeat(300),
    ),
    (error) =>
      error instanceof HostServiceError &&
      error.code === 'invalid_request' &&
      error.httpStatus === 422 &&
      error.details.maxBytes === 256,
  )
  assert.equal(fixture.runtime.turnCalls.length, 0)
})

test('create, start, and interrupt route only through bound provider identities', async (t) => {
  const fixture = await createFixture(t)
  const created = await createConversation(fixture, 'act_create01', {
    model: 'gpt-test',
    reasoning: 'deep',
  })
  const conversationId = created.data.conversation.conversationId
  const started = await startTurn(
    fixture,
    conversationId,
    'act_start001',
    'Explain this workspace',
  )
  const turnId = started.data.turn.turnId

  assert.deepEqual(fixture.runtime.conversationCalls[0].options, {
    cwd: fixture.workspacePolicy.allowedRoots[0],
    model: 'gpt-test',
    reasoning: 'deep',
  })
  assert.deepEqual(fixture.runtime.turnCalls[0].options, {
    providerThreadId: 'provider-thread-secret-1',
    input: 'Explain this workspace',
    model: 'gpt-test',
    reasoning: 'deep',
  })

  const interrupted = await fixture.service.interruptTurn(
    conversationId,
    turnId,
    { actionId: 'act_stop0001' },
  )
  assert.equal(interrupted.status, 'accepted')
  assert.deepEqual(fixture.runtime.interruptCalls, [
    {
      providerThreadId: 'provider-thread-secret-1',
      providerTurnId: 'provider-turn-secret-1',
    },
  ])
  assert.match(conversationId, /^conv_/)
  assert.match(turnId, /^turn_/)
})

test('duplicate actionId replays one result and rejects changed input or operation', async (t) => {
  const fixture = await createFixture(t)
  const request = {
    actionId: 'act_create02',
    provider: 'codex',
    cwd: fixture.workspace,
  }
  const first = await fixture.service.createConversation(request)
  const duplicate = await fixture.service.createConversation(request)

  assert.deepEqual(duplicate, first)
  assert.equal(fixture.runtime.conversationCalls.length, 1)
  await assert.rejects(
    fixture.service.createConversation({ ...request, model: 'different' }),
    (error) =>
      error instanceof HostServiceError &&
      error.code === 'conflict' &&
      error.httpStatus === 409,
  )

  const conversationId = first.data.conversation.conversationId
  const startRequest = {
    actionId: 'act_start002',
    input: { type: 'text', text: 'Run once' },
  }
  const started = await fixture.service.startTurn(conversationId, startRequest)
  assert.deepEqual(
    await fixture.service.startTurn(conversationId, startRequest),
    started,
  )
  assert.equal(fixture.runtime.turnCalls.length, 1)
  await assert.rejects(
    fixture.service.interruptTurn(conversationId, started.data.turn.turnId, {
      actionId: 'act_start002',
    }),
    (error) => error instanceof HostServiceError && error.code === 'conflict',
  )
})

test('provider events remain isolated between concurrent conversations', async (t) => {
  const fixture = await createFixture(t)
  const conversationA = await createConversation(fixture, 'act_create03')
  const conversationB = await createConversation(fixture, 'act_create04')
  const conversationIdA = conversationA.data.conversation.conversationId
  const conversationIdB = conversationB.data.conversation.conversationId
  const turnA = await startTurn(fixture, conversationIdA, 'act_start003')
  const turnB = await startTurn(fixture, conversationIdB, 'act_start004')

  fixture.runtime.emitEvent({
    provider: 'codex',
    timestamp,
    threadId: 'provider-thread-secret-1',
    turnId: 'provider-turn-secret-1',
    itemId: 'provider-item-secret-a',
    type: 'message.delta',
    delta: 'alpha',
  })
  fixture.runtime.emitEvent({
    provider: 'codex',
    timestamp,
    threadId: 'provider-thread-secret-2',
    turnId: 'provider-turn-secret-2',
    itemId: 'provider-item-secret-b',
    type: 'message.delta',
    delta: 'beta',
  })

  const deltas = fixture.events.filter(
    (event) => event.type === 'message.delta',
  )
  assert.deepEqual(
    deltas.map((event) => [
      event.conversationId,
      event.turnId,
      event.payload.delta,
    ]),
    [
      [conversationIdA, turnA.data.turn.turnId, 'alpha'],
      [conversationIdB, turnB.data.turn.turnId, 'beta'],
    ],
  )
  assert.notEqual(deltas[0].itemId, deltas[1].itemId)

  fixture.runtime.emitEvent({
    provider: 'codex',
    timestamp,
    threadId: 'provider-thread-secret-1',
    turnId: 'provider-turn-secret-1',
    type: 'turn.completed',
    finalMessage: 'A finished',
  })
  const snapshot = fixture.service.snapshot()
  assert.deepEqual(
    snapshot.activeTurns.map((turn) => turn.turnId),
    [turnB.data.turn.turnId],
  )
  assert.equal(
    snapshot.conversations.find(
      (record) => record.conversationId === conversationIdA,
    ).status,
    'completed',
  )
  assert.equal(
    snapshot.conversations.find(
      (record) => record.conversationId === conversationIdB,
    ).status,
    'running',
  )
})

test('late events from a terminal Turn cannot clear a newer active Turn', async (t) => {
  const fixture = await createFixture(t)
  const created = await createConversation(fixture, 'act_create10')
  const conversationId = created.data.conversation.conversationId
  await startTurn(fixture, conversationId, 'act_start010')
  fixture.runtime.emitEvent({
    provider: 'codex',
    timestamp,
    threadId: 'provider-thread-secret-1',
    turnId: 'provider-turn-secret-1',
    type: 'turn.completed',
    finalMessage: 'First completed',
  })
  const second = await startTurn(fixture, conversationId, 'act_start011')
  const eventCount = fixture.events.length

  fixture.runtime.emitEvent({
    provider: 'codex',
    timestamp,
    threadId: 'provider-thread-secret-1',
    turnId: 'provider-turn-secret-1',
    type: 'turn.interrupted',
  })
  fixture.runtime.emitEvent({
    provider: 'codex',
    timestamp,
    threadId: 'provider-thread-secret-1',
    turnId: 'provider-turn-secret-1',
    itemId: 'provider-item-late',
    type: 'message.delta',
    delta: 'late',
  })

  const snapshot = fixture.service.snapshot()
  assert.equal(fixture.events.length, eventCount)
  assert.equal(snapshot.activeTurns.length, 1)
  assert.equal(snapshot.activeTurns[0].turnId, second.data.turn.turnId)
  assert.equal(snapshot.conversations[0].activeTurnId, second.data.turn.turnId)
  assert.equal(snapshot.conversations[0].status, 'running')
})

test('approval requests bind to the public conversation, turn, and item', async (t) => {
  const fixture = await createFixture(t)
  const created = await createConversation(fixture, 'act_create05')
  const conversationId = created.data.conversation.conversationId
  const started = await startTurn(fixture, conversationId, 'act_start005')
  const turnId = started.data.turn.turnId

  fixture.runtime.requestApproval({
    providerRequestId: 'provider-request-secret-1',
    providerApprovalId: 'provider-approval-secret-1',
    providerThreadId: 'provider-thread-secret-1',
    providerTurnId: 'provider-turn-secret-1',
    providerItemId: 'provider-item-secret-1',
    autoResolve: true,
  })
  const pending = fixture.service.snapshot().pendingApprovals
  assert.equal(pending.length, 1)
  assert.equal(pending[0].conversationId, conversationId)
  assert.equal(pending[0].turnId, turnId)
  assert.match(pending[0].itemId, /^item_/)
  const waitingSnapshot = HostSnapshotSchema.parse(fixture.service.snapshot())
  assert.equal(waitingSnapshot.conversationRuntimes.length, 1)
  assert.equal(waitingSnapshot.conversationRuntimes[0].turns.length, 1)
  assert.equal(
    waitingSnapshot.conversationRuntimes[0].turns[0].input.text,
    'Inspect',
  )

  const resolved = await fixture.service.resolveApproval(
    pending[0].approvalId,
    { actionId: 'act_allow001', decision: 'accept' },
  )
  assert.equal(resolved.data.approval.status, 'resolved')
  assert.deepEqual(fixture.runtime.approvalDecisions, [
    {
      providerRequestId: 'provider-request-secret-1',
      decision: 'accept',
    },
  ])
  assert.equal(fixture.service.snapshot().pendingApprovals.length, 0)
  assert.equal(fixture.service.snapshot().conversations[0].status, 'running')
  assert.deepEqual(
    fixture.events
      .filter((event) => event.type.startsWith('approval.'))
      .map((event) => event.type),
    ['approval.requested', 'approval.resolved'],
  )

  const duplicate = await fixture.service.resolveApproval(
    pending[0].approvalId,
    { actionId: 'act_allow001', decision: 'accept' },
  )
  assert.deepEqual(duplicate, resolved)
  assert.equal(fixture.runtime.approvalDecisions.length, 1)
})

test('a Conversation remains waiting until every Turn approval resolves', async (t) => {
  const fixture = await createFixture(t)
  const created = await createConversation(fixture, 'act_create18')
  const conversationId = created.data.conversation.conversationId
  await startTurn(fixture, conversationId, 'act_start018')

  for (const suffix of ['a', 'b']) {
    fixture.runtime.requestApproval({
      providerRequestId: `provider-request-parallel-${suffix}`,
      providerApprovalId: `provider-approval-parallel-${suffix}`,
      providerThreadId: 'provider-thread-secret-1',
      providerTurnId: 'provider-turn-secret-1',
      autoResolve: true,
    })
  }
  const [first, second] = fixture.service.snapshot().pendingApprovals
  assert.equal(fixture.service.snapshot().conversations[0].status, 'waiting')

  await fixture.service.resolveApproval(first.approvalId, {
    actionId: 'act_allow018a',
    decision: 'accept',
  })
  let snapshot = fixture.service.snapshot()
  assert.deepEqual(
    snapshot.pendingApprovals.map((approval) => approval.approvalId),
    [second.approvalId],
  )
  assert.equal(snapshot.conversations[0].status, 'waiting')

  await fixture.service.resolveApproval(second.approvalId, {
    actionId: 'act_allow018b',
    decision: 'decline',
  })
  snapshot = fixture.service.snapshot()
  assert.equal(snapshot.pendingApprovals.length, 0)
  assert.equal(snapshot.conversations[0].status, 'running')
})

test('a terminal Turn declines and resolves its pending approvals', async (t) => {
  const fixture = await createFixture(t)
  const created = await createConversation(fixture, 'act_create09')
  await startTurn(
    fixture,
    created.data.conversation.conversationId,
    'act_start009',
  )
  fixture.runtime.requestApproval({
    providerRequestId: 'provider-request-terminal',
    providerApprovalId: 'provider-approval-terminal',
    providerThreadId: 'provider-thread-secret-1',
    providerTurnId: 'provider-turn-secret-1',
    providerItemId: 'provider-item-terminal',
    autoResolve: true,
  })
  assert.equal(fixture.service.snapshot().pendingApprovals.length, 1)

  fixture.runtime.emitEvent({
    provider: 'codex',
    timestamp,
    threadId: 'provider-thread-secret-1',
    turnId: 'provider-turn-secret-1',
    type: 'turn.interrupted',
  })

  assert.deepEqual(fixture.runtime.approvalDecisions, [
    { providerRequestId: 'provider-request-terminal', decision: 'decline' },
  ])
  assert.equal(fixture.service.snapshot().pendingApprovals.length, 0)
  assert.deepEqual(
    fixture.events
      .filter((event) => event.type.startsWith('approval.'))
      .map((event) => [event.type, event.payload.approval.status]),
    [
      ['approval.requested', 'pending'],
      ['approval.resolved', 'resolved'],
    ],
  )
})

test('a terminal Turn hides an approval while provider resolution is pending', async (t) => {
  const fixture = await createFixture(t)
  const created = await createConversation(fixture, 'act_create21')
  await startTurn(
    fixture,
    created.data.conversation.conversationId,
    'act_start021',
  )
  fixture.runtime.requestApproval({
    providerRequestId: 'provider-request-terminal-async',
    providerApprovalId: 'provider-approval-terminal-async',
    providerThreadId: 'provider-thread-secret-1',
    providerTurnId: 'provider-turn-secret-1',
  })

  fixture.runtime.emitEvent({
    provider: 'codex',
    timestamp,
    threadId: 'provider-thread-secret-1',
    turnId: 'provider-turn-secret-1',
    type: 'turn.interrupted',
  })

  let snapshot = fixture.service.snapshot()
  assert.equal(snapshot.pendingApprovals.length, 0)
  assert.equal(snapshot.conversations[0].status, 'idle')
  fixture.runtime.resolveApproval({
    providerRequestId: 'provider-request-terminal-async',
    providerApprovalId: 'provider-approval-terminal-async',
    providerThreadId: 'provider-thread-secret-1',
    providerTurnId: 'provider-turn-secret-1',
    decision: 'decline',
  })
  snapshot = fixture.service.snapshot()
  assert.equal(snapshot.pendingApprovals.length, 0)
  assert.equal(snapshot.conversations[0].status, 'idle')
  assert.equal(
    fixture.events.filter((event) => event.type === 'approval.resolved').length,
    1,
  )
})

test('an approval with an unbound provider Turn is declined and never exposed', async (t) => {
  const fixture = await createFixture(t)
  await createConversation(fixture, 'act_create06')
  await startTurn(
    fixture,
    fixture.service.snapshot().conversations[0].conversationId,
    'act_start006',
  )

  fixture.runtime.requestApproval({
    providerRequestId: 'provider-request-unbound',
    providerApprovalId: 'provider-approval-unbound',
    providerThreadId: 'provider-thread-secret-1',
    providerTurnId: 'provider-turn-other',
  })

  assert.deepEqual(fixture.runtime.approvalDecisions, [
    { providerRequestId: 'provider-request-unbound', decision: 'decline' },
  ])
  assert.deepEqual(fixture.service.snapshot().pendingApprovals, [])
  assert.equal(
    fixture.events.some((event) => event.type === 'approval.requested'),
    false,
  )
})

test('provider Turn failure details are redacted from public state and events', async (t) => {
  const fixture = await createFixture(t)
  const created = await createConversation(fixture, 'act_create19')
  await startTurn(
    fixture,
    created.data.conversation.conversationId,
    'act_start019',
  )
  const providerSecret = 'sk-provider-secret-message'
  const providerCodeSecret = 'provider-secret-code'

  fixture.runtime.emitEvent({
    provider: 'codex',
    timestamp,
    threadId: 'provider-thread-secret-1',
    turnId: 'provider-turn-secret-1',
    type: 'turn.failed',
    error: { message: providerSecret, code: providerCodeSecret },
  })

  const failed = fixture.events.find((event) => event.type === 'turn.failed')
  assert.deepEqual(failed.payload.error, {
    code: 'provider_error',
    message: 'Codex Turn failed',
  })
  const publicJson = JSON.stringify({
    snapshot: fixture.service.snapshot(),
    events: fixture.events,
  })
  assert.equal(publicJson.includes(providerSecret), false)
  assert.equal(publicJson.includes(providerCodeSecret), false)
})

test('public responses, snapshots, and events never expose provider identities', async (t) => {
  const fixture = await createFixture(t)
  const created = await createConversation(fixture, 'act_create07')
  const started = await startTurn(
    fixture,
    created.data.conversation.conversationId,
    'act_start007',
  )
  fixture.runtime.emitEvent({
    provider: 'codex',
    timestamp,
    threadId: 'provider-thread-secret-1',
    turnId: 'provider-turn-secret-1',
    itemId: 'provider-item-secret-1',
    type: 'tool.started',
    name: 'read_file',
  })
  fixture.runtime.requestApproval({
    providerRequestId: 'provider-request-secret-1',
    providerApprovalId: 'provider-approval-secret-1',
    providerThreadId: 'provider-thread-secret-1',
    providerTurnId: 'provider-turn-secret-1',
    providerItemId: 'provider-item-secret-1',
  })

  const publicJson = JSON.stringify({
    created,
    started,
    snapshot: fixture.service.snapshot(),
    events: fixture.events,
  })
  for (const secret of [
    'provider-thread-secret',
    'provider-turn-secret',
    'provider-item-secret',
    'provider-request-secret',
    'provider-approval-secret',
  ]) {
    assert.equal(publicJson.includes(secret), false, `leaked ${secret}`)
  }
  assert.match(publicJson, /conv_/)
  assert.match(publicJson, /turn_/)
  assert.match(publicJson, /item_/)
  assert.match(publicJson, /approval_/)
})

test('keeps numeric and string provider request identities distinct', async (t) => {
  const fixture = await createFixture(t)
  const created = await createConversation(fixture, 'act_create21')
  await startTurn(
    fixture,
    created.data.conversation.conversationId,
    'act_start021',
  )

  for (const [providerRequestId, suffix] of [
    [1, 'number'],
    ['1', 'string'],
  ]) {
    fixture.runtime.requestApproval({
      providerRequestId,
      providerApprovalId: `provider-approval-${suffix}`,
      providerThreadId: 'provider-thread-secret-1',
      providerTurnId: 'provider-turn-secret-1',
      providerItemId: `provider-item-${suffix}`,
    })
  }

  assert.equal(fixture.service.snapshot().pendingApprovals.length, 2)
})

test('rejects an invalid approval before committing public state', async (t) => {
  const fixture = await createFixture(t)
  const created = await createConversation(fixture, 'act_create22')
  await startTurn(
    fixture,
    created.data.conversation.conversationId,
    'act_start022',
  )

  assert.throws(() => {
    fixture.runtime.requestApproval({
      providerRequestId: 'provider-request-invalid',
      providerApprovalId: 'provider-approval-invalid',
      providerThreadId: 'provider-thread-secret-1',
      providerTurnId: 'provider-turn-secret-1',
      providerItemId: 'provider-item-invalid',
      summary: '   ',
    })
  })

  const snapshot = fixture.service.snapshot()
  assert.equal(snapshot.pendingApprovals.length, 0)
  assert.equal(snapshot.conversations[0].status, 'running')
})

test('projects a fatal runtime failure into terminal safe Host state', async (t) => {
  const fixture = await createFixture(t)
  const created = await createConversation(fixture, 'act_create23')
  const conversationId = created.data.conversation.conversationId
  const started = await startTurn(fixture, conversationId, 'act_start023')
  fixture.runtime.requestApproval({
    providerRequestId: 'provider-request-runtime-failure',
    providerApprovalId: 'provider-approval-runtime-failure',
    providerThreadId: 'provider-thread-secret-1',
    providerTurnId: 'provider-turn-secret-1',
    providerItemId: 'provider-item-runtime-failure',
  })

  fixture.runtime.fail(
    new Error('secret provider failure token=must-not-cross-boundary'),
  )

  const snapshot = fixture.service.snapshot()
  assert.equal(snapshot.activeTurns.length, 0)
  assert.equal(snapshot.pendingApprovals.length, 0)
  assert.equal(snapshot.conversations[0].status, 'failed')
  assert.equal(snapshot.conversations[0].activeTurnId, undefined)
  const terminalTurn = fixture.events.find(
    (event) =>
      event.type === 'turn.failed' && event.turnId === started.data.turn.turnId,
  )
  assert.deepEqual(terminalTurn.payload.error, {
    code: 'runtime_unavailable',
    message: 'Codex runtime became unavailable',
  })
  const resolved = fixture.events.find(
    (event) => event.type === 'approval.resolved',
  )
  assert.equal(resolved.payload.approval.decision, 'decline')
  assert.equal(
    JSON.stringify({ snapshot, events: fixture.events }).includes(
      'must-not-cross-boundary',
    ),
    false,
  )
  assert.deepEqual(fixture.service.bootstrap().capabilities, {
    codex: false,
    approvals: false,
    interrupt: false,
    resume: false,
    diff: false,
    streaming: true,
  })

  await assert.rejects(
    fixture.service.createConversation({
      actionId: 'act_afterfailure01',
      provider: 'codex',
      cwd: fixture.workspace,
    }),
    (error) =>
      error instanceof HostServiceError &&
      error.code === 'runtime_unavailable' &&
      error.httpStatus === 503,
  )
  assert.equal(fixture.runtime.conversationCalls.length, 1)
})

test('close declines pending approvals, closes runtime once, and unsubscribes', async (t) => {
  const fixture = await createFixture(t)
  const created = await createConversation(fixture, 'act_create08')
  await startTurn(
    fixture,
    created.data.conversation.conversationId,
    'act_start008',
  )
  fixture.runtime.requestApproval({
    providerRequestId: 'provider-request-cleanup',
    providerApprovalId: 'provider-approval-cleanup',
    providerThreadId: 'provider-thread-secret-1',
    providerTurnId: 'provider-turn-secret-1',
  })
  const eventCount = fixture.events.length

  await Promise.all([fixture.service.close(), fixture.service.close()])

  assert.equal(fixture.runtime.closeCalls, 1)
  assert.equal(fixture.runtime.subscriptionCount, 0)
  assert.deepEqual(fixture.runtime.approvalDecisions, [
    { providerRequestId: 'provider-request-cleanup', decision: 'decline' },
  ])
  assert.deepEqual(fixture.runtime.lifecycle, [
    'approval:decline',
    'runtime-close',
    'unsubscribe-events',
    'unsubscribe-approvals',
    'unsubscribe-failures',
  ])

  fixture.runtime.emitEvent({
    provider: 'codex',
    timestamp,
    threadId: 'provider-thread-secret-1',
    turnId: 'provider-turn-secret-1',
    itemId: 'provider-item-after-close',
    type: 'message.delta',
    delta: 'must not publish',
  })
  assert.equal(fixture.events.length, eventCount)
})

test('close still unsubscribes and clears listeners when runtime close rejects', async (t) => {
  const fixture = await createFixture(t)
  const created = await createConversation(fixture, 'act_create20')
  await startTurn(
    fixture,
    created.data.conversation.conversationId,
    'act_start020',
  )
  fixture.runtime.requestApproval({
    providerRequestId: 'provider-request-close-failure',
    providerApprovalId: 'provider-approval-close-failure',
    providerThreadId: 'provider-thread-secret-1',
    providerTurnId: 'provider-turn-secret-1',
  })
  const runtimeError = new Error('runtime close failed')
  fixture.runtime.closeError = runtimeError

  await assert.rejects(
    fixture.service.close(),
    (error) => error === runtimeError,
  )

  assert.equal(fixture.runtime.closeCalls, 1)
  assert.equal(fixture.runtime.subscriptionCount, 0)
  assert.deepEqual(fixture.runtime.approvalDecisions, [
    {
      providerRequestId: 'provider-request-close-failure',
      decision: 'decline',
    },
  ])
  assert.deepEqual(fixture.runtime.lifecycle, [
    'approval:decline',
    'runtime-close',
    'unsubscribe-events',
    'unsubscribe-approvals',
    'unsubscribe-failures',
  ])
})

test('records Host-owned Turn input once for every live observer and snapshot', async (t) => {
  const fixture = await createFixture(t)
  const secondObserver = []
  const unsubscribe = fixture.publisher.subscribe((event) => {
    secondObserver.push(event)
  })
  t.after(unsubscribe)

  const created = await createConversation(fixture, 'act_history_create01')
  const conversationId = created.data.conversation.conversationId
  const started = await startTurn(
    fixture,
    conversationId,
    'act_history_start01',
    'Describe the workspace safely',
  )

  const firstEvent = fixture.events.find(
    (event) => event.type === 'turn.started',
  )
  const secondEvent = secondObserver.find(
    (event) => event.type === 'turn.started',
  )
  assert.deepEqual(firstEvent, secondEvent)
  assert.deepEqual(firstEvent.payload.turn.input, {
    type: 'text',
    text: 'Describe the workspace safely',
    timestamp,
  })
  assert.deepEqual(started.data.turn.input, firstEvent.payload.turn.input)

  const snapshot = HostSnapshotSchema.parse(fixture.service.snapshot())
  assert.deepEqual(
    snapshot.conversationRuntimes[0].turns[0].input,
    firstEvent.payload.turn.input,
  )
})

test('reconstructs two completed Turns from the same semantics published live', async (t) => {
  const fixture = await createFixture(t)
  const created = await createConversation(fixture, 'act_history_create02')
  const conversationId = created.data.conversation.conversationId

  const first = await startTurn(
    fixture,
    conversationId,
    'act_history_start02a',
    'Inspect the file',
  )
  fixture.runtime.emitEvent({
    provider: 'codex',
    timestamp,
    threadId: 'provider-thread-secret-1',
    turnId: 'provider-turn-secret-1',
    itemId: 'provider-message-history-1',
    type: 'message.delta',
    delta: 'First ',
  })
  fixture.runtime.emitEvent({
    provider: 'codex',
    timestamp,
    threadId: 'provider-thread-secret-1',
    turnId: 'provider-turn-secret-1',
    itemId: 'provider-message-history-1',
    type: 'message.completed',
    message: 'First answer',
  })
  fixture.runtime.emitEvent({
    provider: 'codex',
    timestamp,
    threadId: 'provider-thread-secret-1',
    turnId: 'provider-turn-secret-1',
    itemId: 'provider-tool-history-1',
    type: 'tool.started',
    name: 'git status --short',
    summary: 'Inspect status',
  })
  fixture.runtime.emitEvent({
    provider: 'codex',
    timestamp,
    threadId: 'provider-thread-secret-1',
    turnId: 'provider-turn-secret-1',
    itemId: 'provider-tool-history-1',
    type: 'tool.output',
    output: ' M src/example.ts\n',
    stream: 'stdout',
  })
  fixture.runtime.emitEvent({
    provider: 'codex',
    timestamp,
    threadId: 'provider-thread-secret-1',
    turnId: 'provider-turn-secret-1',
    itemId: 'provider-tool-history-1',
    type: 'tool.completed',
    name: 'git status --short',
    success: true,
    summary: 'Working tree inspected',
  })
  fixture.runtime.emitEvent({
    provider: 'codex',
    timestamp,
    threadId: 'provider-thread-secret-1',
    turnId: 'provider-turn-secret-1',
    itemId: 'provider-tool-history-1',
    type: 'file.changed',
    path: 'src/example.ts',
    kind: 'modified',
    diff: '@@ -1 +1 @@\n-old\n+new',
  })
  fixture.runtime.emitEvent({
    provider: 'codex',
    timestamp,
    threadId: 'provider-thread-secret-1',
    turnId: 'provider-turn-secret-1',
    type: 'turn.completed',
    finalMessage: 'First answer',
  })

  const second = await startTurn(
    fixture,
    conversationId,
    'act_history_start02b',
    'Summarize the change',
  )
  fixture.runtime.emitEvent({
    provider: 'codex',
    timestamp,
    threadId: 'provider-thread-secret-1',
    turnId: 'provider-turn-secret-2',
    itemId: 'provider-message-history-2',
    type: 'message.completed',
    message: 'Second answer',
  })
  fixture.runtime.emitEvent({
    provider: 'codex',
    timestamp,
    threadId: 'provider-thread-secret-1',
    turnId: 'provider-turn-secret-2',
    type: 'turn.completed',
    finalMessage: 'Second answer',
  })

  const snapshot = HostSnapshotSchema.parse(fixture.service.snapshot())
  const runtime = snapshot.conversationRuntimes[0]
  assert.deepEqual(
    runtime.turns.map((turn) => [
      turn.turnId,
      turn.input.text,
      turn.status,
      turn.finalMessage,
    ]),
    [
      [first.data.turn.turnId, 'Inspect the file', 'completed', 'First answer'],
      [
        second.data.turn.turnId,
        'Summarize the change',
        'completed',
        'Second answer',
      ],
    ],
  )
  assert.deepEqual(
    runtime.messages.map((message) => [
      message.turnId,
      message.text,
      message.status,
    ]),
    [
      [first.data.turn.turnId, 'First answer', 'completed'],
      [second.data.turn.turnId, 'Second answer', 'completed'],
    ],
  )
  assert.deepEqual(
    runtime.tools.map((tool) => [
      tool.turnId,
      tool.name,
      tool.command,
      tool.status,
      tool.success,
      tool.outputSummary,
    ]),
    [
      [
        first.data.turn.turnId,
        'command',
        'git status --short',
        'completed',
        true,
        'Working tree inspected',
      ],
    ],
  )
  assert.equal(runtime.changes[0].turnId, first.data.turn.turnId)
  assert.equal(runtime.changes[0].diff, '@@ -1 +1 @@\n-old\n+new')
  assert.equal(runtime.terminal.text, ' M src/example.ts\n')
  assert.equal(runtime.terminal.command, 'git status --short')
  assert.equal(runtime.terminal.stream, 'stdout')
  assert.deepEqual(runtime.history, {
    evictedTurns: 0,
    evictedMessages: 0,
    evictedTools: 0,
    evictedChanges: 0,
    truncated: false,
  })

  const liveItems = fixture.events.filter((event) =>
    ['message.delta', 'tool.started', 'file.changed'].includes(event.type),
  )
  assert.deepEqual(
    [
      runtime.messages[0].order,
      runtime.tools[0].order,
      runtime.changes[0].order,
    ],
    liveItems.map((event) => event.seq),
  )
})

test('publishes a stable Tool identity without exposing an oversized command as its name', async (t) => {
  const fixture = await createFixture(t)
  const created = await createConversation(fixture, 'act_tool_identity_create')
  const conversationId = created.data.conversation.conversationId
  await startTurn(
    fixture,
    conversationId,
    'act_tool_identity_turn',
    'Inspect safely',
  )

  const command = `powershell.exe -NoProfile -Command Get-Content ${'x'.repeat(40_000)}`
  fixture.runtime.emitEvent({
    provider: 'codex',
    timestamp,
    threadId: 'provider-thread-secret-1',
    turnId: 'provider-turn-secret-1',
    itemId: 'provider-tool-long-command',
    type: 'tool.started',
    name: command,
  })
  fixture.runtime.emitEvent({
    provider: 'codex',
    timestamp,
    threadId: 'provider-thread-secret-1',
    turnId: 'provider-turn-secret-1',
    itemId: 'provider-tool-long-command',
    type: 'tool.completed',
    name: command,
    success: false,
    summary: `${'diagnostic '.repeat(600)}PathNotFound`,
  })

  const started = fixture.events.find(
    (event) =>
      event.type === 'tool.started' &&
      event.itemId !== undefined &&
      String(event.itemId).length > 0,
  )
  assert.equal(started.payload.name, 'command')
  assert.equal(started.payload.command.length, 32 * 1024)
  assert.equal(started.payload.command, command.slice(0, 32 * 1024))

  const snapshot = HostSnapshotSchema.parse(fixture.service.snapshot())
  const tool = snapshot.conversationRuntimes[0].tools[0]
  assert.equal(tool.name, 'command')
  assert.equal(tool.command, command.slice(0, 32 * 1024))
  assert.equal(tool.status, 'failed')
  assert.match(tool.outputSummary, /PathNotFound$/u)
  assert.equal(snapshot.conversationRuntimes[0].terminal.command, tool.command)
})

test('retains the raw command when interleaved Tool output regains the terminal tail', async (t) => {
  const fixture = await createFixture(t)
  const created = await createConversation(
    fixture,
    'act_interleaved_tool_create',
  )
  const conversationId = created.data.conversation.conversationId
  await startTurn(
    fixture,
    conversationId,
    'act_interleaved_tool_turn',
    'Inspect safely',
  )

  for (const [itemId, name] of [
    ['provider-tool-first', 'git status --short'],
    ['provider-tool-second', 'pnpm test'],
  ]) {
    fixture.runtime.emitEvent({
      provider: 'codex',
      timestamp,
      threadId: 'provider-thread-secret-1',
      turnId: 'provider-turn-secret-1',
      itemId,
      type: 'tool.started',
      name,
    })
  }

  fixture.runtime.emitEvent({
    provider: 'codex',
    timestamp,
    threadId: 'provider-thread-secret-1',
    turnId: 'provider-turn-secret-1',
    itemId: 'provider-tool-first',
    type: 'tool.output',
    output: 'clean\n',
    stream: 'stdout',
  })

  const snapshot = HostSnapshotSchema.parse(fixture.service.snapshot())
  assert.equal(
    snapshot.conversationRuntimes[0].terminal.command,
    'git status --short',
  )
  assert.equal(snapshot.conversationRuntimes[0].terminal.text, 'clean\n')
})

test('preserves one public Item identity through active-Turn eviction and publishes a Snapshot boundary', async (t) => {
  const fixture = await createFixture(t, {
    historyLimits: { maxEntries: 1 },
  })
  const created = await createConversation(fixture, 'act_item_identity_create')
  const conversationId = created.data.conversation.conversationId
  await startTurn(
    fixture,
    conversationId,
    'act_item_identity_turn',
    'Inspect safely',
  )

  fixture.runtime.emitEvent({
    provider: 'codex',
    timestamp,
    threadId: 'provider-thread-secret-1',
    turnId: 'provider-turn-secret-1',
    itemId: 'provider-item-stable',
    type: 'tool.started',
    name: 'echo safe',
  })
  fixture.runtime.emitEvent({
    provider: 'codex',
    timestamp,
    threadId: 'provider-thread-secret-1',
    turnId: 'provider-turn-secret-1',
    itemId: 'provider-message-evicts-tool',
    type: 'message.completed',
    message: 'Still running',
  })
  fixture.runtime.emitEvent({
    provider: 'codex',
    timestamp,
    threadId: 'provider-thread-secret-1',
    turnId: 'provider-turn-secret-1',
    itemId: 'provider-item-stable',
    type: 'tool.output',
    output: 'safe\n',
  })

  const toolEvents = fixture.events.filter(
    (event) => event.type === 'tool.started' || event.type === 'tool.output',
  )
  assert.equal(toolEvents.length, 2)
  assert.equal(toolEvents[0].itemId, toolEvents[1].itemId)
  assert.equal(
    fixture.events.some(
      (event) =>
        event.type === 'stream.reset' &&
        event.payload.reason === 'history_evicted',
    ),
    true,
  )
  const replay = fixture.publisher.replayAfter({
    epoch: fixture.publisher.epoch,
    seq: toolEvents[0].seq,
  })
  assert.equal(replay.kind, 'replay')
  assert.equal(
    replay.events.some((event) => event.type === 'stream.reset'),
    true,
  )
})

test('retains every changed path when one provider file Item reports multiple files', async (t) => {
  const fixture = await createFixture(t)
  const created = await createConversation(
    fixture,
    'act_change_identity_create',
  )
  const conversationId = created.data.conversation.conversationId
  await startTurn(
    fixture,
    conversationId,
    'act_change_identity_turn',
    'Inspect changes',
  )

  for (const path of ['src/one.ts', 'src/two.ts']) {
    fixture.runtime.emitEvent({
      provider: 'codex',
      timestamp,
      threadId: 'provider-thread-secret-1',
      turnId: 'provider-turn-secret-1',
      itemId: 'provider-file-item-shared',
      type: 'file.changed',
      path,
      kind: 'modified',
      diff: `@@ -1 +1 @@\n-old\n+${path}`,
    })
  }

  const runtime = HostSnapshotSchema.parse(fixture.service.snapshot())
    .conversationRuntimes[0]
  assert.deepEqual(
    runtime.changes.map((change) => change.path),
    ['src/one.ts', 'src/two.ts'],
  )
  assert.equal(runtime.changes[0].itemId, runtime.changes[1].itemId)
  assert.notEqual(runtime.changes[0].order, runtime.changes[1].order)
})

test('merges a terminal final message into the last streaming Agent Item', async (t) => {
  const fixture = await createFixture(t)
  const created = await createConversation(fixture, 'act_final_merge_create')
  const conversationId = created.data.conversation.conversationId
  await startTurn(
    fixture,
    conversationId,
    'act_final_merge_turn',
    'Summarize safely',
  )
  fixture.runtime.emitEvent({
    provider: 'codex',
    timestamp,
    threadId: 'provider-thread-secret-1',
    turnId: 'provider-turn-secret-1',
    itemId: 'provider-message-final-merge',
    type: 'message.delta',
    delta: 'partial',
  })
  fixture.runtime.emitEvent({
    provider: 'codex',
    timestamp,
    threadId: 'provider-thread-secret-1',
    turnId: 'provider-turn-secret-1',
    type: 'turn.completed',
    finalMessage: 'authoritative final',
  })

  const runtime = HostSnapshotSchema.parse(fixture.service.snapshot())
    .conversationRuntimes[0]
  assert.equal(runtime.messages.length, 1)
  assert.equal(runtime.messages[0].text, 'authoritative final')
  assert.equal(runtime.messages[0].status, 'completed')
  assert.equal(runtime.turns[0].finalMessage, 'authoritative final')
})

test('bounds retained Turns and consumes late events for an evicted provider Turn', async (t) => {
  const fixture = await createFixture(t, {
    historyLimits: { maxTurns: 2 },
  })
  const created = await createConversation(fixture, 'act_history_create03')
  const conversationId = created.data.conversation.conversationId

  for (let turnNumber = 1; turnNumber <= 3; turnNumber += 1) {
    await startTurn(
      fixture,
      conversationId,
      `act_history_start03${String(turnNumber)}`,
      `Prompt ${String(turnNumber)}`,
    )
    fixture.runtime.emitEvent({
      provider: 'codex',
      timestamp,
      threadId: 'provider-thread-secret-1',
      turnId: `provider-turn-secret-${String(turnNumber)}`,
      itemId: `provider-message-history-${String(turnNumber)}`,
      type: 'message.completed',
      message: `Answer ${String(turnNumber)}`,
    })
    fixture.runtime.emitEvent({
      provider: 'codex',
      timestamp,
      threadId: 'provider-thread-secret-1',
      turnId: `provider-turn-secret-${String(turnNumber)}`,
      type: 'turn.completed',
      finalMessage: `Answer ${String(turnNumber)}`,
    })
  }

  const snapshot = HostSnapshotSchema.parse(fixture.service.snapshot())
  const runtime = snapshot.conversationRuntimes[0]
  assert.deepEqual(
    runtime.turns.map((turn) => turn.input.text),
    ['Prompt 2', 'Prompt 3'],
  )
  assert.equal(runtime.history.evictedTurns, 1)
  assert.equal(runtime.history.evictedMessages, 1)
  assert.equal(runtime.history.truncated, true)

  const eventCount = fixture.events.length
  for (let index = 0; index < 600; index += 1) {
    fixture.runtime.emitEvent({
      provider: 'codex',
      timestamp,
      threadId: 'provider-thread-secret-1',
      turnId: 'provider-turn-secret-1',
      itemId: `provider-late-item-${String(index)}`,
      type: 'message.delta',
      delta: 'late',
    })
  }
  assert.equal(fixture.events.length, eventCount)
})

test('bounds active presentation entries and UTF-8 terminal tail explicitly', async (t) => {
  const fixture = await createFixture(t, {
    historyLimits: {
      maxEntries: 2,
      maxTerminalBytes: 10,
      maxPresentationTextBytes: 5,
    },
  })
  const created = await createConversation(fixture, 'act_history_create04')
  const conversationId = created.data.conversation.conversationId
  await startTurn(fixture, conversationId, 'act_history_start04')

  for (let index = 1; index <= 3; index += 1) {
    fixture.runtime.emitEvent({
      provider: 'codex',
      timestamp,
      threadId: 'provider-thread-secret-1',
      turnId: 'provider-turn-secret-1',
      itemId: `provider-message-bound-${String(index)}`,
      type: 'message.completed',
      message: '甲乙',
    })
  }
  fixture.runtime.emitEvent({
    provider: 'codex',
    timestamp,
    threadId: 'provider-thread-secret-1',
    turnId: 'provider-turn-secret-1',
    itemId: 'provider-tool-terminal-bound',
    type: 'tool.started',
    name: 'safe-command',
  })
  fixture.runtime.emitEvent({
    provider: 'codex',
    timestamp,
    threadId: 'provider-thread-secret-1',
    turnId: 'provider-turn-secret-1',
    itemId: 'provider-tool-terminal-bound',
    type: 'tool.output',
    output: '甲乙丙丁',
    stream: 'stderr',
  })

  const runtime = HostSnapshotSchema.parse(fixture.service.snapshot())
    .conversationRuntimes[0]
  assert.equal(runtime.turns.length, 1)
  assert.equal(runtime.turns[0].status, 'running')
  assert.equal(runtime.messages.length + runtime.tools.length, 2)
  assert.equal(runtime.messages[0].text, '甲')
  assert.equal(runtime.messages[0].text.includes('\uFFFD'), false)
  assert.equal(runtime.terminal.text, '乙丙丁')
  assert.equal(Buffer.byteLength(runtime.terminal.text, 'utf8') <= 10, true)
  assert.equal(runtime.terminal.text.includes('\uFFFD'), false)
  assert.equal(runtime.terminal.stream, 'stderr')
  assert.equal(runtime.terminal.truncated, true)
  assert.equal(runtime.history.evictedMessages, 2)
  assert.equal(runtime.history.truncated, true)
})

test('bounds encoded Conversation runtime memory without evicting its active Turn', async (t) => {
  const maxConversationBytes = 2 * 1024
  const fixture = await createFixture(t, {
    historyLimits: {
      maxEntries: 32,
      maxConversationBytes,
      maxPresentationTextBytes: 512,
    },
  })
  const created = await createConversation(fixture, 'act_history_create05')
  const conversationId = created.data.conversation.conversationId
  const started = await startTurn(
    fixture,
    conversationId,
    'act_history_start05',
  )

  for (let index = 0; index < 10; index += 1) {
    fixture.runtime.emitEvent({
      provider: 'codex',
      timestamp,
      threadId: 'provider-thread-secret-1',
      turnId: 'provider-turn-secret-1',
      itemId: `provider-message-memory-${String(index)}`,
      type: 'message.completed',
      message: `${String(index)}${'x'.repeat(400)}`,
    })
  }

  const runtime = HostSnapshotSchema.parse(fixture.service.snapshot())
    .conversationRuntimes[0]
  assert.deepEqual(
    runtime.turns.map((turn) => turn.turnId),
    [started.data.turn.turnId],
  )
  assert.equal(runtime.turns[0].status, 'running')
  assert.equal(
    Buffer.byteLength(JSON.stringify(runtime), 'utf8') <= maxConversationBytes,
    true,
  )
  assert.equal(runtime.history.evictedMessages > 0, true)
  assert.equal(runtime.history.truncated, true)
})

test('truncates a terminal final message until one retained Turn fits its memory bound', async (t) => {
  const maxConversationBytes = 1024
  const fixture = await createFixture(t, {
    historyLimits: {
      maxConversationBytes,
      maxPresentationTextBytes: 512,
    },
  })
  const created = await createConversation(fixture, 'act_history_create06')
  const conversationId = created.data.conversation.conversationId
  const started = await startTurn(
    fixture,
    conversationId,
    'act_history_start06',
    'Safe prompt',
  )
  const rawFinalMessage = '\u0000'.repeat(512)
  fixture.runtime.emitEvent({
    provider: 'codex',
    timestamp,
    threadId: 'provider-thread-secret-1',
    turnId: 'provider-turn-secret-1',
    type: 'turn.completed',
    finalMessage: rawFinalMessage,
  })

  const runtime = HostSnapshotSchema.parse(fixture.service.snapshot())
    .conversationRuntimes[0]
  assert.equal(runtime.turns.length, 1)
  assert.equal(runtime.turns[0].turnId, started.data.turn.turnId)
  assert.equal(runtime.turns[0].input.text, 'Safe prompt')
  assert.equal(
    runtime.turns[0].finalMessage.length < rawFinalMessage.length,
    true,
  )
  assert.equal(runtime.history.truncated, true)
  assert.equal(
    Buffer.byteLength(JSON.stringify(runtime), 'utf8') <= maxConversationBytes,
    true,
  )
})
