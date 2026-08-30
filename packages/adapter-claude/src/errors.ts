export type ClaudeCodeErrorCode =
  | 'provider_not_installed'
  | 'provider_version_unsupported'
  | 'provider_start_failed'
  | 'provider_session_lost'
  | 'provider_unavailable'

export class ClaudeCodeError extends Error {
  override readonly name: string = 'ClaudeCodeError'

  constructor(
    readonly code: ClaudeCodeErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

export class ClaudeCodeNotInstalledError extends ClaudeCodeError {
  override readonly name: string = 'ClaudeCodeNotInstalledError'

  constructor(options?: ErrorOptions) {
    super(
      'provider_not_installed',
      'Claude Code is not installed or could not be found.',
      options,
    )
  }
}

export class ClaudeCodeMisconfiguredError extends ClaudeCodeError {
  override readonly name: string = 'ClaudeCodeMisconfiguredError'

  constructor(options?: ErrorOptions) {
    super(
      'provider_unavailable',
      'Claude Code is installed but is not configured for this environment.',
      options,
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
      options,
    )
  }
}

export class ClaudeCodeStartError extends ClaudeCodeError {
  override readonly name: string = 'ClaudeCodeStartError'

  constructor(options?: ErrorOptions) {
    super(
      'provider_start_failed',
      'Claude Code could not start this turn.',
      options,
    )
  }
}

export class ClaudeCodeSessionLostError extends ClaudeCodeError {
  override readonly name: string = 'ClaudeCodeSessionLostError'

  constructor(options?: ErrorOptions) {
    super(
      'provider_session_lost',
      'The saved Claude Code session is no longer available.',
      options,
    )
  }
}

export class ClaudeCodeProtocolError extends ClaudeCodeError {
  override readonly name: string = 'ClaudeCodeProtocolError'

  constructor(options?: ErrorOptions) {
    super(
      'provider_start_failed',
      'Claude Code returned an unsupported response.',
      options,
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
    super()
  }
}

export function asClaudeCodeError(error: unknown): ClaudeCodeError {
  if (error instanceof ClaudeCodeError) return error
  return new ClaudeCodeStartError(
    error instanceof Error ? { cause: error } : undefined,
  )
}
