import { randomUUID } from 'node:crypto'

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

function compactUuid(): string {
  return randomUUID().replaceAll('-', '')
}
