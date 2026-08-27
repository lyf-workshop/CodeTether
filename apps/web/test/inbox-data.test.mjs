import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createInboxModel,
  filterAttentionItems,
  formatInboxAttentionBadge,
  getInboxFocusRecoveryTarget,
} from '../.tmp/test-dist/components/inbox/inbox-model.js'

const timestamp = '2026-08-27T12:00:00.000Z'
const approval = {
  attentionId: 'attn_approval01',
  projectId: 'proj_inbox01',
  conversationId: 'conv_inbox01',
  turnId: 'turn_inbox01',
  type: 'approval',
  status: 'open',
  createdAt: timestamp,
  updatedAt: timestamp,
  payload: {
    approvalId: 'approval_inbox01',
    kind: 'command',
    actionTitle: '运行测试',
  },
}
const failed = {
  attentionId: 'attn_failed01',
  projectId: 'proj_inbox01',
  conversationId: 'conv_inbox02',
  turnId: 'turn_inbox02',
  type: 'failed',
  status: 'open',
  createdAt: timestamp,
  updatedAt: timestamp,
  payload: {
    conversationTitle: '修复连接恢复',
    error: { code: 'provider_error', message: 'Turn 执行失败' },
  },
}
const completed = {
  attentionId: 'attn_completed01',
  projectId: 'proj_inbox02',
  conversationId: 'conv_inbox03',
  turnId: 'turn_inbox03',
  type: 'completed_review',
  status: 'open',
  createdAt: timestamp,
  updatedAt: timestamp,
  payload: { conversationTitle: '实现持久化历史' },
}

test('local Inbox filters preserve the exact Host ordering', () => {
  const hostOrder = [approval, failed, completed, approval]

  assert.strictEqual(filterAttentionItems(hostOrder, 'all'), hostOrder)
  assert.deepEqual(filterAttentionItems(hostOrder, 'approval'), [
    approval,
    approval,
  ])
  assert.deepEqual(filterAttentionItems(hostOrder, 'completed_review'), [
    completed,
  ])
  assert.deepEqual(filterAttentionItems(hostOrder, 'failed'), [failed])
  assert.deepEqual(hostOrder, [approval, failed, completed, approval])
})

test('Inbox model retains the Host summary instead of deriving it from rows', () => {
  const summary = {
    totalOpen: 127,
    approvalOpen: 3,
    completedReviewOpen: 120,
    failedOpen: 4,
  }
  const response = {
    protocolVersion: 1,
    items: [approval, failed, completed],
    summary,
  }

  const model = createInboxModel(response, 'failed')

  assert.strictEqual(model.summary, summary)
  assert.deepEqual(model.items, [failed])
  assert.equal(model.showsLimitNotice, true)
})

test('limit notice compares the global open total with the returned page', () => {
  const response = {
    protocolVersion: 1,
    items: [approval, failed, completed],
    summary: {
      totalOpen: 3,
      approvalOpen: 1,
      completedReviewOpen: 1,
      failedOpen: 1,
    },
  }

  assert.equal(createInboxModel(response, 'approval').showsLimitNotice, false)
})

test('Sidebar Attention badge hides zero and caps visual counts at 99+', () => {
  assert.equal(formatInboxAttentionBadge(0), undefined)
  assert.equal(formatInboxAttentionBadge(1), '1')
  assert.equal(formatInboxAttentionBadge(99), '99')
  assert.equal(formatInboxAttentionBadge(100), '99+')
  assert.equal(formatInboxAttentionBadge(10_000), '99+')
})

test('Sidebar Attention badge rejects invalid untrusted counts', () => {
  for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => formatInboxAttentionBadge(value), RangeError)
  }
})

test('focus recovery follows an externally removed Attention item', () => {
  const anchor = { attentionId: failed.attentionId, index: 1 }

  assert.equal(
    getInboxFocusRecoveryTarget(
      anchor,
      [approval, failed, completed],
      [approval, failed, completed],
    ),
    undefined,
  )
  assert.equal(
    getInboxFocusRecoveryTarget(
      anchor,
      [approval, completed],
      [approval, completed],
    ),
    completed.attentionId,
  )
})

test('focus recovery returns to filters when the focused item was last', () => {
  assert.equal(
    getInboxFocusRecoveryTarget(
      { attentionId: failed.attentionId, index: 0 },
      [],
      [],
    ),
    null,
  )
})
