export const machineProtocolVersion = 1 as const

const providerProbeTimeoutMs = 5_000
const maximumProviderInstallationsPerProvider = 8
const providerLifecycleDiscoveryWorkTimeoutMs =
  providerProbeTimeoutMs * (2 * maximumProviderInstallationsPerProvider + 1)
// Claude's lifecycle probe cleanup may perform three exact child/process-group
// exit waits. Codex compatibility cleanup is bounded below that ceiling. Keep
// the response reserve at the complete longest lifecycle cleanup bound.
const providerLifecycleMaximumCleanupMs = 3 * providerProbeTimeoutMs
const providerLifecycleResponseDeliveryMarginMs = 10_000
const providerLifecycleResponseMarginMs =
  providerLifecycleMaximumCleanupMs + providerLifecycleResponseDeliveryMarginMs
const providerLifecycleResponseTimeoutMs =
  providerLifecycleDiscoveryWorkTimeoutMs + providerLifecycleResponseMarginMs
const providerSessionDiscoveryWorkTimeoutMs = 30_000
const providerSessionDiscoveryResponseTimeoutMs =
  providerLifecycleResponseTimeoutMs + providerSessionDiscoveryWorkTimeoutMs
const providerSessionTranscriptWorkTimeoutMs = 30_000
const providerSessionTranscriptResponseTimeoutMs =
  providerLifecycleResponseTimeoutMs + providerSessionTranscriptWorkTimeoutMs
const providerSessionHandshakeTimeoutMs =
  3 * providerProbeTimeoutMs + 2 * 30_000 + 15_000

export const machineTransportLimits = {
  maximumFrameBytes: 16 * 1024,
  maximumBufferedBytes: 32 * 1024,
  maximumQueuedFrames: 8,
  handshakeTimeoutMs: 8_000,
  messageTimeoutMs: 8_000,
  pairingConfirmationTimeoutMs: 5 * 60_000,
  pairingLifetimeMs: 5 * 60_000,
  pairingMaximumAttempts: 5,
  maximumConnections: 16,
  maximumConnectionsPerAddress: 4,
  maximumProjectLocationPathBytes: 4 * 1024,
  // A cold Node restart may need the complete exact-installation lifecycle
  // response before the existing bounded read-only native-store operation.
  providerSessionDiscoveryWorkTimeoutMs,
  providerSessionDiscoveryTimeoutMs: providerSessionDiscoveryResponseTimeoutMs,
  // A complete paginated discovery operation is bounded independently from
  // each Machine request so empty/slow cursor chains cannot monopolize the
  // per-Machine operation authority for hours. A cold first page receives the
  // complete lifecycle response envelope before the existing 60s scan budget.
  providerSessionDiscoveryTotalTimeoutMs:
    providerLifecycleResponseTimeoutMs + 60_000,
  providerSessionDiscoveryMaximumPages: 128,
  // Eight worst-case private candidates remain below the 16 KiB frame bound.
  providerSessionDiscoveryPageSize: 8,
  providerSessionDiscoveryMaximumCandidates: 1_000,
  providerSessionDiscoveryMaximumFiles: 10_000,
  maximumProviderSessionDiscoveryCursorBytes: 512,
  maximumProviderSessionDiscoveryTitleBytes: 512,
  maximumProviderSessionDiscoveryRevisionBytes: 128,
  providerSessionTranscriptWorkTimeoutMs,
  providerSessionTranscriptTimeoutMs:
    providerSessionTranscriptResponseTimeoutMs,
  providerSessionTranscriptTotalTimeoutMs:
    providerLifecycleResponseTimeoutMs + 60_000,
  // Transcript content shares the existing 16 KiB Machine frame. Eight
  // normalized entries capped at 1 KiB each leave room for identities,
  // timestamps, metrics, and JSON framing without widening that boundary.
  providerSessionTranscriptPageSize: 8,
  maximumProviderSessionTranscriptPages: 128,
  maximumProviderSessionTranscriptEntryIdBytes: 512,
  maximumProviderSessionTranscriptEntryContentBytes: 1024,
  maximumProviderSessionTranscriptPageContentBytes: 8 * 1024,
  maximumProviderSessionTranscriptBoundaryBytes: 2 * 1024,
  maximumProviderSessionTranscriptCursorBytes: 512,
  providerProbeTimeoutMs,
  maximumProviderInstallationsPerProvider,
  maximumProviderInstallationCandidates: 32,
  maximumProviderInstallationPathEntries: 64,
  // A cold lifecycle scan observes Codex and Claude concurrently and may run
  // several zero-inference contracts per retained installation. This is an
  // explicit overall budget, not a claim that every pathological eight-item
  // scan can finish: it permits substantially more than the old 8s envelope
  // while still ending a slow scan and its owned children. Reserve an explicit
  // exact-cleanup/transport margin strictly beyond Claude's three bounded
  // cleanup waits so a deadline-triggered stop and typed authenticated reply
  // can finish before Controller closes the response channel.
  providerLifecycleDiscoveryWorkTimeoutMs,
  providerDiscoveryTimeoutMs: providerLifecycleResponseTimeoutMs,
  // Session admission first revalidates the exact selected installation using
  // the full lifecycle budget. It may then run the outer Claude version probe,
  // preparation version probe, and auth-status probe serially (3 * 5s), or a
  // cold Codex initialize plus thread start/resume (2 * 30s), with the existing
  // bounded 15s transport/scheduling margin. Compose the complete lifecycle
  // response envelope (work plus exact cleanup/delivery) with that handshake
  // budget so Controller cannot destroy a connection while Node may already
  // own native session state created after a near-budget lifecycle refresh.
  providerSessionOpenTimeoutMs:
    providerLifecycleDiscoveryWorkTimeoutMs +
    providerLifecycleResponseMarginMs +
    providerSessionHandshakeTimeoutMs,
  maximumProviderProbeOutputBytes: 4 * 1024,
  maximumRemoteCodexPromptBytes: 8 * 1024,
  maximumRemoteCodexDeltaBytes: 8 * 1024,
  maximumRemoteCodexOutputBytes: 4 * 1024 * 1024,
  maximumRemoteCodexQueuedOutputBytes: 256 * 1024,
  maximumRemoteCodexQueuedEvents: 256,
  maximumRemoteCodexTurnEvents: 100_000,
  maximumRemoteCodexProviderIdentityBytes: 512,
  maximumRemoteCodexSessions: 8,
  remoteCodexTurnTimeoutMs: 10 * 60_000,
  remoteCodexSessionIdleTimeoutMs: 5 * 60_000,
  maximumRemoteClaudePromptBytes: 8 * 1024,
  maximumRemoteClaudeDeltaBytes: 8 * 1024,
  maximumRemoteClaudeToolOutputBytes: 8 * 1024,
  maximumRemoteClaudeToolCommandBytes: 4 * 1024,
  maximumRemoteClaudeToolSummaryBytes: 1024,
  maximumRemoteClaudeOutputBytes: 4 * 1024 * 1024,
  maximumRemoteClaudeQueuedOutputBytes: 256 * 1024,
  maximumRemoteClaudeQueuedEvents: 256,
  maximumRemoteClaudeTurnEvents: 100_000,
  maximumRemoteClaudeTurnItems: 256,
  maximumRemoteClaudeSessions: 8,
  remoteClaudeTurnTimeoutMs: 10 * 60_000,
  remoteClaudeSessionIdleTimeoutMs: 5 * 60_000,
  remoteExecutionHeartbeatIntervalMs: 10_000,
  remoteExecutionHeartbeatTimeoutMs: 10_000,
  remoteExecutionSessionLeaseTimeoutMs: 40_000,
  heartbeatIntervalMs: 30_000,
  heartbeatTimeoutMs: 10_000,
} as const

export const machineTransportAlpn = 'codetether-machine/1' as const
export const machineTransportExporterLabel =
  'EXPORTER-CodeTether-Machine-v1' as const
