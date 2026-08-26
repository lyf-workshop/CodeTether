export type AgentProvider = 'codex'

export interface RawProviderMetadata {
  /** The original provider method, such as `item/agentMessage/delta`. */
  readonly method: string
  /** Diagnostic provider data. Consumers must not depend on its shape. */
  readonly payload: unknown
}

interface AgentEventBase<TType extends string> {
  readonly type: TType
  readonly provider: AgentProvider
  /** ISO 8601 timestamp assigned when the adapter observes the event. */
  readonly timestamp: string
  readonly raw?: RawProviderMetadata
}

interface ConversationEventBase<
  TType extends string,
> extends AgentEventBase<TType> {
  readonly threadId: string
}

interface TurnEventBase<
  TType extends string,
> extends ConversationEventBase<TType> {
  readonly turnId: string
}

interface ItemEventBase<TType extends string> extends TurnEventBase<TType> {
  readonly itemId: string
}

export interface ConversationStartedEvent extends ConversationEventBase<'conversation.started'> {
  readonly cwd?: string
}

export type TurnStartedEvent = TurnEventBase<'turn.started'>

export interface MessageDeltaEvent extends ItemEventBase<'message.delta'> {
  readonly delta: string
}

export interface MessageCompletedEvent extends ItemEventBase<'message.completed'> {
  readonly message: string
}

export interface ToolStartedEvent extends ItemEventBase<'tool.started'> {
  readonly name: string
  readonly summary?: string
}

export type ToolOutputStream = 'stdout' | 'stderr' | 'combined' | 'unknown'

export interface ToolOutputEvent extends ItemEventBase<'tool.output'> {
  readonly output: string
  readonly stream?: ToolOutputStream
}

export interface ToolCompletedEvent extends ItemEventBase<'tool.completed'> {
  readonly name: string
  readonly success?: boolean
  readonly summary?: string
}

export type FileChangeKind =
  'added' | 'modified' | 'deleted' | 'renamed' | 'unknown'

export interface FileChangedEvent extends TurnEventBase<'file.changed'> {
  readonly itemId?: string
  readonly path: string
  readonly kind: FileChangeKind
  readonly diff?: string
}

export type ApprovalKind = 'command' | 'file-change' | 'unknown'

export interface ApprovalRequestedEvent extends TurnEventBase<'approval.requested'> {
  readonly approvalId: string
  readonly itemId?: string
  readonly kind: ApprovalKind
  readonly summary: string
}

export interface TurnCompletedEvent extends TurnEventBase<'turn.completed'> {
  readonly finalMessage?: string
}

export interface TurnFailedEvent extends TurnEventBase<'turn.failed'> {
  readonly error: {
    readonly message: string
    readonly code?: string
  }
}

export type AgentEvent =
  | ConversationStartedEvent
  | TurnStartedEvent
  | MessageDeltaEvent
  | MessageCompletedEvent
  | ToolStartedEvent
  | ToolOutputEvent
  | ToolCompletedEvent
  | FileChangedEvent
  | ApprovalRequestedEvent
  | TurnCompletedEvent
  | TurnFailedEvent

export type AgentEventType = AgentEvent['type']
