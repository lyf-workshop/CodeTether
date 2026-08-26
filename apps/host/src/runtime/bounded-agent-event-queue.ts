import type { AgentEvent } from '@codetether/agent-core'

const DEFAULT_MAX_EVENTS = 256
const DEFAULT_MAX_BYTES = 1024 * 1024
const DEFAULT_MAX_COALESCED_BYTES = 32 * 1024

type DeltaEvent = Extract<
  AgentEvent,
  { readonly type: 'message.delta' | 'tool.output' }
>

export interface AgentEventQueueLimits {
  readonly maxEvents?: number
  readonly maxBytes?: number
  readonly maxCoalescedBytes?: number
}

export interface AgentEventQueueStats {
  readonly queuedEvents: number
  readonly queuedBytes: number
  readonly highWaterEvents: number
  readonly highWaterBytes: number
  readonly rawMessageDeltas: number
  readonly deliveredMessageDeltas: number
  readonly rawToolOutputs: number
  readonly deliveredToolOutputs: number
  readonly coalescedEvents: number
  readonly droppedDeltaEvents: number
  readonly droppedDeltaBytes: number
}

export type EnqueueOutcome =
  | { readonly kind: 'queued' }
  | { readonly kind: 'coalesced'; readonly bytesAdded: number }
  | { readonly kind: 'delta-dropped'; readonly bytesDropped: number }

interface QueueEntry {
  event: AgentEvent
  bytes: number
}

export class AgentEventQueueOverflowError extends Error {
  constructor(
    readonly eventType: AgentEvent['type'],
    readonly maxEvents: number,
    readonly maxBytes: number,
  ) {
    super(
      `Reliable event ${eventType} exceeded the bounded Host queue (${maxEvents} events, ${maxBytes} bytes)`,
    )
    this.name = 'AgentEventQueueOverflowError'
  }
}

/** A single-consumer, bounded Host queue with tail-only delta coalescing. */
export class BoundedAgentEventQueue {
  readonly #maxEvents: number
  readonly #maxBytes: number
  readonly #maxCoalescedBytes: number
  readonly #entries: QueueEntry[] = []
  readonly #wakeups = new Set<() => void>()
  #queuedBytes = 0
  #highWaterEvents = 0
  #highWaterBytes = 0
  #rawMessageDeltas = 0
  #deliveredMessageDeltas = 0
  #rawToolOutputs = 0
  #deliveredToolOutputs = 0
  #coalescedEvents = 0
  #droppedDeltaEvents = 0
  #droppedDeltaBytes = 0
  #closed = false
  #failure?: Error
  #consuming = false

  constructor(limits: AgentEventQueueLimits = {}) {
    this.#maxEvents = positiveInteger(
      limits.maxEvents,
      DEFAULT_MAX_EVENTS,
      'maxEvents',
    )
    this.#maxBytes = positiveInteger(
      limits.maxBytes,
      DEFAULT_MAX_BYTES,
      'maxBytes',
    )
    this.#maxCoalescedBytes = positiveInteger(
      limits.maxCoalescedBytes,
      DEFAULT_MAX_COALESCED_BYTES,
      'maxCoalescedBytes',
    )
  }

  enqueue(eventWithRaw: AgentEvent): EnqueueOutcome {
    if (this.#failure !== undefined) throw this.#failure
    if (this.#closed) throw new Error('BoundedAgentEventQueue is closed')

    const event = omitRaw(eventWithRaw)
    if (event.type === 'message.delta') this.#rawMessageDeltas += 1
    if (event.type === 'tool.output') this.#rawToolOutputs += 1

    const bytes = eventBytes(event)
    const reliable = !isDelta(event)
    if (bytes > this.#maxBytes) {
      if (reliable) {
        throw new AgentEventQueueOverflowError(
          event.type,
          this.#maxEvents,
          this.#maxBytes,
        )
      }
      this.#recordDropped(bytes)
      return { kind: 'delta-dropped', bytesDropped: bytes }
    }

    const tail = this.#entries.at(-1)
    if (isDelta(event) && tail !== undefined && isDelta(tail.event)) {
      const merged = mergeDelta(tail.event, event)
      if (merged !== undefined) {
        const mergedBytes = eventBytes(merged)
        if (mergedBytes <= this.#maxCoalescedBytes) {
          const bytesAdded = mergedBytes - tail.bytes
          if (this.#queuedBytes + bytesAdded <= this.#maxBytes) {
            tail.event = merged
            tail.bytes = mergedBytes
            this.#queuedBytes += bytesAdded
            this.#coalescedEvents += 1
            this.#recordHighWater()
            return { kind: 'coalesced', bytesAdded }
          }
        }
      }
    }

    this.#makeRoom(bytes, reliable)
    if (!this.#fits(bytes)) {
      if (reliable) {
        throw new AgentEventQueueOverflowError(
          event.type,
          this.#maxEvents,
          this.#maxBytes,
        )
      }
      this.#recordDropped(bytes)
      return { kind: 'delta-dropped', bytesDropped: bytes }
    }

    this.#entries.push({ event, bytes })
    this.#queuedBytes += bytes
    this.#recordHighWater()
    this.#wake()
    return { kind: 'queued' }
  }

  async consume(
    consumer: (event: AgentEvent) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.#consuming)
      throw new Error('Host event queue already has a consumer')
    this.#consuming = true
    try {
      while (true) {
        if (this.#failure !== undefined) throw this.#failure
        const entry = this.#entries.shift()
        if (entry !== undefined) {
          this.#queuedBytes -= entry.bytes
          try {
            await consumer(entry.event)
          } catch (error) {
            const failure = toError(error)
            this.fail(failure)
            throw failure
          }
          if (entry.event.type === 'message.delta') {
            this.#deliveredMessageDeltas += 1
          }
          if (entry.event.type === 'tool.output') {
            this.#deliveredToolOutputs += 1
          }
          continue
        }
        if (this.#closed) return
        await this.#waitForEntry(signal)
      }
    } finally {
      this.#consuming = false
    }
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#wake()
  }

  fail(error: Error): void {
    if (this.#failure !== undefined) return
    this.#failure = error
    this.#entries.length = 0
    this.#queuedBytes = 0
    this.#wake()
  }

  snapshot(): AgentEventQueueStats {
    return {
      queuedEvents: this.#entries.length,
      queuedBytes: this.#queuedBytes,
      highWaterEvents: this.#highWaterEvents,
      highWaterBytes: this.#highWaterBytes,
      rawMessageDeltas: this.#rawMessageDeltas,
      deliveredMessageDeltas: this.#deliveredMessageDeltas,
      rawToolOutputs: this.#rawToolOutputs,
      deliveredToolOutputs: this.#deliveredToolOutputs,
      coalescedEvents: this.#coalescedEvents,
      droppedDeltaEvents: this.#droppedDeltaEvents,
      droppedDeltaBytes: this.#droppedDeltaBytes,
    }
  }

  #makeRoom(incomingBytes: number, reliable: boolean): void {
    while (!this.#fits(incomingBytes)) {
      const deltaIndex = this.#entries.findIndex((entry) =>
        isDelta(entry.event),
      )
      if (deltaIndex < 0) return
      const [removed] = this.#entries.splice(deltaIndex, 1)
      if (removed === undefined) return
      this.#queuedBytes -= removed.bytes
      this.#recordDropped(removed.bytes)
      if (!reliable) break
    }
  }

  #fits(bytes: number): boolean {
    return (
      this.#entries.length < this.#maxEvents &&
      this.#queuedBytes + bytes <= this.#maxBytes
    )
  }

  #recordDropped(bytes: number): void {
    this.#droppedDeltaEvents += 1
    this.#droppedDeltaBytes += bytes
  }

  #recordHighWater(): void {
    this.#highWaterEvents = Math.max(
      this.#highWaterEvents,
      this.#entries.length,
    )
    this.#highWaterBytes = Math.max(this.#highWaterBytes, this.#queuedBytes)
  }

  #wake(): void {
    for (const wake of this.#wakeups) wake()
    this.#wakeups.clear()
  }

  async #waitForEntry(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted === true) throw abortError()
    await new Promise<void>((resolve, reject) => {
      const wake = (): void => {
        signal?.removeEventListener('abort', abort)
        resolve()
      }
      const abort = (): void => {
        this.#wakeups.delete(wake)
        reject(abortError())
      }
      this.#wakeups.add(wake)
      signal?.addEventListener('abort', abort, { once: true })
    })
  }
}

function isDelta(event: AgentEvent): event is DeltaEvent {
  return event.type === 'message.delta' || event.type === 'tool.output'
}

function mergeDelta(
  left: DeltaEvent,
  right: DeltaEvent,
): DeltaEvent | undefined {
  if (
    left.type !== right.type ||
    left.threadId !== right.threadId ||
    left.turnId !== right.turnId ||
    left.itemId !== right.itemId
  ) {
    return undefined
  }
  if (left.type === 'message.delta' && right.type === 'message.delta') {
    return { ...left, delta: `${left.delta}${right.delta}` }
  }
  if (
    left.type === 'tool.output' &&
    right.type === 'tool.output' &&
    (left.stream ?? 'unknown') === (right.stream ?? 'unknown')
  ) {
    return { ...left, output: `${left.output}${right.output}` }
  }
  return undefined
}

function omitRaw(event: AgentEvent): AgentEvent {
  const withoutRaw = { ...event }
  Reflect.deleteProperty(withoutRaw, 'raw')
  return withoutRaw
}

function eventBytes(event: AgentEvent): number {
  return Buffer.byteLength(JSON.stringify(event), 'utf8')
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

function abortError(): Error {
  const error = new Error('Host event queue consumption was aborted')
  error.name = 'AbortError'
  return error
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}
