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
    const started = runtime.startConversation({ cwd, model: 'test-model' })
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
    await fixture.waitForMethod('thread/read', 1)
    fixture.respond(
      fixture.written.find((entry) => entry.method === 'thread/read'),
      {
        thread: {
          id: 'test-native-start',
          cwd,
          name: null,
          createdAt: 1,
          updatedAt: 1,
          cliVersion: 'phase9b-test',
          modelProvider: 'openai',
          source: 'appServer',
          status: { type: 'active' },
          ephemeral: false,
        },
      },
    )
    assert.equal((await started).providerThreadId, 'test-native-start')
    assert.equal((await resumed).providerThreadId, 'test-native-resume')
    assert.equal(
      fixture.written.some((entry) => entry.method === 'turn/start'),
      false,
    )
    assert.equal(
      fixture.written.some(
        (entry) =>
          entry.method === 'model/list' || entry.method === 'config/read',
      ),
      false,
    )
    assert.equal(
      fixture.written.filter((entry) => entry.method === 'initialize').length,
      1,
    )
    assert.equal(
      fixture.written.filter((entry) => entry.method === 'thread/read').length,
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

test('explicit catalog refresh hydrates Codex without opening a conversation', async () => {
  const fixture = createFixture()
  const runtime = CodexHostRuntime.deferred(fixture.options)
  try {
    assert.equal(runtime.descriptor.availableModels, undefined)
    assert.equal(fixture.launches.length, 0)
    const pending = runtime.refreshAvailableModels()
    await fixture.waitForMethod('initialize', 1)
    fixture.initialize()
    await fixture.waitForMethod('model/list', 1)
    fixture.respond(
      fixture.written.find(({ method }) => method === 'model/list'),
      {
        data: [
          {
            id: 'catalog-preset',
            model: 'gpt-test-model',
            displayName: 'Test Model',
            description: 'A test catalog item',
            isDefault: true,
            hidden: false,
            supportedReasoningEfforts: [
              { reasoningEffort: 'low', description: 'Fast' },
            ],
          },
        ],
        nextCursor: null,
      },
    )
    const catalog = await pending
    assert.deepEqual(catalog[0].reasoningOptions, ['low'])
    assert.deepEqual(runtime.descriptor.availableModels, [
      {
        id: 'gpt-test-model',
        name: 'Test Model',
        description: 'A test catalog item',
      },
    ])
    assert.deepEqual(runtime.descriptor.models, [
      { id: 'gpt-test-model', label: 'Test Model', isDefault: true },
    ])
    assert.deepEqual(
      fixture.written.map(({ method }) => method),
      ['initialize', 'initialized', 'model/list'],
    )
  } finally {
    await runtime.close()
  }
})

test('new Codex conversation falls back only when configured model is absent from visible catalog', async () => {
  const fixture = createFixture()
  const runtime = CodexHostRuntime.deferred({
    ...fixture.options,
    ephemeralThreads: true,
  })
  try {
    const first = runtime.startConversation({ cwd })
    await fixture.waitForMethod('initialize', 1)
    fixture.initialize()
    await fixture.waitForMethod('model/list', 1)
    const catalog = {
      data: [
        {
          model: 'gpt-default',
          displayName: 'Catalog Default',
          isDefault: true,
          hidden: false,
          supportedReasoningEfforts: [],
        },
        {
          model: 'gpt-listed',
          displayName: 'Listed Model',
          isDefault: false,
          hidden: false,
          supportedReasoningEfforts: [],
        },
      ],
      nextCursor: null,
    }
    fixture.respond(
      fixture.written.find((entry) => entry.method === 'model/list'),
      catalog,
    )
    await fixture.waitForMethod('config/read', 1)
    fixture.respond(
      fixture.written.find((entry) => entry.method === 'config/read'),
      { config: { model: 'gpt-unlisted' } },
    )
    await fixture.waitForMethod('thread/start', 1)
    const firstStart = fixture.written.find(
      (entry) => entry.method === 'thread/start',
    )
    assert.equal(firstStart.params.model, 'gpt-default')
    fixture.respond(firstStart, {
      thread: { id: 'thread-fallback', cwd },
      cwd,
      model: 'gpt-default',
      modelProvider: 'openai',
    })
    assert.deepEqual(await first, {
      providerThreadId: 'thread-fallback',
      model: 'gpt-default',
      modelFallback: {
        configuredModel: 'gpt-unlisted',
        selectedModel: 'gpt-default',
      },
    })
    assert.deepEqual(runtime.descriptor.models, [
      { id: 'gpt-default', label: 'Catalog Default', isDefault: true },
      { id: 'gpt-listed', label: 'Listed Model' },
    ])

    const second = runtime.startConversation({ cwd })
    await fixture.waitForMethod('model/list', 2)
    fixture.respond(
      fixture.written.filter((entry) => entry.method === 'model/list')[1],
      catalog,
    )
    await fixture.waitForMethod('config/read', 2)
    fixture.respond(
      fixture.written.filter((entry) => entry.method === 'config/read')[1],
      { config: { model: 'gpt-listed' } },
    )
    await fixture.waitForMethod('thread/start', 2)
    const secondStart = fixture.written.filter(
      (entry) => entry.method === 'thread/start',
    )[1]
    assert.equal(secondStart.params.model, undefined)
    fixture.respond(secondStart, {
      thread: { id: 'thread-listed', cwd },
      cwd,
      model: 'gpt-listed',
      modelProvider: 'openai',
    })
    assert.deepEqual(await second, {
      providerThreadId: 'thread-listed',
      model: 'gpt-listed',
    })
  } finally {
    await runtime.close()
  }
})

test('unreadable configured model fails creation before opening a Codex thread', async () => {
  const fixture = createFixture()
  const runtime = CodexHostRuntime.deferred({
    ...fixture.options,
    ephemeralThreads: true,
  })
  try {
    const started = runtime.startConversation({ cwd })
    await fixture.waitForMethod('initialize', 1)
    fixture.initialize()
    await fixture.waitForMethod('model/list', 1)
    fixture.respond(
      fixture.written.find((entry) => entry.method === 'model/list'),
      {
        data: [
          {
            model: 'gpt-default',
            displayName: 'Default',
            isDefault: true,
            hidden: false,
            supportedReasoningEfforts: [],
          },
        ],
        nextCursor: null,
      },
    )
    await fixture.waitForMethod('config/read', 1)
    const read = fixture.written.find((entry) => entry.method === 'config/read')
    fixture.child.stdout.write(
      `${JSON.stringify({
        id: read.id,
        error: { code: -32603, message: 'private Provider diagnostic' },
      })}\n`,
    )
    await assert.rejects(started)
    assert.equal(
      fixture.written.some((entry) => entry.method === 'thread/start'),
      false,
    )
  } finally {
    await runtime.close()
  }
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
