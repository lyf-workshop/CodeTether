import { useEffect, useMemo, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { HostRuntimeContext } from './host-runtime-hooks.js'
import { getHostRuntime, type HostRuntime } from './host-runtime.js'

export interface HostRuntimeProviderProps {
  readonly children: ReactNode
  readonly runtime?: HostRuntime
}

export function HostRuntimeProvider({
  children,
  runtime,
}: HostRuntimeProviderProps) {
  const queryClient = useQueryClient()
  const value = useMemo(
    () => runtime ?? getHostRuntime(queryClient),
    [queryClient, runtime],
  )

  useEffect(() => value.retain(), [value])

  return (
    <HostRuntimeContext.Provider value={value}>
      {children}
    </HostRuntimeContext.Provider>
  )
}
