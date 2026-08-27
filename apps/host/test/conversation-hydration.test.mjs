import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import { HostEventPublisher } from '../dist/api/host-event-publisher.js'
import { HostService, HostServiceError } from '../dist/api/host-service.js'
import { WorkspacePolicy } from '../dist/api/workspace-policy.js'
import {
  ConversationStore,
  parseDurableTurnPresentation,
} from '../dist/persistence/index.js'
import { normalizeTrustedProjectRoot } from '../dist/project-path.js'

const projectId = 'proj_hydration_fixture'
const hostNow = '2026-09-30T12:00:00.000Z'
const terminalTimestamp = '2026-09-30T12:00:01.000Z'
const baseTimestamp = Date.parse('2026-08-27T08:00:00.000Z')

class FakeRuntime {
  provider = 'codex'
  resumeCalls = []
  turnCalls = []
  approvalDecisions = []
  closeCalls = 0
  #turnSequence = 0
  #eventListeners = new Set()
  #failureListeners = new Set()
  #approvalListeners = new Set()
  #resumeGate

  subscribeEvents(listener) {
    this.#eventListeners.add(listener)
    return () => this.#eventListeners.delete(listener)
  }

  subscribeFailures(listener) {
    this.#failureListeners.add(listener)
    return () => this.#failureListeners.delete(listener)
  }

  subscribeApprovals(onRequest, onResolved) {
    const listeners = { onRequest, onResolved }
    this.#approvalListeners.add(listeners)
    return () => this.#approvalListeners.delete(listeners)
  }

  async startConversation() {
    throw new Error('The hydration fixture does not create Provider Threads')
  }

  async resumeConversation(options) {
    this.resumeCalls.push(options)
    const gate = this.#resumeGate
    if (gate !== undefined) {
      this.#resumeGate = undefined
      gate.markStarted()
      await gate.waitForRelease
    }
    return {
      providerThreadId: options.providerThreadId,
      model: 'gpt-5.6-sol',
    }
  }

  async startTurn(options) {
    const providerTurnId = `provider-turn-hydration-${String(++this.#turnSequence)}`
    this.turnCalls.push({ options, providerTurnId })
    return { providerTurnId }
  }

  async interruptTurn() {}

  async close() {
    this.closeCalls += 1
  }

  holdNextResume() {
    const started = deferred()
    const released = deferred()
    this.#resumeGate = {
      markStarted: () => started.resolve(),
      waitForRelease: released.promise,
    }
    return {
      started: started.promise,
      release: () => released.resolve(),
    }
  }

  emit(event) {
    for (const listener of [...this.#eventListeners]) listener(event)
  }

  requestApproval(options) {
    for (const listeners of [...this.#approvalListeners]) {
      listeners.onRequest({
        providerRequestId: options.providerRequestId,
        providerApprovalId: options.providerApprovalId,
        providerThreadId: options.providerThreadId,
        providerTurnId: options.providerTurnId,
        ...(options.providerItemId === undefined
          ? {}
          : { providerItemId: options.providerItemId }),
        kind: 'command',
        summary: 'Run a safe fixture command',
        respond: (decision) => this.approvalDecisions.push(decision),
      })
    }
  }
}

test('bounds startup to eight hot Conversations while cold detail remains durable and read-only', async (t) => {
  const fixture = await createFixture(t, {
    conversationCount: 10,
    turnCounts: new Map([[0, 25]]),
  })
  const expectedHot = conversationIndexes(2, 10)

  assert.deepEqual(hotConversationIds(fixture.service), expectedHot)
  assert.equal(fixture.service.snapshot().conversations.length, 8)

  const beforeHot = hotConversationIds(fixture.service)
  const detail = fixture.service.getConversation(conversationId(0))

  assert.equal(detail.conversation.conversationId, conversationId(0))
  assert.equal(detail.conversation.status, 'completed')
  assert.equal(detail.runtime.turns.length, 20)
  assert.equal(detail.runtime.turns[0].input.text, 'Prompt 0/5')
  assert.equal(detail.runtime.turns.at(-1).input.text, 'Prompt 0/24')
  assert.equal(detail.runtime.turns.at(-1).status, 'completed')
  assert.deepEqual(detail.history, {
    hasOlderHistory: true,
    retainedTurnCount: 20,
    totalTurnCount: 25,
  })
  assert.equal(
    fixture.store.getConversation(conversationId(0)).status,
    detail.conversation.status,
  )
  assert.deepEqual(hotConversationIds(fixture.service), beforeHot)
  assert.equal(fixture.runtime.resumeCalls.length, 0)
  assert.equal(fixture.runtime.turnCalls.length, 0)
})

test('keeps a 50 Conversation index summary-only while cold detail reads preserve the eight-runtime bound', async (t) => {
  const fixture = await createFixture(t, {
    conversationCount: 50,
    turnCounts: new Map(
      Array.from({ length: 50 }, (_, index) => [index, index === 1 ? 3 : 1]),
    ),
    corruptSnapshotConversationIndex: 0,
  })
  const initialHot = conversationIndexes(42, 50)

  assert.deepEqual(hotConversationIds(fixture.service), initialHot)
  assert.equal(fixture.service.snapshot().conversations.length, 8)

  const listStartedAt = performance.now()
  const summaries = await fixture.service.listProjectConversations(projectId, {
    limit: 50,
  })
  const listElapsedMs = performance.now() - listStartedAt
  t.diagnostic(
    `50 durable Conversation summaries: ${listElapsedMs.toFixed(3)} ms`,
  )

  assert.equal(summaries.conversations.length, 50)
  assert.equal(summaries.conversations[0].conversationId, conversationId(49))
  assert.equal(summaries.conversations.at(-1).conversationId, conversationId(0))
  assert.ok(
    summaries.conversations.every(
      (conversation) =>
        !('providerThreadId' in conversation) && !('cwd' in conversation),
    ),
  )
  assert.throws(() => fixture.store.getTurn(turnId(0, 0)), /invalid JSON/)

  const durableBefore = fixture.store.getConversation(conversationId(1))
  const detailStartedAt = performance.now()
  const detail = fixture.service.getConversation(conversationId(1))
  const detailElapsedMs = performance.now() - detailStartedAt
  t.diagnostic(
    `cold durable Conversation detail (3 Turns): ${detailElapsedMs.toFixed(3)} ms`,
  )

  assert.equal(detail.conversation.conversationId, conversationId(1))
  assert.equal(detail.runtime.turns.length, 3)
  assert.equal(detail.runtime.turns[0].input.text, 'Prompt 1/0')
  assert.equal(detail.runtime.turns.at(-1).input.text, 'Prompt 1/2')
  assert.deepEqual(detail.history, {
    hasOlderHistory: false,
    retainedTurnCount: 3,
    totalTurnCount: 3,
  })
  assert.deepEqual(
    fixture.store.getConversation(conversationId(1)),
    durableBefore,
  )
  assert.deepEqual(hotConversationIds(fixture.service), initialHot)
  assert.equal(fixture.service.snapshot().conversations.length, 8)
  assert.equal(fixture.runtime.resumeCalls.length, 0)
  assert.equal(fixture.runtime.turnCalls.length, 0)
})

test('keeps repeated cold control and idle eviction within the runtime working-set bound', async (t) => {
  const fixture = await createFixture(t, {
    conversationCount: 20,
    maxConversations: 8,
  })

  assert.equal(fixture.service.snapshot().conversations.length, 8)
  for (let index = 0; index < 12; index += 1) {
    await startTurn(
      fixture.service,
      conversationId(index),
      `act_hydration_repeated_${String(index)}`,
    )
    completeTurn(
      fixture.runtime,
      index,
      fixture.runtime.turnCalls.at(-1),
      `Repeated ${String(index)}`,
    )

    assert.equal(fixture.service.snapshot().conversations.length, 8)
    assert.equal(
      fixture.service.getConversation(conversationId(index)).conversation
        .status,
      'completed',
    )
  }

  assert.equal(fixture.runtime.resumeCalls.length, 12)
  assert.equal(fixture.runtime.turnCalls.length, 12)
  assert.equal(
    (await fixture.service.listProjectConversations(projectId, { limit: 50 }))
      .conversations.length,
    20,
  )
})

test('hydrates a cold Conversation once, resumes once, and evicts the least-recent idle runtime', async (t) => {
  const fixture = await createFixture(t, {
    conversationCount: 3,
    maxConversations: 2,
  })
  assert.deepEqual(hotConversationIds(fixture.service), [
    conversationId(1),
    conversationId(2),
  ])

  // Touch Conversation 1 so Conversation 2 becomes the least-recent idle
  // runtime even though it has the newest durable lastActivityAt.
  fixture.service.getConversation(conversationId(1))
  const started = await startTurn(
    fixture.service,
    conversationId(0),
    'act_hydrate_cold_once',
  )

  assert.deepEqual(fixture.runtime.resumeCalls, [
    {
      providerThreadId: providerThreadId(0),
      cwd: fixture.workspace,
    },
  ])
  assert.equal(fixture.runtime.turnCalls.length, 1)
  assert.deepEqual(hotConversationIds(fixture.service), [
    conversationId(0),
    conversationId(1),
  ])
  assert.equal(
    fixture.service.getConversation(conversationId(0)).conversation.status,
    'running',
  )
  assert.equal(
    fixture.store.getConversation(conversationId(0)).status,
    'running',
  )

  completeTurn(fixture.runtime, 0, fixture.runtime.turnCalls[0], 'Hydrated')

  const completed = fixture.service.getConversation(conversationId(0))
  assert.equal(completed.conversation.status, 'completed')
  assert.equal(completed.runtime.turns.at(-1).turnId, started.data.turn.turnId)
  assert.equal(completed.runtime.turns.at(-1).status, 'completed')
  assert.equal(
    fixture.store.getConversation(conversationId(0)).status,
    'completed',
  )

  // The evicted Conversation remains a readable durable product record and a
  // GET never resumes its Provider Thread.
  assert.equal(
    fixture.service.getConversation(conversationId(2)).conversation.status,
    'completed',
  )
  assert.equal(fixture.runtime.resumeCalls.length, 1)
})

test('does not evict an active Conversation with a pending Approval', async (t) => {
  const fixture = await createFixture(t, {
    conversationCount: 2,
    maxConversations: 1,
  })
  const activeId = conversationId(1)
  await startTurn(fixture.service, activeId, 'act_hydration_active_turn')
  const providerTurnId = fixture.runtime.turnCalls[0].providerTurnId
  fixture.runtime.requestApproval({
    providerRequestId: 'provider-request-hydration-pending',
    providerApprovalId: 'provider-approval-hydration-pending',
    providerThreadId: providerThreadIdFor(activeId),
    providerTurnId,
    providerItemId: 'provider-item-hydration-pending',
  })

  assert.equal(fixture.service.snapshot().pendingApprovals.length, 1)
  assert.equal(
    fixture.service.getConversation(activeId).conversation.status,
    'waiting',
  )
  await assert.rejects(
    startTurn(
      fixture.service,
      conversationId(0),
      'act_hydration_blocked_by_pending',
    ),
    (error) => {
      assert.ok(error instanceof HostServiceError)
      assert.equal(error.code, 'runtime_unavailable')
      assert.equal(error.httpStatus, 503)
      return true
    },
  )

  assert.deepEqual(hotConversationIds(fixture.service), [activeId])
  assert.equal(fixture.service.snapshot().pendingApprovals.length, 1)
  assert.deepEqual(fixture.runtime.approvalDecisions, [])
  assert.equal(fixture.runtime.resumeCalls.length, 1)
  assert.equal(fixture.runtime.turnCalls.length, 1)
})

test('keeps unavailable Projects and missing Provider Threads readable while controls fail closed', async (t) => {
  const missingId = 'conv_hydration_missing_provider'
  const fixture = await createFixture(t, {
    conversationCount: 2,
    maxConversations: 1,
    extraConversations: [
      {
        conversationId: missingId,
        providerThreadId: undefined,
        status: 'failed',
      },
    ],
  })
  const movedWorkspace = `${fixture.workspace}-unavailable`
  await rename(fixture.workspace, movedWorkspace)

  assert.equal(
    fixture.service.getConversation(conversationId(0)).conversation.status,
    'completed',
  )
  await assert.rejects(
    startTurn(
      fixture.service,
      conversationId(0),
      'act_hydration_project_unavailable',
    ),
    (error) => {
      assert.ok(error instanceof HostServiceError)
      assert.equal(error.code, 'project_unavailable')
      assert.equal(error.httpStatus, 409)
      return true
    },
  )
  assert.equal(fixture.runtime.resumeCalls.length, 0)
  assert.equal(fixture.runtime.turnCalls.length, 0)

  await rename(movedWorkspace, fixture.workspace)
  const missing = fixture.service.getConversation(missingId)
  assert.equal(missing.conversation.status, 'failed')
  assert.deepEqual(missing.runtime.turns, [])
  await assert.rejects(
    startTurn(fixture.service, missingId, 'act_hydration_provider_missing'),
    (error) => {
      assert.ok(error instanceof HostServiceError)
      assert.equal(error.code, 'provider_conversation_unavailable')
      assert.equal(error.httpStatus, 409)
      return true
    },
  )
  assert.equal(fixture.runtime.resumeCalls.length, 0)
  assert.equal(fixture.runtime.turnCalls.length, 0)
})

test('deduplicates concurrent cold control and preserves action idempotency through hydration', async (t) => {
  const fixture = await createFixture(t, {
    conversationCount: 3,
    maxConversations: 1,
  })

  const duplicateGate = fixture.runtime.holdNextResume()
  const duplicateRequest = {
    actionId: 'act_hydration_same_action',
    input: { type: 'text', text: 'Start once through cold hydration' },
  }
  const first = fixture.service.startTurn(conversationId(0), duplicateRequest)
  const duplicate = fixture.service.startTurn(conversationId(0), {
    ...duplicateRequest,
    input: { ...duplicateRequest.input },
  })
  await duplicateGate.started
  assert.equal(fixture.runtime.resumeCalls.length, 1)
  duplicateGate.release()
  const [firstResult, duplicateResult] = await Promise.all([first, duplicate])

  assert.deepEqual(duplicateResult, firstResult)
  assert.equal(fixture.runtime.resumeCalls.length, 1)
  assert.equal(fixture.runtime.turnCalls.length, 1)
  completeTurn(fixture.runtime, 0, fixture.runtime.turnCalls[0], 'First')

  const competingGate = fixture.runtime.holdNextResume()
  const competingA = startTurn(
    fixture.service,
    conversationId(1),
    'act_hydration_competing_a',
  )
  const competingB = startTurn(
    fixture.service,
    conversationId(1),
    'act_hydration_competing_b',
  )
  const competingOutcomes = Promise.allSettled([competingA, competingB])
  await competingGate.started
  competingGate.release()
  const outcomes = await competingOutcomes
  const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled')
  const rejected = outcomes.filter((outcome) => outcome.status === 'rejected')

  assert.equal(fulfilled.length, 1)
  assert.equal(rejected.length, 1)
  assert.ok(rejected[0].reason instanceof HostServiceError)
  assert.equal(rejected[0].reason.code, 'conflict')
  assert.equal(fixture.runtime.resumeCalls.length, 2)
  assert.equal(
    fixture.runtime.resumeCalls.filter(
      (call) => call.providerThreadId === providerThreadId(1),
    ).length,
    1,
  )
  assert.equal(fixture.runtime.turnCalls.length, 2)
})

async function createFixture(t, options) {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-hydration-'))
  const workspace = join(directory, 'workspace')
  const databasePath = join(directory, 'data', 'codetether.sqlite3')
  await mkdir(workspace, { recursive: true })

  const seedStore = ConversationStore.open({ databasePath })
  seedProject(seedStore, workspace)
  for (let index = 0; index < options.conversationCount; index += 1) {
    seedConversation(seedStore, workspace, {
      conversationId: conversationId(index),
      index,
    })
    const turnCount = options.turnCounts?.get(index) ?? 0
    for (let turnIndex = 0; turnIndex < turnCount; turnIndex += 1) {
      seedStore.createTurn(durableTurn(index, turnIndex))
    }
  }
  for (const [extraIndex, extra] of (
    options.extraConversations ?? []
  ).entries()) {
    seedConversation(seedStore, workspace, {
      index: options.conversationCount + extraIndex,
      ...extra,
    })
  }
  seedStore.close()

  if (options.corruptSnapshotConversationIndex !== undefined) {
    const raw = new DatabaseSync(databasePath)
    try {
      raw
        .prepare('UPDATE turns SET snapshot_json = ? WHERE turn_id = ?')
        .run('{invalid', turnId(options.corruptSnapshotConversationIndex, 0))
    } finally {
      raw.close()
    }
  }

  const store = ConversationStore.open({ databasePath })
  const runtime = new FakeRuntime()
  const workspacePolicy = await WorkspacePolicy.create([workspace])
  const publisher = new HostEventPublisher({
    epoch: '88888888-8888-4888-8888-888888888888',
  })
  let service
  t.after(async () => {
    await service?.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  })
  service = new HostService({
    runtime,
    workspacePolicy,
    publisher,
    persistence: store,
    hostVersion: '0.0.0-test',
    now: () => new Date(hostNow),
    persistenceFlushMs: 5,
    ...(options.maxConversations === undefined
      ? {}
      : { maxConversations: options.maxConversations }),
  })
  return { directory, workspace, databasePath, store, runtime, service }
}

function seedProject(store, workspace) {
  const root = normalizeTrustedProjectRoot(workspace)
  const timestamp = timestampFor(0, 0)
  store.createProject({
    projectId,
    name: 'Hydration Fixture',
    rootPath: root.rootPath,
    rootPathKey: root.rootPathKey,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
}

function seedConversation(store, workspace, options) {
  const timestamp = timestampFor(options.index, 99)
  store.createConversation({
    conversationId: options.conversationId,
    projectId,
    title: `Hydration ${String(options.index)}`,
    provider: 'codex',
    ...(options.providerThreadId === undefined && 'providerThreadId' in options
      ? {}
      : {
          providerThreadId:
            options.providerThreadId ??
            providerThreadIdFor(options.conversationId),
        }),
    cwd: workspace,
    model: 'gpt-5.6-sol',
    reasoning: 'medium',
    status: options.status ?? 'completed',
    createdAt: timestamp,
    updatedAt: timestamp,
    lastActivityAt: timestamp,
  })
}

function durableTurn(conversationIndex, turnIndex) {
  const conversation = conversationId(conversationIndex)
  const id = turnId(conversationIndex, turnIndex)
  const messageId = `item_hydration_message_${String(conversationIndex)}_${String(turnIndex).padStart(2, '0')}`
  const toolId = `item_hydration_tool_${String(conversationIndex)}_${String(turnIndex).padStart(2, '0')}`
  const timestamp = timestampFor(conversationIndex, turnIndex)
  const turn = {
    turnId: id,
    conversationId: conversation,
    status: 'completed',
    input: {
      type: 'text',
      text: `Prompt ${String(conversationIndex)}/${String(turnIndex)}`,
      timestamp,
    },
    startedAt: timestamp,
    completedAt: timestamp,
    finalMessage: `Result ${String(conversationIndex)}/${String(turnIndex)}`,
  }
  return {
    turnId: id,
    conversationId: conversation,
    providerTurnId: `provider-turn-${String(conversationIndex)}-${String(turnIndex)}`,
    input: turn.input,
    status: 'completed',
    startedAt: timestamp,
    completedAt: timestamp,
    snapshotVersion: 1,
    snapshot: parseDurableTurnPresentation({
      turn,
      messages: [
        {
          turnId: id,
          itemId: messageId,
          text: `Agent ${String(conversationIndex)}/${String(turnIndex)}`,
          status: 'completed',
          timestamp,
          order: turnIndex * 3 + 1,
        },
      ],
      tools: [
        {
          turnId: id,
          itemId: toolId,
          name: 'command',
          command: 'git status --short',
          status: 'completed',
          success: true,
          startedAt: timestamp,
          completedAt: timestamp,
          order: turnIndex * 3 + 2,
        },
      ],
      changes: [
        {
          turnId: id,
          itemId: toolId,
          path: `src/example-${String(turnIndex)}.ts`,
          kind: 'modified',
          diff: `+// ${String(turnIndex)}`,
          additions: 1,
          deletions: 0,
          timestamp,
          order: turnIndex * 3 + 3,
        },
      ],
      terminal: {
        turnId: id,
        itemId: toolId,
        command: 'git status --short',
        text: `terminal ${String(turnIndex)}`,
        stream: 'stdout',
        truncated: false,
        updatedAt: timestamp,
      },
      approvals: [],
      presentationTruncated: false,
    }),
  }
}

function turnId(conversationIndex, turnIndex) {
  return `turn_hydration_${String(conversationIndex)}_${String(turnIndex).padStart(2, '0')}`
}

function startTurn(service, id, actionId) {
  return service.startTurn(id, {
    actionId,
    input: { type: 'text', text: `Continue ${id}` },
  })
}

function completeTurn(runtime, conversationIndex, turnCall, finalMessage) {
  runtime.emit({
    provider: 'codex',
    type: 'turn.completed',
    threadId: providerThreadId(conversationIndex),
    turnId: turnCall.providerTurnId,
    timestamp: terminalTimestamp,
    finalMessage,
  })
}

function hotConversationIds(service) {
  return service
    .snapshot()
    .conversations.map((conversation) => conversation.conversationId)
    .sort()
}

function conversationIndexes(start, end) {
  return Array.from({ length: end - start }, (_, offset) =>
    conversationId(start + offset),
  )
}

function conversationId(index) {
  return `conv_hydration_${String(index).padStart(2, '0')}`
}

function providerThreadId(index) {
  return providerThreadIdFor(conversationId(index))
}

function providerThreadIdFor(id) {
  return `provider-thread-${id}`
}

function timestampFor(conversationIndex, turnIndex) {
  return new Date(
    baseTimestamp +
      conversationIndex * 24 * 60 * 60 * 1_000 +
      turnIndex * 1_000,
  ).toISOString()
}

function deferred() {
  let resolve
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
