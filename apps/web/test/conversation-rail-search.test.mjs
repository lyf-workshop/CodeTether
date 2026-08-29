import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

const webSource = resolve(import.meta.dirname, '../src')

test('Rail Search uses the durable active Host query with debounce and server status', async () => {
  const [rail, search] = await Promise.all([
    sourceOf('components/conversation/conversation-rail.tsx'),
    sourceOf('components/conversation/conversation-rail-search.tsx'),
  ])

  assert.match(rail, /useDebouncedSearchQuery\(query\)/u)
  assert.match(rail, /debouncedQuery !== trimmedQuery/u)
  assert.match(search, /conversationSearchInfiniteQueryOptions\(/u)
  assert.match(search, /archive: 'active'/u)
  assert.match(search, /status: conversationRailSearchStatus\(filter\)/u)
  assert.match(search, /limit: 25/u)
  assert.match(
    rail,
    /const normalizedQuery =\s+projectId === undefined \? query\.trim\(\)\.toLowerCase\(\) : ''/u,
  )
  assert.doesNotMatch(
    `${rail}\n${search}`,
    /localStorage|sessionStorage|zustand/iu,
  )
})

test('Rail Search reuses public Turn anchors and explains user-input matches', async () => {
  const [rail, search, model] = await Promise.all([
    sourceOf('components/conversation/conversation-rail.tsx'),
    sourceOf('components/conversation/conversation-rail-search.tsx'),
    sourceOf('components/conversation/conversation-rail-search-model.ts'),
  ])

  assert.match(
    rail,
    /search=\{targetTurnId === undefined \? \{\} : \{ turn: targetTurnId \}\}/u,
  )
  assert.match(rail, /\{matchDescription\}/u)
  assert.match(model, /result\.matchedField === 'user_input'/u)
  assert.match(model, /\? '匹配标题'/u)
  assert.match(model, /`你曾问过：\$\{result\.matchPreview\}`/u)
  assert.match(model, /targetTurnId: result\.matchedTurnId/u)
  assert.match(search, /当前会话/u)
  assert.match(search, /!search\.isPending && !currentMatches/u)
})

test('Rail Search exposes bounded loading, empty, failure, and pagination states', async () => {
  const source = await sourceOf(
    'components/conversation/conversation-rail-search.tsx',
  )

  assert.match(source, /正在搜索完整会话历史/u)
  assert.match(source, /暂时无法搜索会话/u)
  assert.match(source, /没有找到相关会话/u)
  assert.match(source, /无法加载更多结果/u)
  assert.match(source, /search\.fetchNextPage\(\)/u)
  assert.match(source, /queryClient\.resetQueries\(\{/u)
  assert.match(source, /queryKey: searchOptions\.queryKey,[\s\S]*?exact: true/u)
  assert.match(source, /正在加载…/u)
  assert.match(source, /加载更多/u)
})

async function sourceOf(relativePath) {
  return await readFile(resolve(webSource, relativePath), 'utf8')
}
