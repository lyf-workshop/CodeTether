import type { QueryClient } from '@tanstack/react-query'
import type { AttentionItem } from '@codetether/protocol'
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
import type { AttentionNotificationMetadata } from './desktop-notification-model.js'

type NotificationMetadataClient = ProjectReadClient &
  ConversationListReadClient &
  MachineReadClient

/** Only cold, bounded indexes enrich a toast; no Conversation is hydrated. */
export async function resolveAttentionNotificationMetadata(
  queryClient: QueryClient,
  runtime: NotificationMetadataClient,
  attention: Pick<AttentionItem, 'projectId' | 'conversationId'>,
): Promise<AttentionNotificationMetadata> {
  const project = await queryClient.fetchQuery(
    projectDetailQueryOptions(runtime, attention.projectId),
  )
  const conversations = await queryClient
    .fetchQuery(
      allProjectConversationsQueryOptions(runtime, attention.projectId),
    )
    .catch(() => undefined)
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
