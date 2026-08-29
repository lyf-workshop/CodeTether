import { infiniteQueryOptions } from '@tanstack/react-query'
import type { SearchProjectConversationsOptions } from '@codetether/client'
import {
  ConversationSearchQuerySchema,
  conversationSearchLimits,
  type ConversationSearchQuery,
  type ConversationSearchResponse,
  type ConversationSearchResult,
  type ProjectId,
} from '@codetether/protocol'

export interface ConversationSearchReadClient {
  searchProjectConversations(
    projectId: ProjectId,
    options: SearchProjectConversationsOptions,
  ): Promise<ConversationSearchResponse>
}

export interface ConversationSearchQueryOptions {
  readonly query: SearchProjectConversationsOptions['query']
  readonly archive: NonNullable<SearchProjectConversationsOptions['archive']>
  readonly provider?: SearchProjectConversationsOptions['provider']
  readonly status?: SearchProjectConversationsOptions['status']
  readonly limit?: SearchProjectConversationsOptions['limit']
}

interface ConversationSearchKeyOptions {
  readonly query: ConversationSearchQuery['q']
  readonly archive: ConversationSearchQuery['archive']
  readonly provider: ConversationSearchQuery['provider'] | null
  readonly status: ConversationSearchQuery['status'] | null
  readonly limit: ConversationSearchQuery['limit']
}

export const conversationSearchQueryKeys = {
  all: ['host', 'conversation-search'] as const,
  projectScope: (projectId: ProjectId) =>
    ['host', 'conversation-search', projectId] as const,
  project: (projectId: ProjectId, options: ConversationSearchKeyOptions) =>
    ['host', 'conversation-search', projectId, options] as const,
}

/**
 * Reads the complete durable Project history through Host-owned cursor pages.
 * The cursor is a page parameter, never part of the logical Search identity.
 */
export function conversationSearchInfiniteQueryOptions(
  client: ConversationSearchReadClient,
  projectId: ProjectId,
  options: ConversationSearchQueryOptions,
) {
  const query = ConversationSearchQuerySchema.parse({
    q: options.query,
    archive: options.archive,
    provider: options.provider,
    status: options.status,
    limit: options.limit ?? conversationSearchLimits.default,
  })
  const queryKeyOptions: ConversationSearchKeyOptions = {
    query: query.q,
    archive: query.archive,
    provider: query.provider ?? null,
    status: query.status ?? null,
    limit: query.limit,
  }

  return infiniteQueryOptions({
    queryKey: conversationSearchQueryKeys.project(projectId, queryKeyOptions),
    initialPageParam: null as ConversationSearchQuery['cursor'] | null,
    queryFn: async ({ pageParam, signal }) =>
      await client.searchProjectConversations(projectId, {
        query: query.q,
        archive: query.archive,
        provider: query.provider,
        status: query.status,
        limit: query.limit,
        ...(pageParam === null ? {} : { cursor: pageParam }),
        signal,
      }),
    getNextPageParam: (lastPage, _pages, _lastPageParam, pageParams) => {
      const nextCursor = lastPage.nextCursor
      if (
        nextCursor === undefined ||
        pageParams.some((pageParam) => pageParam === nextCursor)
      ) {
        return null
      }
      return nextCursor
    },
    retry: false,
    staleTime: 0,
  })
}

/**
 * Flattens Host pages without manufacturing a second ranking. Concurrent
 * mutations can shift a later cursor page, so the first Host-ranked occurrence
 * of a Conversation wins deterministically.
 */
export function flattenConversationSearchPages(
  pages: readonly ConversationSearchResponse[] | undefined,
): readonly ConversationSearchResult[] {
  if (pages === undefined) return []

  const identities = new Set<string>()
  const results: ConversationSearchResult[] = []
  for (const page of pages) {
    for (const result of page.results) {
      const identity = String(result.conversation.conversationId)
      if (identities.has(identity)) continue
      identities.add(identity)
      results.push(result)
    }
  }
  return results
}
