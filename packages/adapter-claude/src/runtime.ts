import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'

import type { AgentEvent } from '@codetether/agent-core'

import {
  asClaudeCodeError,
  ClaudeCodeError,
  ClaudeCodeOwnedProcessCleanupError,
  ClaudeCodeStartError,
  ClaudeCodeTurnInterruptedError,
} from './errors.js'
import {
  startClaudeCodeTurnProcess,
  type ClaudeCodeProcessFactory,
  type ClaudeCodeProcessOwnership,
  type ClaudeCodeTurnProcessHandle,
} from './process.js'
import type {
  ClaudeCodeEffort,
  ClaudeCodeFailure,
  ClaudeCodeLauncher,
  ClaudeCodeTurnResult,
} from './types.js'

export interface ClaudeCodeSessionOptions {
  readonly launcher: ClaudeCodeLauncher
  readonly cwd: string
  readonly environment?: NodeJS.ProcessEnv
  readonly testedVersion?: string
  /** Node-only opt-in. Omitted for the frozen local direct-child profile. */
  readonly processOwnership?: ClaudeCodeProcessOwnership
  /** Node-private ownership seam. Omitted for local Claude. */
  readonly processFactory?: ClaudeCodeProcessFactory
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
  readonly effort?: ClaudeCodeEffort
}

export interface ClaudeCodeTurnExecution {
  readonly ownershipEstablished: Promise<void>
  readonly completion: Promise<ClaudeCodeTurnResult>
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
  readonly #processOwnership?: ClaudeCodeProcessOwnership
  readonly #processFactory?: ClaudeCodeProcessFactory
  readonly #eventListeners = new Set<ClaudeCodeEventListener>()
  readonly #failureListeners = new Set<ClaudeCodeFailureListener>()
  #resume: boolean
  #closed = false
  #active?: ClaudeCodeTurnProcessHandle
  #closePromise?: Promise<void>
  #cleanupFailure?: ClaudeCodeOwnedProcessCleanupError

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
    this.#processOwnership = options.processOwnership
    this.#processFactory = options.processFactory
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
    return await this.startTurnExecution(options).completion
  }

  /** Node execution uses this to acknowledge real process ownership first. */
  startTurnExecution(
    options: ClaudeCodeStartTurnOptions,
  ): ClaudeCodeTurnExecution {
    if (this.#cleanupFailure !== undefined) throw this.#cleanupFailure
    if (this.#closed) throw new ClaudeCodeStartError()
    if (this.#active !== undefined) {
      throw new ClaudeCodeError(
        'provider_unavailable',
        'Claude Code is already running a turn for this conversation.',
        { failureReason: 'conversation_busy' },
      )
    }

    const handle = startClaudeCodeTurnProcess({
      launcher: this.#launcher,
      sessionId: this.sessionId,
      turnId: options.turnId,
      cwd: this.cwd,
      prompt: options.prompt,
      resume: this.#resume,
      ...(options.effort === undefined ? {} : { effort: options.effort }),
      ...(this.#environment === undefined
        ? {}
        : { environment: this.#environment }),
      ...(this.#testedVersion === undefined
        ? {}
        : { testedVersion: this.#testedVersion }),
      ...(this.#processOwnership === undefined
        ? {}
        : { processOwnership: this.#processOwnership }),
      ...(this.#processFactory === undefined
        ? {}
        : { processFactory: this.#processFactory }),
      onEvent: async (event) => {
        for (const listener of this.#eventListeners) await listener(event)
      },
    })
    this.#active = handle
    const completion = (async () => {
      try {
        const result = await handle.completion
        this.#resume = true
        return result
      } catch (error) {
        if (error instanceof ClaudeCodeTurnInterruptedError) throw error
        const safeError = asClaudeCodeError(error)
        if (safeError instanceof ClaudeCodeOwnedProcessCleanupError) {
          this.#cleanupFailure ??= safeError
        }
        const failure: ClaudeCodeFailure = {
          sessionId: this.sessionId,
          turnId: options.turnId,
          code: safeError.code,
          message: safeError.message,
          failureReason: safeError.failureReason,
        }
        for (const listener of this.#failureListeners) await listener(failure)
        throw safeError
      } finally {
        if (this.#active === handle && this.#cleanupFailure === undefined) {
          this.#active = undefined
        }
      }
    })()
    return { ownershipEstablished: handle.ownershipEstablished, completion }
  }

  async close(): Promise<void> {
    this.#closePromise ??= this.#closeOwnedProcess()
    await this.#closePromise
  }

  async #closeOwnedProcess(): Promise<void> {
    if (this.#cleanupFailure !== undefined) throw this.#cleanupFailure
    if (this.#closed) return
    this.#closed = true
    const active = this.#active
    if (active === undefined) return
    try {
      await active.close()
    } catch (error) {
      const cleanupFailure =
        error instanceof ClaudeCodeOwnedProcessCleanupError
          ? error
          : new ClaudeCodeOwnedProcessCleanupError({
              ...(error instanceof Error ? { cause: error } : {}),
            })
      this.#cleanupFailure ??= cleanupFailure
      throw this.#cleanupFailure
    }
    try {
      await active.completion
    } catch (error) {
      if (error instanceof ClaudeCodeOwnedProcessCleanupError) {
        this.#cleanupFailure ??= error
        throw this.#cleanupFailure
      }
    }
    if (this.#cleanupFailure !== undefined) throw this.#cleanupFailure
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
