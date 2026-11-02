import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { getSupabaseAccountClient } from './supabase-account'
import {
  presentAccountSession,
  type AccountSessionSummary,
} from './account-auth-actions'

export const accountSessionQueryKey = ['account', 'session'] as const

/** Auth owns credentials; Query owns the one presentation projection. */
export function useAccountSession() {
  const supabase = getSupabaseAccountClient()
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: accountSessionQueryKey,
    queryFn: async (): Promise<AccountSessionSummary | null> => {
      if (supabase === undefined) return null
      const result = await supabase.auth.getSession()
      if (result.error) throw new Error('account_session_unavailable')
      return presentAccountSession(result.data.session)
    },
    enabled: supabase !== undefined,
    staleTime: 0,
    retry: false,
  })
  useEffect(() => {
    if (supabase === undefined) return
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      void queryClient.cancelQueries({
        queryKey: accountSessionQueryKey,
        exact: true,
      })
      queryClient.setQueryData(
        accountSessionQueryKey,
        presentAccountSession(session),
      )
    })
    return () => data.subscription.unsubscribe()
  }, [queryClient, supabase])
  return { supabase, query }
}
