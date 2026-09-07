import { createHash } from 'node:crypto'

export interface CodexBackendConfigurationObservation {
  readonly mode: 'first_party' | 'custom_gateway' | 'unknown'
  readonly source: 'process_environment' | 'unknown'
  readonly hasBaseUrl: boolean
  readonly hasApiKey: boolean
  readonly hasAuthToken: boolean
  readonly hasOAuthToken: false
  readonly bedrockConfigured: false
  readonly vertexConfigured: false
  readonly configurationValid: boolean
  readonly sanitizedOrigin?: string
  /** Private digest. Callers derive an opaque Machine-scoped revision. */
  readonly privateConfigurationRevision: string
}

/** Zero-I/O, secret-safe observation of the effective Codex backend mode. */
export function observeCodexBackendConfiguration(
  environment: NodeJS.ProcessEnv,
): CodexBackendConfigurationObservation {
  const normalized = new Map<string, string>()
  for (const [name, value] of Object.entries(environment)) {
    if (value !== undefined && value.length > 0) {
      normalized.set(name.toUpperCase(), value)
    }
  }
  const hasBaseUrl = normalized.has('OPENAI_BASE_URL')
  const hasApiKey = normalized.has('OPENAI_API_KEY')
  const hasAuthToken = normalized.has('CODEX_API_KEY')
  const sanitizedOrigin = sanitizedBackendOrigin(
    normalized.get('OPENAI_BASE_URL'),
  )
  const configurationValid = !hasBaseUrl || sanitizedOrigin !== undefined
  // Persisted lifecycle state must never become a credential-derived
  // verifier. Exact secret rotation is observed by the next explicit backend
  // execution; compatibility caching needs only safe configuration shape.
  const revision = createHash('sha256')
    .update('codetether-codex-backend-configuration-v2\0')
    .update(
      JSON.stringify({
        mode: hasBaseUrl ? 'custom_gateway' : 'first_party',
        source:
          hasBaseUrl || hasApiKey || hasAuthToken
            ? 'process_environment'
            : 'unknown',
        hasBaseUrl,
        hasApiKey,
        hasAuthToken,
        configurationValid,
        sanitizedOrigin: sanitizedOrigin ?? null,
      }),
    )
    .digest('hex')
  return {
    mode: hasBaseUrl ? 'custom_gateway' : 'first_party',
    source:
      hasBaseUrl || hasApiKey || hasAuthToken
        ? 'process_environment'
        : 'unknown',
    hasBaseUrl,
    hasApiKey,
    hasAuthToken,
    hasOAuthToken: false,
    bedrockConfigured: false,
    vertexConfigured: false,
    configurationValid,
    ...(sanitizedOrigin === undefined ? {} : { sanitizedOrigin }),
    privateConfigurationRevision: revision,
  }
}

function sanitizedBackendOrigin(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
    if (url.username.length > 0 || url.password.length > 0) return undefined
    return url.host
  } catch {
    return undefined
  }
}
