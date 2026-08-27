import assert from 'node:assert/strict'
import test from 'node:test'

import { QueryClient } from '@tanstack/react-query'

import {
  invalidateConversationProductQueries,
  shouldRefreshConversationIndex,
} from '../.tmp/test-dist/runtime/host/conversation-index-sync.js'
import { conversationDetailQueryKeys } from '../.tmp/test-dist/runtime/host/conversation-detail-query.js'
import { conversationListQueryKeys } from '../.tmp/test-dist/runtime/host/conversation-list-query.js'

const conversationId = 'conv_sync01'
const projectId = 'proj_sync01'

test('refreshes index and durable detail only for semantic lifecycle events', () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const listKey = conversationListQueryKeys.project(projectId)
  const detailKey = conversationDetailQueryKeys.detail(conversationId)
  queryClient.setQueryData(listKey, [])
  queryClient.setQueryData(detailKey, { title: '新会话' })

  invalidateConversationProductQueries(queryClient, {
    conversationId,
    type: 'turn.started',
  })

  assert.equal(queryClient.getQueryState(listKey)?.isInvalidated, true)
  assert.equal(queryClient.getQueryState(detailKey)?.isInvalidated, true)
})

test('non-Conversation events never invalidate the durable index path', () => {
  for (const type of [
    'message.delta',
    'tool.output',
    'attention.created',
    'attention.resolved',
  ]) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const listKey = conversationListQueryKeys.project(projectId)
    const detailKey = conversationDetailQueryKeys.detail(conversationId)
    queryClient.setQueryData(listKey, [])
    queryClient.setQueryData(detailKey, { title: '已持久化' })

    invalidateConversationProductQueries(queryClient, {
      conversationId,
      type,
    })

    assert.equal(shouldRefreshConversationIndex(type), false)
    assert.equal(queryClient.getQueryState(listKey)?.isInvalidated, false)
    assert.equal(queryClient.getQueryState(detailKey)?.isInvalidated, false)
  }
})

test('all accepted low-frequency lifecycle events refresh the index', () => {
  for (const type of [
    'conversation.started',
    'turn.started',
    'approval.requested',
    'approval.resolved',
    'turn.completed',
    'turn.failed',
    'turn.interrupted',
  ]) {
    assert.equal(shouldRefreshConversationIndex(type), true, type)
  }
})
