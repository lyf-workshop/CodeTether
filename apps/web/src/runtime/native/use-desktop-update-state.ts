import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { nativeCapabilities } from './native-capabilities.js'

export const desktopUpdateQueryKey = ['desktop', 'update-state'] as const

export function useDesktopUpdateState() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: desktopUpdateQueryKey,
    queryFn: () => nativeCapabilities.desktopUpdater.state(),
    retry: false,
    staleTime: 0,
  })

  useEffect(() => {
    let unsubscribe: (() => void) | undefined
    let active = true
    void nativeCapabilities.desktopUpdater
      .subscribe((snapshot) => {
        if (active) queryClient.setQueryData(desktopUpdateQueryKey, snapshot)
      })
      .then((stop) => {
        if (active) unsubscribe = stop
        else stop()
      })
      .catch(() => {
        if (active)
          void queryClient.invalidateQueries({
            queryKey: desktopUpdateQueryKey,
          })
      })
    return () => {
      active = false
      unsubscribe?.()
    }
  }, [queryClient])

  return query
}
