import type { CanonicalFailureReason } from '@codetether/agent-core'

import { classifyCodexErrorInfo } from './failure-classifier.js'

export interface CodexErrorOptions extends ErrorOptions {
  readonly failureReason?: CanonicalFailureReason
}

export class CodexExecutableNotFoundError extends Error {
  override readonly name: string = 'CodexExecutableNotFoundError'
  readonly failureReason: CanonicalFailureReason = 'provider_not_installed'

  constructor(_executable: string, options?: ErrorOptions) {
    super('Codex is not installed or could not be found.', options)
  }
}

export class CodexProcessError extends Error {
  override readonly name: string = 'CodexProcessError'

  readonly failureReason: CanonicalFailureReason

  constructor(message: string, options?: CodexErrorOptions) {
    const { failureReason = 'provider_start_failed', ...errorOptions } =
      options ?? {}
    super(message, errorOptions)
    this.failureReason = failureReason
  }
}

export class CodexProcessExitError extends CodexProcessError {
  override readonly name: string = 'CodexProcessExitError'

  constructor(code: number | null, signal: NodeJS.Signals | null) {
    const detail = signal === null ? `code ${String(code)}` : `signal ${signal}`
    super(`Codex App Server exited unexpectedly with ${detail}`, {
      failureReason: 'provider_crashed',
    })
  }
}

export class CodexProtocolError extends Error {
  override readonly name: string = 'CodexProtocolError'

  readonly failureReason: CanonicalFailureReason

  constructor(message: string, options?: CodexErrorOptions) {
    const { failureReason = 'provider_protocol_error', ...errorOptions } =
      options ?? {}
    super(message, errorOptions)
    this.failureReason = failureReason
  }
}

export class JsonRpcLineTooLongError extends CodexProtocolError {
  override readonly name: string = 'JsonRpcLineTooLongError'

  constructor(
    readonly maxLineBytes: number,
    readonly observedLineBytes: number,
  ) {
    super(
      `Codex App Server emitted a JSON-RPC line larger than ${String(maxLineBytes)} bytes (observed ${String(observedLineBytes)} bytes)`,
      { failureReason: 'protocol_limit_exceeded' },
    )
  }
}

export class JsonRpcRemoteError extends CodexProtocolError {
  override readonly name: string = 'JsonRpcRemoteError'

  constructor(
    readonly method: string,
    readonly code: number,
    _message: string,
    readonly data?: unknown,
  ) {
    super(`Codex App Server rejected ${method} (${String(code)}).`, {
      failureReason: classifyCodexErrorInfo(
        isRecord(data) ? data.codexErrorInfo : undefined,
      ),
    })
  }
}

export class JsonRpcRequestTimeoutError extends CodexProtocolError {
  override readonly name: string = 'JsonRpcRequestTimeoutError'

  constructor(method: string, timeoutMs: number) {
    super(`Timed out waiting ${String(timeoutMs)}ms for ${method}`, {
      failureReason: isOwnershipCreatingMethod(method)
        ? 'execution_ownership_uncertain'
        : 'provider_start_failed',
    })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isOwnershipCreatingMethod(method: string): boolean {
  return (
    method === 'thread/start' ||
    method === 'thread/resume' ||
    method === 'turn/start'
  )
}
