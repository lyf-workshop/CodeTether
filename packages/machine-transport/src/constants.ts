export const machineProtocolVersion = 1 as const

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
  providerDiscoveryTimeoutMs: 8_000,
  providerSessionDiscoveryTimeoutMs: 30_000,
  // A complete paginated discovery operation is bounded independently from
  // each Machine request so empty/slow cursor chains cannot monopolize the
  // per-Machine operation authority for hours.
  providerSessionDiscoveryTotalTimeoutMs: 60_000,
  providerSessionDiscoveryMaximumPages: 128,
  // Eight worst-case private candidates remain below the 16 KiB frame bound.
  providerSessionDiscoveryPageSize: 8,
  providerSessionDiscoveryMaximumCandidates: 1_000,
  providerSessionDiscoveryMaximumFiles: 10_000,
  maximumProviderSessionDiscoveryCursorBytes: 512,
  maximumProviderSessionDiscoveryTitleBytes: 512,
  maximumProviderSessionDiscoveryRevisionBytes: 128,
  providerProbeTimeoutMs: 5_000,
  maximumProviderInstallationsPerProvider: 8,
  maximumProviderInstallationCandidates: 32,
  maximumProviderInstallationPathEntries: 64,
  // Session admission may run the outer Claude version probe, preparation
  // version probe, and auth-status probe serially (3 * 5s), followed on a
  // cold Codex open by initialize and thread start/resume (2 * 30s), with a
  // bounded 15s transport/scheduling margin. It is intentionally distinct
  // from the already-running Provider discovery response budget above.
  providerSessionOpenTimeoutMs: 90_000,
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
