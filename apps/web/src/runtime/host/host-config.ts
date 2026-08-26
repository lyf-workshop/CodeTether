const DEFAULT_HOST_BASE_URL = 'http://127.0.0.1:4317'

export const hostBaseUrl = normalizeBaseUrl(
  (
    import.meta as ImportMeta & {
      readonly env?: { readonly VITE_CODETETHER_HOST_URL?: string }
    }
  ).env?.VITE_CODETETHER_HOST_URL ?? DEFAULT_HOST_BASE_URL,
)

function normalizeBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/u, '')
  if (normalized.length === 0) return DEFAULT_HOST_BASE_URL
  return normalized
}
