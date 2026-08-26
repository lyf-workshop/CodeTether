import { z } from 'zod'

import { EpochIdSchema, SnapshotSequenceSchema } from './ids.js'

const LAST_EVENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:(?:0|[1-9][0-9]*)$/i

export const EventCursorSchema = z
  .object({
    epoch: EpochIdSchema,
    seq: SnapshotSequenceSchema,
  })
  .strict()
export type EventCursor = z.infer<typeof EventCursorSchema>

/** Replay cursor; unlike an emitted Event ID, a snapshot cursor may end in 0. */
export const LastEventIdSchema = z
  .string()
  .regex(LAST_EVENT_ID_PATTERN)
  .refine((value) => {
    const separator = value.lastIndexOf(':')
    return SnapshotSequenceSchema.safeParse(Number(value.slice(separator + 1)))
      .success
  }, 'Last-Event-ID sequence must be a safe non-negative integer')
  .brand<'LastEventId'>()
export type LastEventId = z.infer<typeof LastEventIdSchema>

export function formatLastEventId(cursor: EventCursor): LastEventId {
  const parsed = EventCursorSchema.parse(cursor)
  return LastEventIdSchema.parse(`${parsed.epoch}:${String(parsed.seq)}`)
}

export function parseLastEventId(
  value: string | null | undefined,
): EventCursor | null {
  const eventId = LastEventIdSchema.safeParse(value)
  if (!eventId.success) return null
  const separator = eventId.data.lastIndexOf(':')
  return EventCursorSchema.parse({
    epoch: eventId.data.slice(0, separator),
    seq: Number(eventId.data.slice(separator + 1)),
  })
}
