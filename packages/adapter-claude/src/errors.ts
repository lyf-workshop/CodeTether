import type { CanonicalFailureReason } from '@codetether/agent-core'

export type ClaudeCodeErrorCode =
  | 'provider_not_installed'
  | 'provider_version_unsupported'
  | 'provider_start_failed'
  | 'provider_session_lost'
  | 'provider_unavailable'

export interface ClaudeCodeErrorOptions extends ErrorOptions {
  readonly failureReason?: CanonicalFailureReason
}

export class ClaudeCodeError extends Error {
  override readonly name: string = 'ClaudeCodeError'
  readonly failureReason: CanonicalFailureReason

  constructor(
    readonly code: ClaudeCodeErrorCode,
    message: string,
    options?: ClaudeCodeErrorOptions,
  ) {
    const { failureReason = 'provider_error', ...errorOptions } = options ?? {}
    super(message, errorOptions)
    this.failureReason = failureReason
  }
}

export class ClaudeCodeNotInstalledError extends ClaudeCodeError {
  override readonly name: string = 'ClaudeCodeNotInstalledError'

  constructor(options?: ErrorOptions) {
    super(
      'provider_not_installed',
      'Claude Code is not installed or could not be found.',
      { ...options, failureReason: 'provider_not_installed' },
    )
  }
}

export class ClaudeCodeMisconfiguredError extends ClaudeCodeError {
  override readonly name: string = 'ClaudeCodeMisconfiguredError'

  constructor(options?: ErrorOptions) {
    super(
      'provider_unavailable',
      'Claude Code is installed but is not configured for this environment.',
      { ...options, failureReason: 'provider_misconfigured' },
    )
  }
}

export class ClaudeCodeVersionUnsupportedError extends ClaudeCodeError {
  override readonly name: string = 'ClaudeCodeVersionUnsupportedError'

  constructor(
    readonly version: string,
    options?: ErrorOptions,
  ) {
    super(
      'provider_version_unsupported',
      `Claude Code ${version} has not been validated with this CodeTether build.`,
      { ...options, failureReason: 'provider_unsupported_version' },
    )
  }
}

export class ClaudeCodeStartError extends ClaudeCodeError {
  override readonly name: string = 'ClaudeCodeStartError'

  constructor(options?: ClaudeCodeErrorOptions) {
    super('provider_start_failed', 'Claude Code could not start this turn.', {
      failureReason: 'provider_start_failed',
      ...options,
    })
  }
}

export class ClaudeCodeProcessExitError extends ClaudeCodeError {
  override readonly name: string = 'ClaudeCodeProcessExitError'

  constructor(options?: ErrorOptions) {
    super(
      'provider_unavailable',
      'Claude Code exited before completing this turn.',
      { ...options, failureReason: 'provider_crashed' },
    )
  }
}

/** Exact owned child/process-group cleanup could not be proven complete. */
export class ClaudeCodeOwnedProcessCleanupError extends ClaudeCodeError {
  override readonly name: string = 'ClaudeCodeOwnedProcessCleanupError'

  constructor(options?: ErrorOptions) {
    super(
      'provider_start_failed',
      'Claude Code owned process cleanup could not be verified.',
      { ...options, failureReason: 'execution_ownership_uncertain' },
    )
  }
}

export class ClaudeCodeSessionLostError extends ClaudeCodeError {
  override readonly name: string = 'ClaudeCodeSessionLostError'

  constructor(options?: ErrorOptions) {
    super(
      'provider_session_lost',
      'The saved Claude Code session is no longer available.',
      { ...options, failureReason: 'provider_session_lost' },
    )
  }
}

export class ClaudeCodeProtocolError extends ClaudeCodeError {
  override readonly name: string = 'ClaudeCodeProtocolError'

  constructor(options?: ClaudeCodeErrorOptions) {
    super(
      'provider_start_failed',
      'Claude Code returned an unsupported response.',
      { failureReason: 'provider_protocol_error', ...options },
    )
  }
}

/** Internal control-flow signal for an owner-requested process shutdown. */
export class ClaudeCodeTurnInterruptedError extends Error {
  override readonly name = 'ClaudeCodeTurnInterruptedError'

  constructor() {
    super('The Claude Code Turn was interrupted by its owner.')
  }
}

export class ClaudeJsonLineTooLongError extends ClaudeCodeProtocolError {
  override readonly name: string = 'ClaudeJsonLineTooLongError'

  constructor(
    readonly maxLineBytes: number,
    readonly observedLineBytes: number,
  ) {
    super({ failureReason: 'protocol_limit_exceeded' })
  }
}

export function asClaudeCodeError(error: unknown): ClaudeCodeError {
  if (error instanceof ClaudeCodeError) return error
  return new ClaudeCodeStartError(
    error instanceof Error ? { cause: error } : undefined,
  )
}
