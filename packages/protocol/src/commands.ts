import { z } from 'zod'

import {
  ActionIdSchema,
  ProjectIdSchema,
  ProtocolVersionSchema,
} from './ids.js'
import {
  ApprovalDecisionSchema,
  ApprovalRecordSchema,
  ConversationRecordSchema,
  ProjectRecordSchema,
  TurnInputSchema,
  TurnRecordSchema,
} from './records.js'

const CreateConversationByProjectRequestSchema = z
  .object({
    actionId: ActionIdSchema,
    provider: z.literal('codex'),
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
    provider: z.literal('codex'),
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

export const CreateProjectDataSchema = z
  .object({ project: ProjectRecordSchema, created: z.boolean() })
  .strict()
export type CreateProjectData = z.infer<typeof CreateProjectDataSchema>

export const DeleteProjectDataSchema = z
  .object({ projectId: ProjectIdSchema })
  .strict()
export type DeleteProjectData = z.infer<typeof DeleteProjectDataSchema>

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

export const CreateProjectResponseSchema = mutationResponseSchema(
  CreateProjectDataSchema,
)
export type CreateProjectResponse = z.infer<typeof CreateProjectResponseSchema>

export const DeleteProjectResponseSchema = mutationResponseSchema(
  DeleteProjectDataSchema,
)
export type DeleteProjectResponse = z.infer<typeof DeleteProjectResponseSchema>
