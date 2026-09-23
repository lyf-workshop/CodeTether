import {
  calculateJwkThumbprint,
  compactVerify,
  importJWK,
  type JWK,
} from 'jose'
import { z } from 'zod'
import {
  enrollmentChallengeIdSchema,
  hostAuthorizationIdSchema,
  hostClaimIdSchema,
  hostIdSchema,
  productDeviceIdSchema,
  spaceIdSchema,
  userIdSchema,
} from '../domain/ids.js'
import { productDevicePublicJwkSchema } from './product-device-protocol.js'
import { fingerprintSchema } from '../domain/models.js'

export const HOST_KEY_ALGORITHM = 'ES256' as const
export const HOST_PROTOCOL_VERSION = 1 as const
export const HOST_PROOF_VERSION = 1 as const
export const HOST_AUDIENCE = 'codetether-control-plane-host' as const
export const HOST_REGISTRATION_PROOF_TYPE =
  'codetether-host-registration+jws' as const
export const HOST_CLAIM_PROOF_TYPE = 'codetether-host-claim+jws' as const
export const HOST_DEVICE_AUTHORIZATION_PROOF_TYPE =
  'codetether-host-device-authorization+jws' as const

const nonceSchema = z.string().regex(/^[A-Za-z0-9_-]{22,86}$/)
const safeText = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((v) => v === v.trim() && !/\p{Cc}/u.test(v))

export const hostRegistrationChallengePayloadSchema = z
  .object({
    v: z.literal(HOST_PROOF_VERSION),
    aud: z.literal(HOST_AUDIENCE),
    purpose: z.literal('host_registration'),
    challengeId: enrollmentChallengeIdSchema,
    hostId: hostIdSchema,
    publicKeyFingerprint: fingerprintSchema,
    keyAlgorithm: z.literal(HOST_KEY_ALGORITHM),
    safeLabel: safeText(120),
    coarsePlatform: z.enum(['windows', 'macos', 'linux', 'unknown']),
    protocolVersionMin: z.number().int().positive(),
    protocolVersionMax: z.number().int().positive(),
    nonce: nonceSchema,
    iat: z.number().int().nonnegative(),
    exp: z.number().int().positive(),
  })
  .strict()
  .refine(({ exp, iat }) => exp > iat)
export type HostRegistrationChallengePayload = z.infer<
  typeof hostRegistrationChallengePayloadSchema
>

export const hostClaimConfirmationPayloadSchema = z
  .object({
    v: z.literal(HOST_PROOF_VERSION),
    aud: z.literal(HOST_AUDIENCE),
    purpose: z.literal('host_claim_confirmation'),
    claimId: hostClaimIdSchema,
    challengeId: enrollmentChallengeIdSchema,
    hostId: hostIdSchema,
    hostFingerprint: fingerprintSchema,
    claimGeneration: z.number().int().nonnegative(),
    spaceId: spaceIdSchema,
    userId: userIdSchema,
    deviceId: productDeviceIdSchema,
    nonce: nonceSchema,
    iat: z.number().int().nonnegative(),
    exp: z.number().int().positive(),
  })
  .strict()
  .refine(({ exp, iat }) => exp > iat)
export type HostClaimConfirmationPayload = z.infer<
  typeof hostClaimConfirmationPayloadSchema
>

export const hostDeviceAuthorizationPayloadSchema = z
  .object({
    v: z.literal(HOST_PROOF_VERSION),
    aud: z.literal(HOST_AUDIENCE),
    purpose: z.literal('host_device_authorization'),
    authorizationId: hostAuthorizationIdSchema,
    challengeId: enrollmentChallengeIdSchema,
    hostId: hostIdSchema,
    hostFingerprint: fingerprintSchema,
    hostIdentityGeneration: z.number().int().nonnegative(),
    spaceId: spaceIdSchema,
    userId: userIdSchema,
    deviceId: productDeviceIdSchema,
    deviceKeyGeneration: z.number().int().nonnegative(),
    deviceFingerprint: fingerprintSchema,
    scope: z.literal('supervisor_read'),
    nonce: nonceSchema,
    iat: z.number().int().nonnegative(),
    exp: z.number().int().positive(),
    authorizationExpiresAt: z.number().int().positive(),
  })
  .strict()
  .refine(({ authorizationExpiresAt, exp, iat }) => {
    return exp > iat && authorizationExpiresAt > exp
  })
export type HostDeviceAuthorizationPayload = z.infer<
  typeof hostDeviceAuthorizationPayloadSchema
>

function canonicalJsonBytes(
  value: Record<string, string | number>,
): Uint8Array {
  const ordered: Record<string, string | number> = {}
  for (const key of Object.keys(value).sort()) ordered[key] = value[key]!
  return Buffer.from(JSON.stringify(ordered))
}

export function hostPublicJwkSchema() {
  return productDevicePublicJwkSchema
}

export async function admitHostPublicJwk(untrusted: unknown): Promise<{
  readonly publicJwk: z.infer<typeof productDevicePublicJwkSchema>
  readonly canonicalPublicJwk: string
  readonly fingerprint: string
}> {
  const publicJwk = productDevicePublicJwkSchema.parse(untrusted)
  await importJWK(publicJwk as JWK, HOST_KEY_ALGORITHM)
  const thumbprint = await calculateJwkThumbprint(publicJwk as JWK, 'sha256')
  return {
    publicJwk,
    canonicalPublicJwk: JSON.stringify({
      crv: publicJwk.crv,
      kty: publicJwk.kty,
      x: publicJwk.x,
      y: publicJwk.y,
    }),
    fingerprint: fingerprintSchema.parse(`sha256:${thumbprint}`),
  }
}

export function encodeHostRegistrationChallengePayload(
  untrusted: HostRegistrationChallengePayload,
): Uint8Array {
  const p = hostRegistrationChallengePayloadSchema.parse(untrusted)
  return canonicalJsonBytes({
    aud: p.aud,
    coarsePlatform: p.coarsePlatform,
    exp: p.exp,
    hostId: p.hostId,
    iat: p.iat,
    keyAlgorithm: p.keyAlgorithm,
    nonce: p.nonce,
    protocolVersionMax: p.protocolVersionMax,
    protocolVersionMin: p.protocolVersionMin,
    publicKeyFingerprint: p.publicKeyFingerprint,
    purpose: p.purpose,
    safeLabel: p.safeLabel,
    v: p.v,
    challengeId: p.challengeId,
  })
}

export function encodeHostClaimConfirmationPayload(
  untrusted: HostClaimConfirmationPayload,
): Uint8Array {
  const p = hostClaimConfirmationPayloadSchema.parse(untrusted)
  return canonicalJsonBytes({
    aud: p.aud,
    challengeId: p.challengeId,
    claimId: p.claimId,
    deviceId: p.deviceId,
    exp: p.exp,
    hostFingerprint: p.hostFingerprint,
    hostId: p.hostId,
    iat: p.iat,
    nonce: p.nonce,
    purpose: p.purpose,
    spaceId: p.spaceId,
    userId: p.userId,
    claimGeneration: p.claimGeneration,
    v: p.v,
  })
}

export function encodeHostDeviceAuthorizationPayload(
  untrusted: HostDeviceAuthorizationPayload,
): Uint8Array {
  const p = hostDeviceAuthorizationPayloadSchema.parse(untrusted)
  return canonicalJsonBytes({
    aud: p.aud,
    authorizationExpiresAt: p.authorizationExpiresAt,
    authorizationId: p.authorizationId,
    challengeId: p.challengeId,
    deviceFingerprint: p.deviceFingerprint,
    deviceId: p.deviceId,
    deviceKeyGeneration: p.deviceKeyGeneration,
    exp: p.exp,
    hostFingerprint: p.hostFingerprint,
    hostId: p.hostId,
    hostIdentityGeneration: p.hostIdentityGeneration,
    iat: p.iat,
    nonce: p.nonce,
    purpose: p.purpose,
    scope: p.scope,
    spaceId: p.spaceId,
    userId: p.userId,
    v: p.v,
  })
}

async function verify(
  compact: string,
  publicJwk: z.infer<typeof productDevicePublicJwkSchema>,
  type: string,
  payload: Uint8Array,
): Promise<void> {
  const segments = compact.split('.')
  if (
    segments.length !== 3 ||
    segments.some(
      (s) =>
        !/^[A-Za-z0-9_-]+$/.test(s) ||
        Buffer.from(s, 'base64url').toString('base64url') !== s,
    )
  )
    throw new Error('Invalid host proof')
  const verified = await compactVerify(
    compact,
    await importJWK(publicJwk as JWK, HOST_KEY_ALGORITHM),
    { algorithms: [HOST_KEY_ALGORITHM] },
  )
  if (
    verified.protectedHeader.alg !== HOST_KEY_ALGORITHM ||
    verified.protectedHeader.typ !== type ||
    Object.keys(verified.protectedHeader).some(
      (k) => k !== 'alg' && k !== 'typ',
    ) ||
    !Buffer.from(verified.payload).equals(payload)
  )
    throw new Error('Host proof envelope mismatch')
}

export async function verifyHostRegistrationProof(
  compact: string,
  publicJwk: z.infer<typeof productDevicePublicJwkSchema>,
  payload: HostRegistrationChallengePayload,
): Promise<void> {
  await verify(
    compact,
    publicJwk,
    HOST_REGISTRATION_PROOF_TYPE,
    encodeHostRegistrationChallengePayload(payload),
  )
}
export async function verifyHostClaimConfirmationProof(
  compact: string,
  publicJwk: z.infer<typeof productDevicePublicJwkSchema>,
  payload: HostClaimConfirmationPayload,
): Promise<void> {
  await verify(
    compact,
    publicJwk,
    HOST_CLAIM_PROOF_TYPE,
    encodeHostClaimConfirmationPayload(payload),
  )
}

export async function verifyHostDeviceAuthorizationProof(
  compact: string,
  publicJwk: z.infer<typeof productDevicePublicJwkSchema>,
  payload: HostDeviceAuthorizationPayload,
): Promise<void> {
  await verify(
    compact,
    publicJwk,
    HOST_DEVICE_AUTHORIZATION_PROOF_TYPE,
    encodeHostDeviceAuthorizationPayload(payload),
  )
}
