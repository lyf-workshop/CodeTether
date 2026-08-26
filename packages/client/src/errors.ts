import type { SafeErrorEnvelope } from '@codetether/protocol'

export class CodeTetherProtocolError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CodeTetherProtocolError'
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
