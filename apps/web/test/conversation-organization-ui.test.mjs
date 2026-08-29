import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const webDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('Conversation list exposes URL-backed Active and Archived views', async () => {
  const [page, router] = await Promise.all([
    sourceOf('components/conversations/conversations-page.tsx'),
    sourceOf('router.tsx'),
  ])

  assert.match(
    page,
    /useSearch\(\{ from: '\/projects\/\$projectId\/conversations' \}\)/u,
  )
  assert.match(page, /search\.view === 'archived' \? 'archived' : 'active'/u)
  assert.match(
    page,
    /conversationListQueryOptions\(runtime, projectId, 'active'\)/u,
  )
  assert.match(
    page,
    /conversationListQueryOptions\(runtime, projectId, 'archived'\)/u,
  )
  assert.match(page, /\['active', '活跃'\]/u)
  assert.match(page, /\['archived', '已归档'\]/u)
  assert.match(router, /search\.view === 'archived'/u)
})

test('Conversation list preserves Host ordering and has no local sort control', async () => {
  const [page, model] = await Promise.all([
    sourceOf('components/conversations/conversations-page.tsx'),
    sourceOf('components/conversations/conversation-list-model.ts'),
  ])

  assert.doesNotMatch(page, /SortAsc|sortLabels|onSortChange/u)
  assert.doesNotMatch(
    model,
    /localeCompare|\.reverse\(\)|ConversationSortOption/u,
  )
  assert.match(model, /return conversations\.filter/u)
})

test('rows expose only durable organization actions with bounded titles', async () => {
  const [group, controls] = await Promise.all([
    sourceOf('components/conversations/conversation-group.tsx'),
    sourceOf('components/conversations/conversation-organization-controls.tsx'),
  ])

  assert.match(group, /conversation\.pinnedAt/u)
  assert.match(group, /aria-label="已置顶"/u)
  assert.match(group, /ConversationRestoreButton/u)
  assert.match(group, /showInlineError=\{false\}/u)
  assert.match(group, /role="alert"/u)
  assert.match(group, /title=\{conversation\.title\}/u)
  assert.match(controls, /'置顶'/u)
  assert.match(controls, /'取消置顶'/u)
  assert.match(controls, /重命名/u)
  assert.match(controls, /归档/u)
  assert.match(controls, /恢复会话/u)
  assert.doesNotMatch(
    controls,
    /Trash2|deleteConversation|Duplicate|CopyLink|Share2/u,
  )
})

test('Rename and Archive dialogs preserve input, errors, and keyboard focus', async () => {
  const controls = await sourceOf(
    'components/conversations/conversation-organization-controls.tsx',
  )

  assert.match(controls, /<DialogTitle>重命名会话<\/DialogTitle>/u)
  assert.match(controls, /autoFocus/u)
  assert.match(controls, /onSubmit=/u)
  assert.match(controls, /role="alert"/u)
  assert.match(controls, /\{title\.length\} \/ 240/u)
  assert.match(controls, /<DialogTitle>归档会话<\/DialogTitle>/u)
  assert.match(controls, /这不是删除操作/u)
  assert.match(controls, /onCloseAutoFocus/u)
  assert.match(controls, /restoreTriggerFocus/u)
  assert.match(controls, /event\.preventDefault\(\)/u)
})

test('Archive safety and organization empty states are truthful', async () => {
  const [page, controls] = await Promise.all([
    sourceOf('components/conversations/conversations-page.tsx'),
    sourceOf('components/conversations/conversation-organization-controls.tsx'),
  ])

  assert.match(controls, /conversation\.status === 'running'/u)
  assert.match(controls, /运行中的会话暂时不能归档/u)
  assert.match(controls, /conversation\.status === 'waiting'/u)
  assert.match(controls, /当前会话仍在等待你的确认/u)
  assert.match(page, /还没有活跃会话/u)
  assert.match(page, /暂无已归档会话/u)
  assert.match(page, /查看已归档/u)
  assert.match(page, /返回活跃会话/u)
})

test('removed list rows restore focus across the pinned divider', async () => {
  const [group, states] = await Promise.all([
    sourceOf('components/conversations/conversation-group.tsx'),
    sourceOf('components/conversations/conversation-page-states.tsx'),
  ])

  assert.match(group, /findAdjacentConversationAction/u)
  assert.match(group, /while \(candidate !== null\)/u)
  assert.match(group, /candidate = candidate\[direction\]/u)
  assert.match(states, /100 个会话/u)
  assert.doesNotMatch(states, /最近 100/u)
})

async function sourceOf(relativePath) {
  return await readFile(resolve(webDirectory, 'src', relativePath), 'utf8')
}
