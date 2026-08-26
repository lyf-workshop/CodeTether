import assert from 'node:assert/strict'
import test from 'node:test'

import {
  HostEventPublisher,
  HostEventTooLargeError,
} from '../dist/api/index.js'

const epoch = '11111111-1111-4111-8111-111111111111'
const otherEpoch = '22222222-2222-4222-8222-222222222222'

test('accepts the synthetic sequence-zero cursor from an empty snapshot', () => {
  const publisher = new HostEventPublisher({ epoch })
  assert.deepEqual(publisher.replayAfter({ epoch, seq: 0 }), {
    kind: 'replay',
    epoch,
    currentSeq: 0,
    events: [],
  })

  const first = publisher.publish(messageEvent('one'))
  assert.deepEqual(publisher.replayAfter({ epoch, seq: 0 }).events, [first])
})

test('assigns one strict process-global sequence and replays after a cursor', () => {
  const publisher = new HostEventPublisher({ epoch })
  const first = publisher.publish(messageEvent('one'))
  const second = publisher.publish(messageEvent('two'))
  const third = publisher.publish(messageEvent('three'))

  assert.deepEqual([first.seq, second.seq, third.seq], [1, 2, 3])
  assert.deepEqual(
    [first.eventId, second.eventId, third.eventId],
    [`${epoch}:1`, `${epoch}:2`, `${epoch}:3`],
  )

  const decision = publisher.replayAfter({ epoch, seq: 1 })
  assert.equal(decision.kind, 'replay')
  assert.deepEqual(
    decision.events.map((event) => event.eventId),
    [`${epoch}:2`, `${epoch}:3`],
  )
})

test('returns explicit reset decisions for evicted, wrong, and future cursors', () => {
  const publisher = new HostEventPublisher({ epoch, maxEvents: 2 })
  for (const delta of ['one', 'two', 'three', 'four']) {
    publisher.publish(messageEvent(delta))
  }

  assert.deepEqual(publisher.replayAfter({ epoch, seq: 1 }), {
    kind: 'reset',
    reason: 'history_evicted',
    epoch,
    currentSeq: 4,
    oldestAvailableSeq: 3,
  })
  assert.equal(
    publisher.replayAfter({ epoch: otherEpoch, seq: 1 }).reason,
    'epoch_mismatch',
  )
  assert.equal(publisher.replayAfter({ epoch, seq: 5 }).reason, 'future_cursor')
})

test('keeps stream.reset outside global sequence and replay fanout', () => {
  const publisher = new HostEventPublisher({ epoch })

  assert.throws(
    () =>
      publisher.publish({
        conversationId: null,
        timestamp: '2026-08-26T07:00:00.000Z',
        type: 'stream.reset',
        payload: { reason: 'epoch_mismatch' },
      }),
    /connection-local control/u,
  )
  assert.equal(publisher.currentSeq, 0)
})

test('also evicts history by encoded byte size', () => {
  const sizingPublisher = new HostEventPublisher({ epoch })
  const sample = sizingPublisher.publish(messageEvent('x'.repeat(200)))
  const oneEventBytes = Buffer.byteLength(JSON.stringify(sample), 'utf8')
  const publisher = new HostEventPublisher({
    epoch,
    maxEvents: 10,
    maxBytes: oneEventBytes + 16,
  })

  publisher.publish(messageEvent('a'.repeat(200)))
  publisher.publish(messageEvent('b'.repeat(200)))
  publisher.publish(messageEvent('c'.repeat(200)))

  const decision = publisher.replayAfter({ epoch, seq: 1 })
  assert.equal(decision.kind, 'reset')
  assert.equal(decision.reason, 'history_evicted')
})

test('fails before sequence advance or fanout when a reliable event cannot fit', () => {
  const publisher = new HostEventPublisher({ epoch, maxBytes: 256 })
  const delivered = []
  publisher.subscribe((event) => delivered.push(event))

  assert.throws(
    () => publisher.publish(messageEvent('x'.repeat(1_000))),
    HostEventTooLargeError,
  )
  assert.equal(publisher.currentSeq, 0)
  assert.deepEqual(delivered, [])
})

test('isolates a throwing subscriber and preserves envelope identity for others', () => {
  const failures = []
  const publisher = new HostEventPublisher({
    epoch,
    onSubscriberError: (error) => failures.push(error),
  })
  const observed = []
  publisher.subscribe(() => {
    throw new Error('disconnected client')
  })
  publisher.subscribe((event) => observed.push(event))

  const first = publisher.publish(messageEvent('one'))
  const second = publisher.publish(messageEvent('two'))

  assert.equal(failures.length, 1)
  assert.deepEqual(observed, [first, second])
  assert.equal(publisher.subscriberCount, 1)
})

function messageEvent(delta) {
  return {
    conversationId: 'conv_demo01',
    turnId: 'turn_demo01',
    itemId: 'item_demo01',
    timestamp: '2026-08-26T07:00:00.000Z',
    type: 'message.delta',
    payload: { delta },
  }
}
