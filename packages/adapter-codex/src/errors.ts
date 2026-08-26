export class CodexExecutableNotFoundError extends Error {
  override readonly name: string = 'CodexExecutableNotFoundError'

  constructor(executable: string, options?: ErrorOptions) {
    super(`Codex executable was not found: ${executable}`, options)
  }
}

export class CodexProcessError extends Error {
  override readonly name: string = 'CodexProcessError'
}

export class CodexProcessExitError extends CodexProcessError {
  override readonly name: string = 'CodexProcessExitError'

  constructor(code: number | null, signal: NodeJS.Signals | null) {
    const detail = signal === null ? `code ${String(code)}` : `signal ${signal}`
    super(`Codex App Server exited unexpectedly with ${detail}`)
  }
}

export class CodexProtocolError extends Error {
  override readonly name: string = 'CodexProtocolError'
}

export class JsonRpcRemoteError extends CodexProtocolError {
  override readonly name: string = 'JsonRpcRemoteError'

  constructor(
    readonly method: string,
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(`Codex App Server rejected ${method} (${String(code)}): ${message}`)
  }
}

export class JsonRpcRequestTimeoutError extends CodexProtocolError {
  override readonly name: string = 'JsonRpcRequestTimeoutError'

  constructor(method: string, timeoutMs: number) {
    super(`Timed out waiting ${String(timeoutMs)}ms for ${method}`)
  }
}
