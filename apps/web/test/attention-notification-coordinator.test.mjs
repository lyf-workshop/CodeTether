import assert from 'node:assert/strict'
import test from 'node:test'

import { AttentionNotificationCoordinator } from '../.tmp/test-dist/runtime/notifications/attention-notification-coordinator.js'

const epoch = '11111111-1111-4111-8111-111111111111'
const timestamp = '2026-08-28T12:00:00.000Z'
const projectId = 'proj_notification01'
const conversationId = 'conv_notification01'
const turnId = 'turn_notification01'
const backgroundWindow = {
  focused: false,
  minimized: false,
  visible: true,
}

test('delivers only new attention.created arrivals, never startup/reset/refetch state', async (t) => {
  const fixture = createFixture()
  t.after(async () => await fixture.coordinator.stop())

  fixture.coordinator.start()
  await nextTask()
  assert.equal(fixture.adapter.deliveries.length, 0)
  assert.equal(fixture.metadataCalls.length, 0)

  fixture.source.emit(streamReset())
  fixture.source.emit(turnCompleted(1))
  fixture.source.emit(attentionResolved(openAttention('attn_old01'), 2))
  await nextTask()
  assert.equal(fixture.adapter.deliveries.length, 0)

  const item = openAttention('attn_new01')
  fixture.source.emit(attentionCreated(item, 3))
  await waitFor(() => fixture.adapter.deliveries.length === 1)
  assert.equal(fixture.adapter.deliveries[0].attentionId, 'attn_new01')
  assert.deepEqual(fixture.metadataCalls, ['attn_new01'])
})

test('claims attentionId synchronously across replay and concurrent delivery', async (t) => {
  const metadata = deferred()
  const fixture = createFixture({
    resolveMetadata: async (attention) => {
      fixture.metadataCalls.push(attention.attentionId)
      return await metadata.promise
    },
  })
  t.after(async () => await fixture.coordinator.stop())
  fixture.coordinator.start()

  const replay = attentionCreated(openAttention('attn_replay01'), 1)
  fixture.source.emit(replay)
  fixture.source.emit(replay)
  fixture.source.emit({ ...replay, seq: 2, eventId: `${epoch}:2` })
  await nextTask()
  assert.deepEqual(fixture.metadataCalls, ['attn_replay01'])

  metadata.resolve(metadataValue())
  await waitFor(() => fixture.adapter.deliveries.length === 1)
  assert.equal(fixture.adapter.permissionCalls, 1)
})

test('does not lose distinct Attention items created close together', async (t) => {
  const fixture = createFixture()
  t.after(async () => await fixture.coordinator.stop())
  fixture.coordinator.start()

  for (let index = 1; index <= 3; index += 1) {
    fixture.source.emit(
      attentionCreated(openAttention(`attn_multi0${index}`), index),
    )
  }
  await waitFor(() => fixture.adapter.deliveries.length === 3)
  assert.deepEqual(
    fixture.adapter.deliveries.map((intent) => intent.attentionId).sort(),
    ['attn_multi01', 'attn_multi02', 'attn_multi03'],
  )
})

test('foreground suppression skips permission and delivery only for direct UI', async (t) => {
  const fixture = createFixture({
    windowState: { focused: true, minimized: false, visible: true },
    surface: { kind: 'conversation', conversationId },
  })
  t.after(async () => await fixture.coordinator.stop())
  fixture.coordinator.start()

  fixture.source.emit(attentionCreated(openApproval('attn_same01'), 1))
  await nextTask()
  assert.equal(fixture.adapter.permissionCalls, 0)
  assert.equal(fixture.adapter.deliveries.length, 0)

  fixture.surface = {
    kind: 'conversation',
    conversationId: 'conv_notification_other01',
  }
  fixture.source.emit(attentionCreated(openApproval('attn_other01'), 2))
  await waitFor(() => fixture.adapter.deliveries.length === 1)

  fixture.surface = { kind: 'inbox' }
  fixture.source.emit(attentionCreated(openAttention('attn_inbox01'), 3))
  await nextTask()
  assert.equal(fixture.adapter.deliveries.length, 1)

  fixture.adapter.windowState = {
    focused: false,
    minimized: true,
    visible: true,
  }
  fixture.source.emit(attentionCreated(openAttention('attn_minimized01'), 4))
  await waitFor(() => fixture.adapter.deliveries.length === 2)
})

test('async native minimized state overrides stale focused WebView semantics', async (t) => {
  const fixture = createFixture({
    windowState: Promise.resolve({
      focused: true,
      minimized: true,
      visible: true,
    }),
    surface: { kind: 'inbox' },
  })
  t.after(async () => await fixture.coordinator.stop())
  fixture.coordinator.start()

  fixture.source.emit(attentionCreated(openApproval('attn_minimized02'), 1))
  await waitFor(() => fixture.adapter.deliveries.length === 1)
  assert.equal(fixture.adapter.deliveries[0].attentionId, 'attn_minimized02')
})

test('window state failure cannot silently drop a new Attention', async (t) => {
  const fixture = createFixture({
    windowState: Promise.reject(new Error('native window state unavailable')),
    surface: { kind: 'inbox' },
  })
  t.after(async () => await fixture.coordinator.stop())
  fixture.coordinator.start()

  fixture.source.emit(attentionCreated(openApproval('attn_window_error01'), 1))
  await waitFor(() => fixture.adapter.deliveries.length === 1)
  assert.equal(fixture.adapter.deliveries[0].attentionId, 'attn_window_error01')
  assert.deepEqual(fixture.diagnostics, [
    { attentionId: 'attn_window_error01', stage: 'window-state' },
  ])
})

test('reads current preferences for each new Attention without affecting Inbox truth', async (t) => {
  let preferences = {
    approval: true,
    completed_review: false,
    failed: true,
  }
  const fixture = createFixture({ readPreferences: () => preferences })
  t.after(async () => await fixture.coordinator.stop())
  fixture.coordinator.start()

  fixture.source.emit(attentionCreated(openAttention('attn_disabled01'), 1))
  await nextTask()
  assert.equal(fixture.adapter.deliveries.length, 0)
  assert.equal(fixture.adapter.permissionCalls, 0)

  preferences = { ...preferences, completed_review: true }
  fixture.source.emit(attentionCreated(openAttention('attn_enabled01'), 2))
  await waitFor(() => fixture.adapter.deliveries.length === 1)
  assert.equal(fixture.adapter.deliveries[0].attentionId, 'attn_enabled01')
})

test('checks permission only for a real delivery need and tolerates denial', async (t) => {
  const fixture = createFixture({ permissionGranted: false })
  t.after(async () => await fixture.coordinator.stop())
  fixture.coordinator.start()

  fixture.source.emit(attentionCreated(openFailure('attn_denied01'), 1))
  await waitFor(() => fixture.adapter.permissionCalls === 1)
  assert.equal(fixture.adapter.deliveries.length, 0)
  assert.deepEqual(fixture.diagnostics, [])
})

test('uses optional recent delivered IDs without creating a second Attention store', async (t) => {
  const remembered = new Set(['attn_remembered01'])
  const rememberCalls = []
  const fixture = createFixture({
    recentIds: {
      has: async (attentionId) => remembered.has(attentionId),
      remember: async (attentionId) => {
        rememberCalls.push(attentionId)
        remembered.add(attentionId)
      },
    },
  })
  t.after(async () => await fixture.coordinator.stop())
  fixture.coordinator.start()

  fixture.source.emit(attentionCreated(openAttention('attn_remembered01'), 1))
  fixture.source.emit(attentionCreated(openAttention('attn_fresh01'), 2))
  await waitFor(() => fixture.adapter.deliveries.length === 1)
  await waitFor(() => rememberCalls.length === 1)
  assert.equal(fixture.adapter.deliveries[0].attentionId, 'attn_fresh01')
  assert.deepEqual(rememberCalls, ['attn_fresh01'])
})

test('adapter and plugin failures stay best-effort and never stop later arrivals', async (t) => {
  const fixture = createFixture({ deliveryFailures: 1 })
  t.after(async () => await fixture.coordinator.stop())
  fixture.coordinator.start()

  fixture.source.emit(attentionCreated(openAttention('attn_failure01'), 1))
  await waitFor(() => fixture.diagnostics.length === 1)
  assert.deepEqual(fixture.diagnostics[0], {
    attentionId: 'attn_failure01',
    stage: 'delivery',
  })

  fixture.source.emit(attentionCreated(openFailure('attn_after_failure01'), 2))
  await waitFor(() => fixture.adapter.deliveries.length === 1)
  assert.equal(
    fixture.adapter.deliveries[0].attentionId,
    'attn_after_failure01',
  )
})

test('unavailable Browser adapter never registers native work', async () => {
  const fixture = createFixture({ available: false })
  fixture.coordinator.start()
  fixture.source.emit(attentionCreated(openAttention('attn_browser01'), 1))
  await nextTask()

  assert.equal(fixture.source.subscribeCalls, 0)
  assert.equal(fixture.adapter.intentSubscribeCalls, 0)
  assert.equal(fixture.adapter.permissionCalls, 0)
  assert.equal(fixture.adapter.deliveries.length, 0)
  await fixture.coordinator.stop()
})

test('click intents navigate without resolving Attention and listener lifecycle is idempotent', async () => {
  const navigations = []
  const fixture = createFixture({
    navigate: async (intent) => {
      navigations.push(intent)
    },
  })

  fixture.coordinator.start()
  fixture.coordinator.start()
  await waitFor(() => fixture.adapter.intentSubscribeCalls === 1)
  assert.equal(fixture.source.activeListeners, 1)

  const intent = notificationIntent('attn_click01')
  fixture.adapter.click(intent)
  await waitFor(() => navigations.length === 1)
  assert.strictEqual(navigations[0], intent)

  await fixture.coordinator.stop()
  assert.equal(fixture.source.activeListeners, 0)
  assert.equal(fixture.adapter.intentUnsubscribeCalls, 1)
  fixture.adapter.click(notificationIntent('attn_stale_click01'))
  await nextTask()
  assert.equal(navigations.length, 1)

  fixture.coordinator.start()
  await waitFor(() => fixture.adapter.intentSubscribeCalls === 2)
  assert.equal(fixture.source.activeListeners, 1)
  await fixture.coordinator.stop()
})

class FakeEventSource {
  activeListeners = 0
  subscribeCalls = 0
  #listeners = new Set()

  subscribeAppliedEvents(listener) {
    this.subscribeCalls += 1
    this.activeListeners += 1
    this.#listeners.add(listener)
    let active = true
    return () => {
      if (!active) return
      active = false
      this.activeListeners -= 1
      this.#listeners.delete(listener)
    }
  }

  emit(event) {
    for (const listener of this.#listeners) listener(event)
  }
}

class FakeAdapter {
  deliveries = []
  intentSubscribeCalls = 0
  intentUnsubscribeCalls = 0
  permissionCalls = 0
  #deliveryFailures
  #intentListener
  #permissionGranted

  constructor({ available, deliveryFailures, permissionGranted, windowState }) {
    this.available = available
    this.#deliveryFailures = deliveryFailures
    this.#permissionGranted = permissionGranted
    this.windowState = windowState
  }

  getWindowState() {
    return this.windowState
  }

  async ensurePermission() {
    this.permissionCalls += 1
    return this.#permissionGranted
  }

  async deliver(intent) {
    if (this.#deliveryFailures > 0) {
      this.#deliveryFailures -= 1
      throw new Error('native stack must remain isolated')
    }
    this.deliveries.push(intent)
  }

  async subscribeToIntents(listener) {
    this.intentSubscribeCalls += 1
    this.#intentListener = listener
    let active = true
    return () => {
      if (!active) return
      active = false
      this.intentUnsubscribeCalls += 1
      if (this.#intentListener === listener) this.#intentListener = undefined
    }
  }

  click(intent) {
    this.#intentListener?.(intent)
  }
}

function createFixture(options = {}) {
  const source = new FakeEventSource()
  const adapter = new FakeAdapter({
    available: options.available ?? true,
    deliveryFailures: options.deliveryFailures ?? 0,
    permissionGranted: options.permissionGranted ?? true,
    windowState: options.windowState ?? backgroundWindow,
  })
  const metadataCalls = []
  const diagnostics = []
  const fixture = {
    adapter,
    coordinator: undefined,
    diagnostics,
    metadataCalls,
    source,
    surface: options.surface ?? { kind: 'other' },
  }
  const resolveMetadata =
    options.resolveMetadata ??
    (async (attention) => {
      metadataCalls.push(attention.attentionId)
      return metadataValue()
    })
  fixture.coordinator = new AttentionNotificationCoordinator({
    adapter,
    eventSource: source,
    navigate: options.navigate ?? (() => undefined),
    readPreferences: options.readPreferences,
    readSurface: () => fixture.surface,
    recentIds: options.recentIds,
    reportFailure: (diagnostic) => diagnostics.push(diagnostic),
    resolveMetadata,
  })
  return fixture
}

function metadataValue() {
  return {
    projectName: '中文项目',
    conversationTitle: '修复 Windows 登录后的自动重连问题',
  }
}

function openAttention(attentionId) {
  return {
    attentionId,
    projectId,
    conversationId,
    turnId,
    type: 'completed_review',
    status: 'open',
    createdAt: timestamp,
    updatedAt: timestamp,
    payload: { conversationTitle: '修复 Windows 登录后的自动重连问题' },
  }
}

function openApproval(attentionId) {
  return {
    ...openAttention(attentionId),
    type: 'approval',
    payload: {
      approvalId: `approval_${attentionId}`,
      kind: 'command',
      actionTitle: '执行命令',
      actionSubtitle: 'git status --short',
    },
  }
}

function openFailure(attentionId) {
  return {
    ...openAttention(attentionId),
    type: 'failed',
    payload: {
      conversationTitle: '修复 Windows 登录后的自动重连问题',
      error: { code: 'provider_failed', message: 'safe failure' },
    },
  }
}

function attentionCreated(attention, seq) {
  return envelope(seq, 'attention.created', { attention })
}

function attentionResolved(attention, seq) {
  return envelope(seq, 'attention.resolved', {
    attention: {
      ...attention,
      status: 'resolved',
      resolvedAt: timestamp,
    },
  })
}

function turnCompleted(seq) {
  return envelope(seq, 'turn.completed', {
    finalMessage: 'safe result',
  })
}

function envelope(seq, type, payload) {
  return {
    protocolVersion: 1,
    epoch,
    seq,
    eventId: `${epoch}:${seq}`,
    conversationId,
    turnId,
    timestamp,
    type,
    payload,
  }
}

function streamReset() {
  return {
    protocolVersion: 1,
    epoch,
    seq: 0,
    eventId: `${epoch}:0`,
    conversationId: null,
    timestamp,
    type: 'stream.reset',
    payload: { reason: 'epoch_mismatch' },
  }
}

function notificationIntent(attentionId) {
  return {
    attentionId,
    type: 'failed',
    projectId,
    conversationId,
    turnId,
    title: 'CodeTether · 执行失败',
    body: '中文项目 · 修复 Windows 登录后的自动重连问题\n需要你查看执行结果',
  }
}

function deferred() {
  let resolve
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

async function nextTask() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function waitFor(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail('Timed out waiting for notification state')
}
