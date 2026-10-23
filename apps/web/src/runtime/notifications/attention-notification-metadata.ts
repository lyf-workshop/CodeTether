import type { QueryClient } from '@tanstack/react-query'
import {
  AttentionIdSchema,
  type AttentionId,
  type AttentionItem,
} from '@codetether/protocol'
import type { AttentionReadClient } from '../host/attention-query.js'
import {
  allProjectConversationsQueryOptions,
  type ConversationListReadClient,
} from '../host/conversation-list-query.js'
import {
  machineListQueryOptions,
  type MachineReadClient,
} from '../host/machine-query.js'
import {
  projectDetailQueryOptions,
  type ProjectReadClient,
} from '../host/project-query.js'
import type {
  AttentionNotificationMetadata,
  NotificationNavigationTarget,
} from './desktop-notification-model.js'

type NotificationMetadataClient = ProjectReadClient &
  ConversationListReadClient &
  MachineReadClient

/**
 * A link is not navigation authority. Resolve its exact ID through the existing
 * cold index, at most one bounded query per accepted status. Older items beyond
 * those result windows only restore the Desktop; they never guess a target.
 */
export async function resolveNotificationClickTarget(
  queryClient: QueryClient,
  runtime: AttentionReadClient,
  attentionId: AttentionId,
  signal: AbortSignal,
): Promise<NotificationNavigationTarget | undefined> {
  AttentionIdSchema.parse(attentionId)
  for (const status of ['open', 'resolved', 'expired'] as const) {
    if (signal.aborted) return undefined
    const response = await queryClient.fetchQuery({
      queryKey: ['host', 'attention', 'notification-link', status],
      queryFn: ({ signal: querySignal }) =>
        runtime.listAttention({
          status,
          limit: 100,
          signal: AbortSignal.any([querySignal, signal]),
        }),
      retry: false,
      staleTime: 0,
      gcTime: 0,
    })
    if (signal.aborted) return undefined
    const matches = response.items.filter(
      (item) => item.attentionId === attentionId,
    )
    if (matches.length > 1) return undefined
    const attention = matches[0]
    if (attention === undefined) continue
    return {
      attentionId: attention.attentionId,
      projectId: attention.projectId,
      conversationId: attention.conversationId,
      ...(attention.turnId === undefined ? {} : { turnId: attention.turnId }),
    }
  }
  return undefined
}

/** Only cold, bounded indexes enrich a toast; no Conversation is hydrated. */
export async function resolveAttentionNotificationMetadata(
  queryClient: QueryClient,
  runtime: NotificationMetadataClient,
  attention: Pick<AttentionItem, 'projectId' | 'conversationId'>,
): Promise<AttentionNotificationMetadata> {
  const project = await queryClient.fetchQuery(
    projectDetailQueryOptions(runtime, attention.projectId),
  )
  const conversationsOptions = allProjectConversationsQueryOptions(
    runtime,
    attention.projectId,
  )
  const conversations =
    queryClient.getQueryData(conversationsOptions.queryKey) ??
    (await queryClient.fetchQuery(conversationsOptions).catch(() => undefined))
  const conversation = conversations?.find(
    (candidate) =>
      candidate.conversationId === attention.conversationId &&
      candidate.projectId === attention.projectId,
  )
  if (conversation === undefined) return { projectName: project.name }

  const machinesOptions = machineListQueryOptions(runtime)
  const machines =
    queryClient.getQueryData(machinesOptions.queryKey) ??
    (await queryClient.fetchQuery(machinesOptions).catch(() => undefined))
  const machine = machines?.find(
    (candidate) => candidate.machineId === conversation.machineId,
  )
  return {
    projectName: project.name,
    ...(machine === undefined ? {} : { machineName: machine.displayName }),
  }
}
