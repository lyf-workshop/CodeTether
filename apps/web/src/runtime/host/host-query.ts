import { queryOptions, type QueryClient } from '@tanstack/react-query'
import type {
  Bootstrap,
  ConversationId,
  HostSnapshot,
} from '@codetether/protocol'

import type {
  ConversationProjection,
  ConversationReadModel,
} from './conversation-projection.js'

export interface HostReadClient {
  bootstrap(options?: { readonly signal?: AbortSignal }): Promise<Bootstrap>
  snapshot(options?: { readonly signal?: AbortSignal }): Promise<HostSnapshot>
}

export const hostQueryKeys = {
  all: ['host'] as const,
  bootstrap: ['host', 'bootstrap'] as const,
  snapshot: ['host', 'snapshot'] as const,
  projection: ['host', 'conversation-projection'] as const,
}

export function hostBootstrapQueryOptions(client: HostReadClient) {
  return queryOptions({
    queryKey: hostQueryKeys.bootstrap,
    queryFn: async ({ signal }) => await client.bootstrap({ signal }),
    retry: false,
    staleTime: 0,
  })
}

export function hostSnapshotQueryOptions(client: HostReadClient) {
  return queryOptions({
    queryKey: hostQueryKeys.snapshot,
    queryFn: async ({ signal }) => await client.snapshot({ signal }),
    retry: false,
    staleTime: 0,
  })
}

export function readHostProjection(
  queryClient: QueryClient,
): ConversationProjection | undefined {
  return queryClient.getQueryData<ConversationProjection>(
    hostQueryKeys.projection,
  )
}

export function replaceHostProjection(
  queryClient: QueryClient,
  projection: ConversationProjection,
): void {
  queryClient.setQueryData(hostQueryKeys.projection, projection)
}

export function readConversationModel(
  queryClient: QueryClient,
  conversationId: ConversationId | string,
): ConversationReadModel | undefined {
  return readHostProjection(queryClient)?.conversations[conversationId]
}
