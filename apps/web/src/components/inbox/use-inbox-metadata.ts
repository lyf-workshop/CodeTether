import { useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import type {
  AttentionItem,
  ConversationSummary,
  GetMachineResponse,
  MachineId,
  ProjectId,
  ProjectRecord,
} from '@codetether/protocol'
import { allProjectConversationsQueryOptions } from '../../runtime/host/conversation-list-query'
import type { HostRuntime } from '../../runtime/host/host-runtime'
import { projectListQueryOptions } from '../../runtime/host/project-query'
import { machineDetailQueryOptions } from '../../runtime/host/machine-query'
import { inboxItemContext, type InboxItemMetadata } from './inbox-context'

export type { InboxItemMetadata } from './inbox-context'

/** Existing bounded indexes own identities; only exact referenced machine details enrich approval truth. */
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
  const conversations = new Map<string, ConversationSummary>()
  for (const query of conversationQueries)
    for (const conversation of query.data ?? [])
      conversations.set(conversation.conversationId, conversation)
  const machineIds = [
    ...new Set(
      items.flatMap((item) => {
        const conversation = conversations.get(item.conversationId)
        return conversation?.projectId === item.projectId
          ? [conversation.machineId]
          : []
      }),
    ),
  ]
  const machineQueries = useQueries({
    queries: machineIds.map((machineId) => ({
      ...machineDetailQueryOptions(runtime, machineId),
      enabled,
    })),
  })
  const machineDetails = new Map<MachineId, GetMachineResponse>()
  for (const query of machineQueries)
    if (query.data !== undefined)
      machineDetails.set(query.data.machine.machineId, query.data)
  const projects = new Map<ProjectId, ProjectRecord>(
    (projectsQuery.data ?? []).map((project) => [project.projectId, project]),
  )
  return new Map(
    items.map((item) => {
      const conversation = conversations.get(item.conversationId)
      const detail =
        conversation === undefined
          ? undefined
          : machineDetails.get(conversation.machineId)
      return [
        item.attentionId,
        inboxItemContext(
          item,
          projects.get(item.projectId),
          conversation,
          detail?.machine,
          detail?.providers,
        ),
      ]
    }),
  )
}
