import assert from 'node:assert/strict'
import test from 'node:test'

import {
  HostEventPublisher,
  SseClientLimitError,
  SseConnectionPoolClosedError,
  SseConnectionPool,
  SseSlowClientError,
} from '../dist/api/index.js'

const epoch = '11111111-1111-4111-8111-111111111111'

test('closed pool rejects an EventSource reconnect', () => {
  const clients = new SseConnectionPool()
  clients.close()
  assert.throws(
    () => clients.connect('late-client'),
    SseConnectionPoolClosedError,
  )
})

test('fans out the same event identity to two SSE clients', async () => {
  const publisher = new HostEventPublisher({ epoch })
  const clients = new SseConnectionPool()
  publisher.subscribe((event) => clients.publish(event))
  const first = clients.connect('client-a')
  const second = clients.connect('client-b')
  const firstRead = first.read()
  const secondRead = second.read()

  const envelope = publisher.publish(messageEvent('shared'))
  const [firstFrame, secondFrame] = await Promise.all([firstRead, secondRead])

  assert.equal(firstFrame, secondFrame)
  assert.match(firstFrame, new RegExp(`^id: ${epoch}:1\\n`))
  assert.match(firstFrame, /\nevent: message\.delta\n/)
  assert.equal(JSON.parse(dataLine(firstFrame)).eventId, envelope.eventId)
})

test('disconnecting one client does not affect another client', async () => {
  const publisher = new HostEventPublisher({ epoch })
  const clients = new SseConnectionPool()
  publisher.subscribe((event) => clients.publish(event))
  const disconnected = clients.connect('client-a')
  const remaining = clients.connect('client-b')

  clients.disconnect('client-a')
  const remainingRead = remaining.read()
  const envelope = publisher.publish(messageEvent('still connected'))

  assert.equal(await disconnected.read(), undefined)
  assert.equal(
    JSON.parse(dataLine(await remainingRead)).eventId,
    envelope.eventId,
  )
  assert.equal(clients.clientCount, 1)
})

test('notifies a close listener registered after disconnection', () => {
  const clients = new SseConnectionPool()
  const connection = clients.connect('client-late-close-listener')
  clients.disconnect(connection.clientId)
  let notified = false

  connection.onClose((closed) => {
    notified = closed === connection
  })

  assert.equal(notified, true)
})

test('closes only a slow client on reliable overflow and supports replay', async () => {
  const publisher = new HostEventPublisher({ epoch })
  const clients = new SseConnectionPool({
    maxQueuedEvents: 1,
    maxQueuedBytes: 10_000,
  })
  publisher.subscribe((event) => clients.publish(event))
  const slow = clients.connect('client-slow')
  const fast = clients.connect('client-fast')
  const closeNotifications = []
  slow.onClose((connection) => closeNotifications.push(connection.closeReason))

  const slowFirstRead = slow.read()
  const fastFirstRead = fast.read()
  publisher.publish(messageEvent('one'))
  await Promise.all([slowFirstRead, fastFirstRead])

  const fastSecondRead = fast.read()
  publisher.publish(messageEvent('two'))
  await fastSecondRead
  const fastThirdRead = fast.read()
  publisher.publish(messageEvent('three'))
  await fastThirdRead

  assert.equal(slow.closed, true)
  assert.ok(slow.closeReason instanceof SseSlowClientError)
  assert.deepEqual(closeNotifications, [slow.closeReason])
  assert.equal(clients.clientCount, 1)
  assert.equal(fast.closed, false)

  const replay = publisher.replayAfter({ epoch, seq: 1 })
  assert.equal(replay.kind, 'replay')
  assert.deepEqual(
    replay.events.map((event) => event.seq),
    [2, 3],
  )
})

test('discards replay overlap without dropping newer live events', async () => {
  const publisher = new HostEventPublisher({ epoch })
  const clients = new SseConnectionPool()
  publisher.subscribe((event) => clients.publish(event))
  publisher.publish(messageEvent('before cursor'))

  const client = clients.connect('client-replay-overlap')
  const overlap = publisher.publish(messageEvent('replayed and queued'))
  const replay = publisher.replayAfter({ epoch, seq: 1 })
  assert.equal(replay.kind, 'replay')
  assert.deepEqual(replay.events, [overlap])

  const live = publisher.publish(messageEvent('newer live event'))
  client.discardEventsThrough(replay.currentSeq)

  assert.equal(client.snapshot().queuedEvents, 1)
  assert.equal(JSON.parse(dataLine(await client.read())).eventId, live.eventId)
})

test('delivers one valid frame larger than the regular queue byte limit', async () => {
  const publisher = new HostEventPublisher({ epoch })
  const clients = new SseConnectionPool({ maxQueuedBytes: 128 })
  publisher.subscribe((event) => clients.publish(event))
  const client = clients.connect('client-large-valid-frame')
  const payload = 'x'.repeat(1024)

  const envelope = publisher.publish(messageEvent(payload))

  assert.equal(client.closed, false)
  assert.equal(
    JSON.parse(dataLine(await client.read())).eventId,
    envelope.eventId,
  )
  assert.equal(client.snapshot().queuedBytes, 0)
})

test('closes a client when one reliable frame exceeds its frame limit', () => {
  const publisher = new HostEventPublisher({ epoch })
  const clients = new SseConnectionPool({
    maxQueuedBytes: 128,
    maxFrameBytes: 256,
  })
  publisher.subscribe((event) => clients.publish(event))
  const client = clients.connect('client-small')

  publisher.publish(messageEvent('oversize'))

  assert.equal(client.closed, true)
  assert.ok(client.closeReason instanceof SseSlowClientError)
  assert.equal(client.snapshot().queuedBytes, 0)
})

test('supports bounded heartbeat comments without queue growth', async () => {
  const clients = new SseConnectionPool({ maxQueuedEvents: 1 })
  const client = clients.connect('client-heartbeat')

  clients.heartbeat('keep\nalive')
  clients.heartbeat('coalesced')
  assert.equal(client.snapshot().queuedEvents, 1)
  assert.equal(await client.read(), ': keep alive\n\n')
  assert.equal(client.snapshot().queuedEvents, 0)
})

test('discards a queued heartbeat before closing on a reliable event', async () => {
  const publisher = new HostEventPublisher({ epoch })
  const clients = new SseConnectionPool({
    maxQueuedEvents: 1,
    maxQueuedBytes: 10_000,
  })
  publisher.subscribe((event) => clients.publish(event))
  const client = clients.connect('client-heartbeat-priority')

  clients.heartbeat()
  const envelope = publisher.publish(messageEvent('reliable'))

  assert.equal(client.closed, false)
  assert.equal(client.snapshot().droppedHeartbeats, 1)
  assert.equal(
    JSON.parse(dataLine(await client.read())).eventId,
    envelope.eventId,
  )
})

test('enforces the host-wide SSE client limit', () => {
  const clients = new SseConnectionPool({ maxClients: 1 })
  clients.connect('client-a')

  assert.throws(() => clients.connect('client-b'), SseClientLimitError)
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

function dataLine(frame) {
  return frame
    .split('\n')
    .find((line) => line.startsWith('data: '))
    .slice('data: '.length)
}
