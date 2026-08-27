import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BootstrapSchema,
  ConversationIdSchema,
  ConversationRecordSchema,
  ConversationRuntimeSnapshotSchema,
  CreateConversationRequestSchema,
  CreateConversationResponseSchema,
  EventIdSchema,
  HostEventEnvelopeSchema,
  HostEventSchema,
  HostSnapshotSchema,
  InterruptTurnRequestSchema,
  ResolveApprovalRequestSchema,
  SafeErrorEnvelopeSchema,
  StartTurnRequestSchema,
  TurnRecordSchema,
  conversationRuntimeWireLimits,
  formatLastEventId,
  hostEventTypes,
  parseLastEventId,
  protocolVersion,
} from '../dist/index.js'

const epoch = '11111111-1111-4111-8111-111111111111'
const conversationId = 'conv_demo01'
const actionId = 'act_action01'
const turnId = 'turn_demo01'
const itemId = 'item_demo01'
const approvalId = 'approval_demo01'
const timestamp = '2026-08-26T08:00:00.000Z'

const conversation = {
  conversationId,
  provider: 'codex',
  cwd: 'C:\\workspace\\demo',
  model: 'gpt-5',
  reasoning: 'high',
  status: 'running',
  activeTurnId: turnId,
  createdAt: timestamp,
  updatedAt: timestamp,
}

const runningTurn = {
  turnId,
  conversationId,
  status: 'running',
  startedAt: timestamp,
}

const runningTurnWithInput = {
  ...runningTurn,
  input: {
    type: 'text',
    text: 'Inspect the workspace safely.',
    timestamp,
  },
}

const conversationRuntime = {
  conversationId,
  turns: [runningTurnWithInput],
  messages: [
    {
      turnId,
      itemId: 'item_message01',
      text: 'I will inspect the workspace.',
      status: 'completed',
      timestamp,
      order: 1,
    },
  ],
  tools: [
    {
      turnId,
      itemId,
      name: 'command',
      command: 'git status --short',
      summary: 'Inspect the Git working tree',
      status: 'completed',
      success: true,
      outputSummary: 'M src/example.ts',
      startedAt: timestamp,
      completedAt: timestamp,
      order: 2,
    },
  ],
  changes: [
    {
      turnId,
      itemId,
      path: 'src/example.ts',
      kind: 'modified',
      additions: 1,
      deletions: 0,
      timestamp,
      order: 3,
    },
  ],
  terminal: {
    turnId,
    itemId,
    command: 'git status --short',
    text: 'M src/example.ts\n',
    stream: 'stdout',
    truncated: false,
    updatedAt: timestamp,
  },
  history: {
    evictedTurns: 0,
    evictedMessages: 0,
    evictedTools: 0,
    evictedChanges: 0,
    truncated: false,
  },
}

const pendingApproval = {
  approvalId,
  conversationId,
  turnId,
  itemId,
  kind: 'command',
  summary: 'Run a safe command',
  status: 'pending',
  requestedAt: timestamp,
}

const resolvedApproval = {
  ...pendingApproval,
  status: 'resolved',
  decision: 'accept',
  resolvedAt: timestamp,
}

test('accepts only CodeTether Conversation IDs and excludes provider IDs', () => {
  assert.equal(ConversationIdSchema.safeParse(conversationId).success, true)
  assert.equal(
    ConversationIdSchema.safeParse('thread-provider-123').success,
    false,
  )
  assert.equal(
    ConversationRecordSchema.safeParse({
      ...conversation,
      providerThreadId: 'thread-provider-123',
    }).success,
    false,
  )
})

test('validates bootstrap and snapshot as separate wire records', () => {
  const bootstrap = {
    protocolVersion,
    hostVersion: '0.0.0',
    epoch,
    capabilities: {
      codex: true,
      approvals: true,
      interrupt: true,
      resume: true,
      diff: true,
      streaming: true,
    },
  }
  assert.deepEqual(BootstrapSchema.parse(bootstrap), bootstrap)
  assert.equal(
    BootstrapSchema.safeParse({ ...bootstrap, snapshot: {} }).success,
    false,
  )

  const snapshot = {
    protocolVersion,
    epoch,
    currentSeq: 0,
    conversations: [{ ...conversation, status: 'waiting' }],
    activeTurns: [runningTurn],
    pendingApprovals: [pendingApproval],
  }
  assert.deepEqual(HostSnapshotSchema.parse(snapshot), snapshot)
  assert.equal(
    HostSnapshotSchema.parse(snapshot).conversationRuntimes,
    undefined,
    'the accepted Phase 2B Snapshot remains valid without runtime history',
  )
  assert.equal(
    HostSnapshotSchema.safeParse({
      ...snapshot,
      activeTurns: [
        {
          ...runningTurn,
          status: 'completed',
          completedAt: timestamp,
        },
      ],
    }).success,
    false,
  )
  assert.equal(
    HostSnapshotSchema.safeParse({
      ...snapshot,
      conversations: [
        { ...conversation, status: 'waiting' },
        { ...conversation, status: 'waiting' },
      ],
    }).success,
    false,
  )
  assert.equal(
    HostSnapshotSchema.safeParse({
      ...snapshot,
      pendingApprovals: [{ ...pendingApproval, turnId: 'turn_missing01' }],
    }).success,
    false,
  )
})

test('adds Host-owned Turn input without invalidating legacy Turn records', () => {
  assert.deepEqual(TurnRecordSchema.parse(runningTurn), runningTurn)
  assert.deepEqual(
    TurnRecordSchema.parse(runningTurnWithInput),
    runningTurnWithInput,
  )
  assert.equal(
    TurnRecordSchema.safeParse({
      ...runningTurn,
      input: { type: 'text', text: '   ', timestamp },
    }).success,
    false,
  )
  assert.equal(
    TurnRecordSchema.safeParse({
      ...runningTurn,
      input: { type: 'text', text: 'hello' },
    }).success,
    false,
  )
})

test('validates a complete additive Conversation runtime Snapshot', () => {
  assert.deepEqual(
    ConversationRuntimeSnapshotSchema.parse(conversationRuntime),
    conversationRuntime,
  )

  const snapshot = {
    protocolVersion,
    epoch,
    currentSeq: 3,
    conversations: [{ ...conversation, status: 'waiting' }],
    activeTurns: [runningTurnWithInput],
    pendingApprovals: [pendingApproval],
    conversationRuntimes: [conversationRuntime],
  }
  assert.deepEqual(HostSnapshotSchema.parse(snapshot), snapshot)

  const multiPathRuntime = {
    ...conversationRuntime,
    changes: [
      conversationRuntime.changes[0],
      {
        ...conversationRuntime.changes[0],
        path: 'src/second.ts',
        order: conversationRuntime.changes[0].order + 1,
      },
    ],
  }
  assert.deepEqual(
    ConversationRuntimeSnapshotSchema.parse(multiPathRuntime),
    multiPathRuntime,
  )
})

test('rejects runtime history with invalid ownership or duplicate identity', () => {
  assert.equal(
    ConversationRuntimeSnapshotSchema.safeParse({
      ...conversationRuntime,
      turns: [{ ...conversationRuntime.turns[0], input: undefined }],
    }).success,
    false,
  )
  assert.equal(
    ConversationRuntimeSnapshotSchema.safeParse({
      ...conversationRuntime,
      messages: [
        {
          ...conversationRuntime.messages[0],
          turnId: 'turn_missing01',
        },
      ],
    }).success,
    false,
  )
  assert.equal(
    ConversationRuntimeSnapshotSchema.safeParse({
      ...conversationRuntime,
      tools: [
        {
          ...conversationRuntime.tools[0],
          itemId: conversationRuntime.messages[0].itemId,
        },
      ],
    }).success,
    false,
  )
  assert.equal(
    ConversationRuntimeSnapshotSchema.safeParse({
      ...conversationRuntime,
      tools: [{ ...conversationRuntime.tools[0], order: 1 }],
    }).success,
    false,
  )
  assert.equal(
    ConversationRuntimeSnapshotSchema.safeParse({
      ...conversationRuntime,
      terminal: {
        ...conversationRuntime.terminal,
        itemId: 'item_missing01',
      },
    }).success,
    false,
  )
})

test('requires one consistent runtime record per Snapshot Conversation', () => {
  const snapshot = {
    protocolVersion,
    epoch,
    currentSeq: 3,
    conversations: [
      { ...conversation, status: 'waiting' },
      {
        ...conversation,
        conversationId: 'conv_other01',
        status: 'idle',
        activeTurnId: undefined,
      },
    ],
    activeTurns: [runningTurnWithInput],
    pendingApprovals: [pendingApproval],
    conversationRuntimes: [conversationRuntime],
  }
  assert.equal(HostSnapshotSchema.safeParse(snapshot).success, false)

  assert.equal(
    HostSnapshotSchema.safeParse({
      ...snapshot,
      conversations: [{ ...conversation, status: 'waiting' }],
      activeTurns: [runningTurn],
    }).success,
    false,
    'the top-level active Turn and retained runtime Turn cannot disagree',
  )

  assert.equal(
    HostSnapshotSchema.safeParse({
      ...snapshot,
      conversations: [{ ...conversation, status: 'waiting' }],
      conversationRuntimes: [
        {
          ...conversationRuntime,
          turns: [],
          messages: [],
          tools: [],
          changes: [],
          terminal: { text: '', truncated: false },
        },
      ],
    }).success,
    false,
    'a pending Approval cannot reference a Turn absent from runtime history',
  )
})

test('makes runtime eviction and terminal truncation explicit and bounded', () => {
  assert.equal(
    ConversationRuntimeSnapshotSchema.safeParse({
      ...conversationRuntime,
      history: {
        ...conversationRuntime.history,
        evictedTools: 1,
      },
    }).success,
    false,
  )
  assert.equal(
    ConversationRuntimeSnapshotSchema.safeParse({
      ...conversationRuntime,
      terminal: {
        ...conversationRuntime.terminal,
        truncated: true,
      },
    }).success,
    false,
  )
  assert.equal(
    ConversationRuntimeSnapshotSchema.safeParse({
      ...conversationRuntime,
      terminal: {
        ...conversationRuntime.terminal,
        text: '💡'.repeat(
          Math.floor(conversationRuntimeWireLimits.terminalBytes / 4) + 1,
        ),
      },
    }).success,
    false,
  )
})

test('keeps route identity out of mutation request bodies', () => {
  assert.deepEqual(
    CreateConversationRequestSchema.parse({
      actionId,
      provider: 'codex',
      cwd: 'C:\\workspace\\demo',
      model: 'gpt-5',
      reasoning: 'high',
    }).actionId,
    actionId,
  )
  assert.equal(
    CreateConversationRequestSchema.safeParse({
      actionId,
      provider: 'codex',
      cwd: 'C:\\workspace\\demo',
      title: 'Not part of v1',
    }).success,
    false,
  )

  const exactText = '  preserve this input exactly  '
  const start = StartTurnRequestSchema.parse({
    actionId,
    input: { type: 'text', text: exactText },
  })
  assert.equal(start.input.text, exactText)
  assert.equal(
    StartTurnRequestSchema.safeParse({
      actionId,
      conversationId,
      input: { type: 'text', text: 'hello' },
    }).success,
    false,
  )
  assert.equal(
    InterruptTurnRequestSchema.safeParse({ actionId, turnId }).success,
    false,
  )
  assert.equal(
    ResolveApprovalRequestSchema.safeParse({ actionId, decision: 'allow' })
      .success,
    false,
  )
  assert.equal(
    ResolveApprovalRequestSchema.safeParse({ actionId, decision: 'decline' })
      .success,
    true,
  )
})

test('separates mutation success and safe HTTP error envelopes', () => {
  const success = {
    protocolVersion,
    actionId,
    status: 'completed',
    data: { conversation },
  }
  assert.deepEqual(CreateConversationResponseSchema.parse(success), success)
  assert.equal(
    CreateConversationResponseSchema.safeParse({
      protocolVersion,
      actionId,
      code: 'conflict',
      message: 'Already exists',
    }).success,
    false,
  )

  const safeError = {
    protocolVersion,
    actionId,
    code: 'provider_error',
    message: 'The provider rejected the operation',
    details: { method: 'turn/start' },
  }
  assert.deepEqual(SafeErrorEnvelopeSchema.parse(safeError), safeError)
  assert.equal(
    SafeErrorEnvelopeSchema.safeParse({
      ...safeError,
      code: 'provider_conversation_unavailable',
    }).success,
    true,
  )
  assert.equal(
    SafeErrorEnvelopeSchema.safeParse({ ...safeError, stack: 'secret stack' })
      .success,
    false,
  )
})

test('formats and parses the shared epoch and sequence event identity', () => {
  const eventId = formatLastEventId({ epoch, seq: 42 })
  assert.equal(eventId, `${epoch}:42`)
  assert.deepEqual(parseLastEventId(eventId), { epoch, seq: 42 })
  const emptyCursor = formatLastEventId({ epoch, seq: 0 })
  assert.deepEqual(parseLastEventId(emptyCursor), { epoch, seq: 0 })
  assert.equal(parseLastEventId('not-an-epoch:1'), null)
  assert.equal(
    EventIdSchema.safeParse(`${epoch}:9007199254740992`).success,
    false,
  )
})

test('accepts exactly the v1 HostEvent variants', () => {
  const events = createHostEventFixtures()
  assert.deepEqual(
    events.map((event) => event.type),
    [...hostEventTypes],
  )
  for (const event of events) HostEventSchema.parse(event)

  assert.equal(
    HostEventSchema.safeParse({
      conversationId,
      timestamp,
      type: 'message.delta',
      payload: { delta: 'missing item identity' },
    }).success,
    false,
  )
  assert.equal(
    HostEventSchema.safeParse({
      conversationId,
      timestamp,
      type: 'stream.reset',
      payload: { reason: 'epoch_mismatch' },
    }).success,
    false,
  )
})

test('validates envelope identity and deterministic event IDs', () => {
  const events = createHostEventFixtures()
  events.forEach((event, index) => {
    const seq = index + 1
    HostEventEnvelopeSchema.parse({
      ...event,
      protocolVersion,
      epoch,
      seq,
      eventId: `${epoch}:${String(seq)}`,
    })
  })

  const message = events.find((event) => event.type === 'message.delta')
  assert.notEqual(message, undefined)
  assert.equal(
    HostEventEnvelopeSchema.safeParse({
      ...message,
      protocolVersion,
      epoch,
      seq: 7,
      eventId: `${epoch}:8`,
    }).success,
    false,
  )

  const reset = events.find((event) => event.type === 'stream.reset')
  assert.notEqual(reset, undefined)
  assert.equal(
    HostEventEnvelopeSchema.safeParse({
      ...reset,
      protocolVersion,
      epoch,
      seq: 0,
      eventId: `${epoch}:0`,
    }).success,
    true,
  )
  assert.equal(
    HostEventEnvelopeSchema.safeParse({
      ...message,
      protocolVersion,
      epoch,
      seq: 0,
      eventId: `${epoch}:0`,
    }).success,
    false,
  )

  const started = events[0]
  assert.equal(
    HostEventEnvelopeSchema.safeParse({
      ...started,
      payload: {
        conversation: { ...conversation, conversationId: 'conv_other01' },
      },
      protocolVersion,
      epoch,
      seq: 1,
      eventId: `${epoch}:1`,
    }).success,
    false,
  )
})

function createHostEventFixtures() {
  const itemIdentity = { conversationId, turnId, itemId, timestamp }
  const turnIdentity = { conversationId, turnId, timestamp }
  return [
    {
      conversationId,
      timestamp,
      type: 'conversation.started',
      payload: { conversation },
    },
    {
      ...turnIdentity,
      type: 'turn.started',
      payload: { turn: runningTurnWithInput },
    },
    { ...itemIdentity, type: 'message.delta', payload: { delta: 'hello' } },
    {
      ...itemIdentity,
      type: 'message.completed',
      payload: { message: 'hello' },
    },
    {
      ...itemIdentity,
      type: 'tool.started',
      payload: {
        name: 'command',
        command: 'pnpm test',
        summary: 'Run tests',
      },
    },
    {
      ...itemIdentity,
      type: 'tool.output',
      payload: { output: 'ok', stream: 'stdout' },
    },
    {
      ...itemIdentity,
      type: 'tool.completed',
      payload: { name: 'command', command: 'pnpm test', success: true },
    },
    {
      ...itemIdentity,
      type: 'file.changed',
      payload: { path: 'src/example.ts', kind: 'modified', additions: 1 },
    },
    {
      ...itemIdentity,
      type: 'approval.requested',
      payload: { approval: pendingApproval },
    },
    {
      ...itemIdentity,
      type: 'approval.resolved',
      payload: { approval: resolvedApproval },
    },
    {
      ...turnIdentity,
      type: 'turn.completed',
      payload: { finalMessage: 'Done' },
    },
    {
      ...turnIdentity,
      type: 'turn.failed',
      payload: {
        error: {
          code: 'provider_error',
          message: 'Provider turn failed',
        },
      },
    },
    {
      ...turnIdentity,
      type: 'turn.interrupted',
      payload: { reason: 'User interrupted' },
    },
    {
      conversationId: null,
      timestamp,
      type: 'stream.reset',
      payload: { reason: 'history_evicted' },
    },
  ]
}
