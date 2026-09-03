import { z } from 'zod'

import {
  ActionIdSchema,
  MachineIdSchema,
  MachinePairingAttemptIdSchema,
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
import {
  MachineProviderDiscoverySchema,
  ProjectLocationSchema,
  RemoteMachineConnectionSchema,
  MachineSummarySchema,
  RemoteMachineAddressSchema,
  RemoteMachinePairingCandidateSchema,
  RemoteMachinePairingCodeSchema,
  machineWireLimits,
} from './machines.js'
import { ProviderDescriptorSchema, ProviderIdSchema } from './providers.js'
import { RelayMachineConnectivitySchema } from './relay.js'

const CreateConversationByProjectRequestSchema = z
  .object({
    actionId: ActionIdSchema,
    machineId: MachineIdSchema,
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
    machineId: MachineIdSchema,
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

/**
 * Registers one purpose-specific workspace location for an existing logical
 * Project. The selected trusted Machine remains responsible for canonical
 * path validation; callers cannot use this request as a generic filesystem
 * operation.
 */
export const RegisterProjectLocationRequestSchema = z
  .object({
    actionId: ActionIdSchema,
    machineId: MachineIdSchema,
    path: z.string().trim().min(1).max(4096),
  })
  .strict()
export type RegisterProjectLocationRequest = z.infer<
  typeof RegisterProjectLocationRequestSchema
>

/** Removes only the Controller-owned Project/Machine location association. */
export const RemoveProjectLocationRequestSchema = z
  .object({ actionId: ActionIdSchema })
  .strict()
export type RemoveProjectLocationRequest = z.infer<
  typeof RemoveProjectLocationRequestSchema
>

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

export const ListMachinesResponseSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    machines: z.array(MachineSummarySchema).max(machineWireLimits.machines),
  })
  .strict()
  .superRefine((response, context) => {
    const machineIds = new Set<string>()
    for (const [index, machine] of response.machines.entries()) {
      if (machineIds.has(String(machine.machineId))) {
        context.addIssue({
          code: 'custom',
          message: 'Machine list identities must be unique',
          path: ['machines', index, 'machineId'],
        })
      }
      machineIds.add(String(machine.machineId))
    }
  })
export type ListMachinesResponse = z.infer<typeof ListMachinesResponseSchema>

export const GetMachineResponseSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    machine: MachineSummarySchema,
    providers: z
      .array(ProviderDescriptorSchema)
      .max(machineWireLimits.providers),
    projects: z.array(ProjectRecordSchema).max(machineWireLimits.projects),
    conversations: z
      .array(ConversationSummarySchema)
      .max(machineWireLimits.recentConversations),
    connection: RemoteMachineConnectionSchema.optional(),
    providerDiscovery: MachineProviderDiscoverySchema.optional(),
    relay: RelayMachineConnectivitySchema.optional(),
  })
  .strict()
  .superRefine((response, context) => {
    const machineId = response.machine.machineId
    if (
      (response.machine.kind === 'local' &&
        response.connection !== undefined) ||
      (response.machine.kind === 'remote' && response.connection === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Connection detail must be present only for remote Machines',
        path: ['connection'],
      })
    }
    if (
      response.connection !== undefined &&
      response.connection.state !== response.machine.connectionState
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Machine summary and connection detail states must agree',
        path: ['connection', 'state'],
      })
    }
    if (
      (response.machine.kind === 'local' &&
        response.providerDiscovery !== undefined) ||
      (response.machine.kind === 'remote' &&
        response.providerDiscovery === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Provider discovery metadata must be present only for remote Machines',
        path: ['providerDiscovery'],
      })
    }
    if (
      response.providerDiscovery?.state === 'not_observed' &&
      response.providers.length > 0
    ) {
      context.addIssue({
        code: 'custom',
        message: 'An unobserved remote Machine cannot expose Provider results',
        path: ['providers'],
      })
    }
    if (
      response.providerDiscovery?.state === 'current' &&
      response.machine.connectionState !== 'online'
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Current remote Provider discovery requires an authenticated online Machine',
        path: ['providerDiscovery', 'state'],
      })
    }
    if (response.machine.kind === 'local' && response.relay !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Relay connectivity must be present only for remote Machines',
        path: ['relay'],
      })
    }
    const providerIds = new Set<string>()
    for (const [index, provider] of response.providers.entries()) {
      if (providerIds.has(provider.provider)) {
        context.addIssue({
          code: 'custom',
          message: 'Machine Provider identities must be unique',
          path: ['providers', index, 'provider'],
        })
      }
      providerIds.add(provider.provider)
    }

    const projectIds = new Set<string>()
    for (const [projectIndex, project] of response.projects.entries()) {
      if (projectIds.has(String(project.projectId))) {
        context.addIssue({
          code: 'custom',
          message: 'Machine Project identities must be unique',
          path: ['projects', projectIndex, 'projectId'],
        })
      }
      projectIds.add(String(project.projectId))
      for (const [locationIndex, location] of project.locations.entries()) {
        if (location.machineId !== machineId) {
          context.addIssue({
            code: 'custom',
            message:
              'Machine Projects must contain only locations on that Machine',
            path: [
              'projects',
              projectIndex,
              'locations',
              locationIndex,
              'machineId',
            ],
          })
        }
      }
    }

    const conversationIds = new Set<string>()
    for (const [index, conversation] of response.conversations.entries()) {
      if (conversation.machineId !== machineId) {
        context.addIssue({
          code: 'custom',
          message: 'Machine Conversations must execute on the response Machine',
          path: ['conversations', index, 'machineId'],
        })
      }
      if (conversationIds.has(String(conversation.conversationId))) {
        context.addIssue({
          code: 'custom',
          message: 'Machine Conversation identities must be unique',
          path: ['conversations', index, 'conversationId'],
        })
      }
      conversationIds.add(String(conversation.conversationId))
    }
  })
export type GetMachineResponse = z.infer<typeof GetMachineResponseSchema>

export const BeginRemoteMachinePairingRequestSchema = z
  .object({
    actionId: ActionIdSchema,
    address: RemoteMachineAddressSchema,
    pairingCode: RemoteMachinePairingCodeSchema,
  })
  .strict()
export type BeginRemoteMachinePairingRequest = z.infer<
  typeof BeginRemoteMachinePairingRequestSchema
>

export const ConfirmRemoteMachinePairingRequestSchema = z
  .object({ actionId: ActionIdSchema })
  .strict()
export type ConfirmRemoteMachinePairingRequest = z.infer<
  typeof ConfirmRemoteMachinePairingRequestSchema
>

export const CancelRemoteMachinePairingRequestSchema = z
  .object({ actionId: ActionIdSchema })
  .strict()
export type CancelRemoteMachinePairingRequest = z.infer<
  typeof CancelRemoteMachinePairingRequestSchema
>

export const UnpairMachineRequestSchema = z
  .object({ actionId: ActionIdSchema })
  .strict()
export type UnpairMachineRequest = z.infer<typeof UnpairMachineRequestSchema>

export const RetryMachineConnectionRequestSchema = z
  .object({ actionId: ActionIdSchema })
  .strict()
export type RetryMachineConnectionRequest = z.infer<
  typeof RetryMachineConnectionRequestSchema
>

export const RefreshMachineProvidersRequestSchema = z
  .object({ actionId: ActionIdSchema })
  .strict()
export type RefreshMachineProvidersRequest = z.infer<
  typeof RefreshMachineProvidersRequestSchema
>

export const UpdateMachineConnectionAddressRequestSchema = z
  .object({
    actionId: ActionIdSchema,
    address: RemoteMachineAddressSchema,
  })
  .strict()
export type UpdateMachineConnectionAddressRequest = z.infer<
  typeof UpdateMachineConnectionAddressRequestSchema
>

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

export const RegisterProjectLocationDataSchema = z
  .object({
    project: ProjectRecordSchema,
    location: ProjectLocationSchema,
    created: z.boolean(),
  })
  .strict()
  .superRefine((data, context) => {
    if (data.location.projectId !== data.project.projectId) {
      context.addIssue({
        code: 'custom',
        message: 'ProjectLocation must belong to the returned Project',
        path: ['location', 'projectId'],
      })
    }
    const matchingLocations = data.project.locations.filter(
      (location) => location.machineId === data.location.machineId,
    )
    if (
      matchingLocations.length !== 1 ||
      matchingLocations[0]?.rootPath !== data.location.rootPath
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Returned Project must contain the exact ProjectLocation',
        path: ['project', 'locations'],
      })
    }
  })
export type RegisterProjectLocationData = z.infer<
  typeof RegisterProjectLocationDataSchema
>

export const RemoveProjectLocationDataSchema = z
  .object({
    project: ProjectRecordSchema,
    machineId: MachineIdSchema,
  })
  .strict()
  .superRefine((data, context) => {
    if (
      data.project.locations.some(
        (location) => location.machineId === data.machineId,
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Returned Project must not contain the removed location',
        path: ['project', 'locations'],
      })
    }
  })
export type RemoveProjectLocationData = z.infer<
  typeof RemoveProjectLocationDataSchema
>

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

export const RegisterProjectLocationResponseSchema = mutationResponseSchema(
  RegisterProjectLocationDataSchema,
)
export type RegisterProjectLocationResponse = z.infer<
  typeof RegisterProjectLocationResponseSchema
>

export const RemoveProjectLocationResponseSchema = mutationResponseSchema(
  RemoveProjectLocationDataSchema,
)
export type RemoveProjectLocationResponse = z.infer<
  typeof RemoveProjectLocationResponseSchema
>

export const DeleteProjectResponseSchema = mutationResponseSchema(
  DeleteProjectDataSchema,
)
export type DeleteProjectResponse = z.infer<typeof DeleteProjectResponseSchema>

export const BeginRemoteMachinePairingResponseSchema = mutationResponseSchema(
  z.object({ candidate: RemoteMachinePairingCandidateSchema }).strict(),
)
export type BeginRemoteMachinePairingResponse = z.infer<
  typeof BeginRemoteMachinePairingResponseSchema
>

export const ConfirmRemoteMachinePairingResponseSchema = mutationResponseSchema(
  z.object({ machine: MachineSummarySchema }).strict(),
)
export type ConfirmRemoteMachinePairingResponse = z.infer<
  typeof ConfirmRemoteMachinePairingResponseSchema
>

export const CancelRemoteMachinePairingResponseSchema = mutationResponseSchema(
  z.object({ pairingAttemptId: MachinePairingAttemptIdSchema }).strict(),
)
export type CancelRemoteMachinePairingResponse = z.infer<
  typeof CancelRemoteMachinePairingResponseSchema
>

export const UnpairMachineResponseSchema = mutationResponseSchema(
  z.object({ machineId: MachineIdSchema }).strict(),
)
export type UnpairMachineResponse = z.infer<typeof UnpairMachineResponseSchema>

const MachineConnectionMutationDataSchema = z
  .object({
    machine: MachineSummarySchema,
    connection: RemoteMachineConnectionSchema,
  })
  .strict()

export const RetryMachineConnectionResponseSchema = mutationResponseSchema(
  MachineConnectionMutationDataSchema,
)
export type RetryMachineConnectionResponse = z.infer<
  typeof RetryMachineConnectionResponseSchema
>

export const UpdateMachineConnectionAddressResponseSchema =
  mutationResponseSchema(MachineConnectionMutationDataSchema)
export type UpdateMachineConnectionAddressResponse = z.infer<
  typeof UpdateMachineConnectionAddressResponseSchema
>

export const RefreshMachineProvidersDataSchema = z
  .object({
    machineId: MachineIdSchema,
    providers: z
      .array(ProviderDescriptorSchema)
      .max(machineWireLimits.providers),
    providerDiscovery: MachineProviderDiscoverySchema,
  })
  .strict()
  .superRefine((data, context) => {
    if (data.providerDiscovery.state !== 'current') {
      context.addIssue({
        code: 'custom',
        message: 'A successful Provider refresh must return a current result',
        path: ['providerDiscovery', 'state'],
      })
    }
    const providerIds = new Set<string>()
    for (const [index, provider] of data.providers.entries()) {
      if (providerIds.has(provider.provider)) {
        context.addIssue({
          code: 'custom',
          message: 'Machine Provider identities must be unique',
          path: ['providers', index, 'provider'],
        })
      }
      providerIds.add(provider.provider)
    }
  })
export type RefreshMachineProvidersData = z.infer<
  typeof RefreshMachineProvidersDataSchema
>

export const RefreshMachineProvidersResponseSchema = mutationResponseSchema(
  RefreshMachineProvidersDataSchema,
)
export type RefreshMachineProvidersResponse = z.infer<
  typeof RefreshMachineProvidersResponseSchema
>

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
