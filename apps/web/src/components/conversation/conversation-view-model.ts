import type { AgentId, DiffLine, ExecutionStatus } from '@codetether/ui'

export type ConversationRailFilter = 'all' | 'running' | 'waiting' | 'completed'

export interface ConversationMessageViewModel {
  readonly id: string
  readonly author: 'user' | 'agent'
  readonly body: string
  readonly time: string
  readonly status?: ExecutionStatus
}

export interface ConversationToolViewModel {
  readonly id: string
  readonly title: string
  readonly status: ExecutionStatus
  readonly description?: string
  readonly outputSummary?: string
  readonly actionLabel?: string
  readonly delta?: {
    readonly additions: number
    readonly deletions: number
  }
}

export interface ConversationFileChangeViewModel {
  readonly id: string
  readonly path: string
  readonly name: string
  readonly kind: 'added' | 'modified' | 'deleted' | 'renamed' | 'unknown'
  readonly additions: number
  readonly deletions: number
  readonly lines: readonly DiffLine[]
}

export interface ConversationChangesViewModel {
  readonly files: readonly ConversationFileChangeViewModel[]
  readonly totals: {
    readonly additions: number
    readonly deletions: number
  }
}

export interface ConversationShellRunViewModel {
  readonly id: string
  readonly command: string
  readonly status: ExecutionStatus
  readonly summary: string
}

export interface ConversationApprovalViewModel {
  readonly id: string
  readonly kind: 'command' | 'file-change' | 'unknown'
  readonly title: string
  readonly summary: string
  readonly requestedAt: string
  readonly context?: string
}

export type ConversationRunExecutionViewModel =
  | {
      readonly kind: 'tool'
      readonly id: string
      readonly tool: ConversationToolViewModel
    }
  | {
      readonly kind: 'diff'
      readonly id: string
      readonly changeId: string
    }
  | {
      readonly kind: 'shell'
      readonly id: string
      readonly shell: ConversationShellRunViewModel
    }
  | {
      readonly kind: 'approval'
      readonly id: string
      readonly approvalId: string
    }

export type ConversationTimelineBlockViewModel =
  | {
      readonly kind: 'message'
      readonly id: string
      readonly message: ConversationMessageViewModel
    }
  | {
      readonly kind: 'agent-run'
      readonly id: string
      readonly time: string
      readonly status: ExecutionStatus
      readonly message?: ConversationMessageViewModel
      readonly executions: readonly ConversationRunExecutionViewModel[]
      readonly outcome?: 'completed' | 'failed' | 'interrupted'
      readonly outcomeText?: string
    }

export interface ConversationTimelineViewModel {
  readonly dayLabel: string
  readonly blocks: readonly ConversationTimelineBlockViewModel[]
}

export interface ConversationTerminalViewModel {
  readonly command?: string
  readonly lines: readonly string[]
  readonly truncated: boolean
}

export interface ConversationContextReferenceViewModel {
  readonly id: string
  readonly label: string
  readonly kind: 'file' | 'git' | 'shell'
}

export interface ConversationCapabilitiesViewModel {
  readonly canCompose: boolean
  readonly canInterrupt: boolean
  readonly canStop: boolean
  readonly canResolveApproval: boolean
}

export interface ConversationViewModel {
  readonly id: string
  readonly title: string
  readonly status: ExecutionStatus
  readonly agent: AgentId
  readonly model: string
  readonly reasoning: string
  readonly permission: string
  readonly machine: string
  readonly branch: string
  readonly duration: string
  readonly timeline: ConversationTimelineViewModel
  readonly changes: ConversationChangesViewModel
  readonly terminal: ConversationTerminalViewModel
  readonly context: readonly ConversationContextReferenceViewModel[]
  readonly pendingApprovals: readonly ConversationApprovalViewModel[]
  readonly capabilities: ConversationCapabilitiesViewModel
}

export interface ConversationRailItemViewModel {
  readonly id: string
  readonly title: string
  readonly status: ExecutionStatus
  readonly lastActivity: string
  readonly machine?: string
}

export interface ConversationRailGroupViewModel {
  readonly agent: AgentId
  readonly conversations: readonly ConversationRailItemViewModel[]
}

export interface ConversationRailViewModel {
  readonly groups: readonly ConversationRailGroupViewModel[]
  readonly archivedCount: number
}

export type ConversationConnectionState =
  'connecting' | 'connected' | 'reconnecting' | 'unavailable' | 'incompatible'

export interface ConversationConnectionIndicatorViewModel {
  readonly state: ConversationConnectionState
  readonly label: string
}

export interface ConversationDetailSourceViewModel {
  readonly conversation: ConversationViewModel
  readonly rail: ConversationRailViewModel
  readonly connectionIndicator?: ConversationConnectionIndicatorViewModel
}
