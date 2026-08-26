import { protocolVersion, type SafeErrorEnvelope } from '@codetether/protocol'

export class CodeTetherProtocolError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CodeTetherProtocolError'
  }
}

export class CodeTetherIncompatibleProtocolError extends CodeTetherProtocolError {
  readonly expectedVersion = protocolVersion
  readonly receivedVersion: unknown

  constructor(receivedVersion: unknown) {
    super('CodeTether Host protocol version is incompatible')
    this.name = 'CodeTetherIncompatibleProtocolError'
    this.receivedVersion = receivedVersion
  }
}

export class CodeTetherResponseError extends Error {
  readonly status: number
  readonly envelope: SafeErrorEnvelope

  constructor(status: number, envelope: SafeErrorEnvelope) {
    super(envelope.message)
    this.name = 'CodeTetherResponseError'
    this.status = status
    this.envelope = envelope
  }
}
