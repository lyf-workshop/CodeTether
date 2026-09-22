import { z } from 'zod'
import {
  deviceSessionBindingIdSchema,
  enrollmentChallengeIdSchema,
  hostAuthorizationIdSchema,
  hostClaimIdSchema,
  hostIdSchema,
  productDeviceIdSchema,
  rendezvousBindingIdSchema,
  securityEventIdSchema,
  spaceIdSchema,
  userIdSchema,
} from './ids.js'

const safeLabelSchema = z.string().trim().min(1).max(120)
const safeVersionSchema = z.string().trim().min(1).max(64)
export const fingerprintSchema = z
  .string()
  .regex(/^sha256:[A-Za-z0-9_-]{32,128}$/)
export const publicKeySchema = z.string().min(32).max(8192)
export const keyAlgorithmSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{1,63}$/)

export const createUserWithPersonalSpaceSchema = z.object({
  userId: userIdSchema,
  status: z.enum(['active', 'suspended', 'deletion_pending']),
  displayName: safeLabelSchema.nullable(),
  spaceId: spaceIdSchema,
  spaceName: safeLabelSchema,
  now: z.date(),
})
export type CreateUserWithPersonalSpace = z.infer<
  typeof createUserWithPersonalSpaceSchema
>

export const createProductDeviceSchema = z.object({
  deviceId: productDeviceIdSchema,
  ownerUserId: userIdSchema,
  deviceType: z.enum(['desktop_host', 'desktop_client', 'mobile', 'tablet']),
  publicKey: publicKeySchema,
  keyAlgorithm: keyAlgorithmSchema,
  fingerprint: fingerprintSchema,
  label: safeLabelSchema,
  platform: z.string().trim().min(1).max(64),
  appVersion: safeVersionSchema,
  protocolVersion: z.number().int().positive(),
  keyGeneration: z.number().int().nonnegative(),
  createdAt: z.date(),
})
export type CreateProductDevice = z.infer<typeof createProductDeviceSchema>

export const createHostSchema = z
  .object({
    hostId: hostIdSchema,
    owningSpaceId: spaceIdSchema.nullable(),
    publicKey: publicKeySchema,
    keyAlgorithm: keyAlgorithmSchema,
    fingerprint: fingerprintSchema,
    safeLabel: safeLabelSchema,
    coarsePlatform: z.enum(['windows', 'macos', 'linux', 'unknown']),
    protocolVersionMin: z.number().int().positive(),
    protocolVersionMax: z.number().int().positive(),
    claimGeneration: z.number().int().nonnegative(),
    claimState: z.enum([
      'unclaimed',
      'pending',
      'claimed',
      'unlinked',
      'revoked',
    ]),
    createdAt: z.date(),
  })
  .refine(
    ({ protocolVersionMax, protocolVersionMin }) =>
      protocolVersionMax >= protocolVersionMin,
    { message: 'protocolVersionMax must not precede protocolVersionMin' },
  )
export type CreateHost = z.infer<typeof createHostSchema>

export const createEnrollmentChallengeSchema = z
  .object({
    challengeId: enrollmentChallengeIdSchema,
    purpose: z.enum(['device_registration', 'host_claim']),
    targetUserId: userIdSchema,
    targetSpaceId: spaceIdSchema.nullable(),
    targetDeviceId: productDeviceIdSchema.nullable(),
    targetHostId: hostIdSchema.nullable(),
    nonceHash: fingerprintSchema,
    createdAt: z.date(),
    expiresAt: z.date(),
  })
  .superRefine((value, context) => {
    if (value.expiresAt <= value.createdAt) {
      context.addIssue({
        code: 'custom',
        message: 'Challenge expiry must follow creation',
      })
    }
    if (
      value.purpose === 'host_claim' &&
      (!value.targetSpaceId || !value.targetDeviceId || !value.targetHostId)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Host claim challenges require exact space, device, and host',
      })
    }
    if (
      value.purpose === 'device_registration' &&
      (value.targetSpaceId || value.targetHostId)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Device registration challenges cannot target a space or host',
      })
    }
  })
export type CreateEnrollmentChallenge = z.infer<
  typeof createEnrollmentChallengeSchema
>

export const createHostClaimSchema = z.object({
  claimId: hostClaimIdSchema,
  hostId: hostIdSchema,
  spaceId: spaceIdSchema,
  requestingUserId: userIdSchema,
  requestingDeviceId: productDeviceIdSchema,
  claimGeneration: z.number().int().nonnegative(),
  challengeId: enrollmentChallengeIdSchema,
  state: z.enum([
    'requested',
    'confirmed',
    'completed',
    'expired',
    'rejected',
    'revoked',
  ]),
  requestedAt: z.date(),
  expiresAt: z.date(),
})
export type CreateHostClaim = z.infer<typeof createHostClaimSchema>

export const createHostRegistrationChallengeSchema = z
  .object({
    challengeId: enrollmentChallengeIdSchema,
    hostId: hostIdSchema,
    publicKey: publicKeySchema,
    keyAlgorithm: z.literal('ES256'),
    fingerprint: fingerprintSchema,
    safeLabel: safeLabelSchema,
    coarsePlatform: z.enum(['windows', 'macos', 'linux', 'unknown']),
    protocolVersionMin: z.number().int().positive(),
    protocolVersionMax: z.number().int().positive(),
    nonceHash: fingerprintSchema,
    createdAt: z.date(),
    expiresAt: z.date(),
  })
  .refine(
    ({ protocolVersionMax, protocolVersionMin }) =>
      protocolVersionMax >= protocolVersionMin,
  )
export type CreateHostRegistrationChallenge = z.infer<
  typeof createHostRegistrationChallengeSchema
>

export const createHostDeviceAuthorizationSchema = z.object({
  authorizationId: hostAuthorizationIdSchema,
  hostId: hostIdSchema,
  claimGeneration: z.number().int().nonnegative(),
  deviceId: productDeviceIdSchema,
  deviceKeyGeneration: z.number().int().nonnegative(),
  deviceFingerprint: fingerprintSchema,
  userId: userIdSchema,
  spaceId: spaceIdSchema,
  scope: z.literal('supervisor_read'),
  authorizationSerial: z.bigint().nonnegative(),
  authorizationGeneration: z.number().int().nonnegative(),
  issuedAt: z.date(),
  expiresAt: z.date(),
})
export type CreateHostDeviceAuthorization = z.infer<
  typeof createHostDeviceAuthorizationSchema
>

export const createDeviceSessionBindingSchema = z.object({
  bindingId: deviceSessionBindingIdSchema,
  externalAuthSessionHash: fingerprintSchema,
  userId: userIdSchema,
  deviceId: productDeviceIdSchema,
  deviceKeyGeneration: z.number().int().nonnegative(),
  bindingGeneration: z.number().int().nonnegative(),
  createdAt: z.date(),
  expiresAt: z.date(),
})
export type CreateDeviceSessionBinding = z.infer<
  typeof createDeviceSessionBindingSchema
>

export const createRendezvousBindingSchema = z.object({
  bindingId: rendezvousBindingIdSchema,
  hostId: hostIdSchema,
  deviceId: productDeviceIdSchema,
  opaqueRelayBindingId: z.string().trim().min(16).max(160),
  bindingRole: z.enum(['host', 'supervisor_device']),
  status: z.enum(['pending', 'active', 'expired', 'revoked']),
  createdAt: z.date(),
  expiresAt: z.date(),
})
export type CreateRendezvousBinding = z.infer<
  typeof createRendezvousBindingSchema
>

export const securityEventTypes = [
  'sign_in',
  'sign_out',
  'device_registered',
  'device_revoked',
  'host_identity_registered',
  'host_claim_requested',
  'host_claim_confirmed',
  'host_claim_completed',
  'host_claim_rejected',
  'host_claim_expired',
  'host_claimed',
  'host_unlinked',
  'host_transfer_requested',
  'host_transferred',
  'supervisor_authorized',
  'supervisor_revoked',
  'replay_rejected',
] as const

export const appendSecurityEventSchema = z
  .object({
    eventId: securityEventIdSchema,
    eventType: z.enum(securityEventTypes),
    actorKind: z.enum(['user', 'device', 'host', 'control_plane']),
    actorId: z.string().trim().min(1).max(128),
    targetKind: z
      .enum(['user', 'space', 'device', 'host', 'authorization', 'session'])
      .nullable(),
    targetId: z.string().trim().min(1).max(128).nullable(),
    outcome: z.enum(['success', 'failure']),
    reasonCode: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,63}$/)
      .nullable(),
    correlationId: z.string().trim().min(8).max(128).nullable(),
    occurredAt: z.date(),
  })
  .refine(
    ({ targetId, targetKind }) => (targetId === null) === (targetKind === null),
    {
      message: 'targetKind and targetId must be present together',
    },
  )
export type AppendSecurityEvent = z.infer<typeof appendSecurityEventSchema>
