import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  activeWorkspaceConversations,
  hasMoreWorkspaceConversations,
  visibleWorkspaceConversations,
  workspaceConversationStatusLabel,
  workspaceProviderPresentation,
  workspaceSidebarRecentConversationLimit,
} from '../.tmp/test-dist/components/app-shell/workspace-sidebar-model.js'

const timestamp = '2026-09-15T12:00:00.000Z'

test('Workspace Sidebar limits recent active Conversations and expands Host order', () => {
  const conversations = [
    ...Array.from({ length: 6 }, (_, index) =>
      conversation(`conv_workspace_${String(index + 1)}`),
    ),
    conversation('conv_workspace_archived', { archived: true }),
  ]

  assert.equal(workspaceSidebarRecentConversationLimit, 4)
  assert.equal(activeWorkspaceConversations(conversations).length, 6)
  assert.deepEqual(
    visibleWorkspaceConversations(conversations, false).map(
      (entry) => entry.conversationId,
    ),
    conversations.slice(0, 4).map((entry) => entry.conversationId),
  )
  assert.equal(visibleWorkspaceConversations(conversations, true).length, 6)
  assert.equal(hasMoreWorkspaceConversations(conversations), true)
})

test('Provider identity depends only on the immutable Conversation provider', () => {
  assert.deepEqual(workspaceProviderPresentation('codex'), {
    icon: 'bot',
    label: 'Codex',
    tone: 'codex',
  })
  assert.deepEqual(workspaceProviderPresentation('claude-code'), {
    icon: 'sparkles',
    label: 'Claude Code',
    tone: 'claude',
  })

  // Current Machine and installation availability are deliberately absent.
  const offlineHistoricalCodex = workspaceProviderPresentation('codex')
  const unavailableHistoricalClaude =
    workspaceProviderPresentation('claude-code')
  assert.equal(offlineHistoricalCodex.label, 'Codex')
  assert.equal(unavailableHistoricalClaude.label, 'Claude Code')
})

test('Workspace status decoration is limited to actionable activity', () => {
  assert.equal(workspaceConversationStatusLabel('running'), '运行中')
  assert.equal(workspaceConversationStatusLabel('waiting'), '需要处理')
  assert.equal(workspaceConversationStatusLabel('failed'), '运行失败')
  assert.equal(workspaceConversationStatusLabel('idle'), undefined)
  assert.equal(workspaceConversationStatusLabel('completed'), undefined)
})

test('Workspace Sidebar owns project navigation, scoped creation, and one lazy Conversation query', async () => {
  const source = await readFile(
    new URL(
      '../src/components/app-shell/workspace-sidebar.tsx',
      import.meta.url,
    ),
    'utf8',
  )
  const detail = await readFile(
    new URL(
      '../src/components/conversation/conversation-detail-page.tsx',
      import.meta.url,
    ),
    'utf8',
  )

  assert.match(source, /to="\/projects\/\$projectId"/u)
  assert.match(source, /to="\/conversations\/\$conversationId"/u)
  assert.match(source, /aria-expanded=\{expanded\}/u)
  assert.match(source, /onNewConversation\(project, event\.currentTarget\)/u)
  assert.match(source, /onNewConversation\(undefined, event\.currentTarget\)/u)
  assert.match(source, /enabled: expanded && connectionState === 'connected'/u)
  assert.match(source, /expandedProjectId/u)
  assert.doesNotMatch(source, /useQueries|provider\.availability/u)
  assert.match(source, /data-selected=\{selected \|\| undefined\}/u)
  assert.match(source, /查看已归档会话/u)
  assert.match(source, /展开显示/u)
  assert.doesNotMatch(detail, /ConversationRail|layout-conversation-rail/u)
})

function conversation(id, options = {}) {
  return {
    conversationId: id,
    projectId: 'proj_workspace',
    machineId: 'machine_workspace',
    title: id,
    titleSource: 'generated',
    provider: 'codex',
    status: 'completed',
    createdAt: timestamp,
    updatedAt: timestamp,
    lastActivityAt: timestamp,
    ...(options.archived ? { archivedAt: timestamp } : {}),
  }
}
