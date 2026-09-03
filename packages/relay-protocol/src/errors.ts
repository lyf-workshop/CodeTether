export const relayErrorCodes = [
  'authentication_failed',
  'identity_mismatch',
  'protocol_incompatible',
  'enrollment_invalid',
  'enrollment_expired',
  'enrollment_consumed',
  'revoked',
  'rate_limited',
  'not_authorized',
  'stale_connection',
  'malformed_message',
  'capacity_reached',
  'timeout',
  'connection_failed',
  'internal',
] as const

export type RelayErrorCode = (typeof relayErrorCodes)[number]

export class RelayProtocolError extends Error {
  constructor(
    readonly code: RelayErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'RelayProtocolError'
  }
}

export function toRelayProtocolError(error: unknown): RelayProtocolError {
  if (error instanceof RelayProtocolError) return error
  return new RelayProtocolError(
    'connection_failed',
    'Relay connection failed',
    { cause: error },
  )
}
