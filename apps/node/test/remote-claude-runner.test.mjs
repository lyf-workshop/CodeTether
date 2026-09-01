import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { RemoteClaudeRunnerPool } from '../dist/remote-claude-runner.js'

const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function sessionRequest(rootPath, overrides = {}) {
  return {
    type: 'claude.session.open',
    protocolVersion: 1,
    requestId: 'C'.repeat(43),
    expectedMachineId: 'machine_remote_claude01',
    expectedNodeId: 'node_remote_claude01',
    conversationId: 'conv_remote_claude01',
    projectId: 'proj_remote_claude01',
    rootPath,
    effort: 'high',
    ...overrides,
  }
}

function turnRequest(providerSessionId, overrides = {}) {
  return {
    type: 'claude.turn.start',
    protocolVersion: 1,
    actionId: 'act_remote_claude01',
    conversationId: 'conv_remote_claude01',
    turnId: 'turn_remote_claude01',
    providerSessionId,
    prompt: 'Inspect the fixture without modifying it.',
    ...overrides,
  }
}

class FakeClaudeRuntime {
  listeners = new Set()
  starts = []
  completions = []
  closeCount = 0

  constructor(sessionId, cwd) {
    this.sessionId = sessionId
    this.cwd = cwd
  }

  subscribeEvents(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  startTurn(options) {
    this.starts.push(options)
    let resolve
    let reject
    const promise = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    this.completions.push({ resolve, reject })
    return promise
  }

  emit(event) {
    for (const listener of this.listeners) listener(event)
  }

  async close() {
    this.closeCount += 1
  }
}

function runtimeHarness(options = {}) {
  const calls = []
  const runtimes = []
  return {
    calls,
    runtimes,
    factory: async (input) => {
      calls.push(input)
      const runtime = new FakeClaudeRuntime(
        options.returnedSessionId ?? input.providerSessionId ?? sessionId,
        input.cwd,
      )
      runtimes.push(runtime)
      return runtime
    },
  }
}

async function collectTurn(turn) {
  const events = []
  for await (const event of turn.events()) events.push(event)
  return events
}

test('runner streams one idempotent restricted Turn with stable Read/Search tools', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'codetether-remote-claude-'))
  t.after(async () => await rm(temporary, { recursive: true, force: true }))
  const root = await realpath(temporary)
  const harness = runtimeHarness()
  const pool = new RemoteClaudeRunnerPool({ runtimeFactory: harness.factory })
  t.after(async () => await pool.close())

  const runner = await pool.open(sessionRequest(root))
  assert.equal(runner.providerSessionId, sessionId)
  assert.equal(runner.resumed, false)
  assert.equal(runner.effort, 'high')
  assert.deepEqual(harness.calls, [{ cwd: root, resume: false }])

  const request = turnRequest(runner.providerSessionId)
  const turn = await runner.startTurn(request)
  assert.equal(await runner.startTurn(request), turn)
  await assert.rejects(
    runner.startTurn({ ...request, prompt: 'different input' }),
    (error) => error.code === 'duplicate_action_conflict',
  )
  await assert.rejects(
    runner.startTurn({ ...request, actionId: 'act_remote_claude02' }),
    (error) => error.code === 'conversation_busy',
  )
  const runtime = harness.runtimes[0]
  assert.deepEqual(runtime.starts, [
    {
      turnId: turn.providerTurnId,
      prompt: request.prompt,
      effort: 'high',
    },
  ])

  const timestamp = new Date().toISOString()
  const base = {
    provider: 'claude-code',
    timestamp,
    threadId: runner.providerSessionId,
    turnId: turn.providerTurnId,
  }
  runtime.emit({
    type: 'conversation.started',
    provider: 'claude-code',
    timestamp,
    threadId: runner.providerSessionId,
    cwd: root,
  })
  runtime.emit({ type: 'turn.started', ...base })
  runtime.emit({
    type: 'message.delta',
    ...base,
    itemId: 'message_public_1',
    delta: 'safe answer',
  })
  runtime.emit({
    type: 'message.completed',
    ...base,
    itemId: 'message_public_1',
    message: 'safe answer',
  })
  runtime.emit({
    type: 'tool.started',
    ...base,
    itemId: 'tool_read_1',
    kind: 'read',
    name: 'Read',
    command: 'Read fixture.txt',
    summary: 'Read fixture.txt',
  })
  runtime.emit({
    type: 'tool.output',
    ...base,
    itemId: 'tool_read_1',
    output: 'known marker',
    stream: 'combined',
  })
  runtime.emit({
    type: 'tool.completed',
    ...base,
    itemId: 'tool_read_1',
    kind: 'read',
    name: 'Read',
    command: 'Read fixture.txt',
    success: true,
    summary: 'Read fixture.txt',
  })
  runtime.emit({
    type: 'tool.started',
    ...base,
    itemId: 'tool_search_1',
    kind: 'search',
    name: 'Search',
    command: 'Grep marker in .',
    summary: 'Search workspace',
  })
  runtime.emit({
    type: 'tool.completed',
    ...base,
    itemId: 'tool_search_1',
    kind: 'search',
    name: 'Search',
    command: 'Grep marker in .',
    success: true,
    summary: 'Search workspace',
  })
  runtime.emit({ type: 'turn.completed', ...base })
  runtime.completions[0].resolve({
    sessionId: runner.providerSessionId,
    turnId: turn.providerTurnId,
    finalMessage: 'safe answer',
  })

  const events = await collectTurn(turn)
  assert.deepEqual(
    events.map(({ type }) => type),
    [
      'message.delta',
      'tool.started',
      'tool.output',
      'tool.completed',
      'tool.started',
      'tool.completed',
      'message.completed',
      'turn.completed',
    ],
  )
  assert.deepEqual(events[1], {
    type: 'tool.started',
    itemId: 'tool_read_1',
    kind: 'read',
    name: 'Read',
    command: 'Read fixture.txt',
    summary: 'Read fixture.txt',
  })
  assert.equal(
    events.filter(({ type }) => type === 'message.completed').length,
    1,
  )
  await assert.rejects(
    runner.startTurn(request),
    (error) => error.code === 'duplicate_action_conflict',
  )
})

test('nonstreamed assistant snapshots fail closed without fabricated deltas', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'codetether-remote-snapshot-'))
  t.after(async () => await rm(temporary, { recursive: true, force: true }))
  const root = await realpath(temporary)
  const harness = runtimeHarness()
  const pool = new RemoteClaudeRunnerPool({ runtimeFactory: harness.factory })
  t.after(async () => await pool.close())
  const runner = await pool.open(sessionRequest(root))
  const turn = await runner.startTurn(turnRequest(runner.providerSessionId))
  const runtime = harness.runtimes[0]
  runtime.emit({
    type: 'message.completed',
    provider: 'claude-code',
    timestamp: new Date().toISOString(),
    threadId: runner.providerSessionId,
    turnId: turn.providerTurnId,
    itemId: 'message_without_delta',
    message: 'snapshot-only answer',
  })

  const events = await collectTurn(turn)
  assert.deepEqual(events, [
    {
      type: 'turn.failed',
      code: 'remote_execution_lost',
      message: 'Remote Claude execution was lost',
    },
  ])
  assert.equal(runtime.closeCount, 1)
  assert.equal(pool.activeCount, 0)
})

test('a successful Provider result without a streamed message fails closed', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'codetether-remote-empty-'))
  t.after(async () => await rm(temporary, { recursive: true, force: true }))
  const root = await realpath(temporary)
  const harness = runtimeHarness()
  const pool = new RemoteClaudeRunnerPool({ runtimeFactory: harness.factory })
  t.after(async () => await pool.close())
  const runner = await pool.open(sessionRequest(root))
  const turn = await runner.startTurn(turnRequest(runner.providerSessionId))
  const runtime = harness.runtimes[0]
  const timestamp = new Date().toISOString()
  runtime.emit({
    type: 'turn.completed',
    provider: 'claude-code',
    timestamp,
    threadId: runner.providerSessionId,
    turnId: turn.providerTurnId,
  })
  runtime.completions[0].resolve({
    sessionId: runner.providerSessionId,
    turnId: turn.providerTurnId,
  })

  const events = await collectTurn(turn)
  assert.deepEqual(events, [
    {
      type: 'turn.failed',
      code: 'remote_execution_lost',
      message: 'Remote Claude execution was lost',
    },
  ])
  assert.equal(runtime.closeCount, 1)
})

test('unsupported mutation Tool fails closed after exact runtime cleanup', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'codetether-remote-policy-'))
  t.after(async () => await rm(temporary, { recursive: true, force: true }))
  const root = await realpath(temporary)
  const harness = runtimeHarness()
  const pool = new RemoteClaudeRunnerPool({ runtimeFactory: harness.factory })
  t.after(async () => await pool.close())
  const runner = await pool.open(sessionRequest(root))
  const turn = await runner.startTurn(turnRequest(runner.providerSessionId))
  const runtime = harness.runtimes[0]
  runtime.emit({
    type: 'tool.started',
    provider: 'claude-code',
    timestamp: new Date().toISOString(),
    threadId: runner.providerSessionId,
    turnId: turn.providerTurnId,
    itemId: 'unsafe_edit',
    kind: 'edit',
    name: 'Edit',
    command: 'Edit fixture.txt',
  })
  const events = await collectTurn(turn)
  assert.deepEqual(events, [
    {
      type: 'turn.failed',
      code: 'remote_policy_violation',
      message: 'Remote Claude emitted an unsupported operation',
    },
  ])
  assert.equal(runtime.closeCount, 1)
  assert.equal(pool.activeCount, 0)
})

test('fatal policy termination retains cleanup failure after terminal event', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'codetether-fatal-cleanup-'))
  t.after(async () => await rm(temporary, { recursive: true, force: true }))
  const root = await realpath(temporary)
  const harness = runtimeHarness()
  const pool = new RemoteClaudeRunnerPool({ runtimeFactory: harness.factory })
  const runner = await pool.open(sessionRequest(root))
  const turn = await runner.startTurn(turnRequest(runner.providerSessionId))
  const runtime = harness.runtimes[0]
  runtime.close = async () => {
    runtime.closeCount += 1
    throw new Error('private fatal cleanup diagnostic')
  }
  runtime.emit({
    type: 'tool.started',
    provider: 'claude-code',
    timestamp: new Date().toISOString(),
    threadId: runner.providerSessionId,
    turnId: turn.providerTurnId,
    itemId: 'unsafe_write',
    kind: 'edit',
    name: 'Write',
    command: 'Write fixture.txt',
  })

  assert.deepEqual(await collectTurn(turn), [
    {
      type: 'turn.failed',
      code: 'remote_policy_violation',
      message: 'Remote Claude emitted an unsupported operation',
    },
  ])
  await assert.rejects(pool.close(), AggregateError)
  assert.equal(runtime.closeCount, 1)
  assert.equal(pool.activeCount, 0)
})

test('assigned and materialized native session identities select create versus resume', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'codetether-remote-resume-'))
  t.after(async () => await rm(temporary, { recursive: true, force: true }))
  const root = await realpath(temporary)
  const harness = runtimeHarness()
  const pool = new RemoteClaudeRunnerPool({ runtimeFactory: harness.factory })
  t.after(async () => await pool.close())

  const assigned = await pool.open(
    sessionRequest(root, {
      providerSessionId: sessionId,
      providerSessionMaterialized: false,
    }),
  )
  assert.equal(assigned.resumed, false)
  assert.deepEqual(harness.calls[0], {
    cwd: root,
    providerSessionId: sessionId,
    resume: false,
  })
  await pool.release(assigned)

  const resumed = await pool.open(
    sessionRequest(root, {
      providerSessionId: sessionId,
      providerSessionMaterialized: true,
    }),
  )
  assert.equal(resumed.resumed, true)
  assert.deepEqual(harness.calls[1], {
    cwd: root,
    providerSessionId: sessionId,
    resume: true,
  })
})

test('runner rejects a changed native session identity without exposing it', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'codetether-session-loss-'))
  t.after(async () => await rm(temporary, { recursive: true, force: true }))
  const root = await realpath(temporary)
  const harness = runtimeHarness({
    returnedSessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  })
  const pool = new RemoteClaudeRunnerPool({ runtimeFactory: harness.factory })
  t.after(async () => await pool.close())
  await assert.rejects(
    pool.open(
      sessionRequest(root, {
        providerSessionId: sessionId,
        providerSessionMaterialized: true,
      }),
    ),
    (error) => error.code === 'provider_session_lost',
  )
  assert.equal(harness.runtimes[0].closeCount, 1)
})

test('partial startup propagates and retains an unverified cleanup failure', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'codetether-open-cleanup-'))
  t.after(async () => await rm(temporary, { recursive: true, force: true }))
  const root = await realpath(temporary)
  const runtime = new FakeClaudeRuntime(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    root,
  )
  runtime.close = async () => {
    runtime.closeCount += 1
    throw new Error('private partial-start cleanup diagnostic')
  }
  const pool = new RemoteClaudeRunnerPool({
    runtimeFactory: async () => runtime,
  })

  await assert.rejects(
    pool.open(
      sessionRequest(root, {
        providerSessionId: sessionId,
        providerSessionMaterialized: true,
      }),
    ),
    (error) =>
      error.code === 'remote_execution_lost' &&
      !error.message.includes('private partial-start'),
  )
  assert.equal(runtime.closeCount, 1)
  await assert.rejects(
    pool.close(),
    (error) =>
      error instanceof AggregateError &&
      error.message === 'Remote Claude owned process cleanup did not complete',
  )
})

test('pool shutdown rejects cleanup failure after terminalizing its active Turn', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'codetether-close-reject-'))
  t.after(async () => await rm(temporary, { recursive: true, force: true }))
  const root = await realpath(temporary)
  const harness = runtimeHarness()
  const pool = new RemoteClaudeRunnerPool({ runtimeFactory: harness.factory })
  const runner = await pool.open(sessionRequest(root))
  const turn = await runner.startTurn(turnRequest(runner.providerSessionId))
  const runtime = harness.runtimes[0]
  runtime.close = async () => {
    runtime.closeCount += 1
    throw new Error('private shutdown cleanup diagnostic')
  }

  await assert.rejects(
    pool.close(),
    (error) =>
      error instanceof AggregateError &&
      error.message === 'Remote Claude owned process cleanup did not complete',
  )
  assert.deepEqual(await collectTurn(turn), [
    {
      type: 'turn.failed',
      code: 'remote_execution_lost',
      message: 'Remote Claude execution was lost',
    },
  ])
  assert.equal(runtime.closeCount, 1)
  assert.equal(pool.activeCount, 0)
  await assert.rejects(pool.close(), AggregateError)
})

test('pool close awaits cleanup already started by concurrent release', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'codetether-release-close-'))
  t.after(async () => await rm(temporary, { recursive: true, force: true }))
  const root = await realpath(temporary)
  const harness = runtimeHarness()
  const pool = new RemoteClaudeRunnerPool({ runtimeFactory: harness.factory })
  let releaseCleanup
  const cleanupBarrier = new Promise((resolvePromise) => {
    releaseCleanup = resolvePromise
  })
  t.after(() => releaseCleanup())
  const runner = await pool.open(sessionRequest(root))
  const runtime = harness.runtimes[0]
  runtime.close = async () => {
    runtime.closeCount += 1
    await cleanupBarrier
  }

  const releasing = pool.release(runner)
  while (runtime.closeCount === 0) {
    await new Promise((resolvePromise) => setImmediate(resolvePromise))
  }
  let poolClosed = false
  const closing = pool.close().then(() => {
    poolClosed = true
  })
  await new Promise((resolvePromise) => setImmediate(resolvePromise))
  assert.equal(poolClosed, false)

  releaseCleanup()
  await Promise.all([releasing, closing])
  assert.equal(poolClosed, true)
  assert.equal(runtime.closeCount, 1)
})
