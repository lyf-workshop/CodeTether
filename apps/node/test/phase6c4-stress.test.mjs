import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { RemoteClaudeRunnerPool } from '../dist/remote-claude-runner.js'
import { RemoteCodexRunnerPool } from '../dist/remote-codex-runner.js'

const timestamp = '2026-01-01T00:00:00.000Z'
const providerInstallationId = 'pinst_stressfixture01'
const installationRevision = 'prev_stressfixture01'

function codexSessionRequest(rootPath, index) {
  return {
    type: 'codex.session.open',
    protocolVersion: 1,
    requestId: String(index).padStart(43, 'C'),
    expectedMachineId: 'machine_stress_remote',
    expectedNodeId: 'node_stress_remote',
    conversationId: `conv_stress_codex_${String(index).padStart(2, '0')}`,
    projectId: 'proj_stress_remote',
    providerInstallationId,
    expectedInstallationRevision: installationRevision,
    rootPath,
  }
}

function codexTurnRequest(runner, index, suffix = 'a') {
  return {
    type: 'codex.turn.start',
    protocolVersion: 1,
    actionId: `act_stress_codex_${String(index).padStart(2, '0')}_${suffix}`,
    conversationId: runner.conversationId,
    turnId: `turn_stress_codex_${String(index).padStart(2, '0')}_${suffix}`,
    providerThreadId: runner.providerThreadId,
    prompt: `Codex stress marker ${String(index)} ${suffix}`,
  }
}

function claudeSessionRequest(rootPath, index) {
  return {
    type: 'claude.session.open',
    protocolVersion: 1,
    requestId: String(index).padStart(43, 'L'),
    expectedMachineId: 'machine_stress_remote',
    expectedNodeId: 'node_stress_remote',
    conversationId: `conv_stress_claude_${String(index).padStart(2, '0')}`,
    projectId: 'proj_stress_remote',
    providerInstallationId,
    expectedInstallationRevision: installationRevision,
    rootPath,
    effort: 'high',
  }
}

function claudeTurnRequest(runner, index, suffix = 'a') {
  return {
    type: 'claude.turn.start',
    protocolVersion: 1,
    actionId: `act_stress_claude_${String(index).padStart(2, '0')}_${suffix}`,
    conversationId: runner.conversationId,
    turnId: `turn_stress_claude_${String(index).padStart(2, '0')}_${suffix}`,
    providerSessionId: runner.providerSessionId,
    prompt: `Claude stress marker ${String(index)} ${suffix}`,
  }
}

function codedError(code, message = code) {
  return Object.assign(new Error(message), { code })
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createCodexHarness(options = {}) {
  const clients = []
  let remainingStartupFailures = options.startupFailures ?? 0
  return {
    clients,
    factory: async (callbacks) => {
      const index = clients.length
      const providerThreadId = `provider-thread-stress-${String(index)}`
      const providerTurnId = `provider-turn-stress-${String(index)}`
      const record = {
        callbacks,
        closeCount: 0,
        conversationId: undefined,
        providerThreadId,
        providerTurnId,
        startCount: 0,
      }
      clients.push(record)
      return {
        startRemoteTextThread: async () => {
          if (remainingStartupFailures > 0) {
            remainingStartupFailures -= 1
            throw codedError('provider_start_failed')
          }
          return { thread: { id: providerThreadId } }
        },
        resumeRemoteTextThread: async () => ({
          thread: { id: providerThreadId },
        }),
        startRemoteTextTurn: async () => {
          record.startCount += 1
          return {
            turn: { id: providerTurnId, status: 'inProgress' },
          }
        },
        waitForTurn: async () => ({}),
        shutdown: async () => {
          record.closeCount += 1
          await options.closeGate?.promise
          if (options.closeFailure !== undefined) {
            throw options.closeFailure
          }
        },
      }
    },
    clientFor(runner) {
      return clients.find(
        (client) => client.providerThreadId === runner.providerThreadId,
      )
    },
  }
}

class FakeClaudeRuntime {
  listeners = new Set()
  starts = []
  completions = []
  closeCount = 0

  constructor(index, cwd, options = {}) {
    this.sessionId = `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
    this.cwd = cwd
    this.closeGate = options.closeGate
    this.closeFailure = options.closeFailure
  }

  subscribeEvents(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  startTurn(options) {
    this.starts.push(options)
    const completion = deferred()
    this.completions.push(completion)
    return completion.promise
  }

  emit(event) {
    for (const listener of this.listeners) listener(event)
  }

  async close() {
    this.closeCount += 1
    await this.closeGate?.promise
    if (this.closeFailure !== undefined) throw this.closeFailure
  }
}

function createClaudeHarness(options = {}) {
  const runtimes = []
  let remainingStartupFailures = options.startupFailures ?? 0
  return {
    runtimes,
    factory: async ({ cwd }) => {
      if (remainingStartupFailures > 0) {
        remainingStartupFailures -= 1
        throw codedError('provider_start_failed')
      }
      const runtime = new FakeClaudeRuntime(runtimes.length, cwd, options)
      runtimes.push(runtime)
      return runtime
    },
    runtimeFor(runner) {
      return runtimes.find(
        (runtime) => runtime.sessionId === runner.providerSessionId,
      )
    },
  }
}

function emitCodexSuccess(client, marker) {
  const base = {
    provider: 'codex',
    timestamp,
    threadId: client.providerThreadId,
    turnId: client.providerTurnId,
  }
  client.callbacks.onEvent({
    type: 'message.delta',
    ...base,
    itemId: `message_${marker}`,
    delta: marker,
  })
  client.callbacks.onEvent({
    type: 'message.completed',
    ...base,
    itemId: `message_${marker}`,
    message: marker,
  })
  client.callbacks.onEvent({ type: 'turn.completed', ...base })
}

function emitClaudeSuccess(runtime, turn, marker) {
  const base = {
    provider: 'claude-code',
    timestamp,
    threadId: runtime.sessionId,
    turnId: turn.providerTurnId,
    itemId: `message_${marker}`,
  }
  runtime.emit({ type: 'message.delta', ...base, delta: marker })
  runtime.emit({ type: 'message.completed', ...base, message: marker })
  runtime.emit({ type: 'turn.completed', ...base })
  runtime.completions.at(-1).resolve({
    sessionId: runtime.sessionId,
    turnId: turn.providerTurnId,
    finalMessage: marker,
  })
}

async function collect(turn) {
  const events = []
  for await (const event of turn.events()) events.push(event)
  return events
}

async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setImmediate(resolve))
  }
  assert.fail(`Timed out waiting for ${label}`)
}

test('four remote sessions isolate 2 Codex + 2 Claude Turns under same-Conversation contention and full budgets', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'codetether-6c4-matrix-'))
  t.after(async () => await rm(temporary, { recursive: true, force: true }))
  const root = await realpath(temporary)
  const codex = createCodexHarness()
  const claude = createClaudeHarness()
  const codexPool = new RemoteCodexRunnerPool({
    codexHome: root,
    clientFactory: codex.factory,
    maximumSessions: 2,
  })
  const claudePool = new RemoteClaudeRunnerPool({
    runtimeFactory: claude.factory,
    maximumSessions: 2,
  })
  t.after(async () => {
    await Promise.all([codexPool.close(), claudePool.close()])
  })

  const [codexA, codexB, claudeA, claudeB] = await Promise.all([
    codexPool.open(codexSessionRequest(root, 0)),
    codexPool.open(codexSessionRequest(root, 1)),
    claudePool.open(claudeSessionRequest(root, 0)),
    claudePool.open(claudeSessionRequest(root, 1)),
  ])
  assert.equal(codexPool.activeCount, 2)
  assert.equal(claudePool.activeCount, 2)

  const exhausted = await Promise.allSettled([
    codexPool.open(codexSessionRequest(root, 2)),
    claudePool.open(claudeSessionRequest(root, 2)),
  ])
  assert.deepEqual(
    exhausted.map((outcome) =>
      outcome.status === 'rejected' ? outcome.reason.code : 'fulfilled',
    ),
    ['busy', 'busy'],
  )

  const runners = [codexA, codexB, claudeA, claudeB]
  const settledStarts = await Promise.all(
    runners.map(async (runner, index) => {
      const makeRequest = index < 2 ? codexTurnRequest : claudeTurnRequest
      return await Promise.allSettled([
        runner.startTurn(makeRequest(runner, index, 'winner')),
        runner.startTurn(makeRequest(runner, index, 'contender')),
      ])
    }),
  )
  const turns = []
  for (const outcomes of settledStarts) {
    assert.equal(
      outcomes.filter((outcome) => outcome.status === 'fulfilled').length,
      1,
    )
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected')
    assert.equal(rejected.reason.code, 'conversation_busy')
    turns.push(outcomes.find((outcome) => outcome.status === 'fulfilled').value)
  }

  emitCodexSuccess(codex.clientFor(codexA), 'codex-a')
  emitCodexSuccess(codex.clientFor(codexB), 'codex-b')
  emitClaudeSuccess(claude.runtimeFor(claudeA), turns[2], 'claude-a')
  emitClaudeSuccess(claude.runtimeFor(claudeB), turns[3], 'claude-b')
  const eventSets = await Promise.all(turns.map(collect))
  assert.deepEqual(
    eventSets.map((events) => events.map((event) => event.type)),
    [
      ['message.delta', 'message.completed', 'turn.completed'],
      ['message.delta', 'message.completed', 'turn.completed'],
      ['message.delta', 'message.completed', 'turn.completed'],
      ['message.delta', 'message.completed', 'turn.completed'],
    ],
  )
  assert.deepEqual(
    eventSets.map(
      (events) => events.find((event) => event.type === 'message.delta')?.text,
    ),
    ['codex-a', 'codex-b', 'claude-a', 'claude-b'],
  )

  await Promise.all([
    codexPool.release(codexA),
    codexPool.release(codexB),
    claudePool.release(claudeA),
    claudePool.release(claudeB),
  ])
  assert.equal(codexPool.activeCount, 0)
  assert.equal(claudePool.activeCount, 0)
  assert.deepEqual(
    codex.clients.map((client) => client.closeCount),
    [1, 1],
  )
  assert.deepEqual(
    claude.runtimes.map((runtime) => runtime.closeCount),
    [1, 1],
  )
})

test('Claude duplicate and delayed terminal events fail closed without a second terminal publication', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'codetether-6c4-terminal-'))
  t.after(async () => await rm(temporary, { recursive: true, force: true }))
  const root = await realpath(temporary)
  const claude = createClaudeHarness()
  const pool = new RemoteClaudeRunnerPool({ runtimeFactory: claude.factory })
  t.after(async () => await pool.close())

  const duplicateRunner = await pool.open(claudeSessionRequest(root, 10))
  const duplicateTurn = await duplicateRunner.startTurn(
    claudeTurnRequest(duplicateRunner, 10),
  )
  const duplicateRuntime = claude.runtimeFor(duplicateRunner)
  const duplicateBase = {
    provider: 'claude-code',
    timestamp,
    threadId: duplicateRuntime.sessionId,
    turnId: duplicateTurn.providerTurnId,
    itemId: 'message_duplicate',
  }
  duplicateRuntime.emit({
    type: 'message.delta',
    ...duplicateBase,
    delta: 'once',
  })
  duplicateRuntime.emit({
    type: 'message.completed',
    ...duplicateBase,
    message: 'once',
  })
  duplicateRuntime.emit({ type: 'turn.completed', ...duplicateBase })
  duplicateRuntime.emit({ type: 'turn.completed', ...duplicateBase })
  const duplicateEvents = await collect(duplicateTurn)
  assert.equal(
    duplicateEvents.some((event) => event.type === 'turn.completed'),
    false,
  )
  const duplicateFailures = duplicateEvents.filter(
    (event) => event.type === 'turn.failed',
  )
  assert.equal(duplicateFailures.length, 1)
  assert.equal(duplicateFailures[0].code, 'remote_execution_lost')
  assert.equal(duplicateFailures[0].message, 'Remote Claude execution was lost')
  assert.deepEqual(duplicateFailures[0].failure, {
    category: 'runtime',
    reason: 'execution_lost',
    retryability: 'not_retryable',
    userAction: 'view_details',
    source: 'runtime',
    occurredAt: duplicateFailures[0].failure.occurredAt,
    technicalCode: 'execution_lost',
  })
  assert.equal(
    Number.isNaN(Date.parse(duplicateFailures[0].failure.occurredAt)),
    false,
  )
  await waitFor(() => pool.activeCount === 0, 'duplicate cleanup')

  const delayedRunner = await pool.open(claudeSessionRequest(root, 11))
  const delayedTurn = await delayedRunner.startTurn(
    claudeTurnRequest(delayedRunner, 11),
  )
  const delayedRuntime = claude.runtimeFor(delayedRunner)
  emitClaudeSuccess(delayedRuntime, delayedTurn, 'complete-once')
  const delayedEvents = await collect(delayedTurn)
  assert.equal(
    delayedEvents.filter((event) => event.type === 'turn.completed').length,
    1,
  )
  delayedRuntime.emit({
    type: 'turn.completed',
    provider: 'claude-code',
    timestamp,
    threadId: delayedRuntime.sessionId,
    turnId: delayedTurn.providerTurnId,
  })
  await waitFor(() => pool.activeCount === 0, 'delayed terminal cleanup')
  assert.equal(delayedRuntime.closeCount, 1)
})

test('repeated Provider startup and crash cycles leave no owned sessions', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'codetether-6c4-recovery-'))
  t.after(async () => await rm(temporary, { recursive: true, force: true }))
  const root = await realpath(temporary)
  const cycles = 25
  const codex = createCodexHarness({ startupFailures: cycles })
  const claude = createClaudeHarness({ startupFailures: cycles })
  const codexPool = new RemoteCodexRunnerPool({
    codexHome: root,
    clientFactory: codex.factory,
  })
  const claudePool = new RemoteClaudeRunnerPool({
    runtimeFactory: claude.factory,
  })
  t.after(async () => {
    await Promise.all([codexPool.close(), claudePool.close()])
  })

  for (let index = 0; index < cycles; index += 1) {
    const outcomes = await Promise.allSettled([
      codexPool.open(codexSessionRequest(root, 100 + index)),
      claudePool.open(claudeSessionRequest(root, 100 + index)),
    ])
    assert.deepEqual(
      outcomes.map((outcome) =>
        outcome.status === 'rejected' ? outcome.reason.code : 'fulfilled',
      ),
      ['provider_start_failed', 'provider_start_failed'],
    )
    assert.equal(codexPool.activeCount, 0)
    assert.equal(claudePool.activeCount, 0)
  }
  assert.equal(
    codex.clients.slice(0, cycles).every((client) => client.closeCount === 1),
    true,
  )

  for (let index = 0; index < cycles; index += 1) {
    const [codexRunner, claudeRunner] = await Promise.all([
      codexPool.open(codexSessionRequest(root, 200 + index)),
      claudePool.open(claudeSessionRequest(root, 200 + index)),
    ])
    const [codexTurn, claudeTurn] = await Promise.all([
      codexRunner.startTurn(codexTurnRequest(codexRunner, 200 + index)),
      claudeRunner.startTurn(claudeTurnRequest(claudeRunner, 200 + index)),
    ])
    const codexClient = codex.clientFor(codexRunner)
    const claudeRuntime = claude.runtimeFor(claudeRunner)
    codexClient.callbacks.onError(codedError('provider_session_lost'))
    claudeRuntime.completions.at(-1).reject(codedError('provider_session_lost'))
    const [codexEvents, claudeEvents] = await Promise.all([
      collect(codexTurn),
      collect(claudeTurn),
    ])
    assert.deepEqual(
      [codexEvents.at(-1)?.type, claudeEvents.at(-1)?.type],
      ['turn.failed', 'turn.failed'],
    )
    await waitFor(
      () => codexPool.activeCount === 0 && claudePool.activeCount === 0,
      `crash cleanup ${String(index)}`,
    )
    assert.equal(codexClient.closeCount, 1)
    assert.equal(claudeRuntime.closeCount, 1)
  }
})

test('delayed exact release keeps the same Conversation occupied for both Provider pools', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'codetether-6c4-release-'))
  t.after(async () => await rm(temporary, { recursive: true, force: true }))
  const root = await realpath(temporary)
  const codexGate = deferred()
  const claudeGate = deferred()
  const codex = createCodexHarness({ closeGate: codexGate })
  const claude = createClaudeHarness({ closeGate: claudeGate })
  const codexPool = new RemoteCodexRunnerPool({
    codexHome: root,
    clientFactory: codex.factory,
  })
  const claudePool = new RemoteClaudeRunnerPool({
    runtimeFactory: claude.factory,
  })
  t.after(async () => {
    codexGate.resolve()
    claudeGate.resolve()
    await Promise.all([codexPool.close(), claudePool.close()])
  })

  const codexRequest = codexSessionRequest(root, 300)
  const claudeRequest = claudeSessionRequest(root, 300)
  const [codexRunner, claudeRunner] = await Promise.all([
    codexPool.open(codexRequest),
    claudePool.open(claudeRequest),
  ])
  const releasingCodex = codexPool.release(codexRunner)
  const releasingClaude = claudePool.release(claudeRunner)
  await waitFor(
    () =>
      codex.clientFor(codexRunner).closeCount === 1 &&
      claude.runtimeFor(claudeRunner).closeCount === 1,
    'both delayed Provider cleanups to start',
  )

  const blocked = await Promise.allSettled([
    codexPool.open(codexRequest),
    claudePool.open(claudeRequest),
  ])
  assert.deepEqual(
    blocked.map((outcome) =>
      outcome.status === 'rejected' ? outcome.reason.code : 'fulfilled',
    ),
    ['conversation_busy', 'conversation_busy'],
  )
  assert.equal(codexPool.activeCount, 1)
  assert.equal(claudePool.activeCount, 1)

  codexGate.resolve()
  claudeGate.resolve()
  await Promise.all([releasingCodex, releasingClaude])
  assert.equal(codexPool.activeCount, 0)
  assert.equal(claudePool.activeCount, 0)
  const replacements = await Promise.all([
    codexPool.open(codexRequest),
    claudePool.open(claudeRequest),
  ])
  await Promise.all([
    codexPool.release(replacements[0]),
    claudePool.release(replacements[1]),
  ])
})

test('failed exact release permanently fails closed for both Provider pools', async (t) => {
  const temporary = await mkdtemp(
    join(tmpdir(), 'codetether-6c4-release-failure-'),
  )
  t.after(async () => await rm(temporary, { recursive: true, force: true }))
  const root = await realpath(temporary)
  const codexFailure = new Error('private Codex cleanup failure')
  const claudeFailure = new Error('private Claude cleanup failure')
  const codex = createCodexHarness({ closeFailure: codexFailure })
  const claude = createClaudeHarness({ closeFailure: claudeFailure })
  const codexPool = new RemoteCodexRunnerPool({
    codexHome: root,
    clientFactory: codex.factory,
  })
  const claudePool = new RemoteClaudeRunnerPool({
    runtimeFactory: claude.factory,
  })
  t.after(async () => {
    await Promise.all([
      codexPool.close().catch(() => undefined),
      claudePool.close().catch(() => undefined),
    ])
  })

  const codexRequest = codexSessionRequest(root, 400)
  const claudeRequest = claudeSessionRequest(root, 400)
  const [codexRunner, claudeRunner] = await Promise.all([
    codexPool.open(codexRequest),
    claudePool.open(claudeRequest),
  ])
  const releases = await Promise.allSettled([
    codexPool.release(codexRunner),
    claudePool.release(claudeRunner),
  ])
  assert.equal(
    releases.every((outcome) => outcome.status === 'rejected'),
    true,
  )
  assert.equal(codexPool.activeCount, 1)
  assert.equal(claudePool.activeCount, 1)

  const reopens = await Promise.allSettled([
    codexPool.open(codexRequest),
    claudePool.open(claudeRequest),
  ])
  assert.deepEqual(
    reopens.map((outcome) =>
      outcome.status === 'rejected' ? outcome.reason.code : 'fulfilled',
    ),
    ['remote_execution_unavailable', 'remote_execution_unavailable'],
  )
  assert.equal(codex.clients.length, 1)
  assert.equal(claude.runtimes.length, 1)
})
