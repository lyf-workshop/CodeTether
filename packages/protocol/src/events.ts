import { z } from 'zod'

import { formatLastEventId, LastEventIdSchema } from './cursor.js'
import { HostErrorSchema } from './errors.js'
import {
  ConversationIdSchema,
  EpochIdSchema,
  EventIdSchema,
  EventSequenceSchema,
  ItemIdSchema,
  ProtocolVersionSchema,
  SnapshotSequenceSchema,
  TimestampSchema,
  TurnIdSchema,
} from './ids.js'
import {
  ApprovalRecordSchema,
  AttentionItemSchema,
  ConversationRecordSchema,
  ConversationSummarySchema,
  TurnRecordSchema,
} from './records.js'

export const hostEventTypes = [
  'conversation.started',
  'conversation.updated',
  'turn.started',
  'message.delta',
  'message.completed',
  'tool.started',
  'tool.output',
  'tool.completed',
  'file.changed',
  'approval.requested',
  'approval.resolved',
  'attention.created',
  'attention.resolved',
  'turn.completed',
  'turn.failed',
  'turn.interrupted',
  'stream.reset',
] as const

export const HostEventTypeSchema = z.enum(hostEventTypes)
export type HostEventType = z.infer<typeof HostEventTypeSchema>

export const ConversationStartedPayloadSchema = z
  .object({ conversation: ConversationRecordSchema })
  .strict()
export type ConversationStartedPayload = z.infer<
  typeof ConversationStartedPayloadSchema
>

export const ConversationUpdatedPayloadSchema = z
  .object({ conversation: ConversationSummarySchema })
  .strict()
export type ConversationUpdatedPayload = z.infer<
  typeof ConversationUpdatedPayloadSchema
>

export const TurnStartedPayloadSchema = z
  .object({
    turn: TurnRecordSchema.refine((turn) => turn.status === 'running', {
      message: 'turn.started requires a running turn record',
    }),
  })
  .strict()
export type TurnStartedPayload = z.infer<typeof TurnStartedPayloadSchema>

export const MessageDeltaPayloadSchema = z
  .object({ delta: z.string().max(1024 * 1024) })
  .strict()
export type MessageDeltaPayload = z.infer<typeof MessageDeltaPayloadSchema>

export const MessageCompletedPayloadSchema = z
  .object({ message: z.string().max(1024 * 1024) })
  .strict()
export type MessageCompletedPayload = z.infer<
  typeof MessageCompletedPayloadSchema
>

export const ToolCommandSchema = z.string().max(32 * 1024)
export type ToolCommand = z.infer<typeof ToolCommandSchema>

export const ToolKindSchema = z.enum([
  'read',
  'edit',
  'shell',
  'search',
  'generic',
])
export type ToolKind = z.infer<typeof ToolKindSchema>

export const ToolStartedPayloadSchema = z
  .object({
    /** Additive for legacy Host event compatibility. */
    kind: ToolKindSchema.optional(),
    name: z.string().trim().min(1).max(240),
    command: ToolCommandSchema.optional(),
    summary: z.string().max(4096).optional(),
  })
  .strict()
export type ToolStartedPayload = z.infer<typeof ToolStartedPayloadSchema>

export const ToolOutputStreamSchema = z.enum([
  'stdout',
  'stderr',
  'combined',
  'unknown',
])
export type ToolOutputStream = z.infer<typeof ToolOutputStreamSchema>

export const ToolOutputPayloadSchema = z
  .object({
    output: z.string().max(4 * 1024 * 1024),
    stream: ToolOutputStreamSchema.optional(),
  })
  .strict()
export type ToolOutputPayload = z.infer<typeof ToolOutputPayloadSchema>

export const ToolCompletedPayloadSchema = z
  .object({
    /** Additive for legacy Host event compatibility. */
    kind: ToolKindSchema.optional(),
    name: z.string().trim().min(1).max(240),
    command: ToolCommandSchema.optional(),
    success: z.boolean().optional(),
    summary: z.string().max(4096).optional(),
  })
  .strict()
export type ToolCompletedPayload = z.infer<typeof ToolCompletedPayloadSchema>

export const FileChangeKindSchema = z.enum([
  'added',
  'modified',
  'deleted',
  'renamed',
  'unknown',
])
export type FileChangeKind = z.infer<typeof FileChangeKindSchema>

export const FileChangedPayloadSchema = z
  .object({
    path: z.string().trim().min(1).max(4096),
    kind: FileChangeKindSchema,
    diff: z
      .string()
      .max(4 * 1024 * 1024)
      .optional(),
    additions: z.number().int().nonnegative().safe().optional(),
    deletions: z.number().int().nonnegative().safe().optional(),
  })
  .strict()
export type FileChangedPayload = z.infer<typeof FileChangedPayloadSchema>

export const ApprovalRequestedPayloadSchema = z
  .object({
    approval: ApprovalRecordSchema.refine(
      (approval) => approval.status === 'pending',
      { message: 'approval.requested requires a pending approval record' },
    ),
  })
  .strict()
export type ApprovalRequestedPayload = z.infer<
  typeof ApprovalRequestedPayloadSchema
>

export const ApprovalResolvedPayloadSchema = z
  .object({
    approval: ApprovalRecordSchema.refine(
      (approval) => approval.status === 'resolved',
      { message: 'approval.resolved requires a resolved approval record' },
    ),
  })
  .strict()
export type ApprovalResolvedPayload = z.infer<
  typeof ApprovalResolvedPayloadSchema
>

export const AttentionCreatedPayloadSchema = z
  .object({
    attention: AttentionItemSchema.refine(
      (attention) => attention.status === 'open',
      { message: 'attention.created requires an open Attention record' },
    ),
  })
  .strict()
export type AttentionCreatedPayload = z.infer<
  typeof AttentionCreatedPayloadSchema
>

export const AttentionResolvedPayloadSchema = z
  .object({
    attention: AttentionItemSchema.refine(
      (attention) => attention.status === 'resolved',
      { message: 'attention.resolved requires a resolved Attention record' },
    ),
  })
  .strict()
export type AttentionResolvedPayload = z.infer<
  typeof AttentionResolvedPayloadSchema
>

export const TurnCompletedPayloadSchema = z
  .object({
    finalMessage: z
      .string()
      .max(1024 * 1024)
      .optional(),
  })
  .strict()
export type TurnCompletedPayload = z.infer<typeof TurnCompletedPayloadSchema>

export const TurnFailedPayloadSchema = z
  .object({ error: HostErrorSchema })
  .strict()
export type TurnFailedPayload = z.infer<typeof TurnFailedPayloadSchema>

export const TurnInterruptedPayloadSchema = z
  .object({ reason: z.string().trim().min(1).max(1024).optional() })
  .strict()
export type TurnInterruptedPayload = z.infer<
  typeof TurnInterruptedPayloadSchema
>

export const StreamResetReasonSchema = z.enum([
  'epoch_mismatch',
  'history_evicted',
  'future_cursor',
])
export type StreamResetReason = z.infer<typeof StreamResetReasonSchema>

export const StreamResetPayloadSchema = z
  .object({ reason: StreamResetReasonSchema })
  .strict()
export type StreamResetPayload = z.infer<typeof StreamResetPayloadSchema>

const eventBaseShape = { timestamp: TimestampSchema }
const noTurnIdentityShape = {
  ...eventBaseShape,
  conversationId: ConversationIdSchema,
  turnId: z.never().optional(),
  itemId: z.never().optional(),
}
const turnIdentityShape = {
  ...eventBaseShape,
  conversationId: ConversationIdSchema,
  turnId: TurnIdSchema,
  itemId: z.never().optional(),
}
const itemIdentityShape = {
  ...eventBaseShape,
  conversationId: ConversationIdSchema,
  turnId: TurnIdSchema,
  itemId: ItemIdSchema,
}
const optionalItemIdentityShape = {
  ...eventBaseShape,
  conversationId: ConversationIdSchema,
  turnId: TurnIdSchema,
  itemId: ItemIdSchema.optional(),
}
const attentionIdentityShape = {
  ...eventBaseShape,
  conversationId: ConversationIdSchema,
  turnId: TurnIdSchema.optional(),
  itemId: z.never().optional(),
}
const resetIdentityShape = {
  ...eventBaseShape,
  conversationId: z.null(),
  turnId: z.never().optional(),
  itemId: z.never().optional(),
}

const conversationStartedEventSchema = eventSchema(
  noTurnIdentityShape,
  'conversation.started',
  ConversationStartedPayloadSchema,
)
const conversationUpdatedEventSchema = eventSchema(
  noTurnIdentityShape,
  'conversation.updated',
  ConversationUpdatedPayloadSchema,
)
const turnStartedEventSchema = eventSchema(
  turnIdentityShape,
  'turn.started',
  TurnStartedPayloadSchema,
)
const messageDeltaEventSchema = eventSchema(
  itemIdentityShape,
  'message.delta',
  MessageDeltaPayloadSchema,
)
const messageCompletedEventSchema = eventSchema(
  itemIdentityShape,
  'message.completed',
  MessageCompletedPayloadSchema,
)
const toolStartedEventSchema = eventSchema(
  itemIdentityShape,
  'tool.started',
  ToolStartedPayloadSchema,
)
const toolOutputEventSchema = eventSchema(
  itemIdentityShape,
  'tool.output',
  ToolOutputPayloadSchema,
)
const toolCompletedEventSchema = eventSchema(
  itemIdentityShape,
  'tool.completed',
  ToolCompletedPayloadSchema,
)
const fileChangedEventSchema = eventSchema(
  optionalItemIdentityShape,
  'file.changed',
  FileChangedPayloadSchema,
)
const approvalRequestedEventSchema = eventSchema(
  optionalItemIdentityShape,
  'approval.requested',
  ApprovalRequestedPayloadSchema,
)
const approvalResolvedEventSchema = eventSchema(
  optionalItemIdentityShape,
  'approval.resolved',
  ApprovalResolvedPayloadSchema,
)
const attentionCreatedEventSchema = eventSchema(
  attentionIdentityShape,
  'attention.created',
  AttentionCreatedPayloadSchema,
)
const attentionResolvedEventSchema = eventSchema(
  attentionIdentityShape,
  'attention.resolved',
  AttentionResolvedPayloadSchema,
)
const turnCompletedEventSchema = eventSchema(
  turnIdentityShape,
  'turn.completed',
  TurnCompletedPayloadSchema,
)
const turnFailedEventSchema = eventSchema(
  turnIdentityShape,
  'turn.failed',
  TurnFailedPayloadSchema,
)
const turnInterruptedEventSchema = eventSchema(
  turnIdentityShape,
  'turn.interrupted',
  TurnInterruptedPayloadSchema,
)
const streamResetEventSchema = eventSchema(
  resetIdentityShape,
  'stream.reset',
  StreamResetPayloadSchema,
)

const hostEventOptions = [
  conversationStartedEventSchema,
  conversationUpdatedEventSchema,
  turnStartedEventSchema,
  messageDeltaEventSchema,
  messageCompletedEventSchema,
  toolStartedEventSchema,
  toolOutputEventSchema,
  toolCompletedEventSchema,
  fileChangedEventSchema,
  approvalRequestedEventSchema,
  approvalResolvedEventSchema,
  attentionCreatedEventSchema,
  attentionResolvedEventSchema,
  turnCompletedEventSchema,
  turnFailedEventSchema,
  turnInterruptedEventSchema,
  streamResetEventSchema,
] as const

const HostEventUnionSchema = z.discriminatedUnion('type', hostEventOptions)
type HostEventUnion = z.infer<typeof HostEventUnionSchema>

export const HostEventSchema = HostEventUnionSchema.superRefine(
  validatePayloadIdentity,
)
export type HostEvent = z.infer<typeof HostEventSchema>

const sequencingShape = {
  protocolVersion: ProtocolVersionSchema,
  epoch: EpochIdSchema,
  seq: EventSequenceSchema,
  eventId: EventIdSchema,
}
const sequencedHostEventEnvelopeOptions = [
  conversationStartedEventSchema.extend(sequencingShape),
  conversationUpdatedEventSchema.extend(sequencingShape),
  turnStartedEventSchema.extend(sequencingShape),
  messageDeltaEventSchema.extend(sequencingShape),
  messageCompletedEventSchema.extend(sequencingShape),
  toolStartedEventSchema.extend(sequencingShape),
  toolOutputEventSchema.extend(sequencingShape),
  toolCompletedEventSchema.extend(sequencingShape),
  fileChangedEventSchema.extend(sequencingShape),
  approvalRequestedEventSchema.extend(sequencingShape),
  approvalResolvedEventSchema.extend(sequencingShape),
  attentionCreatedEventSchema.extend(sequencingShape),
  attentionResolvedEventSchema.extend(sequencingShape),
  turnCompletedEventSchema.extend(sequencingShape),
  turnFailedEventSchema.extend(sequencingShape),
  turnInterruptedEventSchema.extend(sequencingShape),
] as const

const streamResetEnvelopeSchema = streamResetEventSchema.extend({
  protocolVersion: ProtocolVersionSchema,
  epoch: EpochIdSchema,
  seq: SnapshotSequenceSchema,
  eventId: LastEventIdSchema,
})

export const HostEventEnvelopeSchema = z
  .discriminatedUnion('type', [
    ...sequencedHostEventEnvelopeOptions,
    streamResetEnvelopeSchema,
  ])
  .superRefine((event, context) => {
    validatePayloadIdentity(event, context)
    if (
      String(event.eventId) !==
      String(formatLastEventId({ epoch: event.epoch, seq: event.seq }))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'eventId must equal <epoch>:<seq>',
        path: ['eventId'],
      })
    }
  })
export type HostEventEnvelope = z.infer<typeof HostEventEnvelopeSchema>

function eventSchema<
  const TType extends HostEventType,
  TIdentity extends z.ZodRawShape,
  TPayload extends z.ZodType,
>(identity: TIdentity, type: TType, payload: TPayload) {
  return z.object({ ...identity, type: z.literal(type), payload }).strict()
}

function validatePayloadIdentity(
  event: HostEventUnion,
  context: z.RefinementCtx,
): void {
  if (
    event.type === 'conversation.started' &&
    event.payload.conversation.conversationId !== event.conversationId
  ) {
    addIdentityIssue(context, ['payload', 'conversation', 'conversationId'])
  }
  if (
    event.type === 'conversation.updated' &&
    event.payload.conversation.conversationId !== event.conversationId
  ) {
    addIdentityIssue(context, ['payload', 'conversation', 'conversationId'])
  }
  if (event.type === 'turn.started') {
    if (event.payload.turn.conversationId !== event.conversationId) {
      addIdentityIssue(context, ['payload', 'turn', 'conversationId'])
    }
    if (event.payload.turn.turnId !== event.turnId) {
      addIdentityIssue(context, ['payload', 'turn', 'turnId'])
    }
  }
  if (
    event.type === 'approval.requested' ||
    event.type === 'approval.resolved'
  ) {
    const approval = event.payload.approval
    if (approval.conversationId !== event.conversationId) {
      addIdentityIssue(context, ['payload', 'approval', 'conversationId'])
    }
    if (approval.turnId !== event.turnId) {
      addIdentityIssue(context, ['payload', 'approval', 'turnId'])
    }
    if (approval.itemId !== event.itemId) {
      addIdentityIssue(context, ['payload', 'approval', 'itemId'])
    }
  }
  if (
    event.type === 'attention.created' ||
    event.type === 'attention.resolved'
  ) {
    const attention = event.payload.attention
    if (attention.conversationId !== event.conversationId) {
      addIdentityIssue(context, ['payload', 'attention', 'conversationId'])
    }
    if (attention.turnId !== event.turnId) {
      addIdentityIssue(context, ['payload', 'attention', 'turnId'])
    }
  }
}

function addIdentityIssue(
  context: z.RefinementCtx,
  path: Array<string | number>,
): void {
  context.addIssue({
    code: 'custom',
    message: 'Payload identity must match its event envelope',
    path,
  })
}
