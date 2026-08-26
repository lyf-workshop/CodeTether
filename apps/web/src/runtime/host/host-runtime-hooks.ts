import { createContext, useContext, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'

import type { ConversationProjection } from './conversation-projection.js'
import { hostQueryKeys } from './host-query.js'
import type { HostConnectionState, HostRuntime } from './host-runtime.js'

export const HostRuntimeContext = createContext<HostRuntime | null>(null)

export function useHostRuntime(): HostRuntime {
  const runtime = useContext(HostRuntimeContext)
  if (runtime === null) {
    throw new Error('useHostRuntime must be used inside HostRuntimeProvider')
  }
  return runtime
}

export function useHostConnectionState(): HostConnectionState {
  const runtime = useHostRuntime()
  return useSyncExternalStore(
    runtime.subscribe,
    runtime.getConnectionState,
    runtime.getConnectionState,
  )
}

/** React observes Host-owned projection state through the TanStack Query cache. */
export function useHostProjection(): ConversationProjection | undefined {
  const query = useQuery<ConversationProjection>({
    queryKey: hostQueryKeys.projection,
    queryFn: async () => {
      throw new Error('HostRuntime owns the Conversation projection query')
    },
    enabled: false,
    gcTime: Number.POSITIVE_INFINITY,
    staleTime: Number.POSITIVE_INFINITY,
  })
  return query.data
}
