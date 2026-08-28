import type { HostEventEnvelope } from '@codetether/protocol'

const DEFAULT_MAX_CLIENTS = 16
const DEFAULT_MAX_QUEUED_EVENTS = 256
const DEFAULT_MAX_QUEUED_BYTES = 1024 * 1024
const DEFAULT_MAX_FRAME_BYTES = 9 * 1024 * 1024

interface QueuedFrame {
  readonly value: string
  readonly bytes: number
  readonly heartbeat: boolean
  readonly seq?: number
}

interface PendingRead {
  readonly resolve: (frame: string | undefined) => void
  readonly cleanup: () => void
}

export interface SseConnectionLimits {
  readonly maxQueuedEvents?: number
  readonly maxQueuedBytes?: number
  readonly maxFrameBytes?: number
}

export interface SseConnectionPoolOptions extends SseConnectionLimits {
  readonly maxClients?: number
}

export interface SseConnectionSnapshot {
  readonly clientId: string
  readonly closed: boolean
  readonly queuedEvents: number
  readonly queuedBytes: number
  readonly droppedHeartbeats: number
}

export type SseCloseListener = (connection: SseConnection) => void

export class SseSlowClientError extends Error {
  constructor(
    readonly clientId: string,
    readonly maxQueuedEvents: number,
    readonly maxQueuedBytes: number,
  ) {
    super(
      `SSE client ${clientId} exceeded its bounded queue (${maxQueuedEvents} events, ${maxQueuedBytes} bytes)`,
    )
    this.name = 'SseSlowClientError'
  }
}

export class SseClientLimitError extends Error {
  constructor(readonly maxClients: number) {
    super(`SSE client limit of ${maxClients} has been reached`)
    this.name = 'SseClientLimitError'
  }
}

export class SseConnectionPoolClosedError extends Error {
  constructor() {
    super('SSE connection pool is closed')
    this.name = 'SseConnectionPoolClosedError'
  }
}

/** A single-client reliable SSE queue. Overflow closes only this client. */
export class SseConnection {
  readonly #maxQueuedEvents: number
  readonly #maxQueuedBytes: number
  readonly #maxFrameBytes: number
  readonly #queue: QueuedFrame[] = []
  readonly #closeListeners = new Set<SseCloseListener>()
  #queuedBytes = 0
  #heartbeatQueued = false
  #droppedHeartbeats = 0
  #pendingRead?: PendingRead
  #closed = false
  #closeReason?: Error

  constructor(
    readonly clientId: string,
    limits: SseConnectionLimits = {},
    onClose?: SseCloseListener,
  ) {
    nonEmptyString(clientId, 'clientId')
    this.#maxQueuedEvents = positiveInteger(
      limits.maxQueuedEvents,
      DEFAULT_MAX_QUEUED_EVENTS,
      'maxQueuedEvents',
    )
    this.#maxQueuedBytes = positiveInteger(
      limits.maxQueuedBytes,
      DEFAULT_MAX_QUEUED_BYTES,
      'maxQueuedBytes',
    )
    this.#maxFrameBytes = positiveInteger(
      limits.maxFrameBytes,
      DEFAULT_MAX_FRAME_BYTES,
      'maxFrameBytes',
    )
    if (onClose !== undefined) this.#closeListeners.add(onClose)
  }

  get closed(): boolean {
    return this.#closed
  }

  get closeReason(): Error | undefined {
    return this.#closeReason
  }

  enqueueEvent(envelope: HostEventEnvelope): boolean {
    if (this.#closed) return false
    const value = formatSseEvent(envelope)
    const bytes = Buffer.byteLength(value, 'utf8')
    if (!this.#canDeliver(bytes)) this.#discardQueuedHeartbeat()
    if (!this.#canDeliver(bytes)) {
      this.close(
        new SseSlowClientError(
          this.clientId,
          this.#maxQueuedEvents,
          this.#maxQueuedBytes,
        ),
      )
      return false
    }
    this.#deliver({ value, bytes, heartbeat: false, seq: envelope.seq })
    return true
  }

  enqueueHeartbeat(comment = 'heartbeat'): boolean {
    if (this.#closed) return false
    if (this.#heartbeatQueued) return true
    const value = formatSseHeartbeat(comment)
    const bytes = Buffer.byteLength(value, 'utf8')
    if (!this.#canDeliver(bytes)) {
      this.#droppedHeartbeats += 1
      return false
    }
    this.#deliver({ value, bytes, heartbeat: true })
    return true
  }

  read(signal?: AbortSignal): Promise<string | undefined> {
    const queued = this.#queue.shift()
    if (queued !== undefined) {
      this.#queuedBytes -= queued.bytes
      if (queued.heartbeat) this.#heartbeatQueued = false
      return Promise.resolve(queued.value)
    }
    if (this.#closed) return Promise.resolve(undefined)
    if (this.#pendingRead !== undefined) {
      return Promise.reject(new Error('SSE connection already has a reader'))
    }
    if (signal?.aborted === true) return Promise.reject(abortError())

    return new Promise((resolve, reject) => {
      const abort = (): void => {
        this.#pendingRead = undefined
        reject(abortError())
      }
      const cleanup = (): void => signal?.removeEventListener('abort', abort)
      this.#pendingRead = { resolve, cleanup }
      signal?.addEventListener('abort', abort, { once: true })
    })
  }

  discardEventsThrough(seq: number): void {
    if (!Number.isSafeInteger(seq) || seq < 0) {
      throw new Error('SSE discard sequence must be a non-negative integer')
    }
    for (let index = this.#queue.length - 1; index >= 0; index -= 1) {
      const frame = this.#queue[index]
      if (frame?.seq === undefined || frame.seq > seq) continue
      this.#queue.splice(index, 1)
      this.#queuedBytes -= frame.bytes
    }
  }

  onClose(listener: SseCloseListener): () => void {
    if (this.#closed) {
      try {
        listener(this)
      } catch {
        // Match close-time listener isolation for late subscribers.
      }
      return () => undefined
    }
    this.#closeListeners.add(listener)
    let subscribed = true
    return () => {
      if (!subscribed) return
      subscribed = false
      this.#closeListeners.delete(listener)
    }
  }

  close(reason?: Error): void {
    if (this.#closed) return
    this.#closed = true
    this.#closeReason = reason
    this.#queue.length = 0
    this.#queuedBytes = 0
    this.#heartbeatQueued = false
    const pending = this.#pendingRead
    this.#pendingRead = undefined
    if (pending !== undefined) {
      pending.cleanup()
      pending.resolve(undefined)
    }
    for (const listener of [...this.#closeListeners]) {
      try {
        listener(this)
      } catch {
        // One socket cleanup callback cannot block other clients' cleanup.
      }
    }
    this.#closeListeners.clear()
  }

  snapshot(): SseConnectionSnapshot {
    return {
      clientId: this.clientId,
      closed: this.#closed,
      queuedEvents: this.#queue.length,
      queuedBytes: this.#queuedBytes,
      droppedHeartbeats: this.#droppedHeartbeats,
    }
  }

  #canDeliver(bytes: number): boolean {
    if (bytes > this.#maxFrameBytes) return false
    if (this.#pendingRead !== undefined) return true
    if (this.#queue.length === 0) return true
    return (
      this.#queue.length < this.#maxQueuedEvents &&
      this.#queuedBytes + bytes <= this.#maxQueuedBytes
    )
  }

  #deliver(frame: QueuedFrame): void {
    const pending = this.#pendingRead
    if (pending !== undefined) {
      this.#pendingRead = undefined
      pending.cleanup()
      pending.resolve(frame.value)
      return
    }
    this.#queue.push(frame)
    this.#queuedBytes += frame.bytes
    if (frame.heartbeat) this.#heartbeatQueued = true
  }

  #discardQueuedHeartbeat(): void {
    const index = this.#queue.findIndex((frame) => frame.heartbeat)
    if (index < 0) return
    const [removed] = this.#queue.splice(index, 1)
    if (removed === undefined) return
    this.#queuedBytes -= removed.bytes
    this.#heartbeatQueued = false
    this.#droppedHeartbeats += 1
  }
}

/** Owns the bounded set of live SSE clients and isolates their backpressure. */
export class SseConnectionPool {
  readonly #maxClients: number
  readonly #connectionLimits: SseConnectionLimits
  readonly #connections = new Map<string, SseConnection>()
  readonly #heartbeatTimers = new Set<NodeJS.Timeout>()
  #closed = false

  constructor(options: SseConnectionPoolOptions = {}) {
    this.#maxClients = positiveInteger(
      options.maxClients,
      DEFAULT_MAX_CLIENTS,
      'maxClients',
    )
    this.#connectionLimits = {
      maxQueuedEvents: options.maxQueuedEvents,
      maxQueuedBytes: options.maxQueuedBytes,
      maxFrameBytes: options.maxFrameBytes,
    }
  }

  get clientCount(): number {
    return this.#connections.size
  }

  connect(clientId: string): SseConnection {
    if (this.#closed) throw new SseConnectionPoolClosedError()
    if (this.#connections.has(clientId)) {
      throw new Error(`SSE client ${clientId} is already connected`)
    }
    if (this.#connections.size >= this.#maxClients) {
      throw new SseClientLimitError(this.#maxClients)
    }
    const connection = new SseConnection(
      clientId,
      this.#connectionLimits,
      (closed) => {
        if (this.#connections.get(clientId) === closed) {
          this.#connections.delete(clientId)
        }
      },
    )
    this.#connections.set(clientId, connection)
    return connection
  }

  publish(envelope: HostEventEnvelope): void {
    for (const connection of [...this.#connections.values()]) {
      connection.enqueueEvent(envelope)
    }
  }

  heartbeat(comment = 'heartbeat'): void {
    for (const connection of [...this.#connections.values()]) {
      connection.enqueueHeartbeat(comment)
    }
  }

  startHeartbeat(intervalMs: number, comment = 'heartbeat'): () => void {
    positiveInteger(intervalMs, intervalMs, 'intervalMs')
    const timer = setInterval(() => this.heartbeat(comment), intervalMs)
    timer.unref()
    this.#heartbeatTimers.add(timer)
    let running = true
    return () => {
      if (!running) return
      running = false
      clearInterval(timer)
      this.#heartbeatTimers.delete(timer)
    }
  }

  disconnect(clientId: string): void {
    this.#connections.get(clientId)?.close()
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    for (const timer of this.#heartbeatTimers) clearInterval(timer)
    this.#heartbeatTimers.clear()
    for (const connection of [...this.#connections.values()]) {
      connection.close()
    }
  }
}

export function formatSseEvent(envelope: HostEventEnvelope): string {
  return `id: ${envelope.eventId}\nevent: ${envelope.type}\ndata: ${JSON.stringify(envelope)}\n\n`
}

export function formatSseHeartbeat(comment = 'heartbeat'): string {
  return `: ${comment.replace(/[\r\n]+/gu, ' ')}\n\n`
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return resolved
}

function nonEmptyString(value: string, name: string): void {
  if (value.trim().length === 0) throw new Error(`${name} must not be empty`)
}

function abortError(): Error {
  const error = new Error('SSE connection read was aborted')
  error.name = 'AbortError'
  return error
}
