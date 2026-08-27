import { queryOptions } from '@tanstack/react-query'
import type { ConversationListResponse, ProjectId } from '@codetether/protocol'

export interface ConversationListReadClient {
  listProjectConversations(
    projectId: ProjectId,
    options?: { readonly limit?: number; readonly signal?: AbortSignal },
  ): Promise<ConversationListResponse>
}

export const conversationListQueryKeys = {
  all: ['host', 'project-conversations'] as const,
  project: (projectId: ProjectId) =>
    ['host', 'project-conversations', projectId] as const,
}

/**
 * Reads the Host's bounded durable index in its authoritative activity order.
 * Search, presentation grouping, and the accepted local filters do not create
 * a second server-state cache.
 */
export function conversationListQueryOptions(
  client: ConversationListReadClient,
  projectId: ProjectId,
) {
  return queryOptions({
    queryKey: conversationListQueryKeys.project(projectId),
    queryFn: async ({ signal }) =>
      (await client.listProjectConversations(projectId, { limit: 100, signal }))
        .conversations,
    retry: false,
    staleTime: 0,
  })
}
