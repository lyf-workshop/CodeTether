import assert from 'node:assert/strict'
import test from 'node:test'
import { renderProjectCollection } from './fixtures/render-project-collection.mjs'

// These discovery regressions now exercise the real project Search replacing the removed Rail.
const conversation = {
  conversationId: 'conv_search_claude01',
  projectId: 'proj_collection01',
  machineId: 'machine_collection01',
  title: 'Claude 历史',
  titleSource: 'generated',
  provider: 'claude-code',
  status: 'completed',
  createdAt: '2026-08-29T12:00:00.000Z',
  updatedAt: '2026-08-29T12:01:00.000Z',
  lastActivityAt: '2026-08-29T12:01:00.000Z',
}
const result = { conversation, matchedField: 'title' }
const ready = (results = [result]) => ({
  data: { pages: [{ results }], pageParams: [null] },
})

test('Project Search preserves Claude Code identity from durable results', () => {
  const { html } = renderProjectCollection({
    searchPage: true,
    search: { q: 'Claude' },
    searchState: ready(),
  })
  assert.match(html, /Claude Code/u)
  assert.match(html, /Claude 历史/u)
  assert.match(html, /匹配标题/u)
})

test('Project Search reuses public Turn anchors and explains user-input matches', () => {
  const { html } = renderProjectCollection({
    searchPage: true,
    search: { q: '检查' },
    searchState: ready([
      {
        conversation,
        matchedField: 'user_input',
        matchPreview: '检查精确历史',
        matchedTurnId: 'turn_search_anchor01',
      },
    ]),
  })
  assert.match(html, /你曾问过：检查精确历史/u)
  assert.match(html, /data-conversation-search-primary-action/u)
  assert.match(html, /turn=turn_search_anchor01/u)
})

test('Project Search exposes bounded loading, empty, failure and pagination states', () => {
  const options = { searchPage: true, search: { q: '历史' } }
  assert.match(renderProjectCollection(options).html, /正在搜索/u)
  assert.match(
    renderProjectCollection({ ...options, searchState: { isError: true } })
      .html,
    /暂时无法搜索/u,
  )
  assert.match(
    renderProjectCollection({ ...options, searchState: ready([]) }).html,
    /没有找到/u,
  )
  const html = renderProjectCollection({
    ...options,
    searchState: { ...ready(), hasNextPage: true, isFetchingNextPage: true },
  }).html
  assert.match(html, /正在加载…/u)
  assert.match(html, /disabled=""/u)
})

test('Project Search retains loaded results and exact-query refresh failure without false totals', () => {
  const { html } = renderProjectCollection({
    searchPage: true,
    search: { q: 'Claude' },
    searchState: { ...ready(), isRefetchError: true },
  })
  assert.match(html, /Claude 历史/u)
  assert.match(html, /搜索结果未能更新/u)
  assert.match(html, /当前显示上次已经读取的结果/u)
  assert.match(html, /已显示 1 条结果/u)
  assert.doesNotMatch(html, /共 1|总计/u)
})
