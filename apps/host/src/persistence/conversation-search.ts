import { createHash } from 'node:crypto'

import {
  conversationSearchLimits,
  ConversationIdSchema,
  TimestampSchema,
  type ProjectId,
} from '@codetether/protocol'

const SEARCH_CURSOR_VERSION = 1

const graphemeSegmenter = new Intl.Segmenter('und', {
  granularity: 'grapheme',
})

export interface ConversationSearchCursorContext {
  readonly projectId: ProjectId
  readonly query: string
  readonly archive: 'active' | 'archived' | 'all'
  readonly provider?: 'codex'
  readonly status?: 'idle' | 'running' | 'waiting' | 'completed' | 'failed'
}

export interface ConversationSearchSortCursor {
  readonly matchRank: number
  readonly archiveBucket: number
  readonly pinnedBucket: number
  readonly primaryTime: string
  readonly conversationId: string
}

interface SerializedConversationSearchCursor extends ConversationSearchSortCursor {
  readonly version: number
  readonly fingerprint: string
}

export class ConversationSearchCursorError extends Error {
  constructor(message = 'Conversation search cursor is invalid') {
    super(message)
    this.name = 'ConversationSearchCursorError'
  }
}

/**
 * Predictable V1 search normalization: NFC, Unicode lower-casing, collapsed
 * whitespace, and trim. It intentionally does not apply compatibility
 * normalization, fuzzy matching, stemming, or punctuation rewriting.
 */
export function normalizeConversationSearchText(value: string): string {
  if (typeof value !== 'string') {
    throw new Error('Conversation search source must be text')
  }
  return value
    .normalize('NFC')
    .toLocaleLowerCase('und')
    .replace(/\s+/gu, ' ')
    .trim()
}

export function normalizeConversationSearchQuery(value: string): string {
  if (typeof value !== 'string') {
    throw new Error('Conversation search query must be text')
  }
  const canonical = value.normalize('NFC').trim()
  const graphemes = [...graphemeSegmenter.segment(canonical)].length
  if (
    canonical.length === 0 ||
    canonical.length > conversationSearchLimits.queryCodeUnits ||
    graphemes > conversationSearchLimits.queryGraphemes
  ) {
    throw new Error(
      `Conversation search query must contain 1-${String(conversationSearchLimits.queryCodeUnits)} code units and at most ${String(conversationSearchLimits.queryGraphemes)} graphemes`,
    )
  }
  return normalizeConversationSearchText(canonical)
}

export function conversationSearchFingerprint(
  context: ConversationSearchCursorContext,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        projectId: context.projectId,
        query: context.query,
        archive: context.archive,
        provider: context.provider ?? null,
        status: context.status ?? null,
      }),
      'utf8',
    )
    .digest('base64url')
}

export function encodeConversationSearchCursor(
  context: ConversationSearchCursorContext,
  cursor: ConversationSearchSortCursor,
): string {
  const value: SerializedConversationSearchCursor = {
    version: SEARCH_CURSOR_VERSION,
    fingerprint: conversationSearchFingerprint(context),
    ...cursor,
  }
  return `csc_${Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')}`
}

export function decodeConversationSearchCursor(
  encoded: string,
  context: ConversationSearchCursorContext,
): ConversationSearchSortCursor {
  if (
    encoded.length === 0 ||
    encoded.length > conversationSearchLimits.cursorCodeUnits ||
    !/^csc_[A-Za-z0-9_-]+$/u.test(encoded)
  ) {
    throw new ConversationSearchCursorError()
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(
      Buffer.from(encoded.slice(4), 'base64url').toString('utf8'),
    ) as unknown | undefined
  } catch {
    throw new ConversationSearchCursorError()
  }
  if (!isRecord(parsed)) throw new ConversationSearchCursorError()
  const timestamp = TimestampSchema.safeParse(parsed.primaryTime)
  const conversationId = ConversationIdSchema.safeParse(parsed.conversationId)
  const expectedKeys = [
    'version',
    'fingerprint',
    'matchRank',
    'archiveBucket',
    'pinnedBucket',
    'primaryTime',
    'conversationId',
  ]
  if (
    Object.keys(parsed).length !== expectedKeys.length ||
    expectedKeys.some((key) => !(key in parsed)) ||
    parsed.version !== SEARCH_CURSOR_VERSION ||
    parsed.fingerprint !== conversationSearchFingerprint(context) ||
    !isBucket(parsed.matchRank, 0, 3) ||
    !isBucket(parsed.archiveBucket, 0, 1) ||
    !isBucket(parsed.pinnedBucket, 0, 1) ||
    !timestamp.success ||
    !conversationId.success
  ) {
    throw new ConversationSearchCursorError()
  }
  return {
    matchRank: parsed.matchRank,
    archiveBucket: parsed.archiveBucket,
    pinnedBucket: parsed.pinnedBucket,
    primaryTime: timestamp.data,
    conversationId: conversationId.data,
  }
}

/**
 * Returns at most 160 graphemes centered around the first normalized match.
 * The Protocol receives plain text only; ellipses are text, never HTML.
 */
export function conversationSearchPreview(
  source: string,
  normalizedQuery: string,
): string {
  const graphemes = [...graphemeSegmenter.segment(source)].map(
    ({ segment }) => segment,
  )
  if (
    graphemes.length <= conversationSearchLimits.previewGraphemes &&
    source.length <= conversationSearchLimits.previewCodeUnits
  ) {
    return source
  }

  const mapped = normalizeWithGraphemeMap(graphemes)
  // Match against the exact whole-string projection used by SQLite. Unicode
  // casing can be context-sensitive (for example Greek final sigma), so the
  // per-grapheme pass below is used only to map the already-found code-unit
  // position back to a safe grapheme boundary.
  const matchIndex =
    normalizeConversationSearchText(source).indexOf(normalizedQuery)
  const matchGrapheme =
    matchIndex < 0 ? 0 : (mapped.graphemeByCodeUnit[matchIndex] ?? 0)
  const matchEndGrapheme =
    matchIndex < 0
      ? matchGrapheme + 1
      : (mapped.graphemeByCodeUnit[
          matchIndex + Math.max(0, normalizedQuery.length - 1)
        ] ?? matchGrapheme) + 1
  const contentLimit = conversationSearchLimits.previewGraphemes - 2
  const before = Math.floor(contentLimit / 2)
  let start = Math.max(0, matchGrapheme - before)
  let end = Math.min(graphemes.length, start + contentLimit)
  start = Math.max(0, end - contentLimit)

  let preview = renderPreview(graphemes, start, end)
  while (
    preview.length > conversationSearchLimits.previewCodeUnits &&
    end - start > matchEndGrapheme - matchGrapheme
  ) {
    const beforeMatch = matchGrapheme - start
    const afterMatch = end - matchEndGrapheme
    if (beforeMatch > afterMatch && start < matchGrapheme) {
      start += 1
    } else if (end > matchEndGrapheme) {
      end -= 1
    } else if (start < matchGrapheme) {
      start += 1
    } else {
      break
    }
    preview = renderPreview(graphemes, start, end)
  }
  return preview.length <= conversationSearchLimits.previewCodeUnits
    ? preview
    : '…'
}

function renderPreview(
  graphemes: readonly string[],
  start: number,
  end: number,
): string {
  const prefix = start > 0 ? '…' : ''
  const suffix = end < graphemes.length ? '…' : ''
  return `${prefix}${graphemes.slice(start, end).join('')}${suffix}`
}

function normalizeWithGraphemeMap(graphemes: readonly string[]): {
  readonly graphemeByCodeUnit: readonly number[]
} {
  let text = ''
  const graphemeByCodeUnit: number[] = []
  let pendingWhitespace: number | undefined

  for (const [index, grapheme] of graphemes.entries()) {
    if (/^\s+$/u.test(grapheme)) {
      if (text.length > 0 && pendingWhitespace === undefined) {
        pendingWhitespace = index
      }
      continue
    }
    if (pendingWhitespace !== undefined) {
      text += ' '
      graphemeByCodeUnit.push(pendingWhitespace)
      pendingWhitespace = undefined
    }
    const normalized = grapheme.normalize('NFC').toLocaleLowerCase('und')
    text += normalized
    for (let offset = 0; offset < normalized.length; offset += 1) {
      graphemeByCodeUnit.push(index)
    }
  }
  return { graphemeByCodeUnit }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBucket(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  )
}
