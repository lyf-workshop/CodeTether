import { createHash, type Hash } from 'node:crypto'

import type { AgentEvent, ToolOutputStream } from '@codetether/agent-core'

const DEFAULT_MAX_TRACKED_ITEMS = 1024

type IntegrityKind = 'message' | 'tool'
type IntegritySide = 'raw' | 'delivered'

interface DeltaDigestState {
  readonly threadId: string
  readonly turnId: string
  readonly raw: StreamDigest
  readonly delivered: StreamDigest
  rawObserved: boolean
  deliveredObserved: boolean
  rawCompleted: boolean
  rawDigest?: string
}

export interface DeltaIntegritySnapshot {
  readonly intact: boolean
  readonly trackedItems: number
}

export class DeltaIntegrityCapacityError extends Error {
  constructor(readonly maxTrackedItems: number) {
    super(
      `Delta integrity tracking exceeded ${String(maxTrackedItems)} active streamed items`,
    )
    this.name = 'DeltaIntegrityCapacityError'
  }
}

/** Compares raw and delivered streams using fixed-size incremental digests. */
export class IncrementalDeltaIntegrityTracker {
  readonly #maxTrackedItems: number
  readonly #states = new Map<string, DeltaDigestState>()
  #intact = true

  constructor(maxTrackedItems = DEFAULT_MAX_TRACKED_ITEMS) {
    if (!Number.isSafeInteger(maxTrackedItems) || maxTrackedItems <= 0) {
      throw new Error('maxTrackedItems must be a positive integer')
    }
    this.#maxTrackedItems = maxTrackedItems
  }

  observeRaw(event: AgentEvent): void {
    this.#observe('raw', event)
  }

  observeDelivered(event: AgentEvent): void {
    this.#observe('delivered', event)
    if (
      event.type === 'turn.completed' ||
      event.type === 'turn.interrupted' ||
      event.type === 'turn.failed'
    ) {
      const requireItemCompletion = event.type === 'turn.completed'
      this.#releaseTurn(event.threadId, event.turnId, requireItemCompletion)
    }
  }

  clear(): void {
    for (const state of this.#states.values()) destroyState(state)
    this.#states.clear()
  }

  snapshot(): DeltaIntegritySnapshot {
    return { intact: this.#intact, trackedItems: this.#states.size }
  }

  #observe(side: IntegritySide, event: AgentEvent): void {
    if (event.type === 'message.delta') {
      const state = this.#getOrCreateState(
        'message',
        event.threadId,
        event.turnId,
        event.itemId,
      )
      this.#append(state, side, event.delta)
      return
    }

    if (event.type === 'tool.output') {
      const state = this.#getOrCreateState(
        'tool',
        event.threadId,
        event.turnId,
        event.itemId,
      )
      this.#append(state, side, event.output, event.stream)
      return
    }

    if (event.type === 'message.completed') {
      this.#complete(
        side,
        'message',
        event.threadId,
        event.turnId,
        event.itemId,
        event.message,
      )
      return
    }

    if (event.type === 'tool.completed') {
      this.#complete(side, 'tool', event.threadId, event.turnId, event.itemId)
    }
  }

  #append(
    state: DeltaDigestState,
    side: IntegritySide,
    value: string,
    stream?: ToolOutputStream,
  ): void {
    if (side === 'raw') {
      if (state.rawCompleted) {
        throw new Error('Received raw streamed text after item completion')
      }
      state.raw.update(value, stream)
      state.rawObserved = true
      return
    }
    state.delivered.update(value, stream)
    state.deliveredObserved = true
  }

  #complete(
    side: IntegritySide,
    kind: IntegrityKind,
    threadId: string,
    turnId: string,
    itemId: string,
    canonicalMessage?: string,
  ): void {
    const key = stateKey(kind, threadId, turnId, itemId)
    const state = this.#states.get(key)
    if (state === undefined) return

    if (side === 'raw') {
      if (state.rawCompleted) {
        throw new Error('Received duplicate raw item completion')
      }
      state.rawDigest = state.raw.finish()
      state.rawCompleted = true
      if (
        kind === 'message' &&
        state.rawObserved &&
        state.rawDigest !== digestText(canonicalMessage ?? '')
      ) {
        this.#intact = false
      }
      return
    }

    const deliveredDigest = state.delivered.finish()
    if (
      !state.rawCompleted ||
      state.rawDigest === undefined ||
      state.rawDigest !== deliveredDigest ||
      state.rawObserved !== state.deliveredObserved
    ) {
      this.#intact = false
    }
    this.#states.delete(key)
    destroyState(state)
  }

  #getOrCreateState(
    kind: IntegrityKind,
    threadId: string,
    turnId: string,
    itemId: string,
  ): DeltaDigestState {
    const key = stateKey(kind, threadId, turnId, itemId)
    let state = this.#states.get(key)
    if (state !== undefined) return state
    if (this.#states.size >= this.#maxTrackedItems) {
      throw new DeltaIntegrityCapacityError(this.#maxTrackedItems)
    }
    state = {
      threadId,
      turnId,
      raw: new StreamDigest(kind),
      delivered: new StreamDigest(kind),
      rawObserved: false,
      deliveredObserved: false,
      rawCompleted: false,
    }
    this.#states.set(key, state)
    return state
  }

  #releaseTurn(
    threadId: string,
    turnId: string,
    requireItemCompletion: boolean,
  ): void {
    for (const [key, state] of this.#states) {
      if (state.threadId !== threadId || state.turnId !== turnId) continue
      if (requireItemCompletion) this.#intact = false
      destroyState(state)
      this.#states.delete(key)
    }
  }
}

class StreamDigest {
  readonly #kind: IntegrityKind
  #root: Hash | undefined = createHash('sha256')
  #segment?: Hash
  #segmentStream?: ToolOutputStream
  #digest?: string

  constructor(kind: IntegrityKind) {
    this.#kind = kind
  }

  update(value: string, stream: ToolOutputStream = 'unknown'): void {
    if (this.#root === undefined) {
      throw new Error('Cannot update a completed stream digest')
    }
    if (this.#kind === 'message') {
      this.#root.update(value, 'utf8')
      return
    }
    if (this.#segmentStream !== stream) {
      this.#finishToolSegment()
      this.#segmentStream = stream
      this.#segment = createHash('sha256')
    }
    this.#segment?.update(value, 'utf8')
  }

  finish(): string {
    if (this.#digest !== undefined) return this.#digest
    if (this.#root === undefined) {
      throw new Error('Stream digest was destroyed')
    }
    if (this.#kind === 'tool') this.#finishToolSegment()
    this.#digest = this.#root.digest('hex')
    this.#root = undefined
    return this.#digest
  }

  destroy(): void {
    this.#segment?.destroy()
    this.#segment = undefined
    this.#root?.destroy()
    this.#root = undefined
  }

  #finishToolSegment(): void {
    if (
      this.#root === undefined ||
      this.#segment === undefined ||
      this.#segmentStream === undefined
    ) {
      return
    }
    this.#root.update(Buffer.from([toolStreamCode(this.#segmentStream)]))
    this.#root.update(this.#segment.digest())
    this.#segment = undefined
  }
}

function destroyState(state: DeltaDigestState): void {
  state.raw.destroy()
  state.delivered.destroy()
}

function digestText(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function toolStreamCode(stream: ToolOutputStream): number {
  switch (stream) {
    case 'stdout':
      return 1
    case 'stderr':
      return 2
    case 'combined':
      return 3
    case 'unknown':
      return 4
  }
}

function stateKey(
  kind: IntegrityKind,
  threadId: string,
  turnId: string,
  itemId: string,
): string {
  return `${kind}\u0000${threadId}\u0000${turnId}\u0000${itemId}`
}
