import { useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'

import type {
  AttentionItem,
  ConversationSummary,
  ProjectAvailability,
  ProjectId,
  ProjectRecord,
} from '@codetether/protocol'

import { allProjectConversationsQueryOptions } from '../../runtime/host/conversation-list-query'
import type { HostRuntime } from '../../runtime/host/host-runtime'
import { projectListQueryOptions } from '../../runtime/host/project-query'

export interface InboxItemMetadata {
  readonly conversationTitle?: string
  readonly projectAvailability?: ProjectAvailability
  readonly projectName?: string
  readonly provider?: ConversationSummary['provider']
}

/**
 * Enriches bounded Attention rows with existing Project and Conversation
 * indexes. One provider-neutral active+archived index query is made per Project.
 */
export function useInboxMetadata(
  runtime: HostRuntime,
  items: readonly AttentionItem[],
  enabled: boolean,
): ReadonlyMap<string, InboxItemMetadata> {
  const projectIds = useMemo(
    () => [...new Set(items.map((item) => item.projectId))],
    [items],
  )
  const projectsQuery = useQuery({
    ...projectListQueryOptions(runtime),
    enabled: enabled && items.length > 0,
  })
  const conversationQueries = useQueries({
    queries: projectIds.map((projectId) => ({
      ...allProjectConversationsQueryOptions(runtime, projectId),
      enabled,
    })),
  })

  return useMemo(() => {
    const projects = new Map<ProjectId, ProjectRecord>(
      (projectsQuery.data ?? []).map((project) => [project.projectId, project]),
    )
    const conversations = new Map<string, ConversationSummary>()
    for (const query of conversationQueries) {
      for (const conversation of query.data ?? []) {
        conversations.set(conversation.conversationId, conversation)
      }
    }

    return new Map(
      items.map((item) => {
        const project = projects.get(item.projectId)
        const conversation = conversations.get(item.conversationId)
        return [
          item.attentionId,
          {
            ...(conversation === undefined
              ? {}
              : {
                  conversationTitle: conversation.title,
                  provider: conversation.provider,
                }),
            ...(project === undefined
              ? {}
              : {
                  projectAvailability: project.availability,
                  projectName: project.name,
                }),
          },
        ]
      }),
    )
  }, [conversationQueries, items, projectsQuery.data])
}
