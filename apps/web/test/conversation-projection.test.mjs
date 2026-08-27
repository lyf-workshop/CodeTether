import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MESSAGE_OUTPUT_MAX_BYTES,
  TERMINAL_OUTPUT_MAX_BYTES,
  applyHostEvent,
  includeConversationDetail,
  projectConversationDetail,
  projectSnapshot,
} from '../.tmp/test-dist/runtime/host/conversation-projection.js'

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

function snapshotWithRuntime({
  currentSeq = 0,
  status = 'idle',
  turns = [],
  messages = [],
  tools = [],
  changes = [],
  terminal = { text: '', truncated: false },
  history = {
    evictedTurns: 0,
    evictedMessages: 0,
    evictedTools: 0,
    evictedChanges: 0,
    truncated: false,
  },
  approvals = [],
} = {}) {
  const running = turns.find((turn) => turn.status === 'running')
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
        ...(running === undefined ? {} : { activeTurnId: running.turnId }),
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    activeTurns: running === undefined ? [] : [running],
    pendingApprovals: approvals,
    conversationRuntimes: [
      {
        conversationId,
        turns,
        messages,
        tools,
        changes,
        terminal,
        history,
      },
    ],
  }
}

function runningTurn(id, text) {
  return {
    turnId: id,
    conversationId,
    status: 'running',
    input: { type: 'text', text, timestamp },
    startedAt: timestamp,
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

function coldDetail(title = 'Host-owned durable title') {
  return {
    protocolVersion: 1,
    conversation: {
      conversationId: 'conv_cold01',
      projectId: 'proj_cold01',
      title,
      provider: 'codex',
      status: 'idle',
      createdAt: timestamp,
      updatedAt: timestamp,
      lastActivityAt: timestamp,
    },
    runtime: {
      conversationId: 'conv_cold01',
      turns: [],
      messages: [],
      tools: [],
      changes: [],
      terminal: { text: '', truncated: false },
      history: {
        evictedTurns: 0,
        evictedMessages: 0,
        evictedTools: 0,
        evictedChanges: 0,
        truncated: false,
      },
    },
    history: {
      hasOlderHistory: false,
      retainedTurnCount: 0,
      totalTurnCount: 0,
    },
    pendingApprovals: [],
    approvalHistory: [],
  }
}

test('projects the Host-owned title instead of deriving it from cwd', () => {
  const hostSnapshot = snapshot()
  hostSnapshot.conversations[0].title = 'Host canonical title'

  assert.equal(
    projectSnapshot(hostSnapshot).conversations[conversationId].title,
    'Host canonical title',
  )
})

test('projects and injects a zero-Turn cold durable detail without a cwd', () => {
  const detail = coldDetail()
  const conversation = projectConversationDetail(detail)
  assert.equal(conversation.title, 'Host-owned durable title')
  assert.equal(conversation.cwd, undefined)
  assert.deepEqual(conversation.turns, [])
  assert.deepEqual(conversation.messages, [])

  const projection = {
    cursor: { epoch, seq: 17 },
    conversations: {},
  }
  const included = includeConversationDetail(projection, detail)
  assert.equal(included.cursor, projection.cursor)
  assert.equal(
    included.conversations.conv_cold01.title,
    'Host-owned durable title',
  )
})

test('refreshes a first-Turn Host title without replacing live Timeline state', () => {
  const projection = projectSnapshot(snapshotWithRuntime())
  const existing = projection.conversations[conversationId]
  const detail = {
    ...coldDetail('实现 WebSocket 自动重连'),
    conversation: {
      ...coldDetail().conversation,
      conversationId,
      projectId: 'proj_demo01',
      title: '实现 WebSocket 自动重连',
    },
    runtime: {
      ...coldDetail().runtime,
      conversationId,
    },
  }
  const updated = includeConversationDetail(projection, detail)

  assert.equal(
    updated.conversations[conversationId].title,
    '实现 WebSocket 自动重连',
  )
  assert.strictEqual(
    updated.conversations[conversationId].turns,
    existing.turns,
  )
  assert.strictEqual(
    updated.conversations[conversationId].messages,
    existing.messages,
  )
})

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
  assert.deepEqual(conversation.history, {
    evictedTurns: 0,
    evictedMessages: 0,
    evictedTools: 0,
    evictedChanges: 0,
    truncated: false,
  })
})

test('projects explicit Host runtime eviction metadata', () => {
  const projection = projectSnapshot(
    snapshotWithRuntime({
      history: {
        evictedTurns: 2,
        evictedMessages: 4,
        evictedTools: 3,
        evictedChanges: 1,
        truncated: true,
      },
    }),
  )

  assert.deepEqual(projection.conversations[conversationId].history, {
    evictedTurns: 2,
    evictedMessages: 4,
    evictedTools: 3,
    evictedChanges: 1,
    truncated: true,
  })
})

test('extended snapshot and equivalent live events produce the same Turn history', () => {
  const input = {
    type: 'text',
    text: 'Inspect the repository',
    timestamp,
  }
  const completedTurn = {
    turnId,
    conversationId,
    status: 'completed',
    input,
    startedAt: timestamp,
    completedAt: timestamp,
    finalMessage: 'Repository is clean',
  }
  const finalSnapshot = snapshotWithRuntime({
    currentSeq: 8,
    status: 'completed',
    turns: [completedTurn],
    messages: [
      {
        turnId,
        itemId,
        text: 'Repository is clean',
        status: 'completed',
        timestamp,
        order: 2,
      },
    ],
    tools: [
      {
        turnId,
        itemId: 'item_tool01',
        name: 'command',
        command: 'git status --short',
        summary: 'C:\\workspace\\agenthub',
        status: 'completed',
        success: true,
        outputSummary: ' M src/example.ts\n',
        startedAt: timestamp,
        completedAt: timestamp,
        order: 4,
      },
    ],
    changes: [
      {
        turnId,
        itemId: 'item_change01',
        path: 'src/example.ts',
        kind: 'modified',
        diff: '@@ -1 +1 @@\n-old\n+new',
        timestamp,
        order: 7,
      },
    ],
    terminal: {
      turnId,
      itemId: 'item_tool01',
      command: 'git status --short',
      text: ' M src/example.ts\n',
      stream: 'combined',
      truncated: false,
      updatedAt: timestamp,
    },
  })

  let live = projectSnapshot(snapshotWithRuntime())
  live = apply(
    live,
    envelope(
      1,
      'turn.started',
      {
        turn: {
          turnId,
          conversationId,
          status: 'running',
          input,
          startedAt: timestamp,
        },
      },
      { itemId: undefined },
    ),
  )
  live = apply(live, envelope(2, 'message.delta', { delta: 'Repository ' }))
  live = apply(
    live,
    envelope(3, 'message.completed', { message: 'Repository is clean' }),
  )
  live = apply(
    live,
    envelope(
      4,
      'tool.started',
      {
        name: 'command',
        command: 'git status --short',
        summary: 'C:\\workspace\\agenthub',
      },
      { itemId: 'item_tool01' },
    ),
  )
  live = apply(
    live,
    envelope(
      5,
      'tool.output',
      { output: ' M src/example.ts\n', stream: 'combined' },
      { itemId: 'item_tool01' },
    ),
  )
  live = apply(
    live,
    envelope(
      6,
      'tool.completed',
      {
        name: 'command',
        command: 'git status --short',
        success: true,
        summary: ' M src/example.ts\n',
      },
      { itemId: 'item_tool01' },
    ),
  )
  live = apply(
    live,
    envelope(
      7,
      'file.changed',
      {
        path: 'src/example.ts',
        kind: 'modified',
        diff: '@@ -1 +1 @@\n-old\n+new',
      },
      { itemId: 'item_change01' },
    ),
  )
  live = apply(
    live,
    envelope(
      8,
      'turn.completed',
      { finalMessage: 'Repository is clean' },
      { itemId: undefined },
    ),
  )

  assert.deepEqual(
    live.conversations[conversationId],
    projectSnapshot(finalSnapshot).conversations[conversationId],
  )
  assert.deepEqual(
    live.conversations[conversationId].messages.map((message) => [
      message.author,
      message.body,
    ]),
    [
      ['user', 'Inspect the repository'],
      ['agent', 'Repository is clean'],
    ],
  )
})

test('starting a second Turn preserves the first Turn and its ordered Items', () => {
  const secondTurnId = 'turn_demo02'
  let projection = projectSnapshot(snapshotWithRuntime())
  projection = apply(
    projection,
    envelope(
      1,
      'turn.started',
      { turn: runningTurn(turnId, 'First prompt') },
      { itemId: undefined },
    ),
  )
  projection = apply(
    projection,
    envelope(2, 'message.completed', { message: 'First answer' }),
  )
  projection = apply(
    projection,
    envelope(
      3,
      'turn.completed',
      { finalMessage: 'First answer' },
      { itemId: undefined },
    ),
  )
  projection = apply(
    projection,
    envelope(
      4,
      'turn.started',
      { turn: runningTurn(secondTurnId, 'Second prompt') },
      { turnId: secondTurnId, itemId: undefined },
    ),
  )
  projection = apply(
    projection,
    envelope(
      5,
      'tool.started',
      { name: 'pnpm test' },
      { turnId: secondTurnId, itemId: 'item_tool02' },
    ),
  )
  projection = apply(
    projection,
    envelope(
      6,
      'tool.completed',
      { name: 'pnpm test', success: true, summary: 'passed' },
      { turnId: secondTurnId, itemId: 'item_tool02' },
    ),
  )

  const conversation = projection.conversations[conversationId]
  assert.deepEqual(
    conversation.turns.map((turn) => turn.id),
    [turnId, secondTurnId],
  )
  assert.deepEqual(
    conversation.messages.map((message) => [
      message.turnId,
      message.author,
      message.body,
    ]),
    [
      [turnId, 'user', 'First prompt'],
      [turnId, 'agent', 'First answer'],
      [secondTurnId, 'user', 'Second prompt'],
    ],
  )
  assert.equal(conversation.tools[0].turnId, secondTurnId)
  assert.equal(conversation.currentTurn.id, secondTurnId)
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

test('bounds streamed and completed Agent messages without breaking UTF-8', () => {
  let projection = projectSnapshot(snapshot())
  projection = apply(
    projection,
    envelope(1, 'message.delta', {
      delta: `${'x'.repeat(MESSAGE_OUTPUT_MAX_BYTES - 1)}浣?`,
    }),
  )
  projection = apply(
    projection,
    envelope(2, 'message.delta', { delta: 'ignored tail' }),
  )

  let message = projection.conversations[conversationId].messages[0]
  assert.ok(
    new TextEncoder().encode(message.body).byteLength <=
      MESSAGE_OUTPUT_MAX_BYTES,
  )
  assert.equal(message.body.includes('\uFFFD'), false)

  projection = apply(
    projection,
    envelope(3, 'message.completed', {
      message: `${'y'.repeat(MESSAGE_OUTPUT_MAX_BYTES - 1)}鐣?`,
    }),
  )
  message = projection.conversations[conversationId].messages[0]
  assert.ok(
    new TextEncoder().encode(message.body).byteLength <=
      MESSAGE_OUTPUT_MAX_BYTES,
  )
  assert.equal(message.body.includes('\uFFFD'), false)
  assert.equal(message.status, 'completed')
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

  projection = apply(
    projection,
    envelope(3, 'file.changed', {
      path: 'src/second.ts',
      kind: 'modified',
      diff: '@@ -1 +1 @@\n-before\n+after',
    }),
  )
  assert.deepEqual(
    projection.conversations[conversationId].changes.map((entry) => [
      entry.path,
      entry.order,
    ]),
    [
      ['src/example.ts', 1],
      ['src/second.ts', 3],
    ],
  )
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

test('a terminal final message produces the same single Agent Item live and from Snapshot', () => {
  let live = projectSnapshot(snapshot())
  live = apply(live, envelope(1, 'message.delta', { delta: 'partial' }))
  live = apply(
    live,
    envelope(
      2,
      'turn.completed',
      { finalMessage: 'authoritative final' },
      { itemId: undefined },
    ),
  )

  const restored = projectSnapshot(
    snapshotWithRuntime({
      currentSeq: 2,
      status: 'completed',
      turns: [
        {
          ...runningTurn(turnId, 'Summarize safely'),
          status: 'completed',
          completedAt: timestamp,
          finalMessage: 'authoritative final',
        },
      ],
      messages: [
        {
          turnId,
          itemId,
          text: 'authoritative final',
          status: 'completed',
          timestamp,
          order: 1,
        },
      ],
    }),
  )

  assert.deepEqual(
    live.conversations[conversationId].messages.filter(
      (message) => message.author === 'agent',
    ),
    restored.conversations[conversationId].messages.filter(
      (message) => message.author === 'agent',
    ),
  )
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
  assert.equal(conversation.tools[0].status, 'idle')

  const restored = projectSnapshot(
    snapshotWithRuntime({
      currentSeq: 2,
      status: 'idle',
      turns: [
        {
          ...runningTurn(turnId, 'Run safely'),
          status: 'interrupted',
          completedAt: timestamp,
        },
      ],
    }),
  ).conversations[conversationId]
  assert.equal(restored.status, conversation.status)
  assert.equal(restored.currentTurn.status, conversation.currentTurn.status)
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

test('Attention events advance the cursor without changing Conversation state', () => {
  const projection = projectSnapshot(snapshot())
  const conversations = projection.conversations
  const conversation = conversations[conversationId]
  const attentionConversationId = 'conv_coldattention01'
  const attentionTurnId = 'turn_coldattention01'
  const attentionBase = {
    attentionId: 'attn_demo01',
    projectId: 'proj_demo01',
    conversationId: attentionConversationId,
    turnId: attentionTurnId,
    type: 'completed_review',
    status: 'open',
    createdAt: timestamp,
    updatedAt: timestamp,
    payload: { conversationTitle: 'Durable cold Conversation' },
  }

  const created = applyHostEvent(
    projection,
    envelope(
      1,
      'attention.created',
      { attention: attentionBase },
      {
        conversationId: attentionConversationId,
        turnId: attentionTurnId,
        itemId: undefined,
      },
    ),
  )
  assert.equal(created.kind, 'applied')
  assert.deepEqual(created.projection.cursor, { epoch, seq: 1 })
  assert.strictEqual(created.projection.conversations, conversations)
  assert.strictEqual(
    created.projection.conversations[conversationId],
    conversation,
  )

  const resolvedAt = '2026-08-26T07:01:00.000Z'
  const resolved = applyHostEvent(
    created.projection,
    envelope(
      2,
      'attention.resolved',
      {
        attention: {
          ...attentionBase,
          status: 'resolved',
          updatedAt: resolvedAt,
          resolvedAt,
        },
      },
      {
        conversationId: attentionConversationId,
        turnId: attentionTurnId,
        itemId: undefined,
        timestamp: resolvedAt,
      },
    ),
  )
  assert.equal(resolved.kind, 'applied')
  assert.deepEqual(resolved.projection.cursor, { epoch, seq: 2 })
  assert.strictEqual(resolved.projection.conversations, conversations)
  assert.strictEqual(
    resolved.projection.conversations[conversationId],
    conversation,
  )
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
