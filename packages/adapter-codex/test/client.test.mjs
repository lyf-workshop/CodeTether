import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'

import { CodexAppServerClient } from '../dist/index.js'

class FakeChildProcess extends EventEmitter {
  constructor() {
    super()
    this.stdin = new PassThrough()
    this.stdout = new PassThrough()
    this.stderr = new PassThrough()
    this.exitCode = null
    this.signalCode = null
  }

  kill(signal = 'SIGTERM') {
    this.signalCode = signal
    this.emit('exit', null, signal)
    this.emit('close', null, signal)
    return true
  }
}

function createHarness(options = {}, executionProfile = 'local') {
  const child = new FakeChildProcess()
  const written = []
  let buffered = ''

  child.stdin.on('data', (chunk) => {
    buffered += chunk.toString('utf8')
    let newlineIndex = buffered.indexOf('\n')
    while (newlineIndex >= 0) {
      const line = buffered.slice(0, newlineIndex)
      buffered = buffered.slice(newlineIndex + 1)
      if (line.length > 0) written.push(JSON.parse(line))
      newlineIndex = buffered.indexOf('\n')
    }
  })

  return {
    child,
    client: new CodexAppServerClient(child, options, executionProfile),
    written,
  }
}

async function nextTurn() {
  await new Promise((resolve) => setImmediate(resolve))
}

test('local initialization capabilities remain unchanged', async () => {
  const { child, client, written } = createHarness()
  const initialized = client.initialize({
    name: 'codetether',
    title: 'CodeTether',
    version: 'test',
  })
  await nextTurn()

  assert.deepEqual(written[0], {
    id: written[0].id,
    method: 'initialize',
    params: {
      clientInfo: {
        name: 'codetether',
        title: 'CodeTether',
        version: 'test',
      },
      capabilities: {
        experimentalApi: false,
        requestAttestation: false,
      },
    },
  })
  child.stdout.write(
    `${JSON.stringify({
      id: written[0].id,
      result: {
        userAgent: 'codex-test',
        codexHome: '/isolated',
        platformFamily: 'unix',
        platformOs: 'linux',
      },
    })}\n`,
  )
  await initialized
  await nextTurn()
  assert.deepEqual(written[1], { method: 'initialized' })
})

test('remote text-only thread, resume, and turn requests are fixed', async () => {
  const cwd = resolve('remote project with spaces')
  const { child, client, written } = createHarness({}, 'remote-text-only')

  const startedThread = client.startRemoteTextThread({ cwd })
  await nextTurn()
  assert.deepEqual(written[0], {
    id: written[0].id,
    method: 'thread/start',
    params: {
      cwd,
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandbox: 'read-only',
      ephemeral: false,
      environments: [],
      runtimeWorkspaceRoots: [],
      dynamicTools: [],
      selectedCapabilityRoots: [],
      config: {
        web_search: 'disabled',
        tools: {
          update_plan: { enabled: false },
          experimental_request_user_input: { enabled: false },
        },
        orchestrator: {
          skills: { enabled: false },
          mcp: { enabled: false },
        },
      },
      serviceName: 'CodeTether',
    },
  })
  child.stdout.write(
    `${JSON.stringify({
      id: written[0].id,
      result: {
        thread: { id: 'thread-remote', cwd },
        model: 'gpt-5',
        modelProvider: 'openai',
        cwd,
      },
    })}\n`,
  )
  assert.equal((await startedThread).thread.id, 'thread-remote')

  const resumedThread = client.resumeRemoteTextThread({
    threadId: 'thread-remote',
    cwd,
  })
  await nextTurn()
  assert.deepEqual(written[1], {
    id: written[1].id,
    method: 'thread/resume',
    params: {
      threadId: 'thread-remote',
      cwd,
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandbox: 'read-only',
      runtimeWorkspaceRoots: [],
      config: {
        web_search: 'disabled',
        tools: {
          update_plan: { enabled: false },
          experimental_request_user_input: { enabled: false },
        },
        orchestrator: {
          skills: { enabled: false },
          mcp: { enabled: false },
        },
      },
    },
  })
  child.stdout.write(
    `${JSON.stringify({
      id: written[1].id,
      result: {
        thread: { id: 'thread-remote', cwd },
        model: 'gpt-5',
        modelProvider: 'openai',
        cwd,
      },
    })}\n`,
  )
  assert.equal((await resumedThread).thread.id, 'thread-remote')

  const startedTurn = client.startRemoteTextTurn({
    threadId: 'thread-remote',
    prompt: 'bounded prompt',
  })
  await nextTurn()
  assert.deepEqual(written[2], {
    id: written[2].id,
    method: 'turn/start',
    params: {
      threadId: 'thread-remote',
      input: [
        {
          type: 'text',
          text: 'bounded prompt',
          text_elements: [],
        },
      ],
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
      environments: [],
      runtimeWorkspaceRoots: [],
    },
  })
  child.stdout.write(
    `${JSON.stringify({
      id: written[2].id,
      result: { turn: { id: 'turn-remote', status: 'inProgress' } },
    })}\n`,
  )
  assert.equal((await startedTurn).turn.id, 'turn-remote')
})

test('local and remote client operations cannot cross execution profiles', async () => {
  const cwd = resolve('remote-profile-boundary')
  const local = createHarness().client
  const remote = createHarness({}, 'remote-text-only').client

  await assert.rejects(
    local.startRemoteTextThread({ cwd }),
    /Operation is unavailable for Codex execution profile local/,
  )
  await assert.rejects(
    remote.startThread({ cwd }),
    /Operation is unavailable for Codex execution profile remote-text-only/,
  )
  await assert.rejects(
    remote.interruptTurn({ threadId: 'thread', turnId: 'turn' }),
    /Operation is unavailable for Codex execution profile remote-text-only/,
  )
})

test('notification policy rejects raw provider events before normalization', async () => {
  const diagnostics = []
  const { child, client } = createHarness({
    validateNotification: (notification) => {
      if (notification.method.startsWith('item/commandExecution/')) {
        throw new Error('tool notification denied')
      }
    },
    onError: (error) => diagnostics.push(error.message),
  })
  const terminal = client.waitForTurn('thread-remote', 'turn-remote', 1_000)

  writeNotification(child, 'item/commandExecution/started', {
    threadId: 'thread-remote',
    turnId: 'turn-remote',
    item: { id: 'command', type: 'commandExecution' },
  })

  await assert.rejects(
    terminal,
    /Codex notification was rejected by the execution policy/,
  )
  assert.deepEqual(client.observedRawMethods, [])
  assert.deepEqual(diagnostics, [
    'Codex notification was rejected by the execution policy',
  ])
})

test('remote text-only profile rejects every server request fail closed', async () => {
  const diagnostics = []
  const { child, client, written } = createHarness(
    { onError: (error) => diagnostics.push(error.message) },
    'remote-text-only',
  )
  const terminal = client.waitForTurn('thread-remote', 'turn-remote', 1_000)
  const terminalRejected = assert.rejects(
    terminal,
    /Remote text-only Codex emitted an unsupported server request/,
  )

  child.stdout.write(
    `${JSON.stringify({
      id: 94,
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thread-remote',
        turnId: 'turn-remote',
        itemId: 'command',
        command: 'echo unsafe',
      },
    })}\n`,
  )
  await nextTurn()

  assert.deepEqual(written, [
    {
      id: 94,
      error: {
        code: -32601,
        message: 'Remote text-only execution does not accept server requests',
      },
    },
  ])
  await terminalRejected
  assert.deepEqual(diagnostics, [
    'Remote text-only Codex emitted an unsupported server request',
  ])
})

test('emits and answers a one-shot command approval request', async () => {
  const events = []
  const { child, written } = createHarness({
    approvalHandler: () => 'allow',
    onEvent: (event) => events.push(event),
  })

  child.stdout.write(
    `${JSON.stringify({
      id: 41,
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'command-1',
        startedAtMs: 1_777_777_777_000,
        environmentId: null,
        command: 'git status --short',
      },
    })}\n`,
  )
  await nextTurn()

  assert.equal(events.length, 1)
  assert.equal(events[0].type, 'approval.requested')
  assert.equal(events[0].approvalId, '41')
  assert.deepEqual(written, [{ id: 41, result: { decision: 'accept' } }])
})

test('routes interleaved turns and threads without mixing final messages', async () => {
  const { child, client } = createHarness()
  const turnA1 = client.waitForTurn('thread-a', 'turn-a1', 1_000)
  const turnB1 = client.waitForTurn('thread-b', 'turn-b1', 1_000)

  writeNotification(child, 'turn/started', {
    threadId: 'thread-a',
    turn: { id: 'turn-a1', status: 'inProgress' },
  })
  writeNotification(child, 'turn/started', {
    threadId: 'thread-b',
    turn: { id: 'turn-b1', status: 'inProgress' },
  })
  writeNotification(child, 'item/agentMessage/delta', {
    threadId: 'thread-a',
    turnId: 'turn-a1',
    itemId: 'message-a',
    delta: 'alpha ',
  })
  writeNotification(child, 'item/agentMessage/delta', {
    threadId: 'thread-b',
    turnId: 'turn-b1',
    itemId: 'message-b',
    delta: 'beta',
  })
  writeNotification(child, 'item/agentMessage/delta', {
    threadId: 'thread-a',
    turnId: 'turn-a1',
    itemId: 'message-a',
    delta: 'done',
  })
  writeNotification(child, 'item/completed', {
    threadId: 'thread-b',
    turnId: 'turn-b1',
    item: {
      id: 'message-b',
      type: 'agentMessage',
      text: 'beta',
    },
  })
  writeNotification(child, 'item/completed', {
    threadId: 'thread-a',
    turnId: 'turn-a1',
    item: {
      id: 'message-a',
      type: 'agentMessage',
      text: 'alpha done',
    },
  })
  completeTurn(child, 'thread-b', 'turn-b1')
  completeTurn(child, 'thread-a', 'turn-a1')

  assert.equal((await turnA1).finalMessage, 'alpha done')
  assert.equal((await turnB1).finalMessage, 'beta')

  const turnA2 = client.waitForTurn('thread-a', 'turn-a2', 1_000)
  writeNotification(child, 'turn/started', {
    threadId: 'thread-a',
    turn: { id: 'turn-a2', status: 'inProgress' },
  })
  writeNotification(child, 'item/completed', {
    threadId: 'thread-a',
    turnId: 'turn-a2',
    item: {
      id: 'message-a2',
      type: 'agentMessage',
      text: 'second turn',
    },
  })
  completeTurn(child, 'thread-a', 'turn-a2')
  assert.equal((await turnA2).finalMessage, 'second turn')
})

test('keeps the newer active turn when an older completion arrives late', async () => {
  const events = []
  const { child, written } = createHarness({
    approvalHandler: () => 'allow',
    onEvent: (event) => events.push(event),
  })
  writeNotification(child, 'turn/started', {
    threadId: 'thread-a',
    turn: { id: 'turn-old', status: 'inProgress' },
  })
  writeNotification(child, 'turn/started', {
    threadId: 'thread-a',
    turn: { id: 'turn-new', status: 'inProgress' },
  })
  completeTurn(child, 'thread-a', 'turn-old')
  child.stdout.write(
    `${JSON.stringify({
      id: 52,
      method: 'execCommandApproval',
      params: {
        conversationId: 'thread-a',
        callId: 'call-1',
        approvalId: null,
        command: ['git', 'status'],
        cwd: 'C:/spike',
        reason: null,
        parsedCmd: [],
      },
    })}\n`,
  )
  await nextTurn()

  const approval = events.find((event) => event.type === 'approval.requested')
  assert.equal(approval.turnId, 'turn-new')
  assert.deepEqual(written.at(-1), {
    id: 52,
    result: { decision: 'approved' },
  })
})

test('settles a completed turn even when the event callback throws', async () => {
  const diagnostics = []
  const { child, client } = createHarness({
    onEvent: () => {
      throw new Error('consumer exploded')
    },
    onError: (error) => diagnostics.push(error.message),
  })
  const terminal = client.waitForTurn('thread-a', 'turn-a', 1_000)
  completeTurn(child, 'thread-a', 'turn-a')

  assert.equal((await terminal).turn.status, 'completed')
  assert.ok(diagnostics.some((message) => message.includes('event consumer')))
})

test('rejects pending turn waiters immediately during clean shutdown', async () => {
  const { child, client } = createHarness()
  const terminal = client.waitForTurn('thread-a', 'turn-a', 60_000)
  child.exitCode = 0
  await client.shutdown()

  await assert.rejects(terminal, /Codex App Server closed/)
})

test('drains a shutdown-only approval decision before closing provider stdin', async () => {
  let releaseApproval
  const approvalDecision = new Promise((resolve) => {
    releaseApproval = resolve
  })
  const diagnostics = []
  const { child, client, written } = createHarness({
    approvalHandler: async () => await approvalDecision,
    onError: (error) => diagnostics.push(error.message),
  })
  child.stdin.once('finish', () => {
    child.exitCode = 0
    child.emit('exit', 0, null)
    child.emit('close', 0, null)
  })

  child.stdout.write(
    `${JSON.stringify({
      id: 71,
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thread-a',
        turnId: 'turn-a',
        itemId: 'command-a',
        startedAtMs: 1_777_777_777_000,
        environmentId: null,
        command: 'git status --short',
      },
    })}\n`,
  )
  await nextTurn()

  releaseApproval('deny')
  await client.shutdown()

  assert.deepEqual(written, [
    {
      id: 71,
      result: { decision: 'decline' },
    },
  ])
  assert.deepEqual(diagnostics, [])
})

test('sends schema-shaped resume and interrupt requests', async () => {
  const { child, client, written } = createHarness()
  const cwd = resolve('spike')
  const resumed = client.resumeThread({
    threadId: 'thread-a',
    cwd,
    approvalPolicy: 'on-request',
    sandbox: 'workspace-write',
  })
  await nextTurn()
  assert.equal(written[0].method, 'thread/resume')
  child.stdout.write(
    `${JSON.stringify({
      id: written[0].id,
      result: {
        thread: { id: 'thread-a' },
        model: 'gpt-5',
        modelProvider: 'openai',
        cwd,
      },
    })}\n`,
  )
  assert.equal((await resumed).thread.id, 'thread-a')

  const interrupted = client.interruptTurn({
    threadId: 'thread-a',
    turnId: 'turn-a',
  })
  await nextTurn()
  assert.equal(written[1].method, 'turn/interrupt')
  child.stdout.write(`${JSON.stringify({ id: written[1].id, result: {} })}\n`)
  assert.deepEqual(await interrupted, {})
})

test('rejects an unknown server request without params and stays usable', async () => {
  const unknown = []
  const errors = []
  const { child, written } = createHarness({
    onUnknownServerRequest: (request) => unknown.push(request.method),
    onError: (error) => errors.push(error),
  })

  child.stdout.write('{"id":42,"method":"future/request"}\n')
  await nextTurn()

  assert.deepEqual(unknown, ['future/request'])
  assert.deepEqual(errors, [])
  assert.deepEqual(written, [
    {
      id: 42,
      error: {
        code: -32601,
        message: 'Unsupported server request: future/request',
      },
    },
  ])
})

test('rejects an unbound known approval request without failing the client', async () => {
  const { child, written } = createHarness()
  child.stdout.write(
    `${JSON.stringify({
      id: 61,
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thread-a',
        itemId: 'command-a',
        startedAtMs: 1_777_777_777_000,
        environmentId: null,
        command: 'git status',
      },
    })}\n`,
  )
  await nextTurn()

  assert.deepEqual(written, [
    {
      id: 61,
      error: {
        code: -32602,
        message:
          'Approval request cannot be bound to a thread and turn: item/commandExecution/requestApproval',
      },
    },
  ])
})

function writeNotification(child, method, params) {
  child.stdout.write(`${JSON.stringify({ method, params })}\n`)
}

function completeTurn(child, threadId, turnId, status = 'completed') {
  writeNotification(child, 'turn/completed', {
    threadId,
    turn: { id: turnId, status, error: null },
  })
}
