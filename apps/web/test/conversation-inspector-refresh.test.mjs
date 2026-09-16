import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { formatConversationDuration } from '../.tmp/test-dist/components/conversation/conversation-duration.js'
import { normalizeConversationInspectorTab } from '../.tmp/test-dist/components/conversation/conversation-inspector-state.js'
import {
  clampConversationInspectorWidth,
  conversationInspectorMaximumWidth,
  conversationInspectorWidthBounds,
  conversationInspectorWidthPreferenceKey,
  parseConversationInspectorWidth,
  readConversationInspectorWidth,
  writeConversationInspectorWidth,
} from '../.tmp/test-dist/components/conversation/conversation-inspector-layout.js'

const componentRoot = new URL(
  '../src/components/conversation/',
  import.meta.url,
)

test('Inspector exposes only truthful Files, Changes, and Tool Output surfaces', async () => {
  const source = await readFile(
    new URL('inspector-panel.tsx', componentRoot),
    'utf8',
  )

  assert.match(source, /value="files"/u)
  assert.match(source, /value="changes"/u)
  assert.match(source, /value="tools"/u)
  assert.match(source, /工具输出/u)
  assert.doesNotMatch(source, /value="overview"/u)
  assert.doesNotMatch(source, /value="context"/u)
  assert.doesNotMatch(source, /<input[^>]*terminal/u)
  assert.match(source, /supportsDiff/u)
  assert.match(source, /supportsShell/u)
  assert.match(source, /supportsToolOutput/u)
  assert.match(source, /execution\.tool\.outputSummary/u)
})

test('Inspector toggle owns one fixed chrome slot and restores a wider workspace', async () => {
  const [source, actions, panel, workspace] = await Promise.all([
    readFile(new URL('conversation-detail-page.tsx', componentRoot), 'utf8'),
    readFile(new URL('conversation-chrome-actions.tsx', componentRoot), 'utf8'),
    readFile(new URL('inspector-panel.tsx', componentRoot), 'utf8'),
    readFile(new URL('conversation-workspace.tsx', componentRoot), 'utf8'),
  ])

  assert.match(source, /codetether\.conversation-inspector-collapsed/u)
  assert.match(source, /localStorage/u)
  assert.match(source, /setInspectorCollapsed\(\(current\) => !current\)/u)
  assert.match(source, /createPortal/u)
  assert.match(source, /useWorkspaceChromeTarget/u)
  assert.match(source, /inspectorOpen=\{inspectorOpen\}/u)
  assert.match(source, /mediaQuery\.addEventListener\('change'/u)
  assert.match(source, /open=\{inspectorDialogLayout && inspector\.open\}/u)
  assert.ok(source.includes('min-[1440px]:grid-cols-[minmax(0,1fr)]'))
  assert.equal(
    actions.match(/data-slot="conversation-inspector-toggle"/gu)?.length,
    1,
  )
  assert.match(actions, /inspectorOpen \? '隐藏检查器' : '显示检查器'/u)
  assert.match(actions, /aria-pressed=\{inspectorOpen\}/u)
  assert.doesNotMatch(source, /data-inspector-restore|absolute top-/u)
  assert.doesNotMatch(panel, /折叠会话检查器|onCollapse/u)
  assert.doesNotMatch(workspace, /onOpenInspector|inspectorTriggerRef/u)
  assert.doesNotMatch(source, /ConversationRail|layout-conversation-rail/u)
  assert.doesNotMatch(
    source,
    /inspectorCollapsed.*conversationId|conversationId.*inspectorCollapsed/u,
  )
})

test('Conversation chrome keeps real execution and overflow actions without duplicate Changes action', async () => {
  const [actions, header, topBar] = await Promise.all([
    readFile(new URL('conversation-chrome-actions.tsx', componentRoot), 'utf8'),
    readFile(new URL('conversation-header.tsx', componentRoot), 'utf8'),
    readFile(
      new URL('../src/components/app-shell/top-bar.tsx', import.meta.url),
      'utf8',
    ),
  ])

  assert.match(actions, /supportsInterrupt/u)
  assert.match(actions, /中断当前运行/u)
  assert.match(actions, /interruptController\?\.execute\(\)/u)
  assert.match(actions, /ConversationOrganizationMenu/u)
  assert.match(actions, /label="管理会话"/u)
  assert.doesNotMatch(actions, /查看变更|FileDiff/u)
  assert.doesNotMatch(header, /查看变更|supportsInterrupt|PanelRight/u)
  assert.match(topBar, /data-slot="top-bar-workspace-actions"/u)
})

test('Inspector width preferences clamp invalid values and preserve Conversation width', () => {
  assert.equal(parseConversationInspectorWidth(null), 348)
  assert.equal(parseConversationInspectorWidth(''), 348)
  assert.equal(parseConversationInspectorWidth('NaN'), 348)
  assert.equal(parseConversationInspectorWidth('-10'), 280)
  assert.equal(parseConversationInspectorWidth('347.6'), 348)
  assert.equal(parseConversationInspectorWidth('1000'), 560)
  assert.equal(conversationInspectorMaximumWidth(1000), 488)
  assert.equal(conversationInspectorMaximumWidth(800), 288)
  assert.equal(conversationInspectorMaximumWidth(700), 280)
  assert.equal(clampConversationInspectorWidth(540, 1000), 488)
  assert.deepEqual(conversationInspectorWidthBounds, {
    minimum: 280,
    default: 348,
    maximum: 560,
    conversationMinimum: 512,
  })
})

test('Inspector inline width persists while Sheet sizing remains independent', async () => {
  const values = new Map()
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }

  writeConversationInspectorWidth(storage, 480)
  assert.equal(values.get(conversationInspectorWidthPreferenceKey), '480')
  assert.equal(readConversationInspectorWidth(storage), 480)

  const failedStorage = {
    getItem() {
      throw new Error('blocked')
    },
    setItem() {
      throw new Error('blocked')
    },
  }
  assert.equal(readConversationInspectorWidth(failedStorage), 348)
  assert.doesNotThrow(() => writeConversationInspectorWidth(failedStorage, 480))

  const source = await readFile(
    new URL('conversation-detail-page.tsx', componentRoot),
    'utf8',
  )
  assert.match(source, /readConversationInspectorWidth/u)
  assert.match(source, /writeConversationInspectorWidth/u)
  assert.match(source, /ResizeObserver/u)
  assert.match(source, /width=\{resolvedInspectorWidth\}/u)
  assert.match(source, /w-\[21\.75rem\]/u)
  assert.doesNotMatch(
    source,
    /DialogContent[\s\S]*?w-\[var\(--layout-conversation-inspector-width\)\]/u,
  )
})

test('Inspector resize handle owns pointer cleanup and keyboard resizing', async () => {
  const source = await readFile(
    new URL('conversation-inspector-resize-handle.tsx', componentRoot),
    'utf8',
  )

  assert.match(source, /setPointerCapture\(event\.pointerId\)/u)
  assert.match(source, /releasePointerCapture\(event\.pointerId\)/u)
  assert.match(source, /onPointerCancel=\{finishResize\}/u)
  assert.match(source, /onLostPointerCapture=\{finishResize\}/u)
  assert.match(source, /document\.body\.style\.userSelect = 'none'/u)
  assert.match(source, /case 'ArrowLeft'/u)
  assert.match(source, /case 'ArrowRight'/u)
  assert.match(source, /aria-label="调整检查器宽度"/u)
})

test('duration derives running time from the wall clock and terminal time from timestamps', () => {
  const startedAt = '2026-01-01T00:00:00.000Z'
  assert.equal(
    formatConversationDuration({
      startedAt,
      running: true,
      now: Date.parse('2026-01-01T00:00:07.900Z'),
    }),
    '00:00:07',
  )
  assert.equal(
    formatConversationDuration({
      startedAt,
      completedAt: '2026-01-01T00:01:02.000Z',
      running: false,
      now: Date.parse('2026-01-01T08:00:00.000Z'),
    }),
    '00:01:02',
  )
})

test('legacy inspector values normalize without rendering legacy tabs', () => {
  assert.equal(normalizeConversationInspectorTab('overview'), 'files')
  assert.equal(normalizeConversationInspectorTab('context'), 'files')
  assert.equal(normalizeConversationInspectorTab('terminal'), 'tools')
  assert.equal(normalizeConversationInspectorTab('changes'), 'changes')
})

test('Files consumes only existing change evidence and opens the existing change view', async () => {
  const source = await readFile(
    new URL('conversation-files-surface.tsx', componentRoot),
    'utf8',
  )

  assert.match(source, /changes\.files\.map/u)
  assert.match(source, /change\.path/u)
  assert.match(source, /change\.additions/u)
  assert.match(source, /change\.deletions/u)
  assert.match(source, /onOpenChange\?\.\(change\.id\)/u)
  assert.match(source, /查看变更/u)
  assert.match(source, /本次会话没有已知文件变更/u)
  assert.match(source, /当前 Agent 未提供文件变更信息/u)
  assert.doesNotMatch(source, /fetch\(|readProjectFile|absolutePath|directory/u)
  assert.doesNotMatch(source, /<input|<textarea/u)
})
