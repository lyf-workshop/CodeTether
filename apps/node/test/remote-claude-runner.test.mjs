import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { machineTransportLimits } from '@codetether/machine-transport'

import { RemoteClaudeRunnerPool } from '../dist/remote-claude-runner.js'

const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const providerInstallationId = 'pinst_nodefixture01'
const installationRevision = 'prev_nodefixture01'

function sessionRequest(rootPath, overrides = {}) {
  return {
    type: 'claude.session.open',
    protocolVersion: 1,
    requestId: 'C'.repeat(43),
    expectedMachineId: 'machine_remote_claude01',
    expectedNodeId: 'node_remote_claude01',
    conversationId: 'conv_remote_claude01',
    projectId: 'proj_remote_claude01',
    providerInstallationId,
    expectedInstallationRevision: installationRevision,
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

  constructor(sessionId, cwd, closeGate = Promise.resolve()) {
    this.sessionId = sessionId
    this.cwd = cwd
    this.closeGate = closeGate
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
    await this.closeGate
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
        options.closeGate,
      )
      runtimes.push(runtime)
      return runtime
    },
  }
}

function connectionOwner(generation, retire = () => undefined) {
  return {
    controllerId: 'controller_remote_owner01',
    generation: BigInt(generation),
    retire,
  }
}

function deferred() {
  let resolve
  const promise = new Promise((complete) => {
    resolve = complete
  })
  return { promise, resolve }
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

test('runner does not acknowledge a Turn before Provider ownership is established', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'codetether-claude-ack-'))
  t.after(async () => await rm(temporary, { recursive: true, force: true }))
  const root = await realpath(temporary)
  let resolveOwnership
  const ownershipEstablished = new Promise((resolve) => {
    resolveOwnership = resolve
  })
  const runtime = new FakeClaudeRuntime(sessionId, root)
  runtime.startTurnExecution = (options) => {
    runtime.starts.push(options)
    return {
      ownershipEstablished,
      completion: new Promise(() => undefined),
    }
  }
  const pool = new RemoteClaudeRunnerPool({
    runtimeFactory: async () => runtime,
  })
  t.after(async () => await pool.close())
  const runner = await pool.open(sessionRequest(root))
  let acknowledged = false
  const starting = runner
    .startTurn(turnRequest(runner.providerSessionId))
    .then((turn) => {
      acknowledged = true
      return turn
    })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(acknowledged, false)
  resolveOwnership()
  await starting
  assert.equal(acknowledged, true)
})

test('runner maps pre-ownership startup failure without acknowledging a Turn', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'codetether-claude-noack-'))
  t.after(async () => await rm(temporary, { recursive: true, force: true }))
  const root = await realpath(temporary)
  const startupFailure = Object.assign(new Error('private spawn failure'), {
    code: 'provider_start_failed',
    failureReason: 'login_required',
  })
  const runtime = new FakeClaudeRuntime(sessionId, root)
  runtime.startTurnExecution = () => ({
    ownershipEstablished: Promise.reject(startupFailure),
    completion: Promise.reject(startupFailure),
  })
  const pool = new RemoteClaudeRunnerPool({
    runtimeFactory: async () => runtime,
  })
  t.after(async () => await pool.close().catch(() => undefined))
  const runner = await pool.open(sessionRequest(root))
  await assert.rejects(
    runner.startTurn(turnRequest(runner.providerSessionId)),
    (error) =>
      error.code === 'provider_start_failed' &&
      error.failureReason === 'login_required' &&
      !error.message.includes('private'),
  )
})

test('runner cleans a synchronous start failure before releasing its Conversation slot', async (t) => {
  const temporary = await mkdtemp(
    join(tmpdir(), 'codetether-claude-sync-start-'),
  )
  t.after(async () => await rm(temporary, { recursive: true, force: true }))
  const root = await realpath(temporary)
  const startupFailure = Object.assign(
    new Error('private synchronous process factory detail'),
    {
      code: 'provider_start_failed',
      failureReason: 'provider_start_failed',
    },
  )
  const firstRuntime = new FakeClaudeRuntime(sessionId, root)
  firstRuntime.startTurnExecution = () => {
    throw startupFailure
  }
  const recoveredRuntime = new FakeClaudeRuntime(sessionId, root)
  let factoryCalls = 0
  const pool = new RemoteClaudeRunnerPool({
    runtimeFactory: async () => {
      factoryCalls += 1
      return factoryCalls === 1 ? firstRuntime : recoveredRuntime
    },
  })
  t.after(async () => await pool.close())

  const runner = await pool.open(sessionRequest(root))
  await assert.rejects(
    runner.startTurn(turnRequest(runner.providerSessionId)),
    (error) =>
      error.code === 'provider_start_failed' &&
      error.failureReason === 'provider_start_failed' &&
      !error.message.includes('private'),
  )
  assert.equal(firstRuntime.closeCount, 1)
  for (let attempt = 0; attempt < 10 && pool.activeCount !== 0; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
  assert.equal(pool.activeCount, 0)

  const recovered = await pool.open(
    sessionRequest(root, { requestId: 'D'.repeat(43) }),
  )
  await recovered.startTurn(
    turnRequest(recovered.providerSessionId, {
      actionId: 'act_remote_claude_sync_recovery',
      turnId: 'turn_remote_claude_sync_recovery',
    }),
  )
  assert.equal(recoveredRuntime.starts.length, 1)
})

test('runner open preserves a controlled login failure from execution admission', async (t) => {
  const temporary = await mkdtemp(
    join(tmpdir(), 'codetether-claude-login-admission-'),
  )
  t.after(async () => await rm(temporary, { recursive: true, force: true }))
  const root = await realpath(temporary)
  const pool = new RemoteClaudeRunnerPool({
    runtimeFactory: async () => {
      throw Object.assign(new Error('private auth path and account detail'), {
        code: 'provider_unavailable',
        failureReason: 'login_required',
      })
    },
  })
  t.after(async () => await pool.close())

  await assert.rejects(
    pool.open(sessionRequest(root)),
    (error) =>
      error.code === 'provider_unavailable' &&
      error.failureReason === 'login_required' &&
      error.message === 'Remote Claude is unavailable' &&
      !error.message.includes('private'),
  )
  assert.equal(pool.activeCount, 0)
})

test('runner preserves a controlled Claude Provider failure without its prose', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'codetether-claude-failure-'))
  t.after(async () => await rm(temporary, { recursive: true, force: true }))
  const root = await realpath(temporary)
  const harness = runtimeHarness()
  const pool = new RemoteClaudeRunnerPool({ runtimeFactory: harness.factory })
  t.after(async () => await pool.close())
  const runner = await pool.open(sessionRequest(root))
  const turn = await runner.startTurn(turnRequest(runner.providerSessionId))
  harness.runtimes[0].completions[0].reject(
    Object.assign(new Error('private Provider account and token detail'), {
      code: 'provider_unavailable',
      failureReason: 'rate_limited',
    }),
  )

  const events = await collectTurn(turn)
  assert.equal(events[0].failure.reason, 'rate_limited')
  assert.doesNotMatch(JSON.stringify(events), /private|account|token/u)
})

test('50,000 tiny deltas remain bounded for a deliberately slow consumer', async (t) => {
  const temporary = await mkdtemp(
    join(tmpdir(), 'codetether-remote-claude-volume-'),
  )
  t.after(async () => await rm(temporary, { recursive: true, force: true }))
  const root = await realpath(temporary)
  const harness = runtimeHarness()
  const pool = new RemoteClaudeRunnerPool({ runtimeFactory: harness.factory })
  t.after(async () => await pool.close())
  const runner = await pool.open(sessionRequest(root))
  const turn = await runner.startTurn(turnRequest(runner.providerSessionId))
  const runtime = harness.runtimes[0]
  const timestamp = new Date().toISOString()
  const base = {
    provider: 'claude-code',
    timestamp,
    threadId: runner.providerSessionId,
    turnId: turn.providerTurnId,
    itemId: 'message_high_volume',
  }
  const expected = 'x'.repeat(50_000)

  // The consumer intentionally does not start until the whole burst has
  // arrived. Adjacent deltas must coalesce behind the bounded queue rather
  // than allocating one queued object per Provider frame.
  for (let index = 0; index < 50_000; index += 1) {
    runtime.emit({ type: 'message.delta', ...base, delta: 'x' })
  }
  runtime.emit({ type: 'message.completed', ...base, message: expected })
  runtime.emit({ type: 'turn.completed', ...base })
  runtime.completions[0].resolve({
    sessionId: runner.providerSessionId,
    turnId: turn.providerTurnId,
    finalMessage: expected,
  })

  const events = await collectTurn(turn)
  const deltas = events.filter((event) => event.type === 'message.delta')
  assert.equal(deltas.map((event) => event.text).join(''), expected)
  assert.ok(
    deltas.length < 20,
    `expected coalescing, observed ${deltas.length}`,
  )
  assert.deepEqual(
    events.slice(-2).map((event) => event.type),
    ['message.completed', 'turn.completed'],
  )
})

test('100,000 Provider events remain bounded for a deliberately slow consumer', async (t) => {
  const temporary = await mkdtemp(
    join(tmpdir(), 'codetether-remote-claude-volume-limit-'),
  )
  t.after(async () => await rm(temporary, { recursive: true, force: true }))
  const root = await realpath(temporary)
  const harness = runtimeHarness()
  const pool = new RemoteClaudeRunnerPool({ runtimeFactory: harness.factory })
  t.after(async () => await pool.close())
  const runner = await pool.open(
    sessionRequest(root, {
      conversationId: 'conv_remote_claude_volume_limit',
      requestId: 'V'.repeat(43),
    }),
  )
  const turn = await runner.startTurn(
    turnRequest(runner.providerSessionId, {
      actionId: 'act_remote_claude_volume_limit',
      conversationId: runner.conversationId,
      turnId: 'turn_remote_claude_volume_limit',
    }),
  )
  const runtime = harness.runtimes[0]
  const timestamp = new Date().toISOString()
  const base = {
    provider: 'claude-code',
    timestamp,
    threadId: runner.providerSessionId,
    turnId: turn.providerTurnId,
    itemId: 'message_volume_limit',
  }
  const generatedProviderEventCount =
    machineTransportLimits.maximumRemoteClaudeTurnEvents
  assert.equal(generatedProviderEventCount, 100_000)
  const deltaInputCount = generatedProviderEventCount - 2
  const expected = 'x'.repeat(deltaInputCount)
  const heapBeforeBytes = process.memoryUsage().heapUsed

  // The consumer remains detached for the entire Provider burst. The two
  // observation-only Provider terminal frames leave exactly two canonical
  // terminal queue entries after 99,998 deltas, exercising the full 100,000
  // canonical-event allowance without sacrificing terminal delivery.
  for (let index = 0; index < deltaInputCount; index += 1) {
    runtime.emit({ type: 'message.delta', ...base, delta: 'x' })
  }
  runtime.emit({ type: 'message.completed', ...base, message: expected })
  runtime.emit({ type: 'turn.completed', ...base })
  const heapAfterBurstBytes = process.memoryUsage().heapUsed
  runtime.completions[0].resolve({
    sessionId: runner.providerSessionId,
    turnId: turn.providerTurnId,
    finalMessage: expected,
  })

  const events = await collectTurn(turn)
  const deltas = events.filter((event) => event.type === 'message.delta')
  const terminalTypes = events.slice(-2).map((event) => event.type)
  const maximumObservedQueuedEntriesUpperBound = events.length
  const messageCompletedCount = events.filter(
    (event) => event.type === 'message.completed',
  ).length
  const turnCompletedCount = events.filter(
    (event) => event.type === 'turn.completed',
  ).length
  assert.equal(deltas.map((event) => event.text).join(''), expected)
  assert.ok(
    deltas.length <= 13,
    `expected bounded delta coalescing, observed ${deltas.length}`,
  )
  assert.deepEqual(terminalTypes, ['message.completed', 'turn.completed'])
  assert.equal(messageCompletedCount, 1)
  assert.equal(turnCompletedCount, 1)
  t.diagnostic(
    `PHASE6C4_STRESS_METRIC ${JSON.stringify({
      schemaVersion: 1,
      generatedProviderEventCount,
      deltaInputCount,
      canonicalDeltaCount: deltas.length,
      canonicalTerminalCount: terminalTypes.length,
      messageCompletedCount,
      turnCompletedCount,
      maximumObservedQueuedEntriesUpperBound,
      configuredQueuedEventsLimit:
        machineTransportLimits.maximumRemoteClaudeQueuedEvents,
      configuredQueuedOutputBytesLimit:
        machineTransportLimits.maximumRemoteClaudeQueuedOutputBytes,
      outputBytes: Buffer.byteLength(expected, 'utf8'),
      heapBeforeBytes,
      heapAfterBurstBytes,
      terminalEventObserved: true,
      queueBounded: true,
    })}`,
  )
})

test('100 sequential Turn lifecycles release active state exactly once', async (t) => {
  const temporary = await mkdtemp(
    join(tmpdir(), 'codetether-remote-claude-lifecycle-'),
  )
  t.after(async () => await rm(temporary, { recursive: true, force: true }))
  const root = await realpath(temporary)
  const harness = runtimeHarness()
  const pool = new RemoteClaudeRunnerPool({ runtimeFactory: harness.factory })
  t.after(async () => await pool.close())
  const runner = await pool.open(sessionRequest(root))
  const runtime = harness.runtimes[0]

  for (let index = 0; index < 100; index += 1) {
    const turn = await runner.startTurn(
      turnRequest(runner.providerSessionId, {
        actionId: `act_lifecycle_${String(index).padStart(3, '0')}`,
        turnId: `turn_lifecycle_${String(index).padStart(3, '0')}`,
        prompt: `bounded lifecycle ${String(index)}`,
      }),
    )
    const base = {
      provider: 'claude-code',
      timestamp: new Date().toISOString(),
      threadId: runner.providerSessionId,
      turnId: turn.providerTurnId,
      itemId: `message_${String(index)}`,
    }
    runtime.emit({ type: 'message.delta', ...base, delta: 'ok' })
    runtime.emit({ type: 'message.completed', ...base, message: 'ok' })
    runtime.emit({ type: 'turn.completed', ...base })
    runtime.completions[index].resolve({
      sessionId: runner.providerSessionId,
      turnId: turn.providerTurnId,
      finalMessage: 'ok',
    })
    const events = await collectTurn(turn)
    assert.deepEqual(
      events.map((event) => event.type),
      ['message.delta', 'message.completed', 'turn.completed'],
    )
  }

  assert.equal(runtime.starts.length, 100)
  assert.equal(pool.activeCount, 1)
  await pool.release(runner)
  assert.equal(pool.activeCount, 0)
  assert.equal(runtime.closeCount, 1)
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
  assert.equal(events[0].failure.reason, 'execution_lost')
  assert.deepEqual(events.map(stripCanonicalFailure), [
    {
      type: 'turn.failed',
      code: 'remote_execution_lost',
      message: 'Remote Claude execution was lost',
    },
  ])
  assert.equal(runtime.closeCount, 1)
  await waitForPoolRelease(pool)
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
  assert.equal(events[0].failure.reason, 'execution_lost')
  assert.deepEqual(events.map(stripCanonicalFailure), [
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
  assert.equal(events[0].failure.reason, 'provider_protocol_error')
  assert.deepEqual(events.map(stripCanonicalFailure), [
    {
      type: 'turn.failed',
      code: 'remote_policy_violation',
      message: 'Remote Claude emitted an unsupported operation',
    },
  ])
  assert.equal(runtime.closeCount, 1)
  await waitForPoolRelease(pool)
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

  const events = await collectTurn(turn)
  assert.equal(events[0].failure.reason, 'execution_ownership_uncertain')
  assert.deepEqual(events.map(stripCanonicalFailure), [
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

test('selected installation capability loss rejects Claude resume and effort before runtime launch while fresh create remains available', async (t) => {
  const temporary = await mkdtemp(
    join(tmpdir(), 'codetether-claude-capability-'),
  )
  t.after(async () => await rm(temporary, { recursive: true, force: true }))
  const root = await realpath(temporary)
  const harness = runtimeHarness()
  const nativeResume = false
  let reasoningControl = false
  const executable = join(root, 'claude-fixture')
  const providerLifecycle = {
    selected: async () => ({
      provider: 'claude-code',
      launcher: {
        kind: 'native',
        launcherPath: executable,
        executable,
        prefixArguments: [],
        sourcePath: executable,
      },
      environment: { HOME: root },
      version: 'fixture-version',
      compatibility: {
        state: 'limited',
        capabilities: {
          execution: { effective: true },
          streaming: { effective: true },
          nativeResume: { effective: nativeResume },
          reasoningControl: { effective: reasoningControl },
        },
      },
    }),
  }
  const pool = new RemoteClaudeRunnerPool({
    runtimeFactory: harness.factory,
    providerLifecycle,
  })
  t.after(async () => await pool.close())

  await assert.rejects(
    pool.open(sessionRequest(root)),
    (error) => error.code === 'remote_execution_unavailable',
  )
  assert.equal(harness.calls.length, 0)

  reasoningControl = true
  await assert.rejects(
    pool.open(
      sessionRequest(root, {
        providerSessionId: sessionId,
        providerSessionMaterialized: true,
      }),
    ),
    (error) => error.code === 'remote_execution_unavailable',
  )
  assert.equal(harness.calls.length, 0)

  const fresh = await pool.open(
    sessionRequest(root, {
      effort: undefined,
      providerSessionMaterialized: false,
    }),
  )
  assert.equal(fresh.resumed, false)
  assert.equal(harness.calls.length, 1)
  await pool.release(fresh)
})

test('a newer authenticated connection safely replaces the exact idle Claude session', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'codetether-claude-handoff-'))
  t.after(async () => await rm(temporary, { recursive: true, force: true }))
  const root = await realpath(temporary)
  const cleanup = deferred()
  const harness = runtimeHarness({ closeGate: cleanup.promise })
  const pool = new RemoteClaudeRunnerPool({ runtimeFactory: harness.factory })
  t.after(async () => {
    cleanup.resolve()
    await pool.close()
  })
  let retired = 0

  const stale = await pool.open(
    sessionRequest(root, {
      providerSessionId: sessionId,
      providerSessionMaterialized: false,
    }),
    connectionOwner(1, () => {
      retired += 1
    }),
  )
  const turn = await stale.startTurn(turnRequest(stale.providerSessionId))
  const runtime = harness.runtimes[0]
  const timestamp = new Date().toISOString()
  const base = {
    provider: 'claude-code',
    timestamp,
    threadId: stale.providerSessionId,
    turnId: turn.providerTurnId,
  }
  runtime.emit({
    type: 'message.delta',
    ...base,
    itemId: 'message_handoff',
    delta: 'safe marker',
  })
  runtime.emit({
    type: 'message.completed',
    ...base,
    itemId: 'message_handoff',
    message: 'safe marker',
  })
  runtime.emit({ type: 'turn.completed', ...base })
  runtime.completions[0].resolve({
    sessionId: stale.providerSessionId,
    turnId: turn.providerTurnId,
    finalMessage: 'safe marker',
  })
  await collectTurn(turn)

  let replacementSettled = false
  const replacementOpening = pool
    .open(
      sessionRequest(root, {
        requestId: 'D'.repeat(43),
        providerSessionId: sessionId,
        providerSessionMaterialized: true,
      }),
      connectionOwner(2),
    )
    .then((next) => {
      replacementSettled = true
      return next
    })
  while (runtime.closeCount === 0) {
    await new Promise((resolve) => setImmediate(resolve))
  }
  assert.equal(replacementSettled, false)
  assert.equal(harness.runtimes.length, 1)
  cleanup.resolve()
  const replacement = await replacementOpening
  assert.equal(retired, 1)
  assert.equal(runtime.closeCount, 1)
  assert.equal(replacement.resumed, true)
  assert.deepEqual(harness.calls[1], {
    cwd: root,
    providerSessionId: sessionId,
    resume: true,
  })
  await assert.rejects(
    stale.startTurn(
      turnRequest(stale.providerSessionId, {
        actionId: 'act_remote_claude_stale',
        turnId: 'turn_remote_claude_stale',
      }),
    ),
    (error) => error.code === 'provider_session_lost',
  )
  await pool.release(stale)
  assert.equal(pool.activeCount, 1)
  await pool.release(replacement)
  assert.equal(pool.activeCount, 0)
})

test('Claude idle-session handoff rejects active or mismatched ownership', async (t) => {
  const temporary = await mkdtemp(
    join(tmpdir(), 'codetether-claude-handoff-guard-'),
  )
  t.after(async () => await rm(temporary, { recursive: true, force: true }))
  const root = await realpath(temporary)
  const otherRootPath = join(temporary, 'other-root')
  await mkdir(otherRootPath)
  const otherRoot = await realpath(otherRootPath)
  const harness = runtimeHarness()
  const pool = new RemoteClaudeRunnerPool({ runtimeFactory: harness.factory })
  t.after(async () => await pool.close())
  let retired = 0
  const runner = await pool.open(
    sessionRequest(root, {
      providerSessionId: sessionId,
      providerSessionMaterialized: false,
    }),
    connectionOwner(10, () => {
      retired += 1
    }),
  )
  const exactUnused = sessionRequest(root, {
    providerSessionId: sessionId,
    providerSessionMaterialized: false,
  })
  const mismatches = [
    [exactUnused, connectionOwner(10)],
    [
      exactUnused,
      {
        ...connectionOwner(11),
        controllerId: 'controller_remote_owner02',
      },
    ],
    [
      {
        ...exactUnused,
        providerSessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
      connectionOwner(11),
    ],
    [
      { ...exactUnused, projectId: 'proj_remote_claude02' },
      connectionOwner(11),
    ],
    [{ ...exactUnused, rootPath: otherRoot }, connectionOwner(11)],
    [{ ...exactUnused, effort: 'low' }, connectionOwner(11)],
    [
      { ...exactUnused, providerSessionMaterialized: true },
      connectionOwner(11),
    ],
  ]
  for (const [request, owner] of mismatches) {
    await assert.rejects(
      pool.open(request, owner),
      (error) => error.code === 'conversation_busy',
    )
  }
  assert.equal(retired, 0)
  assert.equal(harness.runtimes.length, 1)

  await runner.startTurn(turnRequest(runner.providerSessionId))
  await assert.rejects(
    pool.open(
      sessionRequest(root, {
        requestId: 'E'.repeat(43),
        providerSessionId: sessionId,
        providerSessionMaterialized: true,
      }),
      connectionOwner(12),
    ),
    (error) => error.code === 'conversation_busy',
  )
  assert.equal(retired, 0)
  assert.equal(harness.runtimes.length, 1)
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
  const events = await collectTurn(turn)
  assert.equal(events[0].failure.reason, 'execution_ownership_uncertain')
  assert.deepEqual(events.map(stripCanonicalFailure), [
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

async function waitForPoolRelease(pool) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (pool.activeCount === 0) return
    await new Promise((resolve) => setImmediate(resolve))
  }
  assert.fail('Timed out waiting for remote Claude pool release')
}

function stripCanonicalFailure(event) {
  const legacyEvent = { ...event }
  delete legacyEvent.failure
  return legacyEvent
}
