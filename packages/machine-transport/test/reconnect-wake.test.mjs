import assert from 'node:assert/strict'
import test from 'node:test'

import { ReconnectWakeCoordinator } from '../dist/index.js'

function coordinator(overrides = {}) {
  return new ReconnectWakeCoordinator({
    initialDelayMs: 100,
    maximumDelayMs: 800,
    stableResetMs: 500,
    random: () => 0.5,
    ...overrides,
  })
}

test('100 reconnect cycles retain one coalesced wake and one waiter', async () => {
  const reconnect = coordinator()
  for (let cycle = 0; cycle < 100; cycle += 1) {
    const wait = reconnect.wait()
    assert.equal(reconnect.waiting, true)
    assert.equal(reconnect.requestWake(), true)
    assert.equal(reconnect.requestWake(), false)
    assert.deepEqual(await wait, {
      outcome: 'woken',
      scheduledDelayMs: Math.min(100 * 2 ** cycle, 800),
    })
    assert.equal(reconnect.waiting, false)
    assert.equal(reconnect.consumePendingWake(), true)
    assert.equal(reconnect.consumePendingWake(), false)
  }
  assert.equal(reconnect.currentDelayMs, 800)
  reconnect.close()
})

test('1000 reconnect signals coalesce into one pending wake and one wait result', async () => {
  const reconnect = coordinator({
    initialDelayMs: 30_000,
    maximumDelayMs: 30_000,
  })
  const wait = reconnect.wait()
  const accepted = Array.from({ length: 1_000 }, () =>
    reconnect.requestWake(),
  ).filter(Boolean)
  assert.equal(accepted.length, 1)
  assert.deepEqual(await wait, {
    outcome: 'woken',
    scheduledDelayMs: 30_000,
  })
  assert.equal(reconnect.wakePending, true)
  assert.equal(reconnect.consumePendingWake(), true)
  assert.equal(reconnect.wakePending, false)
  reconnect.close()
})

test('stable success resets bounded backoff using monotonic duration only', async () => {
  const reconnect = coordinator()
  for (const expected of [200, 400, 800]) {
    const wait = reconnect.wait()
    reconnect.requestWake()
    assert.equal((await wait).outcome, 'woken')
    reconnect.consumePendingWake()
    assert.equal(reconnect.currentDelayMs, expected)
  }

  reconnect.noteConnected(1_000)
  assert.equal(reconnect.noteDisconnected(1_499), false)
  assert.equal(reconnect.currentDelayMs, 800)

  reconnect.noteConnected(2_000)
  assert.equal(reconnect.noteDisconnected(1_999), false)
  assert.equal(reconnect.currentDelayMs, 800)

  reconnect.noteConnected(3_000)
  assert.equal(reconnect.noteDisconnected(3_500), true)
  assert.equal(reconnect.currentDelayMs, 100)
  reconnect.close()
})

test('a late resume-time jump resets backoff while duplicate wake signals stay coalesced and capped', async () => {
  const reconnect = coordinator()
  for (const expected of [200, 400, 800]) {
    const wait = reconnect.wait()
    reconnect.requestWake()
    assert.equal((await wait).outcome, 'woken')
    reconnect.consumePendingWake()
    assert.equal(reconnect.currentDelayMs, expected)
  }

  reconnect.noteConnected(10_000)
  assert.equal(reconnect.noteDisconnected(86_410_000), true)
  assert.equal(reconnect.currentDelayMs, 100)

  const wait = reconnect.wait(Number.MAX_SAFE_INTEGER)
  const accepted = Array.from({ length: 1_000 }, () =>
    reconnect.requestWake(),
  ).filter(Boolean)
  assert.equal(accepted.length, 1)
  assert.deepEqual(await wait, {
    outcome: 'woken',
    scheduledDelayMs: 800,
  })
  assert.equal(reconnect.consumePendingWake(), true)
  assert.equal(reconnect.consumePendingWake(), false)
  assert.equal(reconnect.currentDelayMs, 200)
  reconnect.close()
})

test('elapsed waits advance once and concurrent wait callers share one timer', async () => {
  const reconnect = coordinator({
    initialDelayMs: 1,
    maximumDelayMs: 2,
    stableResetMs: 10,
  })
  const first = reconnect.wait()
  const duplicate = reconnect.wait(2)
  assert.equal(first, duplicate)
  assert.deepEqual(await first, { outcome: 'elapsed', scheduledDelayMs: 1 })
  assert.equal(reconnect.currentDelayMs, 2)
  reconnect.close()
})

test('positive jitter never schedules beyond the configured hard maximum', async () => {
  const reconnect = coordinator({
    initialDelayMs: 800,
    maximumDelayMs: 800,
    random: () => 1,
  })
  const wait = reconnect.wait()
  reconnect.requestWake()
  assert.deepEqual(await wait, {
    outcome: 'woken',
    scheduledDelayMs: 800,
  })
  reconnect.close()
})

test('negative jitter never shortens a bounded Relay retry minimum', async () => {
  const reconnect = coordinator({
    initialDelayMs: 100,
    maximumDelayMs: 800,
    random: () => 0,
  })
  const wait = reconnect.wait(500)
  reconnect.requestWake()
  assert.deepEqual(await wait, {
    outcome: 'woken',
    scheduledDelayMs: 500,
  })
  assert.equal(reconnect.currentDelayMs, 200)
  reconnect.close()
})

test('close synchronously clears the exact timer and permanently rejects wakes', async () => {
  const reconnect = coordinator({
    initialDelayMs: 60_000,
    maximumDelayMs: 60_000,
  })
  const wait = reconnect.wait()
  assert.equal(reconnect.waiting, true)
  reconnect.close()
  reconnect.close()
  assert.deepEqual(await wait, {
    outcome: 'closed',
    scheduledDelayMs: 60_000,
  })
  assert.equal(reconnect.waiting, false)
  assert.equal(reconnect.wakePending, false)
  assert.equal(reconnect.requestWake(), false)
  assert.equal(reconnect.consumePendingWake(), false)
  assert.deepEqual(await reconnect.wait(), {
    outcome: 'closed',
    scheduledDelayMs: 0,
  })
})
