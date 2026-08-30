import { z } from 'zod'

import { MachineIdSchema, ProjectIdSchema, TimestampSchema } from './ids.js'

export const MachineKindSchema = z.literal('local')
export type MachineKind = z.infer<typeof MachineKindSchema>

export const MachineAvailabilitySchema = z.enum(['available', 'unavailable'])
export type MachineAvailability = z.infer<typeof MachineAvailabilitySchema>

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
    isLocal: z.literal(true),
    createdAt: TimestampSchema,
    lastSeenAt: TimestampSchema.optional(),
    capabilities: MachineCapabilitiesSchema,
  })
  .strict()
export type MachineSummary = z.infer<typeof MachineSummarySchema>

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
  projectLocations: 64,
  providers: 16,
  projects: 1000,
  recentConversations: 100,
} as const
