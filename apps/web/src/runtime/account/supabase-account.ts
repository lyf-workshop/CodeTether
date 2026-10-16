import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { supabaseAccountConfiguration } from './account-config.js'

let client: SupabaseClient | undefined

export function getSupabaseAccountClient(): SupabaseClient | undefined {
  if (supabaseAccountConfiguration === undefined) return undefined
  client ??= createSupabaseAccountClient(supabaseAccountConfiguration)
  return client
}

export function createSupabaseAccountClient(configuration: {
  readonly url: string
  readonly publishableKey: string
}): SupabaseClient {
  return createClient(configuration.url, configuration.publishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      persistSession: true,
    },
  })
}
