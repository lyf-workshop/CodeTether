import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const conversationComponents = new URL(
  '../src/components/conversation/',
  import.meta.url,
)

test('Conversation Workspace owns stable Header, Timeline, Dock, Composer rows', async () => {
  const source = await sourceOf('conversation-workspace.tsx')
  const header = source.indexOf('<ConversationHeader')
  const timeline = source.indexOf('<ConversationTimeline')
  const dock = source.indexOf('<PendingActionDock')
  const composer = source.indexOf('<Composer')

  assert.match(source, /grid-rows-\[auto_minmax\(0,1fr\)_auto_auto\]/u)
  assert.ok(header >= 0 && header < timeline)
  assert.ok(timeline < dock && dock < composer)
  assert.doesNotMatch(source, /pendingApprovals\.length\s*>\s*0\s*\?/u)
})

test('Timeline Approval is compact history and has no mutation controls', async () => {
  const source = await sourceOf('conversation-timeline.tsx')

  assert.match(source, /data-approval-history="requested"/u)
  assert.match(source, /请在下方待处理操作中确认/u)
  assert.doesNotMatch(source, /approvalController|\.resolve\(/u)
})

test('Composer remains mounted while the Dock is conditional inside itself', async () => {
  const [workspace, dock] = await Promise.all([
    sourceOf('conversation-workspace.tsx'),
    sourceOf('pending-action-dock.tsx'),
  ])

  assert.match(workspace, /<Composer/u)
  assert.match(dock, /if \(items\.length === 0\) return null/u)
})

test('Inspector breakpoints stay outside Workspace and do not resize the Dock', async () => {
  const source = await sourceOf('conversation-detail-page.tsx')

  assert.match(source, /min-\[1440px\]:grid-cols-/u)
  assert.match(source, /max-width: 1439px/u)
  assert.match(source, /layout-conversation-inspector-width/u)
  assert.doesNotMatch(source, /PendingActionDock/u)
})

async function sourceOf(fileName) {
  return readFile(new URL(fileName, conversationComponents), 'utf8')
}
