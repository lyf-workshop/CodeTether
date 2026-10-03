import { createHash, timingSafeEqual } from 'node:crypto'
import { compactVerify, importJWK, type JWK } from 'jose'

import {
  supervisorDescriptorProofType,
  supervisorGrantProofType,
} from './constants.js'
import {
  supervisorGrantPayloadSchema,
  supervisorHostPresencePayloadSchema,
  supervisorPublicJwkSchema,
  supervisorTransportDescriptorPayloadSchema,
  type SignedSupervisorGrant,
  type SignedSupervisorHostPresence,
  type SignedSupervisorTransportDescriptor,
  type SupervisorGrantPayload,
  type SupervisorHostPresencePayload,
  type SupervisorPublicJwk,
  type SupervisorTransportDescriptorPayload,
} from './protocol.js'

export function canonicalJsonBytes(value: unknown): Uint8Array {
  return Buffer.from(canonicalJson(value), 'utf8')
}

export function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new TypeError('Unsafe JSON number')
    return String(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`
  }
  if (typeof value !== 'object') throw new TypeError('Unsupported JSON value')
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`
}

export function sha256Digest(value: Uint8Array | string): string {
  return `sha256:${createHash('sha256').update(value).digest('base64url')}`
}

export function supervisorGrantBytes(
  value: SupervisorGrantPayload,
): Uint8Array {
  return canonicalJsonBytes(supervisorGrantPayloadSchema.parse(value))
}

export function supervisorDescriptorBytes(
  value: SupervisorTransportDescriptorPayload,
): Uint8Array {
  return canonicalJsonBytes(
    supervisorTransportDescriptorPayloadSchema.parse(value),
  )
}

export function supervisorHostPresenceBytes(
  value: SupervisorHostPresencePayload,
): Uint8Array {
  return canonicalJsonBytes(supervisorHostPresencePayloadSchema.parse(value))
}

export function supervisorGrantDigest(grant: SignedSupervisorGrant): string {
  const parsed = supervisorGrantPayloadSchema.parse(grant.payload)
  return sha256Digest(supervisorGrantBytes(parsed))
}

export async function verifySupervisorGrant(
  value: SignedSupervisorGrant,
  publicJwk: SupervisorPublicJwk,
): Promise<void> {
  const payload = supervisorGrantPayloadSchema.parse(value.payload)
  await verifyCompactProof(
    value.proof,
    supervisorPublicJwkSchema.parse(publicJwk),
    supervisorGrantProofType,
    supervisorGrantBytes(payload),
  )
}

export async function verifySupervisorDescriptor(
  value: SignedSupervisorTransportDescriptor,
  publicJwk: SupervisorPublicJwk,
): Promise<void> {
  const payload = supervisorTransportDescriptorPayloadSchema.parse(
    value.payload,
  )
  await verifyCompactProof(
    value.proof,
    supervisorPublicJwkSchema.parse(publicJwk),
    supervisorDescriptorProofType,
    supervisorDescriptorBytes(payload),
  )
}

export async function verifySupervisorHostPresence(
  value: SignedSupervisorHostPresence,
  publicJwk: SupervisorPublicJwk,
): Promise<void> {
  const payload = supervisorHostPresencePayloadSchema.parse(value.payload)
  await verifyCompactProof(
    value.proof,
    supervisorPublicJwkSchema.parse(publicJwk),
    supervisorDescriptorProofType,
    supervisorHostPresenceBytes(payload),
  )
}

async function verifyCompactProof(
  compact: string,
  publicJwk: SupervisorPublicJwk,
  type: string,
  expectedPayload: Uint8Array,
): Promise<void> {
  const segments = compact.split('.')
  if (
    segments.length !== 3 ||
    segments.some(
      (segment) =>
        !/^[A-Za-z0-9_-]+$/u.test(segment) ||
        Buffer.from(segment, 'base64url').toString('base64url') !== segment,
    )
  ) {
    throw new Error('Invalid Supervisor proof')
  }
  const verified = await compactVerify(
    compact,
    await importJWK(publicJwk as JWK, 'ES256'),
    { algorithms: ['ES256'] },
  )
  if (
    verified.protectedHeader.alg !== 'ES256' ||
    verified.protectedHeader.typ !== type ||
    Object.keys(verified.protectedHeader).some(
      (key) => key !== 'alg' && key !== 'typ',
    ) ||
    !safeEqual(verified.payload, expectedPayload)
  ) {
    throw new Error('Supervisor proof envelope mismatch')
  }
}

function safeEqual(left: Uint8Array, right: Uint8Array): boolean {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    timingSafeEqual(leftBytes, rightBytes)
  )
}
