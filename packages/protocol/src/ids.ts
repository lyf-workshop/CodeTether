import { z } from 'zod'

export const protocolVersion = 1 as const
export const ProtocolVersionSchema = z.literal(protocolVersion)
export type ProtocolVersion = z.infer<typeof ProtocolVersionSchema>

export const ConversationIdSchema = z
  .string()
  .regex(/^conv_[A-Za-z0-9][A-Za-z0-9_-]{5,95}$/)
  .brand<'ConversationId'>()
export type ConversationId = z.infer<typeof ConversationIdSchema>

export const ProjectIdSchema = z
  .string()
  .regex(/^proj_[A-Za-z0-9][A-Za-z0-9_-]{5,95}$/)
  .brand<'ProjectId'>()
export type ProjectId = z.infer<typeof ProjectIdSchema>

export const MachineIdSchema = z
  .string()
  .regex(/^machine_[A-Za-z0-9][A-Za-z0-9_-]{5,95}$/)
  .brand<'MachineId'>()
export type MachineId = z.infer<typeof MachineIdSchema>

export const MachinePairingAttemptIdSchema = z
  .string()
  .regex(/^pairing_[A-Za-z0-9][A-Za-z0-9_-]{5,95}$/)
  .brand<'MachinePairingAttemptId'>()
export type MachinePairingAttemptId = z.infer<
  typeof MachinePairingAttemptIdSchema
>

export const ActionIdSchema = z
  .string()
  .regex(/^act_[A-Za-z0-9][A-Za-z0-9_-]{5,95}$/)
  .brand<'ActionId'>()
export type ActionId = z.infer<typeof ActionIdSchema>

export const EpochIdSchema = z.uuid().brand<'EpochId'>()
export type EpochId = z.infer<typeof EpochIdSchema>

export const TurnIdSchema = z
  .string()
  .regex(/^turn_[A-Za-z0-9][A-Za-z0-9_-]{5,95}$/)
  .brand<'TurnId'>()
export type TurnId = z.infer<typeof TurnIdSchema>

export const ItemIdSchema = z
  .string()
  .regex(/^item_[A-Za-z0-9][A-Za-z0-9_-]{5,95}$/)
  .brand<'ItemId'>()
export type ItemId = z.infer<typeof ItemIdSchema>

export const ApprovalIdSchema = z
  .string()
  .regex(/^approval_[A-Za-z0-9][A-Za-z0-9_-]{5,95}$/)
  .brand<'ApprovalId'>()
export type ApprovalId = z.infer<typeof ApprovalIdSchema>

export const AttentionIdSchema = z
  .string()
  .regex(/^attn_[A-Za-z0-9][A-Za-z0-9_-]{5,95}$/)
  .brand<'AttentionId'>()
export type AttentionId = z.infer<typeof AttentionIdSchema>

export const maximumTimestampCharacters = 64 as const
export const TimestampSchema = z.iso
  .datetime({ offset: true })
  .max(maximumTimestampCharacters)
export type Timestamp = z.infer<typeof TimestampSchema>

export const EventSequenceSchema = z.number().int().positive().safe()
export type EventSequence = z.infer<typeof EventSequenceSchema>

const EVENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[1-9][0-9]*$/i

/** Stable SSE identity and replay cursor: `<epoch UUID>:<host-global seq>`. */
export const EventIdSchema = z
  .string()
  .regex(EVENT_ID_PATTERN)
  .refine((value) => {
    const separator = value.lastIndexOf(':')
    return EventSequenceSchema.safeParse(Number(value.slice(separator + 1)))
      .success
  }, 'EventId sequence must be a safe positive integer')
  .brand<'EventId'>()
export type EventId = z.infer<typeof EventIdSchema>

export const SnapshotSequenceSchema = z.number().int().nonnegative().safe()
export type SnapshotSequence = z.infer<typeof SnapshotSequenceSchema>
