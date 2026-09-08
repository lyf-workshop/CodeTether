import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'

import { CodexHostRuntime } from '../dist/api/codex-host-runtime.js'

const cwd = resolve('test-owned-deferred-project')

test('cold exact Codex runtime and subscriptions create no child, including close', async () => {
  const fixture = createFixture()
  const runtime = CodexHostRuntime.deferred(fixture.options)
  assert.equal(runtime.available, true)
  runtime.subscribeEvents(() => {})
  runtime.subscribeFailures(() => {})
  runtime.subscribeApprovals(
    () => {},
    () => {},
  )
  assert.deepEqual(runtime.installation, {
    installationId: fixture.options.providerInstallationId,
    installationRevision: fixture.options.installationRevision,
  })
  assert.equal(fixture.launches.length, 0)
  await runtime.close()
  await runtime.close()
  assert.equal(runtime.available, false)
  await assert.rejects(runtime.startConversation({ cwd }), /closing/)
  assert.equal(fixture.launches.length, 0)
})

test('concurrent first native admissions share exact initialization and retain fixed policy', async () => {
  const fixture = createFixture()
  const runtime = CodexHostRuntime.deferred(fixture.options)
  try {
    const started = runtime.startConversation({ cwd })
    const resumed = runtime.resumeConversation({
      cwd,
      providerThreadId: 'test-native-resume',
      providerSessionMaterialized: true,
    })
    await fixture.waitForMethod('initialize', 1)
    assert.equal(fixture.launches.length, 1)
    assert.deepEqual(fixture.launches[0], {
      executable: fixture.options.executable,
      options: { disableHooks: true, environment: fixture.options.environment },
    })
    assert.equal(fixture.written.length, 1)
    fixture.initialize()
    await fixture.waitForMethod('thread/start', 1)
    await fixture.waitForMethod('thread/resume', 1)
    for (const method of ['thread/start', 'thread/resume']) {
      const request = fixture.written.find((entry) => entry.method === method)
      assert.equal(request.params.cwd, cwd)
      assert.equal(request.params.approvalPolicy, 'on-request')
      assert.equal(request.params.sandbox, 'workspace-write')
      fixture.respond(request, {
        thread: { id: request.params.threadId ?? 'test-native-start', cwd },
        cwd,
        model: 'test-model',
        modelProvider: 'openai',
      })
    }
    assert.equal((await started).providerThreadId, 'test-native-start')
    assert.equal((await resumed).providerThreadId, 'test-native-resume')
    assert.equal(
      fixture.written.some((entry) => entry.method === 'turn/start'),
      false,
    )
    assert.equal(
      fixture.written.filter((entry) => entry.method === 'initialize').length,
      1,
    )
  } finally {
    await runtime.close()
  }
  assert.equal(fixture.child.exitCode, 0)
})

test('closing during deferred initialization cleans the exact child and sends no native open', async () => {
  const fixture = createFixture()
  const runtime = CodexHostRuntime.deferred(fixture.options)
  const rejected = assert.rejects(runtime.startConversation({ cwd }))
  await fixture.waitForMethod('initialize', 1)
  await runtime.close()
  await rejected
  await assert.rejects(runtime.startConversation({ cwd }), /closing/)
  assert.equal(fixture.launches.length, 1)
  assert.equal(fixture.child.exitCode, 0)
  assert.deepEqual(
    fixture.written.map((entry) => entry.method),
    ['initialize'],
  )
})

test('failed initialization is cleaned and latched without replacement or replay', async () => {
  const fixture = createFixture()
  const runtime = CodexHostRuntime.deferred(fixture.options)
  const rejected = assert.rejects(runtime.startConversation({ cwd }))
  await fixture.waitForMethod('initialize', 1)
  const request = fixture.written[0]
  fixture.child.stdout.write(
    `${JSON.stringify({ id: request.id, error: { code: -32603, message: 'test-owned failure' } })}\n`,
  )
  await rejected
  assert.equal(runtime.available, false)
  await assert.rejects(runtime.startConversation({ cwd }), /closing/)
  await runtime.close()
  assert.equal(fixture.launches.length, 1)
  assert.equal(fixture.child.exitCode, 0)
  assert.deepEqual(
    fixture.written.map((entry) => entry.method),
    ['initialize'],
  )
})

test('Turn and interrupt never initialize a cold execution runtime', async () => {
  const fixture = createFixture()
  const runtime = CodexHostRuntime.deferred(fixture.options)
  await assert.rejects(
    runtime.startTurn({
      cwd,
      providerThreadId: 'test-native',
      input: 'test-owned',
    }),
    /no admitted execution session/,
  )
  await assert.rejects(
    runtime.interruptTurn({
      providerThreadId: 'test-native',
      providerTurnId: 'test-turn',
    }),
    /no admitted execution session/,
  )
  assert.equal(fixture.launches.length, 0)
  await runtime.close()
})

test('explicit eager launch retains its accepted initialization behavior', async () => {
  const fixture = createFixture()
  const pending = CodexHostRuntime.launch(fixture.options)
  await fixture.waitForMethod('initialize', 1)
  fixture.initialize()
  const runtime = await pending
  assert.equal(fixture.launches.length, 1)
  await runtime.close()
  assert.equal(fixture.child.exitCode, 0)
})

function createFixture() {
  const child = new EventEmitter()
  child.stdin = new PassThrough()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.exitCode = null
  child.signalCode = null
  child.stdin.once('finish', () => {
    child.exitCode = 0
    child.emit('exit', 0, null)
    child.emit('close', 0, null)
  })
  const written = []
  const launches = []
  let buffered = ''
  child.stdin.on('data', (chunk) => {
    buffered += chunk.toString('utf8')
    let index
    while ((index = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, index)
      buffered = buffered.slice(index + 1)
      if (line.length > 0) written.push(JSON.parse(line))
    }
  })
  const respond = (request, result) =>
    child.stdout.write(`${JSON.stringify({ id: request.id, result })}\n`)
  return {
    child,
    launches,
    written,
    options: {
      version: 'phase8c-test',
      executable: resolve('test-owned-exact-codex'),
      environment: { PATH: 'test-owned-stable-path' },
      providerInstallationId: 'provider_installation_test_exact',
      installationRevision: 'test-exact-revision',
      processFactory(executable, options) {
        launches.push({ executable, options })
        return child
      },
    },
    respond,
    initialize() {
      respond(
        written.find((entry) => entry.method === 'initialize'),
        {
          userAgent: 'test-owned-codex',
          codexHome: resolve('test-owned-home'),
          platformFamily: 'unix',
          platformOs: 'linux',
        },
      )
    },
    async waitForMethod(method, count) {
      const deadline = performance.now() + 2_000
      while (
        written.filter((entry) => entry.method === method).length < count
      ) {
        assert.ok(
          performance.now() < deadline,
          'test protocol observation deadline',
        )
        await new Promise((resolve_) => setImmediate(resolve_))
      }
    },
  }
}
