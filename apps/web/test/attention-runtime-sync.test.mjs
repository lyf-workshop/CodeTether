import assert from 'node:assert/strict'
import test from 'node:test'

import { QueryClient, QueryObserver } from '@tanstack/react-query'

import {
  attentionListQueryOptions,
  attentionQueryKeys,
} from '../.tmp/test-dist/runtime/host/attention-query.js'
import { HostRuntime } from '../.tmp/test-dist/runtime/host/host-runtime.js'

const epochA = '11111111-1111-4111-8111-111111111111'
const epochB = '22222222-2222-4222-8222-222222222222'
const timestamp = '2026-08-27T12:00:00.000Z'
const conversationId = 'conv_attention_sync01'
const turnId = 'turn_attention_sync01'

test('semantic Attention events refetch durable truth while unrelated events do not', async (t) => {
  const stream = new ControlledStream()
  const client = new FakeHostClient({
    bootstraps: [bootstrap(epochA)],
    snapshots: [snapshot(epochA, 0)],
    streams: [stream],
    attention: [
      attentionResponse([]),
      attentionResponse([openAttention()]),
      attentionResponse([]),
    ],
  })
  const queryClient = createQueryClient()
  const runtime = new HostRuntime({ queryClient, client, reconnectDelayMs: 1 })
  t.after(async () => await runtime.stop())

  runtime.start()
  await waitFor(() => runtime.connectionState === 'connected')
  const observation = observeAttention(queryClient, runtime)
  t.after(observation.unsubscribe)
  await waitFor(
    () =>
      client.attentionCalls.length === 1 &&
      observation.result().data?.summary.totalOpen === 0,
  )
  assert.equal(observation.result().data?.summary.totalOpen, 0)

  stream.push(attentionCreated(epochA, 1))
  await waitFor(
    () =>
      client.attentionCalls.length === 2 &&
      observation.result().data?.summary.totalOpen === 1,
  )
  assert.deepEqual(
    observation.result().data?.items.map((item) => item.attentionId),
    ['attn_sync001'],
  )

  stream.push(conversationStarted(epochA, 2))
  await waitFor(() => runtime.stats.hostEvents === 2)
  await nextTask()
  assert.equal(client.attentionCalls.length, 2)

  stream.push(attentionResolved(epochA, 3))
  await waitFor(
    () =>
      client.attentionCalls.length === 3 &&
      observation.result().data?.summary.totalOpen === 0,
  )
  assert.deepEqual(observation.result().data?.items, [])
})

test('stream.reset refetches Attention only after the replacement Snapshot', async (t) => {
  const first = new ControlledStream()
  const second = new ControlledStream()
  const operations = []
  const client = new FakeHostClient({
    bootstraps: [bootstrap(epochA), bootstrap(epochB)],
    snapshots: [snapshot(epochA, 0), snapshot(epochB, 4)],
    streams: [first, second],
    attention: [attentionResponse([openApproval()]), attentionResponse([])],
    operations,
  })
  const queryClient = createQueryClient()
  const runtime = new HostRuntime({ queryClient, client, reconnectDelayMs: 1 })
  t.after(async () => await runtime.stop())

  runtime.start()
  await waitFor(() => runtime.connectionState === 'connected')
  const observation = observeAttention(queryClient, runtime)
  t.after(observation.unsubscribe)
  await waitFor(() => observation.result().data?.summary.totalOpen === 1)

  first.push(streamReset(epochB, 0))

  await waitFor(
    () =>
      client.snapshotCalls === 2 &&
      client.attentionCalls.length === 2 &&
      client.connectCalls.length === 2 &&
      observation.result().data?.summary.totalOpen === 0,
  )
  assert.ok(
    operations.indexOf('snapshot:2') < operations.indexOf('attention:2'),
    operations.join(', '),
  )
  assert.equal(runtime.stats.resetRecoveries, 1)
  assert.equal(
    queryClient.getQueryData(attentionQueryKeys.open).items.length,
    0,
  )
})

test('two independent runtimes synchronize their own Attention caches from one event identity', async (t) => {
  const event = attentionCreated(epochA, 1)
  const first = runtimeFixture()
  const second = runtimeFixture()
  t.after(async () => {
    first.observation?.unsubscribe()
    second.observation?.unsubscribe()
    await Promise.all([first.runtime.stop(), second.runtime.stop()])
  })

  first.runtime.start()
  second.runtime.start()
  await waitFor(
    () =>
      first.runtime.connectionState === 'connected' &&
      second.runtime.connectionState === 'connected',
  )
  first.observation = observeAttention(first.queryClient, first.runtime)
  second.observation = observeAttention(second.queryClient, second.runtime)
  await waitFor(
    () =>
      first.client.attentionCalls.length === 1 &&
      second.client.attentionCalls.length === 1,
  )

  first.stream.push(event)
  second.stream.push(event)

  await waitFor(
    () =>
      first.observation.result().data?.summary.totalOpen === 1 &&
      second.observation.result().data?.summary.totalOpen === 1,
  )
  assert.equal(first.client.attentionCalls.length, 2)
  assert.equal(second.client.attentionCalls.length, 2)
  assert.deepEqual(
    first.queryClient.getQueryData(attentionQueryKeys.open),
    second.queryClient.getQueryData(attentionQueryKeys.open),
  )
})

class FakeHostClient {
  attentionCalls = []
  bootstrapCalls = 0
  connectCalls = []
  snapshotCalls = 0
  #attention
  #bootstraps
  #operations
  #snapshots
  #streams

  constructor({ attention, bootstraps, operations = [], snapshots, streams }) {
    this.#attention = [...attention]
    this.#bootstraps = [...bootstraps]
    this.#operations = operations
    this.#snapshots = [...snapshots]
    this.#streams = [...streams]
  }

  async bootstrap() {
    this.bootstrapCalls += 1
    this.#operations.push(`bootstrap:${this.bootstrapCalls}`)
    return take(this.#bootstraps, 'bootstrap')
  }

  async snapshot() {
    this.snapshotCalls += 1
    this.#operations.push(`snapshot:${this.snapshotCalls}`)
    return take(this.#snapshots, 'Snapshot')
  }

  async connectEvents(options = {}) {
    this.connectCalls.push(options)
    this.#operations.push(`stream:${this.connectCalls.length}`)
    return take(this.#streams, 'event stream')
  }

  async listAttention(options = {}) {
    this.attentionCalls.push(options)
    this.#operations.push(`attention:${this.attentionCalls.length}`)
    return take(this.#attention, 'Attention response')
  }
}

class ControlledStream {
  #closed = false
  #queue = []
  #waiters = []

  push(event) {
    if (this.#closed) throw new Error('Stream is closed')
    this.#deliver({ done: false, value: event })
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

function runtimeFixture() {
  const stream = new ControlledStream()
  const response = attentionResponse([openAttention()])
  const client = new FakeHostClient({
    bootstraps: [bootstrap(epochA)],
    snapshots: [snapshot(epochA, 0)],
    streams: [stream],
    attention: [attentionResponse([]), response],
  })
  const queryClient = createQueryClient()
  return {
    client,
    observation: undefined,
    queryClient,
    runtime: new HostRuntime({ queryClient, client, reconnectDelayMs: 1 }),
    stream,
  }
}

function observeAttention(queryClient, runtime) {
  const observer = new QueryObserver(
    queryClient,
    attentionListQueryOptions(runtime),
  )
  const unsubscribe = observer.subscribe(() => undefined)
  return { result: () => observer.getCurrentResult(), unsubscribe }
}

function attentionResponse(items) {
  const counts = {
    approval: 0,
    completed_review: 0,
    failed: 0,
  }
  for (const item of items) counts[item.type] += 1
  return {
    protocolVersion: 1,
    items,
    summary: {
      totalOpen: items.length,
      approvalOpen: counts.approval,
      completedReviewOpen: counts.completed_review,
      failedOpen: counts.failed,
    },
  }
}

function openAttention() {
  return {
    attentionId: 'attn_sync001',
    projectId: 'proj_attention01',
    conversationId,
    turnId,
    type: 'completed_review',
    status: 'open',
    createdAt: timestamp,
    updatedAt: timestamp,
    payload: { conversationTitle: 'Review the completed work' },
  }
}

function openApproval() {
  return {
    ...openAttention(),
    attentionId: 'attn_approval_sync01',
    type: 'approval',
    payload: {
      approvalId: 'approval_attention_sync01',
      kind: 'command',
      actionTitle: '执行命令',
      actionSubtitle: 'git status --short',
    },
  }
}

function attentionCreated(epoch, seq) {
  return envelope(epoch, seq, 'attention.created', {
    attention: openAttention(),
  })
}

function attentionResolved(epoch, seq) {
  return envelope(epoch, seq, 'attention.resolved', {
    attention: {
      ...openAttention(),
      status: 'resolved',
      resolvedAt: timestamp,
    },
  })
}

function conversationStarted(epoch, seq) {
  const otherConversationId = 'conv_attention_other01'
  return {
    protocolVersion: 1,
    epoch,
    seq,
    eventId: `${epoch}:${seq}`,
    conversationId: otherConversationId,
    timestamp,
    type: 'conversation.started',
    payload: {
      conversation: {
        conversationId: otherConversationId,
        projectId: 'proj_attention01',
        title: 'Unrelated Conversation',
        provider: 'codex',
        cwd: 'C:\\workspace',
        status: 'idle',
        createdAt: timestamp,
        updatedAt: timestamp,
        lastActivityAt: timestamp,
      },
    },
  }
}

function envelope(epoch, seq, type, payload) {
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

function streamReset(epoch, seq) {
  return {
    protocolVersion: 1,
    epoch,
    seq,
    eventId: `${epoch}:${seq}`,
    conversationId: null,
    timestamp,
    type: 'stream.reset',
    payload: { reason: 'epoch_mismatch' },
  }
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
      resume: true,
      diff: true,
      streaming: true,
    },
  }
}

function snapshot(epoch, currentSeq) {
  return {
    protocolVersion: 1,
    epoch,
    currentSeq,
    conversations: [],
    activeTurns: [],
    pendingApprovals: [],
  }
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
}

function take(values, label) {
  const value = values.shift()
  if (value === undefined) throw new Error(`No scripted ${label} remains`)
  return value
}

async function nextTask() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function waitFor(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.fail('Timed out waiting for runtime state')
}
