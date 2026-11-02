import { queryOptions } from '@tanstack/react-query'
import type { ListProjectConversationsOptions } from '@codetether/client'
import type { ConversationListResponse, ProjectId } from '@codetether/protocol'

export interface ConversationListReadClient {
  listProjectConversations(
    projectId: ProjectId,
    options?: ListProjectConversationsOptions,
  ): Promise<ConversationListResponse>
}

export type ConversationArchiveView = 'active' | 'archived'

export interface ConversationListFilters {
  readonly provider?: ListProjectConversationsOptions['provider'] | 'all'
  readonly status?: ListProjectConversationsOptions['status'] | 'all'
}

function normalizedConversationListFilters(filters: ConversationListFilters) {
  return {
    ...(filters.provider === undefined || filters.provider === 'all'
      ? {}
      : { provider: filters.provider }),
    ...(filters.status === undefined || filters.status === 'all'
      ? {}
      : { status: filters.status }),
  }
}

export const conversationListQueryKeys = {
  all: ['host', 'project-conversations'] as const,
  projectScope: (projectId: ProjectId) =>
    ['host', 'project-conversations', projectId] as const,
  project: (
    projectId: ProjectId,
    archiveView: ConversationArchiveView = 'active',
    filters: ConversationListFilters = {},
  ) => {
    const key = [
      'host',
      'project-conversations',
      projectId,
      archiveView,
    ] as const
    const normalized = normalizedConversationListFilters(filters)
    return Object.keys(normalized).length === 0
      ? key
      : ([...key, normalized] as const)
  },
}

/**
 * Reads the Host's bounded durable index in its authoritative activity order.
 * Status and Provider filtering happens before the Host's 100-row bound.
 * Presentation does not reorder the accepted server index.
 */
export function conversationListQueryOptions(
  client: ConversationListReadClient,
  projectId: ProjectId,
  archiveView: ConversationArchiveView = 'active',
  filters: ConversationListFilters = {},
) {
  const normalized = normalizedConversationListFilters(filters)
  return queryOptions({
    queryKey: conversationListQueryKeys.project(
      projectId,
      archiveView,
      normalized,
    ),
    queryFn: async ({ signal }) =>
      (
        await client.listProjectConversations(projectId, {
          ...normalized,
          archived: archiveView === 'archived',
          limit: 100,
          signal,
        })
      ).conversations,
    retry: false,
    staleTime: 0,
  })
}

/** Provider-neutral cold index used only to enrich global Attention metadata. */
export function allProjectConversationsQueryOptions(
  client: ConversationListReadClient,
  projectId: ProjectId,
) {
  return queryOptions({
    queryKey: [...conversationListQueryKeys.projectScope(projectId), 'all'],
    queryFn: async ({ signal }) =>
      (
        await client.listProjectConversations(projectId, {
          archived: 'all',
          limit: 100,
          signal,
        })
      ).conversations,
    retry: false,
    staleTime: 0,
  })
}
