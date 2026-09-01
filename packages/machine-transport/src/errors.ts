export type MachineTransportErrorCode =
  | 'pairing_disabled'
  | 'pairing_expired'
  | 'pairing_rate_limited'
  | 'pairing_failed'
  | 'authentication_failed'
  | 'identity_mismatch'
  | 'protocol_incompatible'
  | 'connection_failed'
  | 'timeout'
  | 'malformed_message'
  | 'busy'
  | 'project_location_path_invalid'
  | 'project_location_missing'
  | 'project_location_not_directory'
  | 'project_location_inaccessible'
  | 'remote_execution_unavailable'
  | 'provider_unavailable'
  | 'provider_start_failed'
  | 'provider_session_lost'
  | 'remote_execution_lost'
  | 'remote_policy_violation'
  | 'conversation_busy'
  | 'duplicate_action_conflict'

export class MachineTransportError extends Error {
  /** True only for a protocol error received after the TLS peer was pinned. */
  readonly peerAuthenticated: boolean

  constructor(
    readonly code: MachineTransportErrorCode,
    message: string,
    options?: ErrorOptions & { readonly peerAuthenticated?: boolean },
  ) {
    super(message, options)
    this.name = 'MachineTransportError'
    this.peerAuthenticated = options?.peerAuthenticated === true
  }
}

export function toMachineTransportError(error: unknown): MachineTransportError {
  if (error instanceof MachineTransportError) return error
  return new MachineTransportError(
    'connection_failed',
    'Machine connection failed',
    {
      cause: error,
    },
  )
}
