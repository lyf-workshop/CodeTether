import { createHash } from 'node:crypto'

export type ClaudeCodeBackendMode =
  'first_party' | 'custom_gateway' | 'bedrock' | 'vertex' | 'unknown'

export type ClaudeCodeBackendConfigurationSource =
  | 'process_environment'
  | 'provider_settings'
  | 'platform_integration'
  | 'mixed'
  | 'unknown'

export interface ClaudeCodeBackendConfigurationObservation {
  readonly mode: ClaudeCodeBackendMode
  readonly source: ClaudeCodeBackendConfigurationSource
  readonly hasBaseUrl: boolean
  readonly hasApiKey: boolean
  readonly hasAuthToken: boolean
  readonly hasOAuthToken: boolean
  readonly bedrockConfigured: boolean
  readonly vertexConfigured: boolean
  readonly configurationValid: boolean
  readonly sanitizedOrigin?: string
  /** Private digest. Callers must derive an opaque Machine-scoped wire revision. */
  readonly privateConfigurationRevision: string
}

const BACKEND_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_VERTEX',
] as const

/**
 * Observes only an already-resolved environment. It performs no network call,
 * reads no credential file, and returns no secret-bearing value.
 */
export function observeClaudeCodeBackendConfiguration(options: {
  readonly sourceEnvironment: NodeJS.ProcessEnv
  readonly effectiveEnvironment: NodeJS.ProcessEnv
}): ClaudeCodeBackendConfigurationObservation {
  const effective = normalizedEnvironment(options.effectiveEnvironment)
  const source = normalizedEnvironment(options.sourceEnvironment)
  const hasBaseUrl = hasValue(effective, 'ANTHROPIC_BASE_URL')
  const hasApiKey = hasValue(effective, 'ANTHROPIC_API_KEY')
  const hasAuthToken = hasValue(effective, 'ANTHROPIC_AUTH_TOKEN')
  const hasOAuthToken = hasValue(effective, 'CLAUDE_CODE_OAUTH_TOKEN')
  const bedrockConfigured = enabled(effective, 'CLAUDE_CODE_USE_BEDROCK')
  const vertexConfigured = enabled(effective, 'CLAUDE_CODE_USE_VERTEX')
  const foundryConfigured = enabled(effective, 'CLAUDE_CODE_USE_FOUNDRY')
  const configuredModes = [
    bedrockConfigured,
    vertexConfigured,
    foundryConfigured,
    hasBaseUrl,
  ].filter(Boolean).length
  const mode: ClaudeCodeBackendMode =
    configuredModes > 1
      ? 'unknown'
      : bedrockConfigured
        ? 'bedrock'
        : vertexConfigured
          ? 'vertex'
          : hasBaseUrl
            ? 'custom_gateway'
            : foundryConfigured
              ? 'unknown'
              : 'first_party'

  const baseUrl = effective.get('ANTHROPIC_BASE_URL')
  const sanitizedOrigin = sanitizedBackendOrigin(baseUrl)
  const configurationValid =
    configuredModes <= 1 && (!hasBaseUrl || sanitizedOrigin !== undefined)
  const contributingKeys = BACKEND_KEYS.filter((key) =>
    hasValue(effective, key),
  )
  const fromProcess = contributingKeys.some((key) => hasValue(source, key))
  const fromSettings = contributingKeys.some((key) => !hasValue(source, key))
  const configurationSource: ClaudeCodeBackendConfigurationSource =
    fromProcess && fromSettings
      ? 'mixed'
      : fromProcess
        ? 'process_environment'
        : fromSettings
          ? 'provider_settings'
          : mode === 'bedrock' || mode === 'vertex'
            ? 'platform_integration'
            : 'unknown'

  // This revision crosses the Machine boundary after another opaque
  // derivation, so it must not be a durable verifier derived from a
  // credential. Backend health is refreshed by explicit execution; the
  // lifecycle revision tracks only safe configuration shape and routing
  // metadata.
  const revision = createHash('sha256')
    .update('codetether-claude-backend-configuration-v2\0')
    .update(
      JSON.stringify({
        mode,
        source: configurationSource,
        hasBaseUrl,
        hasApiKey,
        hasAuthToken,
        hasOAuthToken,
        bedrockConfigured,
        vertexConfigured,
        foundryConfigured,
        configurationValid,
        sanitizedOrigin: sanitizedOrigin ?? null,
      }),
    )

  return {
    mode,
    source: configurationSource,
    hasBaseUrl,
    hasApiKey,
    hasAuthToken,
    hasOAuthToken,
    bedrockConfigured,
    vertexConfigured,
    configurationValid,
    ...(sanitizedOrigin === undefined ? {} : { sanitizedOrigin }),
    privateConfigurationRevision: revision.digest('hex'),
  }
}

function normalizedEnvironment(
  environment: NodeJS.ProcessEnv,
): ReadonlyMap<string, string> {
  const result = new Map<string, string>()
  for (const [name, value] of Object.entries(environment)) {
    if (value !== undefined && value.length > 0) {
      result.set(name.toUpperCase(), value)
    }
  }
  return result
}

function hasValue(
  environment: ReadonlyMap<string, string>,
  name: string,
): boolean {
  return environment.has(name)
}

function enabled(
  environment: ReadonlyMap<string, string>,
  name: string,
): boolean {
  const value = environment.get(name)?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
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
