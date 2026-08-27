import {
  formatLastEventId,
  type EpochId,
  type EventCursor,
  type HostEventEnvelope,
  type StreamResetReason,
} from '@codetether/protocol'

const DEFAULT_MAX_EVENTS = 2048
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024

interface ReplayEntry {
  readonly envelope: HostEventEnvelope
  readonly bytes: number
}

export interface HostEventReplayBufferLimits {
  readonly maxEvents?: number
  readonly maxBytes?: number
}

export type ReplayResetReason = StreamResetReason

export type ReplayDecision =
  | {
      readonly kind: 'replay'
      readonly epoch: EpochId
      readonly currentSeq: number
      readonly events: readonly HostEventEnvelope[]
    }
  | {
      readonly kind: 'reset'
      readonly reason: ReplayResetReason
      readonly epoch: EpochId
      readonly currentSeq: number
      readonly oldestAvailableSeq: number
    }

export class HostEventTooLargeError extends Error {
  constructor(
    readonly eventBytes: number,
    readonly maxBytes: number,
  ) {
    super(
      `Host event requires ${eventBytes} bytes and exceeds the ${maxBytes} byte replay limit`,
    )
    this.name = 'HostEventTooLargeError'
  }
}

export class HostEventSequenceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HostEventSequenceError'
  }
}

/** Bounded, contiguous replay history for one Host process epoch. */
export class HostEventReplayBuffer {
  readonly #maxEvents: number
  readonly #maxBytes: number
  readonly #entries: ReplayEntry[] = []
  #currentSeq = 0
  #retainedBytes = 0

  constructor(
    readonly epoch: EpochId,
    limits: HostEventReplayBufferLimits = {},
  ) {
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
  }

  get currentSeq(): number {
    return this.#currentSeq
  }

  get retainedEventCount(): number {
    return this.#entries.length
  }

  get retainedBytes(): number {
    return this.#retainedBytes
  }

  get oldestAvailableSeq(): number {
    return this.#entries[0]?.envelope.seq ?? this.#currentSeq + 1
  }

  initializeSequence(sequence: number): void {
    nonNegativeInteger(sequence, 'sequence')
    if (this.#currentSeq !== 0 || this.#entries.length !== 0) {
      throw new HostEventSequenceError(
        'Host event sequence can only be initialized before publication',
      )
    }
    this.#currentSeq = sequence
  }

  append(envelope: HostEventEnvelope): void {
    const expectedSeq = this.#currentSeq + 1
    if (!Number.isSafeInteger(expectedSeq)) {
      throw new HostEventSequenceError('Host event sequence is exhausted')
    }
    if (envelope.epoch !== this.epoch) {
      throw new HostEventSequenceError(
        `Host event epoch ${envelope.epoch} does not match ${this.epoch}`,
      )
    }
    if (envelope.seq !== expectedSeq) {
      throw new HostEventSequenceError(
        `Host event sequence ${envelope.seq} is not the expected ${expectedSeq}`,
      )
    }
    const expectedEventId = formatLastEventId({
      epoch: envelope.epoch,
      seq: envelope.seq,
    })
    if (String(envelope.eventId) !== String(expectedEventId)) {
      throw new HostEventSequenceError(
        `Host event id ${envelope.eventId} does not match its epoch and sequence`,
      )
    }

    const bytes = encodedBytes(envelope)
    if (bytes > this.#maxBytes) {
      throw new HostEventTooLargeError(bytes, this.#maxBytes)
    }
    this.#entries.push({ envelope, bytes })
    this.#retainedBytes += bytes
    this.#currentSeq = envelope.seq
    this.#evictToLimits()
  }

  replayAfter(cursor: EventCursor): ReplayDecision {
    nonNegativeInteger(cursor.seq, 'cursor.seq')
    if (cursor.epoch !== this.epoch) return this.#reset('epoch_mismatch')
    if (cursor.seq > this.#currentSeq) return this.#reset('future_cursor')
    if (cursor.seq < this.oldestAvailableSeq - 1) {
      return this.#reset('history_evicted')
    }
    return {
      kind: 'replay',
      epoch: this.epoch,
      currentSeq: this.#currentSeq,
      events: this.#entries
        .filter((entry) => entry.envelope.seq > cursor.seq)
        .map((entry) => entry.envelope),
    }
  }

  #evictToLimits(): void {
    while (
      this.#entries.length > this.#maxEvents ||
      this.#retainedBytes > this.#maxBytes
    ) {
      const removed = this.#entries.shift()
      if (removed === undefined) return
      this.#retainedBytes -= removed.bytes
    }
  }

  #reset(reason: ReplayResetReason): ReplayDecision {
    return {
      kind: 'reset',
      reason,
      epoch: this.epoch,
      currentSeq: this.#currentSeq,
      oldestAvailableSeq: this.oldestAvailableSeq,
    }
  }
}

function encodedBytes(envelope: HostEventEnvelope): number {
  const encoded = JSON.stringify(envelope)
  if (encoded === undefined) {
    throw new Error('Host event envelope is not JSON-serializable')
  }
  return Buffer.byteLength(encoded, 'utf8')
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

function nonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`)
  }
}
