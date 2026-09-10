import type { AgentProvider } from './events.js'

export const nativeTranscriptStatuses = [
  'available',
  'empty',
  'partial',
  'unsupported',
  'unavailable',
  'machine_offline',
  'malformed',
] as const

export type NativeTranscriptStatus = (typeof nativeTranscriptStatuses)[number]

export const nativeTranscriptRoles = [
  'user',
  'assistant',
  'system',
  'tool',
] as const

export type NativeTranscriptRole = (typeof nativeTranscriptRoles)[number]

export const nativeTranscriptKinds = [
  'message',
  'tool_call',
  'tool_result',
  'status',
  'other_safe_event',
] as const

export type NativeTranscriptKind = (typeof nativeTranscriptKinds)[number]

/**
 * Provider-normalized, read-only historical content. It is deliberately not a
 * Turn or Agent event and carries no action, execution, Approval, or retry
 * identity.
 */
export interface NativeTranscriptEntry {
  readonly id: string
  readonly provider: AgentProvider
  readonly role: NativeTranscriptRole
  readonly kind: NativeTranscriptKind
  readonly content: string
  readonly occurredAt?: string
  readonly nativeSequence?: number
  readonly readOnly: true
}

export interface NativeTranscriptReadMetrics {
  readonly bytesRead: number
  readonly recordsScanned: number
  readonly entriesReturned: number
  readonly elapsedMs: number
  readonly truncated: boolean
}

export interface NativeTranscriptPage {
  readonly provider: AgentProvider
  readonly status: NativeTranscriptStatus
  readonly entries: readonly NativeTranscriptEntry[]
  readonly nextCursor?: string
  readonly complete: boolean
  readonly metrics: NativeTranscriptReadMetrics
}

export interface ProviderSessionTranscriptReadRequest {
  /** Exact Machine-local canonical ProjectLocation root. */
  readonly projectRoot: string
  /** Provider-private identity obtained from the durable adopted binding. */
  readonly nativeSessionId: string
  /** Provider-private adoption boundary. Absence identifies a legacy adoption. */
  readonly boundary?: string
  /** Conservative split point used only for a legacy adoption. */
  readonly adoptedAt: string
  readonly cursor?: string
  readonly limit: number
  readonly signal?: AbortSignal
}

/** Provider adapters alone understand native transcript storage and cursors. */
export interface ProviderSessionTranscriptReader {
  readonly provider: AgentProvider
  readSessionTranscript(
    request: ProviderSessionTranscriptReadRequest,
  ): Promise<NativeTranscriptPage>
}
