import { infiniteQueryOptions } from '@tanstack/react-query'
import type {
  ConversationId,
  ConversationOrigin,
  NativeHistoricalTranscriptEntry,
  NativeTranscriptCursor,
  NativeTranscriptStatus,
  ReadNativeTranscriptResponse,
} from '@codetether/protocol'

export interface NativeTranscriptReadClient {
  readNativeTranscript(
    conversationId: ConversationId,
    options?: {
      readonly limit?: number
      readonly cursor?: NativeTranscriptCursor
      readonly signal?: AbortSignal
    },
  ): Promise<ReadNativeTranscriptResponse>
}

export const nativeTranscriptQueryKeys = {
  all: ['host', 'native-transcript'] as const,
  conversation: (conversationId: ConversationId) =>
    ['host', 'native-transcript', conversationId] as const,
}

export function shouldReadNativeTranscript(
  origin: ConversationOrigin | undefined,
): boolean {
  return origin === 'adopted_native'
}

export function nativeTranscriptInfiniteQueryOptions(
  client: NativeTranscriptReadClient,
  conversationId: ConversationId,
) {
  return infiniteQueryOptions({
    queryKey: nativeTranscriptQueryKeys.conversation(conversationId),
    initialPageParam: null as NativeTranscriptCursor | null,
    queryFn: async ({ pageParam, signal }) =>
      await client.readNativeTranscript(conversationId, {
        limit: 50,
        ...(pageParam === null ? {} : { cursor: pageParam }),
        signal,
      }),
    getNextPageParam: (lastPage, _pages, _lastPageParam, pageParams) => {
      const nextCursor = lastPage.nextCursor
      if (
        nextCursor === undefined ||
        pageParams.some((pageParam) => pageParam === nextCursor)
      ) {
        return null
      }
      return nextCursor
    },
    retry: false,
    staleTime: 0,
  })
}

/** Provider pages arrive newest-first; the timeline is oldest-to-newest. */
export function flattenNativeTranscriptPages(
  pages: readonly ReadNativeTranscriptResponse[] | undefined,
): readonly NativeHistoricalTranscriptEntry[] {
  if (pages === undefined) return []
  const identities = new Set<string>()
  const entries: NativeHistoricalTranscriptEntry[] = []
  for (const page of [...pages].reverse()) {
    for (const entry of page.entries) {
      if (identities.has(entry.id)) continue
      identities.add(entry.id)
      entries.push(entry)
    }
  }
  return entries
}

export function nativeTranscriptStatus(
  pages: readonly ReadNativeTranscriptResponse[] | undefined,
): NativeTranscriptStatus | undefined {
  if (pages === undefined || pages.length === 0) return undefined
  if (pages.some((page) => page.status === 'partial')) return 'partial'
  if (
    pages.some((page) => page.entries.length > 0) &&
    pages.some((page) =>
      ['unsupported', 'unavailable', 'machine_offline', 'malformed'].includes(
        page.status,
      ),
    )
  ) {
    return 'partial'
  }
  return pages[0]?.status
}
