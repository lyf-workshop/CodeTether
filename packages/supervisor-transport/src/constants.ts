export const supervisorProtocolVersion = 1 as const
export const supervisorProofVersion = 1 as const
export const supervisorAudience = 'codetether-host-supervisor' as const
export const supervisorGrantProofType =
  'codetether-host-supervisor-grant+jws' as const
export const supervisorDescriptorProofType =
  'codetether-host-supervisor-transport+jws' as const
export const supervisorTransportAlpn = 'codetether-supervisor-v1'
export const supervisorTlsExporterLabel = 'EXPORTER-CodeTether-Supervisor-v1'

export const supervisorTransportLimits = {
  maximumFrameBytes: 256 * 1024,
  maximumQueuedFrames: 32,
  maximumEndpoints: 8,
  maximumActivations: 64,
  maximumInboundSockets: 64,
  maximumHostCharacters: 255,
  maximumProofBytes: 8 * 1024,
  maximumAccessTokenBytes: 16 * 1024,
  handshakeTimeoutMs: 8_000,
  messageTimeoutMs: 8_000,
  sessionLifetimeMs: 5 * 60_000,
  descriptorLifetimeMs: 10 * 60_000,
  maximumClockSkewMs: 120_000,
} as const
