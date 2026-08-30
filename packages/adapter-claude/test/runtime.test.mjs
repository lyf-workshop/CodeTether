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
  closeOwnedClaudeProcess,
  ClaudeCodeSessionRuntime,
  encodeClaudeUserMessage,
  sanitizeClaudeChildEnvironment,
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
    (error) => error.code === 'provider_unavailable',
  )

  assert.equal(failures[0].code, 'provider_unavailable')
  assert.doesNotMatch(failures[0].message, /private|diagnostic|credential/)
  assert.deepEqual(
    events.map((event) => event.type),
    ['conversation.started', 'turn.started', 'turn.failed'],
  )
  assert.doesNotMatch(
    JSON.stringify(events),
    /OAuth|token expired|private provider diagnostic/,
  )
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
    (error) => error.code === 'provider_start_failed',
  )

  assert.equal(failures[0].code, 'provider_start_failed')
  assert.doesNotMatch(failures[0].message, /private|diagnostic|credential/)
  assert.equal(events.at(-1).type, 'turn.failed')
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
