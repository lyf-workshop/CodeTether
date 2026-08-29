import assert from 'node:assert/strict'
import test from 'node:test'

import { QueryClient } from '@tanstack/react-query'

import {
  invalidateConversationDurableQueries,
  invalidateConversationProductQueries,
  shouldRefreshConversationIndex,
} from '../.tmp/test-dist/runtime/host/conversation-index-sync.js'
import { conversationDetailQueryKeys } from '../.tmp/test-dist/runtime/host/conversation-detail-query.js'
import { conversationListQueryKeys } from '../.tmp/test-dist/runtime/host/conversation-list-query.js'
import { conversationSearchQueryKeys } from '../.tmp/test-dist/runtime/host/conversation-search-query.js'

const conversationId = 'conv_sync01'
const projectId = 'proj_sync01'

test('refreshes index and durable detail only for semantic lifecycle events', () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const listKey = conversationListQueryKeys.project(projectId)
  const searchKey = searchQueryKey()
  const detailKey = conversationDetailQueryKeys.detail(conversationId)
  queryClient.setQueryData(listKey, [])
  queryClient.setQueryData(searchKey, { pages: [], pageParams: [] })
  queryClient.setQueryData(detailKey, { title: '新会话' })

  invalidateConversationProductQueries(queryClient, {
    conversationId,
    type: 'turn.started',
  })

  assert.equal(queryClient.getQueryState(listKey)?.isInvalidated, true)
  assert.equal(queryClient.getQueryState(searchKey)?.isInvalidated, true)
  assert.equal(queryClient.getQueryState(detailKey)?.isInvalidated, true)
})

test('conversation.updated invalidates both active and archived Project indexes', () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const activeKey = conversationListQueryKeys.project(projectId, 'active')
  const archivedKey = conversationListQueryKeys.project(projectId, 'archived')
  queryClient.setQueryData(activeKey, [])
  queryClient.setQueryData(archivedKey, [])

  invalidateConversationProductQueries(queryClient, {
    conversationId,
    type: 'conversation.updated',
  })

  assert.equal(queryClient.getQueryState(activeKey)?.isInvalidated, true)
  assert.equal(queryClient.getQueryState(archivedKey)?.isInvalidated, true)
})

test('Snapshot recovery invalidates list and full-history Search without a semantic event', () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const listKey = conversationListQueryKeys.project(projectId)
  const searchKey = searchQueryKey()
  queryClient.setQueryData(listKey, [])
  queryClient.setQueryData(searchKey, { pages: [], pageParams: [] })

  invalidateConversationDurableQueries(queryClient)

  assert.equal(queryClient.getQueryState(listKey)?.isInvalidated, true)
  assert.equal(queryClient.getQueryState(searchKey)?.isInvalidated, true)
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
    const searchKey = searchQueryKey()
    const detailKey = conversationDetailQueryKeys.detail(conversationId)
    queryClient.setQueryData(listKey, [])
    queryClient.setQueryData(searchKey, { pages: [], pageParams: [] })
    queryClient.setQueryData(detailKey, { title: '已持久化' })

    invalidateConversationProductQueries(queryClient, {
      conversationId,
      type,
    })

    assert.equal(shouldRefreshConversationIndex(type), false)
    assert.equal(queryClient.getQueryState(listKey)?.isInvalidated, false)
    assert.equal(queryClient.getQueryState(searchKey)?.isInvalidated, false)
    assert.equal(queryClient.getQueryState(detailKey)?.isInvalidated, false)
  }
})

function searchQueryKey() {
  return conversationSearchQueryKeys.project(projectId, {
    query: 'reconnect',
    archive: 'active',
    provider: null,
    status: null,
    limit: 25,
  })
}

test('all accepted low-frequency lifecycle events refresh the index', () => {
  for (const type of [
    'conversation.started',
    'conversation.updated',
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
