import type { AgentProvider } from './events.js'

export const providerSessionDiscoveryStatuses = [
  'supported',
  'unsupported',
  'unavailable',
] as const

export type ProviderSessionDiscoveryStatus =
  (typeof providerSessionDiscoveryStatuses)[number]

export const providerSessionResumeStatuses = [
  'supported',
  'unsupported',
  'unavailable',
] as const

export type ProviderSessionResumeStatus =
  (typeof providerSessionResumeStatuses)[number]

export const providerHistoricalTranscriptStatuses = [
  'supported',
  'unsupported',
  'unavailable',
] as const

export type ProviderHistoricalTranscriptStatus =
  (typeof providerHistoricalTranscriptStatuses)[number]

export const providerSessionDiscoveryFailureReasons = [
  'provider_session_discovery_unavailable',
  'provider_session_format_unsupported',
  'provider_session_store_unreadable',
  'machine_offline',
] as const

export type ProviderSessionDiscoveryFailureReason =
  (typeof providerSessionDiscoveryFailureReasons)[number]

/**
 * Provider-private native session metadata. This type must remain behind the
 * Host/Node adapter boundary: nativeSessionId, revision, and workingDirectory
 * are never public Protocol v1 fields.
 */
export interface NativeProviderSessionCandidate {
  readonly provider: AgentProvider
  readonly nativeSessionId: string
  readonly revision: string
  readonly workingDirectory: string
  readonly title: string
  readonly createdAt?: string
  readonly lastActiveAt?: string
  readonly providerVersion?: string
  readonly resumeStatus: ProviderSessionResumeStatus
  readonly historicalTranscript: ProviderHistoricalTranscriptStatus
}

export interface ProviderSessionDiscoveryMetrics {
  readonly filesInspected: number
  readonly candidatesParsed: number
  readonly candidatesMatched: number
  readonly corruptEntriesSkipped: number
  readonly elapsedMs: number
  readonly truncated: boolean
}

export interface ProviderSessionDiscoveryPage {
  readonly provider: AgentProvider
  readonly status: ProviderSessionDiscoveryStatus
  /** Provider runtime's current native-resume capability, independent of enumeration. */
  readonly resumeStatus: ProviderSessionResumeStatus
  readonly providerVersion?: string
  readonly candidates: readonly NativeProviderSessionCandidate[]
  readonly nextCursor?: string
  readonly failureReason?: ProviderSessionDiscoveryFailureReason
  readonly metrics: ProviderSessionDiscoveryMetrics
}

export interface ProviderSessionDiscoveryRequest {
  /** Exact Machine-local canonical ProjectLocation root. */
  readonly projectRoot: string
  readonly cursor?: string
  /** Adapters must reject values outside their documented hard bound. */
  readonly limit: number
  readonly signal?: AbortSignal
}

export interface ProviderSessionCandidateValidationRequest {
  /** Exact Machine-local canonical ProjectLocation root. */
  readonly projectRoot: string
  readonly nativeSessionId: string
  readonly revision: string
  readonly signal?: AbortSignal
}

export interface ProviderSessionDiscovery {
  readonly provider: AgentProvider
  discover(
    request: ProviderSessionDiscoveryRequest,
  ): Promise<ProviderSessionDiscoveryPage>
  validateCandidate(
    request: ProviderSessionCandidateValidationRequest,
  ): Promise<NativeProviderSessionCandidate | undefined>
}
