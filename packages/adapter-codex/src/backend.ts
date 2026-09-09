import { createHash } from 'node:crypto'

export type CodexBackendConfigurationSource =
  'process_environment' | 'provider_settings' | 'mixed' | 'unknown'

export interface CodexBackendConfigurationObservation {
  readonly mode: 'first_party' | 'custom_gateway' | 'unknown'
  readonly source: CodexBackendConfigurationSource
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

export interface CodexBackendProviderSettingsObservation {
  readonly observed: boolean
  readonly mode: 'first_party' | 'custom_gateway' | 'unknown'
  readonly hasBaseUrl: boolean
  readonly hasApiKey: boolean
  readonly hasAuthToken: boolean
  readonly configurationValid: boolean
  readonly sanitizedOrigin?: string
}

/** Zero-I/O, secret-safe observation of the effective Codex backend mode. */
export function observeCodexBackendConfiguration(
  environment: NodeJS.ProcessEnv,
  providerSettings: CodexBackendProviderSettingsObservation = {
    observed: true,
    mode: 'first_party',
    hasBaseUrl: false,
    hasApiKey: false,
    hasAuthToken: false,
    configurationValid: true,
  },
): CodexBackendConfigurationObservation {
  const normalized = normalizedEnvironment(environment)
  const hasBaseUrl = normalized.has('OPENAI_BASE_URL')
  const hasApiKey = normalized.has('OPENAI_API_KEY')
  const hasAuthToken = normalized.has('CODEX_API_KEY')
  const environmentOrigin = sanitizedBackendOrigin(
    normalized.get('OPENAI_BASE_URL'),
  )
  const environmentValid = !hasBaseUrl || environmentOrigin !== undefined
  const environmentContributes = hasBaseUrl || hasApiKey || hasAuthToken
  const settingsContribute =
    providerSettings.observed &&
    (providerSettings.mode !== 'first_party' ||
      providerSettings.hasBaseUrl ||
      providerSettings.hasApiKey ||
      providerSettings.hasAuthToken)
  const source: CodexBackendConfigurationSource =
    environmentContributes && settingsContribute
      ? 'mixed'
      : environmentContributes
        ? 'process_environment'
        : settingsContribute
          ? 'provider_settings'
          : 'unknown'
  const mode =
    providerSettings.mode === 'custom_gateway' || hasBaseUrl
      ? 'custom_gateway'
      : providerSettings.observed
        ? providerSettings.mode
        : 'unknown'
  const sanitizedOrigin =
    providerSettings.mode === 'custom_gateway'
      ? providerSettings.sanitizedOrigin
      : environmentOrigin
  const configurationValid =
    environmentValid && providerSettings.configurationValid
  const effectiveHasBaseUrl = hasBaseUrl || providerSettings.hasBaseUrl
  const effectiveHasApiKey = hasApiKey || providerSettings.hasApiKey
  const effectiveHasAuthToken = hasAuthToken || providerSettings.hasAuthToken
  // Persisted lifecycle state must never become a credential-derived
  // verifier. Exact secret rotation is observed by the next explicit backend
  // execution; compatibility caching needs only safe configuration shape.
  const revision = createHash('sha256')
    .update('codetether-codex-backend-configuration-v2\0')
    .update(
      JSON.stringify({
        mode,
        source,
        hasBaseUrl: effectiveHasBaseUrl,
        hasApiKey: effectiveHasApiKey,
        hasAuthToken: effectiveHasAuthToken,
        configurationValid,
        sanitizedOrigin: sanitizedOrigin ?? null,
      }),
    )
    .digest('hex')
  return {
    mode,
    source,
    hasBaseUrl: effectiveHasBaseUrl,
    hasApiKey: effectiveHasApiKey,
    hasAuthToken: effectiveHasAuthToken,
    hasOAuthToken: false,
    bedrockConfigured: false,
    vertexConfigured: false,
    configurationValid,
    ...(sanitizedOrigin === undefined ? {} : { sanitizedOrigin }),
    privateConfigurationRevision: revision,
  }
}

/**
 * Reduces config/read immediately to non-secret backend facts. Raw Provider
 * settings never leave this adapter boundary.
 */
export function parseCodexBackendProviderSettings(
  value: unknown,
  environment: NodeJS.ProcessEnv,
): CodexBackendProviderSettingsObservation {
  if (!isRecord(value) || !isRecord(value.config)) {
    return unobservedCodexBackendProviderSettings()
  }
  const config = value.config
  const modelProvider = config.model_provider
  if (modelProvider === undefined || modelProvider === null) {
    return firstPartyCodexBackendProviderSettings()
  }
  if (typeof modelProvider !== 'string' || modelProvider.length === 0) {
    return invalidCodexBackendProviderSettings()
  }
  if (modelProvider === 'openai') {
    return firstPartyCodexBackendProviderSettings()
  }
  if (!isRecord(config.model_providers)) {
    return invalidCodexBackendProviderSettings()
  }
  const selected = config.model_providers[modelProvider]
  if (!isRecord(selected)) {
    return invalidCodexBackendProviderSettings()
  }
  const baseUrl = nonEmptyString(selected.base_url)
  const sanitizedOrigin = sanitizedBackendOrigin(baseUrl)
  const environmentKey = nonEmptyString(selected.env_key)
  const normalized = normalizedEnvironment(environment)
  const hasApiKey =
    environmentKey !== undefined &&
    /^[A-Za-z_][A-Za-z0-9_]*$/u.test(environmentKey) &&
    normalized.has(environmentKey.toUpperCase())
  const hasAuthToken =
    nonEmptyString(selected.experimental_bearer_token) !== undefined
  return {
    observed: true,
    mode: baseUrl === undefined ? 'unknown' : 'custom_gateway',
    hasBaseUrl: baseUrl !== undefined,
    hasApiKey,
    hasAuthToken,
    configurationValid: baseUrl !== undefined && sanitizedOrigin !== undefined,
    ...(sanitizedOrigin === undefined ? {} : { sanitizedOrigin }),
  }
}

export function unobservedCodexBackendProviderSettings(): CodexBackendProviderSettingsObservation {
  return {
    observed: false,
    mode: 'unknown',
    hasBaseUrl: false,
    hasApiKey: false,
    hasAuthToken: false,
    configurationValid: true,
  }
}

function firstPartyCodexBackendProviderSettings(): CodexBackendProviderSettingsObservation {
  return {
    observed: true,
    mode: 'first_party',
    hasBaseUrl: false,
    hasApiKey: false,
    hasAuthToken: false,
    configurationValid: true,
  }
}

function invalidCodexBackendProviderSettings(): CodexBackendProviderSettingsObservation {
  return {
    observed: true,
    mode: 'unknown',
    hasBaseUrl: false,
    hasApiKey: false,
    hasAuthToken: false,
    configurationValid: false,
  }
}

function normalizedEnvironment(
  environment: NodeJS.ProcessEnv,
): ReadonlyMap<string, string> {
  const normalized = new Map<string, string>()
  for (const [name, value] of Object.entries(environment)) {
    if (value !== undefined && value.length > 0) {
      normalized.set(name.toUpperCase(), value)
    }
  }
  return normalized
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
