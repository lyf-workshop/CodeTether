import { z } from 'zod'

import { CanonicalFailureSchema } from './errors.js'
import {
  ActionIdSchema,
  MachineIdSchema,
  ProjectIdSchema,
  ProtocolVersionSchema,
  TimestampSchema,
} from './ids.js'
import {
  MachineConnectionStateSchema,
  MachineExecutionTransportSchema,
  MachineKindSchema,
} from './machines.js'
import {
  ProviderBackendModeSchema,
  ProviderBackendReadinessSchema,
  ProviderCompatibilityStateSchema,
  ProviderInstallationLauncherKindSchema,
  ProviderInstallationMethodSchema,
  ProviderLifecycleFreshnessSchema,
  ProviderRuntimeReadinessSchema,
} from './provider-lifecycle.js'
import { ProviderExecutionHealthSchema, ProviderIdSchema } from './providers.js'
import {
  RelayConnectionStateSchema,
  RelayEnrollmentStateSchema,
  RelayNodePresenceSchema,
} from './relay.js'

export const onboardingWireLimits = {
  providers: 2,
  remoteComputers: 63,
  projectLocations: 64,
  displayNameCodeUnits: 240,
  platformCodeUnits: 120,
  versionCodeUnits: 120,
} as const

export const OnboardingStepSchema = z.enum([
  'welcome',
  'computer_check',
  'provider_check',
  'project_setup',
  'previous_conversations',
  'remote_setup',
  'ready',
])
export type OnboardingStep = z.infer<typeof OnboardingStepSchema>

export const OnboardingPreviousConversationsDispositionSchema = z.enum([
  'reviewed',
  'skipped',
])
export type OnboardingPreviousConversationsDisposition = z.infer<
  typeof OnboardingPreviousConversationsDispositionSchema
>

export const OnboardingRemoteSetupDispositionSchema = z.enum([
  'configured',
  'skipped',
])
export type OnboardingRemoteSetupDisposition = z.infer<
  typeof OnboardingRemoteSetupDispositionSchema
>

/**
 * Durable flow progress only. Provider, Machine, Project, and backend models
 * remain the authority for readiness and are deliberately not copied here.
 */
export const OnboardingProgressSchema = z
  .object({
    flowVersion: z.literal(1),
    step: OnboardingStepSchema,
    revision: z.number().int().positive().safe(),
    projectId: ProjectIdSchema.optional(),
    machineId: MachineIdSchema.optional(),
    previousConversationsDisposition:
      OnboardingPreviousConversationsDispositionSchema.optional(),
    remoteSetupDisposition: OnboardingRemoteSetupDispositionSchema.optional(),
    startedAt: TimestampSchema,
    updatedAt: TimestampSchema,
    completedAt: TimestampSchema.optional(),
  })
  .strict()
  .superRefine((progress, context) => {
    if (
      (progress.projectId === undefined) !==
      (progress.machineId === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Onboarding Project context requires both Project and Machine',
        path: ['projectId'],
      })
    }
    if (Date.parse(progress.updatedAt) < Date.parse(progress.startedAt)) {
      context.addIssue({
        code: 'custom',
        message: 'Onboarding update cannot precede its start',
        path: ['updatedAt'],
      })
    }
    if (
      progress.completedAt !== undefined &&
      Date.parse(progress.completedAt) < Date.parse(progress.startedAt)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Onboarding completion cannot precede its start',
        path: ['completedAt'],
      })
    }
    if (progress.step === 'ready' && progress.completedAt === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Ready onboarding requires durable completion',
        path: ['completedAt'],
      })
    }
  })
export type OnboardingProgress = z.infer<typeof OnboardingProgressSchema>

export const OnboardingTransitionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('continue') }).strict(),
  z.object({ kind: z.literal('project_reselect') }).strict(),
  z
    .object({
      kind: z.literal('project_selected'),
      projectId: ProjectIdSchema,
      machineId: MachineIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('previous_conversations_finished'),
      disposition: OnboardingPreviousConversationsDispositionSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('remote_setup_finished'),
      disposition: OnboardingRemoteSetupDispositionSchema,
    })
    .strict(),
  z.object({ kind: z.literal('reopen') }).strict(),
])
export type OnboardingTransition = z.infer<typeof OnboardingTransitionSchema>

export const UpdateOnboardingRequestSchema = z
  .object({
    actionId: ActionIdSchema,
    expectedRevision: z.number().int().positive().safe(),
    transition: OnboardingTransitionSchema,
  })
  .strict()
export type UpdateOnboardingRequest = z.infer<
  typeof UpdateOnboardingRequestSchema
>

export const GetOnboardingResponseSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    onboarding: OnboardingProgressSchema,
  })
  .strict()
export type GetOnboardingResponse = z.infer<typeof GetOnboardingResponseSchema>

export const UpdateOnboardingResponseSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    actionId: ActionIdSchema,
    status: z.literal('completed'),
    data: z
      .object({
        onboarding: OnboardingProgressSchema,
        changed: z.boolean(),
      })
      .strict(),
  })
  .strict()
export type UpdateOnboardingResponse = z.infer<
  typeof UpdateOnboardingResponseSchema
>

export const DoctorComponentStateSchema = z.enum([
  'ready',
  'needs_attention',
  'limited',
  'unavailable',
  'offline',
  'unknown',
])
export type DoctorComponentState = z.infer<typeof DoctorComponentStateSchema>

export const DoctorSessionDiscoveryStateSchema = z.enum([
  'supported',
  'unsupported',
  'unavailable',
  'unknown',
])
export type DoctorSessionDiscoveryState = z.infer<
  typeof DoctorSessionDiscoveryStateSchema
>

export const DoctorBackendStatusSchema = z
  .object({
    state: DoctorComponentStateSchema,
    mode: ProviderBackendModeSchema,
    readiness: ProviderBackendReadinessSchema,
    freshness: ProviderLifecycleFreshnessSchema,
    observedAt: TimestampSchema.optional(),
    failure: CanonicalFailureSchema.optional(),
  })
  .strict()
  .superRefine((backend, context) => {
    const expectedState: Record<
      z.infer<typeof ProviderBackendReadinessSchema>,
      DoctorComponentState
    > = {
      unknown: 'unknown',
      ready: 'ready',
      unavailable: 'unavailable',
      authentication_required: 'needs_attention',
      misconfigured: 'needs_attention',
    }
    const state =
      backend.freshness === 'current'
        ? expectedState[backend.readiness]
        : 'unknown'
    if (backend.state !== state) {
      context.addIssue({
        code: 'custom',
        message: 'Doctor backend state must respect readiness freshness',
        path: ['state'],
      })
    }
    if (
      (backend.freshness === 'not_observed') !==
      (backend.observedAt === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Observed Doctor backend status requires an observation time',
        path: ['observedAt'],
      })
    }
    if (
      backend.freshness === 'not_observed' &&
      (backend.mode !== 'unknown' || backend.readiness !== 'unknown')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Unobserved Doctor backend status cannot claim a backend mode',
        path: ['mode'],
      })
    }
  })
export type DoctorBackendStatus = z.infer<typeof DoctorBackendStatusSchema>

export const DoctorProviderStatusSchema = z
  .object({
    provider: ProviderIdSchema,
    state: DoctorComponentStateSchema,
    installed: z.boolean(),
    selected: z.boolean(),
    alternateInstallations: z.number().int().nonnegative().max(7),
    version: z
      .string()
      .trim()
      .min(1)
      .max(onboardingWireLimits.versionCodeUnits)
      .optional(),
    launcherKind: ProviderInstallationLauncherKindSchema.optional(),
    installMethod: ProviderInstallationMethodSchema.optional(),
    compatibility: ProviderCompatibilityStateSchema.optional(),
    runtimeReadiness: ProviderRuntimeReadinessSchema.optional(),
    freshness: ProviderLifecycleFreshnessSchema,
    observedAt: TimestampSchema.optional(),
    executionHealth: ProviderExecutionHealthSchema.optional(),
    backend: DoctorBackendStatusSchema.optional(),
    sessionDiscovery: DoctorSessionDiscoveryStateSchema,
    failure: CanonicalFailureSchema.optional(),
  })
  .strict()
  .superRefine((provider, context) => {
    const expectedRuntime = {
      verified: 'ready',
      compatible_unverified: 'ready',
      limited: 'limited',
      incompatible: 'blocked',
      unavailable: 'unavailable',
    } as const
    if (
      (provider.compatibility === undefined) !==
      (provider.runtimeReadiness === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Doctor compatibility and runtime readiness must be reported together',
        path: ['runtimeReadiness'],
      })
    } else if (
      provider.compatibility !== undefined &&
      provider.runtimeReadiness !== expectedRuntime[provider.compatibility]
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Doctor runtime readiness must match compatibility state',
        path: ['runtimeReadiness'],
      })
    }
    if (
      (provider.freshness === 'not_observed') !==
      (provider.observedAt === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Observed Doctor Provider status requires an observation time',
        path: ['observedAt'],
      })
    }
    if (
      (provider.launcherKind !== undefined ||
        provider.installMethod !== undefined) &&
      !provider.selected
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Installation details require a selected installation',
        path: ['selected'],
      })
    }
    if (provider.state === 'ready' || provider.state === 'limited') {
      const currentHealth =
        provider.executionHealth?.freshness === 'current'
          ? provider.executionHealth
          : undefined
      const fatalCurrentHealth =
        currentHealth?.state === 'unavailable' ||
        currentHealth?.failure?.reason === 'provider_crashed' ||
        currentHealth?.failure?.reason === 'runtime_error' ||
        currentHealth?.failure?.reason === 'execution_lost'
      const degradedCurrentHealth =
        currentHealth?.state === 'degraded' && !fatalCurrentHealth
      const compatibleRuntime =
        provider.compatibility === 'verified' ||
        provider.compatibility === 'compatible_unverified'
      const expectedCompatibility =
        provider.state === 'ready'
          ? compatibleRuntime && !degradedCurrentHealth
          : provider.compatibility === 'limited' ||
            (compatibleRuntime && degradedCurrentHealth)
      if (
        !provider.installed ||
        !provider.selected ||
        provider.freshness !== 'current' ||
        !expectedCompatibility ||
        fatalCurrentHealth ||
        provider.backend?.state !== 'ready'
      ) {
        context.addIssue({
          code: 'custom',
          message:
            'Ready or limited Doctor Provider state requires current selected runtime and backend readiness',
          path: ['state'],
        })
      }
    }
  })
export type DoctorProviderStatus = z.infer<typeof DoctorProviderStatusSchema>

export const DoctorThisComputerSchema = z
  .object({
    machineId: MachineIdSchema,
    displayName: z
      .string()
      .trim()
      .min(1)
      .max(onboardingWireLimits.displayNameCodeUnits),
    platform: z
      .string()
      .trim()
      .min(1)
      .max(onboardingWireLimits.platformCodeUnits),
    architecture: z
      .string()
      .trim()
      .min(1)
      .max(onboardingWireLimits.platformCodeUnits),
    state: DoctorComponentStateSchema,
  })
  .strict()
export type DoctorThisComputer = z.infer<typeof DoctorThisComputerSchema>

export const DoctorProjectLocationStatusSchema = z
  .object({
    machineId: MachineIdSchema,
    machineName: z
      .string()
      .trim()
      .min(1)
      .max(onboardingWireLimits.displayNameCodeUnits),
    machineKind: MachineKindSchema,
    state: DoctorComponentStateSchema,
  })
  .strict()
export type DoctorProjectLocationStatus = z.infer<
  typeof DoctorProjectLocationStatusSchema
>

export const DoctorProjectStatusSchema = z
  .object({
    projectId: ProjectIdSchema,
    name: z
      .string()
      .trim()
      .min(1)
      .max(onboardingWireLimits.displayNameCodeUnits),
    state: DoctorComponentStateSchema,
    locations: z
      .array(DoctorProjectLocationStatusSchema)
      .max(onboardingWireLimits.projectLocations),
  })
  .strict()
  .superRefine((project, context) => {
    const hasReadyLocation = project.locations.some(
      (location) => location.state === 'ready',
    )
    if ((project.state === 'ready') !== hasReadyLocation) {
      context.addIssue({
        code: 'custom',
        message: 'Doctor Project readiness requires a ready ProjectLocation',
        path: ['state'],
      })
    }
  })
export type DoctorProjectStatus = z.infer<typeof DoctorProjectStatusSchema>

export const DoctorRelayStatusSchema = z
  .object({
    state: DoctorComponentStateSchema,
    connectionState: RelayConnectionStateSchema,
    enrollment: RelayEnrollmentStateSchema,
    nodePresence: RelayNodePresenceSchema,
    internetExecutionEnabled: z.boolean(),
    failure: CanonicalFailureSchema.optional(),
  })
  .strict()
  .superRefine((relay, context) => {
    const executionReady =
      relay.state === 'ready' &&
      relay.connectionState === 'connected' &&
      relay.enrollment === 'enrolled' &&
      relay.nodePresence === 'online'
    if (relay.internetExecutionEnabled !== executionReady) {
      context.addIssue({
        code: 'custom',
        message:
          'Doctor Internet execution requires connected, enrolled, authorized Relay readiness',
        path: ['internetExecutionEnabled'],
      })
    }
  })
export type DoctorRelayStatus = z.infer<typeof DoctorRelayStatusSchema>

export const DoctorRemoteComputerSchema = z
  .object({
    machineId: MachineIdSchema,
    displayName: z
      .string()
      .trim()
      .min(1)
      .max(onboardingWireLimits.displayNameCodeUnits),
    platform: z
      .string()
      .trim()
      .min(1)
      .max(onboardingWireLimits.platformCodeUnits),
    architecture: z
      .string()
      .trim()
      .min(1)
      .max(onboardingWireLimits.platformCodeUnits),
    state: DoctorComponentStateSchema,
    trust: z.literal('trusted'),
    connectionState: MachineConnectionStateSchema.exclude(['local']),
    executionTransport: MachineExecutionTransportSchema.optional(),
    providerFreshness: ProviderLifecycleFreshnessSchema,
    observedAt: TimestampSchema.optional(),
    providers: z
      .array(DoctorProviderStatusSchema)
      .max(onboardingWireLimits.providers),
    relay: DoctorRelayStatusSchema,
  })
  .strict()
  .superRefine((machine, context) => {
    if (
      machine.state === 'ready' &&
      (machine.connectionState !== 'online' ||
        !machine.providers.some((provider) => provider.state === 'ready'))
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Ready remote computer requires current connectivity and a ready Provider',
        path: ['state'],
      })
    }
    if (
      machine.state === 'limited' &&
      (machine.connectionState !== 'online' ||
        machine.providers.some((provider) => provider.state === 'ready') ||
        !machine.providers.some((provider) => provider.state === 'limited'))
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Limited remote computer requires current connectivity and a limited Provider path',
        path: ['state'],
      })
    }
    if (machine.state === 'offline' && machine.connectionState === 'online') {
      context.addIssue({
        code: 'custom',
        message: 'Online remote computer cannot be presented as offline',
        path: ['state'],
      })
    }
  })
export type DoctorRemoteComputer = z.infer<typeof DoctorRemoteComputerSchema>

export const DoctorReportSchema = z
  .object({
    generatedAt: TimestampSchema,
    overall: DoctorComponentStateSchema,
    thisComputer: DoctorThisComputerSchema,
    providers: z
      .array(DoctorProviderStatusSchema)
      .length(onboardingWireLimits.providers),
    project: DoctorProjectStatusSchema.optional(),
    remoteComputers: z
      .array(DoctorRemoteComputerSchema)
      .max(onboardingWireLimits.remoteComputers),
  })
  .strict()
  .superRefine((report, context) => {
    const providerIds = new Set(
      report.providers.map(({ provider }) => provider),
    )
    if (providerIds.size !== report.providers.length) {
      context.addIssue({
        code: 'custom',
        message: 'Doctor Provider identities must be unique',
        path: ['providers'],
      })
    }
    const machineIds = new Set<string>()
    for (const [index, machine] of report.remoteComputers.entries()) {
      if (
        machine.machineId === report.thisComputer.machineId ||
        machineIds.has(machine.machineId)
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Doctor Machine identities must be unique',
          path: ['remoteComputers', index, 'machineId'],
        })
      }
      machineIds.add(machine.machineId)
      const remoteProviderIds = new Set(
        machine.providers.map(({ provider }) => provider),
      )
      if (remoteProviderIds.size !== machine.providers.length) {
        context.addIssue({
          code: 'custom',
          message: 'Remote Doctor Provider identities must be unique',
          path: ['remoteComputers', index, 'providers'],
        })
      }
    }
    if (report.overall === 'ready') {
      if (report.thisComputer.state !== 'ready') {
        context.addIssue({
          code: 'custom',
          message: 'Doctor Ready requires healthy local durable Host state',
          path: ['overall'],
        })
      }
      const hasReadyPath =
        report.project?.locations.some((location) => {
          if (location.state !== 'ready') return false
          const providers =
            location.machineId === report.thisComputer.machineId
              ? report.providers
              : (report.remoteComputers.find(
                  (machine) => machine.machineId === location.machineId,
                )?.providers ?? [])
          return providers.some((provider) => provider.state === 'ready')
        }) === true
      if (!hasReadyPath) {
        context.addIssue({
          code: 'custom',
          message:
            'Doctor Ready requires one same-Machine Project and Provider execution path',
          path: ['overall'],
        })
      }
    }
  })
export type DoctorReport = z.infer<typeof DoctorReportSchema>

export const GetDoctorQuerySchema = z
  .object({
    projectId: ProjectIdSchema.optional(),
    check: z.literal('true').optional(),
  })
  .strict()
export type GetDoctorQuery = z.infer<typeof GetDoctorQuerySchema>

export const GetDoctorResponseSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    doctor: DoctorReportSchema,
  })
  .strict()
export type GetDoctorResponse = z.infer<typeof GetDoctorResponseSchema>
