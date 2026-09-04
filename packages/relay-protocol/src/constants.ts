export const relayProtocolVersion = 2 as const

// The ALPN labels the TLS transport family. JSON handshake versioning performs
// the explicit v1/v2 compatibility check after both peers reach the Relay.
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
  maximumChannels: 256,
  maximumChannelsPerPeer: 8,
  maximumChannelOpenAttemptsPerMinute: 240,
  maximumStaleChannelFramesPerConnection: 32,
  maximumTerminalChannelFrames: 4,
  maximumChannelDataBytes: 4 * 1024,
  maximumChannelEncodedDataCharacters: 5_462,
  channelOpenTimeoutMs: 10_000,
  channelAcknowledgementTimeoutMs: 10_000,
  maximumRateLimitEntries: 10_000,
  enrollmentTokenLifetimeMs: 10 * 60_000,
  enrollmentMaximumAttempts: 5,
  reconnectInitialDelayMs: 1_000,
  reconnectMaximumDelayMs: 60_000,
} as const
