import assert from 'node:assert/strict'
import test from 'node:test'

import { BoundedAgentEventQueue } from '../dist/runtime/bounded-agent-event-queue.js'
import {
  DeltaIntegrityCapacityError,
  IncrementalDeltaIntegrityTracker,
} from '../dist/runtime/delta-integrity-tracker.js'

const base = {
  provider: 'codex',
  timestamp: '2026-08-25T12:00:00.000Z',
  threadId: 'thread-a',
  turnId: 'turn-a',
  itemId: 'message-a',
}

test('verifies raw and delivered message text across different chunking', () => {
  const tracker = new IncrementalDeltaIntegrityTracker()
  tracker.observeRaw({ ...base, type: 'message.delta', delta: 'Code' })
  tracker.observeRaw({ ...base, type: 'message.delta', delta: 'Tether works' })
  tracker.observeDelivered({
    ...base,
    type: 'message.delta',
    delta: 'CodeTether works',
  })
  assert.deepEqual(tracker.snapshot(), { intact: true, trackedItems: 1 })

  const completed = {
    ...base,
    type: 'message.completed',
    message: 'CodeTether works',
  }
  tracker.observeRaw(completed)
  tracker.observeDelivered(completed)
  assert.deepEqual(tracker.snapshot(), { intact: true, trackedItems: 0 })
})

test('detects a message canonical-text mismatch', () => {
  const tracker = new IncrementalDeltaIntegrityTracker()
  const delta = { ...base, type: 'message.delta', delta: 'expected' }
  tracker.observeRaw(delta)
  tracker.observeDelivered(delta)

  const completed = {
    ...base,
    type: 'message.completed',
    message: 'different',
  }
  tracker.observeRaw(completed)
  tracker.observeDelivered(completed)

  assert.deepEqual(tracker.snapshot(), { intact: false, trackedItems: 0 })
})

test('matches raw tool output with coalesced delivered stream runs', async () => {
  const tracker = new IncrementalDeltaIntegrityTracker()
  const queue = new BoundedAgentEventQueue()
  const rawOutputs = [
    {
      ...base,
      itemId: 'tool-a',
      type: 'tool.output',
      stream: 'stdout',
      output: 'out-',
    },
    {
      ...base,
      itemId: 'tool-a',
      type: 'tool.output',
      stream: 'stdout',
      output: 'one',
    },
    {
      ...base,
      itemId: 'tool-a',
      type: 'tool.output',
      stream: 'stderr',
      output: 'warn-',
    },
    {
      ...base,
      itemId: 'tool-a',
      type: 'tool.output',
      stream: 'stderr',
      output: 'one',
    },
  ]
  for (const event of rawOutputs) {
    tracker.observeRaw(event)
    queue.enqueue(event)
  }
  const completed = {
    ...base,
    itemId: 'tool-a',
    type: 'tool.completed',
    name: 'shell',
    success: true,
  }
  tracker.observeRaw(completed)
  queue.enqueue(completed)
  queue.close()

  await queue.consume((event) => tracker.observeDelivered(event))

  assert.deepEqual(tracker.snapshot(), { intact: true, trackedItems: 0 })
  assert.equal(queue.snapshot().rawToolOutputs, 4)
  assert.equal(queue.snapshot().deliveredToolOutputs, 2)
})

test('detects raw and delivered tool output mismatch', () => {
  const tracker = new IncrementalDeltaIntegrityTracker()
  tracker.observeRaw({
    ...base,
    itemId: 'tool-a',
    type: 'tool.output',
    stream: 'stdout',
    output: 'expected',
  })
  tracker.observeDelivered({
    ...base,
    itemId: 'tool-a',
    type: 'tool.output',
    stream: 'stdout',
    output: 'different',
  })
  const completed = {
    ...base,
    itemId: 'tool-a',
    type: 'tool.completed',
    name: 'shell',
    success: true,
  }
  tracker.observeRaw(completed)
  tracker.observeDelivered(completed)

  assert.deepEqual(tracker.snapshot(), { intact: false, trackedItems: 0 })
})

test('cleans turn-scoped state on terminal events', () => {
  const tracker = new IncrementalDeltaIntegrityTracker()
  const partial = { ...base, type: 'message.delta', delta: 'partial' }
  tracker.observeRaw(partial)
  tracker.observeDelivered(partial)
  const interrupted = {
    provider: 'codex',
    timestamp: base.timestamp,
    threadId: base.threadId,
    turnId: base.turnId,
    type: 'turn.interrupted',
  }
  tracker.observeRaw(interrupted)
  tracker.observeDelivered(interrupted)
  assert.deepEqual(tracker.snapshot(), { intact: true, trackedItems: 0 })

  const orphan = {
    ...base,
    turnId: 'turn-b',
    type: 'tool.output',
    output: 'orphan',
  }
  tracker.observeRaw(orphan)
  tracker.observeDelivered(orphan)
  const completed = {
    provider: 'codex',
    timestamp: base.timestamp,
    threadId: base.threadId,
    turnId: 'turn-b',
    type: 'turn.completed',
  }
  tracker.observeRaw(completed)
  tracker.observeDelivered(completed)
  assert.deepEqual(tracker.snapshot(), { intact: false, trackedItems: 0 })
})

test('bounds active streamed items and clear releases their state', () => {
  const tracker = new IncrementalDeltaIntegrityTracker(1)
  tracker.observeRaw({ ...base, type: 'message.delta', delta: 'first' })

  assert.throws(
    () =>
      tracker.observeRaw({
        ...base,
        itemId: 'message-b',
        type: 'message.delta',
        delta: 'second',
      }),
    DeltaIntegrityCapacityError,
  )
  tracker.clear()
  assert.equal(tracker.snapshot().trackedItems, 0)

  const delta = {
    ...base,
    itemId: 'message-c',
    type: 'message.delta',
    delta: 'ok',
  }
  const completed = {
    ...base,
    itemId: 'message-c',
    type: 'message.completed',
    message: 'ok',
  }
  tracker.observeRaw(delta)
  tracker.observeDelivered(delta)
  tracker.observeRaw(completed)
  tracker.observeDelivered(completed)
  assert.deepEqual(tracker.snapshot(), { intact: true, trackedItems: 0 })
})
