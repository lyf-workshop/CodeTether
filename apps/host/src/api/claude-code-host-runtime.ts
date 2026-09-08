import { randomUUID } from 'node:crypto'

import {
  canonicalFailure,
  isCanonicalFailureReason,
  type AgentEvent,
  type CanonicalFailureReason,
} from '@codetether/agent-core'
import {
  CLAUDE_CODE_CAPABILITIES,
  CLAUDE_CODE_EFFORT_LEVELS,
  CLAUDE_CODE_TESTED_VERSION,
  ClaudeCodeOwnedProcessCleanupError,
  ClaudeCodeSessionRuntime,
  type ClaudeCodeAvailableDetection,
  type ClaudeCodeEffort,
} from '@codetether/adapter-claude'
import type {
  ProviderDescriptor,
  ProviderInstallationId,
  ProviderInstallationRevision,
} from '@codetether/protocol'

export const CLAUDE_CODE_REASONING_LABEL = '思考强度'

export function claudeCodeReasoningOptions(): NonNullable<
  ProviderDescriptor['reasoningOptions']
> {
  return CLAUDE_CODE_EFFORT_LEVELS.map((id) => ({
    id,
    label: claudeEffortLabel(id),
  }))
}

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
  readonly installation
  readonly descriptor: ProviderDescriptor
  readonly #detection: ClaudeCodeAvailableDetection
  readonly #environment: NodeJS.ProcessEnv
  readonly #sessions = new Map<string, ClaudeCodeSessionRuntime>()
  readonly #eventListeners = new Set<(event: AgentEvent) => void>()
  readonly #failureListeners = new Set<(failure: Error) => void>()
  readonly #terminalTurns = new Set<string>()
  #closed = false
  #closePromise?: Promise<void>
  #cleanupFailure?: ClaudeCodeOwnedProcessCleanupError

  constructor(
    detection: ClaudeCodeAvailableDetection,
    environment: NodeJS.ProcessEnv = process.env,
    installation?: {
      readonly installationId: ProviderInstallationId
      readonly installationRevision: ProviderInstallationRevision
    },
  ) {
    this.#detection = detection
    this.#environment = { ...environment }
    this.installation = installation
    this.descriptor = {
      provider: this.provider,
      displayName: 'Claude Code',
      availability: 'available',
      capabilities: CLAUDE_CODE_CAPABILITIES,
      version: detection.version,
      testedVersion: CLAUDE_CODE_TESTED_VERSION,
      reasoningLabel: CLAUDE_CODE_REASONING_LABEL,
      reasoningOptions: claudeCodeReasoningOptions(),
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
    assertModelUnsupported(options.model)
    parseClaudeEffort(options.reasoning)
    const session = ClaudeCodeSessionRuntime.createSession({
      launcher: this.#detection.launcher,
      cwd: options.cwd,
      environment: this.#environment,
      testedVersion: this.#detection.version,
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
        testedVersion: this.#detection.version,
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
    assertModelUnsupported(options.model)
    const effort = parseClaudeEffort(options.reasoning)
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
      ...(effort === undefined ? {} : { effort }),
    })
    void completion
      .catch((error: unknown) => {
        if (error instanceof ClaudeCodeOwnedProcessCleanupError) {
          this.#cleanupFailure ??= error
        }
        if (this.#terminalTurns.has(providerTurnId) || this.#closed) return
        const timestamp = new Date().toISOString()
        const failureReason = safeProviderFailureReason(error)
        this.#emit({
          type: 'turn.failed',
          provider: this.provider,
          timestamp,
          threadId: options.providerThreadId,
          turnId: providerTurnId,
          error: {
            code: safeProviderErrorCode(error),
            message: 'Claude Code could not complete this Turn.',
            failure: canonicalFailure(failureReason, timestamp),
          },
        })
      })
      .finally(() => this.#terminalTurns.delete(providerTurnId))
    return { providerTurnId }
  }

  async interruptTurn(): Promise<never> {
    throw new Error('Claude Code interruption is unsupported')
  }

  async disposeConversation(options: {
    readonly providerThreadId: string
  }): Promise<void> {
    const session = this.#sessions.get(options.providerThreadId)
    if (session === undefined) return
    try {
      await session.close()
    } catch (error) {
      if (error instanceof ClaudeCodeOwnedProcessCleanupError) {
        this.#cleanupFailure ??= error
      }
      throw error
    }
    this.#sessions.delete(options.providerThreadId)
  }

  async close(): Promise<void> {
    this.#closePromise ??= this.#closeOwnedSessions()
    await this.#closePromise
  }

  async #closeOwnedSessions(): Promise<void> {
    if (this.#closed) {
      if (this.#cleanupFailure !== undefined) throw this.#cleanupFailure
      return
    }
    this.#closed = true
    const sessions = [...this.#sessions.values()]
    const results = await Promise.allSettled(
      sessions.map(async (session) => await session.close()),
    )
    const cleanupFailure = results.find(
      (result): result is PromiseRejectedResult =>
        result.status === 'rejected' &&
        result.reason instanceof ClaudeCodeOwnedProcessCleanupError,
    )?.reason
    if (cleanupFailure !== undefined) {
      this.#cleanupFailure = cleanupFailure
    }
    this.#sessions.clear()
    this.#eventListeners.clear()
    this.#failureListeners.clear()
    this.#terminalTurns.clear()
    if (this.#cleanupFailure !== undefined) throw this.#cleanupFailure
    const otherFailure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )?.reason
    if (otherFailure !== undefined) throw otherFailure
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
    if (this.#cleanupFailure !== undefined) throw this.#cleanupFailure
    if (this.#closed) throw new Error('Claude Code runtime is closed')
  }
}

function assertModelUnsupported(model: string | undefined): void {
  if (model !== undefined) {
    throw new TypeError('Claude Code model selection is unavailable.')
  }
}

function parseClaudeEffort(
  reasoning: string | undefined,
): ClaudeCodeEffort | undefined {
  if (reasoning === undefined) return undefined
  if (!(CLAUDE_CODE_EFFORT_LEVELS as readonly string[]).includes(reasoning)) {
    throw new TypeError('Claude Code effort is unsupported.')
  }
  return reasoning as ClaudeCodeEffort
}

function claudeEffortLabel(effort: ClaudeCodeEffort): string {
  switch (effort) {
    case 'low':
      return '低'
    case 'medium':
      return '中'
    case 'high':
      return '高'
    case 'xhigh':
      return '超高'
    case 'max':
      return '最大'
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

function safeProviderFailureReason(error: unknown): CanonicalFailureReason {
  if (
    typeof error === 'object' &&
    error !== null &&
    'failureReason' in error &&
    isCanonicalFailureReason(error.failureReason)
  ) {
    return error.failureReason
  }
  return 'provider_start_failed'
}
