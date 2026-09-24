import { z } from 'zod'

import { relayProtocolLimits, relayProtocolVersion } from './constants.js'
import {
  RelayChannelGenerationSchema,
  RelayChannelIdSchema,
  RelayConnectionEpochSchema,
  RelayRequestIdSchema,
  RelayTimestampSchema,
} from './ids.js'
import {
  RelayChannelCloseReasonSchema,
  RelayChannelClosedReasonSchema,
  RelayChannelDataSchema,
  RelayChannelErrorCodeSchema,
  RelayChannelRejectReasonSchema,
} from './messages.js'
import {
  RelayPublicKeyFingerprintSchema,
  RelayPublicKeySpkiSchema,
  RelaySignatureSchema,
} from './identity.js'

const VersionSchema = z.literal(relayProtocolVersion)
export const RelaySupervisorRendezvousIdSchema = z
  .string()
  .regex(/^srv_[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/u)
export const RelaySupervisorCapabilitySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/u)

const AuthenticationBase = {
  protocolVersion: VersionSchema,
  rendezvousId: RelaySupervisorRendezvousIdSchema,
  rendezvousCapability: RelaySupervisorCapabilitySchema,
  hostTransportFingerprint: RelayPublicKeyFingerprintSchema,
  transportPublicKeySpki: RelayPublicKeySpkiSchema,
  transportFingerprint: RelayPublicKeyFingerprintSchema,
  clientBuildIdentity: z
    .string()
    .trim()
    .min(1)
    .max(relayProtocolLimits.maximumBuildIdentityCharacters)
    .regex(/^[\x21-\x7e]+$/u),
  signature: RelaySignatureSchema,
}

export const RelaySupervisorHostRegisterMessageSchema = z
  .object({
    type: z.literal('supervisor.host.register'),
    role: z.literal('host'),
    ...AuthenticationBase,
  })
  .strict()

export const RelaySupervisorDeviceConnectMessageSchema = z
  .object({
    type: z.literal('supervisor.device.connect'),
    role: z.literal('device'),
    requestId: RelayRequestIdSchema,
    ...AuthenticationBase,
  })
  .strict()

export const RelaySupervisorAuthenticateMessageSchema = z.union([
  RelaySupervisorHostRegisterMessageSchema,
  RelaySupervisorDeviceConnectMessageSchema,
])
export type RelaySupervisorAuthenticateMessage = z.infer<
  typeof RelaySupervisorAuthenticateMessageSchema
>

const ChannelBinding = {
  channelId: RelayChannelIdSchema,
  channelGeneration: RelayChannelGenerationSchema,
  deviceConnectionEpoch: RelayConnectionEpochSchema,
  hostConnectionEpoch: RelayConnectionEpochSchema,
}
const AuthenticatedChannelBinding = {
  protocolVersion: VersionSchema,
  connectionEpoch: RelayConnectionEpochSchema,
  ...ChannelBinding,
}

export const RelaySupervisorHeartbeatPongMessageSchema = z
  .object({
    type: z.literal('heartbeat.pong'),
    protocolVersion: VersionSchema,
    connectionEpoch: RelayConnectionEpochSchema,
    pingId: z.string().regex(/^relay_ping_[A-Za-z0-9][A-Za-z0-9_-]{5,95}$/u),
  })
  .strict()

export const RelaySupervisorChannelAcceptMessageSchema = z
  .object({
    type: z.literal('supervisor.channel.accept'),
    ...AuthenticatedChannelBinding,
    requestId: RelayRequestIdSchema,
  })
  .strict()
export const RelaySupervisorChannelRejectMessageSchema = z
  .object({
    type: z.literal('supervisor.channel.reject'),
    ...AuthenticatedChannelBinding,
    requestId: RelayRequestIdSchema,
    reason: RelayChannelRejectReasonSchema,
  })
  .strict()
export const RelaySupervisorChannelDataMessageSchema = z
  .object({
    type: z.literal('supervisor.channel.data'),
    ...AuthenticatedChannelBinding,
    sequence: z.number().int().positive().safe(),
    data: RelayChannelDataSchema,
  })
  .strict()
export const RelaySupervisorChannelDataAckMessageSchema = z
  .object({
    type: z.literal('supervisor.channel.data.ack'),
    ...AuthenticatedChannelBinding,
    acknowledgedSequence: z.number().int().positive().safe(),
  })
  .strict()
export const RelaySupervisorChannelCloseMessageSchema = z
  .object({
    type: z.literal('supervisor.channel.close'),
    ...AuthenticatedChannelBinding,
    reason: RelayChannelCloseReasonSchema,
  })
  .strict()

export const RelaySupervisorClientMessageSchema = z.union([
  RelaySupervisorHeartbeatPongMessageSchema,
  RelaySupervisorChannelAcceptMessageSchema,
  RelaySupervisorChannelRejectMessageSchema,
  RelaySupervisorChannelDataMessageSchema,
  RelaySupervisorChannelDataAckMessageSchema,
  RelaySupervisorChannelCloseMessageSchema,
])
export type RelaySupervisorClientMessage = z.infer<
  typeof RelaySupervisorClientMessageSchema
>

export const RelaySupervisorReadyMessageSchema = z
  .object({
    type: z.literal('supervisor.ready'),
    protocolVersion: VersionSchema,
    role: z.enum(['host', 'device']),
    connectionEpoch: RelayConnectionEpochSchema,
    heartbeatIntervalMs: z.number().int().min(10).max(60_000),
    heartbeatTimeoutMs: z.number().int().min(20).max(180_000),
    authenticatedAt: RelayTimestampSchema,
  })
  .strict()

export const RelaySupervisorChannelOfferMessageSchema = z
  .object({
    type: z.literal('supervisor.channel.offer'),
    protocolVersion: VersionSchema,
    connectionEpoch: RelayConnectionEpochSchema,
    ...ChannelBinding,
    requestId: RelayRequestIdSchema,
    deviceTransportFingerprint: RelayPublicKeyFingerprintSchema,
  })
  .strict()
export const RelaySupervisorChannelOpenedMessageSchema = z
  .object({
    type: z.literal('supervisor.channel.opened'),
    ...AuthenticatedChannelBinding,
    requestId: RelayRequestIdSchema,
  })
  .strict()
export const RelaySupervisorChannelClosedMessageSchema = z
  .object({
    type: z.literal('supervisor.channel.closed'),
    ...AuthenticatedChannelBinding,
    requestId: RelayRequestIdSchema,
    reason: RelayChannelClosedReasonSchema,
  })
  .strict()
export const RelaySupervisorChannelErrorMessageSchema = z
  .object({
    type: z.literal('supervisor.channel.error'),
    ...AuthenticatedChannelBinding,
    requestId: RelayRequestIdSchema,
    code: RelayChannelErrorCodeSchema,
  })
  .strict()

export const RelaySupervisorServerMessageSchema = z.union([
  RelaySupervisorReadyMessageSchema,
  z
    .object({
      type: z.literal('heartbeat.ping'),
      protocolVersion: VersionSchema,
      connectionEpoch: RelayConnectionEpochSchema,
      pingId: z.string().regex(/^relay_ping_[A-Za-z0-9][A-Za-z0-9_-]{5,95}$/u),
      sentAt: RelayTimestampSchema,
    })
    .strict(),
  RelaySupervisorChannelOfferMessageSchema,
  RelaySupervisorChannelOpenedMessageSchema,
  RelaySupervisorChannelRejectMessageSchema,
  RelaySupervisorChannelDataMessageSchema,
  RelaySupervisorChannelDataAckMessageSchema,
  RelaySupervisorChannelClosedMessageSchema,
  RelaySupervisorChannelErrorMessageSchema,
])
export type RelaySupervisorServerMessage = z.infer<
  typeof RelaySupervisorServerMessageSchema
>

export interface RelaySupervisorChannelBinding {
  readonly channelId: z.infer<typeof RelayChannelIdSchema>
  readonly channelGeneration: z.infer<typeof RelayChannelGenerationSchema>
  readonly deviceConnectionEpoch: z.infer<typeof RelayConnectionEpochSchema>
  readonly hostConnectionEpoch: z.infer<typeof RelayConnectionEpochSchema>
}
