import { EventEmitter, once } from 'node:events'

import type { AgentEvent } from '@codetether/agent-core'
import {
  CodexAppServerClient,
  createStderrProtocolLogger,
  spawnCodexAppServer,
  type ApprovalPrompt,
  type ApprovalResolution,
  type ApprovalDecision,
} from '@codetether/adapter-codex'

import {
  BoundedAgentEventQueue,
  type AgentEventQueueStats,
} from './bounded-agent-event-queue.js'
import { IncrementalDeltaIntegrityTracker } from './delta-integrity-tracker.js'

interface RuntimeEventWaiter {
  readonly timer: NodeJS.Timeout
  readonly reject: (error: Error) => void
}

export interface DevelopmentCodexRuntimeOptions {
  readonly executable: string
  readonly version: string
  readonly includeRawPayloads?: boolean
  readonly printEvents?: boolean
  readonly approvalHandler: (
    prompt: ApprovalPrompt,
  ) => ApprovalDecision | Promise<ApprovalDecision>
  readonly onApprovalResolved?: (resolution: ApprovalResolution) => void
}

export interface DevelopmentRuntimeSnapshot {
  readonly eventCounts: Readonly<Record<string, number>>
  readonly eventCountsByTurn: Readonly<Record<string, number>>
  readonly changedFiles: readonly string[]
  readonly failedToolCount: number
  readonly deltaTextIntegrity: boolean
  readonly aggregation: AgentEventQueueStats
  readonly observedRawMethods: readonly string[]
}

/** Development-only owner for one client process and its bounded event pump. */
export class DevelopmentCodexRuntime {
  readonly client: CodexAppServerClient
  readonly #queue = new BoundedAgentEventQueue()
  readonly #pump: Promise<void>
  readonly #eventCounts = new Map<string, number>()
  readonly #eventCountsByTurn = new Map<string, number>()
  readonly #changedFiles = new Set<string>()
  readonly #deltaIntegrity = new IncrementalDeltaIntegrityTracker()
  readonly #events = new EventEmitter()
  readonly #eventWaiters = new Map<
    (event: AgentEvent) => void,
    RuntimeEventWaiter
  >()
  readonly #printEvents: boolean
  #failedToolCount = 0
  #fatalError?: Error
  #closePromise?: Promise<void>
  #closing = false

  private constructor(options: DevelopmentCodexRuntimeOptions) {
    this.#printEvents = options.printEvents ?? true
    this.#pump = this.#queue
      .consume(async (event) => await this.#consumeEvent(event))
      .catch((error: unknown) => {
        this.#recordFailure(toError(error))
      })

    // User PermissionRequest hooks can resolve an escalation before it reaches
    // this protocol harness. Semantics probes isolate the native App Server
    // request/response path without changing the user's Codex configuration.
    const child = spawnCodexAppServer(options.executable, {
      disableHooks: true,
    })
    this.client = new CodexAppServerClient(child, {
      requestTimeoutMs: 30_000,
      protocolLogger: createStderrProtocolLogger({
        includePayload: options.includeRawPayloads ?? false,
      }),
      onStderr: (text) => {
        const diagnostic = redactDiagnostic(text).trimEnd()
        if (diagnostic.length > 0) {
          process.stderr.write(`[codex:stderr] ${diagnostic}\n`)
        }
      },
      onUnknownNotification: (notification) => {
        process.stderr.write(
          `[codex:unknown-notification] ${notification.method}\n`,
        )
      },
      onUnknownServerRequest: (request) => {
        process.stderr.write(`[codex:unknown-request] ${request.method}\n`)
      },
      onUnknownResponse: (id) => {
        process.stderr.write(`[codex:unknown-response] id=${String(id)}\n`)
      },
      onError: (error) => {
        process.stderr.write(`[codex:error] ${error.message}\n`)
      },
      onEvent: (event) => this.#enqueueEvent(event),
      approvalHandler: options.approvalHandler,
      onApprovalResolved: options.onApprovalResolved,
    })
  }

  static async launch(
    options: DevelopmentCodexRuntimeOptions,
  ): Promise<DevelopmentCodexRuntime> {
    const runtime = new DevelopmentCodexRuntime(options)
    try {
      await runtime.client.initialize({
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

  assertHealthy(): void {
    if (this.#fatalError !== undefined) throw this.#fatalError
    const aggregation = this.#queue.snapshot()
    if (aggregation.droppedDeltaEvents > 0) {
      throw new Error(
        `Host event queue dropped ${aggregation.droppedDeltaEvents} delta events`,
      )
    }
    if (!this.#deltaIntegrity.snapshot().intact) {
      throw new Error('Raw and delivered streamed event text did not match')
    }
  }

  async waitForEvent(
    predicate: (event: AgentEvent) => boolean,
    timeoutMs = 30_000,
  ): Promise<AgentEvent> {
    if (this.#fatalError !== undefined) return Promise.reject(this.#fatalError)
    if (this.#closing) {
      return Promise.reject(new Error('Development Codex runtime is closing'))
    }
    return await new Promise((resolve, reject) => {
      const listener = (event: AgentEvent): void => {
        if (!predicate(event)) return
        const waiter = this.#eventWaiters.get(listener)
        if (waiter === undefined) return
        clearTimeout(waiter.timer)
        this.#eventWaiters.delete(listener)
        this.#events.off('event', listener)
        resolve(event)
      }
      const timer = setTimeout(() => {
        this.#events.off('event', listener)
        this.#eventWaiters.delete(listener)
        reject(new Error('Timed out waiting for a normalized Codex event'))
      }, timeoutMs)
      this.#eventWaiters.set(listener, { timer, reject })
      this.#events.on('event', listener)
    })
  }

  snapshot(): DevelopmentRuntimeSnapshot {
    return {
      eventCounts: Object.fromEntries(this.#eventCounts),
      eventCountsByTurn: Object.fromEntries(this.#eventCountsByTurn),
      changedFiles: [...this.#changedFiles],
      failedToolCount: this.#failedToolCount,
      deltaTextIntegrity: this.#deltaIntegrity.snapshot().intact,
      aggregation: this.#queue.snapshot(),
      observedRawMethods: this.client.observedRawMethods,
    }
  }

  async close(): Promise<void> {
    if (this.#closePromise === undefined) {
      this.#closing = true
      this.#rejectEventWaiters(
        new Error('Development Codex runtime is closing'),
      )
      this.#closePromise = this.#close()
    }
    await this.#closePromise
  }

  #enqueueEvent(event: AgentEvent): void {
    this.#eventCounts.set(
      event.type,
      (this.#eventCounts.get(event.type) ?? 0) + 1,
    )
    if ('turnId' in event) {
      const key = turnKey(event.threadId, event.turnId)
      this.#eventCountsByTurn.set(
        key,
        (this.#eventCountsByTurn.get(key) ?? 0) + 1,
      )
    }
    try {
      this.#deltaIntegrity.observeRaw(event)
      const outcome = this.#queue.enqueue(event)
      if (outcome.kind === 'delta-dropped') {
        process.stderr.write(
          `[codex:backpressure] dropped delta bytes=${outcome.bytesDropped}\n`,
        )
      }
      this.#events.emit('event', event)
    } catch (error) {
      const failure = toError(error)
      this.#recordFailure(failure)
      throw failure
    }
  }

  async #consumeEvent(event: AgentEvent): Promise<void> {
    this.#deltaIntegrity.observeDelivered(event)
    if (event.type === 'file.changed') this.#changedFiles.add(event.path)
    if (event.type === 'tool.completed' && event.success === false) {
      this.#failedToolCount += 1
    }
    if (this.#printEvents) {
      await writeStdoutLine(
        `${JSON.stringify({ event: Object.fromEntries(Object.entries(event)) })}\n`,
      )
    }
  }

  async #close(): Promise<void> {
    let shutdownError: Error | undefined
    try {
      await this.client.shutdown()
    } catch (error) {
      shutdownError = toError(error)
    } finally {
      this.#queue.close()
      await this.#pump
      this.#deltaIntegrity.clear()
      this.#rejectEventWaiters(
        new Error('Development Codex runtime was closed'),
      )
    }
    if (shutdownError !== undefined) throw shutdownError
  }

  #recordFailure(error: Error): void {
    const firstFailure = this.#fatalError === undefined
    this.#fatalError ??= error
    this.#queue.fail(this.#fatalError)
    this.#deltaIntegrity.clear()
    this.#rejectEventWaiters(this.#fatalError)
    if (firstFailure) {
      // Do not await here: this method can run inside the pump's rejection
      // handler, while close() itself waits for that pump to settle.
      void this.close().catch((closeError: unknown) => {
        process.stderr.write(
          `[codex:cleanup-error] ${redactDiagnostic(toError(closeError).message)}\n`,
        )
      })
    }
  }

  #rejectEventWaiters(error: Error): void {
    for (const [listener, waiter] of this.#eventWaiters) {
      clearTimeout(waiter.timer)
      this.#events.off('event', listener)
      waiter.reject(error)
    }
    this.#eventWaiters.clear()
    this.#events.removeAllListeners('event')
  }
}

async function writeStdoutLine(line: string): Promise<void> {
  if (process.stdout.write(line)) return
  await once(process.stdout, 'drain')
}

function turnKey(threadId: string, turnId: string): string {
  return `${threadId}\u0000${turnId}`
}

function redactDiagnostic(value: string): string {
  return value.replace(
    /(authorization|credential|password|secret|token|api.?key)(\s*[:=]\s*)\S+/gi,
    '$1$2[redacted]',
  )
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}
