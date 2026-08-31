import { z } from 'zod'

import { machineProtocolVersion, machineTransportLimits } from './constants.js'
import {
  ControllerIdSchema,
  MachineTransportMachineIdSchema,
  NodeIdSchema,
  PairingAttemptIdSchema,
} from './ids.js'

export const PublicKeyFingerprintSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/)
export type PublicKeyFingerprint = z.infer<typeof PublicKeyFingerprintSchema>

const TimestampSchema = z.iso.datetime({ offset: true })
const BoundedOpaqueEnvelopeSchema = z.string().min(1).max(4096)
const NonceSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
const AuthenticationTagSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)

export const RemoteProjectLocationPathSchema = z
  .string()
  .min(1)
  .max(machineTransportLimits.maximumProjectLocationPathBytes)
  .refine((value) => !value.includes('\0'))
  .refine(
    (value) =>
      Buffer.byteLength(value, 'utf8') <=
      machineTransportLimits.maximumProjectLocationPathBytes,
  )
export type RemoteProjectLocationPath = z.infer<
  typeof RemoteProjectLocationPathSchema
>

const RemoteProjectLocationBasenameSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => !value.includes('\0'))

export const RemoteMachineMetadataSchema = z
  .object({
    machineId: MachineTransportMachineIdSchema,
    nodeId: NodeIdSchema,
    displayName: z.string().trim().min(1).max(240),
    platform: z.string().trim().min(1).max(64),
    architecture: z.string().trim().min(1).max(64),
  })
  .strict()
export type RemoteMachineMetadata = z.infer<typeof RemoteMachineMetadataSchema>

const VersionField = z.literal(machineProtocolVersion)

export const PairingOpenMessageSchema = z
  .object({
    type: z.literal('pair.open'),
    protocolVersion: VersionField,
    controllerFingerprint: PublicKeyFingerprintSchema,
  })
  .strict()
export type PairingOpenMessage = z.infer<typeof PairingOpenMessageSchema>

export const PairingOfferMessageSchema = z
  .object({
    type: z.literal('pair.offer'),
    protocolVersion: VersionField,
    attemptId: PairingAttemptIdSchema,
    expiresAt: TimestampSchema,
    machine: RemoteMachineMetadataSchema,
    nodeFingerprint: PublicKeyFingerprintSchema,
    nodeNonce: NonceSchema,
  })
  .strict()
export type PairingOfferMessage = z.infer<typeof PairingOfferMessageSchema>

export const PairingLoginStartMessageSchema = z
  .object({
    type: z.literal('pair.login.start'),
    protocolVersion: VersionField,
    attemptId: PairingAttemptIdSchema,
    controllerId: ControllerIdSchema,
    controllerFingerprint: PublicKeyFingerprintSchema,
    controllerNonce: NonceSchema,
    request: BoundedOpaqueEnvelopeSchema,
  })
  .strict()
export type PairingLoginStartMessage = z.infer<
  typeof PairingLoginStartMessageSchema
>

export const PairingLoginResponseMessageSchema = z
  .object({
    type: z.literal('pair.login.response'),
    protocolVersion: VersionField,
    attemptId: PairingAttemptIdSchema,
    response: BoundedOpaqueEnvelopeSchema,
  })
  .strict()
export type PairingLoginResponseMessage = z.infer<
  typeof PairingLoginResponseMessageSchema
>

export const PairingLoginFinishMessageSchema = z
  .object({
    type: z.literal('pair.login.finish'),
    protocolVersion: VersionField,
    attemptId: PairingAttemptIdSchema,
    request: BoundedOpaqueEnvelopeSchema,
  })
  .strict()
export type PairingLoginFinishMessage = z.infer<
  typeof PairingLoginFinishMessageSchema
>

export const PairingConfirmMessageSchema = z
  .object({
    type: z.literal('pair.confirm'),
    protocolVersion: VersionField,
    attemptId: PairingAttemptIdSchema,
    tag: AuthenticationTagSchema,
  })
  .strict()
export type PairingConfirmMessage = z.infer<typeof PairingConfirmMessageSchema>

export const PairingCancelMessageSchema = z
  .object({
    type: z.literal('pair.cancel'),
    protocolVersion: VersionField,
    attemptId: PairingAttemptIdSchema,
    tag: AuthenticationTagSchema,
  })
  .strict()
export type PairingCancelMessage = z.infer<typeof PairingCancelMessageSchema>

export const PairingAckMessageSchema = z
  .object({
    type: z.literal('pair.ack'),
    protocolVersion: VersionField,
    attemptId: PairingAttemptIdSchema,
    tag: AuthenticationTagSchema,
  })
  .strict()
export type PairingAckMessage = z.infer<typeof PairingAckMessageSchema>

export const PairingCancelledMessageSchema = z
  .object({
    type: z.literal('pair.cancelled'),
    protocolVersion: VersionField,
    attemptId: PairingAttemptIdSchema,
    tag: AuthenticationTagSchema,
  })
  .strict()
export type PairingCancelledMessage = z.infer<
  typeof PairingCancelledMessageSchema
>

export const MachineHelloMessageSchema = z
  .object({
    type: z.literal('machine.hello'),
    protocolVersion: VersionField,
    controllerId: ControllerIdSchema,
    expectedMachineId: MachineTransportMachineIdSchema,
    nonce: NonceSchema,
  })
  .strict()
export type MachineHelloMessage = z.infer<typeof MachineHelloMessageSchema>

export const MachineStatusMessageSchema = z
  .object({
    type: z.literal('machine.status'),
    protocolVersion: VersionField,
    machine: RemoteMachineMetadataSchema,
    nonce: NonceSchema,
    observedAt: TimestampSchema,
  })
  .strict()
export type MachineStatusMessage = z.infer<typeof MachineStatusMessageSchema>

export const MachinePingMessageSchema = z
  .object({
    type: z.literal('machine.ping'),
    protocolVersion: VersionField,
    nonce: NonceSchema,
  })
  .strict()
export type MachinePingMessage = z.infer<typeof MachinePingMessageSchema>

export const MachinePongMessageSchema = z
  .object({
    type: z.literal('machine.pong'),
    protocolVersion: VersionField,
    nonce: NonceSchema,
  })
  .strict()
export type MachinePongMessage = z.infer<typeof MachinePongMessageSchema>

export const ProjectLocationValidateMessageSchema = z
  .object({
    type: z.literal('project_location.validate'),
    protocolVersion: VersionField,
    requestId: NonceSchema,
    expectedMachineId: MachineTransportMachineIdSchema,
    expectedNodeId: NodeIdSchema,
    rootPath: RemoteProjectLocationPathSchema,
  })
  .strict()
export type ProjectLocationValidateMessage = z.infer<
  typeof ProjectLocationValidateMessageSchema
>

export const ProjectLocationValidatedMessageSchema = z
  .object({
    type: z.literal('project_location.validated'),
    protocolVersion: VersionField,
    requestId: NonceSchema,
    machineId: MachineTransportMachineIdSchema,
    nodeId: NodeIdSchema,
    canonicalPath: RemoteProjectLocationPathSchema,
    basename: RemoteProjectLocationBasenameSchema,
    exists: z.literal(true),
    directory: z.literal(true),
  })
  .strict()
export type ProjectLocationValidatedMessage = z.infer<
  typeof ProjectLocationValidatedMessageSchema
>

export const TrustRevokeMessageSchema = z
  .object({
    type: z.literal('trust.revoke'),
    protocolVersion: VersionField,
    controllerId: ControllerIdSchema,
    nonce: NonceSchema,
  })
  .strict()
export type TrustRevokeMessage = z.infer<typeof TrustRevokeMessageSchema>

export const TrustRevokedMessageSchema = z
  .object({
    type: z.literal('trust.revoked'),
    protocolVersion: VersionField,
    controllerId: ControllerIdSchema,
    nonce: NonceSchema,
  })
  .strict()
export type TrustRevokedMessage = z.infer<typeof TrustRevokedMessageSchema>

export const MachineWireErrorCodeSchema = z.enum([
  'pairing_disabled',
  'pairing_expired',
  'pairing_rate_limited',
  'pairing_failed',
  'authentication_failed',
  'identity_mismatch',
  'protocol_incompatible',
  'busy',
  'malformed_message',
  'project_location_path_invalid',
  'project_location_missing',
  'project_location_not_directory',
  'project_location_inaccessible',
])
export type MachineWireErrorCode = z.infer<typeof MachineWireErrorCodeSchema>

export const MachineErrorMessageSchema = z
  .object({
    type: z.literal('machine.error'),
    protocolVersion: VersionField,
    code: MachineWireErrorCodeSchema,
    message: z.string().trim().min(1).max(240),
  })
  .strict()
export type MachineErrorMessage = z.infer<typeof MachineErrorMessageSchema>

export const MachineWireMessageSchema = z.discriminatedUnion('type', [
  PairingOpenMessageSchema,
  PairingOfferMessageSchema,
  PairingLoginStartMessageSchema,
  PairingLoginResponseMessageSchema,
  PairingLoginFinishMessageSchema,
  PairingConfirmMessageSchema,
  PairingCancelMessageSchema,
  PairingAckMessageSchema,
  PairingCancelledMessageSchema,
  MachineHelloMessageSchema,
  MachineStatusMessageSchema,
  MachinePingMessageSchema,
  MachinePongMessageSchema,
  ProjectLocationValidateMessageSchema,
  ProjectLocationValidatedMessageSchema,
  TrustRevokeMessageSchema,
  TrustRevokedMessageSchema,
  MachineErrorMessageSchema,
])
export type MachineWireMessage = z.infer<typeof MachineWireMessageSchema>
