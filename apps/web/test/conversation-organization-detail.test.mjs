import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const conversationComponents = new URL(
  '../src/components/conversation/',
  import.meta.url,
)

test('Archived Detail keeps history visible and replaces input with explicit restore controls', async () => {
  const source = await sourceOf('conversation-workspace.tsx')

  assert.match(source, /此会话已归档/u)
  assert.match(source, /历史记录仍然可查看。恢复后可以继续与当前智能体对话。/u)
  assert.match(source, /<ConversationTimeline/u)
  assert.match(source, /<ArchivedComposer/u)
  assert.match(source, /<ConversationRestoreButton/u)
  assert.match(source, /viewModel\.archivedAt === undefined/u)
})

test('Archived to active transition deliberately restores Composer focus without stealing background focus', async () => {
  const source = await sourceOf('conversation-workspace.tsx')

  assert.match(source, /wasArchivedRef/u)
  assert.match(source, /document\.hasFocus\(\)/u)
  assert.match(source, /document\.querySelector\('\[role="dialog"\]'\)/u)
  assert.match(source, /document\.getElementById\('conversation-composer'\)/u)
})

test('Detail organization actions use one shared control and archive into the URL-addressable view', async () => {
  const [header, route] = await Promise.all([
    sourceOf('conversation-header.tsx'),
    sourceOf('conversation-detail-route.tsx'),
  ])

  assert.match(header, /ConversationOrganizationMenu/u)
  assert.match(header, /label="管理会话"/u)
  assert.match(route, /search: \{ view: 'archived' \}/u)
  assert.match(route, /if \(current\.archivedAt !== undefined\)/u)
})

test('Rail presents only the selected archived Conversation above Host-ordered active rows', async () => {
  const [rail, adapter] = await Promise.all([
    sourceOf('conversation-rail.tsx'),
    sourceOf('live-conversation-adapter.ts'),
  ])

  assert.match(rail, /currentArchivedConversation/u)
  assert.match(rail, />\s*已归档\s*</u)
  assert.match(rail, /aria-label="已置顶"/u)
  assert.match(rail, /ConversationOrganizationMenu/u)
  assert.match(rail, /scrollIntoView\(\{ block: 'nearest' \}\)/u)
  assert.match(adapter, /activeSummaries\.map/u)
  const railProjection = adapter.slice(
    adapter.indexOf('export function createLiveConversationRailViewModel'),
    adapter.indexOf('export function createLiveConversationViewModel'),
  )
  assert.doesNotMatch(railProjection, /\.sort\(/u)
})

test('1100-width overlay boundary and stable Workspace rows remain intact', async () => {
  const [detail, workspace] = await Promise.all([
    sourceOf('conversation-detail-page.tsx'),
    sourceOf('conversation-workspace.tsx'),
  ])

  assert.match(detail, /max-width: 1439px/u)
  assert.match(detail, /minmax\(0,1fr\)/u)
  assert.match(workspace, /grid-rows-\[auto_minmax\(0,1fr\)_auto_auto\]/u)
  assert.match(workspace, /min-w-0/u)
})

test('Rail membership changes preserve a meaningful keyboard focus target', async () => {
  const [rail, controls, route] = await Promise.all([
    sourceOf('conversation-rail.tsx'),
    readFile(
      new URL(
        '../src/components/conversations/conversation-organization-controls.tsx',
        import.meta.url,
      ),
      'utf8',
    ),
    sourceOf('conversation-detail-route.tsx'),
  ])

  assert.match(rail, /data-conversation-rail-row/u)
  assert.match(rail, /data-conversation-rail-primary-action/u)
  assert.match(rail, /focusAfterMembershipChange/u)
  assert.match(rail, /tabIndex=\{-1\}/u)
  assert.match(controls, /if \(onUnarchived === undefined\)/u)
  assert.match(route, /data-conversation-view-control/u)
})

async function sourceOf(fileName) {
  return readFile(new URL(fileName, conversationComponents), 'utf8')
}
