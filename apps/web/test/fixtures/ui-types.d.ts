export type AgentId = 'codex' | 'claude' | 'opencode'

export type ExecutionStatus =
  | 'idle'
  | 'thinking'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'offline'

export interface DiffLine {
  readonly kind: 'context' | 'addition' | 'deletion'
  readonly content: string
  readonly oldLineNumber?: number
  readonly newLineNumber?: number
}
