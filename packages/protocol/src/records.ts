import { z } from 'zod'

import { HostErrorSchema } from './errors.js'
import {
  ApprovalIdSchema,
  ConversationIdSchema,
  EpochIdSchema,
  ItemIdSchema,
  ProtocolVersionSchema,
  SnapshotSequenceSchema,
  TimestampSchema,
  TurnIdSchema,
} from './ids.js'

export const ApprovalDecisionSchema = z.enum(['accept', 'decline'])
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>

export const HostCapabilitiesSchema = z
  .object({
    codex: z.boolean(),
    approvals: z.boolean(),
    interrupt: z.boolean(),
    resume: z.boolean(),
    diff: z.boolean(),
    streaming: z.boolean(),
  })
  .strict()
export type HostCapabilities = z.infer<typeof HostCapabilitiesSchema>

export const ConversationStatusSchema = z.enum([
  'idle',
  'running',
  'waiting',
  'completed',
  'failed',
])
export type ConversationStatus = z.infer<typeof ConversationStatusSchema>

export const ConversationRecordSchema = z
  .object({
    conversationId: ConversationIdSchema,
    provider: z.literal('codex'),
    cwd: z.string().trim().min(1).max(4096),
    model: z.string().trim().min(1).max(240).optional(),
    reasoning: z.string().trim().min(1).max(120).optional(),
    status: ConversationStatusSchema,
    activeTurnId: TurnIdSchema.optional(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict()
  .superRefine((conversation, context) => {
    const needsActiveTurn =
      conversation.status === 'running' || conversation.status === 'waiting'
    if (needsActiveTurn !== (conversation.activeTurnId !== undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'Running or waiting Conversations require one active Turn',
        path: ['activeTurnId'],
      })
    }
  })
export type ConversationRecord = z.infer<typeof ConversationRecordSchema>

export const TurnStatusSchema = z.enum([
  'running',
  'completed',
  'failed',
  'interrupted',
])
export type TurnStatus = z.infer<typeof TurnStatusSchema>

export const TurnRecordSchema = z
  .object({
    turnId: TurnIdSchema,
    conversationId: ConversationIdSchema,
    status: TurnStatusSchema,
    startedAt: TimestampSchema,
    completedAt: TimestampSchema.optional(),
    finalMessage: z
      .string()
      .max(1024 * 1024)
      .optional(),
    error: HostErrorSchema.optional(),
  })
  .strict()
  .superRefine((turn, context) => {
    if (turn.status === 'running' && turn.completedAt !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'A running turn cannot have completedAt',
        path: ['completedAt'],
      })
    }
    if (turn.status !== 'running' && turn.completedAt === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'A terminal turn requires completedAt',
        path: ['completedAt'],
      })
    }
    if (turn.status === 'failed' && turn.error === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'A failed turn requires a safe error',
        path: ['error'],
      })
    }
    if (turn.status !== 'failed' && turn.error !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Only a failed turn may include an error',
        path: ['error'],
      })
    }
  })
export type TurnRecord = z.infer<typeof TurnRecordSchema>

export const ApprovalKindSchema = z.enum(['command', 'file-change', 'unknown'])
export type ApprovalKind = z.infer<typeof ApprovalKindSchema>

export const ApprovalStatusSchema = z.enum(['pending', 'resolved'])
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>

export const ApprovalRecordSchema = z
  .object({
    approvalId: ApprovalIdSchema,
    conversationId: ConversationIdSchema,
    turnId: TurnIdSchema,
    itemId: ItemIdSchema.optional(),
    kind: ApprovalKindSchema,
    summary: z.string().trim().min(1).max(4096),
    status: ApprovalStatusSchema,
    decision: ApprovalDecisionSchema.optional(),
    requestedAt: TimestampSchema,
    resolvedAt: TimestampSchema.optional(),
  })
  .strict()
  .superRefine((approval, context) => {
    const resolutionPresent =
      approval.decision !== undefined && approval.resolvedAt !== undefined
    if (approval.status === 'resolved' && !resolutionPresent) {
      context.addIssue({
        code: 'custom',
        message: 'A resolved approval requires decision and resolvedAt',
      })
    }
    if (
      approval.status === 'pending' &&
      (approval.decision !== undefined || approval.resolvedAt !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A pending approval cannot contain resolution fields',
      })
    }
  })
export type ApprovalRecord = z.infer<typeof ApprovalRecordSchema>

export const HostSnapshotSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    epoch: EpochIdSchema,
    currentSeq: SnapshotSequenceSchema,
    conversations: z.array(ConversationRecordSchema),
    activeTurns: z.array(
      TurnRecordSchema.refine((turn) => turn.status === 'running', {
        message: 'activeTurns may only contain running turns',
      }),
    ),
    pendingApprovals: z.array(
      ApprovalRecordSchema.refine((approval) => approval.status === 'pending', {
        message: 'pendingApprovals may only contain pending approvals',
      }),
    ),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const conversations = new Map(
      snapshot.conversations.map((conversation) => [
        conversation.conversationId,
        conversation,
      ]),
    )
    if (conversations.size !== snapshot.conversations.length) {
      addSnapshotIssue(
        context,
        ['conversations'],
        'Conversation IDs must be unique',
      )
    }

    const turns = new Map(
      snapshot.activeTurns.map((turn) => [turn.turnId, turn]),
    )
    if (turns.size !== snapshot.activeTurns.length) {
      addSnapshotIssue(context, ['activeTurns'], 'Turn IDs must be unique')
    }
    for (const [index, turn] of snapshot.activeTurns.entries()) {
      const conversation = conversations.get(turn.conversationId)
      if (conversation?.activeTurnId !== turn.turnId) {
        addSnapshotIssue(
          context,
          ['activeTurns', index],
          'Active Turn must match its Conversation activeTurnId',
        )
      }
    }
    for (const [index, conversation] of snapshot.conversations.entries()) {
      if (
        conversation.activeTurnId !== undefined &&
        !turns.has(conversation.activeTurnId)
      ) {
        addSnapshotIssue(
          context,
          ['conversations', index, 'activeTurnId'],
          'Conversation activeTurnId must exist in activeTurns',
        )
      }
    }

    const approvalIds = new Set(
      snapshot.pendingApprovals.map((approval) => approval.approvalId),
    )
    if (approvalIds.size !== snapshot.pendingApprovals.length) {
      addSnapshotIssue(
        context,
        ['pendingApprovals'],
        'Approval IDs must be unique',
      )
    }
    for (const [index, approval] of snapshot.pendingApprovals.entries()) {
      const conversation = conversations.get(approval.conversationId)
      const turn = turns.get(approval.turnId)
      if (
        conversation?.status !== 'waiting' ||
        conversation.activeTurnId !== approval.turnId ||
        turn?.conversationId !== approval.conversationId
      ) {
        addSnapshotIssue(
          context,
          ['pendingApprovals', index],
          'Pending Approval must belong to an active waiting Turn',
        )
      }
    }
  })
export type HostSnapshot = z.infer<typeof HostSnapshotSchema>

export const BootstrapSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    hostVersion: z.string().trim().min(1).max(120),
    epoch: EpochIdSchema,
    capabilities: HostCapabilitiesSchema,
  })
  .strict()
export type Bootstrap = z.infer<typeof BootstrapSchema>

export const BootstrapResponseSchema = BootstrapSchema
export type BootstrapResponse = Bootstrap

function addSnapshotIssue(
  context: z.RefinementCtx,
  path: Array<string | number>,
  message: string,
): void {
  context.addIssue({ code: 'custom', message, path })
}
