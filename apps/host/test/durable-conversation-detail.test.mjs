import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import {
  ConversationStore,
  DURABLE_CONVERSATION_DETAIL_DEFAULT_TURNS,
  parseDurableTurnPresentation,
  readDurableConversationDetail,
} from '../dist/persistence/index.js'
import { normalizeTrustedProjectRoot } from '../dist/project-path.js'

const conversationId = 'conv_durable_detail'
const waitingConversationId = 'conv_durable_waiting'
const projectId = 'proj_durable_detail'
const baseTimestamp = Date.parse('2026-08-27T08:00:00.000Z')

test('rebuilds the latest bounded durable Conversation detail without Provider state', () => {
  withDatabase((databasePath) => {
    const store = ConversationStore.open({ databasePath })
    const workspace = resolve(databasePath, '..', 'workspace')
    const machineId = seedProject(store, workspace)
    store.createConversation(conversation(conversationId, machineId, workspace))

    for (let index = 0; index < 25; index += 1) {
      store.createTurn(durableTurn(index))
    }
    const beforeConversation = store.getConversation(conversationId)

    const detail = readDurableConversationDetail(store, conversationId)
    assert.ok(detail)
    assert.equal(
      detail.runtime.turns.length,
      DURABLE_CONVERSATION_DETAIL_DEFAULT_TURNS,
    )
    assert.deepEqual(detail.history, {
      totalTurns: 25,
      retainedTurns: 20,
      hasOlder: true,
    })
    assert.equal(detail.runtime.history.evictedTurns, 5)
    assert.equal(detail.runtime.history.truncated, true)
    assert.equal(detail.runtime.turns[0].input.text, 'User prompt 5')
    assert.equal(detail.runtime.turns.at(-1).input.text, 'User prompt 24')
    assert.equal(detail.runtime.turns.at(-1).finalMessage, 'Agent result 24')
    assert.equal(detail.runtime.messages.length, 20)
    assert.equal(detail.runtime.messages[0].text, 'Agent message 5')
    assert.equal(detail.runtime.tools.length, 20)
    assert.equal(detail.runtime.tools.at(-1).name, 'Tool 24')
    assert.equal(detail.runtime.changes.length, 20)
    assert.equal(detail.runtime.changes.at(-1).path, 'src/example-24.ts')
    assert.equal(detail.runtime.terminal.text, 'terminal output 24')
    assert.equal(detail.approvals.length, 2)
    assert.deepEqual(
      detail.approvals.map((approval) => approval.lifecycle),
      ['resolved', 'expired'],
    )
    assert.ok(!('providerThreadId' in detail))
    assert.deepEqual(store.getConversation(conversationId), beforeConversation)
    assert.equal(store.countTurns(conversationId), 25)

    const narrow = readDurableConversationDetail(store, conversationId, {
      maxTurns: 2,
      maxEntries: 2,
    })
    assert.ok(narrow)
    assert.deepEqual(narrow.history, {
      totalTurns: 25,
      retainedTurns: 2,
      hasOlder: true,
    })
    assert.deepEqual(
      narrow.runtime.turns.map((turn) => turn.input.text),
      ['User prompt 23', 'User prompt 24'],
    )
    assert.equal(narrow.runtime.history.truncated, true)

    assert.equal(
      readDurableConversationDetail(store, 'conv_durable_missing'),
      undefined,
    )
    assert.throws(
      () =>
        readDurableConversationDetail(store, conversationId, { maxTurns: 0 }),
      /maxTurns must be a positive safe integer/,
    )
    assert.throws(
      () =>
        readDurableConversationDetail(store, conversationId, {
          maxTurns: 65,
        }),
      /maxTurns must not exceed 64/,
    )
    assert.throws(
      () =>
        readDurableConversationDetail(store, conversationId, {
          maxEntries: 2049,
        }),
      /maxEntries must not exceed 2048/,
    )
    store.close()
  })
})

test('restores an active durable Turn and pending Approval without reconciling it', () => {
  withDatabase((databasePath) => {
    const store = ConversationStore.open({ databasePath })
    const workspace = resolve(databasePath, '..', 'workspace')
    const machineId = seedProject(store, workspace)
    store.createConversation(
      conversation(waitingConversationId, machineId, workspace, {
        status: 'waiting',
      }),
    )
    const timestamp = timestampFor(0)
    const turnId = 'turn_durable_waiting'
    const itemId = 'item_durable_waiting_tool'
    const turn = {
      turnId,
      conversationId: waitingConversationId,
      status: 'running',
      input: { type: 'text', text: 'Await approval', timestamp },
      startedAt: timestamp,
    }
    const approval = {
      record: {
        approvalId: 'approval_durable_waiting',
        conversationId: waitingConversationId,
        turnId,
        itemId,
        kind: 'command',
        summary: 'Run a safe command',
        status: 'pending',
        requestedAt: timestamp,
      },
      lifecycle: 'pending',
    }
    store.createTurn({
      turnId,
      conversationId: waitingConversationId,
      providerTurnId: 'provider-turn-durable-waiting',
      input: turn.input,
      status: 'waiting',
      startedAt: timestamp,
      snapshotVersion: 1,
      snapshot: parseDurableTurnPresentation({
        turn,
        messages: [],
        tools: [
          {
            turnId,
            itemId,
            name: 'Run safe command',
            status: 'running',
            startedAt: timestamp,
            order: 1,
          },
        ],
        changes: [],
        approvals: [approval],
        presentationTruncated: false,
      }),
    })

    const detail = readDurableConversationDetail(store, waitingConversationId)
    assert.ok(detail)
    assert.equal(detail.record.status, 'waiting')
    assert.equal(detail.record.activeTurnId, turnId)
    assert.equal(detail.runtime.turns[0].status, 'running')
    assert.equal(
      detail.approvals[0].record.approvalId,
      approval.record.approvalId,
    )
    assert.equal(detail.approvals[0].lifecycle, 'pending')
    assert.equal(store.getTurn(turnId).status, 'waiting')
    assert.equal(store.getConversation(waitingConversationId).status, 'waiting')
    store.close()
  })
})

test('keeps failed local history readable without a Provider Thread identity', () => {
  withDatabase((databasePath) => {
    const store = ConversationStore.open({ databasePath })
    const workspace = resolve(databasePath, '..', 'workspace')
    const machineId = seedProject(store, workspace)
    const failedConversationId = 'conv_durable_no_provider'
    store.createConversation(
      conversation(failedConversationId, machineId, workspace, {
        providerThreadId: undefined,
        status: 'failed',
      }),
    )

    const detail = readDurableConversationDetail(store, failedConversationId)
    assert.ok(detail)
    assert.equal(detail.record.status, 'failed')
    assert.deepEqual(detail.runtime.turns, [])
    assert.deepEqual(detail.history, {
      totalTurns: 0,
      retainedTurns: 0,
      hasOlder: false,
    })
    store.close()
  })
})

function durableTurn(index) {
  const suffix = String(index).padStart(2, '0')
  const turnId = `turn_durable_detail_${suffix}`
  const messageItemId = `item_durable_message_${suffix}`
  const toolItemId = `item_durable_tool_${suffix}`
  const timestamp = timestampFor(index)
  const turn = {
    turnId,
    conversationId,
    status: 'completed',
    input: { type: 'text', text: `User prompt ${String(index)}`, timestamp },
    startedAt: timestamp,
    completedAt: timestamp,
    finalMessage: `Agent result ${String(index)}`,
  }
  return {
    turnId,
    conversationId,
    providerTurnId: `provider-turn-${suffix}`,
    input: turn.input,
    status: 'completed',
    startedAt: timestamp,
    completedAt: timestamp,
    snapshotVersion: 1,
    snapshot: parseDurableTurnPresentation({
      turn,
      messages: [
        {
          turnId,
          itemId: messageItemId,
          text: `Agent message ${String(index)}`,
          status: 'completed',
          timestamp,
          order: 1,
        },
      ],
      tools: [
        {
          turnId,
          itemId: toolItemId,
          name: `Tool ${String(index)}`,
          status: 'completed',
          success: true,
          startedAt: timestamp,
          completedAt: timestamp,
          order: 2,
        },
      ],
      changes: [
        {
          turnId,
          itemId: toolItemId,
          path: `src/example-${String(index)}.ts`,
          kind: 'modified',
          diff: `+// change ${String(index)}`,
          additions: 1,
          deletions: 0,
          timestamp,
          order: 3,
        },
      ],
      terminal: {
        turnId,
        itemId: toolItemId,
        command: `echo ${String(index)}`,
        text: `terminal output ${String(index)}`,
        stream: 'stdout',
        truncated: false,
        updatedAt: timestamp,
      },
      approvals: approvalsFor(index, turnId, toolItemId, timestamp),
      presentationTruncated: false,
    }),
  }
}

function approvalsFor(index, turnId, itemId, timestamp) {
  if (index === 0) {
    return [expiredApproval(index, turnId, itemId, timestamp)]
  }
  if (index === 23) {
    return [
      {
        record: {
          approvalId: 'approval_durable_resolved',
          conversationId,
          turnId,
          itemId,
          kind: 'command',
          summary: 'Run accepted command',
          status: 'resolved',
          decision: 'accept',
          requestedAt: timestamp,
          resolvedAt: timestamp,
        },
        lifecycle: 'resolved',
      },
    ]
  }
  return index === 24 ? [expiredApproval(index, turnId, itemId, timestamp)] : []
}

function expiredApproval(index, turnId, itemId, timestamp) {
  return {
    record: {
      approvalId: `approval_durable_expired_${String(index)}`,
      conversationId,
      turnId,
      itemId,
      kind: 'command',
      summary: 'Expired command',
      status: 'pending',
      requestedAt: timestamp,
    },
    lifecycle: 'expired',
    expiredAt: timestamp,
    reason: 'host_restart',
  }
}

function seedProject(store, workspace) {
  const root = normalizeTrustedProjectRoot(workspace)
  const timestamp = timestampFor(0)
  const machineId = store.listMachines()[0].machineId
  store.createProject({
    projectId,
    name: 'Durable Detail',
    location: {
      projectId,
      machineId,
      rootPath: root.rootPath,
      rootPathKey: root.rootPathKey,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  return machineId
}

function conversation(id, machineId, cwd, overrides = {}) {
  const timestamp = timestampFor(0)
  return {
    conversationId: id,
    projectId,
    machineId,
    title: 'Durable Detail',
    provider: 'codex',
    providerThreadId: `provider-thread-${id}`,
    cwd,
    model: 'gpt-5.6-sol',
    reasoning: 'medium',
    status: 'completed',
    createdAt: timestamp,
    updatedAt: timestamp,
    lastActivityAt: timestamp,
    ...overrides,
  }
}

function timestampFor(index) {
  return new Date(baseTimestamp + index * 1_000).toISOString()
}

function withDatabase(run) {
  const directory = mkdtempSync(join(tmpdir(), 'codetether-detail-'))
  const databasePath = join(directory, 'codetether.sqlite3')
  try {
    run(databasePath)
  } finally {
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    })
  }
}
