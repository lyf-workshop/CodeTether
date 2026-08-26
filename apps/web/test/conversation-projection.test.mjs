import assert from 'node:assert/strict'
import test from 'node:test'

import {
  TERMINAL_OUTPUT_MAX_BYTES,
  applyHostEvent,
  projectSnapshot,
} from '../../../.tmp/web-test-dist/runtime/host/conversation-projection.js'

const epoch = '1e7e3ce2-4ab2-4e80-a61d-9a6a345a7200'
const otherEpoch = '2e7e3ce2-4ab2-4e80-a61d-9a6a345a7200'
const timestamp = '2026-08-26T07:00:00.000Z'
const conversationId = 'conv_demo01'
const otherConversationId = 'conv_demo02'
const turnId = 'turn_demo01'
const itemId = 'item_demo01'

function snapshot({
  currentSeq = 0,
  status = 'running',
  approvals = [],
  includeOtherConversation = false,
} = {}) {
  return {
    protocolVersion: 1,
    epoch,
    currentSeq,
    conversations: [
      {
        conversationId,
        provider: 'codex',
        cwd: 'C:\\workspace\\agenthub',
        model: 'gpt-5',
        reasoning: 'high',
        status,
        activeTurnId: turnId,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      ...(includeOtherConversation
        ? [
            {
              conversationId: otherConversationId,
              provider: 'codex',
              cwd: 'C:\\workspace\\other',
              status: 'idle',
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          ]
        : []),
    ],
    activeTurns: [
      {
        turnId,
        conversationId,
        status: 'running',
        startedAt: timestamp,
      },
    ],
    pendingApprovals: approvals,
  }
}

function envelope(seq, type, payload, overrides = {}) {
  const eventEpoch = overrides.epoch ?? epoch
  return {
    protocolVersion: 1,
    epoch: eventEpoch,
    seq,
    eventId: `${eventEpoch}:${seq}`,
    conversationId: overrides.conversationId ?? conversationId,
    turnId: overrides.turnId ?? turnId,
    itemId: overrides.itemId ?? itemId,
    timestamp: overrides.timestamp ?? timestamp,
    type,
    payload,
  }
}

function apply(projection, event) {
  const result = applyHostEvent(projection, event)
  assert.equal(result.kind, 'applied')
  return result.projection
}

function pendingApproval(id, summary = id) {
  return {
    approvalId: id,
    conversationId,
    turnId,
    itemId,
    kind: 'command',
    summary,
    status: 'pending',
    requestedAt: timestamp,
  }
}

function resolvedApproval(id, decision = 'accept') {
  return {
    ...pendingApproval(id),
    status: 'resolved',
    decision,
    resolvedAt: timestamp,
  }
}

test('projects snapshot metadata, active Turn, and multiple approvals', () => {
  const projection = projectSnapshot(
    snapshot({
      status: 'waiting',
      approvals: [
        pendingApproval('approval_demo01', 'Run tests'),
        pendingApproval('approval_demo02', 'Write file'),
      ],
    }),
  )
  const conversation = projection.conversations[conversationId]

  assert.deepEqual(projection.cursor, { epoch, seq: 0 })
  assert.equal(conversation.title, 'agenthub')
  assert.equal(conversation.status, 'waiting')
  assert.equal(conversation.currentTurn.id, turnId)
  assert.deepEqual(
    conversation.pendingApprovals.map((approval) => approval.id),
    ['approval_demo01', 'approval_demo02'],
  )
  assert.deepEqual(conversation.messages, [])
  assert.deepEqual(conversation.tools, [])
  assert.deepEqual(conversation.changes, [])
})

test('merges deltas by Turn and Item and completion replaces without duplicating', () => {
  let projection = projectSnapshot(snapshot({ includeOtherConversation: true }))
  const untouchedConversation = projection.conversations[otherConversationId]
  const originalTools = projection.conversations[conversationId].tools

  projection = apply(
    projection,
    envelope(1, 'message.delta', { delta: 'Hello ' }),
  )
  assert.strictEqual(
    projection.conversations[otherConversationId],
    untouchedConversation,
  )
  assert.strictEqual(
    projection.conversations[conversationId].tools,
    originalTools,
  )

  projection = apply(
    projection,
    envelope(2, 'message.delta', { delta: 'world' }),
  )
  assert.equal(projection.conversations[conversationId].messages.length, 1)
  assert.equal(
    projection.conversations[conversationId].messages[0].body,
    'Hello world',
  )

  const completed = envelope(3, 'message.completed', {
    message: 'Hello world',
  })
  projection = apply(projection, completed)
  assert.deepEqual(
    projection.conversations[conversationId].messages.map((message) => ({
      body: message.body,
      status: message.status,
    })),
    [{ body: 'Hello world', status: 'completed' }],
  )

  const duplicate = applyHostEvent(projection, completed)
  assert.equal(duplicate.kind, 'duplicate')
  assert.strictEqual(duplicate.projection, projection)
})

test('projects Tool lifecycle and retains only a bounded UTF-8 terminal tail', () => {
  let projection = projectSnapshot(snapshot())
  projection = apply(
    projection,
    envelope(1, 'tool.started', {
      name: 'pnpm test',
      summary: 'C:\\workspace\\agenthub',
    }),
  )
  projection = apply(
    projection,
    envelope(2, 'tool.output', {
      output: `${'x'.repeat(TERMINAL_OUTPUT_MAX_BYTES + 64)}尾`,
      stream: 'combined',
    }),
  )

  let conversation = projection.conversations[conversationId]
  assert.equal(conversation.tools.length, 1)
  assert.equal(conversation.tools[0].status, 'running')
  assert.equal(conversation.terminal.truncated, true)
  assert.equal(conversation.terminal.text.endsWith('尾'), true)
  assert.ok(
    new TextEncoder().encode(conversation.terminal.text).byteLength <=
      TERMINAL_OUTPUT_MAX_BYTES,
  )

  const terminalBeforeCompletion = conversation.terminal.text
  projection = apply(
    projection,
    envelope(3, 'tool.completed', {
      name: 'pnpm test',
      success: true,
      summary: 'All tests passed',
    }),
  )
  conversation = projection.conversations[conversationId]
  assert.equal(conversation.tools[0].status, 'completed')
  assert.equal(conversation.tools[0].outputSummary, 'All tests passed')
  assert.equal(conversation.terminal.text, terminalBeforeCompletion)

  projection = apply(
    projection,
    envelope(
      4,
      'tool.completed',
      { name: 'failing command', success: false, summary: 'exit 1' },
      { itemId: 'item_demo02' },
    ),
  )
  assert.equal(
    projection.conversations[conversationId].tools.at(-1).status,
    'failed',
  )
})

test('creates an orphan Tool placeholder when snapshot lands during execution', () => {
  let projection = projectSnapshot(snapshot())
  projection = apply(
    projection,
    envelope(1, 'tool.output', { output: 'late output\n', stream: 'stdout' }),
  )

  const conversation = projection.conversations[conversationId]
  assert.equal(conversation.tools[0].name, 'Command execution')
  assert.equal(conversation.tools[0].status, 'running')
  assert.equal(conversation.terminal.text, 'late output\n')
})

test('parses unified file diffs, ignores headers, and upserts one shared change', () => {
  let projection = projectSnapshot(snapshot())
  const diff = [
    'diff --git a/src/example.ts b/src/example.ts',
    '--- a/src/example.ts',
    '+++ b/src/example.ts',
    '@@ -1,2 +1,3 @@',
    '-export const value = 1',
    '+// Updated',
    '+export const value = 2',
    ' export const kept = true',
  ].join('\n')
  projection = apply(
    projection,
    envelope(1, 'file.changed', {
      path: 'src/example.ts',
      kind: 'modified',
      diff,
    }),
  )

  let change = projection.conversations[conversationId].changes[0]
  assert.equal(change.additions, 2)
  assert.equal(change.deletions, 1)
  assert.deepEqual(
    change.diffLines.map((line) => [
      line.kind,
      line.oldLineNumber,
      line.newLineNumber,
      line.content,
    ]),
    [
      ['deletion', 1, undefined, 'export const value = 1'],
      ['addition', undefined, 1, '// Updated'],
      ['addition', undefined, 2, 'export const value = 2'],
      ['context', 2, 3, 'export const kept = true'],
    ],
  )

  projection = apply(
    projection,
    envelope(2, 'file.changed', {
      path: 'src/example.ts',
      kind: 'modified',
      diff: '@@ -1 +1 @@\n-old\n+new',
      additions: 9,
      deletions: 8,
    }),
  )
  change = projection.conversations[conversationId].changes[0]
  assert.equal(projection.conversations[conversationId].changes.length, 1)
  assert.equal(change.additions, 9)
  assert.equal(change.deletions, 8)
  assert.equal(change.order, 1)
})

test('tracks multiple pending approvals and returns to running after the last resolution', () => {
  let projection = projectSnapshot(snapshot())
  projection = apply(
    projection,
    envelope(1, 'approval.requested', {
      approval: pendingApproval('approval_demo01'),
    }),
  )
  projection = apply(
    projection,
    envelope(2, 'approval.requested', {
      approval: pendingApproval('approval_demo02'),
    }),
  )
  assert.equal(projection.conversations[conversationId].status, 'waiting')
  assert.equal(
    projection.conversations[conversationId].pendingApprovals.length,
    2,
  )

  projection = apply(
    projection,
    envelope(3, 'approval.resolved', {
      approval: resolvedApproval('approval_demo01'),
    }),
  )
  assert.equal(projection.conversations[conversationId].status, 'waiting')
  assert.deepEqual(
    projection.conversations[conversationId].pendingApprovals.map(
      (approval) => approval.id,
    ),
    ['approval_demo02'],
  )

  projection = apply(
    projection,
    envelope(4, 'approval.resolved', {
      approval: resolvedApproval('approval_demo02', 'decline'),
    }),
  )
  assert.equal(projection.conversations[conversationId].status, 'running')
  assert.deepEqual(
    projection.conversations[conversationId].pendingApprovals,
    [],
  )
})

test('turn completion de-duplicates finalMessage and settles running items', () => {
  let projection = projectSnapshot(snapshot())
  projection = apply(
    projection,
    envelope(1, 'message.delta', { delta: 'Done' }),
  )
  projection = apply(
    projection,
    envelope(2, 'message.completed', { message: 'Done' }),
  )
  projection = apply(
    projection,
    envelope(3, 'tool.started', { name: 'pnpm test' }),
  )
  projection = apply(
    projection,
    envelope(
      4,
      'turn.completed',
      { finalMessage: 'Done' },
      { itemId: undefined },
    ),
  )

  const conversation = projection.conversations[conversationId]
  assert.equal(conversation.status, 'completed')
  assert.equal(conversation.currentTurn.status, 'completed')
  assert.equal(conversation.messages.length, 1)
  assert.equal(conversation.messages[0].body, 'Done')
  assert.equal(conversation.tools[0].status, 'completed')
})

test('turn failure and interruption map to canonical terminal presentations', () => {
  let failed = projectSnapshot(snapshot())
  failed = apply(
    failed,
    envelope(
      1,
      'turn.failed',
      { error: { code: 'provider_error', message: 'Codex Turn failed' } },
      { itemId: undefined },
    ),
  )
  assert.equal(failed.conversations[conversationId].status, 'failed')
  assert.equal(
    failed.conversations[conversationId].currentTurn.errorMessage,
    'Codex Turn failed',
  )

  let interrupted = projectSnapshot(snapshot())
  interrupted = apply(
    interrupted,
    envelope(1, 'tool.started', { name: 'long command' }),
  )
  interrupted = apply(
    interrupted,
    envelope(
      2,
      'turn.interrupted',
      { reason: 'Stopped by user' },
      { itemId: undefined },
    ),
  )
  const conversation = interrupted.conversations[conversationId]
  assert.equal(conversation.status, 'idle')
  assert.equal(conversation.currentTurn.status, 'interrupted')
  assert.equal(conversation.currentTurn.interruptionReason, 'Stopped by user')
  assert.equal(conversation.tools[0].status, 'idle')
})

test('returns explicit reset results for stream reset and strict ordering failures', () => {
  const projection = projectSnapshot(snapshot({ currentSeq: 4 }))
  const duplicate = applyHostEvent(
    projection,
    envelope(4, 'message.delta', { delta: 'duplicate' }),
  )
  assert.equal(duplicate.kind, 'duplicate')
  assert.strictEqual(duplicate.projection, projection)

  const outOfOrder = applyHostEvent(
    projection,
    envelope(3, 'message.delta', { delta: 'old' }),
  )
  assert.equal(outOfOrder.kind, 'reset-required')
  assert.equal(outOfOrder.reason, 'out-of-order')
  assert.strictEqual(outOfOrder.projection, projection)

  const gap = applyHostEvent(
    projection,
    envelope(6, 'message.delta', { delta: 'gap' }),
  )
  assert.equal(gap.kind, 'reset-required')
  assert.equal(gap.reason, 'sequence-gap')

  const epochMismatch = applyHostEvent(
    projection,
    envelope(
      5,
      'message.delta',
      { delta: 'wrong host' },
      { epoch: otherEpoch },
    ),
  )
  assert.equal(epochMismatch.kind, 'reset-required')
  assert.equal(epochMismatch.reason, 'epoch-mismatch')

  const reset = applyHostEvent(projection, {
    protocolVersion: 1,
    epoch: otherEpoch,
    seq: 0,
    eventId: `${otherEpoch}:0`,
    conversationId: null,
    timestamp,
    type: 'stream.reset',
    payload: { reason: 'epoch_mismatch' },
  })
  assert.equal(reset.kind, 'reset-required')
  assert.equal(reset.reason, 'stream-reset')
  assert.equal(reset.streamReason, 'epoch_mismatch')
  assert.strictEqual(reset.projection, projection)
})

test('rejects a validly sequenced event that violates projection lifecycle', () => {
  const projection = projectSnapshot(snapshot())
  const result = applyHostEvent(
    projection,
    envelope(
      1,
      'message.delta',
      { delta: 'unknown conversation' },
      { conversationId: 'conv_unknown1' },
    ),
  )

  assert.equal(result.kind, 'reset-required')
  assert.equal(result.reason, 'invalid-lifecycle')
  assert.strictEqual(result.projection, projection)
})
