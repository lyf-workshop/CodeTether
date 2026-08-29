import assert from 'node:assert/strict'
import test from 'node:test'

import { QueryClient } from '@tanstack/react-query'
import { CodeTetherResponseError } from '@codetether/client'

import {
  ConversationOrganizationActions,
  ConversationOrganizationMutationBusyError,
  conversationOrganizationErrorMessage,
} from '../.tmp/test-dist/runtime/host/conversation-organization-actions.js'
import { conversationDetailQueryKeys } from '../.tmp/test-dist/runtime/host/conversation-detail-query.js'
import { conversationListQueryKeys } from '../.tmp/test-dist/runtime/host/conversation-list-query.js'
import { HostRuntime } from '../.tmp/test-dist/runtime/host/host-runtime.js'

const projectId = 'proj_organization_ui'
const conversationId = 'conv_organization_ui'
const timestamp = '2026-08-28T12:00:00.000Z'

test('duplicate Rename submit shares one action while a different title is rejected', async () => {
  const deferred = createDeferred()
  const client = new FakeOrganizationClient()
  client.renameResult = () => deferred.promise
  const actions = new ConversationOrganizationActions(
    client,
    createQueryClient(),
    idFactory(),
  )

  const first = actions.renameConversation(conversationId, '登录模块重构')
  const duplicate = actions.renameConversation(conversationId, '登录模块重构')

  assert.strictEqual(duplicate, first)
  await assert.rejects(
    actions.renameConversation(conversationId, '另一个标题'),
    ConversationOrganizationMutationBusyError,
  )
  assert.equal(client.calls.length, 1)
  assert.deepEqual(client.calls[0], {
    operation: 'rename',
    conversationId,
    request: {
      actionId: 'act_organization_001',
      title: '登录模块重构',
    },
  })

  deferred.resolve(
    response(
      client.calls[0].request.actionId,
      summary({ title: '登录模块重构' }),
    ),
  )
  await first

  await actions.renameConversation(conversationId, '会话标题二')
  assert.equal(client.calls.length, 2)
  assert.notEqual(
    client.calls[0].request.actionId,
    client.calls[1].request.actionId,
  )
})

test('accepted mutation updates durable detail and invalidates active and archived indexes', async () => {
  const queryClient = createQueryClient()
  const activeKey = conversationListQueryKeys.project(projectId, 'active')
  const archivedKey = conversationListQueryKeys.project(projectId, 'archived')
  const detailKey = conversationDetailQueryKeys.detail(conversationId)
  queryClient.setQueryData(activeKey, [summary()])
  queryClient.setQueryData(archivedKey, [])
  queryClient.setQueryData(detailKey, detail(summary()))

  const client = new FakeOrganizationClient()
  const actions = new ConversationOrganizationActions(
    client,
    queryClient,
    idFactory(),
  )
  const accepted = await actions.archiveConversation(conversationId)

  assert.equal(accepted.data.conversation.archivedAt, timestamp)
  assert.equal(
    queryClient.getQueryData(detailKey).conversation.archivedAt,
    timestamp,
  )
  assert.equal(queryClient.getQueryState(activeKey)?.isInvalidated, true)
  assert.equal(queryClient.getQueryState(archivedKey)?.isInvalidated, true)

  // Membership and ordering are not optimistically rewritten by React.
  assert.equal(queryClient.getQueryData(activeKey).length, 1)
  assert.deepEqual(queryClient.getQueryData(archivedKey), [])
})

test('Pin, Unpin, Archive, and Unarchive call only their precise typed mutation', async () => {
  const client = new FakeOrganizationClient()
  const actions = new ConversationOrganizationActions(
    client,
    createQueryClient(),
    idFactory(),
  )

  await actions.pinConversation(conversationId)
  await actions.unpinConversation(conversationId)
  await actions.archiveConversation(conversationId)
  await actions.unarchiveConversation(conversationId)

  assert.deepEqual(
    client.calls.map((call) => call.operation),
    ['pin', 'unpin', 'archive', 'unarchive'],
  )
  assert.deepEqual(
    client.calls.map((call) => call.request.actionId),
    [
      'act_organization_001',
      'act_organization_002',
      'act_organization_003',
      'act_organization_004',
    ],
  )
  assert.equal(
    client.calls.every((call) => call.conversationId === conversationId),
    true,
  )
})

test('HostRuntime exposes the typed organization responses unchanged', async () => {
  const client = new FakeOrganizationClient()
  const runtime = new HostRuntime({
    client,
    queryClient: createQueryClient(),
  })

  const renamed = await runtime.renameConversation(
    conversationId,
    'Runtime durable title',
  )
  const archived = await runtime.archiveConversation(conversationId)

  assert.equal(renamed.data.conversation.title, 'Runtime durable title')
  assert.equal(archived.data.conversation.archivedAt, timestamp)
  assert.match(client.calls[0].request.actionId, /^act_[A-Za-z0-9_-]{6,95}$/u)
  assert.match(client.calls[1].request.actionId, /^act_[A-Za-z0-9_-]{6,95}$/u)
})

test('organization errors expose stable product copy without Host diagnostics', () => {
  const error = new CodeTetherResponseError(409, {
    protocolVersion: 1,
    actionId: 'act_organization_error',
    code: 'conflict',
    message: 'private providerThreadId and C:\\secret diagnostics',
  })
  const message = conversationOrganizationErrorMessage(error, 'archive')

  assert.equal(message, '会话状态已变化；运行中或等待确认的会话暂时不能归档。')
  assert.doesNotMatch(message, /private|providerThreadId|secret/u)
})

class FakeOrganizationClient {
  calls = []
  renameResult

  renameConversation(id, request) {
    this.calls.push({ operation: 'rename', conversationId: id, request })
    return (
      this.renameResult?.(id, request) ??
      Promise.resolve(
        response(request.actionId, summary({ title: request.title })),
      )
    )
  }

  pinConversation(id, request) {
    this.calls.push({ operation: 'pin', conversationId: id, request })
    return Promise.resolve(
      response(request.actionId, summary({ pinnedAt: timestamp })),
    )
  }

  unpinConversation(id, request) {
    this.calls.push({ operation: 'unpin', conversationId: id, request })
    return Promise.resolve(response(request.actionId, summary()))
  }

  archiveConversation(id, request) {
    this.calls.push({ operation: 'archive', conversationId: id, request })
    return Promise.resolve(
      response(request.actionId, summary({ archivedAt: timestamp })),
    )
  }

  unarchiveConversation(id, request) {
    this.calls.push({ operation: 'unarchive', conversationId: id, request })
    return Promise.resolve(response(request.actionId, summary()))
  }
}

function summary(overrides = {}) {
  return {
    conversationId,
    projectId,
    title: '新会话',
    titleSource: 'generated',
    provider: 'codex',
    model: 'gpt-5.6-sol',
    reasoning: 'medium',
    status: 'completed',
    createdAt: timestamp,
    updatedAt: timestamp,
    lastActivityAt: timestamp,
    ...overrides,
  }
}

function detail(conversation) {
  return {
    protocolVersion: 1,
    conversation,
    runtime: {
      conversationId,
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

function response(actionId, conversation) {
  return {
    protocolVersion: 1,
    actionId,
    status: 'completed',
    data: { conversation },
  }
}

function idFactory() {
  let index = 0
  return () => `act_organization_${String(++index).padStart(3, '0')}`
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
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
