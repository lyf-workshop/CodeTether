import { randomUUID } from 'node:crypto'

import {
  RemoteConversationHistoryCursorSchema,
  type NativeTranscriptCursor,
  type RemoteConversationHistoryCursor,
  type Timestamp,
  type TurnId,
} from '@codetether/protocol'

const DEFAULT_TTL_MS = 5 * 60_000
const DEFAULT_MAXIMUM_CURSORS = 512

export type ConversationHistoryPosition =
  | {
      readonly source: 'durable'
      readonly startedAt: Timestamp
      readonly turnId: TurnId
    }
  | {
      readonly source: 'native_provider'
      readonly cursor?: NativeTranscriptCursor
    }

interface CursorEntry {
  readonly scope: string
  readonly position: ConversationHistoryPosition
  readonly createdAtMs: number
}

/** Keeps durable/native pagination internals scoped and opaque to clients. */
export class ConversationHistoryCursorRegistry {
  readonly #entries = new Map<RemoteConversationHistoryCursor, CursorEntry>()
  readonly #now: () => number
  readonly #ttlMs: number
  readonly #maximumCursors: number

  constructor(
    now: () => number = Date.now,
    ttlMs: number = DEFAULT_TTL_MS,
    maximumCursors: number = DEFAULT_MAXIMUM_CURSORS,
  ) {
    this.#now = now
    this.#ttlMs = ttlMs
    this.#maximumCursors = maximumCursors
  }

  create(
    scope: string,
    position: ConversationHistoryPosition,
  ): RemoteConversationHistoryCursor {
    this.#prune()
    while (this.#entries.size >= this.#maximumCursors) {
      const oldest = this.#entries.keys().next().value as
        RemoteConversationHistoryCursor | undefined
      if (oldest === undefined) break
      this.#entries.delete(oldest)
    }
    const cursor = RemoteConversationHistoryCursorSchema.parse(
      `history_${randomUUID().replaceAll('-', '')}`,
    )
    this.#entries.set(cursor, {
      scope,
      position,
      createdAtMs: this.#now(),
    })
    return cursor
  }

  resolve(
    cursor: RemoteConversationHistoryCursor,
    scope: string,
  ): ConversationHistoryPosition | undefined {
    this.#prune()
    const entry = this.#entries.get(cursor)
    return entry?.scope === scope ? entry.position : undefined
  }

  clear(): void {
    this.#entries.clear()
  }

  #prune(): void {
    const cutoff = this.#now() - this.#ttlMs
    for (const [cursor, entry] of this.#entries) {
      if (entry.createdAtMs <= cutoff) this.#entries.delete(cursor)
    }
  }
}
