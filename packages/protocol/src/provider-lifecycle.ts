import { z } from 'zod'

import { CanonicalFailureSchema } from './errors.js'
import {
  ProviderBackendConfigurationRevisionSchema,
  ProviderInstallationIdSchema,
  ProviderInstallationRevisionSchema,
  TimestampSchema,
} from './ids.js'
import { ProviderIdSchema } from './providers.js'

export const providerLifecycleWireLimits = {
  installationsPerProvider: 8,
  providerLifecycles: 2,
  versionCodeUnits: 120,
  backendOriginCodeUnits: 512,
} as const

export const ProviderInstallationLauncherKindSchema = z.enum([
  'native',
  'symlink',
  'hardlink',
  'wrapper',
  'npm_shim',
  'unknown',
])
export type ProviderInstallationLauncherKind = z.infer<
  typeof ProviderInstallationLauncherKindSchema
>

export const ProviderInstallationMethodSchema = z.enum([
  'native_installer',
  'npm',
  'homebrew',
  'package_manager',
  'manual',
  'unknown',
])
export type ProviderInstallationMethod = z.infer<
  typeof ProviderInstallationMethodSchema
>

export const ProviderInstallationAvailabilitySchema = z.enum([
  'available',
  'unavailable',
  'unresolved',
])
export type ProviderInstallationAvailability = z.infer<
  typeof ProviderInstallationAvailabilitySchema
>

export const ProviderCompatibilityStateSchema = z.enum([
  'verified',
  'compatible_unverified',
  'limited',
  'incompatible',
  'unavailable',
])
export type ProviderCompatibilityState = z.infer<
  typeof ProviderCompatibilityStateSchema
>

export const ProviderRuntimeReadinessSchema = z.enum([
  'ready',
  'limited',
  'blocked',
  'unavailable',
])
export type ProviderRuntimeReadiness = z.infer<
  typeof ProviderRuntimeReadinessSchema
>

export const ProviderLifecycleFreshnessSchema = z.enum([
  'current',
  'last_known',
  'not_observed',
])
export type ProviderLifecycleFreshness = z.infer<
  typeof ProviderLifecycleFreshnessSchema
>

export const ProviderCapabilityObservationStateSchema = z.enum([
  'supported',
  'unsupported',
  'unavailable',
  'unknown',
])
export type ProviderCapabilityObservationState = z.infer<
  typeof ProviderCapabilityObservationStateSchema
>

export const ProviderCapabilityObservationSchema = z
  .object({
    observed: ProviderCapabilityObservationStateSchema,
    enabled: z.boolean(),
    effective: z.boolean(),
  })
  .strict()
  .superRefine((capability, context) => {
    if (
      capability.effective !==
      (capability.enabled && capability.observed === 'supported')
    ) {
      addIssue(
        context,
        ['effective'],
        'Effective support requires both observed support and CodeTether enablement',
      )
    }
  })
export type ProviderCapabilityObservation = z.infer<
  typeof ProviderCapabilityObservationSchema
>

export const ProviderCompatibilityCapabilitiesSchema = z
  .object({
    execution: ProviderCapabilityObservationSchema,
    streaming: ProviderCapabilityObservationSchema,
    nativeResume: ProviderCapabilityObservationSchema,
    nativeSessionDiscovery: ProviderCapabilityObservationSchema,
    fileRead: ProviderCapabilityObservationSchema,
    search: ProviderCapabilityObservationSchema,
    toolEvents: ProviderCapabilityObservationSchema,
    reasoningControl: ProviderCapabilityObservationSchema,
  })
  .strict()
export type ProviderCompatibilityCapabilities = z.infer<
  typeof ProviderCompatibilityCapabilitiesSchema
>

export const ProviderCompatibilityObservationSchema = z
  .object({
    state: ProviderCompatibilityStateSchema,
    runtimeReadiness: ProviderRuntimeReadinessSchema,
    freshness: ProviderLifecycleFreshnessSchema,
    contractVersion: z.number().int().positive().safe(),
    observedAt: TimestampSchema.optional(),
    failure: CanonicalFailureSchema.optional(),
    capabilities: ProviderCompatibilityCapabilitiesSchema,
  })
  .strict()
  .superRefine((observation, context) => {
    const expectedReadiness: Record<
      ProviderCompatibilityState,
      ProviderRuntimeReadiness
    > = {
      verified: 'ready',
      compatible_unverified: 'ready',
      limited: 'limited',
      incompatible: 'blocked',
      unavailable: 'unavailable',
    }
    if (observation.runtimeReadiness !== expectedReadiness[observation.state]) {
      addIssue(
        context,
        ['runtimeReadiness'],
        'Runtime readiness must agree with compatibility state',
      )
    }
    validateObservationFreshness(observation, context)
    if (
      (observation.state === 'verified' ||
        observation.state === 'compatible_unverified') &&
      observation.failure !== undefined
    ) {
      addIssue(
        context,
        ['failure'],
        'Compatible runtime observations cannot carry a failure',
      )
    }
    if (observation.freshness === 'not_observed') {
      if (
        observation.state !== 'unavailable' ||
        !Object.values(observation.capabilities).every(
          (capability) =>
            capability.observed === 'unknown' && !capability.effective,
        )
      ) {
        addIssue(
          context,
          ['freshness'],
          'An unobserved runtime cannot claim compatibility or effective capabilities',
        )
      }
    }
    const executionExpected =
      observation.state === 'verified' ||
      observation.state === 'compatible_unverified' ||
      observation.state === 'limited'
    for (const capabilityName of ['execution', 'streaming'] as const) {
      if (
        observation.capabilities[capabilityName].effective === executionExpected
      ) {
        continue
      }
      addIssue(
        context,
        ['capabilities', capabilityName, 'effective'],
        'Required runtime capabilities must agree with runtime compatibility',
      )
    }
  })
export type ProviderCompatibilityObservation = z.infer<
  typeof ProviderCompatibilityObservationSchema
>

export const ProviderBackendModeSchema = z.enum([
  'first_party',
  'custom_gateway',
  'bedrock',
  'vertex',
  'unknown',
])
export type ProviderBackendMode = z.infer<typeof ProviderBackendModeSchema>

export const ProviderBackendReadinessSchema = z.enum([
  'unknown',
  'ready',
  'unavailable',
  'authentication_required',
  'misconfigured',
])
export type ProviderBackendReadiness = z.infer<
  typeof ProviderBackendReadinessSchema
>

export const ProviderBackendConfigurationSourceSchema = z.enum([
  'process_environment',
  'provider_settings',
  'platform_integration',
  'mixed',
  'unknown',
])
export type ProviderBackendConfigurationSource = z.infer<
  typeof ProviderBackendConfigurationSourceSchema
>

/** Safe configuration facts only. No value-bearing credential field exists. */
export const ProviderBackendConfigurationSchema = z
  .object({
    source: ProviderBackendConfigurationSourceSchema,
    hasBaseUrl: z.boolean(),
    hasApiKey: z.boolean(),
    hasAuthToken: z.boolean(),
    hasOAuthToken: z.boolean(),
    bedrockConfigured: z.boolean(),
    vertexConfigured: z.boolean(),
  })
  .strict()
export type ProviderBackendConfiguration = z.infer<
  typeof ProviderBackendConfigurationSchema
>

export const ProviderBackendOriginSchema = z
  .string()
  .trim()
  .min(1)
  .max(providerLifecycleWireLimits.backendOriginCodeUnits)
  .refine(isSanitizedBackendOrigin, 'Backend origin must be sanitized')
export type ProviderBackendOrigin = z.infer<typeof ProviderBackendOriginSchema>

export const ProviderBackendObservationSchema = z
  .object({
    mode: ProviderBackendModeSchema,
    readiness: ProviderBackendReadinessSchema,
    freshness: ProviderLifecycleFreshnessSchema,
    configurationRevision:
      ProviderBackendConfigurationRevisionSchema.optional(),
    configuration: ProviderBackendConfigurationSchema,
    sanitizedOrigin: ProviderBackendOriginSchema.optional(),
    observedAt: TimestampSchema.optional(),
    failure: CanonicalFailureSchema.optional(),
  })
  .strict()
  .superRefine((observation, context) => {
    validateObservationFreshness(observation, context)
    if (
      (observation.readiness === 'ready' ||
        observation.readiness === 'unknown') &&
      observation.failure !== undefined
    ) {
      addIssue(
        context,
        ['failure'],
        'Ready or unknown backend observations cannot carry a failure',
      )
    }
    if (
      observation.sanitizedOrigin !== undefined &&
      observation.mode !== 'custom_gateway'
    ) {
      addIssue(
        context,
        ['sanitizedOrigin'],
        'A sanitized backend origin belongs only to custom gateway mode',
      )
    }
    if (
      observation.mode === 'custom_gateway' &&
      !observation.configuration.hasBaseUrl
    ) {
      addIssue(
        context,
        ['configuration', 'hasBaseUrl'],
        'Custom gateway mode requires configured base URL metadata',
      )
    }
    if (
      observation.mode === 'bedrock' &&
      (!observation.configuration.bedrockConfigured ||
        observation.configuration.vertexConfigured ||
        observation.configuration.hasBaseUrl)
    ) {
      addIssue(
        context,
        ['configuration', 'bedrockConfigured'],
        'Bedrock configuration must agree with backend mode',
      )
    }
    if (
      observation.mode === 'vertex' &&
      (!observation.configuration.vertexConfigured ||
        observation.configuration.bedrockConfigured ||
        observation.configuration.hasBaseUrl)
    ) {
      addIssue(
        context,
        ['configuration', 'vertexConfigured'],
        'Vertex configuration must agree with backend mode',
      )
    }
    if (
      observation.mode === 'custom_gateway' &&
      (observation.configuration.bedrockConfigured ||
        observation.configuration.vertexConfigured)
    ) {
      addIssue(
        context,
        ['configuration'],
        'Custom gateway mode cannot also claim Bedrock or Vertex routing',
      )
    }
    if (
      observation.mode === 'first_party' &&
      (observation.configuration.hasBaseUrl ||
        observation.configuration.bedrockConfigured ||
        observation.configuration.vertexConfigured)
    ) {
      addIssue(
        context,
        ['configuration'],
        'First-party mode cannot claim alternate backend routing',
      )
    }
    if (
      observation.freshness === 'not_observed' &&
      (observation.readiness !== 'unknown' ||
        observation.mode !== 'unknown' ||
        observation.configurationRevision !== undefined ||
        observation.sanitizedOrigin !== undefined ||
        observation.configuration.source !== 'unknown' ||
        Object.entries(observation.configuration).some(
          ([key, value]) => key !== 'source' && value,
        ))
    ) {
      addIssue(
        context,
        ['freshness'],
        'An unobserved backend cannot claim configuration or readiness',
      )
    }
  })
export type ProviderBackendObservation = z.infer<
  typeof ProviderBackendObservationSchema
>

export const ProviderInstallationSummarySchema = z
  .object({
    installationId: ProviderInstallationIdSchema,
    provider: ProviderIdSchema,
    selected: z.boolean(),
    version: z
      .string()
      .trim()
      .min(1)
      .max(providerLifecycleWireLimits.versionCodeUnits)
      .optional(),
    launcherKind: ProviderInstallationLauncherKindSchema,
    installMethod: ProviderInstallationMethodSchema,
    availability: ProviderInstallationAvailabilitySchema,
    revision: ProviderInstallationRevisionSchema.optional(),
    firstObservedAt: TimestampSchema,
    lastObservedAt: TimestampSchema,
    compatibility: ProviderCompatibilityObservationSchema.optional(),
    backend: ProviderBackendObservationSchema.optional(),
  })
  .strict()
  .superRefine((installation, context) => {
    if (
      Date.parse(installation.lastObservedAt) <
      Date.parse(installation.firstObservedAt)
    ) {
      addIssue(
        context,
        ['lastObservedAt'],
        'Last observation cannot precede first observation',
      )
    }
    if (
      installation.availability === 'unresolved' &&
      installation.revision !== undefined
    ) {
      addIssue(
        context,
        ['revision'],
        'An unresolved installation cannot claim an executable revision',
      )
    }
    if (
      installation.availability === 'available' &&
      installation.revision === undefined
    ) {
      addIssue(
        context,
        ['revision'],
        'An available installation requires an observed executable revision',
      )
    }
    if (
      installation.availability !== 'available' &&
      installation.compatibility?.freshness === 'current' &&
      installation.compatibility.state !== 'unavailable'
    ) {
      addIssue(
        context,
        ['compatibility', 'state'],
        'A currently unavailable installation cannot claim current runtime compatibility',
      )
    }
    if (
      installation.compatibility?.freshness === 'current' &&
      installation.compatibility.state !== 'unavailable' &&
      installation.revision === undefined
    ) {
      addIssue(
        context,
        ['compatibility', 'freshness'],
        'Current compatibility requires an observed executable revision',
      )
    }
  })
export type ProviderInstallationSummary = z.infer<
  typeof ProviderInstallationSummarySchema
>

/** Bounded lifecycle projection for one Provider on one Machine. */
export const MachineProviderLifecycleSchema = z
  .object({
    provider: ProviderIdSchema,
    selectedInstallationId: ProviderInstallationIdSchema.optional(),
    installations: z
      .array(ProviderInstallationSummarySchema)
      .max(providerLifecycleWireLimits.installationsPerProvider),
  })
  .strict()
  .superRefine((lifecycle, context) => {
    const ids = new Set<string>()
    let selected: string | undefined
    for (const [index, installation] of lifecycle.installations.entries()) {
      if (installation.provider !== lifecycle.provider) {
        addIssue(
          context,
          ['installations', index, 'provider'],
          'Installation Provider must match its lifecycle group',
        )
      }
      const id = String(installation.installationId)
      if (ids.has(id)) {
        addIssue(
          context,
          ['installations', index, 'installationId'],
          'Provider installation identities must be unique',
        )
      }
      ids.add(id)
      if (installation.selected) {
        if (selected !== undefined) {
          addIssue(
            context,
            ['installations', index, 'selected'],
            'A Provider can select at most one installation',
          )
        }
        selected = id
      }
    }
    if (selected !== lifecycle.selectedInstallationId) {
      addIssue(
        context,
        ['selectedInstallationId'],
        'Selected installation identity must agree with installation metadata',
      )
    }
  })
export type MachineProviderLifecycle = z.infer<
  typeof MachineProviderLifecycleSchema
>

function validateObservationFreshness(
  observation: {
    readonly freshness: ProviderLifecycleFreshness
    readonly observedAt?: string
    readonly failure?: unknown
  },
  context: z.RefinementCtx,
): void {
  if (
    (observation.freshness === 'not_observed') !==
    (observation.observedAt === undefined)
  ) {
    addIssue(
      context,
      ['observedAt'],
      'Current and last-known observations require an observation time',
    )
  }
  if (
    observation.freshness === 'not_observed' &&
    observation.failure !== undefined
  ) {
    addIssue(
      context,
      ['failure'],
      'An unobserved lifecycle state cannot carry a failure',
    )
  }
}

function isSanitizedBackendOrigin(value: string): boolean {
  try {
    const explicitUrl = new URL(value)
    if (
      (explicitUrl.protocol === 'https:' || explicitUrl.protocol === 'http:') &&
      explicitUrl.username.length === 0 &&
      explicitUrl.password.length === 0 &&
      explicitUrl.search.length === 0 &&
      explicitUrl.hash.length === 0 &&
      explicitUrl.pathname === '/' &&
      explicitUrl.origin === value
    ) {
      return true
    }
  } catch {
    // A presentation-safe hostname (optionally with port) is also accepted.
  }
  if (
    value.includes('/') ||
    value.includes('@') ||
    value.includes('?') ||
    value.includes('#') ||
    /\s/u.test(value)
  ) {
    return false
  }
  try {
    const host = new URL(`https://${value}`)
    return host.host === value && host.pathname === '/'
  } catch {
    return false
  }
}

function addIssue(
  context: z.RefinementCtx,
  path: Array<string | number>,
  message: string,
): void {
  context.addIssue({ code: 'custom', path, message })
}
