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

export const supabaseAccountConfiguration =
  readSupabaseConfiguration(environment)

function readSupabaseConfiguration(
  value: AccountEnvironment | undefined,
): { readonly url: string; readonly publishableKey: string } | undefined {
  const url = value?.VITE_SUPABASE_URL?.trim()
  const publishableKey = value?.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!url || !publishableKey) return undefined
  const parsed = new URL(url)
  if (
    (parsed.protocol !== 'https:' && !isLocal(parsed.hostname)) ||
    parsed.origin !== url.replace(/\/+$/u, '') ||
    publishableKey.length > 512 ||
    !publishableKey.startsWith('sb_publishable_')
  ) {
    return undefined
  }
  return { url: parsed.origin, publishableKey }
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
