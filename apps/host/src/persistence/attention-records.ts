import {
  ConversationIdSchema,
  ProjectIdSchema,
  TimestampSchema,
  TurnIdSchema,
  type ConversationId,
  type ProjectId,
  type Timestamp,
  type TurnId,
} from '@codetether/protocol'

export const durableAttentionTypes = [
  'approval',
  'completed_review',
  'failed',
] as const
export type DurableAttentionType = (typeof durableAttentionTypes)[number]

export const durableAttentionStatuses = ['open', 'resolved', 'expired'] as const
export type DurableAttentionStatus = (typeof durableAttentionStatuses)[number]

export const attentionListLimits = {
  default: 50,
  maximum: 500,
} as const

export const attentionPayloadMaximumBytes = 256 * 1024

export interface NewDurableAttentionItem {
  readonly attentionId: string
  readonly sourceKey: string
  readonly projectId: ProjectId
  readonly conversationId: ConversationId
  readonly turnId?: TurnId
  readonly type: DurableAttentionType
  readonly payload: Readonly<Record<string, unknown>>
  readonly createdAt: Timestamp
  readonly updatedAt: Timestamp
}

export interface DurableAttentionItem extends NewDurableAttentionItem {
  readonly status: DurableAttentionStatus
  readonly resolvedAt?: Timestamp
}

export interface DurableAttentionUpsertResult {
  readonly item: DurableAttentionItem
  readonly created: boolean
}

export interface DurableAttentionResolveResult {
  readonly item: DurableAttentionItem
  readonly changed: boolean
}

export interface ListAttentionItemsOptions {
  readonly projectId?: ProjectId
  readonly conversationId?: ConversationId
  readonly turnId?: TurnId
  readonly type?: DurableAttentionType
  readonly status?: DurableAttentionStatus
  readonly limit?: number
}

export interface SummarizeAttentionItemsOptions {
  readonly projectId?: ProjectId
  readonly conversationId?: ConversationId
}

export interface DurableAttentionSummary {
  readonly total: number
  readonly open: number
  readonly resolved: number
  readonly expired: number
  readonly openApproval: number
  readonly openCompletedReview: number
  readonly openFailed: number
}

export interface AttentionRow {
  readonly attention_id: string
  readonly source_key: string
  readonly project_id: string
  readonly conversation_id: string
  readonly turn_id: string | null
  readonly type: string
  readonly status: string
  readonly payload_json: string
  readonly created_at: string
  readonly updated_at: string
  readonly resolved_at: string | null
}

export function parseNewAttentionItem(
  value: NewDurableAttentionItem,
): NewDurableAttentionItem {
  const createdAt = TimestampSchema.parse(value.createdAt)
  const updatedAt = TimestampSchema.parse(value.updatedAt)
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw new Error('Attention updatedAt must not precede createdAt')
  }
  return {
    attentionId: parseAttentionId(value.attentionId),
    sourceKey: parseBoundedText(value.sourceKey, 'Attention source key', 512),
    projectId: ProjectIdSchema.parse(value.projectId),
    conversationId: ConversationIdSchema.parse(value.conversationId),
    ...(value.turnId === undefined
      ? {}
      : { turnId: TurnIdSchema.parse(value.turnId) }),
    type: parseAttentionType(value.type),
    payload: normalizeAttentionPayload(value.payload),
    createdAt,
    updatedAt,
  }
}

export function attentionFromRow(row: AttentionRow): DurableAttentionItem {
  const status = parseAttentionStatus(row.status)
  const type = parseAttentionType(row.type)
  if (status === 'expired' && type !== 'approval') {
    throw new Error('Only durable Approval Attention may expire')
  }
  const resolvedAt =
    row.resolved_at === null
      ? undefined
      : TimestampSchema.parse(row.resolved_at)
  if ((status === 'open') !== (resolvedAt === undefined)) {
    throw new Error('Durable Attention resolution state is inconsistent')
  }
  return {
    ...parseNewAttentionItem({
      attentionId: row.attention_id,
      sourceKey: row.source_key,
      projectId: ProjectIdSchema.parse(row.project_id),
      conversationId: ConversationIdSchema.parse(row.conversation_id),
      ...(row.turn_id === null
        ? {}
        : { turnId: TurnIdSchema.parse(row.turn_id) }),
      type,
      payload: parseAttentionPayload(row.payload_json),
      createdAt: TimestampSchema.parse(row.created_at),
      updatedAt: TimestampSchema.parse(row.updated_at),
    }),
    status,
    ...(resolvedAt === undefined ? {} : { resolvedAt }),
  }
}

export function serializeAttentionPayload(
  value: Readonly<Record<string, unknown>>,
): string {
  const normalized = normalizeAttentionPayload(value)
  const serialized = JSON.stringify(normalized)
  if (Buffer.byteLength(serialized, 'utf8') > attentionPayloadMaximumBytes) {
    throw new Error(
      `Attention payload must not exceed ${String(attentionPayloadMaximumBytes)} UTF-8 bytes`,
    )
  }
  return serialized
}

export function parseAttentionPayload(
  serialized: string,
): Readonly<Record<string, unknown>> {
  let parsed: unknown
  try {
    parsed = JSON.parse(serialized) as unknown
  } catch (error) {
    throw new Error('Attention payload contains invalid JSON', { cause: error })
  }
  if (!isRecord(parsed)) {
    throw new Error('Attention payload must be a JSON object')
  }
  return normalizeAttentionPayload(parsed)
}

export function parseAttentionListLimit(value: number | undefined): number {
  const limit = value ?? attentionListLimits.default
  if (
    !Number.isSafeInteger(limit) ||
    limit <= 0 ||
    limit > attentionListLimits.maximum
  ) {
    throw new Error(
      `Attention list limit must be an integer between 1 and ${String(attentionListLimits.maximum)}`,
    )
  }
  return limit
}

export function parseAttentionType(value: string): DurableAttentionType {
  if (!isOneOf(value, durableAttentionTypes)) {
    throw new Error(`Unsupported durable Attention type: ${value}`)
  }
  return value
}

export function parseAttentionStatus(value: string): DurableAttentionStatus {
  if (!isOneOf(value, durableAttentionStatuses)) {
    throw new Error(`Unsupported durable Attention status: ${value}`)
  }
  return value
}

export function parseAttentionId(value: string): string {
  const trimmed = parseBoundedText(value, 'Attention ID', 128)
  if (!/^attn_[A-Za-z0-9][A-Za-z0-9_-]{5,122}$/u.test(trimmed)) {
    throw new Error('Attention ID must use the attn_ identity format')
  }
  return trimmed
}

function normalizeAttentionPayload(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new Error('Attention payload must be an object')
  const normalized = normalizeJsonValue(value, new Set(), 0)
  if (!isRecord(normalized)) {
    throw new Error('Attention payload must be a JSON object')
  }
  const serialized = JSON.stringify(normalized)
  if (Buffer.byteLength(serialized, 'utf8') > attentionPayloadMaximumBytes) {
    throw new Error(
      `Attention payload must not exceed ${String(attentionPayloadMaximumBytes)} UTF-8 bytes`,
    )
  }
  return normalized
}

function normalizeJsonValue(
  value: unknown,
  ancestors: Set<object>,
  depth: number,
): unknown {
  if (depth > 64) throw new Error('Attention payload nesting is too deep')
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Attention payload numbers must be finite')
    }
    return value
  }
  if (typeof value !== 'object') {
    throw new Error('Attention payload contains a non-JSON value')
  }
  if (ancestors.has(value)) {
    throw new Error('Attention payload must not contain cycles')
  }
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      return value.map((entry) =>
        normalizeJsonValue(entry, ancestors, depth + 1),
      )
    }
    if (!isRecord(value)) {
      throw new Error('Attention payload contains a non-plain object')
    }
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          normalizeJsonValue(value[key], ancestors, depth + 1),
        ]),
    )
  } finally {
    ancestors.delete(value)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value) as unknown
  return prototype === Object.prototype || prototype === null
}

function parseBoundedText(
  value: string,
  label: string,
  maxLength: number,
): string {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    throw new Error(`${label} must contain 1-${String(maxLength)} characters`)
  }
  return trimmed
}

function isOneOf<const Values extends readonly string[]>(
  value: string,
  values: Values,
): value is Values[number] {
  return values.includes(value)
}
