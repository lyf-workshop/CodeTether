import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import {
  CodexProcessError,
  CodexProcessExitError,
  CodexProtocolError,
  JsonRpcRemoteError,
  JsonRpcRequestTimeoutError,
} from './errors.js'
import { JsonRpcLineDecoder } from './line-decoder.js'
import { protocolLogEntry, type ProtocolLogger } from './logging.js'
import {
  isRecord,
  type JsonRpcFailure,
  type JsonRpcId,
  type JsonRpcIncoming,
  type JsonRpcNotification,
  type JsonRpcRequest,
} from './protocol.js'

interface PendingRequest {
  readonly method: string
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
  readonly timer: NodeJS.Timeout
}

export interface JsonRpcTransportOptions {
  readonly requestTimeoutMs?: number
  readonly maxLineBytes?: number
  readonly logger?: ProtocolLogger
  readonly onStderr?: (text: string) => void
}

type NotificationListener = (notification: JsonRpcNotification) => void
type ServerRequestListener = (request: JsonRpcRequest) => void
type ErrorListener = (error: Error) => void
type UnknownResponseListener = (id: JsonRpcId) => void

/** Owns line framing, request correlation, and process failure propagation. */
export class JsonRpcTransport {
  readonly #decoder: JsonRpcLineDecoder
  readonly #pending = new Map<JsonRpcId, PendingRequest>()
  readonly #notificationListeners = new Set<NotificationListener>()
  readonly #serverRequestListeners = new Set<ServerRequestListener>()
  readonly #errorListeners = new Set<ErrorListener>()
  readonly #unknownResponseListeners = new Set<UnknownResponseListener>()
  readonly #requestTimeoutMs: number
  readonly #logger?: ProtocolLogger
  #nextRequestId = 1
  #failure?: Error
  #closing = false

  constructor(
    readonly process: ChildProcessWithoutNullStreams,
    options: JsonRpcTransportOptions = {},
  ) {
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 30_000
    this.#logger = options.logger
    this.#decoder = new JsonRpcLineDecoder({
      ...(options.maxLineBytes === undefined
        ? {}
        : { maxLineBytes: options.maxLineBytes }),
    })

    process.stdout.on('data', (chunk: Buffer) => {
      this.#consumeChunk(chunk)
    })
    process.stdout.on('end', () => {
      this.#finishDecoder()
    })
    process.stderr.on('data', (chunk: Buffer) => {
      options.onStderr?.(chunk.toString('utf8'))
    })
    process.once('error', (error) => {
      this.#fail(
        new CodexProcessError(
          `Unable to run Codex App Server: ${error.message}`,
          {
            cause: error,
          },
        ),
      )
    })
    process.once('exit', (code, signal) => {
      if (this.#closing) {
        this.#rejectPending(new CodexProcessError('Codex App Server closed'))
        return
      }
      this.#fail(new CodexProcessExitError(code, signal))
    })
  }

  get pendingRequestCount(): number {
    return this.#pending.size
  }

  request<TResult>(
    method: string,
    params?: unknown,
    timeoutMs = this.#requestTimeoutMs,
  ): Promise<TResult> {
    if (this.#failure !== undefined) return Promise.reject(this.#failure)

    const id = this.#nextRequestId++
    const message: JsonRpcRequest = {
      id,
      method,
      ...(params === undefined ? {} : { params }),
    }

    return new Promise<TResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new JsonRpcRequestTimeoutError(method, timeoutMs))
      }, timeoutMs)
      this.#pending.set(id, {
        method,
        resolve: (value) => resolve(value as TResult),
        reject,
        timer,
      })
      void this.#write(message).catch((error: unknown) => {
        const pending = this.#pending.get(id)
        if (pending === undefined) return
        clearTimeout(pending.timer)
        this.#pending.delete(id)
        pending.reject(toError(error))
      })
    })
  }

  async notify(method: string, params?: unknown): Promise<void> {
    await this.#write({
      method,
      ...(params === undefined ? {} : { params }),
    })
  }

  async respond(id: JsonRpcId, result: unknown): Promise<void> {
    await this.#write({ id, result } as JsonRpcIncoming)
  }

  async respondError(
    id: JsonRpcId,
    code: number,
    message: string,
    data?: unknown,
  ): Promise<void> {
    await this.#write({
      id,
      error: { code, message, ...(data === undefined ? {} : { data }) },
    } as JsonRpcIncoming)
  }

  onNotification(listener: NotificationListener): () => void {
    this.#notificationListeners.add(listener)
    return () => this.#notificationListeners.delete(listener)
  }

  onServerRequest(listener: ServerRequestListener): () => void {
    this.#serverRequestListeners.add(listener)
    return () => this.#serverRequestListeners.delete(listener)
  }

  onError(listener: ErrorListener): () => void {
    this.#errorListeners.add(listener)
    return () => this.#errorListeners.delete(listener)
  }

  onUnknownResponse(listener: UnknownResponseListener): () => void {
    this.#unknownResponseListeners.add(listener)
    return () => this.#unknownResponseListeners.delete(listener)
  }

  beginShutdown(): void {
    this.#closing = true
  }

  #consumeChunk(chunk: Buffer): void {
    if (this.#failure !== undefined) return
    try {
      for (const line of this.#decoder.push(chunk)) this.#consumeLine(line)
    } catch (error) {
      this.#fail(toProtocolFramingError(error))
    }
  }

  #finishDecoder(): void {
    if (this.#failure !== undefined) return
    try {
      for (const line of this.#decoder.end()) this.#consumeLine(line)
    } catch (error) {
      this.#fail(toProtocolFramingError(error))
    }
  }

  #consumeLine(line: string): void {
    let message: unknown
    try {
      message = JSON.parse(line)
    } catch (error) {
      this.#fail(
        new CodexProtocolError('Codex App Server emitted invalid JSON', {
          cause: error,
        }),
      )
      return
    }

    if (!isRecord(message)) {
      this.#fail(
        new CodexProtocolError('Codex App Server emitted a non-object message'),
      )
      return
    }

    const id = message.id
    const pending =
      typeof id === 'string' || typeof id === 'number'
        ? this.#pending.get(id)
        : undefined
    this.#safeLog({
      ...protocolLogEntry('receive', message as unknown as JsonRpcIncoming),
      ...(pending === undefined ? {} : { method: pending.method }),
    })

    if (typeof message.method === 'string') {
      if (typeof id === 'string' || typeof id === 'number') {
        const request = message as unknown as JsonRpcRequest
        for (const listener of this.#serverRequestListeners) listener(request)
      } else {
        const notification = message as unknown as JsonRpcNotification
        for (const listener of this.#notificationListeners)
          listener(notification)
      }
      return
    }

    if (typeof id !== 'string' && typeof id !== 'number') {
      this.#fail(
        new CodexProtocolError('Codex App Server emitted an invalid envelope'),
      )
      return
    }

    if (pending === undefined) {
      for (const listener of this.#unknownResponseListeners) listener(id)
      return
    }

    clearTimeout(pending.timer)
    this.#pending.delete(id)
    if (isRecord(message.error)) {
      const failure = message as unknown as JsonRpcFailure
      pending.reject(
        new JsonRpcRemoteError(
          pending.method,
          failure.error.code,
          failure.error.message,
          failure.error.data,
        ),
      )
      return
    }
    if (!Object.hasOwn(message, 'result')) {
      pending.reject(
        new CodexProtocolError(`Response to ${pending.method} has no result`),
      )
      return
    }
    pending.resolve(message.result)
  }

  async #write(
    message: JsonRpcIncoming | JsonRpcRequest | JsonRpcNotification,
  ): Promise<void> {
    if (this.#failure !== undefined) throw this.#failure
    this.#safeLog(protocolLogEntry('send', message))
    const line = `${JSON.stringify(message)}\n`

    await new Promise<void>((resolve, reject) => {
      this.process.stdin.write(line, (error) => {
        if (error === null || error === undefined) resolve()
        else
          reject(
            new CodexProcessError(
              `Unable to write protocol message: ${error.message}`,
            ),
          )
      })
    })
  }

  #safeLog(entry: ReturnType<typeof protocolLogEntry>): void {
    try {
      this.#logger?.(entry)
    } catch {
      // Diagnostics must never interfere with the protocol lifecycle.
    }
  }

  #fail(error: Error): void {
    if (this.#failure !== undefined) return
    this.#failure = error
    this.#rejectPending(error)
    for (const listener of this.#errorListeners) listener(error)
  }

  #rejectPending(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.#pending.clear()
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function toProtocolFramingError(value: unknown): CodexProtocolError {
  if (value instanceof CodexProtocolError) return value
  return new CodexProtocolError('Unable to frame Codex protocol output', {
    cause: toError(value),
  })
}
