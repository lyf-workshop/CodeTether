import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
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

function createHarness(options = {}) {
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
    client: new CodexAppServerClient(child, options),
    written,
  }
}

async function nextTurn() {
  await new Promise((resolve) => setImmediate(resolve))
}

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
