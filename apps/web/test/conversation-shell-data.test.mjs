import assert from 'node:assert/strict'
import test from 'node:test'

import { QueryClient } from '@tanstack/react-query'
import {
  CodeTetherProtocolError,
  CodeTetherResponseError,
} from '@codetether/client'

import {
  conversationDetailQueryKeys,
  conversationDetailQueryOptions,
} from '../.tmp/test-dist/runtime/host/conversation-detail-query.js'
import {
  ConversationCreationBusyError,
  NewConversationActions,
  newConversationErrorMessage,
} from '../.tmp/test-dist/runtime/host/new-conversation-actions.js'
import { HostRuntime } from '../.tmp/test-dist/runtime/host/host-runtime.js'

const projectId = 'proj_shell01'
const conversationId = 'conv_shell01'
const machineId = 'machine_local01'

test('durable Conversation detail query isolates identity and forwards cancellation', async () => {
  const calls = []
  const client = {
    async getConversation(id, options) {
      calls.push({ id, options })
      return detail(id)
    },
  }
  const queryClient = createQueryClient()

  assert.deepEqual(
    await queryClient.fetchQuery(
      conversationDetailQueryOptions(client, conversationId),
    ),
    detail(conversationId),
  )
  assert.equal(calls[0].id, conversationId)
  assert.ok(calls[0].options.signal instanceof AbortSignal)
  assert.deepEqual(conversationDetailQueryKeys.detail(conversationId), [
    'host',
    'conversation-detail',
    conversationId,
  ])
})

test('new Conversation request remains Project and Machine scoped', async () => {
  const calls = []
  const actions = new NewConversationActions(
    {
      async createConversation(request) {
        calls.push(request)
        return createResponse(
          request.actionId,
          request.projectId,
          machineId,
          request.provider,
        )
      },
    },
    idFactory(),
  )

  const options = { machineId, provider: 'codex' }
  const first = await actions.createConversation(projectId, options)
  const second = await actions.createConversation(projectId, options)

  assert.equal(first.data.conversation.conversationId, conversationId)
  assert.deepEqual(calls, [
    {
      actionId: 'act_conversation_001',
      machineId,
      provider: 'codex',
      projectId,
    },
    {
      actionId: 'act_conversation_002',
      machineId,
      provider: 'codex',
      projectId,
    },
  ])
  assert.equal('model' in calls[0], false)
  assert.equal('reasoning' in calls[0], false)
  assert.notEqual(calls[0].actionId, calls[1].actionId)
  assert.equal(second.data.conversation.projectId, projectId)
})

test('new Conversation request carries the selected durable Provider and model', async () => {
  const calls = []
  const actions = new NewConversationActions(
    {
      async createConversation(request) {
        calls.push(request)
        return createResponse(
          request.actionId,
          request.projectId,
          machineId,
          request.provider,
        )
      },
    },
    idFactory(),
  )

  await actions.createConversation(projectId, {
    machineId,
    provider: 'claude-code',
    model: 'claude-sonnet-real',
    reasoning: 'low',
  })

  assert.deepEqual(calls, [
    {
      actionId: 'act_conversation_001',
      machineId,
      provider: 'claude-code',
      projectId,
      model: 'claude-sonnet-real',
      reasoning: 'low',
    },
  ])
})

test('HostRuntime exposes thin durable index and Search reads and owns create identity', async () => {
  const calls = { create: [], detail: [], list: [], search: [] }
  const client = {
    async listProjectConversations(id, options) {
      calls.list.push({ id, options })
      return {
        protocolVersion: 1,
        conversations: [detail(conversationId).conversation],
      }
    },
    async getConversation(id, options) {
      calls.detail.push({ id, options })
      return detail(id)
    },
    async searchProjectConversations(id, options) {
      calls.search.push({ id, options })
      return {
        protocolVersion: 1,
        results: [],
        hasMore: false,
      }
    },
    async createConversation(request) {
      calls.create.push(request)
      return createResponse(request.actionId, request.projectId)
    },
  }
  const runtime = new HostRuntime({
    queryClient: createQueryClient(),
    client,
  })

  await runtime.listProjectConversations(projectId, {
    limit: 25,
    provider: 'codex',
    status: 'idle',
  })
  await runtime.getConversation(conversationId)
  await runtime.searchProjectConversations(projectId, {
    query: 'reconnect',
    archive: 'all',
    limit: 25,
  })
  await runtime.createConversation(projectId, {
    machineId,
    provider: 'codex',
  })

  assert.deepEqual(calls.list, [
    {
      id: projectId,
      options: { limit: 25, provider: 'codex', status: 'idle' },
    },
  ])
  assert.equal(calls.detail[0].id, conversationId)
  assert.deepEqual(calls.search, [
    {
      id: projectId,
      options: { query: 'reconnect', archive: 'all', limit: 25 },
    },
  ])
  assert.deepEqual(calls.create[0], {
    actionId: calls.create[0].actionId,
    machineId,
    provider: 'codex',
    projectId,
  })
  assert.match(calls.create[0].actionId, /^act_[A-Za-z0-9_-]{6,95}$/u)
})

test('double submit shares one request while a conflicting Project fails explicitly', async () => {
  const deferred = createDeferred()
  const calls = []
  const actions = new NewConversationActions(
    {
      createConversation(request) {
        calls.push(request)
        return calls.length === 1
          ? deferred.promise
          : Promise.resolve(createResponse(request.actionId, request.projectId))
      },
    },
    idFactory(),
  )

  const options = { machineId, provider: 'codex' }
  const first = actions.createConversation(projectId, options)
  const duplicate = actions.createConversation(projectId, options)
  assert.strictEqual(duplicate, first)
  await assert.rejects(
    actions.createConversation('proj_second01', options),
    ConversationCreationBusyError,
  )
  await assert.rejects(
    actions.createConversation(projectId, {
      machineId,
      provider: 'claude-code',
    }),
    ConversationCreationBusyError,
  )
  assert.equal(calls.length, 1)

  deferred.resolve(createResponse(calls[0].actionId, projectId))
  await first
  await actions.createConversation('proj_second01', options)
  assert.equal(calls.length, 2)
  assert.notEqual(calls[0].actionId, calls[1].actionId)
})

test('created Conversation identity must remain bound to the requested Project', async () => {
  const actions = new NewConversationActions(
    {
      async createConversation(request) {
        return createResponse(request.actionId, 'proj_other01')
      },
    },
    idFactory(),
  )

  await assert.rejects(
    actions.createConversation(projectId, { machineId, provider: 'codex' }),
    CodeTetherProtocolError,
  )
})

test('created Conversation identity must remain bound to the requested Machine', async () => {
  const actions = new NewConversationActions(
    {
      async createConversation(request) {
        return createResponse(request.actionId, projectId, 'machine_other01')
      },
    },
    idFactory(),
  )

  await assert.rejects(
    actions.createConversation(projectId, { machineId, provider: 'codex' }),
    CodeTetherProtocolError,
  )
})

test('created Conversation identity must remain bound to the requested Provider', async () => {
  const actions = new NewConversationActions(
    {
      async createConversation(request) {
        return createResponse(request.actionId, projectId, machineId, 'codex')
      },
    },
    idFactory(),
  )

  await assert.rejects(
    actions.createConversation(projectId, {
      machineId,
      provider: 'claude-code',
    }),
    CodeTetherProtocolError,
  )
})

test('new Conversation errors use safe product copy', () => {
  const unavailable = responseError(
    'project_unavailable',
    'C:\\private\\workspace provider diagnostics',
  )
  const runtime = responseError(
    'runtime_unavailable',
    'Codex child stderr and environment',
  )

  assert.equal(
    newConversationErrorMessage(unavailable),
    '项目目录当前不可用，暂时不能创建会话。',
  )
  assert.equal(newConversationErrorMessage(runtime), 'Codex 当前不可用。')
  assert.equal(
    newConversationErrorMessage(runtime, 'claude-code'),
    'Claude Code 当前不可用。',
  )
  assert.equal(
    newConversationErrorMessage(unavailable).includes('private'),
    false,
  )
  assert.equal(newConversationErrorMessage(runtime).includes('stderr'), false)
})

test('new Conversation errors prefer canonical failure recovery copy', () => {
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
      '执行机器上的 Claude Code 登录状态不可用。 请在执行机器上完成登录，然后再开始新一轮。',
    ],
    [
      canonicalFailure('machine_offline'),
      'CodeTether 当前无法连接到这台执行机器。 请恢复机器连接并等待状态重新验证。',
    ],
    [
      canonicalFailure('project_location_missing'),
      '这台机器上没有可用于本会话的已注册项目位置。 请在项目详情中注册或修复对应机器上的项目位置。',
    ],
  ]

  for (const [failure, expected] of cases) {
    const error = new CodeTetherResponseError(503, {
      protocolVersion: 1,
      actionId: 'act_conversation_structured',
      code: 'internal',
      message: '<b>raw provider login instructions</b>',
      details: { stderr: 'Bearer owner-secret' },
      failure,
    })
    const message = newConversationErrorMessage(error, 'claude-code')
    assert.equal(message, expected)
    assert.equal(message.includes('<b>'), false)
    assert.equal(message.includes('owner-secret'), false)
  }
})

function createResponse(
  actionId,
  responseProjectId,
  responseMachineId = machineId,
  responseProvider = 'codex',
) {
  const timestamp = '2026-08-27T12:00:00.000Z'
  return {
    protocolVersion: 1,
    actionId,
    status: 'completed',
    data: {
      conversation: {
        conversationId,
        projectId: responseProjectId,
        machineId: responseMachineId,
        title: '新会话',
        provider: responseProvider,
        cwd: 'C:\\workspace',
        status: 'idle',
        createdAt: timestamp,
        updatedAt: timestamp,
        lastActivityAt: timestamp,
      },
    },
  }
}

function detail(id) {
  const timestamp = '2026-08-27T12:00:00.000Z'
  return {
    protocolVersion: 1,
    conversation: {
      conversationId: id,
      projectId,
      machineId,
      title: '真实会话',
      provider: 'codex',
      status: 'idle',
      createdAt: timestamp,
      updatedAt: timestamp,
      lastActivityAt: timestamp,
    },
    runtime: {
      conversationId: id,
      terminalTail: '',
      terminalTruncated: false,
      turns: [],
    },
    history: {
      hasOlderHistory: false,
      retainedTurnCount: 0,
      totalTurnCount: 0,
    },
    pendingApprovals: [],
    approvalHistory: [],
  }
}

function responseError(code, message) {
  return new CodeTetherResponseError(503, {
    protocolVersion: 1,
    actionId: 'act_conversation_error',
    code,
    message,
  })
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
}

function idFactory() {
  let index = 0
  return () => `act_conversation_${String(++index).padStart(3, '0')}`
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
    project_location_missing: {
      category: 'project',
      retryability: 'retry_after_user_action',
      userAction: 'repair_project_location',
      source: 'project',
    },
  }[reason]
  return {
    ...profile,
    reason,
    occurredAt: '2026-09-02T20:00:00.000Z',
    technicalCode: reason,
  }
}
