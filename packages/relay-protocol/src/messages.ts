import { z } from 'zod'

import { relayErrorCodes } from './errors.js'
import {
  RelayPublicKeyFingerprintSchema,
  RelayPublicKeySpkiSchema,
  RelaySignatureSchema,
} from './identity.js'
import {
  RelayChallengeIdSchema,
  RelayConnectionEpochSchema,
  RelayIdSchema,
  RelayNonceSchema,
  RelayPeerIdSchema,
  RelayPingIdSchema,
  RelayRequestIdSchema,
  RelayTimestampSchema,
} from './ids.js'
import { relayProtocolLimits, relayProtocolVersion } from './constants.js'

const VersionSchema = z.literal(relayProtocolVersion)
export const RelayPeerRoleSchema = z.enum(['controller', 'node'])
export type RelayPeerRole = z.infer<typeof RelayPeerRoleSchema>

export const RelayClientBuildIdentitySchema = z
  .string()
  .trim()
  .min(1)
  .max(relayProtocolLimits.maximumBuildIdentityCharacters)
  .regex(/^[\x21-\x7e]+$/u)
export type RelayClientBuildIdentity = z.infer<
  typeof RelayClientBuildIdentitySchema
>

export const RelayEnrollmentTokenSchema = z
  .string()
  .regex(/^relay_enroll_[A-Za-z0-9_-]{43}$/u)
export type RelayEnrollmentToken = z.infer<typeof RelayEnrollmentTokenSchema>

export const RelayChallengeMessageSchema = z
  .object({
    type: z.literal('relay.challenge'),
    protocolVersion: VersionSchema,
    relayId: RelayIdSchema,
    relayPublicKeySpki: RelayPublicKeySpkiSchema,
    relayFingerprint: RelayPublicKeyFingerprintSchema,
    challengeId: RelayChallengeIdSchema,
    nonce: RelayNonceSchema,
    issuedAt: RelayTimestampSchema,
    expiresAt: RelayTimestampSchema,
    signature: RelaySignatureSchema,
  })
  .strict()
export type RelayChallengeMessage = z.infer<typeof RelayChallengeMessageSchema>

const EnrollmentBase = {
  protocolVersion: VersionSchema,
  enrollmentToken: RelayEnrollmentTokenSchema,
  peerPublicKeySpki: RelayPublicKeySpkiSchema,
  peerFingerprint: RelayPublicKeyFingerprintSchema,
  clientBuildIdentity: RelayClientBuildIdentitySchema,
  signature: RelaySignatureSchema,
}

export const RelayControllerEnrollMessageSchema = z
  .object({
    type: z.literal('peer.enroll'),
    role: z.literal('controller'),
    ...EnrollmentBase,
    authorizedControllerFingerprint: z.never().optional(),
  })
  .strict()
export type RelayControllerEnrollMessage = z.infer<
  typeof RelayControllerEnrollMessageSchema
>

export const RelayNodeEnrollMessageSchema = z
  .object({
    type: z.literal('peer.enroll'),
    role: z.literal('node'),
    ...EnrollmentBase,
    authorizedControllerFingerprint: RelayPublicKeyFingerprintSchema.optional(),
  })
  .strict()
export type RelayNodeEnrollMessage = z.infer<
  typeof RelayNodeEnrollMessageSchema
>

export const RelayEnrollMessageSchema = z.discriminatedUnion('role', [
  RelayControllerEnrollMessageSchema,
  RelayNodeEnrollMessageSchema,
])
export type RelayEnrollMessage = z.infer<typeof RelayEnrollMessageSchema>

export const RelayAuthenticateMessageSchema = z
  .object({
    type: z.literal('peer.authenticate'),
    protocolVersion: VersionSchema,
    peerFingerprint: RelayPublicKeyFingerprintSchema,
    role: RelayPeerRoleSchema,
    clientBuildIdentity: RelayClientBuildIdentitySchema,
    signature: RelaySignatureSchema,
  })
  .strict()
export type RelayAuthenticateMessage = z.infer<
  typeof RelayAuthenticateMessageSchema
>

export const RelayHeartbeatPongMessageSchema = z
  .object({
    type: z.literal('heartbeat.pong'),
    protocolVersion: VersionSchema,
    connectionEpoch: RelayConnectionEpochSchema,
    pingId: RelayPingIdSchema,
  })
  .strict()
export type RelayHeartbeatPongMessage = z.infer<
  typeof RelayHeartbeatPongMessageSchema
>

export const RelayRendezvousSubscribeMessageSchema = z
  .object({
    type: z.literal('rendezvous.subscribe'),
    protocolVersion: VersionSchema,
    connectionEpoch: RelayConnectionEpochSchema,
    requestId: RelayRequestIdSchema,
    targetNodeFingerprint: RelayPublicKeyFingerprintSchema,
  })
  .strict()
export type RelayRendezvousSubscribeMessage = z.infer<
  typeof RelayRendezvousSubscribeMessageSchema
>

export const RelayRendezvousUnsubscribeMessageSchema = z
  .object({
    type: z.literal('rendezvous.unsubscribe'),
    protocolVersion: VersionSchema,
    connectionEpoch: RelayConnectionEpochSchema,
    requestId: RelayRequestIdSchema,
    targetNodeFingerprint: RelayPublicKeyFingerprintSchema,
  })
  .strict()
export type RelayRendezvousUnsubscribeMessage = z.infer<
  typeof RelayRendezvousUnsubscribeMessageSchema
>

export const RelayGrantReplaceMessageSchema = z
  .object({
    type: z.literal('grant.replace'),
    protocolVersion: VersionSchema,
    connectionEpoch: RelayConnectionEpochSchema,
    requestId: RelayRequestIdSchema,
    authorizedControllerFingerprint: RelayPublicKeyFingerprintSchema.optional(),
  })
  .strict()
export type RelayGrantReplaceMessage = z.infer<
  typeof RelayGrantReplaceMessageSchema
>

export const RelayGoodbyeMessageSchema = z
  .object({
    type: z.literal('peer.goodbye'),
    protocolVersion: VersionSchema,
    connectionEpoch: RelayConnectionEpochSchema,
  })
  .strict()
export type RelayGoodbyeMessage = z.infer<typeof RelayGoodbyeMessageSchema>

// Enrollment has two role-specific forms with the same wire type. A plain union
// keeps the role discriminator strict without making `type` falsely unique.
export const RelayClientMessageSchema = z.union([
  RelayControllerEnrollMessageSchema,
  RelayNodeEnrollMessageSchema,
  RelayAuthenticateMessageSchema,
  RelayHeartbeatPongMessageSchema,
  RelayRendezvousSubscribeMessageSchema,
  RelayRendezvousUnsubscribeMessageSchema,
  RelayGrantReplaceMessageSchema,
  RelayGoodbyeMessageSchema,
])
export type RelayClientMessage = z.infer<typeof RelayClientMessageSchema>

export const RelayReadyMessageSchema = z
  .object({
    type: z.literal('peer.ready'),
    protocolVersion: VersionSchema,
    peerId: RelayPeerIdSchema,
    role: RelayPeerRoleSchema,
    connectionEpoch: RelayConnectionEpochSchema,
    heartbeatIntervalMs: z.number().int().min(10).max(60_000),
    heartbeatTimeoutMs: z.number().int().min(20).max(180_000),
    authenticatedAt: RelayTimestampSchema,
  })
  .strict()
export type RelayReadyMessage = z.infer<typeof RelayReadyMessageSchema>

export const RelayHeartbeatPingMessageSchema = z
  .object({
    type: z.literal('heartbeat.ping'),
    protocolVersion: VersionSchema,
    connectionEpoch: RelayConnectionEpochSchema,
    pingId: RelayPingIdSchema,
    sentAt: RelayTimestampSchema,
  })
  .strict()
export type RelayHeartbeatPingMessage = z.infer<
  typeof RelayHeartbeatPingMessageSchema
>

export const RelayPresenceStateSchema = z.enum([
  'online',
  'offline',
  'unavailable',
  'revoked',
  'incompatible',
])
export type RelayPresenceState = z.infer<typeof RelayPresenceStateSchema>

export const RelayRendezvousStatusMessageSchema = z
  .object({
    type: z.literal('rendezvous.status'),
    protocolVersion: VersionSchema,
    connectionEpoch: RelayConnectionEpochSchema,
    requestId: RelayRequestIdSchema,
    targetNodeFingerprint: RelayPublicKeyFingerprintSchema,
    state: RelayPresenceStateSchema,
    observedAt: RelayTimestampSchema,
  })
  .strict()
export type RelayRendezvousStatusMessage = z.infer<
  typeof RelayRendezvousStatusMessageSchema
>

export const RelayGrantReplacedMessageSchema = z
  .object({
    type: z.literal('grant.replaced'),
    protocolVersion: VersionSchema,
    connectionEpoch: RelayConnectionEpochSchema,
    requestId: RelayRequestIdSchema,
    observedAt: RelayTimestampSchema,
  })
  .strict()
export type RelayGrantReplacedMessage = z.infer<
  typeof RelayGrantReplacedMessageSchema
>

export const RelayErrorMessageSchema = z
  .object({
    type: z.literal('relay.error'),
    protocolVersion: VersionSchema,
    code: z.enum(relayErrorCodes),
    message: z
      .string()
      .trim()
      .min(1)
      .max(relayProtocolLimits.maximumErrorMessageCharacters),
    retryAfterMs: z.number().int().positive().safe().max(300_000).optional(),
  })
  .strict()
export type RelayErrorMessage = z.infer<typeof RelayErrorMessageSchema>

export const RelayServerMessageSchema = z.discriminatedUnion('type', [
  RelayChallengeMessageSchema,
  RelayReadyMessageSchema,
  RelayHeartbeatPingMessageSchema,
  RelayRendezvousStatusMessageSchema,
  RelayGrantReplacedMessageSchema,
  RelayErrorMessageSchema,
])
export type RelayServerMessage = z.infer<typeof RelayServerMessageSchema>

export const RelayWireMessageSchema = z.union([
  RelayClientMessageSchema,
  RelayServerMessageSchema,
])
export type RelayWireMessage = z.infer<typeof RelayWireMessageSchema>
