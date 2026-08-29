import assert from 'node:assert/strict'
import test from 'node:test'

import {
  conversationSearchInfiniteQueryOptions,
  conversationSearchQueryKeys,
  flattenConversationSearchPages,
} from '../.tmp/test-dist/runtime/host/conversation-search-query.js'

const projectId = 'proj_search_query'
const firstCursor = 'csc_1234567890123456'

test('infinite Search canonicalizes its identity, forwards cancellation, and chains Host cursors', async () => {
  const calls = []
  const client = {
    async searchProjectConversations(id, options) {
      calls.push({ id, options })
      return calls.length === 1
        ? response([result('conv_search_first')], firstCursor)
        : response([result('conv_search_second')])
    },
  }
  const options = conversationSearchInfiniteQueryOptions(client, projectId, {
    query: '  Cafe\u0301 reconnect  ',
    archive: 'all',
    provider: 'codex',
    status: 'completed',
  })
  const signal = new AbortController().signal

  assert.deepEqual(options.queryKey, [
    'host',
    'conversation-search',
    projectId,
    {
      query: 'Café reconnect',
      archive: 'all',
      provider: 'codex',
      status: 'completed',
      limit: 25,
    },
  ])
  assert.equal(JSON.stringify(options.queryKey).includes('cursor'), false)

  const firstPage = await options.queryFn({
    queryKey: options.queryKey,
    pageParam: null,
    direction: 'forward',
    signal,
    meta: undefined,
  })
  const nextCursor = options.getNextPageParam(firstPage, [firstPage], null, [
    null,
  ])
  assert.equal(nextCursor, firstCursor)

  assert.equal(
    options.getNextPageParam(
      response([result('conv_search_repeated')], firstCursor),
      [firstPage],
      firstCursor,
      [null, firstCursor],
    ),
    null,
  )

  await options.queryFn({
    queryKey: options.queryKey,
    pageParam: nextCursor,
    direction: 'forward',
    signal,
    meta: undefined,
  })

  assert.deepEqual(calls[0], {
    id: projectId,
    options: {
      query: 'Café reconnect',
      archive: 'all',
      provider: 'codex',
      status: 'completed',
      limit: 25,
      signal,
    },
  })
  assert.equal(calls[1].options.cursor, firstCursor)
  assert.strictEqual(calls[1].options.signal, signal)
})

test('Search key isolates every logical filter and page size but never page cursor', () => {
  const base = conversationSearchInfiniteQueryOptions(
    { searchProjectConversations: async () => response([]) },
    projectId,
    { query: 'reconnect', archive: 'active' },
  )
  const filtered = conversationSearchInfiniteQueryOptions(
    { searchProjectConversations: async () => response([]) },
    projectId,
    {
      query: 'reconnect',
      archive: 'archived',
      provider: 'codex',
      status: 'failed',
      limit: 40,
    },
  )

  assert.notDeepEqual(base.queryKey, filtered.queryKey)
  assert.deepEqual(base.queryKey.at(-1), {
    query: 'reconnect',
    archive: 'active',
    provider: null,
    status: null,
    limit: 25,
  })
  assert.deepEqual(conversationSearchQueryKeys.projectScope(projectId), [
    'host',
    'conversation-search',
    projectId,
  ])
})

test('flattening cursor pages preserves first Host order and deduplicates Conversations', () => {
  const first = result('conv_search_first', 'title')
  const repeated = result('conv_search_first', 'user_input')
  const second = result('conv_search_second', 'user_input')

  assert.deepEqual(
    flattenConversationSearchPages([
      response([first], firstCursor),
      response([repeated, second]),
    ]),
    [first, second],
  )
  assert.deepEqual(flattenConversationSearchPages(undefined), [])
})

test('the Web query boundary keeps a 500-Conversation Search bounded to 25-result cursor pages', () => {
  const pages = Array.from({ length: 20 }, (_, pageIndex) => {
    const pageResults = Array.from({ length: 25 }, (_, resultIndex) =>
      result(
        `conv_search_${String(pageIndex * 25 + resultIndex).padStart(4, '0')}`,
        resultIndex % 2 === 0 ? 'title' : 'user_input',
      ),
    )
    const nextCursor =
      pageIndex === 19
        ? undefined
        : `csc_${String(pageIndex + 1).padStart(16, '0')}`
    return response(pageResults, nextCursor)
  })

  const flattened = flattenConversationSearchPages(pages)
  assert.equal(
    pages.every((page) => page.results.length === 25),
    true,
  )
  assert.equal(flattened.length, 500)
  assert.equal(flattened[0].conversation.conversationId, 'conv_search_0000')
  assert.equal(flattened.at(-1).conversation.conversationId, 'conv_search_0499')
})

function response(results, nextCursor) {
  return {
    protocolVersion: 1,
    results,
    hasMore: nextCursor !== undefined,
    ...(nextCursor === undefined ? {} : { nextCursor }),
  }
}

function result(conversationId, matchedField = 'title') {
  const conversation = { conversationId }
  return matchedField === 'title'
    ? { conversation, matchedField }
    : {
        conversation,
        matchedField,
        matchPreview: 'matching durable input',
        matchedTurnId: `turn_${conversationId}`,
      }
}
