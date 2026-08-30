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

export const conversationListQueryKeys = {
  all: ['host', 'project-conversations'] as const,
  projectScope: (projectId: ProjectId) =>
    ['host', 'project-conversations', projectId] as const,
  project: (
    projectId: ProjectId,
    archiveView: ConversationArchiveView = 'active',
  ) => ['host', 'project-conversations', projectId, archiveView] as const,
}

/**
 * Reads the Host's bounded durable index in its authoritative activity order.
 * Search, presentation grouping, and the accepted local filters do not create
 * a second server-state cache.
 */
export function conversationListQueryOptions(
  client: ConversationListReadClient,
  projectId: ProjectId,
  archiveView: ConversationArchiveView = 'active',
) {
  return queryOptions({
    queryKey: conversationListQueryKeys.project(projectId, archiveView),
    queryFn: async ({ signal }) =>
      (
        await client.listProjectConversations(projectId, {
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
