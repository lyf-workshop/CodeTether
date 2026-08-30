import type {
  AgentEvent,
  AgentProvider,
  ApprovalKind,
} from '@codetether/agent-core'
import type { ProviderDescriptor } from '@codetether/protocol'

export type PublicApprovalDecision = 'accept' | 'decline'
export type ProviderRequestId = string | number

export interface ProviderConversationResult {
  readonly providerThreadId: string
  readonly model?: string
}

export interface ProviderTurnResult {
  readonly providerTurnId: string
}

/**
 * The durable CodeTether conversation still exists, but the provider can no
 * longer resume its backing conversation. This is an internal Host error; the
 * HTTP boundary decides how it is represented on the wire.
 */
export class ProviderConversationUnavailableError extends Error {
  override readonly name = 'ProviderConversationUnavailableError'
  readonly code = 'provider_conversation_unavailable' as const

  constructor(
    readonly provider: AgentProvider,
    readonly providerThreadId: string,
    options?: ErrorOptions,
  ) {
    super(`The ${provider} conversation is no longer available`, options)
  }
}

export interface ProviderApprovalRequest {
  readonly provider: AgentProvider
  readonly providerRequestId: ProviderRequestId
  readonly providerApprovalId: string
  readonly providerThreadId: string
  readonly providerTurnId: string
  readonly providerItemId?: string
  readonly kind: ApprovalKind
  readonly summary: string
  respond(decision: PublicApprovalDecision): void
}

export interface ProviderApprovalResolution {
  readonly provider: AgentProvider
  readonly providerRequestId: ProviderRequestId
  readonly providerApprovalId: string
  readonly providerThreadId: string
  readonly providerTurnId: string
  readonly providerItemId?: string
  readonly decision: PublicApprovalDecision
}

export interface AgentHostRuntime {
  readonly provider: AgentProvider
  /** Public, presentation-safe capability result cached for this Host life. */
  readonly descriptor?: ProviderDescriptor
  /** False for the read-only Host fallback when the Provider cannot launch. */
  readonly available?: boolean
  subscribeEvents(listener: (event: AgentEvent) => void): () => void
  subscribeFailures(listener: (failure: Error) => void): () => void
  subscribeApprovals(
    onRequest: (request: ProviderApprovalRequest) => void,
    onResolved: (resolution: ProviderApprovalResolution) => void,
  ): () => void
  startConversation(options: {
    readonly cwd: string
    readonly model?: string
    readonly reasoning?: string
  }): Promise<ProviderConversationResult>
  resumeConversation(options: {
    readonly providerThreadId: string
    readonly cwd: string
    /** True only after at least one durable Provider Turn has been created. */
    readonly providerSessionMaterialized: boolean
  }): Promise<ProviderConversationResult>
  startTurn(options: {
    readonly providerThreadId: string
    /** Re-authorized for every Turn; process-per-Turn Providers must use it. */
    readonly cwd: string
    readonly input: string
    readonly model?: string
    readonly reasoning?: string
  }): Promise<ProviderTurnResult>
  interruptTurn(options: {
    readonly providerThreadId: string
    readonly providerTurnId: string
  }): Promise<void>
  /** Releases only process-local session state; durable Provider history remains. */
  disposeConversation?(options: {
    readonly providerThreadId: string
  }): Promise<void>
  close(): Promise<void>
}
