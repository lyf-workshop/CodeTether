import { z } from 'zod'

import { ProtocolVersionSchema, TimestampSchema } from './ids.js'
import {
  ConversationRuntimeSnapshotSchema,
  conversationRuntimeWireLimits,
} from './runtime-history.js'
import { ApprovalRecordSchema, ConversationSummarySchema } from './records.js'
import { ProviderInstallationSummarySchema } from './provider-lifecycle.js'

export const conversationDetailWireLimits = {
  pendingApprovals: 64,
  approvalHistory: 2048,
} as const

export const DurableConversationHistoryMetadataSchema = z
  .object({
    hasOlderHistory: z.boolean(),
    retainedTurnCount: z
      .number()
      .int()
      .nonnegative()
      .max(conversationRuntimeWireLimits.turns),
    totalTurnCount: z.number().int().nonnegative().safe(),
  })
  .strict()
  .superRefine((history, context) => {
    if (history.retainedTurnCount > history.totalTurnCount) {
      addIssue(
        context,
        ['retainedTurnCount'],
        'Retained Turn count cannot exceed total Turn count',
      )
    }
    if (
      history.hasOlderHistory !==
      history.totalTurnCount > history.retainedTurnCount
    ) {
      addIssue(
        context,
        ['hasOlderHistory'],
        'Older-history state must agree with retained and total Turn counts',
      )
    }
  })
export type DurableConversationHistoryMetadata = z.infer<
  typeof DurableConversationHistoryMetadataSchema
>

const ResolvedApprovalHistoryRecordSchema = z
  .object({
    lifecycle: z.literal('resolved'),
    approval: ApprovalRecordSchema.refine(
      (approval) => approval.status === 'resolved',
      'Resolved Approval history requires a resolved Approval record',
    ),
  })
  .strict()

const ExpiredApprovalHistoryRecordSchema = z
  .object({
    lifecycle: z.literal('expired'),
    approval: ApprovalRecordSchema.refine(
      (approval) => approval.status === 'pending',
      'Expired Approval history preserves its original pending record',
    ),
    expiredAt: TimestampSchema,
    reason: z.literal('host_restart'),
  })
  .strict()

/** Durable, presentation-safe Approval history that is never actionable. */
export const ConversationApprovalHistoryRecordSchema = z.discriminatedUnion(
  'lifecycle',
  [ResolvedApprovalHistoryRecordSchema, ExpiredApprovalHistoryRecordSchema],
)
export type ConversationApprovalHistoryRecord = z.infer<
  typeof ConversationApprovalHistoryRecordSchema
>

const PendingApprovalSchema = ApprovalRecordSchema.refine(
  (approval) => approval.status === 'pending',
  'Pending Approvals must contain pending Approval records',
)

/**
 * One durable product Conversation read. Timeline presentation reuses the
 * existing bounded runtime snapshot rather than defining another Item model.
 */
export const GetConversationResponseSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    conversation: ConversationSummarySchema,
    /**
     * Additive Phase 8B projection of the Conversation's private installation
     * binding. Exact executable paths and locator material remain private.
     */
    providerLifecycle: ProviderInstallationSummarySchema.optional(),
    /** True only when the next Turn must reopen an existing native session. */
    providerSessionRequiresResume: z.boolean().optional(),
    runtime: ConversationRuntimeSnapshotSchema,
    history: DurableConversationHistoryMetadataSchema,
    pendingApprovals: z
      .array(PendingApprovalSchema)
      .max(conversationDetailWireLimits.pendingApprovals),
    approvalHistory: z
      .array(ConversationApprovalHistoryRecordSchema)
      .max(conversationDetailWireLimits.approvalHistory),
  })
  .strict()
  .superRefine(validateConversationDetail)
export type GetConversationResponse = z.infer<
  typeof GetConversationResponseSchema
>

function validateConversationDetail(
  detail: z.infer<typeof GetConversationResponseSchema>,
  context: z.RefinementCtx,
): void {
  const conversationId = detail.conversation.conversationId
  if (
    detail.providerLifecycle !== undefined &&
    detail.providerLifecycle.provider !== detail.conversation.provider
  ) {
    addIssue(
      context,
      ['providerLifecycle', 'provider'],
      'Bound Provider lifecycle must match the Conversation Provider',
    )
  }
  if (detail.runtime.conversationId !== conversationId) {
    addIssue(
      context,
      ['runtime', 'conversationId'],
      'Conversation runtime must belong to the response Conversation',
    )
  }
  if (detail.history.retainedTurnCount !== detail.runtime.turns.length) {
    addIssue(
      context,
      ['history', 'retainedTurnCount'],
      'Retained Turn count must match the bounded runtime history',
    )
  }

  const retainedTurns = new Map(
    detail.runtime.turns.map((turn) => [String(turn.turnId), turn]),
  )
  const approvalIds = new Set<string>()
  for (const [index, approval] of detail.pendingApprovals.entries()) {
    validateApprovalIdentity(
      approval,
      ['pendingApprovals', index],
      conversationId,
      retainedTurns,
      approvalIds,
      context,
    )
    if (retainedTurns.get(String(approval.turnId))?.status !== 'running') {
      addIssue(
        context,
        ['pendingApprovals', index, 'turnId'],
        'An actionable Approval must belong to a retained running Turn',
      )
    }
  }
  if (
    detail.pendingApprovals.length > 0 &&
    detail.conversation.status !== 'waiting'
  ) {
    addIssue(
      context,
      ['conversation', 'status'],
      'A Conversation with actionable Approvals must be waiting',
    )
  }

  for (const [index, history] of detail.approvalHistory.entries()) {
    validateApprovalIdentity(
      history.approval,
      ['approvalHistory', index, 'approval'],
      conversationId,
      retainedTurns,
      approvalIds,
      context,
    )
  }
}

function validateApprovalIdentity(
  approval: z.infer<typeof ApprovalRecordSchema>,
  path: Array<string | number>,
  conversationId: string,
  retainedTurns: ReadonlyMap<string, unknown>,
  approvalIds: Set<string>,
  context: z.RefinementCtx,
): void {
  if (approval.conversationId !== conversationId) {
    addIssue(
      context,
      [...path, 'conversationId'],
      'Approval must belong to the response Conversation',
    )
  }
  if (!retainedTurns.has(String(approval.turnId))) {
    addIssue(
      context,
      [...path, 'turnId'],
      'Approval must belong to a retained Turn',
    )
  }
  const id = String(approval.approvalId)
  if (approvalIds.has(id)) {
    addIssue(
      context,
      [...path, 'approvalId'],
      'Approval IDs must be unique across current and historical records',
    )
  }
  approvalIds.add(id)
}

function addIssue(
  context: z.RefinementCtx,
  path: Array<string | number>,
  message: string,
): void {
  context.addIssue({ code: 'custom', path, message })
}
