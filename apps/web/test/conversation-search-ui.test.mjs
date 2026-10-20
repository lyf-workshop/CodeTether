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

test('search row actions participate in the shared responsive SessionItem layout', async () => {
  const source = await sourceOf(
    'components/conversations/conversation-search-results.tsx',
  )
  assert.match(source, /<SessionItem/u)
  assert.doesNotMatch(source, /absolute right-0 flex w-max/u)
  assert.equal(
    (source.match(/className="flex w-max items-center gap-1"/gu) ?? []).length,
    2,
  )
})

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

test('Project Conversation Search keeps canonical query and filters in validated URL state', async () => {
  const [router, model, page] = await Promise.all([
    sourceOf('router.tsx'),
    sourceOf('components/projects/project-workspace-model.ts'),
    sourceOf('components/projects/project-conversation-collection.tsx'),
  ])
  assert.match(router, /path: '\/projects\/\$projectId'/u)
  assert.match(router, /path: '\/projects\/\$projectId\/conversations'/u)
  assert.match(router, /path: '\/projects\/\$projectId\/search'/u)
  assert.match(router, /validateSearch: projectSearch/u)
  assert.match(router, /return parseProjectWorkspaceSearch\(search\)/u)
  assert.match(
    model,
    /ConversationSearchQueryTextSchema\.safeParse\(search\.q\)/u,
  )
  assert.match(model, /query\.success[\s\S]*?\{ q: query\.data \}/u)
  assert.match(model, /search\.view === 'archived'/u)
  assert.match(model, /ProviderIdSchema\.safeParse\(search\.provider\)/u)
  assert.match(model, /ConversationStatusSchema\.safeParse\(search\.status\)/u)
  assert.doesNotMatch(model + page, /localStorage|sessionStorage/u)
  assert.match(page, /'\/projects\/\$projectId\/search'/u)
  assert.match(page, /resetScroll: false/u)
})

test('Conversation page uses durable infinite Search only for nonblank q and keeps Browse on the Host index', async () => {
  const page = await sourceOf(
    'components/projects/project-conversation-collection.tsx',
  )
  assert.match(page, /const query = search\.q \?\? ''/u)
  assert.match(page, /useDebouncedSearchQuery\(query\)/u)
  assert.match(page, /conversationSearchInfiniteQueryOptions\(/u)
  assert.match(
    page,
    /enabled: ready && searchPage && debouncedQuery\.length > 0/u,
  )
  assert.match(
    page,
    /archive: archiveView === 'archived' \? 'archived' : 'all'/u,
  )
  assert.match(page, /useInfiniteQuery\(/u)
  assert.match(
    page,
    /conversationListQueryOptions\(runtime, projectId, 'active'\)/u,
  )
  assert.match(
    page,
    /conversationListQueryOptions\(runtime, projectId, 'archived'\)/u,
  )
  assert.match(page, /enabled: ready && !searchPage/u)
  assert.match(page, /filterProjectLocationSearchResults\(/u)
  assert.match(page, /aria-label="搜索这个项目的会话"/u)
  assert.match(page, /不搜索 AI[\s\S]*?回复、工具输出或其他项目/u)
  assert.doesNotMatch(
    page,
    /runtime\.getConversation|fetchSnapshot|toLowerCase\(\)\.includes/u,
  )
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
    sourceOf('components/projects/project-conversation-collection.tsx'),
  ])
  assert.match(results, /conversationSearchMatchDescription\(result\)/u)
  assert.match(results, /search=\{conversationSearchTurnIntent\(result\)\}/u)
  assert.match(results, /ConversationOrganizationMenu/u)
  assert.match(results, /ConversationRestoreButton/u)
  assert.match(results, /showRestoreAction=\{!archived\}/u)
  assert.match(results, /conversation\.archivedAt !== undefined/u)
  assert.match(results, /已显示 \{results\.length\} 条结果/u)
  assert.doesNotMatch(results, /共\s*\{results\.length\}|总计|全部结果共/u)
  assert.doesNotMatch(results, /dangerouslySetInnerHTML/u)
  assert.doesNotMatch(page, /summary\.total|totalCount|<ProjectSummary/u)
})

test('Load More preserves bounded pages, exposes retry state, and resets only the exact Search', async () => {
  const [page, results, query] = await Promise.all([
    sourceOf('components/projects/project-conversation-collection.tsx'),
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
  assert.match(page, /queryKey: searchOptions\.queryKey/u)
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

  const [page, results] = await Promise.all([
    sourceOf('components/projects/project-conversation-collection.tsx'),
    sourceOf('components/conversations/conversation-search-results.tsx'),
  ])

  assert.match(page, /onRefreshMembership=\{\(\) =>/u)
  assert.match(page, /refetch\(\{ cancelRefetch: false \}\)/u)
  assert.match(results, /onRefreshMembership\(\)\.finally/u)
  assert.match(results, /data-conversation-search-organization-trigger/u)
  assert.match(results, /data-conversation-search-input/u)
})

test('Search retains stale results with an explicit exact-query refresh error', async () => {
  const page = await sourceOf(
    'components/projects/project-conversation-collection.tsx',
  )

  assert.match(page, /durableSearchQuery\.isRefetchError/u)
  assert.match(page, /!durableSearchQuery\.isFetchNextPageError/u)
  assert.match(page, /当前显示上次已经读取的结果/u)
  assert.match(page, /<Notice[\s\S]*?title="搜索结果未能更新"/u)
})

test('Search empty, filtered-page and responsive states preserve discovery without false totals', async () => {
  const [page, results, item] = await Promise.all([
    sourceOf('components/projects/project-conversation-collection.tsx'),
    sourceOf('components/conversations/conversation-search-results.tsx'),
    repositorySourceOf('packages/ui/src/components/product/session-item.tsx'),
  ])
  assert.match(page, /没有找到“\$\{query\}”/u)
  assert.match(page, /换个关键词或筛选条件试试/u)
  assert.match(
    page,
    /archive: archiveView === 'archived' \? 'archived' : 'all'/u,
  )
  assert.match(
    page,
    /results\.length > 0 \|\| durableSearchQuery\.hasNextPage/u,
  )
  assert.match(page, /当前已加载的页面没有匹配项/u)
  assert.match(page, /onLoadMore=\{\(\) =>/u)
  assert.match(page, /min-w-0/u)
  assert.match(page, /flex min-w-0 flex-wrap/u)
  assert.match(
    results,
    /data-conversation-search-result[\s\S]*?className="min-w-0"/u,
  )
  assert.match(item, /flex min-h-15 min-w-0 flex-wrap/u)
  assert.match(item, /truncate text-base font-medium/u)
  assert.match(item, /basis-full[\s\S]*?sm:basis-auto/u)
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

async function sourceOf(relativePath) {
  return await readFile(resolve(webSource, relativePath), 'utf8')
}

async function repositorySourceOf(relativePath) {
  return await readFile(resolve(repositoryRoot, relativePath), 'utf8')
}
