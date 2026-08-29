import { z } from 'zod'

import { HostErrorSchema } from './errors.js'
import {
  ApprovalIdSchema,
  AttentionIdSchema,
  ConversationIdSchema,
  EpochIdSchema,
  ItemIdSchema,
  ProjectIdSchema,
  ProtocolVersionSchema,
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

export const ProjectAvailabilitySchema = z.enum(['available', 'unavailable'])
export type ProjectAvailability = z.infer<typeof ProjectAvailabilitySchema>

export const ConversationTitleSchema = z.string().trim().min(1).max(240)
export type ConversationTitle = z.infer<typeof ConversationTitleSchema>

export const manualConversationTitleLimits = {
  codeUnits: 240,
  graphemes: 160,
} as const

/**
 * Manual title input is canonicalized once at the Protocol boundary. It never
 * truncates: callers receive `invalid_request` when either public wire bound is
 * exceeded.
 */
export const ManualConversationTitleSchema = z
  .string()
  .transform((value) => value.normalize('NFC').replace(/\s+/gu, ' ').trim())
  .pipe(
    z
      .string()
      .min(1)
      .max(manualConversationTitleLimits.codeUnits)
      .refine(
        (value) =>
          countGraphemes(value) <= manualConversationTitleLimits.graphemes,
        `Conversation title cannot exceed ${String(manualConversationTitleLimits.graphemes)} graphemes`,
      ),
  )
export type ManualConversationTitle = z.infer<
  typeof ManualConversationTitleSchema
>

export const ConversationTitleSourceSchema = z.enum(['generated', 'manual'])
export type ConversationTitleSource = z.infer<
  typeof ConversationTitleSourceSchema
>

export const ProjectRecordSchema = z
  .object({
    projectId: ProjectIdSchema,
    name: z.string().trim().min(1).max(240),
    rootPath: z.string().trim().min(1).max(4096),
    availability: ProjectAvailabilitySchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict()
export type ProjectRecord = z.infer<typeof ProjectRecordSchema>

export const ConversationRecordSchema = z
  .object({
    conversationId: ConversationIdSchema,
    /**
     * Additive in Protocol v1 so legacy persisted records remain readable.
     * Current Project-aware Hosts populate this for every Conversation.
     */
    projectId: ProjectIdSchema.optional(),
    /** Additive in Protocol v1; current title-aware Hosts always populate it. */
    title: ConversationTitleSchema.optional(),
    /** Additive organization metadata; current organization-aware Hosts populate it. */
    titleSource: ConversationTitleSourceSchema.optional(),
    /** Product organization metadata; absence means the Conversation is not pinned. */
    pinnedAt: TimestampSchema.optional(),
    /** Product organization metadata; absence means the Conversation is active. */
    archivedAt: TimestampSchema.optional(),
    provider: z.literal('codex'),
    cwd: z.string().trim().min(1).max(4096),
    model: z.string().trim().min(1).max(240).optional(),
    reasoning: z.string().trim().min(1).max(120).optional(),
    status: ConversationStatusSchema,
    activeTurnId: TurnIdSchema.optional(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    /** Product activity clock; metadata-only updates must not advance it. */
    lastActivityAt: TimestampSchema.optional(),
  })
  .strict()
  .superRefine((conversation, context) => {
    if (
      conversation.titleSource !== undefined &&
      conversation.title === undefined
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A Conversation title source requires a title',
        path: ['titleSource'],
      })
    }
    if (
      conversation.pinnedAt !== undefined &&
      conversation.archivedAt !== undefined
    ) {
      context.addIssue({
        code: 'custom',
        message: 'An archived Conversation cannot remain pinned',
        path: ['pinnedAt'],
      })
    }
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

/**
 * Durable product-history record returned by the Project-scoped Conversation
 * index. Provider routing and workspace authorization metadata intentionally
 * remain private to the Host.
 */
export const ConversationSummarySchema = z
  .object({
    conversationId: ConversationIdSchema,
    projectId: ProjectIdSchema,
    title: ConversationTitleSchema,
    titleSource: ConversationTitleSourceSchema,
    pinnedAt: TimestampSchema.optional(),
    archivedAt: TimestampSchema.optional(),
    provider: z.literal('codex'),
    model: z.string().trim().min(1).max(240).optional(),
    reasoning: z.string().trim().min(1).max(120).optional(),
    status: ConversationStatusSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    lastActivityAt: TimestampSchema,
  })
  .strict()
  .refine(
    (conversation) =>
      conversation.pinnedAt === undefined ||
      conversation.archivedAt === undefined,
    {
      message: 'An archived Conversation cannot remain pinned',
      path: ['pinnedAt'],
    },
  )
export type ConversationSummary = z.infer<typeof ConversationSummarySchema>

export const TurnStatusSchema = z.enum([
  'running',
  'completed',
  'failed',
  'interrupted',
])
export type TurnStatus = z.infer<typeof TurnStatusSchema>

/** Canonical text input accepted by the current Protocol v1 Turn command. */
export const TurnInputSchema = z
  .object({
    type: z.literal('text'),
    text: z
      .string()
      .min(1)
      .max(1024 * 1024)
      .refine((value) => value.trim().length > 0, {
        message: 'Turn input must contain non-whitespace text',
      }),
  })
  .strict()
export type TurnInput = z.infer<typeof TurnInputSchema>

/** Host-owned input with the timestamp assigned when the Turn is recorded. */
export const TurnInputRecordSchema = TurnInputSchema.extend({
  timestamp: TimestampSchema,
}).strict()
export type TurnInputRecord = z.infer<typeof TurnInputRecordSchema>

export const TurnRecordSchema = z
  .object({
    turnId: TurnIdSchema,
    conversationId: ConversationIdSchema,
    status: TurnStatusSchema,
    input: TurnInputRecordSchema.optional(),
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

export const AttentionTypeSchema = z.enum([
  'approval',
  'completed_review',
  'failed',
])
export type AttentionType = z.infer<typeof AttentionTypeSchema>

export const AttentionStatusSchema = z.enum(['open', 'resolved', 'expired'])
export type AttentionStatus = z.infer<typeof AttentionStatusSchema>

export const ApprovalAttentionPayloadSchema = z
  .object({
    approvalId: ApprovalIdSchema,
    kind: ApprovalKindSchema,
    actionTitle: z.string().trim().min(1).max(240),
    actionSubtitle: z.string().trim().min(1).max(4096).optional(),
    decision: ApprovalDecisionSchema.optional(),
    expirationReason: z.literal('host_restart').optional(),
  })
  .strict()
export type ApprovalAttentionPayload = z.infer<
  typeof ApprovalAttentionPayloadSchema
>

export const CompletedReviewAttentionPayloadSchema = z
  .object({
    conversationTitle: ConversationTitleSchema,
  })
  .strict()
export type CompletedReviewAttentionPayload = z.infer<
  typeof CompletedReviewAttentionPayloadSchema
>

/** Safe terminal failure presentation without raw Provider diagnostics. */
export const FailedAttentionPayloadSchema = z
  .object({
    conversationTitle: ConversationTitleSchema,
    error: HostErrorSchema,
  })
  .strict()
export type FailedAttentionPayload = z.infer<
  typeof FailedAttentionPayloadSchema
>

const attentionBaseShape = {
  attentionId: AttentionIdSchema,
  projectId: ProjectIdSchema,
  conversationId: ConversationIdSchema,
  turnId: TurnIdSchema.optional(),
  status: AttentionStatusSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  resolvedAt: TimestampSchema.optional(),
}

/** Durable, presentation-safe Inbox source owned by the Host. */
export const AttentionItemSchema = z
  .discriminatedUnion('type', [
    z
      .object({
        ...attentionBaseShape,
        type: z.literal('approval'),
        payload: ApprovalAttentionPayloadSchema,
      })
      .strict(),
    z
      .object({
        ...attentionBaseShape,
        type: z.literal('completed_review'),
        payload: CompletedReviewAttentionPayloadSchema,
      })
      .strict(),
    z
      .object({
        ...attentionBaseShape,
        type: z.literal('failed'),
        payload: FailedAttentionPayloadSchema,
      })
      .strict(),
  ])
  .superRefine((attention, context) => {
    if (attention.type !== 'approval' && attention.status === 'expired') {
      context.addIssue({
        code: 'custom',
        message: 'Only Approval Attention may expire in Protocol v1',
        path: ['status'],
      })
    }
    const isTerminal = attention.status !== 'open'
    if (isTerminal !== (attention.resolvedAt !== undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'Terminal Attention requires resolvedAt',
        path: ['resolvedAt'],
      })
    }
    if (attention.type !== 'approval') return

    const hasDecision = attention.payload.decision !== undefined
    const hasExpiration = attention.payload.expirationReason !== undefined
    if (attention.status === 'open' && (hasDecision || hasExpiration)) {
      context.addIssue({
        code: 'custom',
        message: 'Open Approval Attention cannot contain a terminal outcome',
        path: ['payload'],
      })
    }
    if (attention.status === 'resolved' && (!hasDecision || hasExpiration)) {
      context.addIssue({
        code: 'custom',
        message: 'Resolved Approval Attention requires only a decision',
        path: ['payload'],
      })
    }
    if (attention.status === 'expired' && (hasDecision || !hasExpiration)) {
      context.addIssue({
        code: 'custom',
        message: 'Expired Approval Attention requires only expirationReason',
        path: ['payload'],
      })
    }
  })
export type AttentionItem = z.infer<typeof AttentionItemSchema>

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

function countGraphemes(value: string): number {
  return [
    ...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(value),
  ].length
}
