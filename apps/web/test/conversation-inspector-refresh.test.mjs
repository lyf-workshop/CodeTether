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
  assert.match(
    source,
    /min-\[1440px\]:grid-cols-\[var\(--layout-conversation-rail-width\)_minmax\(0,1fr\)\]/u,
  )
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
