import { z } from 'zod'

import { ActionIdSchema, ProtocolVersionSchema } from './ids.js'

export const HostErrorCodeSchema = z.enum([
  'invalid_request',
  'not_found',
  'conflict',
  'unsupported',
  'provider_error',
  'provider_conversation_unavailable',
  'project_unavailable',
  'project_has_conversations',
  'conversation_archived',
  'runtime_unavailable',
  'timeout',
  'internal',
])
export type HostErrorCode = z.infer<typeof HostErrorCodeSchema>

/** Safe for clients: intentionally excludes stack traces and provider payloads. */
export const HostErrorSchema = z
  .object({
    code: HostErrorCodeSchema,
    message: z.string().trim().min(1).max(1024),
    details: z
      .record(
        z.string().trim().min(1).max(128),
        z.union([z.string(), z.number(), z.boolean(), z.null()]),
      )
      .optional(),
  })
  .strict()
export type HostError = z.infer<typeof HostErrorSchema>

export const SafeErrorEnvelopeSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    actionId: ActionIdSchema.optional(),
    code: HostErrorCodeSchema,
    message: z.string().trim().min(1).max(1024),
    details: HostErrorSchema.shape.details,
  })
  .strict()
export type SafeErrorEnvelope = z.infer<typeof SafeErrorEnvelopeSchema>
