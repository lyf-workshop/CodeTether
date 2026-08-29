import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createNotificationIntent,
  defaultDesktopNotificationPreferences,
  isAttentionNotificationEnabled,
  notificationSurfaceFromPathname,
  shouldSuppressAttentionNotification,
  truncateNotificationLabel,
} from '../.tmp/test-dist/runtime/notifications/desktop-notification-model.js'

const timestamp = '2026-08-28T12:00:00.000Z'
const projectId = 'proj_notification01'
const conversationId = 'conv_notification01'
const turnId = 'turn_notification01'

test('maps only durable Attention type and safe product metadata to notification copy', () => {
  const metadata = {
    projectName: '中文项目',
    conversationTitle: '修复 Windows 登录后的自动重连问题 🚀',
  }

  const approval = createNotificationIntent(
    attention('approval', {
      approvalId: 'approval_notification01',
      kind: 'command',
      actionTitle: '执行命令',
      actionSubtitle: 'git status --short --secret-wrapper',
    }),
    metadata,
  )
  assert.deepEqual(approval, {
    attentionId: 'attn_notification_approval01',
    type: 'approval',
    projectId,
    conversationId,
    turnId,
    title: 'CodeTether · 需要批准',
    body: '中文项目 · 修复 Windows 登录后的自动重连问题 🚀\nCodex 正在等待你的确认',
  })
  assert.doesNotMatch(approval.body, /secret-wrapper/u)

  const completed = createNotificationIntent(
    attention('completed_review', {
      conversationTitle: 'Host-owned title',
    }),
    metadata,
  )
  assert.equal(completed.title, 'CodeTether · 工作已完成')
  assert.match(completed.body, /Codex 已完成本轮工作$/u)

  const failed = createNotificationIntent(
    attention('failed', {
      conversationTitle: 'Host-owned title',
      error: {
        code: 'provider_failed',
        message: 'private provider JSON-RPC diagnostics',
      },
    }),
    metadata,
  )
  assert.equal(failed.title, 'CodeTether · 执行失败')
  assert.match(failed.body, /需要你查看执行结果$/u)
  assert.doesNotMatch(failed.body, /provider|JSON-RPC/u)
})

test('clamps long labels by grapheme without splitting Unicode emoji', () => {
  const family = '👨‍👩‍👧‍👦'
  assert.equal(
    truncateNotificationLabel(family.repeat(5), 4),
    `${family.repeat(3)}…`,
  )

  const intent = createNotificationIntent(
    attention('completed_review', { conversationTitle: 'ignored' }),
    {
      projectName: family.repeat(100),
      conversationTitle: `修复${family}`.repeat(100),
    },
  )
  const [contextLine] = intent.body.split('\n')
  assert.ok(contextLine.includes('… · '))
  assert.ok(contextLine.endsWith('…'))
  assert.equal(contextLine.includes('\uFFFD'), false)
  assert.ok(Array.from(intent.body).length <= 256)
})

test('suppresses only a directly presented Attention in a real foreground window', () => {
  const item = attention('approval', {
    approvalId: 'approval_notification01',
    kind: 'command',
    actionTitle: '执行命令',
  })
  const foreground = { focused: true, minimized: false, visible: true }

  assert.equal(
    shouldSuppressAttentionNotification(item, {
      surface: { kind: 'conversation', conversationId },
      window: foreground,
    }),
    true,
  )
  assert.equal(
    shouldSuppressAttentionNotification(item, {
      surface: {
        kind: 'conversation',
        conversationId: 'conv_notification_other01',
      },
      window: foreground,
    }),
    false,
  )
  assert.equal(
    shouldSuppressAttentionNotification(item, {
      surface: { kind: 'inbox' },
      window: foreground,
    }),
    true,
  )
  for (const window of [
    { focused: false, minimized: false, visible: true },
    { focused: false, minimized: true, visible: true },
    { focused: false, minimized: false, visible: false },
  ]) {
    assert.equal(
      shouldSuppressAttentionNotification(item, {
        surface: { kind: 'conversation', conversationId },
        window,
      }),
      false,
    )
  }
})

test('classifies only Inbox and exact Conversation routes as direct surfaces', () => {
  assert.deepEqual(notificationSurfaceFromPathname('/inbox'), {
    kind: 'inbox',
  })
  assert.deepEqual(
    notificationSurfaceFromPathname(
      '/conversations/conv_notification%F0%9F%9A%80',
    ),
    {
      kind: 'conversation',
      conversationId: 'conv_notification🚀',
    },
  )
  assert.deepEqual(notificationSurfaceFromPathname('/projects/proj_other'), {
    kind: 'other',
  })
})

test('all notification preferences default on and remain type-specific', () => {
  assert.equal(
    isAttentionNotificationEnabled(
      'approval',
      defaultDesktopNotificationPreferences,
    ),
    true,
  )
  assert.equal(
    isAttentionNotificationEnabled('completed_review', {
      ...defaultDesktopNotificationPreferences,
      completed_review: false,
    }),
    false,
  )
  assert.equal(
    isAttentionNotificationEnabled('failed', {
      ...defaultDesktopNotificationPreferences,
      failed: false,
    }),
    false,
  )
})

function attention(type, payload) {
  return {
    attentionId: `attn_notification_${type === 'completed_review' ? 'completed01' : `${type}01`}`,
    projectId,
    conversationId,
    turnId,
    type,
    status: 'open',
    createdAt: timestamp,
    updatedAt: timestamp,
    payload,
  }
}
