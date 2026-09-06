import { z } from 'zod'

import {
  ActionIdSchema,
  ConversationIdSchema,
  MachineIdSchema,
  ProtocolVersionSchema,
  TimestampSchema,
} from './ids.js'
import { ProviderIdSchema } from './providers.js'
import { ConversationRecordSchema } from './records.js'

export const providerSessionDiscoveryLimits = {
  defaultPageSize: 50,
  maximumPageSize: 100,
  maximumProviders: 2,
  maximumTitleCodeUnits: 240,
  maximumCursorCodeUnits: 512,
} as const

/** Short-lived Host-owned reference. It is never a Provider native session id. */
export const DiscoveryCandidateIdSchema = z
  .string()
  .regex(/^candidate_[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/)
  .brand<'DiscoveryCandidateId'>()
export type DiscoveryCandidateId = z.infer<typeof DiscoveryCandidateIdSchema>

export const ProviderSessionDiscoveryCursorSchema = z
  .string()
  .min(1)
  .max(providerSessionDiscoveryLimits.maximumCursorCodeUnits)
  .brand<'ProviderSessionDiscoveryCursor'>()
export type ProviderSessionDiscoveryCursor = z.infer<
  typeof ProviderSessionDiscoveryCursorSchema
>

export const NativeSessionDiscoveryStatusSchema = z.enum([
  'supported',
  'unsupported',
  'unavailable',
])
export type NativeSessionDiscoveryStatus = z.infer<
  typeof NativeSessionDiscoveryStatusSchema
>

export const NativeSessionResumeStatusSchema = z.enum([
  'supported',
  'unsupported',
  'unavailable',
])
export type NativeSessionResumeStatus = z.infer<
  typeof NativeSessionResumeStatusSchema
>

export const HistoricalTranscriptAvailabilitySchema = z.enum([
  'supported',
  'unsupported',
  'unavailable',
])
export type HistoricalTranscriptAvailability = z.infer<
  typeof HistoricalTranscriptAvailabilitySchema
>

export const ProviderSessionDiscoveryFailureReasonSchema = z.enum([
  'provider_session_discovery_unavailable',
  'provider_session_format_unsupported',
  'provider_session_store_unreadable',
  'machine_offline',
])
export type ProviderSessionDiscoveryFailureReason = z.infer<
  typeof ProviderSessionDiscoveryFailureReasonSchema
>

export const ProviderSessionDiscoveryCandidateSchema = z
  .object({
    discoveryCandidateId: DiscoveryCandidateIdSchema,
    provider: ProviderIdSchema,
    machineId: MachineIdSchema,
    title: z
      .string()
      .trim()
      .min(1)
      .max(providerSessionDiscoveryLimits.maximumTitleCodeUnits),
    createdAt: TimestampSchema.optional(),
    lastActiveAt: TimestampSchema.optional(),
    resumeStatus: NativeSessionResumeStatusSchema,
    historicalTranscript: HistoricalTranscriptAvailabilitySchema,
    alreadyAdopted: z.boolean(),
    conversationId: ConversationIdSchema.optional(),
  })
  .strict()
  .superRefine((candidate, context) => {
    if (candidate.alreadyAdopted !== (candidate.conversationId !== undefined)) {
      context.addIssue({
        code: 'custom',
        message:
          'Already-adopted candidates must identify their CodeTether Conversation',
        path: ['conversationId'],
      })
    }
  })
export type ProviderSessionDiscoveryCandidate = z.infer<
  typeof ProviderSessionDiscoveryCandidateSchema
>

export const ProviderSessionDiscoveryProviderResultSchema = z
  .object({
    provider: ProviderIdSchema,
    status: NativeSessionDiscoveryStatusSchema,
    resumeStatus: NativeSessionResumeStatusSchema,
    providerVersion: z.string().trim().min(1).max(120).optional(),
    candidateCount: z.number().int().nonnegative().safe(),
    corruptEntriesSkipped: z.number().int().nonnegative().safe(),
    failureReason: ProviderSessionDiscoveryFailureReasonSchema.optional(),
  })
  .strict()
  .superRefine((result, context) => {
    if (
      (result.status === 'supported') ===
      (result.failureReason !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Supported discovery has no failure reason; unavailable discovery requires one',
        path: ['failureReason'],
      })
    }
  })
export type ProviderSessionDiscoveryProviderResult = z.infer<
  typeof ProviderSessionDiscoveryProviderResultSchema
>

export const DiscoverProviderSessionsQuerySchema = z
  .object({
    provider: ProviderIdSchema.optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(providerSessionDiscoveryLimits.maximumPageSize)
      .default(providerSessionDiscoveryLimits.defaultPageSize),
    cursor: ProviderSessionDiscoveryCursorSchema.optional(),
    rescan: z
      .union([
        z.boolean(),
        z.enum(['true', 'false']).transform((value) => value === 'true'),
      ])
      .default(false),
  })
  .strict()
export type DiscoverProviderSessionsQueryInput = z.input<
  typeof DiscoverProviderSessionsQuerySchema
>
export type DiscoverProviderSessionsQuery = z.output<
  typeof DiscoverProviderSessionsQuerySchema
>

export const DiscoverProviderSessionsResponseSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    candidates: z
      .array(ProviderSessionDiscoveryCandidateSchema)
      .max(providerSessionDiscoveryLimits.maximumPageSize),
    providers: z
      .array(ProviderSessionDiscoveryProviderResultSchema)
      .min(1)
      .max(providerSessionDiscoveryLimits.maximumProviders),
    nextCursor: ProviderSessionDiscoveryCursorSchema.optional(),
  })
  .strict()
  .superRefine((response, context) => {
    const providers = new Set(response.providers.map((entry) => entry.provider))
    const candidateIds = new Set<string>()
    for (const [index, candidate] of response.candidates.entries()) {
      if (!providers.has(candidate.provider)) {
        context.addIssue({
          code: 'custom',
          message: 'Every candidate requires a corresponding Provider result',
          path: ['candidates', index, 'provider'],
        })
      }
      if (candidateIds.has(candidate.discoveryCandidateId)) {
        context.addIssue({
          code: 'custom',
          message: 'Discovery candidate identities must be unique',
          path: ['candidates', index, 'discoveryCandidateId'],
        })
      }
      candidateIds.add(candidate.discoveryCandidateId)
    }
  })
export type DiscoverProviderSessionsResponse = z.infer<
  typeof DiscoverProviderSessionsResponseSchema
>

export const AdoptProviderSessionRequestSchema = z
  .object({
    actionId: ActionIdSchema,
    discoveryCandidateId: DiscoveryCandidateIdSchema,
  })
  .strict()
export type AdoptProviderSessionRequest = z.infer<
  typeof AdoptProviderSessionRequestSchema
>

export const AdoptProviderSessionResponseSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    actionId: ActionIdSchema,
    status: z.enum(['accepted', 'completed', 'rejected']),
    data: z
      .object({
        conversation: ConversationRecordSchema,
        disposition: z.enum(['adopted', 'already_adopted']),
      })
      .strict(),
  })
  .strict()
export type AdoptProviderSessionResponse = z.infer<
  typeof AdoptProviderSessionResponseSchema
>
