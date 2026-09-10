export type JsonRpcId = string | number

export interface JsonRpcRequest {
  readonly id: JsonRpcId
  readonly method: string
  readonly params?: unknown
}

export interface JsonRpcNotification {
  readonly method: string
  readonly params?: unknown
  readonly emittedAtMs?: number
}

export interface JsonRpcSuccess {
  readonly id: JsonRpcId
  readonly result: unknown
}

export interface JsonRpcFailure {
  readonly id: JsonRpcId
  readonly error: {
    readonly code: number
    readonly message: string
    readonly data?: unknown
  }
}

export type JsonRpcIncoming =
  JsonRpcRequest | JsonRpcNotification | JsonRpcSuccess | JsonRpcFailure

export interface InitializeResult {
  readonly userAgent: string
  readonly codexHome: string
  readonly platformFamily: string
  readonly platformOs: string
}

export interface CodexThread {
  readonly id: string
  readonly cwd?: string
}

export type CodexStoredThreadSource = 'cli' | 'exec' | 'vscode' | 'appServer'

export type CodexStoredThreadStatus =
  'notLoaded' | 'idle' | 'active' | 'systemError'

/**
 * Provider-private metadata projected from app-server thread/list. Fields such
 * as preview, rollout path, sessionId, turns, and Git metadata are deliberately
 * absent so discovery callers cannot accidentally publish Provider content.
 */
export interface CodexStoredThread {
  readonly id: string
  readonly cwd: string
  readonly name?: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly recencyAt?: number
  readonly cliVersion: string
  readonly modelProvider: string
  readonly source: CodexStoredThreadSource
  readonly status: CodexStoredThreadStatus
  readonly ephemeral: boolean
}

export interface CodexStoredThreadPage {
  readonly threads: readonly CodexStoredThread[]
  readonly invalidEntryCount: number
  readonly nextCursor?: string
}

export interface CodexStoredThreadItem {
  readonly turnId: string
  readonly id: string
  readonly type: 'userMessage' | 'agentMessage'
  readonly text: string
}

export interface CodexStoredThreadItemPage {
  readonly items: readonly CodexStoredThreadItem[]
  readonly invalidEntryCount: number
  readonly nextCursor?: string
  readonly backwardsCursor?: string
}

/**
 * Provider-private retained-history projection from thread/turns/list. The
 * adapter keeps the Turn grouping because its cursor advances by Turn rather
 * than by individual item.
 */
export interface CodexStoredThreadTurn {
  readonly id: string
  readonly items: readonly CodexStoredThreadItem[]
  readonly invalidEntryCount: number
  readonly recordsScanned: number
}

export interface CodexStoredThreadTurnPage {
  readonly turns: readonly CodexStoredThreadTurn[]
  readonly invalidEntryCount: number
  readonly recordsScanned: number
  readonly nextCursor?: string
  readonly backwardsCursor?: string
}

export interface CodexTurnError {
  readonly message: string
  readonly codexErrorInfo?: unknown
  readonly additionalDetails?: string | null
}

export type CodexTurnStatus =
  'completed' | 'interrupted' | 'failed' | 'inProgress'

export interface CodexTurn {
  readonly id: string
  readonly status: CodexTurnStatus
  readonly error?: CodexTurnError | null
}

export interface ThreadStartResult {
  readonly thread: CodexThread
  readonly model: string
  readonly modelProvider: string
  readonly cwd: string
}

export type ThreadResumeResult = ThreadStartResult

export type TurnInterruptResult = Record<string, never>

export interface TurnStartResult {
  readonly turn: CodexTurn
}

export interface TurnTerminalResult {
  readonly threadId: string
  readonly turn: CodexTurn
  readonly finalMessage?: string
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const candidate = value[key]
  return typeof candidate === 'string' ? candidate : undefined
}
