import { z } from 'zod'

import {
  canonicalFailure,
  canonicalFailureCategories,
  canonicalFailureReasons,
  canonicalFailureRetryabilities,
  canonicalFailureSources,
  canonicalFailureUserActions,
  type CanonicalFailure as CoreCanonicalFailure,
} from '@codetether/agent-core'

import {
  ActionIdSchema,
  ProtocolVersionSchema,
  TimestampSchema,
} from './ids.js'

export const CanonicalFailureCategorySchema = z.enum(canonicalFailureCategories)
export const CanonicalFailureReasonSchema = z.enum(canonicalFailureReasons)
export const CanonicalFailureRetryabilitySchema = z.enum(
  canonicalFailureRetryabilities,
)
export const CanonicalFailureUserActionSchema = z.enum(
  canonicalFailureUserActions,
)
export const CanonicalFailureSourceSchema = z.enum(canonicalFailureSources)

/** Small CodeTether-owned diagnostic metadata; never contains Provider text. */
export const CanonicalFailureSchema: z.ZodType<CoreCanonicalFailure> = z
  .object({
    category: CanonicalFailureCategorySchema,
    reason: CanonicalFailureReasonSchema,
    retryability: CanonicalFailureRetryabilitySchema,
    userAction: CanonicalFailureUserActionSchema,
    source: CanonicalFailureSourceSchema,
    occurredAt: TimestampSchema,
    technicalCode: CanonicalFailureReasonSchema,
  })
  .strict()
  .superRefine((failure, context) => {
    const expected = canonicalFailure(failure.reason, failure.occurredAt)
    for (const field of [
      'category',
      'retryability',
      'userAction',
      'source',
      'technicalCode',
    ] as const) {
      if (failure[field] !== expected[field]) {
        context.addIssue({
          code: 'custom',
          message: `Canonical failure ${field} does not match its reason`,
          path: [field],
        })
      }
    }
  })
export type CanonicalFailure = z.infer<typeof CanonicalFailureSchema>

export const HostErrorCodeSchema = z.enum([
  'invalid_request',
  'not_found',
  'conflict',
  'unsupported',
  'provider_error',
  'provider_not_installed',
  'provider_version_unsupported',
  'provider_start_failed',
  'provider_session_lost',
  'provider_unavailable',
  'provider_conversation_unavailable',
  'project_unavailable',
  'project_has_conversations',
  'project_location_invalid',
  'project_location_missing',
  'project_location_inaccessible',
  'project_location_conflict',
  'project_location_not_found',
  'project_location_has_conversations',
  'project_location_local_required',
  'conversation_archived',
  'machine_pairing_code_invalid',
  'machine_pairing_code_expired',
  'machine_pairing_rate_limited',
  'machine_authentication_failed',
  'machine_identity_mismatch',
  'machine_unreachable',
  'machine_protocol_incompatible',
  'machine_connection_failed',
  'machine_has_project_locations',
  'relay_not_configured',
  'relay_unreachable',
  'relay_authentication_failed',
  'relay_identity_mismatch',
  'relay_protocol_incompatible',
  'relay_revoked',
  'relay_rate_limited',
  'runtime_unavailable',
  'timeout',
  'internal',
])
export type HostErrorCode = z.infer<typeof HostErrorCodeSchema>

export const safeErrorDetailLimits = {
  maxEntries: 32,
  maxKeyCharacters: 128,
  maxStringCharacters: 1_024,
  maxSerializedBytes: 8 * 1_024,
} as const

/**
 * Bounded CodeTether-owned context only. This intentionally uses an allowlist
 * instead of a generic string map: Provider-controlled names or values must
 * never turn `details` into a raw diagnostic side channel.
 */
export const SafeErrorDetailsSchema = z
  .object({
    locationCount: z.number().int().nonnegative().safe().optional(),
    issueCount: z.number().int().nonnegative().safe().optional(),
    maxConversations: z.number().int().positive().safe().optional(),
    maxBytes: z.number().int().positive().safe().optional(),
    actualBytes: z.number().int().nonnegative().safe().optional(),
    runtimeEncodedBytes: z.number().int().nonnegative().safe().optional(),
    exitCode: z.number().int().safe().optional(),
    method: z.literal('turn/start').optional(),
  })
  .strict()
  .superRefine((details, context) => {
    const serializedBytes = new TextEncoder().encode(
      JSON.stringify(details),
    ).byteLength
    if (serializedBytes > safeErrorDetailLimits.maxSerializedBytes) {
      context.addIssue({
        code: 'custom',
        message: 'Safe error details exceed the serialized byte limit',
      })
    }
  })

/** Safe for clients: intentionally excludes stack traces and provider payloads. */
export const HostErrorSchema = z
  .object({
    code: HostErrorCodeSchema,
    message: z.string().trim().min(1).max(1024),
    failure: CanonicalFailureSchema.optional(),
    details: SafeErrorDetailsSchema.optional(),
  })
  .strict()
export type HostError = z.infer<typeof HostErrorSchema>

export const SafeErrorEnvelopeSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    actionId: ActionIdSchema.optional(),
    code: HostErrorCodeSchema,
    message: z.string().trim().min(1).max(1024),
    failure: CanonicalFailureSchema.optional(),
    details: HostErrorSchema.shape.details,
  })
  .strict()
export type SafeErrorEnvelope = z.infer<typeof SafeErrorEnvelopeSchema>
