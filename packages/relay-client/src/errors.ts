import {
  RelayProtocolError,
  type RelayErrorCode,
  type RelayErrorMessage,
} from '@codetether/relay-protocol'

export const relayClientErrorCodes = [
  'relay_unreachable',
  'relay_tls_identity_mismatch',
  'relay_identity_mismatch',
  'relay_protocol_incompatible',
  'relay_authentication_failed',
  'relay_enrollment_required',
  'relay_revoked',
  'relay_rate_limited',
  'relay_capacity_reached',
  'relay_channel_open_failed',
  'relay_channel_lost',
  'relay_peer_offline',
  'relay_transport_capacity_reached',
  'relay_protocol_error',
  'relay_closed',
] as const

export type RelayClientErrorCode = (typeof relayClientErrorCodes)[number]

export class RelayClientError extends Error {
  constructor(
    readonly code: RelayClientErrorCode,
    message: string,
    readonly retryAfterMs?: number,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'RelayClientError'
  }
}

export function relayServerError(message: RelayErrorMessage): RelayClientError {
  const code = mapServerCode(message.code)
  return new RelayClientError(code, safeMessage(code), message.retryAfterMs)
}

export function relayConnectionError(error: unknown): RelayClientError {
  if (error instanceof RelayClientError) return error
  if (error instanceof RelayProtocolError) {
    return error.code === 'malformed_message'
      ? new RelayClientError(
          'relay_protocol_error',
          safeMessage('relay_protocol_error'),
          undefined,
          { cause: error },
        )
      : new RelayClientError(
          'relay_unreachable',
          safeMessage('relay_unreachable'),
          undefined,
          { cause: error },
        )
  }
  return new RelayClientError(
    'relay_unreachable',
    safeMessage('relay_unreachable'),
    undefined,
    { cause: error },
  )
}

export function isPermanentRelayClientError(error: unknown): boolean {
  return (
    error instanceof RelayClientError &&
    [
      'relay_tls_identity_mismatch',
      'relay_identity_mismatch',
      'relay_protocol_incompatible',
      'relay_revoked',
    ].includes(error.code)
  )
}

function mapServerCode(code: RelayErrorCode): RelayClientErrorCode {
  switch (code) {
    case 'identity_mismatch':
      return 'relay_identity_mismatch'
    case 'protocol_incompatible':
      return 'relay_protocol_incompatible'
    case 'revoked':
      return 'relay_revoked'
    case 'rate_limited':
      return 'relay_rate_limited'
    case 'capacity_reached':
      return 'relay_capacity_reached'
    case 'authentication_failed':
      return 'relay_authentication_failed'
    case 'enrollment_invalid':
    case 'enrollment_expired':
    case 'enrollment_consumed':
      return 'relay_enrollment_required'
    case 'connection_failed':
    case 'timeout':
      return 'relay_unreachable'
    case 'not_authorized':
    case 'stale_connection':
    case 'malformed_message':
    case 'internal':
      return 'relay_protocol_error'
  }
}

function safeMessage(code: RelayClientErrorCode): string {
  switch (code) {
    case 'relay_unreachable':
      return 'Internet Relay is unreachable'
    case 'relay_tls_identity_mismatch':
      return 'Internet Relay TLS identity did not match its pin'
    case 'relay_identity_mismatch':
      return 'Internet Relay identity did not match its pin'
    case 'relay_protocol_incompatible':
      return 'Internet Relay protocol is incompatible'
    case 'relay_authentication_failed':
      return 'Internet Relay authentication failed'
    case 'relay_enrollment_required':
      return 'Internet Relay enrollment is required'
    case 'relay_revoked':
      return 'Internet Relay enrollment was revoked'
    case 'relay_rate_limited':
      return 'Internet Relay temporarily rate limited this peer'
    case 'relay_capacity_reached':
      return 'Internet Relay connection capacity was reached'
    case 'relay_channel_open_failed':
      return 'Internet Relay Machine channel could not be opened'
    case 'relay_channel_lost':
      return 'Internet Relay Machine channel was lost'
    case 'relay_peer_offline':
      return 'Internet Relay Node is offline'
    case 'relay_transport_capacity_reached':
      return 'Internet Relay Machine channel capacity was reached'
    case 'relay_protocol_error':
      return 'Internet Relay returned an invalid control response'
    case 'relay_closed':
      return 'Internet Relay connection closed'
  }
}
