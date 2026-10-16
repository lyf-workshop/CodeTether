const DEFAULT_CONTROL_PLANE_URL = 'http://127.0.0.1:4320'

interface AccountEnvironment {
  readonly VITE_CODETETHER_CONTROL_PLANE_URL?: string
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
}

const environment = (
  import.meta as ImportMeta & { readonly env?: AccountEnvironment }
).env

export const controlPlaneBaseUrl = normalizeBaseUrl(
  environment?.VITE_CODETETHER_CONTROL_PLANE_URL ?? DEFAULT_CONTROL_PLANE_URL,
)

const supabaseConfiguration = readSupabaseConfiguration(environment)
export const supabaseAccountConfiguration = supabaseConfiguration.configuration
export const accountConfigurationErrors = supabaseConfiguration.errors

export function readSupabaseConfiguration(
  value: AccountEnvironment | undefined,
): {
  readonly configuration?: {
    readonly url: string
    readonly publishableKey: string
  }
  readonly errors: readonly string[]
} {
  const url = value?.VITE_SUPABASE_URL?.trim()
  const publishableKey = value?.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  const errors: string[] = []
  let parsed: URL | undefined
  if (!url) {
    errors.push('VITE_SUPABASE_URL is missing')
  } else {
    try {
      parsed = new URL(url)
      if (
        (parsed.protocol !== 'https:' && !isLocal(parsed.hostname)) ||
        parsed.origin !== url.replace(/\/+$/u, '')
      ) {
        errors.push('VITE_SUPABASE_URL is invalid')
      }
    } catch {
      errors.push('VITE_SUPABASE_URL is invalid')
    }
  }
  if (!publishableKey) {
    errors.push('VITE_SUPABASE_PUBLISHABLE_KEY is missing')
  } else if (
    publishableKey.length > 512 ||
    !publishableKey.startsWith('sb_publishable_')
  ) {
    errors.push('VITE_SUPABASE_PUBLISHABLE_KEY is invalid')
  }
  if (errors.length > 0 || parsed === undefined || publishableKey === undefined)
    return { errors }
  return {
    configuration: { url: parsed.origin, publishableKey },
    errors,
  }
}

function normalizeBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/u, '')
  const parsed = new URL(normalized || DEFAULT_CONTROL_PLANE_URL)
  if (parsed.username || parsed.password || parsed.pathname !== '/') {
    return DEFAULT_CONTROL_PLANE_URL
  }
  return parsed.origin
}

function isLocal(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1'
}
