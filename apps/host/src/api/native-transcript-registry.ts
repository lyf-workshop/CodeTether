import { randomUUID } from 'node:crypto'

import {
  NativeTranscriptCursorSchema,
  type NativeTranscriptCursor,
} from '@codetether/protocol'

const DEFAULT_TTL_MS = 5 * 60_000
const DEFAULT_MAXIMUM_CURSORS = 256

interface CursorEntry {
  readonly cursor: NativeTranscriptCursor
  readonly scope: string
  readonly providerCursor: string
  readonly createdAtMs: number
}

/**
 * Keeps Provider cursors and their native identity scope behind the Host. A
 * public cursor is random, short-lived, and cannot be edited into a file or
 * another Conversation offset.
 */
export class NativeTranscriptCursorRegistry {
  readonly #entries = new Map<NativeTranscriptCursor, CursorEntry>()
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

  create(scope: string, providerCursor: string): NativeTranscriptCursor {
    this.#prune()
    while (this.#entries.size >= this.#maximumCursors) {
      const oldest = this.#entries.keys().next().value as
        NativeTranscriptCursor | undefined
      if (oldest === undefined) break
      this.#entries.delete(oldest)
    }
    const cursor = NativeTranscriptCursorSchema.parse(
      `transcript_${randomUUID().replaceAll('-', '')}`,
    )
    this.#entries.set(cursor, {
      cursor,
      scope,
      providerCursor,
      createdAtMs: this.#now(),
    })
    return cursor
  }

  resolve(cursor: NativeTranscriptCursor, scope: string): string | undefined {
    this.#prune()
    const entry = this.#entries.get(cursor)
    return entry?.scope === scope ? entry.providerCursor : undefined
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
