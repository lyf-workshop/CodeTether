import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { supabaseAccountConfiguration } from './account-config.js'

let client: SupabaseClient | undefined

export function getSupabaseAccountClient(): SupabaseClient | undefined {
  if (supabaseAccountConfiguration === undefined) return undefined
  client ??= createClient(
    supabaseAccountConfiguration.url,
    supabaseAccountConfiguration.publishableKey,
    {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: false,
        persistSession: true,
      },
    },
  )
  return client
}
