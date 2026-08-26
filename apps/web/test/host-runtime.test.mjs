import assert from 'node:assert/strict'
import test from 'node:test'

import { QueryClient } from '@tanstack/react-query'
import { CodeTetherIncompatibleProtocolError } from '@codetether/client'

import {
  getHostRuntime,
  HostRuntime,
} from '../.tmp/test-dist/runtime/host/host-runtime.js'
import {
  hostQueryKeys,
  readHostProjection,
} from '../.tmp/test-dist/runtime/host/host-query.js'

const epochA = '11111111-1111-4111-8111-111111111111'
const epochB = '22222222-2222-4222-8222-222222222222'
const timestamp = '2026-08-26T12:00:00.000Z'
const conversationId = 'conv_runtime01'
const replacementConversationId = 'conv_runtime02'
const turnId = 'turn_runtime01'
const itemId = 'item_runtime01'

test('bootstraps and snapshots through QueryClient before opening one stream', async (t) => {
  const stream = new ControlledStream()
  const client = new FakeHostClient({
    bootstraps: [bootstrap(epochA)],
    snapshots: [snapshot(epochA, 0)],
    streams: [stream],
  })
  const queryClient = createQueryClient()
  const runtime = new HostRuntime({
    queryClient,
    client,
    reconnectDelayMs: 1,
  })
  t.after(async () => await runtime.stop())

  runtime.start()
  runtime.start()
  await waitFor(() => runtime.connectionState === 'connected')

  assert.equal(client.bootstrapCalls, 1)
  assert.equal(client.snapshotCalls, 1)
  assert.deepEqual(client.connectCalls, [{ lastEventId: `${epochA}:0` }])
  assert.equal(queryClient.getQueryData(hostQueryKeys.bootstrap)?.epoch, epochA)
  assert.equal(queryClient.getQueryData(hostQueryKeys.snapshot)?.currentSeq, 0)
  assert.equal(readHostProjection(queryClient)?.cursor.seq, 0)
  assert.deepEqual(runtime.stats, {
    bootstrapRequests: 1,
    snapshotRequests: 1,
    snapshotReplacements: 1,
    streamConnections: 1,
    reconnectAttempts: 0,
    hostEvents: 0,
    projectionUpdates: 0,
    duplicateEvents: 0,
    resetRecoveries: 0,
  })
})

test('classifies unavailable and incompatible bootstrap states and supports retry', async (t) => {
  const unavailableClient = new FakeHostClient({
    bootstraps: [new Error('Host is offline'), bootstrap(epochA)],
    snapshots: [snapshot(epochA, 0)],
    streams: [new ControlledStream()],
  })
  const unavailable = new HostRuntime({
    queryClient: createQueryClient(),
    client: unavailableClient,
    reconnectDelayMs: 1,
  })
  t.after(async () => await unavailable.stop())

  unavailable.start()
  await waitFor(() => unavailable.connectionState === 'unavailable')
  await nextTask()
  unavailable.retry()
  await waitFor(() => unavailable.connectionState === 'connected')
  assert.equal(unavailableClient.bootstrapCalls, 2)

  const incompatibleClient = new FakeHostClient({
    bootstraps: [new CodeTetherIncompatibleProtocolError(2)],
  })
  const incompatible = new HostRuntime({
    queryClient: createQueryClient(),
    client: incompatibleClient,
  })
  t.after(async () => await incompatible.stop())

  incompatible.start()
  await waitFor(() => incompatible.connectionState === 'incompatible')
  assert.equal(incompatibleClient.snapshotCalls, 0)
  assert.equal(incompatibleClient.connectCalls.length, 0)
})

test('stream.reset fetches a fresh snapshot, replaces projection, and reconnects', async (t) => {
  const first = new ControlledStream()
  const second = new ControlledStream()
  const client = new FakeHostClient({
    bootstraps: [bootstrap(epochA)],
    snapshots: [
      snapshot(epochA, 0, [conversation(conversationId)]),
      snapshot(epochB, 3, [conversation(replacementConversationId)]),
    ],
    streams: [first, second],
  })
  const queryClient = createQueryClient()
  const runtime = new HostRuntime({
    queryClient,
    client,
    reconnectDelayMs: 1,
  })
  t.after(async () => await runtime.stop())

  runtime.start()
  await waitFor(() => runtime.connectionState === 'connected')
  first.push(streamReset(epochB, 0))

  await waitFor(() => client.connectCalls.length === 2)
  await waitFor(() => runtime.connectionState === 'connected')
  const projection = readHostProjection(queryClient)
  assert.ok(projection)
  assert.equal(projection.conversations[conversationId], undefined)
  assert.ok(projection.conversations[replacementConversationId])
  assert.deepEqual(client.connectCalls, [
    { lastEventId: `${epochA}:0` },
    { lastEventId: `${epochB}:3` },
  ])
  assert.equal(runtime.stats.hostEvents, 1)
  assert.equal(runtime.stats.projectionUpdates, 0)
  assert.equal(runtime.stats.snapshotReplacements, 2)
  assert.equal(runtime.stats.resetRecoveries, 1)
})

test('temporary stream failure keeps projection and reconnects from the last event', async (t) => {
  const first = new ControlledStream()
  const second = new ControlledStream()
  const client = new FakeHostClient({
    bootstraps: [bootstrap(epochA)],
    snapshots: [runningSnapshot(epochA, 2)],
    streams: [first, second],
  })
  const queryClient = createQueryClient()
  const runtime = new HostRuntime({
    queryClient,
    client,
    reconnectDelayMs: 10,
  })
  const states = []
  const unsubscribe = runtime.subscribe(() => {
    states.push(runtime.connectionState)
  })
  t.after(async () => {
    unsubscribe()
    await runtime.stop()
  })

  runtime.start()
  await waitFor(() => runtime.connectionState === 'connected')
  first.push(messageDelta(3, 'Live text'))
  await waitFor(() => runtime.stats.projectionUpdates === 1)
  const beforeFailure = readHostProjection(queryClient)
  assert.equal(
    beforeFailure?.conversations[conversationId]?.messages[0]?.body,
    'Live text',
  )

  first.fail(new Error('temporary disconnect'))
  await waitFor(() => states.includes('reconnecting'))
  assert.strictEqual(readHostProjection(queryClient), beforeFailure)
  await waitFor(() => client.connectCalls.length === 2)
  assert.equal(client.connectCalls[1]?.lastEventId, `${epochA}:3`)
  assert.equal(runtime.connectionState, 'connected')
  assert.equal(runtime.stats.reconnectAttempts, 1)
})

test('duplicates are ignored and a sequence gap forces snapshot recovery', async (t) => {
  const first = new ControlledStream()
  const second = new ControlledStream()
  const client = new FakeHostClient({
    bootstraps: [bootstrap(epochA)],
    snapshots: [runningSnapshot(epochA, 2), runningSnapshot(epochA, 4)],
    streams: [first, second],
  })
  const queryClient = createQueryClient()
  const runtime = new HostRuntime({
    queryClient,
    client,
    reconnectDelayMs: 1,
  })
  t.after(async () => await runtime.stop())

  runtime.start()
  await waitFor(() => runtime.connectionState === 'connected')
  const initialProjection = readHostProjection(queryClient)
  first.push(messageDelta(2, 'duplicate'))
  first.push(messageDelta(4, 'gap'))

  await waitFor(() => client.connectCalls.length === 2)
  assert.equal(runtime.stats.duplicateEvents, 1)
  assert.equal(runtime.stats.resetRecoveries, 1)
  assert.equal(runtime.stats.projectionUpdates, 0)
  assert.notStrictEqual(readHostProjection(queryClient), initialProjection)
  assert.equal(client.connectCalls[1]?.lastEventId, `${epochA}:4`)
})

test('returns one default runtime per QueryClient', () => {
  const queryClient = createQueryClient()
  assert.strictEqual(getHostRuntime(queryClient), getHostRuntime(queryClient))
  assert.notStrictEqual(
    getHostRuntime(queryClient),
    getHostRuntime(createQueryClient()),
  )
})

class FakeHostClient {
  bootstrapCalls = 0
  snapshotCalls = 0
  connectCalls = []
  #bootstraps
  #snapshots
  #streams

  constructor({ bootstraps = [], snapshots = [], streams = [] }) {
    this.#bootstraps = [...bootstraps]
    this.#snapshots = [...snapshots]
    this.#streams = [...streams]
  }

  async bootstrap() {
    this.bootstrapCalls += 1
    return resolveScripted(this.#bootstraps, 'bootstrap')
  }

  async snapshot() {
    this.snapshotCalls += 1
    return resolveScripted(this.#snapshots, 'snapshot')
  }

  async connectEvents(options = {}) {
    this.connectCalls.push({
      ...(options.lastEventId === undefined
        ? {}
        : { lastEventId: options.lastEventId }),
    })
    return resolveScripted(this.#streams, 'event stream')
  }
}

class ControlledStream {
  lastEventId
  #closed = false
  #queue = []
  #waiters = []

  push(event) {
    if (this.#closed) throw new Error('Stream is closed')
    this.lastEventId = event.eventId
    this.#deliver({ done: false, value: event })
  }

  fail(error) {
    if (this.#closed) return
    this.#closed = true
    const waiters = this.#waiters.splice(0)
    for (const waiter of waiters) waiter.reject(error)
  }

  async close() {
    if (this.#closed) return
    this.#closed = true
    this.#deliver({ done: true, value: undefined })
  }

  [Symbol.asyncIterator]() {
    return {
      next: async () => {
        const queued = this.#queue.shift()
        if (queued !== undefined) return queued
        if (this.#closed) return { done: true, value: undefined }
        return await new Promise((resolve, reject) => {
          this.#waiters.push({ resolve, reject })
        })
      },
      return: async () => {
        await this.close()
        return { done: true, value: undefined }
      },
    }
  }

  #deliver(result) {
    const waiter = this.#waiters.shift()
    if (waiter !== undefined) waiter.resolve(result)
    else this.#queue.push(result)
  }
}

function resolveScripted(values, label) {
  const value = values.shift()
  if (value === undefined) throw new Error(`No scripted ${label} remains`)
  if (value instanceof Error) throw value
  return value
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
}

function bootstrap(epoch) {
  return {
    protocolVersion: 1,
    hostVersion: '0.0.0-test',
    epoch,
    capabilities: {
      codex: true,
      approvals: true,
      interrupt: true,
      resume: false,
      diff: true,
      streaming: true,
    },
  }
}

function snapshot(epoch, currentSeq, conversations = []) {
  return {
    protocolVersion: 1,
    epoch,
    currentSeq,
    conversations,
    activeTurns: [],
    pendingApprovals: [],
  }
}

function runningSnapshot(epoch, currentSeq) {
  return {
    protocolVersion: 1,
    epoch,
    currentSeq,
    conversations: [
      conversation(conversationId, {
        status: 'running',
        activeTurnId: turnId,
      }),
    ],
    activeTurns: [
      {
        turnId,
        conversationId,
        status: 'running',
        startedAt: timestamp,
      },
    ],
    pendingApprovals: [],
  }
}

function conversation(id, fields = {}) {
  return {
    conversationId: id,
    provider: 'codex',
    cwd: 'E:\\isolated-workspace',
    status: 'idle',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...fields,
  }
}

function messageDelta(seq, delta) {
  return {
    protocolVersion: 1,
    epoch: epochA,
    seq,
    eventId: `${epochA}:${String(seq)}`,
    conversationId,
    turnId,
    itemId,
    timestamp,
    type: 'message.delta',
    payload: { delta },
  }
}

function streamReset(epoch, seq) {
  return {
    protocolVersion: 1,
    epoch,
    seq,
    eventId: `${epoch}:${String(seq)}`,
    conversationId: null,
    timestamp,
    type: 'stream.reset',
    payload: { reason: 'epoch_mismatch' },
  }
}

async function waitFor(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail('Timed out waiting for runtime state')
}

async function nextTask() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}
