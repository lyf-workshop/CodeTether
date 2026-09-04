import { z } from 'zod'

import {
  MachineIdSchema,
  MachinePairingAttemptIdSchema,
  ProjectIdSchema,
  TimestampSchema,
} from './ids.js'

export const MachineKindSchema = z.enum(['local', 'remote'])
export type MachineKind = z.infer<typeof MachineKindSchema>

export const MachineAvailabilitySchema = z.enum(['available', 'unavailable'])
export type MachineAvailability = z.infer<typeof MachineAvailabilitySchema>

export const MachineConnectionStateSchema = z.enum([
  'local',
  'connecting',
  'online',
  'offline',
  'recovery_required',
  'authentication_failed',
  'incompatible',
])
export type MachineConnectionState = z.infer<
  typeof MachineConnectionStateSchema
>

export const MachineTrustStateSchema = z.enum(['local', 'trusted'])
export type MachineTrustState = z.infer<typeof MachineTrustStateSchema>

/** Product-level capabilities of one execution Machine. */
export const MachineCapabilitiesSchema = z
  .object({
    projectAccess: z.boolean(),
    providerExecution: z.boolean(),
    backgroundRuntime: z.boolean(),
    nativeFolderPicker: z.boolean(),
    notifications: z.boolean(),
  })
  .strict()
export type MachineCapabilities = z.infer<typeof MachineCapabilitiesSchema>

/** Public execution identity. Hardware fingerprints and process IDs stay private. */
export const MachineSummarySchema = z
  .object({
    machineId: MachineIdSchema,
    displayName: z.string().trim().min(1).max(240),
    kind: MachineKindSchema,
    platform: z.string().trim().min(1).max(120),
    architecture: z.string().trim().min(1).max(120),
    availability: MachineAvailabilitySchema,
    connectionState: MachineConnectionStateSchema,
    trustState: MachineTrustStateSchema,
    isLocal: z.boolean(),
    createdAt: TimestampSchema,
    lastSeenAt: TimestampSchema.optional(),
    capabilities: MachineCapabilitiesSchema,
  })
  .strict()
  .superRefine((machine, context) => {
    const local = machine.kind === 'local'
    if (machine.isLocal !== local) {
      context.addIssue({
        code: 'custom',
        message: 'Machine kind and isLocal must agree',
        path: ['isLocal'],
      })
    }
    if (
      local
        ? machine.connectionState !== 'local' ||
          machine.trustState !== 'local' ||
          machine.availability !== 'available'
        : machine.connectionState === 'local' ||
          machine.trustState !== 'trusted'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Machine lifecycle metadata does not match its kind',
        path: ['connectionState'],
      })
    }
  })
export type MachineSummary = z.infer<typeof MachineSummarySchema>

export const RemoteMachineAddressSchema = z
  .object({
    host: z
      .string()
      .trim()
      .min(1)
      .max(253)
      .refine(
        (value) =>
          !/[\s\0/@\\]/u.test(value) &&
          !value.includes('://') &&
          value !== '.' &&
          value !== '..',
        'Remote Machine host must be a hostname or IP address',
      )
      .refine((value) => {
        const starts = value.startsWith('[')
        const ends = value.endsWith(']')
        if (starts !== ends || value.includes('%')) return false
        if (starts && value.indexOf(']') !== value.length - 1) return false
        const host = (starts ? value.slice(1, -1) : value).toLowerCase()
        return !/^fe[89ab][0-9a-f]:/u.test(host)
      }, 'IPv6 brackets must be balanced and link-local scopes are unsupported'),
    port: z.number().int().min(1).max(65_535),
  })
  .strict()
export type RemoteMachineAddress = z.infer<typeof RemoteMachineAddressSchema>

export const MachineExecutionTransportSchema = z.enum([
  'direct',
  'relay',
  'unavailable',
])
export type MachineExecutionTransport = z.infer<
  typeof MachineExecutionTransportSchema
>

/** Presentation-safe connection state; private trust and endpoint history stay Host-owned. */
export const RemoteMachineConnectionSchema = z
  .object({
    state: MachineConnectionStateSchema.exclude(['local']),
    /** Current direct-path truth, kept separate from effective availability. */
    directState: MachineConnectionStateSchema.exclude(['local']).optional(),
    /** Host-selected execution path; never a user-controlled per-Turn switch. */
    executionTransport: MachineExecutionTransportSchema.optional(),
    currentEndpoint: RemoteMachineAddressSchema.optional(),
    lastSuccessfulAt: TimestampSchema.optional(),
    lastAttemptAt: TimestampSchema.optional(),
  })
  .strict()
  .superRefine((connection, context) => {
    if (
      connection.state === 'online' &&
      connection.executionTransport !== 'relay' &&
      connection.currentEndpoint === undefined
    ) {
      context.addIssue({
        code: 'custom',
        message: 'An online remote Machine must have an authenticated endpoint',
        path: ['currentEndpoint'],
      })
    }
    if (
      connection.executionTransport === 'relay' &&
      connection.state !== 'online'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Relay execution transport requires an online effective state',
        path: ['executionTransport'],
      })
    }
    if (
      connection.executionTransport === 'unavailable' &&
      connection.state === 'online'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'An online Machine must have an available execution transport',
        path: ['executionTransport'],
      })
    }
  })
export type RemoteMachineConnection = z.infer<
  typeof RemoteMachineConnectionSchema
>

/**
 * Freshness of the presentation-safe Provider snapshot for a remote Machine.
 * Provider descriptors remain separate canonical data; this metadata only
 * states whether they were authenticated on the current connection or are a
 * durable last-known observation.
 */
export const MachineProviderDiscoveryStateSchema = z.enum([
  'not_observed',
  'current',
  'last_known',
])
export type MachineProviderDiscoveryState = z.infer<
  typeof MachineProviderDiscoveryStateSchema
>

export const MachineProviderDiscoverySchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('not_observed') }).strict(),
  z
    .object({
      state: z.literal('current'),
      observedAt: TimestampSchema,
    })
    .strict(),
  z
    .object({
      state: z.literal('last_known'),
      observedAt: TimestampSchema,
    })
    .strict(),
])
export type MachineProviderDiscovery = z.infer<
  typeof MachineProviderDiscoverySchema
>

export const RemoteMachinePairingCodeSchema = z
  .string()
  .trim()
  .max(16)
  .transform((value) => value.replace(/[\s-]/gu, ''))
  .pipe(z.string().regex(/^\d{6}$/u))
export type RemoteMachinePairingCode = z.infer<
  typeof RemoteMachinePairingCodeSchema
>

/** Presentation-safe preview of an untrusted Node awaiting confirmation. */
export const RemoteMachinePairingCandidateSchema = z
  .object({
    pairingAttemptId: MachinePairingAttemptIdSchema,
    machineId: MachineIdSchema,
    displayName: z.string().trim().min(1).max(240),
    platform: z.string().trim().min(1).max(120),
    architecture: z.string().trim().min(1).max(120),
    address: RemoteMachineAddressSchema,
    protocolVersion: z.number().int().positive().safe(),
    expiresAt: TimestampSchema,
    verificationCode: z.string().regex(/^\d{3} \d{3}$/u),
  })
  .strict()
export type RemoteMachinePairingCandidate = z.infer<
  typeof RemoteMachinePairingCandidateSchema
>

/** One authorized Project checkout on one execution Machine. */
export const ProjectLocationSchema = z
  .object({
    projectId: ProjectIdSchema,
    machineId: MachineIdSchema,
    rootPath: z.string().trim().min(1).max(4096),
    availability: MachineAvailabilitySchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict()
export type ProjectLocation = z.infer<typeof ProjectLocationSchema>

export const machineWireLimits = {
  machines: 64,
  rememberedEndpoints: 8,
  pairingAttempts: 8,
  projectLocations: 64,
  providers: 16,
  projects: 1000,
  recentConversations: 100,
} as const
