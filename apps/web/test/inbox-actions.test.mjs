import assert from 'node:assert/strict'
import test from 'node:test'

import {
  acknowledgeInboxAttention,
  bulkAcknowledgeInboxAttention,
  resolveInboxApproval,
  reviewCompletedAttention,
} from '../.tmp/test-dist/components/inbox/inbox-actions.js'

const timestamp = '2026-08-27T12:00:00.000Z'

test('Approval actions resolve the exact approvalId and never generic Attention', async () => {
  const calls = []
  const client = actionClient(calls)
  const item = {
    attentionId: 'attn_approval01',
    projectId: 'proj_inbox01',
    conversationId: 'conv_inbox01',
    turnId: 'turn_inbox01',
    type: 'approval',
    status: 'open',
    createdAt: timestamp,
    updatedAt: timestamp,
    payload: {
      approvalId: 'approval_exact01',
      kind: 'command',
      actionTitle: 'Git 状态',
    },
  }

  await resolveInboxApproval(client, item, 'accept')
  await resolveInboxApproval(client, item, 'decline')

  assert.deepEqual(calls, [
    ['approval', 'approval_exact01', 'accept'],
    ['approval', 'approval_exact01', 'decline'],
  ])
})

test('completed review resolves durably before real Conversation navigation', async () => {
  const calls = []
  const client = actionClient(calls)
  const item = completedItem()

  await reviewCompletedAttention(client, item, (conversationId, turnId) => {
    calls.push(['navigate', conversationId, turnId])
  })

  assert.deepEqual(calls, [
    ['attention', 'attn_completed01'],
    ['navigate', 'conv_inbox02', 'turn_inbox02'],
  ])
})

test('completed review failure preserves result navigation and reports unresolved state', async () => {
  const calls = []
  const client = actionClient(calls, new Error('Host unavailable'))

  await reviewCompletedAttention(
    client,
    completedItem(),
    (conversationId, turnId, reviewFailed) => {
      calls.push(['navigate', conversationId, turnId, reviewFailed])
    },
  )
  assert.deepEqual(calls, [
    ['attention', 'attn_completed01'],
    ['navigate', 'conv_inbox02', 'turn_inbox02', true],
  ])
})

test('failed acknowledgement resolves only Attention identity', async () => {
  const calls = []
  const client = actionClient(calls)
  const item = {
    attentionId: 'attn_failed01',
    projectId: 'proj_inbox01',
    conversationId: 'conv_inbox03',
    turnId: 'turn_failed01',
    type: 'failed',
    status: 'open',
    createdAt: timestamp,
    updatedAt: timestamp,
    payload: {
      conversationTitle: '失败的 Turn',
      error: { code: 'provider_error', message: 'Codex 未能完成本轮工作。' },
    },
  }

  await acknowledgeInboxAttention(client, item)

  assert.deepEqual(calls, [['attention', 'attn_failed01']])
  assert.equal(item.status, 'open')
})

test('bulk acknowledgement clears only review and failure items in the current tab', async () => {
  const review = completedItem()
  const failure = {
    ...review,
    attentionId: 'attn_failed_bulk01',
    type: 'failed',
    payload: {
      conversationTitle: 'Failed work',
      error: { code: 'provider_error', message: 'AI tool failed' },
    },
  }
  const approval = {
    ...review,
    attentionId: 'attn_approval_bulk01',
    type: 'approval',
  }
  const remaining = [failure, review, approval]
  const calls = []
  const client = {
    async listAttention({ type }) {
      return { items: remaining.filter((item) => item.type === type) }
    },
    async resolveAttention(attentionId) {
      calls.push(attentionId)
      const index = remaining.findIndex(
        (item) => item.attentionId === attentionId,
      )
      remaining.splice(index, 1)
    },
  }
  const summary = {
    totalOpen: 3,
    approvalOpen: 1,
    completedReviewOpen: 1,
    failedOpen: 1,
  }

  const failedTab = await bulkAcknowledgeInboxAttention(
    client,
    'failed',
    summary,
    () => {},
  )
  assert.deepEqual(calls, ['attn_failed_bulk01'])
  assert.deepEqual(failedTab, {
    attempted: 1,
    total: 1,
    cleared: 1,
    failed: 0,
  })

  const allTab = await bulkAcknowledgeInboxAttention(
    client,
    'all',
    { ...summary, failedOpen: 0 },
    () => {},
  )
  assert.deepEqual(calls, ['attn_failed_bulk01', review.attentionId])
  assert.deepEqual(remaining, [approval])
  assert.equal(allTab.cleared, 1)
})

test('bulk acknowledgement reports partial failure and leaves failed items open', async () => {
  const first = completedItem()
  const second = { ...first, attentionId: 'attn_completed02' }
  const open = [first, second]
  const calls = []
  const progress = []
  const client = {
    async listAttention({ type }) {
      return { items: open.filter((item) => item.type === type) }
    },
    async resolveAttention(attentionId) {
      calls.push(attentionId)
      if (attentionId === second.attentionId)
        throw new Error('Host rejected it')
      open.splice(
        open.findIndex((item) => item.attentionId === attentionId),
        1,
      )
    },
  }
  const result = await bulkAcknowledgeInboxAttention(
    client,
    'completed_review',
    { totalOpen: 2, approvalOpen: 0, completedReviewOpen: 2, failedOpen: 0 },
    (value) => progress.push(value),
  )
  assert.deepEqual(calls, [first.attentionId, second.attentionId])
  assert.deepEqual(open, [second])
  assert.deepEqual(result, {
    attempted: 2,
    total: 2,
    cleared: 1,
    failed: 1,
  })
  assert.deepEqual(progress.at(-1), { attempted: 2, total: 2 })
})

function completedItem() {
  return {
    attentionId: 'attn_completed01',
    projectId: 'proj_inbox01',
    conversationId: 'conv_inbox02',
    turnId: 'turn_inbox02',
    type: 'completed_review',
    status: 'open',
    createdAt: timestamp,
    updatedAt: timestamp,
    payload: { conversationTitle: '完成的工作' },
  }
}

function actionClient(calls, attentionError) {
  return {
    async resolveApproval(approvalId, decision) {
      calls.push(['approval', approvalId, decision])
    },
    async resolveAttention(attentionId) {
      calls.push(['attention', attentionId])
      if (attentionError !== undefined) throw attentionError
    },
  }
}
