import { z } from 'zod'

import { ProtocolVersionSchema, TurnIdSchema } from './ids.js'
import {
  ConversationStatusSchema,
  ConversationSummarySchema,
} from './records.js'

export const conversationSearchLimits = {
  default: 25,
  maximum: 100,
  queryCodeUnits: 256,
  queryGraphemes: 160,
  previewCodeUnits: 1024,
  previewGraphemes: 160,
  cursorCodeUnits: 2048,
} as const

/** Canonical, bounded user query used by the durable Conversation search. */
export const ConversationSearchQueryTextSchema = z
  .string()
  .transform((value) => value.normalize('NFC').trim())
  .pipe(
    z
      .string()
      .min(1)
      .max(conversationSearchLimits.queryCodeUnits)
      .refine(
        (value) =>
          countGraphemes(value) <= conversationSearchLimits.queryGraphemes,
        `Conversation search query cannot exceed ${String(conversationSearchLimits.queryGraphemes)} graphemes`,
      ),
  )
export type ConversationSearchQueryText = z.infer<
  typeof ConversationSearchQueryTextSchema
>

export const ConversationSearchArchiveFilterSchema = z.enum([
  'active',
  'archived',
  'all',
])
export type ConversationSearchArchiveFilter = z.infer<
  typeof ConversationSearchArchiveFilterSchema
>

/**
 * Opaque Host-issued pagination cursor. The prefix keeps it distinct from
 * public entity identities; the remaining token is URL-safe encoded state.
 */
export const ConversationSearchCursorSchema = z
  .string()
  .min(20)
  .max(conversationSearchLimits.cursorCodeUnits)
  .regex(/^csc_[A-Za-z0-9_-]+$/)
  .brand<'ConversationSearchCursor'>()
export type ConversationSearchCursor = z.infer<
  typeof ConversationSearchCursorSchema
>

/** Strict wire query for a Project-scoped durable Conversation search. */
export const ConversationSearchQuerySchema = z
  .object({
    q: ConversationSearchQueryTextSchema,
    archive: ConversationSearchArchiveFilterSchema.default('active'),
    provider: z.literal('codex').optional(),
    status: ConversationStatusSchema.optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(conversationSearchLimits.maximum)
      .default(conversationSearchLimits.default),
    cursor: ConversationSearchCursorSchema.optional(),
  })
  .strict()
export type ConversationSearchQueryInput = z.input<
  typeof ConversationSearchQuerySchema
>
export type ConversationSearchQuery = z.output<
  typeof ConversationSearchQuerySchema
>

export const ConversationSearchMatchedFieldSchema = z.enum([
  'title',
  'user_input',
])
export type ConversationSearchMatchedField = z.infer<
  typeof ConversationSearchMatchedFieldSchema
>

export const ConversationSearchMatchPreviewSchema = z
  .string()
  .max(conversationSearchLimits.previewCodeUnits)
  .refine((value) => value.trim().length > 0, {
    message: 'Conversation search preview must contain non-whitespace text',
  })
  .refine(
    (value) =>
      countGraphemes(value) <= conversationSearchLimits.previewGraphemes,
    `Conversation search preview cannot exceed ${String(conversationSearchLimits.previewGraphemes)} graphemes`,
  )
export type ConversationSearchMatchPreview = z.infer<
  typeof ConversationSearchMatchPreviewSchema
>

const TitleConversationSearchResultSchema = z
  .object({
    conversation: ConversationSummarySchema,
    matchedField: z.literal('title'),
  })
  .strict()

const UserInputConversationSearchResultSchema = z
  .object({
    conversation: ConversationSummarySchema,
    matchedField: z.literal('user_input'),
    matchPreview: ConversationSearchMatchPreviewSchema,
    matchedTurnId: TurnIdSchema,
  })
  .strict()

/** One deterministic result per durable Conversation. */
export const ConversationSearchResultSchema = z.discriminatedUnion(
  'matchedField',
  [
    TitleConversationSearchResultSchema,
    UserInputConversationSearchResultSchema,
  ],
)
export type ConversationSearchResult = z.infer<
  typeof ConversationSearchResultSchema
>

export const ConversationSearchResponseSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    results: z
      .array(ConversationSearchResultSchema)
      .max(conversationSearchLimits.maximum),
    hasMore: z.boolean(),
    nextCursor: ConversationSearchCursorSchema.optional(),
  })
  .strict()
  .superRefine((response, context) => {
    if (response.hasMore !== (response.nextCursor !== undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'Search pagination cursor must agree with hasMore',
        path: ['nextCursor'],
      })
    }
    if (response.hasMore && response.results.length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'A paginated Search response must advance from a result',
        path: ['results'],
      })
    }

    const identities = new Set<string>()
    for (const [index, result] of response.results.entries()) {
      const identity = String(result.conversation.conversationId)
      if (identities.has(identity)) {
        context.addIssue({
          code: 'custom',
          message: 'Search response cannot contain duplicate Conversations',
          path: ['results', index, 'conversation', 'conversationId'],
        })
      }
      identities.add(identity)
    }
  })
export type ConversationSearchResponse = z.infer<
  typeof ConversationSearchResponseSchema
>

function countGraphemes(value: string): number {
  return [
    ...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(value),
  ].length
}
