import { z } from 'zod'

import { ActionIdSchema, ProtocolVersionSchema } from './ids.js'
import {
  ApprovalDecisionSchema,
  ApprovalRecordSchema,
  ConversationRecordSchema,
  TurnRecordSchema,
} from './records.js'

export const CreateConversationRequestSchema = z
  .object({
    actionId: ActionIdSchema,
    provider: z.literal('codex'),
    cwd: z.string().trim().min(1).max(4096),
    model: z.string().trim().min(1).max(240).optional(),
    reasoning: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
export type CreateConversationRequest = z.infer<
  typeof CreateConversationRequestSchema
>

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
