export const relayProtocolVersion = 1 as const

export const relayProtocolAlpn = 'codetether-relay/1' as const

export const relayProtocolLimits = {
  maximumFrameBytes: 8 * 1024,
  maximumBufferedBytes: 16 * 1024,
  maximumQueuedFrames: 16,
  maximumPendingRequests: 32,
  maximumConnections: 1_024,
  maximumConnectionsPerAddress: 16,
  maximumIdentifierCharacters: 128,
  maximumBuildIdentityCharacters: 120,
  maximumErrorMessageCharacters: 240,
  handshakeTimeoutMs: 10_000,
  authenticationTimeoutMs: 10_000,
  messageTimeoutMs: 8_000,
  challengeLifetimeMs: 15_000,
  heartbeatIntervalMs: 30_000,
  heartbeatTimeoutMs: 75_000,
  maximumSubscriptionsPerController: 32,
  maximumRateLimitEntries: 10_000,
  enrollmentTokenLifetimeMs: 10 * 60_000,
  enrollmentMaximumAttempts: 5,
  reconnectInitialDelayMs: 1_000,
  reconnectMaximumDelayMs: 60_000,
} as const
