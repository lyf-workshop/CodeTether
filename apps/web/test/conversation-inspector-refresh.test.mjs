import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { formatConversationDuration } from '../.tmp/test-dist/components/conversation/conversation-duration.js'
import { normalizeConversationInspectorTab } from '../.tmp/test-dist/components/conversation/conversation-inspector-state.js'

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

test('Inspector collapse is a device UI preference and restores a wider workspace', async () => {
  const source = await readFile(
    new URL('conversation-detail-page.tsx', componentRoot),
    'utf8',
  )

  assert.match(source, /codetether\.conversation-inspector-collapsed/u)
  assert.match(source, /localStorage/u)
  assert.match(source, /setInspectorCollapsed\(true\)/u)
  assert.match(source, /展开会话检查器/u)
  assert.match(source, /mediaQuery\.addEventListener\('change'/u)
  assert.match(source, /open=\{inspectorDialogLayout && inspector\.open\}/u)
  assert.ok(source.includes('min-[1440px]:grid-cols-[minmax(0,1fr)]'))
  assert.doesNotMatch(source, /ConversationRail|layout-conversation-rail/u)
  assert.doesNotMatch(
    source,
    /inspectorCollapsed.*conversationId|conversationId.*inspectorCollapsed/u,
  )
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
