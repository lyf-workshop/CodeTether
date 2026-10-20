import type { HostEventEnvelope } from '@codetether/protocol'
import { ConversationUpdatedPayloadSchema } from '@codetether/protocol'
import type { QueryClient } from '@tanstack/react-query'

import { conversationDetailQueryKeys } from './conversation-detail-query.js'
import { conversationListQueryKeys } from './conversation-list-query.js'
import { conversationSearchQueryKeys } from './conversation-search-query.js'
import { conversationDrafts } from '../../components/conversation/conversation-drafts.js'

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
  event: Pick<HostEventEnvelope, 'conversationId' | 'type'> & {
    readonly payload?: unknown
  },
): void {
  if (!shouldRefreshConversationIndex(event.type)) return

  // This path runs only after the canonical event projection accepted the
  // event. Clear UI text, not organization state, for cross-client archives.
  if (event.type === 'conversation.updated') {
    const payload = ConversationUpdatedPayloadSchema.safeParse(event.payload)
    if (payload.success && payload.data.conversation.archivedAt !== undefined)
      conversationDrafts.clear(payload.data.conversation.conversationId)
  }

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
