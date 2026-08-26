import type {
  AgentEvent,
  AgentProvider,
  ApprovalKind,
} from '@codetether/agent-core'

export type PublicApprovalDecision = 'accept' | 'decline'
export type ProviderRequestId = string | number

export interface ProviderConversationResult {
  readonly providerThreadId: string
  readonly model?: string
}

export interface ProviderTurnResult {
  readonly providerTurnId: string
}

export interface ProviderApprovalRequest {
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
  readonly providerRequestId: ProviderRequestId
  readonly providerApprovalId: string
  readonly providerThreadId: string
  readonly providerTurnId: string
  readonly providerItemId?: string
  readonly decision: PublicApprovalDecision
}

export interface AgentHostRuntime {
  readonly provider: AgentProvider
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
  startTurn(options: {
    readonly providerThreadId: string
    readonly input: string
    readonly model?: string
    readonly reasoning?: string
  }): Promise<ProviderTurnResult>
  interruptTurn(options: {
    readonly providerThreadId: string
    readonly providerTurnId: string
  }): Promise<void>
  close(): Promise<void>
}
