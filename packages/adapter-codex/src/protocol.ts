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
