import { queryOptions } from '@tanstack/react-query'
import type {
  ConversationId,
  GetConversationResponse,
} from '@codetether/protocol'

export interface ConversationDetailReadClient {
  getConversation(
    conversationId: ConversationId,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GetConversationResponse>
}

export const conversationDetailQueryKeys = {
  all: ['host', 'conversation-detail'] as const,
  detail: (conversationId: ConversationId) =>
    ['host', 'conversation-detail', conversationId] as const,
}

/** Reads the provider-independent durable detail used by shell context. */
export function conversationDetailQueryOptions(
  client: ConversationDetailReadClient,
  conversationId: ConversationId,
) {
  return queryOptions({
    queryKey: conversationDetailQueryKeys.detail(conversationId),
    queryFn: ({ signal }) => client.getConversation(conversationId, { signal }),
    retry: false,
    staleTime: 0,
  })
}
