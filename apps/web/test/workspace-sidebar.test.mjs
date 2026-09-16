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
import {
  clampWorkspaceSidebarWidth,
  parseWorkspaceSidebarWidth,
  readWorkspaceSidebarCollapsed,
  readWorkspaceSidebarWidth,
  workspaceSidebarCollapsedPreferenceKey,
  workspaceSidebarWidthBounds,
  workspaceSidebarWidthPreferenceKey,
  writeWorkspaceSidebarCollapsed,
  writeWorkspaceSidebarWidth,
} from '../.tmp/test-dist/components/app-shell/workspace-sidebar-layout.js'

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

test('Workspace Sidebar width preferences clamp invalid and incompatible values', () => {
  assert.equal(parseWorkspaceSidebarWidth(null), 280)
  assert.equal(parseWorkspaceSidebarWidth(''), 280)
  assert.equal(parseWorkspaceSidebarWidth('NaN'), 280)
  assert.equal(parseWorkspaceSidebarWidth('-20'), 220)
  assert.equal(parseWorkspaceSidebarWidth('219'), 220)
  assert.equal(parseWorkspaceSidebarWidth('281.6'), 282)
  assert.equal(parseWorkspaceSidebarWidth('9999'), 420)
  assert.equal(clampWorkspaceSidebarWidth(Number.POSITIVE_INFINITY), 280)
  assert.deepEqual(workspaceSidebarWidthBounds, {
    minimum: 220,
    default: 280,
    maximum: 420,
  })
})

test('Workspace Sidebar layout preferences survive reload and inaccessible storage', () => {
  const values = new Map()
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }

  writeWorkspaceSidebarWidth(storage, 479)
  writeWorkspaceSidebarCollapsed(storage, true)
  assert.equal(values.get(workspaceSidebarWidthPreferenceKey), '420')
  assert.equal(values.get(workspaceSidebarCollapsedPreferenceKey), '1')
  assert.equal(readWorkspaceSidebarWidth(storage), 420)
  assert.equal(readWorkspaceSidebarCollapsed(storage), true)

  const failedStorage = {
    getItem() {
      throw new Error('blocked')
    },
    setItem() {
      throw new Error('blocked')
    },
  }
  assert.equal(readWorkspaceSidebarWidth(failedStorage), 280)
  assert.equal(readWorkspaceSidebarCollapsed(failedStorage), false)
  assert.doesNotThrow(() => writeWorkspaceSidebarWidth(failedStorage, 300))
  assert.doesNotThrow(() =>
    writeWorkspaceSidebarCollapsed(failedStorage, false),
  )
})

test('Sidebar toggle owns one fixed chrome slot independent of panel state', async () => {
  const [topBar, shell, sidebar, tauriConfiguration] = await Promise.all([
    readFile(
      new URL('../src/components/app-shell/top-bar.tsx', import.meta.url),
      'utf8',
    ),
    readFile(
      new URL('../src/components/app-shell/app-shell.tsx', import.meta.url),
      'utf8',
    ),
    readFile(
      new URL(
        '../src/components/app-shell/workspace-sidebar.tsx',
        import.meta.url,
      ),
      'utf8',
    ),
    readFile(
      new URL('../../desktop/src-tauri/tauri.conf.json', import.meta.url),
      'utf8',
    ),
  ])
  const toggleSlot = topBar.indexOf('data-slot="workspace-sidebar-toggle"')
  const breadcrumb = topBar.indexOf('aria-label="当前位置"')

  assert.ok(toggleSlot >= 0)
  assert.ok(breadcrumb > toggleSlot)
  assert.equal(
    topBar.match(/data-slot="workspace-sidebar-toggle"/gu)?.length,
    1,
  )
  assert.match(topBar, /sidebarCollapsed \? '显示侧边栏' : '隐藏侧边栏'/u)
  assert.match(topBar, /aria-pressed=\{!sidebarCollapsed\}/u)
  assert.doesNotMatch(topBar, /top-bar-restore|top-bar-brand/u)
  assert.match(shell, /onToggleSidebar=\{\(\) =>/u)
  assert.match(shell, /setSidebarCollapsed\(\(current\) => !current\)/u)
  assert.match(sidebar, /data-slot="workspace-sidebar-brand"/u)
  assert.doesNotMatch(sidebar, /PanelLeftClose|隐藏工作区侧边栏/u)
  assert.equal(JSON.parse(tauriConfiguration).app.windows[0].decorations, true)
})

test('Workspace Sidebar handle uses pointer capture, cleanup, and keyboard resizing', async () => {
  const [handle, shell, sidebar, topBar] = await Promise.all([
    readFile(
      new URL(
        '../src/components/app-shell/workspace-sidebar-resize-handle.tsx',
        import.meta.url,
      ),
      'utf8',
    ),
    readFile(
      new URL('../src/components/app-shell/app-shell.tsx', import.meta.url),
      'utf8',
    ),
    readFile(
      new URL(
        '../src/components/app-shell/workspace-sidebar.tsx',
        import.meta.url,
      ),
      'utf8',
    ),
    readFile(
      new URL('../src/components/app-shell/top-bar.tsx', import.meta.url),
      'utf8',
    ),
  ])

  assert.match(handle, /setPointerCapture\(event\.pointerId\)/u)
  assert.match(handle, /releasePointerCapture\(event\.pointerId\)/u)
  assert.match(handle, /onPointerCancel=\{finishResize\}/u)
  assert.match(handle, /onLostPointerCapture=\{finishResize\}/u)
  assert.match(handle, /restoreDocumentStyles/u)
  assert.match(handle, /document\.body\.style\.userSelect = 'none'/u)
  assert.match(handle, /case 'ArrowLeft'/u)
  assert.match(handle, /case 'ArrowRight'/u)
  assert.match(handle, /aria-label="调整侧边栏宽度"/u)
  assert.match(topBar, /'显示侧边栏' : '隐藏侧边栏'/u)
  assert.equal(
    topBar.match(/data-slot="workspace-sidebar-toggle"/gu)?.length,
    1,
  )
  assert.match(topBar, /aria-label="检查状态"/u)
  assert.match(topBar, /max-\[1180px\]:sr-only/u)
  assert.doesNotMatch(topBar, /label="帮助"/u)
  assert.match(shell, /sidebarCollapsed\s*\? '0px'/u)
  assert.match(shell, /readWorkspaceSidebarWidth/u)
  assert.match(shell, /readWorkspaceSidebarCollapsed/u)
  assert.match(shell, /WorkspaceChromeTargetProvider/u)
})

test('Top Bar owns stable left, center, and right chrome regions', async () => {
  const source = await readFile(
    new URL('../src/components/app-shell/top-bar.tsx', import.meta.url),
    'utf8',
  )
  const left = source.indexOf('data-slot="top-bar-left-controls"')
  const breadcrumb = source.indexOf('aria-label="当前位置"')
  const right = source.indexOf('data-slot="top-bar-right-actions"')
  const doctor = source.indexOf('aria-label="检查状态"')
  const workspace = source.indexOf('data-slot="top-bar-workspace-actions"')

  assert.ok(left >= 0)
  assert.ok(breadcrumb > left)
  assert.ok(right > breadcrumb)
  assert.ok(doctor > right)
  assert.ok(workspace > doctor)
  assert.match(source, /min-w-0 flex-1 overflow-hidden/u)
  assert.match(source, /flex min-w-0 shrink-0 items-center gap-2/u)
  assert.match(source, /max-\[1180px\]:sr-only/u)
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
