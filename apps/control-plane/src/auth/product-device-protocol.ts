import { createHash, timingSafeEqual } from 'node:crypto'
import {
  calculateJwkThumbprint,
  compactVerify,
  importJWK,
  type JWK,
} from 'jose'
import { z } from 'zod'
import {
  enrollmentChallengeIdSchema,
  productDeviceIdSchema,
  userIdSchema,
} from '../domain/ids.js'
import { fingerprintSchema } from '../domain/models.js'

export const PRODUCT_DEVICE_KEY_ALGORITHM = 'ES256' as const
export const PRODUCT_DEVICE_PROOF_VERSION = 1 as const
export const PRODUCT_DEVICE_PROTOCOL_VERSION = 1 as const
export const PRODUCT_DEVICE_AUDIENCE = 'codetether-control-plane' as const
export const PRODUCT_DEVICE_PROOF_TYPE = 'codetether-device-proof+jws' as const
export const PRODUCT_DEVICE_REGISTRATION_PROOF_TYPE =
  'codetether-device-registration+jws' as const
export const PRODUCT_DEVICE_CLOCK_SKEW_SECONDS = 120
export const PRODUCT_DEVICE_PROOF_HEADER = 'x-codetether-device-proof'
export const MAX_PRODUCT_DEVICE_PROOF_BYTES = 8_192

const base64UrlCoordinateSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/)
  .refine((value) => {
    const decoded = Buffer.from(value, 'base64url')
    return decoded.byteLength === 32 && decoded.toString('base64url') === value
  })

export const productDevicePublicJwkSchema = z
  .object({
    kty: z.literal('EC'),
    crv: z.literal('P-256'),
    x: base64UrlCoordinateSchema,
    y: base64UrlCoordinateSchema,
  })
  .strict()

export type ProductDevicePublicJwk = z.infer<
  typeof productDevicePublicJwkSchema
>

const boundedSafeText = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine(
      (value) =>
        value === value.trim() &&
        !/\p{Cc}/u.test(value) &&
        isWellFormedUnicode(value),
    )

export const productDeviceTypeSchema = z.enum([
  'desktop_host',
  'desktop_client',
  'mobile',
  'tablet',
])

export const registrationCandidateSchema = z
  .object({
    publicKey: productDevicePublicJwkSchema,
    keyAlgorithm: z.literal(PRODUCT_DEVICE_KEY_ALGORITHM),
    deviceType: productDeviceTypeSchema,
    label: boundedSafeText(120),
    platform: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/),
    appVersion: boundedSafeText(64),
    protocolVersion: z.literal(PRODUCT_DEVICE_PROTOCOL_VERSION),
  })
  .strict()

export type RegistrationCandidate = z.infer<typeof registrationCandidateSchema>

const nonceSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{22,86}$/)
  .refine((value) => Buffer.from(value, 'base64url').byteLength >= 16)

const sha256DigestSchema = z.string().regex(/^sha256:[A-Za-z0-9_-]{43}$/)

export const deviceRegistrationChallengePayloadSchema = z
  .object({
    v: z.literal(PRODUCT_DEVICE_PROOF_VERSION),
    aud: z.literal(PRODUCT_DEVICE_AUDIENCE),
    purpose: z.literal('device_registration'),
    challengeId: enrollmentChallengeIdSchema,
    userId: userIdSchema,
    candidateDeviceId: productDeviceIdSchema,
    publicKeyFingerprint: sha256DigestSchema,
    keyAlgorithm: z.literal(PRODUCT_DEVICE_KEY_ALGORITHM),
    deviceType: productDeviceTypeSchema,
    label: boundedSafeText(120),
    platform: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/),
    appVersion: boundedSafeText(64),
    nonce: nonceSchema,
    iat: z.number().int().nonnegative(),
    exp: z.number().int().positive(),
    protocolVersion: z.literal(PRODUCT_DEVICE_PROTOCOL_VERSION),
  })
  .strict()
  .refine(({ exp, iat }) => exp > iat)

export type DeviceRegistrationChallengePayload = z.infer<
  typeof deviceRegistrationChallengePayloadSchema
>

export const deviceRequestProofPayloadSchema = z
  .object({
    v: z.literal(PRODUCT_DEVICE_PROOF_VERSION),
    aud: z.literal(PRODUCT_DEVICE_AUDIENCE),
    authTokenHash: sha256DigestSchema,
    deviceId: productDeviceIdSchema,
    keyGeneration: z.number().int().positive(),
    method: z.string().regex(/^[A-Z]{3,16}$/),
    resource: z.string().min(1).max(2_048),
    bodySha256: sha256DigestSchema,
    nonce: nonceSchema,
    iat: z.number().int().nonnegative(),
    protocolVersion: z.literal(PRODUCT_DEVICE_PROTOCOL_VERSION),
  })
  .strict()

export type DeviceRequestProofPayload = z.infer<
  typeof deviceRequestProofPayloadSchema
>

const unverifiedDeviceRequestProofPayloadSchema = z
  .object({
    v: z.number().int().min(0).max(65_535),
    aud: z.string().min(1).max(128),
    authTokenHash: sha256DigestSchema,
    deviceId: productDeviceIdSchema,
    keyGeneration: z.number().int().positive(),
    method: z.string().regex(/^[A-Z]{3,16}$/),
    resource: z.string().min(1).max(2_048),
    bodySha256: sha256DigestSchema,
    nonce: nonceSchema,
    iat: z.number().int().nonnegative(),
    protocolVersion: z.number().int().min(0).max(65_535),
  })
  .strict()

export type UnverifiedDeviceRequestProofPayload = z.infer<
  typeof unverifiedDeviceRequestProofPayloadSchema
>

function rfc3986Encode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

function percentDecode(value: string, component: 'path' | 'query'): string {
  if (component === 'query' && value.includes('+')) {
    throw new Error('Ambiguous plus encoding is not admitted')
  }
  let decoded: string
  try {
    decoded = decodeURIComponent(value)
  } catch {
    throw new Error('Invalid percent encoding')
  }
  if (/\p{Cc}/u.test(decoded)) {
    throw new Error('Control characters are not admitted')
  }
  return decoded
}

export function canonicalizeDeviceRequestResource(rawResource: string): string {
  if (
    rawResource.length === 0 ||
    rawResource.length > 2_048 ||
    !rawResource.startsWith('/') ||
    rawResource.startsWith('//') ||
    rawResource.includes('#')
  ) {
    throw new Error('Resource is not an origin-relative HTTP target')
  }

  const queryOffset = rawResource.indexOf('?')
  const rawPath =
    queryOffset === -1 ? rawResource : rawResource.slice(0, queryOffset)
  const rawQuery =
    queryOffset === -1 ? null : rawResource.slice(queryOffset + 1)
  if (rawPath.includes('//')) {
    throw new Error('Empty path segments are not admitted')
  }

  const pathSegments = rawPath.split('/').map((segment, index) => {
    if (index === 0) return ''
    const decoded = percentDecode(segment, 'path')
    if (decoded === '.' || decoded === '..' || /[/\\]/u.test(decoded)) {
      throw new Error('Ambiguous path segment is not admitted')
    }
    return rfc3986Encode(decoded)
  })
  const canonicalPath = pathSegments.join('/')

  if (rawQuery === null) return canonicalPath
  if (rawQuery.length === 0) {
    throw new Error('Empty query marker is not admitted')
  }

  const keys = new Set<string>()
  const entries = rawQuery.split('&').map((component) => {
    if (component.length === 0) {
      throw new Error('Empty query component is not admitted')
    }
    const separator = component.indexOf('=')
    if (separator <= 0) {
      throw new Error(
        'Query components require a non-empty key and value marker',
      )
    }
    const key = percentDecode(component.slice(0, separator), 'query')
    const value = percentDecode(component.slice(separator + 1), 'query')
    if (keys.has(key)) {
      throw new Error('Duplicate query keys are not admitted')
    }
    keys.add(key)
    return [rfc3986Encode(key), rfc3986Encode(value)] as const
  })
  entries.sort(([leftKey], [rightKey]) =>
    leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0,
  )
  return `${canonicalPath}?${entries
    .map(([key, value]) => `${key}=${value}`)
    .join('&')}`
}

export function sha256Digest(value: Uint8Array | string): string {
  return `sha256:${createHash('sha256').update(value).digest('base64url')}`
}

export function equalDigest(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    timingSafeEqual(leftBytes, rightBytes)
  )
}

export async function admitProductDevicePublicJwk(
  untrustedJwk: unknown,
): Promise<{
  readonly publicJwk: ProductDevicePublicJwk
  readonly canonicalPublicJwk: string
  readonly fingerprint: string
}> {
  const publicJwk = productDevicePublicJwkSchema.parse(untrustedJwk)
  await importJWK(publicJwk as JWK, PRODUCT_DEVICE_KEY_ALGORITHM)
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

export function encodeRegistrationChallengePayload(
  untrustedPayload: DeviceRegistrationChallengePayload,
): Uint8Array {
  const payload =
    deviceRegistrationChallengePayloadSchema.parse(untrustedPayload)
  return canonicalJsonBytes({
    v: payload.v,
    aud: payload.aud,
    purpose: payload.purpose,
    challengeId: payload.challengeId,
    userId: payload.userId,
    candidateDeviceId: payload.candidateDeviceId,
    publicKeyFingerprint: payload.publicKeyFingerprint,
    keyAlgorithm: payload.keyAlgorithm,
    deviceType: payload.deviceType,
    label: payload.label,
    platform: payload.platform,
    appVersion: payload.appVersion,
    nonce: payload.nonce,
    iat: payload.iat,
    exp: payload.exp,
    protocolVersion: payload.protocolVersion,
  })
}

export function encodeDeviceRequestProofPayload(
  untrustedPayload: DeviceRequestProofPayload,
): Uint8Array {
  const payload = deviceRequestProofPayloadSchema.parse(untrustedPayload)
  return encodeUnverifiedDeviceRequestProofPayload(payload)
}

function encodeUnverifiedDeviceRequestProofPayload(
  payload: UnverifiedDeviceRequestProofPayload,
): Uint8Array {
  return canonicalJsonBytes({
    v: payload.v,
    aud: payload.aud,
    authTokenHash: payload.authTokenHash,
    deviceId: payload.deviceId,
    keyGeneration: payload.keyGeneration,
    method: payload.method,
    resource: payload.resource,
    bodySha256: payload.bodySha256,
    nonce: payload.nonce,
    iat: payload.iat,
    protocolVersion: payload.protocolVersion,
  })
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return false
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false
    }
  }
  return true
}

/**
 * RFC 8785 encoding for the deliberately constrained proof value domain:
 * fixed ASCII member names and only well-formed strings or safe integers.
 */
function canonicalJsonBytes(
  value: Readonly<Record<string, string | number>>,
): Uint8Array {
  const canonical: Record<string, string | number> = {}
  for (const key of Object.keys(value).sort()) {
    const member = value[key]!
    if (
      (typeof member === 'string' && !isWellFormedUnicode(member)) ||
      (typeof member === 'number' && !Number.isSafeInteger(member))
    ) {
      throw new Error(
        'ProductDevice proof is outside the canonical value domain',
      )
    }
    canonical[key] = member
  }
  return Buffer.from(JSON.stringify(canonical))
}

function parseCompactPayload<Payload>(
  compactJws: string,
  schema: z.ZodType<Payload>,
  encoder: (payload: Payload) => Uint8Array,
): Payload {
  if (
    compactJws.length === 0 ||
    compactJws.length > MAX_PRODUCT_DEVICE_PROOF_BYTES
  ) {
    throw new Error('ProductDevice proof is outside its size bound')
  }
  const segments = compactJws.split('.')
  if (
    segments.length !== 3 ||
    segments.some((segment) => segment.length === 0)
  ) {
    throw new Error('ProductDevice proof is not a compact JWS')
  }
  for (const segment of segments) {
    if (
      !/^[A-Za-z0-9_-]+$/.test(segment) ||
      Buffer.from(segment, 'base64url').toString('base64url') !== segment
    ) {
      throw new Error('ProductDevice proof is not canonical base64url')
    }
  }
  const payloadBytes = Buffer.from(segments[1] ?? '', 'base64url')
  if (payloadBytes.byteLength === 0 || payloadBytes.byteLength > 4_096) {
    throw new Error('ProductDevice proof payload is outside its size bound')
  }
  const payload = schema.parse(JSON.parse(payloadBytes.toString('utf8')))
  if (!Buffer.from(encoder(payload)).equals(payloadBytes)) {
    throw new Error('ProductDevice proof payload is not canonically encoded')
  }
  return payload
}

export function parseUnverifiedDeviceRequestProof(
  compactJws: string,
): UnverifiedDeviceRequestProofPayload {
  return parseCompactPayload(
    compactJws,
    unverifiedDeviceRequestProofPayloadSchema,
    encodeUnverifiedDeviceRequestProofPayload,
  )
}

async function verifyCompactProof(
  compactJws: string,
  publicJwk: ProductDevicePublicJwk,
  expectedType: string,
  expectedPayload: Uint8Array,
): Promise<void> {
  const segments = compactJws.split('.')
  if (
    segments.length !== 3 ||
    segments.some(
      (segment) =>
        segment.length === 0 ||
        !/^[A-Za-z0-9_-]+$/.test(segment) ||
        Buffer.from(segment, 'base64url').toString('base64url') !== segment,
    )
  ) {
    throw new Error('ProductDevice proof is not canonical compact JWS')
  }
  const key = await importJWK(publicJwk as JWK, PRODUCT_DEVICE_KEY_ALGORITHM)
  const verified = await compactVerify(compactJws, key, {
    algorithms: [PRODUCT_DEVICE_KEY_ALGORITHM],
  })
  if (
    verified.protectedHeader.alg !== PRODUCT_DEVICE_KEY_ALGORITHM ||
    verified.protectedHeader.typ !== expectedType ||
    Object.keys(verified.protectedHeader).some(
      (name) => name !== 'alg' && name !== 'typ',
    ) ||
    !Buffer.from(verified.payload).equals(expectedPayload)
  ) {
    throw new Error('ProductDevice proof signature envelope does not match')
  }
}

export async function verifyRegistrationChallengeProof(
  compactJws: string,
  publicJwk: ProductDevicePublicJwk,
  payload: DeviceRegistrationChallengePayload,
): Promise<void> {
  await verifyCompactProof(
    compactJws,
    publicJwk,
    PRODUCT_DEVICE_REGISTRATION_PROOF_TYPE,
    encodeRegistrationChallengePayload(payload),
  )
}

export async function verifyDeviceRequestProofSignature(
  compactJws: string,
  publicJwk: ProductDevicePublicJwk,
  payload: UnverifiedDeviceRequestProofPayload,
): Promise<void> {
  await verifyCompactProof(
    compactJws,
    publicJwk,
    PRODUCT_DEVICE_PROOF_TYPE,
    encodeUnverifiedDeviceRequestProofPayload(payload),
  )
}
