import { z } from 'zod'

import {
  supervisorAudience,
  supervisorProofVersion,
  supervisorProtocolVersion,
  supervisorTransportLimits,
} from './constants.js'

const opaqueId = (prefix: string) =>
  z
    .string()
    .regex(new RegExp(`^${prefix}_[A-Za-z0-9][A-Za-z0-9_-]{15,95}$`, 'u'))
const digest = z.string().regex(/^sha256:[A-Za-z0-9_-]{43}$/u)
const base64Url32 = z.string().regex(/^[A-Za-z0-9_-]{43}$/u)
const timestampSeconds = z.number().int().nonnegative()
const safeText = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value === value.trim() && !/\p{Cc}/u.test(value))

export const supervisorPublicJwkSchema = z
  .object({
    kty: z.literal('EC'),
    crv: z.literal('P-256'),
    x: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    y: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  })
  .strict()
export type SupervisorPublicJwk = z.infer<typeof supervisorPublicJwkSchema>

export const supervisorGrantPayloadSchema = z
  .object({
    v: z.literal(supervisorProofVersion),
    aud: z.literal(supervisorAudience),
    purpose: z.literal('host_supervisor_grant'),
    authorizationId: opaqueId('hauth'),
    hostId: opaqueId('host'),
    hostFingerprint: digest,
    hostIdentityGeneration: z.number().int().positive(),
    deviceId: opaqueId('dev'),
    deviceFingerprint: digest,
    deviceKeyGeneration: z.number().int().positive(),
    userId: opaqueId('usr'),
    spaceId: opaqueId('space'),
    scope: z.enum(['supervisor_read', 'supervisor_control']),
    authorizationSerial: z.string().regex(/^(?:0|[1-9][0-9]{0,19})$/u),
    authorizationGeneration: z.number().int().positive(),
    issuedAt: timestampSeconds,
    expiresAt: timestampSeconds,
  })
  .strict()
  .refine(({ expiresAt, issuedAt }) => expiresAt > issuedAt)
export type SupervisorGrantPayload = z.infer<
  typeof supervisorGrantPayloadSchema
>

export const supervisorDirectEndpointSchema = z
  .object({
    host: safeText(supervisorTransportLimits.maximumHostCharacters),
    port: z.number().int().min(1).max(65_535),
  })
  .strict()
export type SupervisorDirectEndpoint = z.infer<
  typeof supervisorDirectEndpointSchema
>

export const supervisorRelayDescriptorSchema = z
  .object({
    endpoint: z.string().url().max(2_048),
    relayId: opaqueId('relay'),
    relayFingerprint: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    rendezvousId: opaqueId('srv'),
    rendezvousCapability: base64Url32,
    hostTransportFingerprint: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  })
  .strict()
export type SupervisorRelayDescriptor = z.infer<
  typeof supervisorRelayDescriptorSchema
>

export const supervisorTransportDescriptorPayloadSchema = z
  .object({
    v: z.literal(supervisorProofVersion),
    aud: z.literal(supervisorAudience),
    purpose: z.literal('host_supervisor_transport'),
    authorizationId: opaqueId('hauth'),
    grantDigest: digest,
    hostId: opaqueId('host'),
    hostFingerprint: digest,
    hostIdentityGeneration: z.number().int().positive(),
    deviceId: opaqueId('dev'),
    deviceKeyGeneration: z.number().int().positive(),
    transportTlsFingerprint: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    controlPlaneOrigin: z.string().url().max(2_048),
    directEndpoints: z
      .array(supervisorDirectEndpointSchema)
      .max(supervisorTransportLimits.maximumEndpoints),
    relay: supervisorRelayDescriptorSchema.nullable(),
    iat: timestampSeconds,
    exp: timestampSeconds,
    protocolVersion: z.literal(supervisorProtocolVersion),
  })
  .strict()
  .refine(({ exp, iat }) => exp > iat)
  .refine(
    ({ directEndpoints, relay }) =>
      directEndpoints.length > 0 || relay !== null,
  )
export type SupervisorTransportDescriptorPayload = z.infer<
  typeof supervisorTransportDescriptorPayloadSchema
>

export const signedSupervisorGrantSchema = z
  .object({
    payload: supervisorGrantPayloadSchema,
    proof: z.string().min(1).max(supervisorTransportLimits.maximumProofBytes),
  })
  .strict()
export type SignedSupervisorGrant = z.infer<typeof signedSupervisorGrantSchema>

export const signedSupervisorTransportDescriptorSchema = z
  .object({
    payload: supervisorTransportDescriptorPayloadSchema,
    proof: z.string().min(1).max(supervisorTransportLimits.maximumProofBytes),
  })
  .strict()
export type SignedSupervisorTransportDescriptor = z.infer<
  typeof signedSupervisorTransportDescriptorSchema
>

export const supervisorChallengeSchema = z
  .object({
    type: z.literal('supervisor.challenge'),
    protocolVersion: z.literal(supervisorProtocolVersion),
    audience: z.literal(supervisorAudience),
    sessionId: opaqueId('ssn'),
    authorizationId: opaqueId('hauth'),
    hostId: opaqueId('host'),
    hostIdentityGeneration: z.number().int().positive(),
    deviceId: opaqueId('dev'),
    deviceKeyGeneration: z.number().int().positive(),
    tlsExporter: base64Url32,
    nonce: base64Url32,
    issuedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict()
export type SupervisorChallenge = z.infer<typeof supervisorChallengeSchema>

export const supervisorClientAuthenticateSchema = z
  .object({
    type: z.literal('supervisor.authenticate'),
    protocolVersion: z.literal(supervisorProtocolVersion),
    accessToken: z
      .string()
      .min(1)
      .max(supervisorTransportLimits.maximumAccessTokenBytes),
    deviceProof: z
      .string()
      .min(1)
      .max(supervisorTransportLimits.maximumProofBytes),
  })
  .strict()
export type SupervisorClientAuthenticate = z.infer<
  typeof supervisorClientAuthenticateSchema
>

export const supervisorAuthenticatedSchema = z
  .object({
    type: z.literal('supervisor.authenticated'),
    protocolVersion: z.literal(supervisorProtocolVersion),
    sessionId: opaqueId('ssn'),
    hostId: opaqueId('host'),
    deviceId: opaqueId('dev'),
    authorizationId: opaqueId('hauth'),
    control: z.enum(['read', 'control']),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict()

const supervisorRequestBaseSchema = z.object({
  type: z.literal('supervisor.request'),
  protocolVersion: z.literal(supervisorProtocolVersion),
  requestId: opaqueId('sreq'),
})

const supervisorDirectoryLimitSchema = z.number().int().min(1).max(100)
const supervisorDirectoryCursorSchema = z
  .string()
  .min(1)
  .max(2_048)
  .regex(/^[A-Za-z0-9_-]+$/u)
const supervisorHistoryCursorSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^history_[A-Za-z0-9_-]+$/u)
const supervisorLiveCursorSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:(?:0|[1-9][0-9]*)$/iu,
  )

const supervisorActionIdSchema = z
  .string()
  .regex(/^act_[A-Za-z0-9][A-Za-z0-9_-]{5,95}$/u)
const supervisorProviderSchema = z.enum(['codex', 'claude-code'])
const supervisorTurnInputSchema = z
  .object({
    type: z.literal('text'),
    text: z
      .string()
      .min(1)
      .max(1024 * 1024)
      .refine((value) => value.trim().length > 0),
  })
  .strict()

export const supervisorRequestSchema = z.discriminatedUnion('operation', [
  supervisorRequestBaseSchema
    .extend({ operation: z.literal('host.bootstrap') })
    .strict(),
  supervisorRequestBaseSchema
    .extend({ operation: z.literal('machine.list') })
    .strict(),
  supervisorRequestBaseSchema
    .extend({
      operation: z.literal('machine.get'),
      machineId: opaqueId('machine'),
    })
    .strict(),
  supervisorRequestBaseSchema
    .extend({
      operation: z.literal('project.list'),
      machineId: opaqueId('machine'),
      limit: supervisorDirectoryLimitSchema,
      cursor: supervisorDirectoryCursorSchema.optional(),
    })
    .strict(),
  supervisorRequestBaseSchema
    .extend({
      operation: z.literal('project.get'),
      machineId: opaqueId('machine'),
      projectId: opaqueId('proj'),
    })
    .strict(),
  supervisorRequestBaseSchema
    .extend({
      operation: z.literal('conversation.list'),
      machineId: opaqueId('machine'),
      projectId: opaqueId('proj'),
      limit: supervisorDirectoryLimitSchema,
      cursor: supervisorDirectoryCursorSchema.optional(),
    })
    .strict(),
  supervisorRequestBaseSchema
    .extend({
      operation: z.literal('conversation.get'),
      machineId: opaqueId('machine'),
      projectId: opaqueId('proj'),
      conversationId: opaqueId('conv'),
    })
    .strict(),
  supervisorRequestBaseSchema
    .extend({
      operation: z.literal('conversation.history'),
      machineId: opaqueId('machine'),
      projectId: opaqueId('proj'),
      conversationId: opaqueId('conv'),
      limit: z.number().int().min(1).max(50),
      cursor: supervisorHistoryCursorSchema.optional(),
    })
    .strict(),
  supervisorRequestBaseSchema
    .extend({
      operation: z.literal('conversation.live.read'),
      machineId: opaqueId('machine'),
      projectId: opaqueId('proj'),
      conversationId: opaqueId('conv'),
      cursor: supervisorLiveCursorSchema,
      limit: z.number().int().min(1).max(64),
      waitMs: z.number().int().min(0).max(15_000),
    })
    .strict(),
  supervisorRequestBaseSchema
    .extend({
      operation: z.literal('action.get'),
      actionId: supervisorActionIdSchema,
    })
    .strict(),
  supervisorRequestBaseSchema
    .extend({
      operation: z.literal('conversation.turn.start'),
      actionId: supervisorActionIdSchema,
      machineId: opaqueId('machine'),
      projectId: opaqueId('proj'),
      conversationId: opaqueId('conv'),
      input: supervisorTurnInputSchema,
    })
    .strict(),
  supervisorRequestBaseSchema
    .extend({
      operation: z.literal('conversation.create'),
      actionId: supervisorActionIdSchema,
      machineId: opaqueId('machine'),
      projectId: opaqueId('proj'),
      provider: supervisorProviderSchema,
      input: supervisorTurnInputSchema,
      model: z.string().trim().min(1).max(240).optional(),
      reasoning: z.string().trim().min(1).max(120).optional(),
    })
    .strict(),
])
export type SupervisorRequest = z.infer<typeof supervisorRequestSchema>

export const supervisorResponseSchema = z
  .object({
    type: z.literal('supervisor.response'),
    protocolVersion: z.literal(supervisorProtocolVersion),
    requestId: opaqueId('sreq'),
    ok: z.boolean(),
    data: z.unknown().optional(),
    code: z
      .enum([
        'invalid_request',
        'operation_not_allowed',
        'not_found',
        'conflict',
        'unavailable',
        'session_expired',
        'internal',
      ])
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.ok === (value.code !== undefined)) {
      context.addIssue({ code: 'custom', message: 'Invalid response outcome' })
    }
  })
export type SupervisorResponse = z.infer<typeof supervisorResponseSchema>

export const supervisorServerHandshakeSchema = z.union([
  supervisorChallengeSchema,
  supervisorAuthenticatedSchema,
  z
    .object({
      type: z.literal('supervisor.rejected'),
      protocolVersion: z.literal(supervisorProtocolVersion),
      code: z.enum([
        'authentication_failed',
        'authorization_revoked',
        'host_identity_mismatch',
        'proof_replayed',
        'proof_expired',
        'control_plane_unavailable',
      ]),
    })
    .strict(),
])
