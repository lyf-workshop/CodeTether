import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'

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

async function createFixture(t) {
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
  assert.equal(snapshot.conversations[0].status, 'completed')
  fixture.runtime.resolveApproval({
    providerRequestId: 'provider-request-terminal-async',
    providerApprovalId: 'provider-approval-terminal-async',
    providerThreadId: 'provider-thread-secret-1',
    providerTurnId: 'provider-turn-secret-1',
    decision: 'decline',
  })
  snapshot = fixture.service.snapshot()
  assert.equal(snapshot.pendingApprovals.length, 0)
  assert.equal(snapshot.conversations[0].status, 'completed')
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
