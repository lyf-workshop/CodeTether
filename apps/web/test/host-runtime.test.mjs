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
import { conversationListQueryKeys } from '../.tmp/test-dist/runtime/host/conversation-list-query.js'
import { conversationSearchQueryKeys } from '../.tmp/test-dist/runtime/host/conversation-search-query.js'

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
  queryClient.removeQueries({
    queryKey: hostQueryKeys.bootstrap,
    exact: true,
  })
  assert.equal(runtime.bootstrap?.epoch, epochA)
  assert.equal(queryClient.getQueryData(hostQueryKeys.snapshot)?.currentSeq, 0)
  assert.equal(readHostProjection(queryClient)?.cursor.seq, 0)
  assert.deepEqual(runtime.stats, {
    bootstrapRequests: 1,
    snapshotRequests: 1,
    snapshotReplacements: 1,
    streamConnections: 1,
    reconnectAttempts: 0,
    resumeRecoveries: 0,
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
    bootstraps: [bootstrap(epochA), bootstrap(epochB)],
    snapshots: [
      snapshot(epochA, 0, [conversation(conversationId)]),
      snapshot(epochB, 3, [conversation(replacementConversationId)]),
    ],
    streams: [first, second],
  })
  const queryClient = createQueryClient()
  const listKey = conversationListQueryKeys.project('proj_runtime_search')
  const searchKey = conversationSearchQueryKeys.project('proj_runtime_search', {
    query: 'reconnect',
    archive: 'active',
    provider: null,
    status: null,
    limit: 25,
  })
  queryClient.setQueryData(listKey, [])
  queryClient.setQueryData(searchKey, { pages: [], pageParams: [] })
  const runtime = new HostRuntime({
    queryClient,
    client,
    reconnectDelayMs: 1,
  })
  const appliedEvents = []
  const unsubscribeEvents = runtime.subscribeAppliedEvents((event) => {
    appliedEvents.push(event)
  })
  t.after(async () => {
    unsubscribeEvents()
    await runtime.stop()
  })

  runtime.start()
  await waitFor(() => runtime.connectionState === 'connected')
  first.push(streamReset(epochB, 0))

  await waitFor(() => client.connectCalls.length === 2)
  await waitFor(() => runtime.connectionState === 'connected')
  const projection = readHostProjection(queryClient)
  assert.ok(projection)
  assert.equal(projection.conversations[conversationId], undefined)
  assert.ok(projection.conversations[replacementConversationId])
  assert.equal(client.bootstrapCalls, 2)
  assert.equal(queryClient.getQueryData(hostQueryKeys.bootstrap)?.epoch, epochB)
  assert.deepEqual(client.connectCalls, [
    { lastEventId: `${epochA}:0` },
    { lastEventId: `${epochB}:3` },
  ])
  assert.equal(runtime.stats.hostEvents, 1)
  assert.equal(runtime.stats.projectionUpdates, 0)
  assert.equal(runtime.stats.snapshotReplacements, 2)
  assert.equal(runtime.stats.resetRecoveries, 1)
  assert.deepEqual(appliedEvents, [])
  assert.equal(queryClient.getQueryState(listKey)?.isInvalidated, true)
  assert.equal(queryClient.getQueryState(searchKey)?.isInvalidated, true)
})

test('a fresh Snapshot in a new epoch invalidates uncertain mutation identity', async (t) => {
  const first = new ControlledStream()
  const second = new ControlledStream()
  const client = new FakeHostClient({
    bootstraps: [bootstrap(epochA), bootstrap(epochB)],
    snapshots: [
      snapshot(epochA, 0, [conversation(conversationId)]),
      snapshot(epochB, 0, [conversation(conversationId)]),
    ],
    streams: [first, second],
    starts: [
      new TypeError('response lost before Host restart'),
      (call) => acceptedTurn(call.request.actionId),
    ],
  })
  const runtime = new HostRuntime({
    queryClient: createQueryClient(),
    client,
    reconnectDelayMs: 1,
  })
  t.after(async () => await runtime.stop())

  runtime.start()
  await waitFor(() => runtime.connectionState === 'connected')
  await assert.rejects(
    runtime.startTurn(conversationId, 'Retry only after fresh Snapshot'),
    TypeError,
  )
  const previousActionId = client.startCalls[0].request.actionId

  first.push(streamReset(epochB, 0))
  await waitFor(() => client.connectCalls.length === 2)
  await waitFor(() => runtime.connectionState === 'connected')
  await runtime.startTurn(conversationId, 'Retry only after fresh Snapshot')

  assert.notEqual(client.startCalls[1].request.actionId, previousActionId)
})

test('stream.reset replacement restores retained multi-Turn snapshot history', async (t) => {
  const first = new ControlledStream()
  const second = new ControlledStream()
  const client = new FakeHostClient({
    bootstraps: [bootstrap(epochA), bootstrap(epochB)],
    snapshots: [
      snapshot(epochA, 0, [conversation(conversationId)]),
      historicalSnapshot(epochB, 12),
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
  const model = readHostProjection(queryClient)?.conversations[conversationId]
  assert.ok(model)
  assert.deepEqual(
    model.turns.map((turn) => turn.id),
    ['turn_history01', 'turn_history02'],
  )
  assert.deepEqual(
    model.messages.map((message) => [message.author, message.body]),
    [
      ['user', 'First retained prompt'],
      ['agent', 'First retained answer'],
      ['user', 'Second retained prompt'],
      ['agent', 'Second retained answer'],
    ],
  )
  assert.equal(model.tools[0]?.name, 'command')
  assert.equal(model.tools[0]?.command, 'pnpm test')
  assert.equal(model.changes[0]?.path, 'src/example.ts')
  assert.equal(model.terminal.text, '1 test passed\n')
  assert.equal(client.connectCalls[1]?.lastEventId, `${epochB}:12`)
  assert.equal(runtime.stats.snapshotReplacements, 2)
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
  const appliedEvents = []
  const unsubscribeEvents = runtime.subscribeAppliedEvents((event) => {
    appliedEvents.push(event)
  })
  t.after(async () => {
    unsubscribe()
    unsubscribeEvents()
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
  assert.deepEqual(
    appliedEvents.map((event) => event.eventId),
    [`${epochA}:3`],
  )

  first.fail(new Error('temporary disconnect'))
  await waitFor(() => states.includes('reconnecting'))
  assert.strictEqual(readHostProjection(queryClient), beforeFailure)
  await waitFor(() => client.connectCalls.length === 2)
  assert.equal(client.connectCalls[1]?.lastEventId, `${epochA}:3`)
  assert.equal(runtime.connectionState, 'connected')
  assert.equal(runtime.stats.reconnectAttempts, 1)
})

test('duplicate Desktop resume signals close one stream and reconnect from the same cursor', async (t) => {
  const first = new ControlledStream()
  const second = new ControlledStream()
  const client = new FakeHostClient({
    bootstraps: [bootstrap(epochA), bootstrap(epochA)],
    snapshots: [snapshot(epochA, 0)],
    streams: [first, second],
  })
  const runtime = new HostRuntime({
    queryClient: createQueryClient(),
    client,
    reconnectDelayMs: 60_000,
  })
  t.after(async () => await runtime.stop())

  runtime.start()
  await waitFor(() => runtime.connectionState === 'connected')
  const connectionStates = []
  const unsubscribeConnection = runtime.subscribe(() => {
    connectionStates.push(runtime.connectionState)
  })
  t.after(unsubscribeConnection)
  for (let index = 0; index < 5; index += 1) {
    runtime.recoverAfterDesktopResume({ hostEpoch: epochA })
  }

  await waitFor(() => client.connectCalls.length === 2)
  assert.deepEqual(client.connectCalls, [
    { lastEventId: `${epochA}:0` },
    { lastEventId: `${epochA}:0` },
  ])
  assert.equal(client.bootstrapCalls, 2)
  assert.equal(client.snapshotCalls, 1)
  assert.equal(runtime.stats.resumeRecoveries, 1)
  assert.equal(runtime.stats.reconnectAttempts, 0)
  assert.equal(runtime.connectionState, 'connected')
  assert.equal(connectionStates.includes('reconnecting'), true)
})

test('Desktop resume aborts one half-open SSE handshake and reuses its cursor', async (t) => {
  const connected = new ControlledStream()
  const client = new FakeHostClient({
    bootstraps: [bootstrap(epochA), bootstrap(epochA)],
    snapshots: [snapshot(epochA, 0)],
    streams: [
      ({ signal }) =>
        new Promise((_, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(signal.reason ?? new Error('aborted')),
            { once: true },
          )
        }),
      connected,
    ],
  })
  const runtime = new HostRuntime({
    queryClient: createQueryClient(),
    client,
    reconnectDelayMs: 60_000,
  })
  t.after(async () => await runtime.stop())

  runtime.start()
  await waitFor(() => client.connectCalls.length === 1)
  runtime.recoverAfterDesktopResume({ hostEpoch: epochA })

  await waitFor(() => runtime.connectionState === 'connected')
  assert.deepEqual(client.connectCalls, [
    { lastEventId: `${epochA}:0` },
    { lastEventId: `${epochA}:0` },
  ])
  assert.equal(runtime.stats.resumeRecoveries, 1)
  assert.equal(runtime.stats.reconnectAttempts, 0)
})

test('Desktop resume refuses a different Host epoch before reopening SSE', async (t) => {
  const first = new ControlledStream()
  const client = new FakeHostClient({
    bootstraps: [bootstrap(epochA), bootstrap(epochB)],
    snapshots: [snapshot(epochA, 0)],
    streams: [first],
  })
  const queryClient = createQueryClient()
  const runtime = new HostRuntime({
    queryClient,
    client,
    reconnectDelayMs: 60_000,
  })
  t.after(async () => await runtime.stop())

  runtime.start()
  await waitFor(() => runtime.connectionState === 'connected')
  runtime.recoverAfterDesktopResume({ hostEpoch: epochA })

  await waitFor(() => runtime.connectionState === 'unavailable')
  assert.equal(client.bootstrapCalls, 2)
  assert.equal(client.snapshotCalls, 1)
  assert.deepEqual(client.connectCalls, [{ lastEventId: `${epochA}:0` }])
  assert.equal(readHostProjection(queryClient)?.cursor.epoch, epochA)
  assert.equal(runtime.bootstrap?.epoch, epochA)
})

test('Desktop resume retries a transient bootstrap failure without manual recovery', async (t) => {
  const first = new ControlledStream()
  const second = new ControlledStream()
  const client = new FakeHostClient({
    bootstraps: [
      bootstrap(epochA),
      new Error('loopback bootstrap was temporarily unavailable'),
      bootstrap(epochA),
    ],
    snapshots: [snapshot(epochA, 0)],
    streams: [first, second],
  })
  const runtime = new HostRuntime({
    queryClient: createQueryClient(),
    client,
    reconnectDelayMs: 1,
  })
  t.after(async () => await runtime.stop())

  runtime.start()
  await waitFor(() => runtime.connectionState === 'connected')
  runtime.recoverAfterDesktopResume({ hostEpoch: epochA })

  await waitFor(() => client.bootstrapCalls === 3)
  await waitFor(() => client.connectCalls.length === 2)
  assert.equal(runtime.connectionState, 'connected')
  assert.equal(runtime.stats.resumeRecoveries, 1)
  assert.equal(runtime.stats.reconnectAttempts, 1)
  assert.deepEqual(client.connectCalls, [
    { lastEventId: `${epochA}:0` },
    { lastEventId: `${epochA}:0` },
  ])
})

test('Desktop resume reports an incompatible bootstrap instead of retrying forever', async (t) => {
  const first = new ControlledStream()
  const client = new FakeHostClient({
    bootstraps: [bootstrap(epochA), new CodeTetherIncompatibleProtocolError(2)],
    snapshots: [snapshot(epochA, 0)],
    streams: [first],
  })
  const runtime = new HostRuntime({
    queryClient: createQueryClient(),
    client,
    reconnectDelayMs: 1,
  })
  t.after(async () => await runtime.stop())

  runtime.start()
  await waitFor(() => runtime.connectionState === 'connected')
  runtime.recoverAfterDesktopResume({ hostEpoch: epochA })

  await waitFor(() => runtime.connectionState === 'incompatible')
  assert.equal(client.bootstrapCalls, 2)
  assert.equal(runtime.stats.reconnectAttempts, 0)
  assert.deepEqual(client.connectCalls, [{ lastEventId: `${epochA}:0` }])
})

test('duplicates are ignored and a sequence gap forces snapshot recovery', async (t) => {
  const first = new ControlledStream()
  const second = new ControlledStream()
  const client = new FakeHostClient({
    bootstraps: [bootstrap(epochA), bootstrap(epochA)],
    snapshots: [runningSnapshot(epochA, 2), runningSnapshot(epochA, 4)],
    streams: [first, second],
  })
  const queryClient = createQueryClient()
  const runtime = new HostRuntime({
    queryClient,
    client,
    reconnectDelayMs: 1,
  })
  const appliedEvents = []
  const unsubscribeEvents = runtime.subscribeAppliedEvents((event) => {
    appliedEvents.push(event)
  })
  t.after(async () => {
    unsubscribeEvents()
    await runtime.stop()
  })

  runtime.start()
  await waitFor(() => runtime.connectionState === 'connected')
  const initialProjection = readHostProjection(queryClient)
  first.push(messageDelta(2, 'duplicate'))
  first.push(messageDelta(4, 'gap'))

  await waitFor(() => client.connectCalls.length === 2)
  assert.equal(runtime.stats.duplicateEvents, 1)
  assert.equal(runtime.stats.resetRecoveries, 1)
  assert.equal(runtime.stats.projectionUpdates, 0)
  assert.deepEqual(appliedEvents, [])
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

test('a same-task retain survives the deferred StrictMode release', async (t) => {
  const client = new FakeHostClient({
    bootstraps: [bootstrap(epochA)],
    snapshots: [snapshot(epochA, 0)],
    streams: [new ControlledStream()],
  })
  const runtime = new HostRuntime({
    queryClient: createQueryClient(),
    client,
    reconnectDelayMs: 1,
  })
  t.after(async () => await runtime.stop())

  const releaseFirstMount = runtime.retain()
  releaseFirstMount()
  const releaseSecondMount = runtime.retain()
  t.after(releaseSecondMount)

  await waitFor(() => runtime.connectionState === 'connected')
  await nextTask()
  assert.equal(runtime.connectionState, 'connected')
  assert.equal(client.bootstrapCalls, 1)
  assert.equal(client.snapshotCalls, 1)
})

class FakeHostClient {
  bootstrapCalls = 0
  snapshotCalls = 0
  connectCalls = []
  startCalls = []
  #bootstraps
  #snapshots
  #streams
  #starts

  constructor({ bootstraps = [], snapshots = [], streams = [], starts = [] }) {
    this.#bootstraps = [...bootstraps]
    this.#snapshots = [...snapshots]
    this.#streams = [...streams]
    this.#starts = [...starts]
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
    const implementation = resolveScripted(this.#streams, 'event stream')
    return typeof implementation === 'function'
      ? await implementation(options)
      : implementation
  }

  async startTurn(conversationId, request) {
    const call = { conversationId, request }
    this.startCalls.push(call)
    const implementation = resolveScripted(this.#starts, 'start Turn')
    return typeof implementation === 'function'
      ? await implementation(call)
      : implementation
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

function acceptedTurn(actionId) {
  return {
    protocolVersion: 1,
    actionId,
    status: 'accepted',
    data: {
      turn: {
        turnId,
        conversationId,
        status: 'running',
        input: {
          type: 'text',
          text: 'Retry only after fresh Snapshot',
          timestamp,
        },
        startedAt: timestamp,
      },
    },
  }
}

function historicalSnapshot(epoch, currentSeq) {
  const firstTurn = {
    turnId: 'turn_history01',
    conversationId,
    status: 'completed',
    input: {
      type: 'text',
      text: 'First retained prompt',
      timestamp,
    },
    startedAt: timestamp,
    completedAt: timestamp,
    finalMessage: 'First retained answer',
  }
  const secondTurn = {
    turnId: 'turn_history02',
    conversationId,
    status: 'completed',
    input: {
      type: 'text',
      text: 'Second retained prompt',
      timestamp,
    },
    startedAt: timestamp,
    completedAt: timestamp,
    finalMessage: 'Second retained answer',
  }
  return {
    protocolVersion: 1,
    epoch,
    currentSeq,
    conversations: [
      conversation(conversationId, {
        status: 'completed',
        updatedAt: timestamp,
      }),
    ],
    activeTurns: [],
    pendingApprovals: [],
    conversationRuntimes: [
      {
        conversationId,
        turns: [firstTurn, secondTurn],
        messages: [
          {
            turnId: firstTurn.turnId,
            itemId: 'item_history01',
            text: 'First retained answer',
            status: 'completed',
            timestamp,
            order: 2,
          },
          {
            turnId: secondTurn.turnId,
            itemId: 'item_history02',
            text: 'Second retained answer',
            status: 'completed',
            timestamp,
            order: 8,
          },
        ],
        tools: [
          {
            turnId: secondTurn.turnId,
            itemId: 'item_tool02',
            name: 'command',
            command: 'pnpm test',
            status: 'completed',
            success: true,
            outputSummary: '1 test passed\n',
            startedAt: timestamp,
            completedAt: timestamp,
            order: 9,
          },
        ],
        changes: [
          {
            turnId: secondTurn.turnId,
            itemId: 'item_change02',
            path: 'src/example.ts',
            kind: 'modified',
            diff: '@@ -1 +1 @@\n-old\n+new',
            timestamp,
            order: 10,
          },
        ],
        terminal: {
          turnId: secondTurn.turnId,
          itemId: 'item_tool02',
          command: 'pnpm test',
          text: '1 test passed\n',
          stream: 'combined',
          truncated: false,
          updatedAt: timestamp,
        },
        history: {
          evictedTurns: 0,
          evictedMessages: 0,
          evictedTools: 0,
          evictedChanges: 0,
          truncated: false,
        },
      },
    ],
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
