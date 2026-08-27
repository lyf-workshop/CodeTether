import {
  formatLastEventId,
  HostEventEnvelopeSchema,
  protocolVersion,
  type EpochId,
  type EventCursor,
  type HostEvent,
  type HostEventEnvelope,
  type StreamResetReason,
} from '@codetether/protocol'

import {
  HostEventReplayBuffer,
  HostEventSequenceError,
  type HostEventReplayBufferLimits,
  type ReplayDecision,
} from './host-event-replay-buffer.js'

export type HostEventSubscriber = (envelope: HostEventEnvelope) => void

export interface HostEventPublisherOptions extends HostEventReplayBufferLimits {
  readonly epoch: EpochId
  readonly onSubscriberError?: (error: Error) => void
}

/** Assigns process-global event identity before replay and live fanout. */
export class HostEventPublisher {
  readonly #replay: HostEventReplayBuffer
  readonly #subscribers = new Set<HostEventSubscriber>()
  readonly #onSubscriberError?: (error: Error) => void

  constructor(options: HostEventPublisherOptions) {
    this.#replay = new HostEventReplayBuffer(options.epoch, options)
    this.#onSubscriberError = options.onSubscriberError
  }

  get epoch(): EpochId {
    return this.#replay.epoch
  }

  get currentSeq(): number {
    return this.#replay.currentSeq
  }

  get subscriberCount(): number {
    return this.#subscribers.size
  }

  /**
   * Places a new Host epoch after restored presentation history so new live
   * Item order cannot collide with durable entries from an earlier epoch.
   */
  initializeSequence(sequence: number): void {
    if (this.#subscribers.size !== 0) {
      throw new HostEventSequenceError(
        'Host event sequence cannot be initialized after subscription',
      )
    }
    this.#replay.initializeSequence(sequence)
  }

  publish(event: HostEvent): HostEventEnvelope {
    if (event.type === 'stream.reset') {
      throw new Error(
        'stream.reset is a connection-local control and cannot be published globally',
      )
    }
    return this.#publish(event)
  }

  /**
   * Publishes a sequenced recovery boundary after Host-owned runtime history
   * was compacted. Unlike a cursor-specific reset, this record enters replay
   * so clients that were disconnected during compaction also replace from a
   * fresh Snapshot.
   */
  publishSnapshotBoundary(
    timestamp: string,
    reason: StreamResetReason = 'history_evicted',
  ): HostEventEnvelope {
    return this.#publish({
      conversationId: null,
      timestamp,
      type: 'stream.reset',
      payload: { reason },
    })
  }

  #publish(event: HostEvent): HostEventEnvelope {
    const seq = this.#replay.currentSeq + 1
    if (!Number.isSafeInteger(seq)) {
      throw new HostEventSequenceError('Host event sequence is exhausted')
    }
    const eventId = formatLastEventId({ epoch: this.epoch, seq })
    const envelope = HostEventEnvelopeSchema.parse({
      ...event,
      protocolVersion,
      epoch: this.epoch,
      seq,
      eventId,
    })
    // Replay is the reliable source for reconnect. If it cannot retain this
    // event, do not advance or fan it out as though recovery were possible.
    this.#replay.append(envelope)

    for (const subscriber of [...this.#subscribers]) {
      try {
        subscriber(envelope)
      } catch (error) {
        this.#subscribers.delete(subscriber)
        try {
          this.#onSubscriberError?.(toError(error))
        } catch {
          // Diagnostic consumers cannot break sequence fanout.
        }
      }
    }
    return envelope
  }

  subscribe(subscriber: HostEventSubscriber): () => void {
    this.#subscribers.add(subscriber)
    let subscribed = true
    return () => {
      if (!subscribed) return
      subscribed = false
      this.#subscribers.delete(subscriber)
    }
  }

  replayAfter(cursor: EventCursor): ReplayDecision {
    return this.#replay.replayAfter(cursor)
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}
