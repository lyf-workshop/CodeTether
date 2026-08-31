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

export class MachineTransportError extends Error {
  constructor(
    readonly code: MachineTransportErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'MachineTransportError'
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
