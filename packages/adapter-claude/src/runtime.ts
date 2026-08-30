import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'

import type { AgentEvent } from '@codetether/agent-core'

import {
  asClaudeCodeError,
  ClaudeCodeError,
  ClaudeCodeStartError,
  ClaudeCodeTurnInterruptedError,
} from './errors.js'
import {
  startClaudeCodeTurnProcess,
  type ClaudeCodeTurnProcessHandle,
} from './process.js'
import type {
  ClaudeCodeFailure,
  ClaudeCodeLauncher,
  ClaudeCodeTurnResult,
} from './types.js'

export interface ClaudeCodeSessionOptions {
  readonly launcher: ClaudeCodeLauncher
  readonly cwd: string
  readonly environment?: NodeJS.ProcessEnv
  readonly testedVersion?: string
}

export interface ClaudeCodeCreateSessionOptions extends ClaudeCodeSessionOptions {
  readonly sessionId?: string
}

export interface ClaudeCodeResumeSessionOptions extends ClaudeCodeSessionOptions {
  readonly sessionId: string
}

export interface ClaudeCodeStartTurnOptions {
  readonly turnId: string
  readonly prompt: string
}

export type ClaudeCodeEventListener = (
  event: AgentEvent,
) => void | Promise<void>
export type ClaudeCodeFailureListener = (
  failure: ClaudeCodeFailure,
) => void | Promise<void>

export class ClaudeCodeSessionRuntime {
  readonly sessionId: string
  readonly cwd: string
  readonly #launcher: ClaudeCodeLauncher
  readonly #environment?: NodeJS.ProcessEnv
  readonly #testedVersion?: string
  readonly #eventListeners = new Set<ClaudeCodeEventListener>()
  readonly #failureListeners = new Set<ClaudeCodeFailureListener>()
  #resume: boolean
  #closed = false
  #active?: ClaudeCodeTurnProcessHandle

  private constructor(
    options: ClaudeCodeSessionOptions & {
      readonly sessionId: string
      readonly resume: boolean
    },
  ) {
    if (!isAbsolute(options.cwd)) throw new TypeError('cwd must be absolute')
    this.sessionId = options.sessionId
    this.cwd = options.cwd
    this.#launcher = options.launcher
    this.#environment = options.environment
    this.#testedVersion = options.testedVersion
    this.#resume = options.resume
  }

  static createSession(
    options: ClaudeCodeCreateSessionOptions,
  ): ClaudeCodeSessionRuntime {
    return new ClaudeCodeSessionRuntime({
      ...options,
      sessionId: options.sessionId ?? randomUUID(),
      resume: false,
    })
  }

  static resumeSession(
    options: ClaudeCodeResumeSessionOptions,
  ): ClaudeCodeSessionRuntime {
    return new ClaudeCodeSessionRuntime({ ...options, resume: true })
  }

  subscribeEvents(listener: ClaudeCodeEventListener): () => void {
    this.#eventListeners.add(listener)
    return () => this.#eventListeners.delete(listener)
  }

  subscribeFailures(listener: ClaudeCodeFailureListener): () => void {
    this.#failureListeners.add(listener)
    return () => this.#failureListeners.delete(listener)
  }

  async startTurn(
    options: ClaudeCodeStartTurnOptions,
  ): Promise<ClaudeCodeTurnResult> {
    if (this.#closed) throw new ClaudeCodeStartError()
    if (this.#active !== undefined) {
      throw new ClaudeCodeError(
        'provider_unavailable',
        'Claude Code is already running a turn for this conversation.',
      )
    }

    const handle = startClaudeCodeTurnProcess({
      launcher: this.#launcher,
      sessionId: this.sessionId,
      turnId: options.turnId,
      cwd: this.cwd,
      prompt: options.prompt,
      resume: this.#resume,
      ...(this.#environment === undefined
        ? {}
        : { environment: this.#environment }),
      ...(this.#testedVersion === undefined
        ? {}
        : { testedVersion: this.#testedVersion }),
      onEvent: async (event) => {
        for (const listener of this.#eventListeners) await listener(event)
      },
    })
    this.#active = handle
    try {
      const result = await handle.completion
      this.#resume = true
      return result
    } catch (error) {
      if (error instanceof ClaudeCodeTurnInterruptedError) throw error
      const safeError = asClaudeCodeError(error)
      const failure: ClaudeCodeFailure = {
        sessionId: this.sessionId,
        turnId: options.turnId,
        code: safeError.code,
        message: safeError.message,
      }
      for (const listener of this.#failureListeners) await listener(failure)
      throw safeError
    } finally {
      if (this.#active === handle) this.#active = undefined
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    const active = this.#active
    if (active === undefined) return
    await active.close()
    await active.completion.catch(() => undefined)
  }
}

export function createClaudeCodeSession(
  options: ClaudeCodeCreateSessionOptions,
): ClaudeCodeSessionRuntime {
  return ClaudeCodeSessionRuntime.createSession(options)
}

export function resumeClaudeCodeSession(
  options: ClaudeCodeResumeSessionOptions,
): ClaudeCodeSessionRuntime {
  return ClaudeCodeSessionRuntime.resumeSession(options)
}
