import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import { PassThrough } from 'node:stream'
import test from 'node:test'

import {
  CodexExecutableNotFoundError,
  CodexProcessError,
  CodexProcessExitError,
  CodexProtocolError,
  JsonRpcLineTooLongError,
  JsonRpcRemoteError,
  JsonRpcTransport,
} from '../dist/index.js'

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
    transport: new JsonRpcTransport(child, {
      requestTimeoutMs: 1_000,
      ...options,
    }),
    written,
  }
}

async function nextTurn() {
  await new Promise((resolve) => setImmediate(resolve))
}

test('matches JSON-RPC responses to pending requests', async () => {
  const { child, transport, written } = createHarness()
  const response = transport.request('thread/start', { cwd: 'C:/spike' })

  await nextTurn()
  assert.deepEqual(written, [
    { id: 1, method: 'thread/start', params: { cwd: 'C:/spike' } },
  ])
  assert.equal(transport.pendingRequestCount, 1)

  child.stdout.write('{"id":1,"result":{"thread":{"id":"thread-1"}}}\n')

  assert.deepEqual(await response, { thread: { id: 'thread-1' } })
  assert.equal(transport.pendingRequestCount, 0)
})

test('rejects the matching request with a typed remote error', async () => {
  const { child, transport } = createHarness()
  const response = transport.request('turn/start')

  child.stdout.write(
    '{"id":1,"error":{"code":-32000,"message":"turn rejected","data":{"retry":false}}}\n',
  )

  await assert.rejects(response, (error) => {
    assert.ok(error instanceof JsonRpcRemoteError)
    assert.equal(error.method, 'turn/start')
    assert.equal(error.code, -32000)
    assert.deepEqual(error.data, { retry: false })
    assert.equal(error.failureReason, 'provider_error')
    return true
  })
})

test('dispatches an unknown notification and remains usable', async () => {
  const { child, transport } = createHarness()
  const notifications = []
  transport.onNotification((notification) => notifications.push(notification))

  child.stdout.write('{"method":"future/providerEvent","params":{"value":1}}\n')
  await nextTurn()

  assert.deepEqual(notifications, [
    { method: 'future/providerEvent', params: { value: 1 } },
  ])

  const response = transport.request('thread/start')
  child.stdout.write('{"id":1,"result":{"ok":true}}\n')
  assert.deepEqual(await response, { ok: true })
})

test('surfaces invalid JSON and rejects later requests with the same failure', async () => {
  const { child, transport } = createHarness()
  const errorPromise = once(transportErrorEmitter(transport), 'error')

  child.stdout.write('{not-json}\n')

  const [error] = await errorPromise
  assert.ok(error instanceof CodexProtocolError)
  assert.match(error.message, /invalid JSON/)
  assert.equal(error.failureReason, 'provider_protocol_error')
  await assert.rejects(transport.request('initialize'), (requestError) => {
    assert.equal(requestError, error)
    return true
  })
})

test('routes line overflow through transport failure and rejects pending requests', async () => {
  const { child, transport } = createHarness({ maxLineBytes: 16 })
  const errorPromise = once(transportErrorEmitter(transport), 'error')
  const pending = transport.request('initialize')

  child.stdout.write('x'.repeat(17))

  const [error] = await errorPromise
  assert.ok(error instanceof JsonRpcLineTooLongError)
  assert.equal(error.maxLineBytes, 16)
  assert.equal(error.observedLineBytes, 17)
  assert.equal(error.failureReason, 'protocol_limit_exceeded')
  await assert.rejects(pending, (requestError) => {
    assert.equal(requestError, error)
    return true
  })
  assert.equal(transport.pendingRequestCount, 0)
})

test('rejects every pending request when the process exits unexpectedly', async () => {
  const { child, transport } = createHarness()
  const first = transport.request('initialize')
  const second = transport.request('thread/start')

  assert.equal(transport.pendingRequestCount, 2)
  child.exitCode = 17
  child.emit('exit', 17, null)

  for (const pending of [first, second]) {
    await assert.rejects(pending, (error) => {
      assert.ok(error instanceof CodexProcessExitError)
      assert.match(error.message, /code 17/)
      assert.equal(error.failureReason, 'provider_crashed')
      return true
    })
  }
  assert.equal(transport.pendingRequestCount, 0)
})

test('fails closed when Provider stdin errors after an ownership request begins', async () => {
  const { child, transport } = createHarness()
  const observed = once(transportErrorEmitter(transport), 'error')
  const pending = transport.request('turn/start', { prompt: 'safe fixture' })
  await nextTurn()

  child.stdin.emit('error', new Error('PRIVATE write diagnostic'))

  const [error] = await observed
  assert.ok(error instanceof CodexProcessError)
  assert.equal(error.failureReason, 'execution_ownership_uncertain')
  assert.doesNotMatch(error.message, /PRIVATE/u)
  await assert.rejects(
    pending,
    (requestError) =>
      requestError.failureReason === 'execution_ownership_uncertain',
  )
})

test('classifies process launch failures without exposing operating-system diagnostics', async () => {
  for (const scenario of [
    {
      code: 'ENOENT',
      constructor: CodexExecutableNotFoundError,
      failureReason: 'provider_not_installed',
    },
    {
      code: 'EACCES',
      constructor: CodexProcessError,
      failureReason: 'provider_misconfigured',
    },
  ]) {
    const { child, transport } = createHarness()
    const observed = once(transportErrorEmitter(transport), 'error')
    const pending = transport.request('initialize')
    child.emit(
      'error',
      Object.assign(new Error('PRIVATE path and credential-like diagnostic'), {
        code: scenario.code,
      }),
    )

    const [error] = await observed
    assert.ok(error instanceof scenario.constructor)
    assert.equal(error.failureReason, scenario.failureReason)
    assert.doesNotMatch(error.message, /PRIVATE|credential|path/u)
    await assert.rejects(pending, (requestError) => requestError === error)
  }
})

test('rejects writes and absorbs provider stdin errors after shutdown begins', async () => {
  const { child, transport } = createHarness()

  transport.beginShutdown()
  child.stdin.emit(
    'error',
    Object.assign(new Error('write after end'), {
      code: 'ERR_STREAM_WRITE_AFTER_END',
    }),
  )

  await assert.rejects(
    transport.respond(72, { decision: 'decline' }),
    /protocol is closing/,
  )
})

function transportErrorEmitter(transport) {
  const emitter = new EventEmitter()
  transport.onError((error) => emitter.emit('error', error))
  return emitter
}
