import { randomUUID } from 'node:crypto'

import type { AgentEvent } from '@codetether/agent-core'
import {
  CLAUDE_CODE_CAPABILITIES,
  CLAUDE_CODE_TESTED_VERSION,
  ClaudeCodeSessionRuntime,
  type ClaudeCodeAvailableDetection,
} from '@codetether/adapter-claude'
import type { ProviderDescriptor } from '@codetether/protocol'

import {
  ProviderConversationUnavailableError,
  type AgentHostRuntime,
  type ProviderConversationResult,
  type ProviderTurnResult,
} from './agent-runtime.js'

/**
 * Host-facing Claude Code adapter. Durable sessions are cold objects; only a
 * real Turn owns a child process. Prompt text remains on stdin inside the
 * lower adapter and never enters argv or logs.
 */
export class ClaudeCodeHostRuntime implements AgentHostRuntime {
  readonly provider = 'claude-code' as const
  readonly available = true
  readonly descriptor: ProviderDescriptor
  readonly #detection: ClaudeCodeAvailableDetection
  readonly #environment: NodeJS.ProcessEnv
  readonly #sessions = new Map<string, ClaudeCodeSessionRuntime>()
  readonly #eventListeners = new Set<(event: AgentEvent) => void>()
  readonly #failureListeners = new Set<(failure: Error) => void>()
  readonly #terminalTurns = new Set<string>()
  #closed = false

  constructor(
    detection: ClaudeCodeAvailableDetection,
    environment: NodeJS.ProcessEnv = process.env,
  ) {
    this.#detection = detection
    this.#environment = { ...environment }
    this.descriptor = {
      provider: this.provider,
      displayName: 'Claude Code',
      availability: 'available',
      capabilities: CLAUDE_CODE_CAPABILITIES,
      version: detection.version,
      testedVersion: CLAUDE_CODE_TESTED_VERSION,
    }
  }

  subscribeEvents(listener: (event: AgentEvent) => void): () => void {
    this.#eventListeners.add(listener)
    return () => this.#eventListeners.delete(listener)
  }

  subscribeFailures(listener: (failure: Error) => void): () => void {
    this.#failureListeners.add(listener)
    return () => this.#failureListeners.delete(listener)
  }

  subscribeApprovals(): () => void {
    // The restricted Phase 5A CLI profile has no machine-readable Approval
    // callback. Its public capability is false and unsafe Tools are denied.
    return () => undefined
  }

  async startConversation(options: {
    readonly cwd: string
    readonly model?: string
    readonly reasoning?: string
  }): Promise<ProviderConversationResult> {
    this.#assertOpen()
    assertNoUnsupportedControls(options)
    const session = ClaudeCodeSessionRuntime.createSession({
      launcher: this.#detection.launcher,
      cwd: options.cwd,
      environment: this.#environment,
      testedVersion: CLAUDE_CODE_TESTED_VERSION,
    })
    this.#installSession(session)
    return { providerThreadId: session.sessionId }
  }

  async resumeConversation(options: {
    readonly providerThreadId: string
    readonly cwd: string
    readonly providerSessionMaterialized: boolean
  }): Promise<ProviderConversationResult> {
    this.#assertOpen()
    const existing = this.#sessions.get(options.providerThreadId)
    if (existing !== undefined) {
      if (existing.cwd !== options.cwd) {
        throw new ProviderConversationUnavailableError(
          this.provider,
          options.providerThreadId,
        )
      }
      return { providerThreadId: existing.sessionId }
    }
    let session: ClaudeCodeSessionRuntime
    try {
      const sessionOptions = {
        launcher: this.#detection.launcher,
        cwd: options.cwd,
        environment: this.#environment,
        sessionId: options.providerThreadId,
        testedVersion: CLAUDE_CODE_TESTED_VERSION,
      }
      session = options.providerSessionMaterialized
        ? ClaudeCodeSessionRuntime.resumeSession(sessionOptions)
        : ClaudeCodeSessionRuntime.createSession(sessionOptions)
    } catch (error) {
      throw new ProviderConversationUnavailableError(
        this.provider,
        options.providerThreadId,
        error instanceof Error ? { cause: error } : undefined,
      )
    }
    this.#installSession(session)
    return { providerThreadId: session.sessionId }
  }

  async startTurn(options: {
    readonly providerThreadId: string
    readonly cwd: string
    readonly input: string
    readonly model?: string
    readonly reasoning?: string
  }): Promise<ProviderTurnResult> {
    this.#assertOpen()
    assertNoUnsupportedControls(options)
    const session = this.#sessions.get(options.providerThreadId)
    if (session === undefined || session.cwd !== options.cwd) {
      throw new ProviderConversationUnavailableError(
        this.provider,
        options.providerThreadId,
      )
    }
    const providerTurnId = randomUUID()
    const completion = session.startTurn({
      turnId: providerTurnId,
      prompt: options.input,
    })
    void completion
      .catch((error: unknown) => {
        if (this.#terminalTurns.has(providerTurnId) || this.#closed) return
        this.#emit({
          type: 'turn.failed',
          provider: this.provider,
          timestamp: new Date().toISOString(),
          threadId: options.providerThreadId,
          turnId: providerTurnId,
          error: {
            code: safeProviderErrorCode(error),
            message: 'Claude Code could not complete this Turn.',
          },
        })
      })
      .finally(() => this.#terminalTurns.delete(providerTurnId))
    return { providerTurnId }
  }

  async interruptTurn(): Promise<never> {
    throw new Error('Claude Code interruption is unsupported in Phase 5A')
  }

  async disposeConversation(options: {
    readonly providerThreadId: string
  }): Promise<void> {
    const session = this.#sessions.get(options.providerThreadId)
    if (session === undefined) return
    this.#sessions.delete(options.providerThreadId)
    await session.close()
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    const sessions = [...this.#sessions.values()]
    this.#sessions.clear()
    await Promise.allSettled(
      sessions.map(async (session) => await session.close()),
    )
    this.#eventListeners.clear()
    this.#failureListeners.clear()
    this.#terminalTurns.clear()
  }

  #installSession(session: ClaudeCodeSessionRuntime): void {
    if (this.#sessions.has(session.sessionId)) {
      throw new Error('Claude Code reused a live Session identity')
    }
    session.subscribeEvents((event) => this.#emit(event))
    this.#sessions.set(session.sessionId, session)
  }

  #emit(event: AgentEvent): void {
    if (
      event.type === 'turn.completed' ||
      event.type === 'turn.failed' ||
      event.type === 'turn.interrupted'
    ) {
      this.#terminalTurns.add(event.turnId)
    }
    for (const listener of this.#eventListeners) listener(event)
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('Claude Code runtime is closed')
  }
}

function assertNoUnsupportedControls(options: {
  readonly model?: string
  readonly reasoning?: string
}): void {
  if (options.model !== undefined || options.reasoning !== undefined) {
    throw new TypeError(
      'Claude Code model and reasoning controls are unavailable in Phase 5A',
    )
  }
}

function safeProviderErrorCode(error: unknown): string {
  if (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code
  }
  return 'provider_start_failed'
}
