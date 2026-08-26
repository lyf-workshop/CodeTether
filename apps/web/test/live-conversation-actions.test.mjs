import assert from 'node:assert/strict'
import test from 'node:test'

import { CodeTetherResponseError } from '@codetether/client'

import {
  ConversationMutationBusyError,
  LiveConversationActions,
  mutationErrorMessage,
} from '../.tmp/test-dist/runtime/host/live-conversation-actions.js'

const timestamp = '2026-08-26T12:00:00.000Z'

test('fresh logical submits receive unique valid action IDs', async () => {
  const client = new FakeMutationClient()
  const ids = Array.from(
    { length: 100 },
    (_, index) => `act_unique_${String(index).padStart(3, '0')}`,
  )
  const actions = new LiveConversationActions(client, () => ids.shift())

  for (let index = 0; index < 100; index += 1) {
    await actions.startTurn('conv_control01', `Prompt ${index}`)
  }

  const observed = client.startCalls.map((call) => call.request.actionId)
  assert.equal(new Set(observed).size, 100)
  assert.ok(observed.every((id) => /^act_[A-Za-z0-9_-]{6,95}$/.test(id)))
})

test('same in-flight submit produces one request and one Promise', async () => {
  const deferred = createDeferred()
  const client = new FakeMutationClient({ start: () => deferred.promise })
  const actions = new LiveConversationActions(client, idFactory())

  const first = actions.startTurn('conv_control01', 'Inspect safely')
  const second = actions.startTurn('conv_control01', 'Inspect safely')
  assert.strictEqual(second, first)
  assert.equal(client.startCalls.length, 1)

  deferred.resolve(startResponse(client.startCalls[0].request.actionId))
  await first
})

test('ambiguous network retry reuses actionId while a new submit does not', async () => {
  let attempts = 0
  const client = new FakeMutationClient({
    start: (call) => {
      attempts += 1
      return attempts === 1
        ? Promise.reject(new TypeError('response lost'))
        : Promise.resolve(startResponse(call.request.actionId))
    },
  })
  const actions = new LiveConversationActions(client, idFactory())

  await assert.rejects(
    actions.startTurn('conv_control01', 'Same intent'),
    TypeError,
  )
  await actions.startTurn('conv_control01', 'Same intent')
  await actions.startTurn('conv_control01', 'Next intent')

  assert.equal(
    client.startCalls[0].request.actionId,
    client.startCalls[1].request.actionId,
  )
  assert.notEqual(
    client.startCalls[1].request.actionId,
    client.startCalls[2].request.actionId,
  )
})

test('interrupt and approvals preserve exact identities and isolate pending IDs', async () => {
  const approvalA = createDeferred()
  const approvalB = createDeferred()
  const interrupt = createDeferred()
  const client = new FakeMutationClient({
    interrupt: () => interrupt.promise,
    approval: (call) =>
      call.approvalId === 'approval_control01'
        ? approvalA.promise
        : approvalB.promise,
  })
  const actions = new LiveConversationActions(client, idFactory())

  const interrupted = actions.interruptTurn('conv_control01', 'turn_control01')
  const duplicateInterrupt = actions.interruptTurn(
    'conv_control01',
    'turn_control01',
  )
  assert.strictEqual(duplicateInterrupt, interrupted)
  assert.deepEqual(client.interruptCalls[0].identity, [
    'conv_control01',
    'turn_control01',
  ])

  const accepted = actions.resolveApproval('approval_control01', 'accept')
  const declined = actions.resolveApproval('approval_control02', 'decline')
  assert.equal(client.approvalCalls.length, 2)
  assert.deepEqual(
    client.approvalCalls.map((call) => [call.approvalId, call.decision]),
    [
      ['approval_control01', 'accept'],
      ['approval_control02', 'decline'],
    ],
  )
  await assert.rejects(
    actions.resolveApproval('approval_control01', 'decline'),
    ConversationMutationBusyError,
  )

  interrupt.resolve(
    interruptResponse(client.interruptCalls[0].request.actionId),
  )
  approvalA.resolve(
    approvalResponse(
      'approval_control01',
      client.approvalCalls[0].request.actionId,
    ),
  )
  approvalB.resolve(
    approvalResponse(
      'approval_control02',
      client.approvalCalls[1].request.actionId,
    ),
  )
  await Promise.all([interrupted, accepted, declined])
})

test('safe mutation errors never expose Provider diagnostics', () => {
  const error = new CodeTetherResponseError(503, {
    protocolVersion: 1,
    actionId: 'act_control_001',
    code: 'provider_error',
    message: 'raw JSON-RPC stack and provider payload',
  })
  const message = mutationErrorMessage(error, '发送消息')
  assert.equal(message, 'Codex 未能发送消息。')
  assert.equal(message.includes('JSON-RPC'), false)
  assert.equal(
    mutationErrorMessage(new TypeError('network details'), '发送消息'),
    '无法连接到 CodeTether Host，请检查连接后重试。',
  )
})

class FakeMutationClient {
  constructor(implementations = {}) {
    this.implementations = implementations
    this.startCalls = []
    this.interruptCalls = []
    this.approvalCalls = []
  }

  startTurn(conversationId, request) {
    const call = { conversationId, request }
    this.startCalls.push(call)
    return (
      this.implementations.start?.(call) ??
      Promise.resolve(startResponse(request.actionId))
    )
  }

  interruptTurn(conversationId, turnId, request) {
    const call = { identity: [conversationId, turnId], request }
    this.interruptCalls.push(call)
    return (
      this.implementations.interrupt?.(call) ??
      Promise.resolve(interruptResponse(request.actionId))
    )
  }

  resolveApproval(approvalId, request) {
    const call = { approvalId, decision: request.decision, request }
    this.approvalCalls.push(call)
    return (
      this.implementations.approval?.(call) ??
      Promise.resolve(approvalResponse(approvalId, request.actionId))
    )
  }
}

function idFactory() {
  let index = 0
  return () => `act_control_${String(++index).padStart(3, '0')}`
}

function startResponse(actionId) {
  return {
    protocolVersion: 1,
    actionId,
    status: 'accepted',
    data: {
      turn: {
        turnId: 'turn_control01',
        conversationId: 'conv_control01',
        status: 'running',
        input: { type: 'text', text: 'Prompt', timestamp },
        startedAt: timestamp,
      },
    },
  }
}

function interruptResponse(actionId) {
  return {
    ...startResponse(actionId),
    data: { turn: startResponse(actionId).data.turn },
  }
}

function approvalResponse(approvalId, actionId) {
  return {
    protocolVersion: 1,
    actionId,
    status: 'accepted',
    data: {
      approval: {
        approvalId,
        conversationId: 'conv_control01',
        turnId: 'turn_control01',
        kind: 'command',
        summary: 'git status --short',
        status: 'pending',
        requestedAt: timestamp,
      },
    },
  }
}

function createDeferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
