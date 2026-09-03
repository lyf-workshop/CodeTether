import assert from 'node:assert/strict'
import test from 'node:test'

import { canonicalFailure } from '@codetether/agent-core'

import { RemoteClaudeHostRuntime } from '../dist/api/remote-claude-host-runtime.js'

const machineId = 'machine_remote_claude_runtime01'
const conversationId = 'conv_remote_claude_runtime01'
const projectId = 'proj_remote_claude_runtime01'
const nativeSessionId = '123e4567-e89b-42d3-a456-426614174000'

test('remote Claude runtime keeps native identity private and normalizes text plus safe Tool events', async () => {
  const opens = []
  const session = fakeSession(nativeSessionId, {
    effort: 'high',
    events: [
      { type: 'message.delta', text: 'hello ', sequence: 1 },
      {
        type: 'tool.started',
        itemId: 'tool-read-1',
        kind: 'read',
        name: 'Read',
        command: 'fixture.txt',
        sequence: 2,
      },
      {
        type: 'tool.output',
        itemId: 'tool-read-1',
        output: 'known fixture',
        sequence: 3,
      },
      {
        type: 'tool.completed',
        itemId: 'tool-read-1',
        kind: 'read',
        name: 'Read',
        command: 'fixture.txt',
        success: true,
        sequence: 4,
      },
      {
        type: 'tool.started',
        itemId: 'tool-search-1',
        kind: 'search',
        name: 'Search',
        command: 'marker',
        sequence: 5,
      },
      {
        type: 'tool.output',
        itemId: 'tool-search-1',
        output: 'fixture.txt:1:marker',
        sequence: 6,
      },
      {
        type: 'tool.completed',
        itemId: 'tool-search-1',
        kind: 'search',
        name: 'Search',
        command: 'marker',
        success: true,
        sequence: 7,
      },
      { type: 'message.delta', text: 'world', sequence: 8 },
      { type: 'message.completed', sequence: 9 },
      { type: 'turn.completed', sequence: 10 },
    ],
  })
  const runtime = new RemoteClaudeHostRuntime({
    machineId,
    now: () => new Date('2026-09-01T12:00:00.000Z'),
    opener: {
      async open(input) {
        opens.push(input)
        return session
      },
    },
  })
  const events = []
  runtime.subscribeEvents((event) => events.push(event))

  const created = await runtime.startConversation({
    cwd: '/srv/project',
    reasoning: 'high',
    machineId,
    conversationId,
    projectId,
  })
  assert.deepEqual(opens, [
    {
      machineId,
      conversationId,
      projectId,
      rootPath: '/srv/project',
      effort: 'high',
    },
  ])
  assert.equal(created.providerThreadId.includes(nativeSessionId), false)

  const turn = await runtime.startTurn({
    providerThreadId: created.providerThreadId,
    cwd: '/srv/project',
    input: 'inspect safely',
    reasoning: 'high',
    machineId,
    conversationId,
    projectId,
    actionId: 'act_remote_claude_runtime01',
    turnId: 'turn_remote_claude_runtime01',
  })
  assert.equal(
    turn.providerTurnId.includes('turn_remote_claude_runtime01'),
    false,
  )
  await waitFor(() => events.some((event) => event.type === 'turn.completed'))
  assert.deepEqual(
    events.map((event) => event.type),
    [
      'message.delta',
      'tool.started',
      'tool.output',
      'tool.completed',
      'tool.started',
      'tool.output',
      'tool.completed',
      'message.delta',
      'message.completed',
      'turn.completed',
    ],
  )
  assert.equal(events[1].kind, 'read')
  assert.equal(events[1].name, 'Read')
  assert.equal(events[4].kind, 'search')
  assert.equal(events[4].name, 'Search')
  assert.equal(events[8].message, 'hello world')
  assert.equal(events[9].finalMessage, 'hello world')
  assert.equal(
    events.every((event) => event.provider === 'claude-code'),
    true,
  )
  assert.equal(JSON.stringify(events).includes(nativeSessionId), false)

  await runtime.close()
  assert.equal(session.closeCalls, 1)
})

test('remote Claude runtime performs exact Machine-bound native resume with immutable effort', async () => {
  const first = new RemoteClaudeHostRuntime({
    machineId,
    opener: {
      open: async () => fakeSession(nativeSessionId, { effort: 'xhigh' }),
    },
  })
  const created = await first.startConversation({
    cwd: '/srv/project',
    reasoning: 'xhigh',
    machineId,
    conversationId,
    projectId,
  })
  await first.close()

  const opens = []
  const second = new RemoteClaudeHostRuntime({
    machineId,
    opener: {
      async open(input) {
        opens.push(input)
        return fakeSession(nativeSessionId, { effort: 'xhigh' })
      },
    },
  })
  const resumed = await second.resumeConversation({
    providerThreadId: created.providerThreadId,
    providerSessionMaterialized: true,
    cwd: '/srv/project',
    reasoning: 'xhigh',
    machineId,
    conversationId,
    projectId,
  })
  assert.equal(resumed.providerThreadId, created.providerThreadId)
  assert.equal(opens[0].providerSessionId, nativeSessionId)
  assert.equal(opens[0].providerSessionMaterialized, true)
  assert.equal(opens[0].effort, 'xhigh')

  await assert.rejects(
    second.resumeConversation({
      providerThreadId: created.providerThreadId,
      providerSessionMaterialized: true,
      cwd: '/srv/project',
      reasoning: 'high',
      machineId,
      conversationId,
      projectId,
    }),
    /conversation is no longer available/u,
  )
  await second.close()
})

test('remote Claude runtime rejects invalid effort and fails closed on an unsafe Tool event', async () => {
  let opens = 0
  const session = fakeSession(nativeSessionId, {
    effort: 'low',
    events: [
      {
        type: 'tool.started',
        itemId: 'unsafe-tool',
        kind: 'edit',
        name: 'Edit',
        sequence: 1,
      },
    ],
  })
  const runtime = new RemoteClaudeHostRuntime({
    machineId,
    opener: {
      async open() {
        opens += 1
        return session
      },
    },
  })
  await assert.rejects(
    runtime.startConversation({
      cwd: '/srv/project',
      reasoning: 'invalid',
      machineId,
      conversationId,
      projectId,
    }),
    /effort is unsupported/u,
  )
  assert.equal(opens, 0)

  const created = await runtime.startConversation({
    cwd: '/srv/project',
    reasoning: 'low',
    machineId,
    conversationId,
    projectId,
  })
  const events = []
  runtime.subscribeEvents((event) => events.push(event))
  await runtime.startTurn({
    providerThreadId: created.providerThreadId,
    cwd: '/srv/project',
    input: 'attempt mutation',
    reasoning: 'low',
    machineId,
    conversationId,
    projectId,
    actionId: 'act_remote_claude_unsafe01',
    turnId: 'turn_remote_claude_unsafe01',
  })
  await waitFor(() => events.some((event) => event.type === 'turn.failed'))
  assert.deepEqual(
    events.map((event) => event.type),
    ['turn.failed'],
  )
  assert.equal(events[0].error.code, 'provider_unavailable')
  assert.equal(runtime.hasConversationSession(created.providerThreadId), false)
  assert.equal(session.closeCalls, 1)
  await runtime.close()
})

test('remote Claude runtime preserves canonical failure metadata from the Node', async () => {
  const occurredAt = '2026-09-02T12:00:00.000Z'
  const session = fakeSession(nativeSessionId, {
    effort: 'low',
    events: [
      {
        type: 'turn.failed',
        code: 'provider_failed',
        message: 'Node-owned safe failure',
        failure: canonicalFailure('usage_limit_reached', occurredAt),
        sequence: 1,
      },
    ],
  })
  const runtime = new RemoteClaudeHostRuntime({
    machineId,
    opener: { open: async () => session },
  })
  const events = []
  runtime.subscribeEvents((event) => events.push(event))
  const created = await runtime.startConversation({
    cwd: '/srv/project',
    reasoning: 'low',
    machineId,
    conversationId,
    projectId,
  })
  await runtime.startTurn({
    providerThreadId: created.providerThreadId,
    cwd: '/srv/project',
    input: 'one explicit prompt',
    reasoning: 'low',
    machineId,
    conversationId,
    projectId,
    actionId: 'act_remote_claude_canonical01',
    turnId: 'turn_remote_claude_canonical01',
  })
  await waitFor(() => events.some((event) => event.type === 'turn.failed'))
  assert.equal(events[0].error.failure.reason, 'usage_limit_reached')
  assert.equal(events[0].error.failure.occurredAt, occurredAt)
  assert.equal(events[0].error.message, 'Remote Claude Code Turn failed')
  await runtime.close()
})

test('remote Claude runtime awaits invalidated Session cleanup before shutdown resolves', async () => {
  const closeGate = deferred()
  const session = fakeSession(nativeSessionId, {
    effort: 'low',
    closeGate: closeGate.promise,
    events: [
      {
        type: 'tool.started',
        itemId: 'unsafe-tool-close',
        kind: 'edit',
        name: 'Edit',
        sequence: 1,
      },
    ],
  })
  const runtime = new RemoteClaudeHostRuntime({
    machineId,
    opener: { open: async () => session },
  })
  const events = []
  runtime.subscribeEvents((event) => events.push(event))
  const created = await runtime.startConversation({
    cwd: '/srv/project',
    reasoning: 'low',
    machineId,
    conversationId,
    projectId,
  })
  await runtime.startTurn({
    providerThreadId: created.providerThreadId,
    cwd: '/srv/project',
    input: 'attempt mutation',
    reasoning: 'low',
    machineId,
    conversationId,
    projectId,
    actionId: 'act_remote_claude_cleanup01',
    turnId: 'turn_remote_claude_cleanup01',
  })
  await waitFor(() => events.some((event) => event.type === 'turn.failed'))
  await waitFor(() => session.closeCalls === 1)

  let closed = false
  const closing = runtime.close().then(() => {
    closed = true
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(closed, false)

  closeGate.resolve()
  await closing
  assert.equal(closed, true)
  assert.equal(session.closeCalls, 1)
})

test('remote Claude native retry waits for invalidated Session ownership cleanup', async () => {
  const closeGate = deferred()
  const invalidated = fakeSession(nativeSessionId, {
    effort: 'high',
    closeGate: closeGate.promise,
    events: [
      {
        type: 'tool.started',
        itemId: 'unsafe-tool-retry',
        kind: 'write',
        name: 'Write',
        sequence: 1,
      },
    ],
  })
  const replacement = fakeSession(nativeSessionId, { effort: 'high' })
  let opens = 0
  const runtime = new RemoteClaudeHostRuntime({
    machineId,
    opener: {
      async open() {
        opens += 1
        return opens === 1 ? invalidated : replacement
      },
    },
  })
  const events = []
  runtime.subscribeEvents((event) => events.push(event))
  const created = await runtime.startConversation({
    cwd: '/srv/project',
    reasoning: 'high',
    machineId,
    conversationId,
    projectId,
  })
  await runtime.startTurn({
    providerThreadId: created.providerThreadId,
    cwd: '/srv/project',
    input: 'attempt mutation',
    reasoning: 'high',
    machineId,
    conversationId,
    projectId,
    actionId: 'act_remote_claude_retry01',
    turnId: 'turn_remote_claude_retry01',
  })
  await waitFor(() => events.some((event) => event.type === 'turn.failed'))
  await waitFor(() => invalidated.closeCalls === 1)

  let resumed = false
  const retry = runtime
    .resumeConversation({
      providerThreadId: created.providerThreadId,
      providerSessionMaterialized: true,
      cwd: '/srv/project',
      reasoning: 'high',
      machineId,
      conversationId,
      projectId,
    })
    .then((result) => {
      resumed = true
      return result
    })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(resumed, false)
  assert.equal(opens, 1)

  closeGate.resolve()
  assert.deepEqual(await retry, created)
  assert.equal(opens, 2)
  await runtime.close()
  assert.equal(replacement.closeCalls, 1)
})

function fakeSession(providerSessionId, options = {}) {
  let closed = false
  return {
    machineId,
    conversationId,
    providerSessionId,
    effort: options.effort,
    closeCalls: 0,
    startTurnCalls: 0,
    get closed() {
      return closed
    },
    async startTurn() {
      this.startTurnCalls += 1
      return {
        async *events() {
          for (const event of options.events ?? [
            { type: 'message.delta', text: 'done', sequence: 1 },
            { type: 'message.completed', sequence: 2 },
            { type: 'turn.completed', sequence: 3 },
          ]) {
            yield event
          }
        },
      }
    },
    async close() {
      closed = true
      this.closeCalls += 1
      await options.closeGate
    },
  }
}

function deferred() {
  let resolve
  const promise = new Promise((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setImmediate(resolve))
  }
  throw new Error('Timed out waiting for remote Claude runtime event')
}
