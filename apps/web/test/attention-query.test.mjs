import assert from 'node:assert/strict'
import test from 'node:test'

import { QueryClient } from '@tanstack/react-query'

import {
  attentionListQueryOptions,
  attentionQueryKeys,
  invalidateAttentionQueries,
  shouldRefreshAttention,
} from '../.tmp/test-dist/runtime/host/attention-query.js'

const timestamp = '2026-08-27T12:00:00.000Z'
const response = {
  protocolVersion: 1,
  items: [
    {
      attentionId: 'attn_review001',
      projectId: 'proj_attention01',
      conversationId: 'conv_attention01',
      turnId: 'turn_attention01',
      type: 'completed_review',
      status: 'open',
      createdAt: timestamp,
      updatedAt: timestamp,
      payload: { conversationTitle: 'Review the completed work' },
    },
  ],
  summary: {
    totalOpen: 7,
    approvalOpen: 2,
    completedReviewOpen: 4,
    failedOpen: 1,
  },
}

test('canonical open Attention query requests status=open and limit=100 with cancellation', async () => {
  const calls = []
  const client = {
    async listAttention(options) {
      calls.push(options)
      return response
    },
  }
  const queryClient = createQueryClient()

  const result = await queryClient.fetchQuery(attentionListQueryOptions(client))

  assert.strictEqual(result, response)
  assert.deepEqual(attentionQueryKeys.open, ['host', 'attention', 'open'])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].status, 'open')
  assert.equal(calls[0].limit, 100)
  assert.ok(calls[0].signal instanceof AbortSignal)
  assert.equal(result.summary.totalOpen, 7)
  assert.equal(result.items.length, 1)
})

test('only semantic Attention events request a durable Attention refresh', () => {
  assert.equal(shouldRefreshAttention('attention.created'), true)
  assert.equal(shouldRefreshAttention('attention.resolved'), true)

  for (const type of [
    'conversation.started',
    'turn.started',
    'message.delta',
    'message.completed',
    'tool.started',
    'tool.output',
    'tool.completed',
    'file.changed',
    'approval.requested',
    'approval.resolved',
    'turn.completed',
    'turn.failed',
    'turn.interrupted',
    'stream.reset',
  ]) {
    assert.equal(shouldRefreshAttention(type), false, type)
  }
})

test('Attention invalidation is scoped to the Attention query family', async () => {
  const queryClient = createQueryClient()
  const unrelatedKey = ['host', 'projects', 'list']
  queryClient.setQueryData(attentionQueryKeys.open, response)
  queryClient.setQueryData(unrelatedKey, [])

  await invalidateAttentionQueries(queryClient)

  assert.equal(
    queryClient.getQueryState(attentionQueryKeys.open)?.isInvalidated,
    true,
  )
  assert.equal(queryClient.getQueryState(unrelatedKey)?.isInvalidated, false)
})

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
}
