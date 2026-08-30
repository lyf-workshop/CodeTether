import { z } from 'zod'

import {
  ActionIdSchema,
  ProjectIdSchema,
  ProtocolVersionSchema,
} from './ids.js'
import {
  ApprovalDecisionSchema,
  ApprovalRecordSchema,
  AttentionStatusSchema,
  AttentionItemSchema,
  AttentionTypeSchema,
  ConversationRecordSchema,
  ConversationStatusSchema,
  ConversationSummarySchema,
  ManualConversationTitleSchema,
  ProjectRecordSchema,
  TurnInputSchema,
  TurnRecordSchema,
} from './records.js'
import { ProviderIdSchema } from './providers.js'

const CreateConversationByProjectRequestSchema = z
  .object({
    actionId: ActionIdSchema,
    provider: ProviderIdSchema,
    projectId: ProjectIdSchema,
    model: z.string().trim().min(1).max(240).optional(),
    reasoning: z.string().trim().min(1).max(120).optional(),
  })
  .strict()

/**
 * Deprecated Protocol v1 compatibility path. New callers identify the durable
 * Project instead of sending an execution path with every Conversation.
 */
const CreateConversationByLegacyCwdRequestSchema = z
  .object({
    actionId: ActionIdSchema,
    provider: ProviderIdSchema,
    cwd: z.string().trim().min(1).max(4096),
    model: z.string().trim().min(1).max(240).optional(),
    reasoning: z.string().trim().min(1).max(120).optional(),
  })
  .strict()

/** Exactly one workspace locator is accepted; a request can never contain both. */
export const CreateConversationRequestSchema = z.union([
  CreateConversationByProjectRequestSchema,
  CreateConversationByLegacyCwdRequestSchema,
])
export type CreateConversationRequest = z.infer<
  typeof CreateConversationRequestSchema
>

export const CreateProjectRequestSchema = z
  .object({
    actionId: ActionIdSchema,
    name: z.string().trim().min(1).max(240).optional(),
    path: z.string().trim().min(1).max(4096),
  })
  .strict()
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>

export const DeleteProjectRequestSchema = z
  .object({ actionId: ActionIdSchema })
  .strict()
export type DeleteProjectRequest = z.infer<typeof DeleteProjectRequestSchema>

export const ListProjectsResponseSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    projects: z.array(ProjectRecordSchema),
  })
  .strict()
export type ListProjectsResponse = z.infer<typeof ListProjectsResponseSchema>

export const GetProjectResponseSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    project: ProjectRecordSchema,
  })
  .strict()
export type GetProjectResponse = z.infer<typeof GetProjectResponseSchema>

export const conversationListLimits = {
  default: 50,
  maximum: 100,
} as const

export const ConversationArchiveFilterSchema = z.enum(['false', 'true', 'all'])
export type ConversationArchiveFilter = z.infer<
  typeof ConversationArchiveFilterSchema
>

/** Bounded filters for the durable Project-scoped Conversation index. */
export const ListProjectConversationsQuerySchema = z
  .object({
    provider: ProviderIdSchema.optional(),
    status: ConversationStatusSchema.optional(),
    archived: ConversationArchiveFilterSchema.default('false'),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(conversationListLimits.maximum)
      .default(conversationListLimits.default),
  })
  .strict()
export type ListProjectConversationsQueryInput = z.input<
  typeof ListProjectConversationsQuerySchema
>
export type ListProjectConversationsQuery = z.output<
  typeof ListProjectConversationsQuerySchema
>

export const RenameConversationRequestSchema = z
  .object({
    actionId: ActionIdSchema,
    title: ManualConversationTitleSchema,
  })
  .strict()
export type RenameConversationRequest = z.infer<
  typeof RenameConversationRequestSchema
>

export const PinConversationRequestSchema = z
  .object({ actionId: ActionIdSchema })
  .strict()
export type PinConversationRequest = z.infer<
  typeof PinConversationRequestSchema
>

export const UnpinConversationRequestSchema = z
  .object({ actionId: ActionIdSchema })
  .strict()
export type UnpinConversationRequest = z.infer<
  typeof UnpinConversationRequestSchema
>

export const ArchiveConversationRequestSchema = z
  .object({ actionId: ActionIdSchema })
  .strict()
export type ArchiveConversationRequest = z.infer<
  typeof ArchiveConversationRequestSchema
>

export const UnarchiveConversationRequestSchema = z
  .object({ actionId: ActionIdSchema })
  .strict()
export type UnarchiveConversationRequest = z.infer<
  typeof UnarchiveConversationRequestSchema
>

export const ConversationListResponseSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    conversations: z
      .array(ConversationSummarySchema)
      .max(conversationListLimits.maximum),
  })
  .strict()
export type ConversationListResponse = z.infer<
  typeof ConversationListResponseSchema
>

export const attentionListLimits = {
  default: 50,
  maximum: 100,
} as const

/** Bounded filters for the durable global Attention source. */
export const ListAttentionQuerySchema = z
  .object({
    projectId: ProjectIdSchema.optional(),
    type: AttentionTypeSchema.optional(),
    status: AttentionStatusSchema.default('open'),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(attentionListLimits.maximum)
      .default(attentionListLimits.default),
  })
  .strict()
export type ListAttentionQueryInput = z.input<typeof ListAttentionQuerySchema>
export type ListAttentionQuery = z.output<typeof ListAttentionQuerySchema>

export const AttentionListResponseSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    items: z.array(AttentionItemSchema).max(attentionListLimits.maximum),
    summary: z
      .object({
        totalOpen: z.number().int().nonnegative().safe(),
        approvalOpen: z.number().int().nonnegative().safe(),
        completedReviewOpen: z.number().int().nonnegative().safe(),
        failedOpen: z.number().int().nonnegative().safe(),
      })
      .strict(),
  })
  .strict()
  .superRefine((response, context) => {
    const ids = new Set<string>()
    for (const [index, attention] of response.items.entries()) {
      if (ids.has(String(attention.attentionId))) {
        context.addIssue({
          code: 'custom',
          message: 'Attention list cannot contain duplicate identities',
          path: ['items', index, 'attentionId'],
        })
      }
      ids.add(String(attention.attentionId))
    }
    const categorizedTotal =
      response.summary.approvalOpen +
      response.summary.completedReviewOpen +
      response.summary.failedOpen
    if (response.summary.totalOpen !== categorizedTotal) {
      context.addIssue({
        code: 'custom',
        message: 'Attention summary total must equal its type counts',
        path: ['summary', 'totalOpen'],
      })
    }
  })
export type AttentionListResponse = z.infer<typeof AttentionListResponseSchema>

export const StartTurnRequestSchema = z
  .object({
    actionId: ActionIdSchema,
    input: TurnInputSchema,
  })
  .strict()
export type StartTurnRequest = z.infer<typeof StartTurnRequestSchema>

export const InterruptTurnRequestSchema = z
  .object({
    actionId: ActionIdSchema,
  })
  .strict()
export type InterruptTurnRequest = z.infer<typeof InterruptTurnRequestSchema>

export const ResolveApprovalRequestSchema = z
  .object({
    actionId: ActionIdSchema,
    decision: ApprovalDecisionSchema,
  })
  .strict()
export type ResolveApprovalRequest = z.infer<
  typeof ResolveApprovalRequestSchema
>

export const ResolveAttentionRequestSchema = z
  .object({ actionId: ActionIdSchema })
  .strict()
export type ResolveAttentionRequest = z.infer<
  typeof ResolveAttentionRequestSchema
>

export const CreateConversationDataSchema = z
  .object({ conversation: ConversationRecordSchema })
  .strict()
export type CreateConversationData = z.infer<
  typeof CreateConversationDataSchema
>

export const StartTurnDataSchema = z.object({ turn: TurnRecordSchema }).strict()
export type StartTurnData = z.infer<typeof StartTurnDataSchema>

export const InterruptTurnDataSchema = z
  .object({ turn: TurnRecordSchema })
  .strict()
export type InterruptTurnData = z.infer<typeof InterruptTurnDataSchema>

export const ResolveApprovalDataSchema = z
  .object({ approval: ApprovalRecordSchema })
  .strict()
export type ResolveApprovalData = z.infer<typeof ResolveApprovalDataSchema>

export const ResolveAttentionDataSchema = z
  .object({
    attention: AttentionItemSchema.refine(
      (attention) =>
        attention.status === 'resolved' && attention.type !== 'approval',
      'Generic Attention resolution requires a resolved review or failure',
    ),
  })
  .strict()
export type ResolveAttentionData = z.infer<typeof ResolveAttentionDataSchema>

export const CreateProjectDataSchema = z
  .object({ project: ProjectRecordSchema, created: z.boolean() })
  .strict()
export type CreateProjectData = z.infer<typeof CreateProjectDataSchema>

export const DeleteProjectDataSchema = z
  .object({ projectId: ProjectIdSchema })
  .strict()
export type DeleteProjectData = z.infer<typeof DeleteProjectDataSchema>

export const ConversationOrganizationDataSchema = z
  .object({ conversation: ConversationSummarySchema })
  .strict()
export type ConversationOrganizationData = z.infer<
  typeof ConversationOrganizationDataSchema
>

export const MutationStatusSchema = z.enum([
  'accepted',
  'completed',
  'rejected',
])
export type MutationStatus = z.infer<typeof MutationStatusSchema>

function mutationResponseSchema<TData extends z.ZodType>(data: TData) {
  return z
    .object({
      protocolVersion: ProtocolVersionSchema,
      actionId: ActionIdSchema,
      status: MutationStatusSchema,
      data,
    })
    .strict()
}

export const CreateConversationResponseSchema = mutationResponseSchema(
  CreateConversationDataSchema,
)
export type CreateConversationResponse = z.infer<
  typeof CreateConversationResponseSchema
>

export const StartTurnResponseSchema =
  mutationResponseSchema(StartTurnDataSchema)
export type StartTurnResponse = z.infer<typeof StartTurnResponseSchema>

export const InterruptTurnResponseSchema = mutationResponseSchema(
  InterruptTurnDataSchema,
)
export type InterruptTurnResponse = z.infer<typeof InterruptTurnResponseSchema>

export const ResolveApprovalResponseSchema = mutationResponseSchema(
  ResolveApprovalDataSchema,
)
export type ResolveApprovalResponse = z.infer<
  typeof ResolveApprovalResponseSchema
>

export const ResolveAttentionResponseSchema = mutationResponseSchema(
  ResolveAttentionDataSchema,
)
export type ResolveAttentionResponse = z.infer<
  typeof ResolveAttentionResponseSchema
>

export const CreateProjectResponseSchema = mutationResponseSchema(
  CreateProjectDataSchema,
)
export type CreateProjectResponse = z.infer<typeof CreateProjectResponseSchema>

export const DeleteProjectResponseSchema = mutationResponseSchema(
  DeleteProjectDataSchema,
)
export type DeleteProjectResponse = z.infer<typeof DeleteProjectResponseSchema>

export const RenameConversationResponseSchema = mutationResponseSchema(
  ConversationOrganizationDataSchema,
)
export type RenameConversationResponse = z.infer<
  typeof RenameConversationResponseSchema
>

export const PinConversationResponseSchema = mutationResponseSchema(
  ConversationOrganizationDataSchema,
)
export type PinConversationResponse = z.infer<
  typeof PinConversationResponseSchema
>

export const UnpinConversationResponseSchema = mutationResponseSchema(
  ConversationOrganizationDataSchema,
)
export type UnpinConversationResponse = z.infer<
  typeof UnpinConversationResponseSchema
>

export const ArchiveConversationResponseSchema = mutationResponseSchema(
  ConversationOrganizationDataSchema,
)
export type ArchiveConversationResponse = z.infer<
  typeof ArchiveConversationResponseSchema
>

export const UnarchiveConversationResponseSchema = mutationResponseSchema(
  ConversationOrganizationDataSchema,
)
export type UnarchiveConversationResponse = z.infer<
  typeof UnarchiveConversationResponseSchema
>
