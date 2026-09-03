import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { canonicalFailure } from '@codetether/agent-core'

import { HostEventPublisher } from '../dist/api/host-event-publisher.js'
import { HostService } from '../dist/api/host-service.js'
import { LocalHttpServer } from '../dist/api/local-http-server.js'
import { WorkspacePolicy } from '../dist/api/workspace-policy.js'
import { ConversationStore } from '../dist/persistence/index.js'

const origin = 'http://localhost:5173'
const initialTime = '2026-08-27T08:00:00.000Z'

test('serves a durable priority-sorted Attention index without treating tool failure or interrupt as failed work', async (t) => {
  const harness = await createHarness(t)

  const completed = await createStartedConversation(
    harness,
    'completed',
    'Review the completed change',
  )
  harness.runtime.emit({
    ...providerIdentity(completed),
    type: 'turn.completed',
    finalMessage: 'Completed safely',
    timestamp: '2026-08-27T08:01:00.000Z',
  })

  const failed = await createStartedConversation(
    harness,
    'failed',
    'Exercise safe failure handling',
  )
  harness.runtime.emit({
    ...providerIdentity(failed),
    type: 'turn.failed',
    error: {
      code: 'provider-secret-code',
      message: 'provider-secret-token must not cross the boundary',
    },
    timestamp: '2026-08-27T08:02:00.000Z',
  })
  // A duplicate Provider terminal notification is consumed without creating a
  // second durable Attention source.
  harness.runtime.emit({
    ...providerIdentity(failed),
    type: 'turn.failed',
    error: { code: 'duplicate-secret', message: 'duplicate-secret' },
    timestamp: '2026-08-27T08:02:01.000Z',
  })

  const approval = await createStartedConversation(
    harness,
    'approval',
    'Request a safe approval',
  )
  harness.runtime.requestApproval({
    ...providerIdentity(approval),
    providerRequestId: 'request-attention-open',
    providerApprovalId: 'provider-approval-attention-open',
    kind: 'command',
    summary: 'echo safe',
  })

  const interrupted = await createStartedConversation(
    harness,
    'interrupted',
    'Run an interrupted tool',
  )
  harness.runtime.emit({
    ...providerIdentity(interrupted),
    type: 'tool.started',
    itemId: 'provider-item-tool-failure',
    name: 'shell',
    command: 'exit 1',
    timestamp: '2026-08-27T08:03:00.000Z',
  })
  harness.runtime.emit({
    ...providerIdentity(interrupted),
    type: 'tool.completed',
    itemId: 'provider-item-tool-failure',
    name: 'shell',
    command: 'exit 1',
    success: false,
    summary: 'controlled failure',
    timestamp: '2026-08-27T08:03:01.000Z',
  })
  harness.runtime.emit({
    ...providerIdentity(interrupted),
    type: 'turn.interrupted',
    timestamp: '2026-08-27T08:03:02.000Z',
  })

  const response = await getJson(harness.baseUrl, '/api/v1/attention')
  assert.equal(response.status, 200)
  assert.deepEqual(
    response.body.items.map((item) => item.type),
    ['approval', 'failed', 'completed_review'],
  )
  assert.deepEqual(response.body.summary, {
    totalOpen: 3,
    approvalOpen: 1,
    completedReviewOpen: 1,
    failedOpen: 1,
  })
  const failedAttention = response.body.items.find(
    (item) => item.type === 'failed',
  )
  const failure = canonicalFailure('provider_error', '2026-08-27T08:02:00.000Z')
  assert.deepEqual(failedAttention.payload.error, {
    code: 'provider_error',
    message: 'Codex execution failed',
    failure,
  })
  const failedConversation = await getJson(
    harness.baseUrl,
    `/api/v1/conversations/${failed.conversationId}`,
  )
  assert.deepEqual(failedConversation.body.runtime.turns[0].error, {
    code: 'provider_error',
    message: 'Codex execution failed',
    failure,
  })
  assert.equal(
    harness.events.filter(
      (event) =>
        event.type === 'turn.failed' && event.turnId === failed.publicTurnId,
    ).length,
    1,
  )
  assert.equal(
    harness.events.filter(
      (event) =>
        event.type === 'attention.created' &&
        event.payload.attention.type === 'failed' &&
        event.payload.attention.turnId === failed.publicTurnId,
    ).length,
    1,
  )
  const publicAttention = JSON.stringify({
    response: response.body,
    events: harness.events.filter((event) =>
      event.type.startsWith('attention.'),
    ),
  })
  for (const providerSecret of [
    'provider-secret',
    'provider-thread-attention',
    'provider-turn-attention',
    'provider-approval-attention-open',
    'request-attention-open',
  ]) {
    assert.equal(
      publicAttention.includes(providerSecret),
      false,
      `leaked ${providerSecret}`,
    )
  }

  const filtered = await getJson(
    harness.baseUrl,
    `/api/v1/attention?projectId=${harness.projectId}&type=failed&limit=1`,
  )
  assert.equal(filtered.status, 200)
  assert.equal(filtered.body.items.length, 1)
  assert.equal(filtered.body.items[0].type, 'failed')
  assert.deepEqual(filtered.body.summary, response.body.summary)

  const invalidLimit = await getJson(
    harness.baseUrl,
    '/api/v1/attention?limit=101',
  )
  assert.equal(invalidLimit.status, 400)
  assert.equal(invalidLimit.body.code, 'invalid_request')

  const missingProject = await getJson(
    harness.baseUrl,
    '/api/v1/attention?projectId=proj_missing01',
  )
  assert.equal(missingProject.status, 404)
  assert.equal(missingProject.body.code, 'not_found')

  const movedWorkspace = `${harness.workspace}-unavailable`
  await rename(harness.workspace, movedWorkspace)
  try {
    const unavailable = await getJson(
      harness.baseUrl,
      `/api/v1/attention?projectId=${harness.projectId}`,
    )
    assert.equal(unavailable.status, 200)
    assert.equal(unavailable.body.items.length, 3)
  } finally {
    await rename(movedWorkspace, harness.workspace)
  }
})

test('resolves review and failure Attention idempotently while rejecting generic Approval resolution', async (t) => {
  const harness = await createHarness(t)
  const completed = await createStartedConversation(
    harness,
    'resolve-completed',
    'Complete a review item',
  )
  harness.runtime.emit({
    ...providerIdentity(completed),
    type: 'turn.completed',
    timestamp: '2026-08-27T09:01:00.000Z',
  })
  const failed = await createStartedConversation(
    harness,
    'resolve-failed',
    'Create a safe failed item',
  )
  harness.runtime.emit({
    ...providerIdentity(failed),
    type: 'turn.failed',
    error: { code: 'controlled', message: 'controlled' },
    timestamp: '2026-08-27T09:02:00.000Z',
  })
  const approval = await createStartedConversation(
    harness,
    'resolve-approval',
    'Create an approval item',
  )
  harness.runtime.requestApproval({
    ...providerIdentity(approval),
    providerRequestId: 'request-generic-reject',
    providerApprovalId: 'provider-approval-generic-reject',
    kind: 'command',
    summary: 'echo safe',
  })

  const open = await getJson(harness.baseUrl, '/api/v1/attention')
  const completedItem = open.body.items.find(
    (item) => item.type === 'completed_review',
  )
  const failedItem = open.body.items.find((item) => item.type === 'failed')
  const approvalItem = open.body.items.find((item) => item.type === 'approval')
  assert.ok(completedItem)
  assert.ok(failedItem)
  assert.ok(approvalItem)

  harness.setNow('2026-08-27T10:00:00.000Z')
  const eventsBefore = harness.events.length
  const first = await postJson(
    harness.baseUrl,
    `/api/v1/attention/${completedItem.attentionId}/resolve`,
    { actionId: 'act_attention_resolve_completed' },
  )
  assert.equal(first.status, 200)
  assert.equal(first.body.data.attention.status, 'resolved')
  const duplicate = await postJson(
    harness.baseUrl,
    `/api/v1/attention/${completedItem.attentionId}/resolve`,
    { actionId: 'act_attention_resolve_completed' },
  )
  assert.deepEqual(duplicate, first)
  assert.equal(
    harness.events
      .slice(eventsBefore)
      .filter((event) => event.type === 'attention.resolved').length,
    1,
  )

  const alreadyResolved = await postJson(
    harness.baseUrl,
    `/api/v1/attention/${completedItem.attentionId}/resolve`,
    { actionId: 'act_attention_resolve_completed_again' },
  )
  assert.equal(alreadyResolved.status, 409)
  assert.equal(alreadyResolved.body.code, 'conflict')

  const reusedAction = await postJson(
    harness.baseUrl,
    `/api/v1/attention/${failedItem.attentionId}/resolve`,
    { actionId: 'act_attention_resolve_completed' },
  )
  assert.equal(reusedAction.status, 409)
  assert.equal(reusedAction.body.code, 'conflict')

  const resolvedFailure = await postJson(
    harness.baseUrl,
    `/api/v1/attention/${failedItem.attentionId}/resolve`,
    { actionId: 'act_attention_resolve_failed' },
  )
  assert.equal(resolvedFailure.status, 200)
  assert.equal(resolvedFailure.body.data.attention.type, 'failed')

  const rejectedApproval = await postJson(
    harness.baseUrl,
    `/api/v1/attention/${approvalItem.attentionId}/resolve`,
    { actionId: 'act_attention_resolve_approval' },
  )
  assert.equal(rejectedApproval.status, 422)
  assert.equal(rejectedApproval.body.code, 'unsupported')

  const missing = await postJson(
    harness.baseUrl,
    '/api/v1/attention/attn_missing01/resolve',
    { actionId: 'act_attention_resolve_missing' },
  )
  assert.equal(missing.status, 404)
  assert.equal(missing.body.code, 'not_found')

  const resolved = await getJson(
    harness.baseUrl,
    '/api/v1/attention?status=resolved',
  )
  assert.equal(resolved.status, 200)
  assert.deepEqual(
    resolved.body.items.map((item) => item.type),
    ['failed', 'completed_review'],
  )
  assert.deepEqual(resolved.body.summary, {
    totalOpen: 1,
    approvalOpen: 1,
    completedReviewOpen: 0,
    failedOpen: 0,
  })
})

test('fans reliable Approval Attention transitions to two clients and replay', async (t) => {
  const harness = await createHarness(t)
  const started = await createStartedConversation(
    harness,
    'sse-approval',
    'Request approval over SSE',
  )
  const cursor = `${harness.publisher.epoch}:${String(harness.publisher.currentSeq)}`
  const firstClient = await openSse(harness.baseUrl, cursor)
  const secondClient = await openSse(harness.baseUrl, cursor)
  t.after(async () => {
    await firstClient.close()
    await secondClient.close()
  })

  harness.runtime.requestApproval({
    ...providerIdentity(started),
    providerRequestId: 'request-sse-attention',
    providerApprovalId: 'provider-approval-sse-attention',
    providerItemId: 'provider-item-sse-attention',
    kind: 'command',
    summary: 'echo safe',
    autoResolve: true,
  })
  const firstRequested = await readEventTypes(firstClient, 2)
  const secondRequested = await readEventTypes(secondClient, 2)
  assert.deepEqual(
    firstRequested.map((event) => event.event),
    ['approval.requested', 'attention.created'],
  )
  assert.deepEqual(
    secondRequested.map((event) => event.id),
    firstRequested.map((event) => event.id),
  )

  const attention = (
    await getJson(harness.baseUrl, '/api/v1/attention?type=approval')
  ).body.items[0]
  const resolved = await postJson(
    harness.baseUrl,
    `/api/v1/approvals/${attention.payload.approvalId}/resolve`,
    { actionId: 'act_attention_sse_allow', decision: 'accept' },
  )
  assert.equal(resolved.status, 202)
  const firstResolved = await readEventTypes(firstClient, 2)
  const secondResolved = await readEventTypes(secondClient, 2)
  assert.deepEqual(
    firstResolved.map((event) => event.event),
    ['approval.resolved', 'attention.resolved'],
  )
  assert.deepEqual(
    secondResolved.map((event) => event.id),
    firstResolved.map((event) => event.id),
  )

  const replay = await openSse(harness.baseUrl, cursor)
  try {
    const replayed = await readEventTypes(replay, 4)
    assert.deepEqual(
      replayed.map((event) => event.event),
      [
        'approval.requested',
        'attention.created',
        'approval.resolved',
        'attention.resolved',
      ],
    )
    assert.deepEqual(
      replayed.map((event) => event.id),
      [...firstRequested, ...firstResolved].map((event) => event.id),
    )
  } finally {
    await replay.close()
  }

  const resetClient = await openSse(
    harness.baseUrl,
    '00000000-0000-4000-8000-000000000000:1',
  )
  try {
    const reset = await resetClient.nextEvent()
    assert.equal(reset.event, 'stream.reset')
    assert.equal(reset.data.payload.reason, 'epoch_mismatch')
  } finally {
    await resetClient.close()
  }
  const reconstructed = await getJson(
    harness.baseUrl,
    '/api/v1/attention?type=approval&status=resolved',
  )
  assert.equal(reconstructed.body.items.length, 1)
  assert.equal(reconstructed.body.items[0].attentionId, attention.attentionId)
})

test('resolves declined Approval Attention only after the bound Approval endpoint resolves', async (t) => {
  const harness = await createHarness(t)
  const started = await createStartedConversation(
    harness,
    'decline-approval',
    'Decline a safe approval',
  )
  harness.runtime.requestApproval({
    ...providerIdentity(started),
    providerRequestId: 'request-attention-decline',
    providerApprovalId: 'provider-approval-attention-decline',
    kind: 'command',
    summary: 'echo safe',
    autoResolve: true,
  })
  const pending = (
    await getJson(harness.baseUrl, '/api/v1/attention?type=approval')
  ).body.items[0]
  assert.equal(pending.status, 'open')

  const response = await postJson(
    harness.baseUrl,
    `/api/v1/approvals/${pending.payload.approvalId}/resolve`,
    { actionId: 'act_attention_decline_approval', decision: 'decline' },
  )
  assert.equal(response.status, 202)
  const resolved = await getJson(
    harness.baseUrl,
    '/api/v1/attention?type=approval&status=resolved',
  )
  assert.equal(resolved.body.items.length, 1)
  assert.equal(resolved.body.items[0].payload.decision, 'decline')
  const terminalEvent = harness.events.find(
    (event) =>
      event.type === 'attention.resolved' &&
      event.payload.attention.attentionId === pending.attentionId,
  )
  assert.equal(terminalEvent.payload.attention.payload.decision, 'decline')
})

test('expires stale Approval Attention on restart without creating failed Attention', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'codetether-attention-restart-'),
  )
  const workspace = join(directory, 'workspace')
  const databasePath = join(directory, 'data', 'codetether.sqlite3')
  await mkdir(workspace, { recursive: true })
  let second
  t.after(async () => {
    await second?.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  })

  const first = await startHarness({ workspace, databasePath })
  const completed = await createStartedConversation(
    first,
    'restart-completed',
    'Keep completed review across restart',
  )
  first.runtime.emit({
    ...providerIdentity(completed),
    type: 'turn.completed',
    timestamp: '2026-08-27T08:01:00.000Z',
  })
  const failed = await createStartedConversation(
    first,
    'restart-failed',
    'Keep failure review across restart',
  )
  first.runtime.emit({
    ...providerIdentity(failed),
    type: 'turn.failed',
    error: { code: 'provider-raw', message: 'provider raw failure' },
    timestamp: '2026-08-27T08:02:00.000Z',
  })
  const started = await createStartedConversation(
    first,
    'restart-approval',
    'Leave a restart approval pending',
  )
  first.runtime.requestApproval({
    ...providerIdentity(started),
    providerRequestId: 'request-restart-attention',
    providerApprovalId: 'provider-approval-restart-attention',
    kind: 'command',
    summary: 'echo safe',
  })
  assert.equal(
    (await getJson(first.baseUrl, '/api/v1/attention')).body.items.length,
    3,
  )
  await first.close()

  second = await startHarness({ workspace, databasePath })
  const open = await getJson(second.baseUrl, '/api/v1/attention')
  assert.equal(open.status, 200)
  assert.deepEqual(
    open.body.items.map((item) => item.type),
    ['failed', 'completed_review'],
  )
  assert.deepEqual(open.body.summary, {
    totalOpen: 2,
    approvalOpen: 0,
    completedReviewOpen: 1,
    failedOpen: 1,
  })
  const expired = await getJson(
    second.baseUrl,
    '/api/v1/attention?status=expired',
  )
  assert.equal(expired.status, 200)
  assert.equal(expired.body.items.length, 1)
  assert.equal(expired.body.items[0].type, 'approval')
  assert.equal(expired.body.items[0].status, 'expired')
  assert.equal(expired.body.items[0].payload.expirationReason, 'host_restart')
  const failures = await getJson(
    second.baseUrl,
    '/api/v1/attention?type=failed',
  )
  assert.equal(failures.body.items.length, 1)
  assert.equal(failures.body.items[0].type, 'failed')
  assert.equal(
    second.events.some((event) => event.type.startsWith('attention.')),
    false,
  )
})

class FakeAgentRuntime {
  provider = 'codex'
  startConversationCalls = []
  resumeConversationCalls = []
  startTurnCalls = []
  approvalDecisions = []
  #conversationSequence = 0
  #turnSequence = 0
  #eventListeners = new Set()
  #approvalListeners = new Set()
  #failureListeners = new Set()

  subscribeEvents(listener) {
    this.#eventListeners.add(listener)
    return () => this.#eventListeners.delete(listener)
  }

  subscribeFailures(listener) {
    this.#failureListeners.add(listener)
    return () => this.#failureListeners.delete(listener)
  }

  subscribeApprovals(onRequest, onResolved) {
    const subscription = { onRequest, onResolved }
    this.#approvalListeners.add(subscription)
    return () => this.#approvalListeners.delete(subscription)
  }

  async startConversation(options) {
    const providerThreadId = `provider-thread-attention-${String(++this.#conversationSequence)}`
    this.startConversationCalls.push({ options, providerThreadId })
    return { providerThreadId }
  }

  async resumeConversation(options) {
    this.resumeConversationCalls.push(options)
    return { providerThreadId: options.providerThreadId }
  }

  async startTurn(options) {
    const providerTurnId = `provider-turn-attention-${String(++this.#turnSequence)}`
    this.startTurnCalls.push({ options, providerTurnId })
    return { providerTurnId }
  }

  async interruptTurn() {}

  emit(event) {
    for (const listener of this.#eventListeners) listener(event)
  }

  requestApproval(options) {
    const request = {
      providerRequestId: options.providerRequestId,
      providerApprovalId: options.providerApprovalId,
      providerThreadId: options.threadId,
      providerTurnId: options.turnId,
      ...(options.providerItemId === undefined
        ? {}
        : { providerItemId: options.providerItemId }),
      kind: options.kind,
      summary: options.summary,
      respond: (decision) => {
        this.approvalDecisions.push({
          providerRequestId: options.providerRequestId,
          decision,
        })
        if (options.autoResolve === true) {
          this.resolveApproval({
            providerRequestId: options.providerRequestId,
            providerApprovalId: options.providerApprovalId,
            providerThreadId: options.threadId,
            providerTurnId: options.turnId,
            ...(options.providerItemId === undefined
              ? {}
              : { providerItemId: options.providerItemId }),
            decision,
          })
        }
      },
    }
    for (const subscription of this.#approvalListeners) {
      subscription.onRequest(request)
    }
  }

  resolveApproval(resolution) {
    for (const subscription of this.#approvalListeners) {
      subscription.onResolved(resolution)
    }
  }

  async close() {
    this.#eventListeners.clear()
    this.#approvalListeners.clear()
    this.#failureListeners.clear()
  }
}

async function createHarness(t) {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-attention-api-'))
  const workspace = join(directory, 'workspace')
  await mkdir(workspace, { recursive: true })
  const harness = await startHarness({
    workspace,
    databasePath: join(directory, 'data', 'codetether.sqlite3'),
  })
  t.after(async () => {
    await harness.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  })
  return harness
}

async function startHarness({ workspace, databasePath }) {
  let currentTime = initialTime
  const runtime = new FakeAgentRuntime()
  const publisher = new HostEventPublisher({
    epoch: randomUUID(),
  })
  const service = new HostService({
    runtime,
    publisher,
    workspacePolicy: await WorkspacePolicy.create([workspace]),
    hostVersion: '0.0.0-attention-test',
    now: () => new Date(currentTime),
    persistence: ConversationStore.open({ databasePath }),
  })
  await service.registerInitialProjectRoots([workspace])
  const projectId = (await service.listProjects()).projects[0].projectId
  const machineId = (await service.listMachines()).machines[0].machineId
  const events = []
  const unsubscribe = publisher.subscribe((event) => events.push(event))
  const server = new LocalHttpServer({
    service,
    allowedOrigins: [origin],
    heartbeatMs: 60_000,
  })
  const baseUrl = await server.start(0)
  let closed = false
  return {
    baseUrl,
    workspace,
    projectId,
    machineId,
    runtime,
    publisher,
    service,
    events,
    setNow: (timestamp) => {
      currentTime = timestamp
    },
    close: async () => {
      if (closed) return
      closed = true
      unsubscribe()
      await server.close()
    },
  }
}

async function createStartedConversation(harness, suffix, text) {
  const created = await postJson(harness.baseUrl, '/api/v1/conversations', {
    actionId: `act_attention_create_${suffix}`,
    provider: 'codex',
    projectId: harness.projectId,
    machineId: harness.machineId,
  })
  assert.equal(created.status, 201)
  const conversationId = created.body.data.conversation.conversationId
  const thread = harness.runtime.startConversationCalls.at(-1)
  const started = await postJson(
    harness.baseUrl,
    `/api/v1/conversations/${conversationId}/turns`,
    {
      actionId: `act_attention_turn_${suffix}`,
      input: { type: 'text', text },
    },
  )
  assert.equal(started.status, 202)
  const turn = harness.runtime.startTurnCalls.at(-1)
  return {
    conversationId,
    publicTurnId: started.body.data.turn.turnId,
    providerThreadId: thread.providerThreadId,
    providerTurnId: turn.providerTurnId,
  }
}

function providerIdentity(binding) {
  return {
    provider: 'codex',
    threadId: binding.providerThreadId,
    turnId: binding.providerTurnId,
  }
}

async function getJson(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Origin: origin },
  })
  return { status: response.status, body: await response.json() }
}

async function postJson(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

async function openSse(baseUrl, lastEventId) {
  const controller = new AbortController()
  const response = await fetch(`${baseUrl}/api/v1/events`, {
    headers: { Origin: origin, 'Last-Event-ID': lastEventId },
    signal: controller.signal,
  })
  assert.equal(response.status, 200)
  assert.notEqual(response.body, null)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  return {
    nextEvent: async () => {
      while (true) {
        const boundary = buffer.indexOf('\n\n')
        if (boundary >= 0) {
          const frame = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          if (frame.startsWith(':')) continue
          const lines = frame.split('\n')
          return {
            id: field(lines, 'id'),
            event: field(lines, 'event'),
            data: JSON.parse(
              lines
                .filter((line) => line.startsWith('data:'))
                .map((line) => line.slice(5).trimStart())
                .join('\n'),
            ),
          }
        }
        const result = await withTimeout(reader.read(), 3_000)
        if (result.done) throw new Error('SSE stream ended unexpectedly')
        buffer += decoder
          .decode(result.value, { stream: true })
          .replaceAll('\r', '')
      }
    },
    close: async () => {
      controller.abort()
      await reader.cancel().catch(() => undefined)
    },
  }
}

async function readEventTypes(client, count) {
  const events = []
  for (let index = 0; index < count; index += 1) {
    events.push(await client.nextEvent())
  }
  return events
}

function field(lines, name) {
  const prefix = `${name}:`
  const line = lines.find((candidate) => candidate.startsWith(prefix))
  if (line === undefined) throw new Error(`SSE frame is missing ${name}`)
  return line.slice(prefix.length).trimStart()
}

async function withTimeout(promise, timeoutMs) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Timed out waiting for SSE data')),
          timeoutMs,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
