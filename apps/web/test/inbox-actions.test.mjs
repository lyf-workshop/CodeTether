import assert from 'node:assert/strict'
import test from 'node:test'

import {
  acknowledgeFailedAttention,
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

  await reviewCompletedAttention(client, item, (conversationId) => {
    calls.push(['navigate', conversationId])
  })

  assert.deepEqual(calls, [
    ['attention', 'attn_completed01'],
    ['navigate', 'conv_inbox02'],
  ])
})

test('completed review failure keeps navigation closed', async () => {
  const calls = []
  const client = actionClient(calls, new Error('Host unavailable'))

  await assert.rejects(
    reviewCompletedAttention(client, completedItem(), (conversationId) => {
      calls.push(['navigate', conversationId])
    }),
    /Host unavailable/,
  )
  assert.deepEqual(calls, [['attention', 'attn_completed01']])
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

  await acknowledgeFailedAttention(client, item)

  assert.deepEqual(calls, [['attention', 'attn_failed01']])
  assert.equal(item.status, 'open')
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
