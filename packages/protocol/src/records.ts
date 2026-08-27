import { z } from 'zod'

import { HostErrorSchema } from './errors.js'
import {
  ApprovalIdSchema,
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
