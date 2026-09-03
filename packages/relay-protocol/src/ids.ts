import { randomBytes, randomUUID } from 'node:crypto'

import { z } from 'zod'

export const RelayIdSchema = z
  .string()
  .regex(/^relay_[A-Za-z0-9][A-Za-z0-9_-]{5,95}$/u)
export type RelayId = z.infer<typeof RelayIdSchema>

export const RelayPeerIdSchema = z
  .string()
  .regex(/^relay_peer_[A-Za-z0-9][A-Za-z0-9_-]{5,95}$/u)
export type RelayPeerId = z.infer<typeof RelayPeerIdSchema>

export const RelayChallengeIdSchema = z
  .string()
  .regex(/^relay_challenge_[A-Za-z0-9][A-Za-z0-9_-]{5,95}$/u)
export type RelayChallengeId = z.infer<typeof RelayChallengeIdSchema>

export const RelayConnectionEpochSchema = z
  .string()
  .regex(/^relay_connection_[A-Za-z0-9][A-Za-z0-9_-]{5,95}$/u)
export type RelayConnectionEpoch = z.infer<typeof RelayConnectionEpochSchema>

export const RelayRequestIdSchema = z
  .string()
  .regex(/^relay_request_[A-Za-z0-9][A-Za-z0-9_-]{5,95}$/u)
export type RelayRequestId = z.infer<typeof RelayRequestIdSchema>

export const RelayPingIdSchema = z
  .string()
  .regex(/^relay_ping_[A-Za-z0-9][A-Za-z0-9_-]{5,95}$/u)
export type RelayPingId = z.infer<typeof RelayPingIdSchema>

export const RelayNonceSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u)
export type RelayNonce = z.infer<typeof RelayNonceSchema>

export const RelayTimestampSchema = z.iso.datetime({ offset: true }).max(64)
export type RelayTimestamp = z.infer<typeof RelayTimestampSchema>

export function newRelayId(): RelayId {
  return RelayIdSchema.parse(`relay_${compactUuid()}`)
}

export function newRelayPeerId(): RelayPeerId {
  return RelayPeerIdSchema.parse(`relay_peer_${compactUuid()}`)
}

export function newRelayChallengeId(): RelayChallengeId {
  return RelayChallengeIdSchema.parse(`relay_challenge_${compactUuid()}`)
}

export function newRelayConnectionEpoch(): RelayConnectionEpoch {
  return RelayConnectionEpochSchema.parse(`relay_connection_${compactUuid()}`)
}

export function newRelayRequestId(): RelayRequestId {
  return RelayRequestIdSchema.parse(`relay_request_${compactUuid()}`)
}

export function newRelayPingId(): RelayPingId {
  return RelayPingIdSchema.parse(`relay_ping_${compactUuid()}`)
}

export function newRelayNonce(): RelayNonce {
  return RelayNonceSchema.parse(randomBytes(32).toString('base64url'))
}

function compactUuid(): string {
  return randomUUID().replaceAll('-', '')
}
