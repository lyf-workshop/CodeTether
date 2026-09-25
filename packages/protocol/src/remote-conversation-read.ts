import { z } from 'zod'

import { LastEventIdSchema } from './cursor.js'
import { HostEventEnvelopeSchema } from './events.js'
import { ConversationIdSchema, ProtocolVersionSchema } from './ids.js'
import { ReadNativeTranscriptResponseSchema } from './native-transcript.js'
import { ConversationRuntimeSnapshotSchema } from './runtime-history.js'

export const remoteConversationReadLimits = {
  defaultHistoryPageSize: 20,
  maximumHistoryPageSize: 50,
  maximumHistoryCursorCodeUnits: 256,
  maximumLiveEvents: 64,
  maximumLiveWaitMs: 15_000,
} as const

export const RemoteConversationHistoryCursorSchema = z
  .string()
  .min(1)
  .max(remoteConversationReadLimits.maximumHistoryCursorCodeUnits)
  .regex(/^history_[A-Za-z0-9_-]{16,247}$/u)
  .brand<'RemoteConversationHistoryCursor'>()
export type RemoteConversationHistoryCursor = z.infer<
  typeof RemoteConversationHistoryCursorSchema
>

export const ReadRemoteConversationHistoryQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(remoteConversationReadLimits.maximumHistoryPageSize)
      .default(remoteConversationReadLimits.defaultHistoryPageSize),
    cursor: RemoteConversationHistoryCursorSchema.optional(),
  })
  .strict()
export type ReadRemoteConversationHistoryQuery = z.output<
  typeof ReadRemoteConversationHistoryQuerySchema
>

const remoteHistoryPageBase = {
  protocolVersion: ProtocolVersionSchema,
  conversationId: ConversationIdSchema,
  beforeCursor: RemoteConversationHistoryCursorSchema.optional(),
  hasMoreBefore: z.boolean(),
  historyComplete: z.boolean(),
  liveCursor: LastEventIdSchema,
}

const DurableRemoteConversationHistoryPageSchema = z
  .object({
    ...remoteHistoryPageBase,
    source: z.literal('durable'),
    runtime: ConversationRuntimeSnapshotSchema,
  })
  .strict()

const NativeRemoteConversationHistoryPageSchema = z
  .object({
    ...remoteHistoryPageBase,
    source: z.literal('native_provider'),
    native: ReadNativeTranscriptResponseSchema,
  })
  .strict()

export const RemoteConversationHistoryPageSchema = z
  .discriminatedUnion('source', [
    DurableRemoteConversationHistoryPageSchema,
    NativeRemoteConversationHistoryPageSchema,
  ])
  .superRefine((page, context) => {
    if (page.hasMoreBefore !== (page.beforeCursor !== undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['beforeCursor'],
        message: 'Earlier-history state must agree with its cursor',
      })
    }
    if (page.historyComplete && page.hasMoreBefore) {
      context.addIssue({
        code: 'custom',
        path: ['historyComplete'],
        message: 'A partial page cannot be history-complete',
      })
    }
    if (page.source === 'durable') {
      if (page.runtime.conversationId !== page.conversationId) {
        context.addIssue({
          code: 'custom',
          path: ['runtime', 'conversationId'],
          message: 'Durable history must match the requested Conversation',
        })
      }
      return
    }
    if (page.native.conversationId !== page.conversationId) {
      context.addIssue({
        code: 'custom',
        path: ['native', 'conversationId'],
        message: 'Native history must match the requested Conversation',
      })
    }
  })
export type RemoteConversationHistoryPage = z.infer<
  typeof RemoteConversationHistoryPageSchema
>

export const ReadRemoteConversationLiveQuerySchema = z
  .object({
    cursor: LastEventIdSchema,
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(remoteConversationReadLimits.maximumLiveEvents)
      .default(remoteConversationReadLimits.maximumLiveEvents),
    waitMs: z.coerce
      .number()
      .int()
      .min(0)
      .max(remoteConversationReadLimits.maximumLiveWaitMs)
      .default(10_000),
  })
  .strict()
export type ReadRemoteConversationLiveQuery = z.output<
  typeof ReadRemoteConversationLiveQuerySchema
>

export const RemoteConversationLivePageSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    conversationId: ConversationIdSchema,
    cursor: LastEventIdSchema,
    events: z
      .array(HostEventEnvelopeSchema)
      .max(remoteConversationReadLimits.maximumLiveEvents),
    resetRequired: z.boolean(),
    active: z.boolean(),
    timedOut: z.boolean(),
  })
  .strict()
  .superRefine((page, context) => {
    if (
      page.events.some((event) => event.conversationId !== page.conversationId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['events'],
        message: 'Live events must match the requested Conversation',
      })
    }
    if (page.resetRequired && page.events.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['events'],
        message: 'A reset response cannot contain untrusted replay events',
      })
    }
    if (page.timedOut && (page.resetRequired || page.events.length > 0)) {
      context.addIssue({
        code: 'custom',
        path: ['timedOut'],
        message: 'Only an empty healthy read may time out',
      })
    }
  })
export type RemoteConversationLivePage = z.infer<
  typeof RemoteConversationLivePageSchema
>
