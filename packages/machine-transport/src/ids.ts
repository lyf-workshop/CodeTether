import { createHash, randomUUID } from 'node:crypto'

import { z } from 'zod'

export const MachineTransportMachineIdSchema = z
  .string()
  .regex(/^machine_[A-Za-z0-9][A-Za-z0-9_-]{5,95}$/)
export type MachineTransportMachineId = z.infer<
  typeof MachineTransportMachineIdSchema
>

export const NodeIdSchema = z
  .string()
  .regex(/^node_[A-Za-z0-9][A-Za-z0-9_-]{5,95}$/)
export type NodeId = z.infer<typeof NodeIdSchema>

export const ControllerIdSchema = z
  .string()
  .regex(/^controller_[A-Za-z0-9][A-Za-z0-9_-]{5,95}$/)
export type ControllerId = z.infer<typeof ControllerIdSchema>

export const PairingAttemptIdSchema = z
  .string()
  .regex(/^pairing_[A-Za-z0-9][A-Za-z0-9_-]{5,95}$/)
export type PairingAttemptId = z.infer<typeof PairingAttemptIdSchema>

export const MachineTransportConversationIdSchema = z
  .string()
  .regex(/^conv_[A-Za-z0-9][A-Za-z0-9_-]{5,95}$/)
export type MachineTransportConversationId = z.infer<
  typeof MachineTransportConversationIdSchema
>

export const MachineTransportProjectIdSchema = z
  .string()
  .regex(/^proj_[A-Za-z0-9][A-Za-z0-9_-]{5,95}$/)
export type MachineTransportProjectId = z.infer<
  typeof MachineTransportProjectIdSchema
>

export const MachineTransportActionIdSchema = z
  .string()
  .regex(/^act_[A-Za-z0-9][A-Za-z0-9_-]{5,95}$/)
export type MachineTransportActionId = z.infer<
  typeof MachineTransportActionIdSchema
>

export const MachineTransportTurnIdSchema = z
  .string()
  .regex(/^turn_[A-Za-z0-9][A-Za-z0-9_-]{5,95}$/)
export type MachineTransportTurnId = z.infer<
  typeof MachineTransportTurnIdSchema
>

/** Opaque Machine-scoped Provider installation identity. */
export const ProviderInstallationIdSchema = z
  .string()
  .regex(/^pinst_[A-Za-z0-9][A-Za-z0-9_-]{5,95}$/)
export type ProviderInstallationId = z.infer<
  typeof ProviderInstallationIdSchema
>

/** Opaque revision identity; the private executable digest never crosses TLS. */
export const ProviderInstallationRevisionSchema = z
  .string()
  .regex(/^prev_[A-Za-z0-9][A-Za-z0-9_-]{5,95}$/)
export type ProviderInstallationRevision = z.infer<
  typeof ProviderInstallationRevisionSchema
>

export const ProviderBackendConfigurationRevisionSchema = z
  .string()
  .regex(/^pbcfg_[A-Za-z0-9][A-Za-z0-9_-]{5,95}$/)
export type ProviderBackendConfigurationRevision = z.infer<
  typeof ProviderBackendConfigurationRevisionSchema
>

export function newMachineTransportMachineId(): MachineTransportMachineId {
  return MachineTransportMachineIdSchema.parse(`machine_${compactUuid()}`)
}

export function newNodeId(): NodeId {
  return NodeIdSchema.parse(`node_${compactUuid()}`)
}

export function newControllerId(): ControllerId {
  return ControllerIdSchema.parse(`controller_${compactUuid()}`)
}

export function newPairingAttemptId(): PairingAttemptId {
  return PairingAttemptIdSchema.parse(`pairing_${compactUuid()}`)
}

export function providerInstallationIdFor(
  machineId: MachineTransportMachineId,
  provider: 'codex' | 'claude-code',
  privateLogicalIdentity: string,
): ProviderInstallationId {
  if (
    privateLogicalIdentity.length === 0 ||
    privateLogicalIdentity.includes('\0')
  ) {
    throw new TypeError('Provider installation logical identity is invalid')
  }
  return ProviderInstallationIdSchema.parse(
    `pinst_${scopedDigest(machineId, provider, privateLogicalIdentity, 'identity')}`,
  )
}

export function providerInstallationRevisionFor(
  machineId: MachineTransportMachineId,
  provider: 'codex' | 'claude-code',
  privateRevision: string,
): ProviderInstallationRevision {
  if (privateRevision.length === 0 || privateRevision.includes('\0')) {
    throw new TypeError('Provider installation private revision is invalid')
  }
  return ProviderInstallationRevisionSchema.parse(
    `prev_${scopedDigest(machineId, provider, privateRevision, 'revision')}`,
  )
}

export function providerBackendConfigurationRevisionFor(
  machineId: MachineTransportMachineId,
  provider: 'codex' | 'claude-code',
  privateRevision: string,
): ProviderBackendConfigurationRevision {
  if (privateRevision.length === 0 || privateRevision.includes('\0')) {
    throw new TypeError('Provider backend private revision is invalid')
  }
  return ProviderBackendConfigurationRevisionSchema.parse(
    `pbcfg_${scopedDigest(machineId, provider, privateRevision, 'backend')}`,
  )
}

function scopedDigest(
  machineId: MachineTransportMachineId,
  provider: string,
  privateValue: string,
  purpose: string,
): string {
  const digest = createHash('sha256')
    .update(`codetether-provider-installation-${purpose}-v1\0`)
    .update(machineId)
    .update('\0')
    .update(provider)
    .update('\0')
    .update(privateValue)
    .digest('base64url')
  // A base64url digest can legitimately begin with `-` or `_`, while public
  // opaque-ID schemas deliberately require an alphanumeric first payload
  // character. Namespace the digest with a fixed letter so identity creation
  // is deterministic for every hash output rather than failing ~3% of inputs.
  return `x${digest}`
}

function compactUuid(): string {
  return randomUUID().replaceAll('-', '')
}
