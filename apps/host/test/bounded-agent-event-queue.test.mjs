import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AgentEventQueueOverflowError,
  BoundedAgentEventQueue,
} from '../dist/runtime/bounded-agent-event-queue.js'

const base = {
  provider: 'codex',
  timestamp: '2026-08-25T12:00:00.000Z',
  threadId: 'thread-a',
  turnId: 'turn-a',
  itemId: 'item-a',
}

test('coalesces adjacent deltas without changing text', async () => {
  const queue = new BoundedAgentEventQueue()
  for (const delta of ['Code', 'Tether', ' ', 'works']) {
    queue.enqueue({ ...base, type: 'message.delta', delta })
  }
  queue.close()
  const events = []
  await queue.consume((event) => events.push(event))

  assert.equal(events.length, 1)
  assert.equal(events[0].delta, 'CodeTether works')
  const stats = queue.snapshot()
  assert.equal(stats.rawMessageDeltas, 4)
  assert.equal(stats.deliveredMessageDeltas, 1)
  assert.equal(stats.droppedDeltaEvents, 0)
})

test('does not coalesce across thread, turn, item, stream, or ordering boundaries', async () => {
  const queue = new BoundedAgentEventQueue()
  queue.enqueue({ ...base, type: 'message.delta', delta: 'A1' })
  queue.enqueue({
    ...base,
    threadId: 'thread-b',
    type: 'message.delta',
    delta: 'B1',
  })
  queue.enqueue({ ...base, type: 'message.delta', delta: 'A2' })
  queue.close()
  const events = []
  await queue.consume((event) => events.push(event))

  assert.deepEqual(
    events.map((event) => `${event.threadId}:${event.delta}`),
    ['thread-a:A1', 'thread-b:B1', 'thread-a:A2'],
  )
})

test('keeps turn, item, and tool stream identities separate', async () => {
  const queue = new BoundedAgentEventQueue()
  queue.enqueue({ ...base, type: 'message.delta', delta: 'turn-a' })
  queue.enqueue({
    ...base,
    turnId: 'turn-b',
    type: 'message.delta',
    delta: 'turn-b',
  })
  queue.enqueue({
    ...base,
    itemId: 'item-b',
    type: 'message.delta',
    delta: 'item-b',
  })
  queue.enqueue({
    ...base,
    type: 'tool.output',
    stream: 'stdout',
    output: 'out-1',
  })
  queue.enqueue({
    ...base,
    type: 'tool.output',
    stream: 'stdout',
    output: 'out-2',
  })
  queue.enqueue({
    ...base,
    type: 'tool.output',
    stream: 'stderr',
    output: 'error',
  })
  queue.close()
  const events = []
  await queue.consume((event) => events.push(event))

  assert.equal(events.length, 5)
  assert.deepEqual(
    events.map((event) => [
      event.type,
      event.turnId,
      event.itemId,
      event.stream,
    ]),
    [
      ['message.delta', 'turn-a', 'item-a', undefined],
      ['message.delta', 'turn-b', 'item-a', undefined],
      ['message.delta', 'turn-a', 'item-b', undefined],
      ['tool.output', 'turn-a', 'item-a', 'stdout'],
      ['tool.output', 'turn-a', 'item-a', 'stderr'],
    ],
  )
  assert.equal(events[3].output, 'out-1out-2')
})

test('drops an oversize delta without evicting another thread', async () => {
  const oversizeEvents = [
    { ...base, type: 'message.delta', delta: 'x'.repeat(2_000) },
    {
      ...base,
      type: 'tool.output',
      stream: 'stdout',
      output: 'x'.repeat(2_000),
    },
  ]

  for (const oversizeEvent of oversizeEvents) {
    const queue = new BoundedAgentEventQueue({ maxEvents: 4, maxBytes: 500 })
    queue.enqueue({
      ...base,
      threadId: 'thread-b',
      type: 'message.delta',
      delta: 'kept',
    })
    const outcome = queue.enqueue(oversizeEvent)
    queue.close()
    const events = []
    await queue.consume((event) => events.push(event))

    assert.equal(outcome.kind, 'delta-dropped')
    assert.equal(events.length, 1)
    assert.equal(events[0].threadId, 'thread-b')
    assert.equal(events[0].delta, 'kept')
    assert.equal(queue.snapshot().droppedDeltaEvents, 1)
  }
})

test('fails and clears queued entries when the consumer throws', async () => {
  const failedEvents = [
    { ...base, type: 'message.delta', delta: 'not delivered' },
    {
      ...base,
      type: 'tool.output',
      stream: 'stdout',
      output: 'not delivered',
    },
  ]

  for (const failedEvent of failedEvents) {
    const queue = new BoundedAgentEventQueue({ maxEvents: 4, maxBytes: 10_000 })
    queue.enqueue(failedEvent)
    queue.enqueue({
      provider: 'codex',
      timestamp: base.timestamp,
      threadId: base.threadId,
      turnId: base.turnId,
      type: 'turn.completed',
    })

    const failure = new Error(`consumer failed for ${failedEvent.type}`)
    await assert.rejects(
      queue.consume(() => {
        throw failure
      }),
      (error) => error === failure,
    )

    const stats = queue.snapshot()
    assert.equal(stats.queuedEvents, 0)
    assert.equal(stats.queuedBytes, 0)
    assert.equal(stats.deliveredMessageDeltas, 0)
    assert.equal(stats.deliveredToolOutputs, 0)
    assert.throws(
      () => queue.enqueue({ ...base, type: 'message.delta', delta: 'later' }),
      (error) => error === failure,
    )
  }
})

test('evicts only deltas so approval and terminal events remain deliverable', async () => {
  const queue = new BoundedAgentEventQueue({ maxEvents: 2, maxBytes: 10_000 })
  queue.enqueue({ ...base, type: 'message.delta', delta: 'one' })
  queue.enqueue({
    ...base,
    itemId: 'item-b',
    type: 'message.delta',
    delta: 'two',
  })
  queue.enqueue({
    provider: 'codex',
    timestamp: base.timestamp,
    threadId: base.threadId,
    turnId: base.turnId,
    approvalId: 'approval-1',
    itemId: 'command-1',
    kind: 'command',
    summary: 'safe command',
    type: 'approval.requested',
  })
  queue.enqueue({
    provider: 'codex',
    timestamp: base.timestamp,
    threadId: base.threadId,
    turnId: base.turnId,
    type: 'turn.completed',
  })
  queue.close()
  const events = []
  await queue.consume((event) => events.push(event))

  assert.deepEqual(
    events.map((event) => event.type),
    ['approval.requested', 'turn.completed'],
  )
  assert.equal(queue.snapshot().droppedDeltaEvents, 2)
})

test('fails loudly instead of dropping a reliable event', () => {
  const queue = new BoundedAgentEventQueue({ maxEvents: 1, maxBytes: 10_000 })
  queue.enqueue({
    provider: 'codex',
    timestamp: base.timestamp,
    threadId: base.threadId,
    turnId: base.turnId,
    approvalId: 'approval-1',
    kind: 'command',
    summary: 'safe command',
    type: 'approval.requested',
  })

  assert.throws(
    () =>
      queue.enqueue({
        provider: 'codex',
        timestamp: base.timestamp,
        threadId: base.threadId,
        turnId: base.turnId,
        type: 'turn.completed',
      }),
    AgentEventQueueOverflowError,
  )
})
