import { z } from 'zod'

import {
  canonicalFailure,
  canonicalFailureCategories,
  canonicalFailureReasons,
  canonicalFailureRetryabilities,
  canonicalFailureSources,
  canonicalFailureUserActions,
  type CanonicalFailure,
  type CanonicalFailureReason,
} from '@codetether/agent-core'

import { machineProtocolVersion, machineTransportLimits } from './constants.js'
import {
  ControllerIdSchema,
  MachineTransportActionIdSchema,
  MachineTransportConversationIdSchema,
  MachineTransportMachineIdSchema,
  MachineTransportProjectIdSchema,
  MachineTransportTurnIdSchema,
  NodeIdSchema,
  PairingAttemptIdSchema,
} from './ids.js'

export const PublicKeyFingerprintSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/)
export type PublicKeyFingerprint = z.infer<typeof PublicKeyFingerprintSchema>

const MAXIMUM_TIMESTAMP_CHARACTERS = 64
const TimestampSchema = z.iso
  .datetime({ offset: true })
  .max(MAXIMUM_TIMESTAMP_CHARACTERS)
export const MachineTransportCanonicalFailureSchema: z.ZodType<CanonicalFailure> =
  z
    .object({
      category: z.enum(canonicalFailureCategories),
      reason: z.enum(canonicalFailureReasons),
      retryability: z.enum(canonicalFailureRetryabilities),
      userAction: z.enum(canonicalFailureUserActions),
      source: z.enum(canonicalFailureSources),
      occurredAt: TimestampSchema,
      technicalCode: z.enum(canonicalFailureReasons),
    })
    .strict()
    .superRefine((failure, context) => {
      const expected = canonicalFailure(failure.reason, failure.occurredAt)
      for (const field of [
        'category',
        'retryability',
        'userAction',
        'source',
        'technicalCode',
      ] as const) {
        if (failure[field] !== expected[field]) {
          context.addIssue({
            code: 'custom',
            message: `Canonical failure ${field} does not match its reason`,
            path: [field],
          })
        }
      }
    })

const providerConditionFailureReasonValues = [
  'login_required',
  'authentication_expired',
  'authentication_invalid',
  'account_unavailable',
  'usage_limit_reached',
  'rate_limited',
  'provider_capacity_limited',
  'provider_not_installed',
  'provider_unsupported_version',
  'provider_misconfigured',
  'provider_service_unavailable',
  'provider_start_failed',
  'provider_crashed',
  'provider_protocol_error',
  'provider_error',
] as const satisfies readonly CanonicalFailureReason[]

const providerConditionFailureReasons = new Set<CanonicalFailureReason>(
  providerConditionFailureReasonValues,
)

const providerOperationFailureReasons = new Set<CanonicalFailureReason>([
  ...providerConditionFailureReasons,
  'execution_ownership_uncertain',
  'output_limit_exceeded',
  'protocol_limit_exceeded',
])

const providerSessionLossFailureReasons = new Set<CanonicalFailureReason>([
  'provider_crashed',
  'provider_session_lost',
  'execution_lost',
  'execution_ownership_uncertain',
])

const remoteExecutionLossFailureReasons = new Set<CanonicalFailureReason>([
  'execution_lost',
  'execution_ownership_uncertain',
  'output_limit_exceeded',
  'protocol_limit_exceeded',
  'transport_lost',
])

const remotePolicyFailureReasons = new Set<CanonicalFailureReason>([
  'provider_protocol_error',
  'protocol_limit_exceeded',
])

function isFailureCompatibleWithWireCode(
  code: string,
  failure: CanonicalFailure | undefined,
): boolean {
  if (failure === undefined) return true

  switch (code) {
    case 'authentication_failed':
      return failure.reason === 'transport_authentication_failed'
    case 'identity_mismatch':
      return failure.reason === 'machine_identity_mismatch'
    case 'busy':
      return failure.reason === 'execution_capacity_reached'
    case 'project_location_path_invalid':
    case 'project_location_not_directory':
      return failure.reason === 'project_location_invalid'
    case 'project_location_missing':
      return failure.reason === 'project_location_missing'
    case 'project_location_inaccessible':
      return failure.reason === 'project_location_unavailable'
    case 'remote_execution_unavailable':
      return failure.reason === 'remote_execution_unavailable'
    case 'provider_unavailable':
    case 'provider_start_failed':
    case 'provider_failed':
      return providerOperationFailureReasons.has(failure.reason)
    case 'provider_session_lost':
      return providerSessionLossFailureReasons.has(failure.reason)
    case 'remote_execution_lost':
      return remoteExecutionLossFailureReasons.has(failure.reason)
    case 'remote_policy_violation':
      return remotePolicyFailureReasons.has(failure.reason)
    case 'conversation_busy':
      return failure.reason === 'conversation_busy'
    default:
      // Pairing/protocol framing and duplicate-action errors do not carry
      // Provider execution diagnostics. Their bounded machine error code is
      // already the complete public signal.
      return false
  }
}
const BoundedOpaqueEnvelopeSchema = z.string().min(1).max(4096)
const NonceSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
const AuthenticationTagSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)

export const RemoteCodexProviderIdentitySchema = z
  .string()
  .min(1)
  .max(machineTransportLimits.maximumRemoteCodexProviderIdentityBytes)
  .regex(/^[\x21-\x7e]+$/)
export type RemoteCodexProviderIdentity = z.infer<
  typeof RemoteCodexProviderIdentitySchema
>

export const RemoteCodexPromptSchema = z
  .string()
  .min(1)
  .refine((value) => !value.includes('\0'))
  .refine(
    (value) =>
      Buffer.byteLength(value, 'utf8') <=
      machineTransportLimits.maximumRemoteCodexPromptBytes,
  )
export type RemoteCodexPrompt = z.infer<typeof RemoteCodexPromptSchema>

const RemoteCodexDeltaSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      Buffer.byteLength(value, 'utf8') <=
      machineTransportLimits.maximumRemoteCodexDeltaBytes,
  )

const ClaudeSessionIdentityPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const RemoteClaudeProviderIdentitySchema = z
  .string()
  .regex(ClaudeSessionIdentityPattern)
export type RemoteClaudeProviderIdentity = z.infer<
  typeof RemoteClaudeProviderIdentitySchema
>

export const RemoteClaudeEffortSchema = z.enum([
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
])
export type RemoteClaudeEffort = z.infer<typeof RemoteClaudeEffortSchema>

export const RemoteClaudePromptSchema = z
  .string()
  .min(1)
  .refine((value) => !value.includes('\0'))
  .refine(
    (value) =>
      Buffer.byteLength(value, 'utf8') <=
      machineTransportLimits.maximumRemoteClaudePromptBytes,
  )
export type RemoteClaudePrompt = z.infer<typeof RemoteClaudePromptSchema>

const RemoteClaudeDeltaSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      Buffer.byteLength(value, 'utf8') <=
      machineTransportLimits.maximumRemoteClaudeDeltaBytes,
  )

const RemoteClaudeToolItemIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[\x21-\x7e]+$/)
const RemoteClaudeToolCommandSchema = z
  .string()
  .min(1)
  .refine((value) => !value.includes('\0'))
  .refine(
    (value) =>
      Buffer.byteLength(value, 'utf8') <=
      machineTransportLimits.maximumRemoteClaudeToolCommandBytes,
  )
const RemoteClaudeToolSummarySchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) =>
      Buffer.byteLength(value, 'utf8') <=
      machineTransportLimits.maximumRemoteClaudeToolSummaryBytes,
  )
const RemoteClaudeToolOutputSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      Buffer.byteLength(value, 'utf8') <=
      machineTransportLimits.maximumRemoteClaudeToolOutputBytes,
  )

export const RemoteProjectLocationPathSchema = z
  .string()
  .min(1)
  .max(machineTransportLimits.maximumProjectLocationPathBytes)
  .refine((value) => !value.includes('\0'))
  .refine(
    (value) =>
      Buffer.byteLength(value, 'utf8') <=
      machineTransportLimits.maximumProjectLocationPathBytes,
  )
export type RemoteProjectLocationPath = z.infer<
  typeof RemoteProjectLocationPathSchema
>

const RemoteProjectLocationBasenameSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => !value.includes('\0'))

export const RemoteMachineMetadataSchema = z
  .object({
    machineId: MachineTransportMachineIdSchema,
    nodeId: NodeIdSchema,
    displayName: z.string().trim().min(1).max(240),
    platform: z.string().trim().min(1).max(64),
    architecture: z.string().trim().min(1).max(64),
  })
  .strict()
export type RemoteMachineMetadata = z.infer<typeof RemoteMachineMetadataSchema>

const VersionField = z.literal(machineProtocolVersion)

export const PairingOpenMessageSchema = z
  .object({
    type: z.literal('pair.open'),
    protocolVersion: VersionField,
    controllerFingerprint: PublicKeyFingerprintSchema,
  })
  .strict()
export type PairingOpenMessage = z.infer<typeof PairingOpenMessageSchema>

export const PairingOfferMessageSchema = z
  .object({
    type: z.literal('pair.offer'),
    protocolVersion: VersionField,
    attemptId: PairingAttemptIdSchema,
    expiresAt: TimestampSchema,
    machine: RemoteMachineMetadataSchema,
    nodeFingerprint: PublicKeyFingerprintSchema,
    nodeNonce: NonceSchema,
  })
  .strict()
export type PairingOfferMessage = z.infer<typeof PairingOfferMessageSchema>

export const PairingLoginStartMessageSchema = z
  .object({
    type: z.literal('pair.login.start'),
    protocolVersion: VersionField,
    attemptId: PairingAttemptIdSchema,
    controllerId: ControllerIdSchema,
    controllerFingerprint: PublicKeyFingerprintSchema,
    controllerNonce: NonceSchema,
    request: BoundedOpaqueEnvelopeSchema,
  })
  .strict()
export type PairingLoginStartMessage = z.infer<
  typeof PairingLoginStartMessageSchema
>

export const PairingLoginResponseMessageSchema = z
  .object({
    type: z.literal('pair.login.response'),
    protocolVersion: VersionField,
    attemptId: PairingAttemptIdSchema,
    response: BoundedOpaqueEnvelopeSchema,
  })
  .strict()
export type PairingLoginResponseMessage = z.infer<
  typeof PairingLoginResponseMessageSchema
>

export const PairingLoginFinishMessageSchema = z
  .object({
    type: z.literal('pair.login.finish'),
    protocolVersion: VersionField,
    attemptId: PairingAttemptIdSchema,
    request: BoundedOpaqueEnvelopeSchema,
  })
  .strict()
export type PairingLoginFinishMessage = z.infer<
  typeof PairingLoginFinishMessageSchema
>

export const PairingConfirmMessageSchema = z
  .object({
    type: z.literal('pair.confirm'),
    protocolVersion: VersionField,
    attemptId: PairingAttemptIdSchema,
    tag: AuthenticationTagSchema,
  })
  .strict()
export type PairingConfirmMessage = z.infer<typeof PairingConfirmMessageSchema>

export const PairingCancelMessageSchema = z
  .object({
    type: z.literal('pair.cancel'),
    protocolVersion: VersionField,
    attemptId: PairingAttemptIdSchema,
    tag: AuthenticationTagSchema,
  })
  .strict()
export type PairingCancelMessage = z.infer<typeof PairingCancelMessageSchema>

export const PairingAckMessageSchema = z
  .object({
    type: z.literal('pair.ack'),
    protocolVersion: VersionField,
    attemptId: PairingAttemptIdSchema,
    tag: AuthenticationTagSchema,
  })
  .strict()
export type PairingAckMessage = z.infer<typeof PairingAckMessageSchema>

export const PairingCancelledMessageSchema = z
  .object({
    type: z.literal('pair.cancelled'),
    protocolVersion: VersionField,
    attemptId: PairingAttemptIdSchema,
    tag: AuthenticationTagSchema,
  })
  .strict()
export type PairingCancelledMessage = z.infer<
  typeof PairingCancelledMessageSchema
>

export const MachineHelloMessageSchema = z
  .object({
    type: z.literal('machine.hello'),
    protocolVersion: VersionField,
    controllerId: ControllerIdSchema,
    expectedMachineId: MachineTransportMachineIdSchema,
    nonce: NonceSchema,
  })
  .strict()
export type MachineHelloMessage = z.infer<typeof MachineHelloMessageSchema>

export const MachineStatusMessageSchema = z
  .object({
    type: z.literal('machine.status'),
    protocolVersion: VersionField,
    machine: RemoteMachineMetadataSchema,
    nonce: NonceSchema,
    observedAt: TimestampSchema,
  })
  .strict()
export type MachineStatusMessage = z.infer<typeof MachineStatusMessageSchema>

export const MachinePingMessageSchema = z
  .object({
    type: z.literal('machine.ping'),
    protocolVersion: VersionField,
    nonce: NonceSchema,
  })
  .strict()
export type MachinePingMessage = z.infer<typeof MachinePingMessageSchema>

export const MachinePongMessageSchema = z
  .object({
    type: z.literal('machine.pong'),
    protocolVersion: VersionField,
    nonce: NonceSchema,
  })
  .strict()
export type MachinePongMessage = z.infer<typeof MachinePongMessageSchema>

export const ProjectLocationValidateMessageSchema = z
  .object({
    type: z.literal('project_location.validate'),
    protocolVersion: VersionField,
    requestId: NonceSchema,
    expectedMachineId: MachineTransportMachineIdSchema,
    expectedNodeId: NodeIdSchema,
    rootPath: RemoteProjectLocationPathSchema,
  })
  .strict()
export type ProjectLocationValidateMessage = z.infer<
  typeof ProjectLocationValidateMessageSchema
>

export const ProjectLocationValidatedMessageSchema = z
  .object({
    type: z.literal('project_location.validated'),
    protocolVersion: VersionField,
    requestId: NonceSchema,
    machineId: MachineTransportMachineIdSchema,
    nodeId: NodeIdSchema,
    canonicalPath: RemoteProjectLocationPathSchema,
    basename: RemoteProjectLocationBasenameSchema,
    exists: z.literal(true),
    directory: z.literal(true),
  })
  .strict()
export type ProjectLocationValidatedMessage = z.infer<
  typeof ProjectLocationValidatedMessageSchema
>

/**
 * Presentation-only Provider capability vocabulary shared with Protocol v1.
 * A true value means CodeTether can actually expose that operation on this
 * Machine; detecting a CLI executable alone never turns a capability on.
 */
export const RemoteProviderCapabilitiesSchema = z
  .object({
    streaming: z.boolean(),
    resume: z.boolean(),
    interrupt: z.boolean(),
    approvals: z.boolean(),
    fileRead: z.boolean(),
    fileEdit: z.boolean(),
    shell: z.boolean(),
    search: z.boolean(),
    diff: z.boolean(),
    toolEvents: z.boolean(),
    modelSelection: z.boolean(),
    reasoningControl: z.boolean(),
  })
  .strict()
export type RemoteProviderCapabilities = z.infer<
  typeof RemoteProviderCapabilitiesSchema
>

const RemoteProviderReasoningOptionSchema = z
  .object({
    id: RemoteClaudeEffortSchema,
    label: z.string().trim().min(1).max(120),
  })
  .strict()

export const RemoteProviderDescriptorSchema = z
  .object({
    provider: z.enum(['codex', 'claude-code']),
    displayName: z.string().trim().min(1).max(120),
    availability: z.enum([
      'available',
      'not_installed',
      'unsupported_version',
      'misconfigured',
      'unavailable',
    ]),
    version: z.string().trim().min(1).max(120).optional(),
    capabilities: RemoteProviderCapabilitiesSchema,
    reasoningLabel: z.string().trim().min(1).max(120).optional(),
    reasoningOptions: z
      .array(RemoteProviderReasoningOptionSchema)
      .length(5)
      .readonly()
      .optional(),
    /** Safe execution truth kept distinct from installation availability. */
    executionFailureReason: z
      .enum(providerConditionFailureReasonValues)
      .optional(),
  })
  .strict()
  .superRefine((descriptor, context) => {
    const enabled = Object.entries(descriptor.capabilities)
      .filter(([, value]) => value)
      .map(([capability]) => capability)
      .sort()
    const remoteCodexTextFoundation =
      descriptor.provider === 'codex' &&
      descriptor.availability === 'available' &&
      enabled.length === 2 &&
      enabled[0] === 'resume' &&
      enabled[1] === 'streaming'
    const remoteClaudeReadSearchFoundation =
      descriptor.provider === 'claude-code' &&
      descriptor.availability === 'available' &&
      enabled.length === 6 &&
      enabled[0] === 'fileRead' &&
      enabled[1] === 'reasoningControl' &&
      enabled[2] === 'resume' &&
      enabled[3] === 'search' &&
      enabled[4] === 'streaming' &&
      enabled[5] === 'toolEvents'
    if (
      enabled.length > 0 &&
      !remoteCodexTextFoundation &&
      !remoteClaudeReadSearchFoundation
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Remote Provider capabilities exceed an admitted execution foundation',
        path: ['capabilities'],
      })
    }
    const reasoningIds = descriptor.reasoningOptions?.map(({ id }) => id)
    const exactClaudeReasoning =
      descriptor.reasoningLabel !== undefined &&
      reasoningIds?.join(',') === 'low,medium,high,xhigh,max'
    if (remoteClaudeReadSearchFoundation !== exactClaudeReasoning) {
      context.addIssue({
        code: 'custom',
        message: 'Remote Claude reasoning metadata is inconsistent',
        path: ['reasoningOptions'],
      })
    }
    if (
      descriptor.provider !== 'claude-code' &&
      (descriptor.reasoningLabel !== undefined ||
        descriptor.reasoningOptions !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Remote reasoning metadata belongs only to Claude Code',
        path: ['reasoningOptions'],
      })
    }
    if (descriptor.executionFailureReason !== undefined && enabled.length > 0) {
      context.addIssue({
        code: 'custom',
        message:
          'Unavailable execution cannot advertise execution capabilities',
        path: ['executionFailureReason'],
      })
    }
  })
export type RemoteProviderDescriptor = z.infer<
  typeof RemoteProviderDescriptorSchema
>

const RemoteProviderDescriptorListSchema = z
  .array(RemoteProviderDescriptorSchema)
  .length(2)
  .readonly()
  .superRefine((providers, context) => {
    const identities = new Set(providers.map(({ provider }) => provider))
    if (
      identities.size !== 2 ||
      !identities.has('codex') ||
      !identities.has('claude-code')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Remote Provider descriptors must contain each Provider once',
      })
    }
  })

export const ProvidersDescribeMessageSchema = z
  .object({
    type: z.literal('providers.describe'),
    protocolVersion: VersionField,
    requestId: NonceSchema,
    expectedMachineId: MachineTransportMachineIdSchema,
    expectedNodeId: NodeIdSchema,
  })
  .strict()
export type ProvidersDescribeMessage = z.infer<
  typeof ProvidersDescribeMessageSchema
>

export const ProvidersDescribedMessageSchema = z
  .object({
    type: z.literal('providers.described'),
    protocolVersion: VersionField,
    requestId: NonceSchema,
    machineId: MachineTransportMachineIdSchema,
    nodeId: NodeIdSchema,
    observedAt: TimestampSchema,
    providers: RemoteProviderDescriptorListSchema,
  })
  .strict()
export type ProvidersDescribedMessage = z.infer<
  typeof ProvidersDescribedMessageSchema
>

export const RemoteCodexExecutionProfileSchema = z.literal('codex-text-v1')
export type RemoteCodexExecutionProfile = z.infer<
  typeof RemoteCodexExecutionProfileSchema
>

export const CodexSessionOpenMessageSchema = z
  .object({
    type: z.literal('codex.session.open'),
    protocolVersion: VersionField,
    requestId: NonceSchema,
    expectedMachineId: MachineTransportMachineIdSchema,
    expectedNodeId: NodeIdSchema,
    conversationId: MachineTransportConversationIdSchema,
    projectId: MachineTransportProjectIdSchema,
    rootPath: RemoteProjectLocationPathSchema,
    providerThreadId: RemoteCodexProviderIdentitySchema.optional(),
  })
  .strict()
export type CodexSessionOpenMessage = z.infer<
  typeof CodexSessionOpenMessageSchema
>

export const CodexSessionReadyMessageSchema = z
  .object({
    type: z.literal('codex.session.ready'),
    protocolVersion: VersionField,
    requestId: NonceSchema,
    machineId: MachineTransportMachineIdSchema,
    nodeId: NodeIdSchema,
    conversationId: MachineTransportConversationIdSchema,
    providerThreadId: RemoteCodexProviderIdentitySchema,
    resumed: z.boolean(),
    executionProfile: RemoteCodexExecutionProfileSchema,
  })
  .strict()
export type CodexSessionReadyMessage = z.infer<
  typeof CodexSessionReadyMessageSchema
>

export const CodexTurnStartMessageSchema = z
  .object({
    type: z.literal('codex.turn.start'),
    protocolVersion: VersionField,
    actionId: MachineTransportActionIdSchema,
    conversationId: MachineTransportConversationIdSchema,
    turnId: MachineTransportTurnIdSchema,
    providerThreadId: RemoteCodexProviderIdentitySchema,
    prompt: RemoteCodexPromptSchema,
  })
  .strict()
export type CodexTurnStartMessage = z.infer<typeof CodexTurnStartMessageSchema>

export const CodexTurnStartedMessageSchema = z
  .object({
    type: z.literal('codex.turn.started'),
    protocolVersion: VersionField,
    machineId: MachineTransportMachineIdSchema,
    nodeId: NodeIdSchema,
    actionId: MachineTransportActionIdSchema,
    conversationId: MachineTransportConversationIdSchema,
    turnId: MachineTransportTurnIdSchema,
    providerThreadId: RemoteCodexProviderIdentitySchema,
    providerTurnId: RemoteCodexProviderIdentitySchema,
  })
  .strict()
export type CodexTurnStartedMessage = z.infer<
  typeof CodexTurnStartedMessageSchema
>

export const RemoteCodexTurnFailureCodeSchema = z.enum([
  'provider_start_failed',
  'provider_session_lost',
  'remote_execution_lost',
  'remote_policy_violation',
  'provider_failed',
])
export type RemoteCodexTurnFailureCode = z.infer<
  typeof RemoteCodexTurnFailureCodeSchema
>

export const RemoteCodexTurnEventPayloadSchema = z.discriminatedUnion('type', [
  z
    .object({ type: z.literal('message.delta'), text: RemoteCodexDeltaSchema })
    .strict(),
  z.object({ type: z.literal('message.completed') }).strict(),
  z.object({ type: z.literal('turn.completed') }).strict(),
  z
    .object({
      type: z.literal('turn.failed'),
      code: RemoteCodexTurnFailureCodeSchema,
      message: z.string().trim().min(1).max(240),
      failure: MachineTransportCanonicalFailureSchema.optional(),
    })
    .strict()
    .refine(
      (event) => isFailureCompatibleWithWireCode(event.code, event.failure),
      {
        message: 'Canonical failure is incompatible with the Turn error code',
        path: ['failure'],
      },
    ),
])
export type RemoteCodexTurnEventPayload = z.infer<
  typeof RemoteCodexTurnEventPayloadSchema
>

export const CodexTurnEventMessageSchema = z
  .object({
    type: z.literal('codex.turn.event'),
    protocolVersion: VersionField,
    machineId: MachineTransportMachineIdSchema,
    nodeId: NodeIdSchema,
    actionId: MachineTransportActionIdSchema,
    conversationId: MachineTransportConversationIdSchema,
    turnId: MachineTransportTurnIdSchema,
    providerThreadId: RemoteCodexProviderIdentitySchema,
    providerTurnId: RemoteCodexProviderIdentitySchema,
    sequence: z.number().int().positive().safe(),
    event: RemoteCodexTurnEventPayloadSchema,
  })
  .strict()
export type CodexTurnEventMessage = z.infer<typeof CodexTurnEventMessageSchema>

export const CodexSessionHeartbeatMessageSchema = z
  .object({
    type: z.literal('codex.session.heartbeat'),
    protocolVersion: VersionField,
    requestId: NonceSchema,
    conversationId: MachineTransportConversationIdSchema,
    providerThreadId: RemoteCodexProviderIdentitySchema,
  })
  .strict()
export type CodexSessionHeartbeatMessage = z.infer<
  typeof CodexSessionHeartbeatMessageSchema
>

export const CodexSessionHeartbeatAckMessageSchema = z
  .object({
    type: z.literal('codex.session.heartbeat.ack'),
    protocolVersion: VersionField,
    requestId: NonceSchema,
    machineId: MachineTransportMachineIdSchema,
    nodeId: NodeIdSchema,
    conversationId: MachineTransportConversationIdSchema,
    providerThreadId: RemoteCodexProviderIdentitySchema,
  })
  .strict()
export type CodexSessionHeartbeatAckMessage = z.infer<
  typeof CodexSessionHeartbeatAckMessageSchema
>

export const CodexSessionDisposeMessageSchema = z
  .object({
    type: z.literal('codex.session.dispose'),
    protocolVersion: VersionField,
    requestId: NonceSchema,
    conversationId: MachineTransportConversationIdSchema,
    providerThreadId: RemoteCodexProviderIdentitySchema,
  })
  .strict()
export type CodexSessionDisposeMessage = z.infer<
  typeof CodexSessionDisposeMessageSchema
>

export const CodexSessionDisposedMessageSchema = z
  .object({
    type: z.literal('codex.session.disposed'),
    protocolVersion: VersionField,
    requestId: NonceSchema,
    machineId: MachineTransportMachineIdSchema,
    nodeId: NodeIdSchema,
    conversationId: MachineTransportConversationIdSchema,
  })
  .strict()
export type CodexSessionDisposedMessage = z.infer<
  typeof CodexSessionDisposedMessageSchema
>

export const RemoteClaudeExecutionProfileSchema = z.literal(
  'claude-restricted-read-search-v1',
)
export type RemoteClaudeExecutionProfile = z.infer<
  typeof RemoteClaudeExecutionProfileSchema
>

export const ClaudeSessionOpenMessageSchema = z
  .object({
    type: z.literal('claude.session.open'),
    protocolVersion: VersionField,
    requestId: NonceSchema,
    expectedMachineId: MachineTransportMachineIdSchema,
    expectedNodeId: NodeIdSchema,
    conversationId: MachineTransportConversationIdSchema,
    projectId: MachineTransportProjectIdSchema,
    rootPath: RemoteProjectLocationPathSchema,
    providerSessionId: RemoteClaudeProviderIdentitySchema.optional(),
    providerSessionMaterialized: z.boolean().optional(),
    effort: RemoteClaudeEffortSchema.optional(),
  })
  .strict()
  .superRefine((request, context) => {
    if (
      (request.providerSessionId === undefined) !==
      (request.providerSessionMaterialized === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Claude session materialization state requires an existing session identity',
        path: ['providerSessionMaterialized'],
      })
    }
  })
export type ClaudeSessionOpenMessage = z.infer<
  typeof ClaudeSessionOpenMessageSchema
>

export const ClaudeSessionReadyMessageSchema = z
  .object({
    type: z.literal('claude.session.ready'),
    protocolVersion: VersionField,
    requestId: NonceSchema,
    machineId: MachineTransportMachineIdSchema,
    nodeId: NodeIdSchema,
    conversationId: MachineTransportConversationIdSchema,
    providerSessionId: RemoteClaudeProviderIdentitySchema,
    resumed: z.boolean(),
    effort: RemoteClaudeEffortSchema.optional(),
    executionProfile: RemoteClaudeExecutionProfileSchema,
  })
  .strict()
export type ClaudeSessionReadyMessage = z.infer<
  typeof ClaudeSessionReadyMessageSchema
>

export const ClaudeTurnStartMessageSchema = z
  .object({
    type: z.literal('claude.turn.start'),
    protocolVersion: VersionField,
    actionId: MachineTransportActionIdSchema,
    conversationId: MachineTransportConversationIdSchema,
    turnId: MachineTransportTurnIdSchema,
    providerSessionId: RemoteClaudeProviderIdentitySchema,
    prompt: RemoteClaudePromptSchema,
  })
  .strict()
export type ClaudeTurnStartMessage = z.infer<
  typeof ClaudeTurnStartMessageSchema
>

export const ClaudeTurnStartedMessageSchema = z
  .object({
    type: z.literal('claude.turn.started'),
    protocolVersion: VersionField,
    machineId: MachineTransportMachineIdSchema,
    nodeId: NodeIdSchema,
    actionId: MachineTransportActionIdSchema,
    conversationId: MachineTransportConversationIdSchema,
    turnId: MachineTransportTurnIdSchema,
    providerSessionId: RemoteClaudeProviderIdentitySchema,
    providerTurnId: RemoteClaudeProviderIdentitySchema,
  })
  .strict()
export type ClaudeTurnStartedMessage = z.infer<
  typeof ClaudeTurnStartedMessageSchema
>

const RemoteClaudeReadToolStartedSchema = z
  .object({
    type: z.literal('tool.started'),
    itemId: RemoteClaudeToolItemIdSchema,
    kind: z.literal('read'),
    name: z.literal('Read'),
    command: RemoteClaudeToolCommandSchema.optional(),
    summary: RemoteClaudeToolSummarySchema.optional(),
  })
  .strict()
const RemoteClaudeSearchToolStartedSchema = z
  .object({
    type: z.literal('tool.started'),
    itemId: RemoteClaudeToolItemIdSchema,
    kind: z.literal('search'),
    name: z.literal('Search'),
    command: RemoteClaudeToolCommandSchema.optional(),
    summary: RemoteClaudeToolSummarySchema.optional(),
  })
  .strict()
const RemoteClaudeReadToolCompletedSchema = z
  .object({
    type: z.literal('tool.completed'),
    itemId: RemoteClaudeToolItemIdSchema,
    kind: z.literal('read'),
    name: z.literal('Read'),
    command: RemoteClaudeToolCommandSchema.optional(),
    success: z.boolean(),
    summary: RemoteClaudeToolSummarySchema.optional(),
  })
  .strict()
const RemoteClaudeSearchToolCompletedSchema = z
  .object({
    type: z.literal('tool.completed'),
    itemId: RemoteClaudeToolItemIdSchema,
    kind: z.literal('search'),
    name: z.literal('Search'),
    command: RemoteClaudeToolCommandSchema.optional(),
    success: z.boolean(),
    summary: RemoteClaudeToolSummarySchema.optional(),
  })
  .strict()

export const RemoteClaudeTurnFailureCodeSchema = z.enum([
  'provider_start_failed',
  'provider_session_lost',
  'provider_unavailable',
  'remote_execution_lost',
  'remote_policy_violation',
  'provider_failed',
])
export type RemoteClaudeTurnFailureCode = z.infer<
  typeof RemoteClaudeTurnFailureCodeSchema
>

export const RemoteClaudeTurnEventPayloadSchema = z.union([
  z
    .object({ type: z.literal('message.delta'), text: RemoteClaudeDeltaSchema })
    .strict(),
  z.object({ type: z.literal('message.completed') }).strict(),
  z.union([
    RemoteClaudeReadToolStartedSchema,
    RemoteClaudeSearchToolStartedSchema,
  ]),
  z
    .object({
      type: z.literal('tool.output'),
      itemId: RemoteClaudeToolItemIdSchema,
      output: RemoteClaudeToolOutputSchema,
    })
    .strict(),
  z.union([
    RemoteClaudeReadToolCompletedSchema,
    RemoteClaudeSearchToolCompletedSchema,
  ]),
  z.object({ type: z.literal('turn.completed') }).strict(),
  z
    .object({
      type: z.literal('turn.failed'),
      code: RemoteClaudeTurnFailureCodeSchema,
      message: z.string().trim().min(1).max(240),
      failure: MachineTransportCanonicalFailureSchema.optional(),
    })
    .strict()
    .refine(
      (event) => isFailureCompatibleWithWireCode(event.code, event.failure),
      {
        message: 'Canonical failure is incompatible with the Turn error code',
        path: ['failure'],
      },
    ),
])
export type RemoteClaudeTurnEventPayload = z.infer<
  typeof RemoteClaudeTurnEventPayloadSchema
>

export const ClaudeTurnEventMessageSchema = z
  .object({
    type: z.literal('claude.turn.event'),
    protocolVersion: VersionField,
    machineId: MachineTransportMachineIdSchema,
    nodeId: NodeIdSchema,
    actionId: MachineTransportActionIdSchema,
    conversationId: MachineTransportConversationIdSchema,
    turnId: MachineTransportTurnIdSchema,
    providerSessionId: RemoteClaudeProviderIdentitySchema,
    providerTurnId: RemoteClaudeProviderIdentitySchema,
    sequence: z.number().int().positive().safe(),
    event: RemoteClaudeTurnEventPayloadSchema,
  })
  .strict()
export type ClaudeTurnEventMessage = z.infer<
  typeof ClaudeTurnEventMessageSchema
>

export const ClaudeSessionHeartbeatMessageSchema = z
  .object({
    type: z.literal('claude.session.heartbeat'),
    protocolVersion: VersionField,
    requestId: NonceSchema,
    conversationId: MachineTransportConversationIdSchema,
    providerSessionId: RemoteClaudeProviderIdentitySchema,
  })
  .strict()
export type ClaudeSessionHeartbeatMessage = z.infer<
  typeof ClaudeSessionHeartbeatMessageSchema
>

export const ClaudeSessionHeartbeatAckMessageSchema = z
  .object({
    type: z.literal('claude.session.heartbeat.ack'),
    protocolVersion: VersionField,
    requestId: NonceSchema,
    machineId: MachineTransportMachineIdSchema,
    nodeId: NodeIdSchema,
    conversationId: MachineTransportConversationIdSchema,
    providerSessionId: RemoteClaudeProviderIdentitySchema,
  })
  .strict()
export type ClaudeSessionHeartbeatAckMessage = z.infer<
  typeof ClaudeSessionHeartbeatAckMessageSchema
>

export const ClaudeSessionDisposeMessageSchema = z
  .object({
    type: z.literal('claude.session.dispose'),
    protocolVersion: VersionField,
    requestId: NonceSchema,
    conversationId: MachineTransportConversationIdSchema,
    providerSessionId: RemoteClaudeProviderIdentitySchema,
  })
  .strict()
export type ClaudeSessionDisposeMessage = z.infer<
  typeof ClaudeSessionDisposeMessageSchema
>

export const ClaudeSessionDisposedMessageSchema = z
  .object({
    type: z.literal('claude.session.disposed'),
    protocolVersion: VersionField,
    requestId: NonceSchema,
    machineId: MachineTransportMachineIdSchema,
    nodeId: NodeIdSchema,
    conversationId: MachineTransportConversationIdSchema,
  })
  .strict()
export type ClaudeSessionDisposedMessage = z.infer<
  typeof ClaudeSessionDisposedMessageSchema
>

export const TrustRevokeMessageSchema = z
  .object({
    type: z.literal('trust.revoke'),
    protocolVersion: VersionField,
    controllerId: ControllerIdSchema,
    nonce: NonceSchema,
  })
  .strict()
export type TrustRevokeMessage = z.infer<typeof TrustRevokeMessageSchema>

export const TrustRevokedMessageSchema = z
  .object({
    type: z.literal('trust.revoked'),
    protocolVersion: VersionField,
    controllerId: ControllerIdSchema,
    nonce: NonceSchema,
  })
  .strict()
export type TrustRevokedMessage = z.infer<typeof TrustRevokedMessageSchema>

export const MachineWireErrorCodeSchema = z.enum([
  'pairing_disabled',
  'pairing_expired',
  'pairing_rate_limited',
  'pairing_failed',
  'authentication_failed',
  'identity_mismatch',
  'protocol_incompatible',
  'busy',
  'malformed_message',
  'project_location_path_invalid',
  'project_location_missing',
  'project_location_not_directory',
  'project_location_inaccessible',
  'remote_execution_unavailable',
  'provider_unavailable',
  'provider_start_failed',
  'provider_session_lost',
  'remote_execution_lost',
  'remote_policy_violation',
  'conversation_busy',
  'duplicate_action_conflict',
])
export type MachineWireErrorCode = z.infer<typeof MachineWireErrorCodeSchema>

export const MachineErrorMessageSchema = z
  .object({
    type: z.literal('machine.error'),
    protocolVersion: VersionField,
    code: MachineWireErrorCodeSchema,
    message: z.string().trim().min(1).max(240),
    failure: MachineTransportCanonicalFailureSchema.optional(),
  })
  .strict()
  .refine(
    (error) => isFailureCompatibleWithWireCode(error.code, error.failure),
    {
      message: 'Canonical failure is incompatible with the Machine error code',
      path: ['failure'],
    },
  )
export type MachineErrorMessage = z.infer<typeof MachineErrorMessageSchema>

export const MachineWireMessageSchema = z.discriminatedUnion('type', [
  PairingOpenMessageSchema,
  PairingOfferMessageSchema,
  PairingLoginStartMessageSchema,
  PairingLoginResponseMessageSchema,
  PairingLoginFinishMessageSchema,
  PairingConfirmMessageSchema,
  PairingCancelMessageSchema,
  PairingAckMessageSchema,
  PairingCancelledMessageSchema,
  MachineHelloMessageSchema,
  MachineStatusMessageSchema,
  MachinePingMessageSchema,
  MachinePongMessageSchema,
  ProjectLocationValidateMessageSchema,
  ProjectLocationValidatedMessageSchema,
  ProvidersDescribeMessageSchema,
  ProvidersDescribedMessageSchema,
  CodexSessionOpenMessageSchema,
  CodexSessionReadyMessageSchema,
  CodexTurnStartMessageSchema,
  CodexTurnStartedMessageSchema,
  CodexTurnEventMessageSchema,
  CodexSessionHeartbeatMessageSchema,
  CodexSessionHeartbeatAckMessageSchema,
  CodexSessionDisposeMessageSchema,
  CodexSessionDisposedMessageSchema,
  ClaudeSessionOpenMessageSchema,
  ClaudeSessionReadyMessageSchema,
  ClaudeTurnStartMessageSchema,
  ClaudeTurnStartedMessageSchema,
  ClaudeTurnEventMessageSchema,
  ClaudeSessionHeartbeatMessageSchema,
  ClaudeSessionHeartbeatAckMessageSchema,
  ClaudeSessionDisposeMessageSchema,
  ClaudeSessionDisposedMessageSchema,
  TrustRevokeMessageSchema,
  TrustRevokedMessageSchema,
  MachineErrorMessageSchema,
])
export type MachineWireMessage = z.infer<typeof MachineWireMessageSchema>
