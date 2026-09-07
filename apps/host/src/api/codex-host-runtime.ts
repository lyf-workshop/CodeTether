import type { AgentEvent } from '@codetether/agent-core'
import {
  CodexAppServerClient,
  JsonRpcRemoteError,
  type ApprovalDecision,
  type ApprovalPrompt,
  type ApprovalResolution,
  spawnCodexAppServer,
} from '@codetether/adapter-codex'
import type {
  ProviderInstallationId,
  ProviderInstallationRevision,
} from '@codetether/protocol'

import { BoundedAgentEventQueue } from '../runtime/bounded-agent-event-queue.js'
import { IncrementalDeltaIntegrityTracker } from '../runtime/delta-integrity-tracker.js'
import { ProviderConversationUnavailableError } from './agent-runtime.js'
import type {
  AgentHostRuntime,
  ProviderApprovalRequest,
  ProviderApprovalResolution,
  ProviderConversationResult,
  ProviderTurnResult,
  PublicApprovalDecision,
} from './agent-runtime.js'

interface ApprovalDeferred {
  readonly resolve: (decision: ApprovalDecision) => void
  settled: boolean
}

export interface CodexHostRuntimeOptions {
  readonly executable?: string
  readonly environment?: NodeJS.ProcessEnv
  readonly version: string
  readonly disableHooks?: boolean
  readonly ephemeralThreads?: boolean
  readonly providerInstallationId?: ProviderInstallationId
  readonly installationRevision?: ProviderInstallationRevision
}

/** One long-running Codex App Server behind the Host-facing runtime boundary. */
export class CodexHostRuntime implements AgentHostRuntime {
  readonly provider = 'codex' as const
  readonly installation
  readonly #client: CodexAppServerClient
  readonly #queue = new BoundedAgentEventQueue()
  readonly #integrity = new IncrementalDeltaIntegrityTracker()
  readonly #eventListeners = new Set<(event: AgentEvent) => void>()
  readonly #failureListeners = new Set<(failure: Error) => void>()
  readonly #approvalDeferreds = new Set<ApprovalDeferred>()
  readonly #pump: Promise<void>
  readonly #ephemeralThreads: boolean
  #approvalRequestListener?: (request: ProviderApprovalRequest) => void
  #approvalResolvedListener?: (resolution: ProviderApprovalResolution) => void
  #failure?: Error
  #closePromise?: Promise<void>
  #providerDiagnosticSuppressionReported = false

  private constructor(options: CodexHostRuntimeOptions) {
    if (
      (options.providerInstallationId === undefined) !==
      (options.installationRevision === undefined)
    ) {
      throw new TypeError(
        'Codex runtime installation identity requires an exact revision',
      )
    }
    this.installation =
      options.providerInstallationId === undefined ||
      options.installationRevision === undefined
        ? undefined
        : {
            installationId: options.providerInstallationId,
            installationRevision: options.installationRevision,
          }
    this.#ephemeralThreads = options.ephemeralThreads ?? false
    this.#pump = this.#queue.consume(async (event) => {
      this.#integrity.observeDelivered(event)
      for (const listener of this.#eventListeners) listener(event)
    })
    this.#pump.catch((error: unknown) => this.#fail(toError(error)))

    const child = spawnCodexAppServer(options.executable, {
      // CodeTether must remain the approval authority for every Alpha Host
      // launch path. Callers may opt back in only as an explicit decision.
      disableHooks: options.disableHooks ?? true,
      ...(options.environment === undefined
        ? {}
        : { environment: options.environment }),
    })
    this.#client = new CodexAppServerClient(child, {
      requestTimeoutMs: 30_000,
      onEvent: (event) => this.#enqueue(event),
      approvalHandler: async (prompt) => await this.#requestApproval(prompt),
      onApprovalResolved: (resolution) =>
        this.#notifyApprovalResolved(resolution),
      onUnknownNotification: () => {
        process.stderr.write(
          '[codetether:provider-unknown-notification] Suppressed unrecognized Provider notification\n',
        )
      },
      onUnknownServerRequest: () => {
        process.stderr.write(
          '[codetether:provider-unknown-request] Suppressed unrecognized Provider request\n',
        )
      },
      onUnknownResponse: () => {
        process.stderr.write(
          '[codetether:provider-unknown-response] Suppressed unrecognized Provider response\n',
        )
      },
      onStderr: (text) => {
        if (text.length > 0 && !this.#providerDiagnosticSuppressionReported) {
          this.#providerDiagnosticSuppressionReported = true
          // Provider diagnostics may contain Prompts, source, paths, account
          // data, or credentials. Classification consumes structured App
          // Server errors; raw stderr never crosses into product logs.
          process.stderr.write(
            '[codetether:codex] Provider diagnostic output was suppressed\n',
          )
        }
      },
      onError: (error) => this.#fail(error),
    })
  }

  static async launch(
    options: CodexHostRuntimeOptions,
  ): Promise<CodexHostRuntime> {
    const runtime = new CodexHostRuntime(options)
    try {
      await runtime.#client.initialize({
        name: 'codetether',
        title: 'CodeTether',
        version: options.version,
      })
      return runtime
    } catch (error) {
      await runtime.close()
      throw error
    }
  }

  subscribeEvents(listener: (event: AgentEvent) => void): () => void {
    this.#eventListeners.add(listener)
    return () => this.#eventListeners.delete(listener)
  }

  subscribeFailures(listener: (failure: Error) => void): () => void {
    if (this.#failure !== undefined) {
      this.#notifyFailureListener(listener, this.#failure)
      return () => undefined
    }
    this.#failureListeners.add(listener)
    return () => this.#failureListeners.delete(listener)
  }

  subscribeApprovals(
    onRequest: (request: ProviderApprovalRequest) => void,
    onResolved: (resolution: ProviderApprovalResolution) => void,
  ): () => void {
    if (
      this.#approvalRequestListener !== undefined ||
      this.#approvalResolvedListener !== undefined
    ) {
      throw new Error('Codex Host runtime already has an approval subscriber')
    }
    this.#approvalRequestListener = onRequest
    this.#approvalResolvedListener = onResolved
    return () => {
      if (this.#approvalRequestListener === onRequest) {
        this.#approvalRequestListener = undefined
      }
      if (this.#approvalResolvedListener === onResolved) {
        this.#approvalResolvedListener = undefined
      }
    }
  }

  async startConversation(options: {
    readonly cwd: string
    readonly model?: string
    readonly reasoning?: string
  }): Promise<ProviderConversationResult> {
    this.#assertHealthy()
    const result = await this.#client.startThread({
      cwd: options.cwd,
      ephemeral: this.#ephemeralThreads,
      approvalPolicy: 'on-request',
      sandbox: 'workspace-write',
      ...(options.model === undefined ? {} : { model: options.model }),
    })
    return {
      providerThreadId: result.thread.id,
      model: result.model,
    }
  }

  async resumeConversation(options: {
    readonly providerThreadId: string
    readonly cwd: string
    readonly providerSessionMaterialized: boolean
  }): Promise<ProviderConversationResult> {
    this.#assertHealthy()
    return await resumeCodexConversation(this.#client, options)
  }

  async startTurn(options: {
    readonly providerThreadId: string
    readonly cwd: string
    readonly input: string
    readonly model?: string
    readonly reasoning?: string
  }): Promise<ProviderTurnResult> {
    this.#assertHealthy()
    const result = await this.#client.startTurn({
      threadId: options.providerThreadId,
      prompt: options.input,
      ...(options.model === undefined ? {} : { model: options.model }),
      ...(options.reasoning === undefined
        ? {}
        : { reasoning: options.reasoning }),
    })
    return { providerTurnId: result.turn.id }
  }

  async interruptTurn(options: {
    readonly providerThreadId: string
    readonly providerTurnId: string
  }): Promise<void> {
    this.#assertHealthy()
    await this.#client.interruptTurn({
      threadId: options.providerThreadId,
      turnId: options.providerTurnId,
    })
  }

  async close(): Promise<void> {
    this.#closePromise ??= this.#close()
    await this.#closePromise
  }

  #enqueue(event: AgentEvent): void {
    try {
      this.#integrity.observeRaw(event)
      const outcome = this.#queue.enqueue(event)
      if (outcome.kind === 'delta-dropped') {
        throw new Error(
          `Codex Host runtime dropped ${String(outcome.bytesDropped)} delta bytes`,
        )
      }
    } catch (error) {
      const failure = toError(error)
      this.#fail(failure)
      throw failure
    }
  }

  async #requestApproval(prompt: ApprovalPrompt): Promise<ApprovalDecision> {
    if (this.#approvalRequestListener === undefined) return 'deny'
    return await new Promise<ApprovalDecision>((resolve) => {
      const deferred: ApprovalDeferred = { resolve, settled: false }
      this.#approvalDeferreds.add(deferred)
      const respond = (decision: PublicApprovalDecision): void => {
        if (deferred.settled) {
          throw new Error('Provider approval request was already resolved')
        }
        deferred.settled = true
        this.#approvalDeferreds.delete(deferred)
        resolve(decision === 'accept' ? 'allow' : 'deny')
      }
      try {
        this.#approvalRequestListener?.({
          provider: this.provider,
          providerRequestId: prompt.request.id,
          providerApprovalId: prompt.event.approvalId,
          providerThreadId: prompt.event.threadId,
          providerTurnId: prompt.event.turnId,
          ...(prompt.event.itemId === undefined
            ? {}
            : { providerItemId: prompt.event.itemId }),
          kind: prompt.event.kind,
          summary: prompt.event.summary,
          respond,
        })
      } catch (error) {
        process.stderr.write(
          `[codetether:approval-handler] ${safeErrorName(error)}\n`,
        )
        if (!deferred.settled) respond('decline')
      }
    })
  }

  #notifyApprovalResolved(resolution: ApprovalResolution): void {
    try {
      this.#approvalResolvedListener?.({
        provider: this.provider,
        providerRequestId: resolution.request.id,
        providerApprovalId: resolution.event.approvalId,
        providerThreadId: resolution.event.threadId,
        providerTurnId: resolution.event.turnId,
        ...(resolution.event.itemId === undefined
          ? {}
          : { providerItemId: resolution.event.itemId }),
        decision: resolution.decision === 'allow' ? 'accept' : 'decline',
      })
    } catch (error) {
      this.#fail(toError(error))
    }
  }

  async #close(): Promise<void> {
    for (const deferred of this.#approvalDeferreds) {
      if (deferred.settled) continue
      deferred.settled = true
      deferred.resolve('deny')
    }
    this.#approvalDeferreds.clear()

    let shutdownError: Error | undefined
    try {
      await this.#client.shutdown()
    } catch (error) {
      shutdownError = toError(error)
    } finally {
      this.#queue.close()
      await this.#pump.catch(() => undefined)
      const integrity = this.#integrity.snapshot()
      this.#integrity.clear()
      this.#eventListeners.clear()
      this.#failureListeners.clear()
      this.#approvalRequestListener = undefined
      this.#approvalResolvedListener = undefined
      if (!integrity.intact && shutdownError === undefined) {
        shutdownError = new Error(
          'Codex Host runtime stream integrity validation failed',
        )
      }
    }
    if (shutdownError !== undefined) throw shutdownError
    if (this.#failure !== undefined) throw this.#failure
  }

  #assertHealthy(): void {
    if (this.#failure !== undefined) throw this.#failure
    if (this.#closePromise !== undefined) {
      throw new Error('Codex Host runtime is closing')
    }
  }

  #fail(error: Error): void {
    if (this.#failure !== undefined) return
    this.#failure = error
    this.#queue.fail(error)
    for (const listener of [...this.#failureListeners]) {
      this.#notifyFailureListener(listener, error)
    }
    for (const deferred of this.#approvalDeferreds) {
      if (deferred.settled) continue
      deferred.settled = true
      deferred.resolve('deny')
    }
    this.#approvalDeferreds.clear()
    // Losing the reliable event/control path must also stop the provider. A
    // live child must never continue executing after the Host can no longer
    // observe or control it.
    void this.close().catch(() => undefined)
  }

  #notifyFailureListener(
    listener: (failure: Error) => void,
    error: Error,
  ): void {
    try {
      listener(error)
    } catch (listenerError) {
      process.stderr.write(
        `[codetether:runtime-failure-listener] ${safeErrorName(listenerError)}\n`,
      )
    }
  }
}

interface CodexThreadResumer {
  resumeThread(
    options: Parameters<CodexAppServerClient['resumeThread']>[0],
  ): ReturnType<CodexAppServerClient['resumeThread']>
}

/** Provider glue kept separately testable without spawning a Codex process. */
export async function resumeCodexConversation(
  client: CodexThreadResumer,
  options: {
    readonly providerThreadId: string
    readonly cwd: string
  },
): Promise<ProviderConversationResult> {
  try {
    const result = await client.resumeThread({
      threadId: options.providerThreadId,
      cwd: options.cwd,
      approvalPolicy: 'on-request',
      sandbox: 'workspace-write',
    })
    return {
      providerThreadId: result.thread.id,
      model: result.model,
    }
  } catch (error) {
    if (
      error instanceof JsonRpcRemoteError &&
      error.method === 'thread/resume'
    ) {
      throw new ProviderConversationUnavailableError(
        'codex',
        options.providerThreadId,
        { cause: error },
      )
    }
    throw error
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function safeErrorName(value: unknown): string {
  return value instanceof Error &&
    /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(value.name)
    ? value.name
    : 'Error'
}
