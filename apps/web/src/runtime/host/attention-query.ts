import { queryOptions, type QueryClient } from '@tanstack/react-query'
import type {
  AttentionListResponse,
  HostEventEnvelope,
} from '@codetether/protocol'

export interface AttentionReadClient {
  listAttention(options?: {
    readonly status?: 'open'
    readonly limit?: number
    readonly signal?: AbortSignal
  }): Promise<AttentionListResponse>
}

export const attentionQueryKeys = {
  all: ['host', 'attention'] as const,
  open: ['host', 'attention', 'open'] as const,
}

/** One bounded global queue feeds both the Inbox and its Sidebar badge. */
export function attentionListQueryOptions(client: AttentionReadClient) {
  return queryOptions({
    queryKey: attentionQueryKeys.open,
    queryFn: async ({ signal }) =>
      await client.listAttention({ status: 'open', limit: 100, signal }),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export function shouldRefreshAttention(
  eventType: HostEventEnvelope['type'],
): boolean {
  return eventType === 'attention.created' || eventType === 'attention.resolved'
}

/** Attention events are reliable and low-frequency, so durable truth is refetched. */
export function invalidateAttentionQueries(
  queryClient: QueryClient,
): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: attentionQueryKeys.all })
}
