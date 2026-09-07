import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  buildClaudeCodeArguments,
  CLAUDE_CODE_RUNTIME_CLI_CONTRACT,
  closeOwnedClaudeProcess,
  ClaudeCodeSessionRuntime,
  encodeClaudeUserMessage,
  sanitizeClaudeChildEnvironment,
  startClaudeCodeTurnProcess,
} from '../dist/index.js'

const fixture = fileURLToPath(
  new URL('./fixtures/fake-claude.mjs', import.meta.url),
)
const launcher = {
  kind: 'native',
  executable: process.execPath,
  prefixArguments: [fixture],
  sourcePath: process.execPath,
}
const fixtureLauncher = (...prefixArguments) => ({
  ...launcher,
  prefixArguments: [fixture, ...prefixArguments],
})
const sessionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

test('builds the locked-down argv and never places a prompt in it', () => {
  const arguments_ = buildClaudeCodeArguments({ sessionId, resume: false })
  assert.deepEqual(arguments_, [
    '--print',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--session-id',
    sessionId,
    '--restricted',
    '--strict-mcp-config',
    '--tools',
    'Read,Glob,Grep',
    '--allowedTools',
    'Read,Glob,Grep',
    '--permission-mode',
    'dontAsk',
    '--no-chrome',
    '--disable-slash-commands',
  ])
  assert.ok(!arguments_.some((argument) => argument.includes('secret prompt')))

  const lowEffort = buildClaudeCodeArguments({
    sessionId,
    resume: true,
    effort: 'low',
  })
  assert.deepEqual(
    lowEffort.slice(
      lowEffort.indexOf('--effort'),
      lowEffort.indexOf('--effort') + 2,
    ),
    ['--effort', 'low'],
  )
  assert.throws(
    () =>
      buildClaudeCodeArguments({
        sessionId,
        resume: false,
        effort: 'unsupported',
      }),
    /supported Claude Code level/u,
  )
})

test('lifecycle probing and execution share one exact CLI flag contract', () => {
  const observedFlags = new Set([
    ...CLAUDE_CODE_RUNTIME_CLI_CONTRACT.executionFlags,
    ...CLAUDE_CODE_RUNTIME_CLI_CONTRACT.streamingFlags,
    ...CLAUDE_CODE_RUNTIME_CLI_CONTRACT.nativeResumeFlags,
    ...CLAUDE_CODE_RUNTIME_CLI_CONTRACT.reasoningControlFlags,
  ])
  const executionFlags = new Set(
    [
      ...buildClaudeCodeArguments({ sessionId, resume: false }),
      ...buildClaudeCodeArguments({
        sessionId,
        resume: true,
        effort: 'max',
      }),
    ].filter((argument) => argument.startsWith('--')),
  )

  assert.deepEqual(executionFlags, observedFlags)
})

test('admits only bounded Claude runtime context and explicit auth inputs', () => {
  assert.deepEqual(
    sanitizeClaudeChildEnvironment({
      Path: 'runtime-path',
      ANTHROPIC_API_KEY: 'fixture-auth',
      HTTPS_PROXY: 'https://proxy.invalid',
      CLAUDECODE: '1',
      claude_code_session_id: 'parent-session',
      GITHUB_TOKEN: 'must-not-cross',
      AWS_SECRET_ACCESS_KEY: 'must-not-cross',
      NODE_OPTIONS: '--require=must-not-cross',
      CODETETHER_AUDIT_SECRET: 'must-not-cross',
    }),
    {
      Path: 'runtime-path',
      ANTHROPIC_API_KEY: 'fixture-auth',
      HTTPS_PROXY: 'https://proxy.invalid',
    },
  )
})

test('creates cold, streams one child per turn, then resumes the exact session', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'CodeTether Claude 测试 '))
  const capturePath = join(cwd, 'capture.jsonl')
  t.after(async () => {
    await import('node:fs/promises').then(({ rm }) =>
      rm(cwd, { recursive: true, force: true }),
    )
  })
  const runtime = ClaudeCodeSessionRuntime.createSession({
    launcher: fixtureLauncher('--fixture-capture=capture.jsonl'),
    sessionId,
    cwd,
    environment: {
      ...process.env,
      ANTHROPIC_API_KEY: 'fixture-auth',
      CLAUDECODE: '1',
      CLAUDE_CODE_SESSION_ID: 'parent-session',
    },
  })
  const events = []
  runtime.subscribeEvents((event) => events.push(event))

  const first = await runtime.startTurn({
    turnId: 'turn_first',
    prompt: 'secret prompt first',
    effort: 'low',
  })
  const second = await runtime.startTurn({
    turnId: 'turn_second',
    prompt: 'secret prompt second',
    effort: 'low',
  })
  await runtime.close()

  assert.equal(first.finalMessage, 'HELLO')
  assert.equal(second.sessionId, sessionId)
  assert.deepEqual(
    events
      .filter((event) => event.type === 'message.delta')
      .map((event) => event.delta),
    ['HELLO', 'HELLO'],
  )
  assert.equal(
    events.filter((event) => event.type === 'message.completed').length,
    2,
  )

  const captures = (await readFile(capturePath, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  assert.equal(captures.length, 2)
  assert.equal(captures[0].cwd, cwd)
  assert.equal(captures[0].inheritedControl, false)
  assert.equal(captures[0].preservedAuth, true)
  assert.ok(captures[0].arguments.includes('--session-id'))
  assert.deepEqual(
    captures[0].arguments.slice(
      captures[0].arguments.indexOf('--effort'),
      captures[0].arguments.indexOf('--effort') + 2,
    ),
    ['--effort', 'low'],
  )
  assert.ok(
    !captures[0].arguments.some((value) => value.includes('secret prompt')),
  )
  assert.ok(captures[1].arguments.includes('--resume'))
  assert.ok(!captures[1].arguments.includes('--session-id'))
  assert.deepEqual(JSON.parse(captures[0].input), {
    type: 'user',
    message: { role: 'user', content: 'secret prompt first' },
    parent_tool_use_id: null,
  })
})

test('startup ownership rejects ENOENT before any canonical started event', async () => {
  const events = []
  const handle = startClaudeCodeTurnProcess({
    launcher: {
      kind: 'native',
      executable: join(tmpdir(), 'codetether-definitely-missing-claude'),
      prefixArguments: [],
      sourcePath: join(tmpdir(), 'codetether-definitely-missing-claude'),
    },
    sessionId,
    turnId: 'turn_missing_executable',
    cwd: process.cwd(),
    prompt: 'bounded input',
    resume: false,
    onEvent: (event) => events.push(event),
  })
  await assert.rejects(
    handle.ownershipEstablished,
    (error) =>
      error.code === 'provider_start_failed' &&
      error.failureReason === 'provider_start_failed',
  )
  await assert.rejects(
    handle.completion,
    (error) =>
      error.code === 'provider_start_failed' &&
      error.failureReason === 'provider_start_failed',
  )
  assert.equal(
    events.some((event) => event.type === 'turn.started'),
    false,
  )
})

test('post-Prompt ownership acknowledgement loss fails closed without safe replay', async () => {
  const events = []
  const handle = startClaudeCodeTurnProcess({
    launcher: fixtureLauncher('--fixture-scenario=hang'),
    sessionId,
    turnId: 'turn_uncertain_ownership',
    cwd: process.cwd(),
    prompt: 'bounded input',
    resume: false,
    processFactory: (specification) => {
      const child = spawn(specification.executable, specification.arguments, {
        cwd: specification.cwd,
        env: specification.environment,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const ownershipEstablished = new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error('PRIVATE ownership acknowledgement detail')),
          25,
        )
      })
      return {
        child,
        ownershipEstablished,
        async close(graceMs) {
          await closeOwnedClaudeProcess(child, graceMs)
        },
      }
    },
    onEvent: (event) => events.push(event),
  })

  await assert.rejects(
    handle.ownershipEstablished,
    (error) =>
      error.code === 'provider_start_failed' &&
      error.failureReason === 'execution_ownership_uncertain' &&
      !error.message.includes('PRIVATE'),
  )
  await assert.rejects(
    handle.completion,
    (error) => error.failureReason === 'execution_ownership_uncertain',
  )
  assert.equal(
    events.at(-1)?.error?.failure?.reason,
    'execution_ownership_uncertain',
  )
})

test('post-Prompt event-consumer failure is ownership-uncertain, never replay-safe startup failure', async () => {
  const events = []
  let rejected = false
  const handle = startClaudeCodeTurnProcess({
    launcher: fixtureLauncher(),
    sessionId,
    turnId: 'turn_consumer_failure_after_delivery',
    cwd: process.cwd(),
    prompt: 'bounded input',
    resume: false,
    onEvent: async (event) => {
      events.push(event)
      if (!rejected && event.type === 'message.delta') {
        rejected = true
        throw new Error('PRIVATE downstream callback detail')
      }
    },
  })

  await handle.ownershipEstablished
  await assert.rejects(
    handle.completion,
    (error) =>
      error.failureReason === 'execution_ownership_uncertain' &&
      !error.message.includes('PRIVATE'),
  )
  assert.equal(
    events.some((event) => event.type === 'turn.completed'),
    false,
  )
})

test('post-ownership Provider exit is unavailable rather than startup failure', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'codetether-claude-crash-'))
  t.after(async () => {
    await import('node:fs/promises').then(({ rm }) =>
      rm(cwd, { recursive: true, force: true }),
    )
  })
  const events = []
  const handle = startClaudeCodeTurnProcess({
    launcher: fixtureLauncher('--fixture-scenario=after-delta-crash'),
    sessionId,
    turnId: 'turn_after_delta_crash',
    cwd,
    prompt: 'bounded input',
    resume: false,
    onEvent: (event) => events.push(event),
  })
  await handle.ownershipEstablished
  await assert.rejects(
    handle.completion,
    (error) =>
      error.code === 'provider_unavailable' &&
      error.failureReason === 'provider_crashed',
  )
  assert.equal(
    events.some((event) => event.type === 'message.delta'),
    true,
  )
  assert.equal(events.at(-1).type, 'turn.failed')
  assert.equal(events.at(-1).error.failure.reason, 'provider_crashed')
})

test('slow async listeners apply bounded stdout pause and resume', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'codetether-claude-backpressure-'))
  t.after(async () => {
    await import('node:fs/promises').then(({ rm }) =>
      rm(cwd, { recursive: true, force: true }),
    )
  })
  let pauses = 0
  let resumes = 0
  const runtime = ClaudeCodeSessionRuntime.createSession({
    launcher: fixtureLauncher('--fixture-scenario=burst'),
    sessionId,
    cwd,
    processFactory: (specification) => {
      const child = spawn(specification.executable, specification.arguments, {
        cwd: specification.cwd,
        env: specification.environment,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const pause = child.stdout.pause.bind(child.stdout)
      const resume = child.stdout.resume.bind(child.stdout)
      child.stdout.pause = () => {
        pauses += 1
        return pause()
      }
      child.stdout.resume = () => {
        resumes += 1
        return resume()
      }
      return {
        child,
        close: async () => await closeOwnedClaudeProcess(child, 250),
      }
    },
  })
  const events = []
  runtime.subscribeEvents(async (event) => {
    events.push(event)
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
  const result = await runtime.startTurn({
    turnId: 'turn_backpressure',
    prompt: 'bounded input',
  })
  assert.equal(result.finalMessage, 'X'.repeat(40))
  assert.ok(pauses >= 1)
  assert.ok(resumes >= 1)
  assert.equal(
    events.filter((event) => event.type === 'message.delta').length,
    40,
  )
  await runtime.close()
})

test('resumeSession uses native resume on its first lazy turn', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'codetether-claude-resume-'))
  const capturePath = join(cwd, 'capture.jsonl')
  t.after(async () => {
    await import('node:fs/promises').then(({ rm }) =>
      rm(cwd, { recursive: true, force: true }),
    )
  })
  const runtime = ClaudeCodeSessionRuntime.resumeSession({
    launcher: fixtureLauncher('--fixture-capture=capture.jsonl'),
    sessionId,
    cwd,
    environment: {
      ...process.env,
    },
  })
  await runtime.startTurn({ turnId: 'turn_resume', prompt: 'resume input' })
  const capture = JSON.parse((await readFile(capturePath, 'utf8')).trim())
  assert.ok(capture.arguments.includes('--resume'))
  assert.ok(!capture.arguments.includes('--session-id'))
})

test('suppresses expired OAuth assistant diagnostics from canonical events', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'codetether-claude-failure-'))
  t.after(async () => {
    await import('node:fs/promises').then(({ rm }) =>
      rm(cwd, { recursive: true, force: true }),
    )
  })
  const runtime = ClaudeCodeSessionRuntime.createSession({
    launcher: fixtureLauncher('--fixture-scenario=auth-error'),
    sessionId,
    cwd,
    environment: {
      ...process.env,
    },
  })
  const failures = []
  const events = []
  runtime.subscribeFailures((failure) => failures.push(failure))
  runtime.subscribeEvents((event) => events.push(event))

  await assert.rejects(
    runtime.startTurn({
      turnId: 'turn_auth_error',
      prompt: 'bounded input',
    }),
    (error) =>
      error.code === 'provider_unavailable' &&
      error.failureReason === 'authentication_invalid',
  )

  assert.equal(failures[0].code, 'provider_unavailable')
  assert.equal(failures[0].failureReason, 'authentication_invalid')
  assert.doesNotMatch(failures[0].message, /private|diagnostic|credential/)
  assert.deepEqual(
    events.map((event) => event.type),
    ['conversation.started', 'turn.started', 'turn.failed'],
  )
  assert.doesNotMatch(
    JSON.stringify(events),
    /OAuth|token expired|private provider diagnostic/,
  )
  assert.equal(events.at(-1).error.failure.reason, 'authentication_invalid')
  await runtime.close()
})

test('reports malformed provider output as a safe start failure', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'codetether-claude-malformed-'))
  t.after(async () => {
    await import('node:fs/promises').then(({ rm }) =>
      rm(cwd, { recursive: true, force: true }),
    )
  })
  const runtime = ClaudeCodeSessionRuntime.createSession({
    launcher: fixtureLauncher('--fixture-scenario=malformed'),
    sessionId,
    cwd,
    environment: {
      ...process.env,
    },
  })
  const failures = []
  const events = []
  runtime.subscribeFailures((failure) => failures.push(failure))
  runtime.subscribeEvents((event) => events.push(event))

  await assert.rejects(
    runtime.startTurn({
      turnId: 'turn_malformed',
      prompt: 'bounded input',
    }),
    (error) =>
      error.code === 'provider_start_failed' &&
      error.failureReason === 'provider_protocol_error',
  )

  assert.equal(failures[0].code, 'provider_start_failed')
  assert.equal(failures[0].failureReason, 'provider_protocol_error')
  assert.doesNotMatch(failures[0].message, /private|diagnostic|credential/)
  assert.equal(events.at(-1).type, 'turn.failed')
  assert.equal(events.at(-1).error.failure.reason, 'provider_protocol_error')
  await runtime.close()
})

test('owner close emits interrupted without reporting a Provider failure', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'codetether-claude-interrupt-'))
  t.after(async () => {
    await import('node:fs/promises').then(({ rm }) =>
      rm(cwd, { recursive: true, force: true }),
    )
  })
  const runtime = ClaudeCodeSessionRuntime.createSession({
    launcher: fixtureLauncher('--fixture-scenario=hang'),
    sessionId,
    cwd,
    environment: { ...process.env },
  })
  const events = []
  const failures = []
  let resolveStarted
  const started = new Promise((resolve) => {
    resolveStarted = resolve
  })
  runtime.subscribeEvents((event) => {
    events.push(event)
    if (event.type === 'turn.started') resolveStarted()
  })
  runtime.subscribeFailures((failure) => failures.push(failure))

  const turn = runtime.startTurn({
    turnId: 'turn_owner_close',
    prompt: 'bounded input',
  })
  const interrupted = assert.rejects(
    turn,
    (error) => error.name === 'ClaudeCodeTurnInterruptedError',
  )
  await started
  await runtime.close()
  await interrupted

  assert.equal(events.at(-1).type, 'turn.interrupted')
  assert.equal(events.filter((event) => event.type === 'turn.failed').length, 0)
  assert.equal(failures.length, 0)
})

test('close terminates only the exact owned Claude child', async () => {
  const child = spawn(
    process.execPath,
    [fixture, ...buildClaudeCodeArguments({ sessionId, resume: false })],
    {
      cwd: process.cwd(),
      env: { ...process.env, FAKE_CLAUDE_SCENARIO: 'hang' },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )
  const unrelated = spawn(
    process.execPath,
    ['-e', 'setInterval(() => undefined, 60000)'],
    {
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
    },
  )
  try {
    child.stdin.end(encodeClaudeUserMessage('fixture only'))
    await once(child.stdout, 'data')
    await closeOwnedClaudeProcess(child, 250)
    assert.notEqual(child.exitCode ?? child.signalCode, null)
    assert.equal(unrelated.exitCode, null)
    assert.equal(unrelated.signalCode, null)
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
    }
    if (unrelated.exitCode === null && unrelated.signalCode === null) {
      unrelated.kill('SIGKILL')
      await once(unrelated, 'close')
    }
  }
})

test(
  'opt-in POSIX process-group ownership cleans exact descendants only',
  { skip: process.platform === 'win32' },
  async () => {
    const groupLeader = spawn(
      process.execPath,
      [
        '-e',
        [
          "const { spawn } = require('node:child_process')",
          "const child = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 60000)'], { stdio: 'ignore' })",
          'process.stdout.write(String(child.pid) + "\\n")',
          'setInterval(() => undefined, 60000)',
        ].join(';'),
      ],
      {
        detached: true,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    const unrelated = spawn(
      process.execPath,
      ['-e', 'setInterval(() => undefined, 60000)'],
      { shell: false, stdio: 'ignore' },
    )
    const [chunk] = await once(groupLeader.stdout, 'data')
    const descendantPid = Number(String(chunk).trim())
    assert.ok(Number.isSafeInteger(descendantPid) && descendantPid > 0)
    try {
      await closeOwnedClaudeProcess(groupLeader, 250, 'posix-process-group')
      assert.equal(processExists(descendantPid), false)
      assert.equal(unrelated.exitCode, null)
      assert.equal(unrelated.signalCode, null)
    } finally {
      if (processExists(descendantPid)) {
        try {
          process.kill(descendantPid, 'SIGKILL')
        } catch {
          // The process may have exited between the liveness check and signal.
        }
      }
      if (groupLeader.exitCode === null && groupLeader.signalCode === null) {
        groupLeader.kill('SIGKILL')
      }
      if (unrelated.exitCode === null && unrelated.signalCode === null) {
        unrelated.kill('SIGKILL')
        await once(unrelated, 'close')
      }
    }
  },
)

function processExists(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code !== 'ESRCH'
  }
}
