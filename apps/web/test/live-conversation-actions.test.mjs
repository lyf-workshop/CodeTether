import assert from 'node:assert/strict'
import test from 'node:test'

import { CodeTetherResponseError } from '@codetether/client'

import {
  ConversationMutationBusyError,
  HostEpochChangedError,
  LiveConversationActions,
  mutationErrorMessage,
} from '../.tmp/test-dist/runtime/host/live-conversation-actions.js'

const timestamp = '2026-08-26T12:00:00.000Z'
const epochA = '11111111-1111-4111-8111-111111111111'
const epochB = '22222222-2222-4222-8222-222222222222'

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
  actions.adoptHostEpoch(epochA)

  await assert.rejects(
    actions.startTurn('conv_control01', 'Same intent'),
    TypeError,
  )
  actions.adoptHostEpoch(epochA)
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

test('an explicit failed-Turn retry always creates a fresh logical action', async () => {
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
  actions.adoptHostEpoch(epochA)

  await assert.rejects(
    actions.startTurn('conv_control01', 'Explicitly repeat this work'),
    TypeError,
  )
  await actions.startNewTurn('conv_control01', 'Explicitly repeat this work')

  assert.notEqual(
    client.startCalls[0].request.actionId,
    client.startCalls[1].request.actionId,
  )
})

test('an ambiguous explicit failed-Turn retry preserves its fresh actionId', async () => {
  let attempts = 0
  const client = new FakeMutationClient({
    start: (call) => {
      attempts += 1
      return attempts === 1
        ? Promise.reject(new TypeError('explicit retry response lost'))
        : Promise.resolve(startResponse(call.request.actionId))
    },
  })
  const actions = new LiveConversationActions(client, idFactory())
  actions.adoptHostEpoch(epochA)

  await assert.rejects(
    actions.startNewTurn('conv_control01', 'Explicit recovery request'),
    TypeError,
  )
  await actions.startNewTurn('conv_control01', 'Explicit recovery request')

  assert.equal(client.startCalls.length, 2)
  assert.equal(
    client.startCalls[0].request.actionId,
    client.startCalls[1].request.actionId,
  )
})

test('an unresolved explicit retry cannot be replaced with changed input', async () => {
  const client = new FakeMutationClient({
    start: () => Promise.reject(new TypeError('explicit retry response lost')),
  })
  const actions = new LiveConversationActions(client, idFactory())
  actions.adoptHostEpoch(epochA)

  await assert.rejects(
    actions.startNewTurn('conv_control01', 'Original explicit recovery'),
    TypeError,
  )
  await assert.rejects(
    actions.startNewTurn('conv_control01', 'Changed explicit recovery'),
    ConversationMutationBusyError,
  )
  assert.equal(client.startCalls.length, 1)
})

test('new Host epoch gives every uncertain mutation a fresh actionId', async () => {
  const attempts = { start: 0, interrupt: 0, approval: 0 }
  const client = new FakeMutationClient({
    start: (call) => {
      attempts.start += 1
      return attempts.start === 1
        ? Promise.reject(new TypeError('start response lost'))
        : Promise.resolve(startResponse(call.request.actionId))
    },
    interrupt: (call) => {
      attempts.interrupt += 1
      return attempts.interrupt === 1
        ? Promise.reject(new TypeError('interrupt response lost'))
        : Promise.resolve(interruptResponse(call.request.actionId))
    },
    approval: (call) => {
      attempts.approval += 1
      return attempts.approval === 1
        ? Promise.reject(new TypeError('approval response lost'))
        : Promise.resolve(
            approvalResponse(call.approvalId, call.request.actionId),
          )
    },
  })
  const actions = new LiveConversationActions(client, idFactory())
  actions.adoptHostEpoch(epochA)

  await assert.rejects(
    actions.startTurn('conv_control01', 'Retry after restart'),
    TypeError,
  )
  await assert.rejects(
    actions.interruptTurn('conv_control01', 'turn_control01'),
    TypeError,
  )
  await assert.rejects(
    actions.resolveApproval('approval_control01', 'accept'),
    TypeError,
  )

  actions.adoptHostEpoch(epochB)
  await actions.startTurn('conv_control01', 'Retry after restart')
  await actions.interruptTurn('conv_control01', 'turn_control01')
  await actions.resolveApproval('approval_control01', 'accept')

  assert.notEqual(
    client.startCalls[0].request.actionId,
    client.startCalls[1].request.actionId,
  )
  assert.notEqual(
    client.interruptCalls[0].request.actionId,
    client.interruptCalls[1].request.actionId,
  )
  assert.notEqual(
    client.approvalCalls[0].request.actionId,
    client.approvalCalls[1].request.actionId,
  )
})

test('epoch replacement invalidates in-flight mutation state before fresh input', async () => {
  const oldRequest = createDeferred()
  let attempts = 0
  const client = new FakeMutationClient({
    start: (call) => {
      attempts += 1
      return attempts === 1
        ? oldRequest.promise
        : Promise.resolve(startResponse(call.request.actionId))
    },
  })
  const actions = new LiveConversationActions(client, idFactory())
  actions.adoptHostEpoch(epochA)

  const stale = actions.startTurn('conv_control01', 'Same explicit intent')
  actions.adoptHostEpoch(epochB)
  await assert.rejects(stale, HostEpochChangedError)

  await actions.startTurn('conv_control01', 'Same explicit intent')
  assert.notEqual(
    client.startCalls[0].request.actionId,
    client.startCalls[1].request.actionId,
  )

  oldRequest.resolve(startResponse(client.startCalls[0].request.actionId))
  await Promise.resolve()
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
  assert.equal(message, '智能体未能发送消息。')
  assert.equal(message.includes('JSON-RPC'), false)
  assert.equal(
    mutationErrorMessage(new TypeError('network details'), '发送消息'),
    'CodeTether 暂时无法连接，请重试。',
  )
  assert.equal(
    mutationErrorMessage(
      new CodeTetherResponseError(409, {
        protocolVersion: 1,
        actionId: 'act_control_002',
        code: 'project_unavailable',
        message: 'absolute path details must stay behind the Host boundary',
      }),
      '发送消息',
    ),
    '项目工作区当前不可用；会话历史仍可查看。',
  )
  assert.equal(
    mutationErrorMessage(
      new CodeTetherResponseError(409, {
        protocolVersion: 1,
        actionId: 'act_control_003',
        code: 'project_has_conversations',
        message: 'internal relation details',
      }),
      '移除项目',
    ),
    '项目仍有关联会话，无法移除。',
  )
})

test('structured canonical failures control pre-Turn mutation copy without raw fields', () => {
  const cases = [
    [
      canonicalFailure('execution_capacity_reached'),
      'CodeTether 当前没有可用的远程运行时槽位。 请等待其他工作结束后再开始新一轮。',
    ],
    [
      canonicalFailure('conversation_busy'),
      '这个会话已经有一个活动轮次。 请等待当前轮次结束。',
    ],
    [
      canonicalFailure('login_required'),
      '执行机器上的智能体登录状态不可用。 请在执行机器上完成登录，然后再开始新一轮。',
    ],
    [
      canonicalFailure('machine_offline'),
      'CodeTether 当前无法连接到这台执行机器。 请恢复机器连接并等待状态重新验证。',
    ],
    [
      canonicalFailure('project_location_invalid'),
      '已注册的项目位置不再匹配原来的工作区。 请在项目详情中修复项目位置后再继续。',
    ],
  ]

  for (const [failure, expected] of cases) {
    const error = new CodeTetherResponseError(503, {
      protocolVersion: 1,
      actionId: 'act_control_structured',
      code: 'internal',
      message: '<script>raw-provider-message</script>',
      details: { stderr: 'Authorization: Bearer secret-token' },
      failure,
    })
    const message = mutationErrorMessage(error, '发送消息')
    assert.equal(message, expected)
    assert.equal(message.includes('script'), false)
    assert.equal(message.includes('secret-token'), false)
  }
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

function canonicalFailure(reason) {
  const profile = {
    execution_capacity_reached: {
      category: 'runtime',
      retryability: 'retry_later',
      userAction: 'reduce_active_work',
      source: 'runtime',
    },
    conversation_busy: {
      category: 'runtime',
      retryability: 'retry_later',
      userAction: 'wait',
      source: 'runtime',
    },
    login_required: {
      category: 'authentication',
      retryability: 'retry_after_user_action',
      userAction: 'login_on_machine',
      source: 'provider',
    },
    machine_offline: {
      category: 'machine',
      retryability: 'retry_after_user_action',
      userAction: 'reconnect_machine',
      source: 'machine',
    },
    project_location_invalid: {
      category: 'project',
      retryability: 'retry_after_user_action',
      userAction: 'repair_project_location',
      source: 'project',
    },
  }[reason]
  return {
    ...profile,
    reason,
    occurredAt: timestamp,
    technicalCode: reason,
  }
}
