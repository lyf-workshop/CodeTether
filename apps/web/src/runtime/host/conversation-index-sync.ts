import type { HostEventEnvelope } from '@codetether/protocol'
import type { QueryClient } from '@tanstack/react-query'

import { conversationDetailQueryKeys } from './conversation-detail-query.js'
import { conversationListQueryKeys } from './conversation-list-query.js'
import { conversationSearchQueryKeys } from './conversation-search-query.js'

const conversationIndexRefreshEvents = new Set<HostEventEnvelope['type']>([
  'conversation.started',
  'conversation.updated',
  'turn.started',
  'approval.requested',
  'approval.resolved',
  'turn.completed',
  'turn.failed',
  'turn.interrupted',
])

/**
 * Keeps durable product summaries fresh without feeding provider-frequency
 * message or Tool output through React Query's network path.
 */
export function shouldRefreshConversationIndex(
  eventType: HostEventEnvelope['type'],
): boolean {
  return conversationIndexRefreshEvents.has(eventType)
}

export function invalidateConversationProductQueries(
  queryClient: QueryClient,
  event: Pick<HostEventEnvelope, 'conversationId' | 'type'>,
): void {
  if (!shouldRefreshConversationIndex(event.type)) return

  invalidateConversationDurableQueries(queryClient)

  if (event.conversationId !== null) {
    void queryClient.invalidateQueries({
      queryKey: conversationDetailQueryKeys.detail(event.conversationId),
      exact: true,
    })
  }
}

/** Invalidates SQLite-backed Conversation discovery after Snapshot recovery. */
export function invalidateConversationDurableQueries(
  queryClient: QueryClient,
): void {
  void queryClient.invalidateQueries({
    queryKey: conversationListQueryKeys.all,
  })
  void queryClient.invalidateQueries({
    queryKey: conversationSearchQueryKeys.all,
  })
}
