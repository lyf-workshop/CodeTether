import { z } from 'zod'

import {
  ConversationIdSchema,
  ProtocolVersionSchema,
  TimestampSchema,
} from './ids.js'
import { ProviderIdSchema } from './providers.js'

export const nativeTranscriptWireLimits = {
  defaultPageSize: 50,
  maximumPageSize: 100,
  maximumCursorCodeUnits: 512,
  maximumEntryContentCodeUnits: 64 * 1024,
  maximumPageContentBytes: 512 * 1024,
} as const

export const NativeTranscriptCursorSchema = z
  .string()
  .min(1)
  .max(nativeTranscriptWireLimits.maximumCursorCodeUnits)
  .regex(/^transcript_[A-Za-z0-9_-]{16,495}$/)
  .brand<'NativeTranscriptCursor'>()
export type NativeTranscriptCursor = z.infer<
  typeof NativeTranscriptCursorSchema
>

export const NativeTranscriptEntryIdSchema = z
  .string()
  .regex(/^native_[A-Za-z0-9_-]{20,95}$/)
  .brand<'NativeTranscriptEntryId'>()
export type NativeTranscriptEntryId = z.infer<
  typeof NativeTranscriptEntryIdSchema
>

export const NativeTranscriptStatusSchema = z.enum([
  'available',
  'empty',
  'partial',
  'unsupported',
  'unavailable',
  'machine_offline',
  'malformed',
])
export type NativeTranscriptStatus = z.infer<
  typeof NativeTranscriptStatusSchema
>

/**
 * Public historical entry. Its identity is CodeTether-opaque and it has no
 * Turn/action/execution fields by construction.
 */
export const NativeHistoricalTranscriptEntrySchema = z
  .object({
    id: NativeTranscriptEntryIdSchema,
    conversationId: ConversationIdSchema,
    source: z.literal('native_provider'),
    provider: ProviderIdSchema,
    role: z.enum(['user', 'assistant', 'system', 'tool']),
    kind: z.enum([
      'message',
      'tool_call',
      'tool_result',
      'status',
      'other_safe_event',
    ]),
    content: z
      .string()
      .max(nativeTranscriptWireLimits.maximumEntryContentCodeUnits),
    occurredAt: TimestampSchema.optional(),
    nativeSequence: z.number().int().nonnegative().safe().optional(),
    historical: z.literal(true),
    readOnly: z.literal(true),
  })
  .strict()
export type NativeHistoricalTranscriptEntry = z.infer<
  typeof NativeHistoricalTranscriptEntrySchema
>

export const ReadNativeTranscriptQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(nativeTranscriptWireLimits.maximumPageSize)
      .default(nativeTranscriptWireLimits.defaultPageSize),
    cursor: NativeTranscriptCursorSchema.optional(),
  })
  .strict()
export type ReadNativeTranscriptQueryInput = z.input<
  typeof ReadNativeTranscriptQuerySchema
>
export type ReadNativeTranscriptQuery = z.output<
  typeof ReadNativeTranscriptQuerySchema
>

export const ReadNativeTranscriptResponseSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    conversationId: ConversationIdSchema,
    provider: ProviderIdSchema,
    status: NativeTranscriptStatusSchema,
    entries: z
      .array(NativeHistoricalTranscriptEntrySchema)
      .max(nativeTranscriptWireLimits.maximumPageSize),
    nextCursor: NativeTranscriptCursorSchema.optional(),
    complete: z.boolean(),
    metrics: z
      .object({
        bytesRead: z.number().int().nonnegative().safe(),
        recordsScanned: z.number().int().nonnegative().safe(),
        entriesReturned: z.number().int().nonnegative().safe(),
        elapsedMs: z.number().int().nonnegative().safe(),
        truncated: z.boolean(),
      })
      .strict(),
  })
  .strict()
  .superRefine((page, context) => {
    if (page.metrics.entriesReturned !== page.entries.length) {
      context.addIssue({
        code: 'custom',
        path: ['metrics', 'entriesReturned'],
        message: 'Transcript metrics must match the returned entry count',
      })
    }
    if (page.complete === (page.nextCursor !== undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['nextCursor'],
        message: 'Only an incomplete transcript page may have a next cursor',
      })
    }
    if (page.status === 'available' && page.entries.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['entries'],
        message: 'Available transcript pages require visible entries',
      })
    }
    if (page.status === 'empty' && !page.complete) {
      context.addIssue({
        code: 'custom',
        path: ['complete'],
        message: 'A truly empty transcript is complete',
      })
    }
    if (
      [
        'empty',
        'unsupported',
        'unavailable',
        'machine_offline',
        'malformed',
      ].includes(page.status) &&
      page.entries.length > 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['entries'],
        message: 'Readable partial content must use the partial status',
      })
    }
    if (
      page.entries.some(
        (entry) =>
          entry.conversationId !== page.conversationId ||
          entry.provider !== page.provider,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['entries'],
        message: 'Transcript entries must match the response scope',
      })
    }
    const encoder = new TextEncoder()
    const bytes = page.entries.reduce(
      (total, entry) => total + encoder.encode(entry.content).byteLength,
      0,
    )
    if (bytes > nativeTranscriptWireLimits.maximumPageContentBytes) {
      context.addIssue({
        code: 'custom',
        path: ['entries'],
        message: 'Transcript page content exceeded its byte bound',
      })
    }
  })
export type ReadNativeTranscriptResponse = z.infer<
  typeof ReadNativeTranscriptResponseSchema
>
