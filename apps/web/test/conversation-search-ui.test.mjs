import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

import {
  conversationSearchMatchDescription,
  conversationSearchTurnIntent,
  isConversationSearchMode,
} from '../.tmp/test-dist/components/conversations/conversation-search-presentation.js'
import { conversationSearchFocusCandidates } from '../.tmp/test-dist/components/conversations/conversation-search-focus.js'

const webSource = resolve(import.meta.dirname, '../src')
const repositoryRoot = resolve(import.meta.dirname, '../../..')

test('Search presentation distinguishes Browse mode, title matches, and User-input Turn intents', () => {
  assert.equal(isConversationSearchMode(''), false)
  assert.equal(isConversationSearchMode(' \t\n '), false)
  assert.equal(isConversationSearchMode('  reconnect  '), true)
  assert.equal(isConversationSearchMode('中文问题'), true)

  const titleMatch = searchResult('title')
  assert.equal(conversationSearchMatchDescription(titleMatch), '匹配标题')
  assert.deepEqual(conversationSearchTurnIntent(titleMatch), {})

  const inputMatch = searchResult('user_input')
  assert.equal(
    conversationSearchMatchDescription(inputMatch),
    '你曾问过：检查 Windows 登录后的 reconnect 行为',
  )
  assert.deepEqual(conversationSearchTurnIntent(inputMatch), {
    turn: 'turn_search_ui_001',
  })
})

test('Project Conversation Search keeps canonical q and archive view in validated URL state', async () => {
  const router = await sourceOf('router.tsx')
  const route = sourceSection(
    router,
    'const projectConversationsRoute',
    'const agentsRoute',
  )

  assert.match(
    router,
    /interface ProjectConversationsSearch[\s\S]*?q\?: string/u,
  )
  assert.match(
    route,
    /ConversationSearchQueryTextSchema\.safeParse\(search\.q\)/u,
  )
  assert.match(route, /query\.success[\s\S]*?\{ q: query\.data \}/u)
  assert.match(route, /search\.view === 'archived'/u)
  assert.match(route, /\{ view: 'archived' as const \}/u)
  assert.doesNotMatch(route, /localStorage|sessionStorage/u)

  const page = await sourceOf('components/conversations/conversations-page.tsx')
  assert.match(page, /replace: searchMode === nextSearchMode/u)
  assert.match(page, /resetScroll: false/u)
})

test('Conversation page uses durable infinite Search only for nonblank q and keeps Browse on the Host index', async () => {
  const page = await sourceOf('components/conversations/conversations-page.tsx')

  assert.match(page, /const query = search\.q \?\? ''/u)
  assert.match(page, /const searchMode = isConversationSearchMode\(query\)/u)
  assert.match(page, /useDebouncedSearchQuery\(query\)/u)
  assert.match(page, /conversationSearchInfiniteQueryOptions\(/u)
  assert.match(
    page,
    /enabled:[\s\S]*?connectionState === 'connected'[\s\S]*?searchMode[\s\S]*?debouncedQuery\.length > 0/u,
  )
  assert.match(page, /archive: archiveView/u)
  assert.match(page, /useInfiniteQuery\(/u)

  assert.match(
    page,
    /conversationListQueryOptions\(runtime, projectId, 'active'\)/u,
  )
  assert.match(
    page,
    /conversationListQueryOptions\(runtime, projectId, 'archived'\)/u,
  )
  assert.match(
    page,
    /visibleProjectConversations\(conversations, \{[\s\S]*?query: ''/u,
  )
  assert.match(page, /searchMode && project !== undefined/u)

  assert.match(page, /aria-label="搜索会话标题或你说过的内容"/u)
  assert.match(page, /placeholder="搜索标题或历史提问…"/u)
  assert.doesNotMatch(page, /placeholder="搜索会话标题或智能体/u)
})

test('durable Search debounces Host reads for 250 ms and always cleans up the pending timer', async () => {
  const debounce = await sourceOf(
    'components/conversations/use-debounced-search-query.ts',
  )

  assert.match(debounce, /conversationSearchDebounceMs = 250/u)
  assert.match(debounce, /const trimmed = value\.trim\(\)/u)
  assert.match(debounce, /window\.setTimeout\(/u)
  assert.match(debounce, /\(\) => setDebounced\(trimmed\)/u)
  assert.match(debounce, /trimmed\.length === 0 \? 0 : delayMs/u)
  assert.match(debounce, /return \(\) => window\.clearTimeout\(timeout\)/u)
})

test('Search result rows are privacy-safe, organization-aware, and make no total-count claim', async () => {
  const [results, page] = await Promise.all([
    sourceOf('components/conversations/conversation-search-results.tsx'),
    sourceOf('components/conversations/conversations-page.tsx'),
  ])
  const searchContent = sourceSection(
    page,
    'function ConversationSearchReadyContent',
    'interface ConversationReadyContentProps',
  )

  assert.match(results, /conversationSearchMatchDescription\(result\)/u)
  assert.match(results, /search=\{conversationSearchTurnIntent\(result\)\}/u)
  assert.match(results, /ConversationOrganizationMenu/u)
  assert.match(results, /ConversationRestoreButton/u)
  assert.match(results, /showRestoreAction=\{!archived\}/u)
  assert.match(results, /已显示 \{results\.length\} 条结果/u)
  assert.doesNotMatch(results, /共\s*\{results\.length\}|总计|全部结果共/u)
  assert.doesNotMatch(results, /dangerouslySetInnerHTML/u)
  assert.doesNotMatch(searchContent, /<ProjectSummary/u)

  assert.match(
    page,
    /\.\.\.\(searchMode \? \{\} : \{ count: summary\.total \}\)/u,
  )
})

test('Load More preserves bounded pages, exposes retry state, and resets only the exact Search', async () => {
  const [page, results, query] = await Promise.all([
    sourceOf('components/conversations/conversations-page.tsx'),
    sourceOf('components/conversations/conversation-search-results.tsx'),
    sourceOf('runtime/host/conversation-search-query.ts'),
  ])

  assert.match(query, /conversationSearchLimits\.default/u)
  assert.match(query, /getNextPageParam/u)
  assert.match(
    query,
    /pageParams\.some\(\(pageParam\) => pageParam === nextCursor\)/u,
  )
  assert.match(query, /return null/u)

  assert.match(results, /\{hasNextPage \? \(/u)
  assert.match(results, /disabled=\{isFetchingNextPage\}/u)
  assert.match(results, /onClick=\{onLoadMore\}/u)
  assert.match(results, /'正在加载…' : '加载更多'/u)
  assert.match(results, /fetchNextError === undefined \? null/u)
  assert.match(results, /role="alert"/u)
  assert.match(results, /onClick=\{onResetPagination\}/u)
  assert.match(results, /重新搜索/u)

  assert.match(page, /durableSearchQuery\.isFetchNextPageError/u)
  assert.match(page, /queryClient\.resetQueries\(\{/u)
  assert.match(page, /queryKey: searchQueryOptions\.queryKey/u)
  assert.match(page, /exact: true/u)
})

test('Search organization focus waits for refreshed membership and falls back deterministically', async () => {
  assert.deepEqual(
    conversationSearchFocusCandidates(
      ['conv_before', 'conv_changed', 'conv_after'],
      'conv_changed',
    ),
    ['conv_changed', 'conv_after', 'conv_before'],
  )
  assert.deepEqual(
    conversationSearchFocusCandidates(['conv_only'], 'conv_only'),
    ['conv_only'],
  )

  const [page, results, railSearch] = await Promise.all([
    sourceOf('components/conversations/conversations-page.tsx'),
    sourceOf('components/conversations/conversation-search-results.tsx'),
    sourceOf('components/conversation/conversation-rail-search.tsx'),
  ])

  assert.match(page, /onRefreshMembership=\{async \(\) =>/u)
  assert.match(page, /refetch\(\{ cancelRefetch: false \}\)/u)
  assert.match(results, /onRefreshMembership\(\)\.finally/u)
  assert.match(results, /data-conversation-search-organization-trigger/u)
  assert.match(results, /data-conversation-search-input/u)
  assert.match(railSearch, /refetch\(\{ cancelRefetch: false \}\)\.finally/u)
  assert.match(railSearch, /data-conversation-rail-organization-trigger/u)
  assert.match(railSearch, /data-conversation-rail-search-input/u)
})

test('Search retains stale results with an explicit exact-query refresh error', async () => {
  const [page, railSearch] = await Promise.all([
    sourceOf('components/conversations/conversations-page.tsx'),
    sourceOf('components/conversation/conversation-rail-search.tsx'),
  ])

  assert.match(page, /durableSearchQuery\.isRefetchError/u)
  assert.match(page, /!durableSearchQuery\.isFetchNextPageError/u)
  assert.match(page, /当前仍显示上一次读取的内容/u)
  assert.match(page, /role="alert"/u)
  assert.match(railSearch, /search\.isRefetchError/u)
  assert.match(railSearch, /!search\.isFetchNextPageError/u)
  assert.match(railSearch, /当前仍显示上一次读取的内容/u)
})

test('Search no-results actions preserve cross-view discovery and responsive bounds', async () => {
  const [page, results, item] = await Promise.all([
    sourceOf('components/conversations/conversations-page.tsx'),
    sourceOf('components/conversations/conversation-search-results.tsx'),
    repositorySourceOf(
      'packages/ui/src/components/product/conversation-item.tsx',
    ),
  ])

  assert.match(page, /没有找到匹配的会话/u)
  assert.match(page, /标题或历史提问/u)
  assert.match(page, /onClick=\{onClearSearch\}[\s\S]*?清除搜索/u)
  assert.match(
    page,
    /在\{archiveView === 'archived' \? '活跃会话' : '已归档'\}中搜索/u,
  )
  assert.match(
    page,
    /onArchiveViewChange\([\s\S]*?archiveView === 'archived' \? 'active' : 'archived'/u,
  )

  assert.match(page, /flex min-h-full min-w-0 flex-col/u)
  assert.match(page, /grid min-w-0 gap-3/u)
  assert.match(page, /minmax\(0,1fr\)/u)
  assert.match(
    results,
    /data-conversation-search-result[\s\S]*?className="min-w-0"/u,
  )
  assert.match(item, /w-full min-w-0[\s\S]*?overflow-hidden/u)
  assert.match(item, /truncate text-md font-semibold/u)
})

test('User-input Search navigation reuses the existing retained-history Turn boundary', async () => {
  const [results, timeline] = await Promise.all([
    sourceOf('components/conversations/conversation-search-results.tsx'),
    sourceOf('components/conversation/conversation-timeline.tsx'),
  ])

  assert.match(results, /search=\{conversationSearchTurnIntent\(result\)\}/u)
  assert.match(timeline, /data-turn-anchor/u)
  assert.match(timeline, /target\.focus\(\{ preventScroll: true \}\)/u)
  assert.match(timeline, /该轮次不在当前保留的历史中/u)
})

function searchResult(matchedField) {
  const conversation = { conversationId: 'conv_search_ui_001' }
  return matchedField === 'title'
    ? { conversation, matchedField }
    : {
        conversation,
        matchedField,
        matchPreview: '检查 Windows 登录后的 reconnect 行为',
        matchedTurnId: 'turn_search_ui_001',
      }
}

function sourceSection(source, start, end) {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(startIndex, -1, `Missing source section start: ${start}`)
  assert.notEqual(endIndex, -1, `Missing source section end: ${end}`)
  return source.slice(startIndex, endIndex)
}

async function sourceOf(relativePath) {
  return await readFile(resolve(webSource, relativePath), 'utf8')
}

async function repositorySourceOf(relativePath) {
  return await readFile(resolve(repositoryRoot, relativePath), 'utf8')
}
