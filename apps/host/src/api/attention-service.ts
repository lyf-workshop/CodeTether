import { randomUUID } from 'node:crypto'

import {
  AttentionIdSchema,
  AttentionItemSchema,
  AttentionListResponseSchema,
  protocolVersion,
  type AttentionId,
  type AttentionItem,
  type AttentionListResponse,
  type ConversationRecord,
  type HostEvent,
  type ListAttentionQuery,
} from '@codetether/protocol'

import {
  type ConversationStore,
  type DurableAttentionItem,
} from '../persistence/index.js'

export type AttentionSourceEvent = Extract<
  HostEvent,
  | { readonly type: 'approval.requested' }
  | { readonly type: 'approval.resolved' }
  | { readonly type: 'turn.completed' }
  | { readonly type: 'turn.failed' }
>

export interface AttentionTransition {
  readonly type: 'attention.created' | 'attention.resolved'
  readonly attention: AttentionItem
}

/** Reads the durable Attention index without consulting live Provider state. */
export function listAttention(
  store: ConversationStore,
  query: ListAttentionQuery,
): AttentionListResponse {
  const summary = store.summarizeAttentionItems({
    ...(query.projectId === undefined ? {} : { projectId: query.projectId }),
  })
  return AttentionListResponseSchema.parse({
    protocolVersion,
    items: store
      .listAttentionItems({
        ...(query.projectId === undefined
          ? {}
          : { projectId: query.projectId }),
        ...(query.type === undefined ? {} : { type: query.type }),
        status: query.status,
        limit: query.limit,
      })
      .map(attentionItem),
    summary: {
      totalOpen: summary.open,
      approvalOpen: summary.openApproval,
      completedReviewOpen: summary.openCompletedReview,
      failedOpen: summary.openFailed,
    },
  })
}

/**
 * Projects a reliable Provider lifecycle boundary into one durable Attention
 * transition. Source keys and SQLite uniqueness make terminal retries
 * exactly-once.
 */
export function recordAttention(
  store: ConversationStore,
  event: AttentionSourceEvent,
  conversation: ConversationRecord,
): AttentionTransition | undefined {
  const projectId = conversation.projectId
  const conversationTitle = conversation.title
  if (projectId === undefined || conversationTitle === undefined) {
    throw new Error('Attention requires durable Conversation product metadata')
  }

  switch (event.type) {
    case 'approval.requested': {
      const approval = event.payload.approval
      const result = store.upsertAttentionItem({
        attentionId: newAttentionId(),
        sourceKey: `approval:${approval.approvalId}`,
        projectId,
        conversationId: event.conversationId,
        turnId: event.turnId,
        type: 'approval',
        payload: {
          approvalId: approval.approvalId,
          kind: approval.kind,
          actionTitle: approvalActionTitle(approval.kind),
          actionSubtitle: approval.summary,
        },
        createdAt: event.timestamp,
        updatedAt: event.timestamp,
      })
      return result.created
        ? { type: 'attention.created', attention: attentionItem(result.item) }
        : undefined
    }
    case 'approval.resolved': {
      const approval = event.payload.approval
      const existing = store.getAttentionItemBySourceKey(
        `approval:${approval.approvalId}`,
      )
      if (
        existing === undefined ||
        existing.type !== 'approval' ||
        existing.conversationId !== event.conversationId ||
        existing.turnId !== event.turnId ||
        existing.payload.approvalId !== approval.approvalId
      ) {
        throw new Error('Durable Approval Attention binding is invalid')
      }
      const result = store.resolveAttentionItem(
        existing.attentionId,
        event.timestamp,
        { decision: approval.decision },
      )
      if (result === undefined) {
        throw new Error('Durable Approval Attention was not found')
      }
      return result.changed
        ? {
            type: 'attention.resolved',
            attention: attentionItem(result.item),
          }
        : undefined
    }
    case 'turn.completed': {
      const result = store.upsertAttentionItem({
        attentionId: newAttentionId(),
        sourceKey: `turn:${event.turnId}:completed_review`,
        projectId,
        conversationId: event.conversationId,
        turnId: event.turnId,
        type: 'completed_review',
        payload: { conversationTitle },
        createdAt: event.timestamp,
        updatedAt: event.timestamp,
      })
      return result.created
        ? { type: 'attention.created', attention: attentionItem(result.item) }
        : undefined
    }
    case 'turn.failed': {
      const result = store.upsertAttentionItem({
        attentionId: newAttentionId(),
        sourceKey: `turn:${event.turnId}:failed`,
        projectId,
        conversationId: event.conversationId,
        turnId: event.turnId,
        type: 'failed',
        payload: {
          conversationTitle,
          error: event.payload.error,
        },
        createdAt: event.timestamp,
        updatedAt: event.timestamp,
      })
      return result.created
        ? { type: 'attention.created', attention: attentionItem(result.item) }
        : undefined
    }
  }
}

export function resolveAttention(
  store: ConversationStore,
  attentionId: AttentionId,
  resolvedAt: string,
):
  { readonly attention: AttentionItem; readonly changed: boolean } | undefined {
  const existing = store.getAttentionItem(attentionId)
  if (existing === undefined) return undefined
  if (existing.type === 'approval') {
    throw new UnsupportedApprovalAttentionError()
  }
  if (existing.status !== 'open') {
    throw new AttentionAlreadyResolvedError()
  }
  const result = store.resolveAttentionItem(attentionId, resolvedAt)
  if (result === undefined) return undefined
  if (!result.changed) throw new AttentionAlreadyResolvedError()
  return { attention: attentionItem(result.item), changed: result.changed }
}

export class UnsupportedApprovalAttentionError extends Error {
  constructor() {
    super('Approval Attention must be resolved through the Approval endpoint')
    this.name = 'UnsupportedApprovalAttentionError'
  }
}

export class AttentionAlreadyResolvedError extends Error {
  constructor() {
    super('Attention item is no longer open')
    this.name = 'AttentionAlreadyResolvedError'
  }
}

function attentionItem(durable: DurableAttentionItem): AttentionItem {
  const value = {
    attentionId: durable.attentionId,
    projectId: durable.projectId,
    conversationId: durable.conversationId,
    ...(durable.turnId === undefined ? {} : { turnId: durable.turnId }),
    type: durable.type,
    status: durable.status,
    payload: durable.payload,
    createdAt: durable.createdAt,
    updatedAt: durable.updatedAt,
    ...(durable.resolvedAt === undefined
      ? {}
      : { resolvedAt: durable.resolvedAt }),
  }
  const parsed = AttentionItemSchema.safeParse(value)
  if (parsed.success) return parsed.data

  // Historical failed Attention can carry a pre-Phase-6D generic details
  // object. Keep the durable failure and discard only that unsafe bag.
  if (durable.type === 'failed') {
    const payload = durable.payload
    const error = isRecord(payload.error) ? payload.error : undefined
    if (error !== undefined && Object.hasOwn(error, 'details')) {
      const sanitizedError = { ...error }
      delete sanitizedError.details
      return AttentionItemSchema.parse({
        ...value,
        payload: { ...payload, error: sanitizedError },
      })
    }
  }
  return AttentionItemSchema.parse(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function approvalActionTitle(
  kind: 'command' | 'file-change' | 'unknown',
): string {
  switch (kind) {
    case 'command':
      return '\u6267\u884c\u547d\u4ee4'
    case 'file-change':
      return '\u4fee\u6539\u6587\u4ef6'
    case 'unknown':
      return '\u9700\u8981\u5ba1\u6279'
  }
}

function newAttentionId(): AttentionId {
  return AttentionIdSchema.parse(`attn_${randomUUID().replaceAll('-', '')}`)
}
