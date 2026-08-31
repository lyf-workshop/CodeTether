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
  providerProbeTimeoutMs: 5_000,
  maximumProviderProbeOutputBytes: 4 * 1024,
  heartbeatIntervalMs: 30_000,
  heartbeatTimeoutMs: 10_000,
} as const

export const machineTransportAlpn = 'codetether-machine/1' as const
export const machineTransportExporterLabel =
  'EXPORTER-CodeTether-Machine-v1' as const
