import {
  ActionIdSchema,
  ApprovalIdSchema,
  AttentionIdSchema,
  ConversationIdSchema,
  ListAttentionQuerySchema,
  MachineIdSchema,
  ProjectIdSchema,
  TurnIdSchema,
  protocolVersion,
  type ConversationFileChangeRecord,
  type SupervisorAttentionListResponse,
} from '@codetether/protocol'
import type { SupervisorB1Operation } from '@codetether/supervisor-transport'

import type { HostService } from './host-service.js'

// Supervisor frames allow 256 KiB. Keep variable-sized rows within a tighter
// budget and leave space for the response envelope and summaries.
const maximumRowsBytes = 12 * 1024

function rowBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8') + 1
}

function boundedRows<T>(rows: readonly T[]): T[] {
  let remaining = maximumRowsBytes
  const bounded: T[] = []
  for (const row of rows) {
    remaining -= rowBytes(row)
    if (remaining < 0) break
    bounded.push(row)
  }
  return bounded
}

function boundedChanges(
  rows: readonly ConversationFileChangeRecord[],
  offset: number,
) {
  const changes: ConversationFileChangeRecord[] = []
  let remaining = maximumRowsBytes
  let omittedDiffs = 0
  let omittedChanges = 0
  let nextOffset = offset
  for (const change of rows.slice(offset)) {
    const { diff, ...metadata } = change
    const changeBytes = rowBytes(change)
    const projected =
      diff !== undefined && changeBytes > maximumRowsBytes ? metadata : change
    const bytes = projected === change ? changeBytes : rowBytes(projected)
    if (bytes > maximumRowsBytes) {
      omittedChanges += 1
      nextOffset += 1
      continue
    }
    if (bytes > remaining) break
    if (projected !== change) omittedDiffs += 1
    changes.push(projected)
    remaining -= bytes
    nextOffset += 1
  }
  return {
    changes,
    omittedDiffs,
    omittedChanges,
    ...(nextOffset < rows.length ? { nextOffset } : {}),
  }
}

export function executeSupervisorB1Operation(
  service: HostService,
  request: SupervisorB1Operation,
): unknown {
  switch (request.operation) {
    case 'conversation.recent': {
      const recent = service.listRecentSupervisorConversations(
        MachineIdSchema.parse(request.machineId),
        request.limit,
      )
      const conversations = boundedRows(recent)
      return {
        protocolVersion,
        conversations,
        truncated: conversations.length < recent.length,
      }
    }
    case 'attention.list': {
      const attention = service.listAttention(
        ListAttentionQuerySchema.parse({
          projectId: request.projectId,
          type: request.attentionType,
          status: request.status,
          limit: request.limit,
        }),
      )
      const items = boundedRows(attention.items)
      return {
        ...attention,
        items,
        truncated: items.length < attention.items.length,
      } satisfies SupervisorAttentionListResponse
    }
    case 'attention.resolve':
      return service.resolveAttention(
        AttentionIdSchema.parse(request.attentionId),
        { actionId: ActionIdSchema.parse(request.actionId) },
      )
    case 'approval.resolve':
      return service.resolveApproval(
        ApprovalIdSchema.parse(request.approvalId),
        {
          actionId: ActionIdSchema.parse(request.actionId),
          decision: request.decision,
        },
      )
    case 'conversation.changes':
    case 'conversation.archive':
    case 'turn.interrupt': {
      const conversationId = ConversationIdSchema.parse(request.conversationId)
      service.getSupervisorConversation(
        MachineIdSchema.parse(request.machineId),
        ProjectIdSchema.parse(request.projectId),
        conversationId,
      )
      if (request.operation === 'conversation.changes') {
        const { runtime } = service.getConversation(conversationId)
        return {
          protocolVersion,
          conversationId,
          ...boundedChanges(runtime.changes, request.offset),
        }
      }
      const action = { actionId: ActionIdSchema.parse(request.actionId) }
      return request.operation === 'conversation.archive'
        ? service.archiveConversation(conversationId, action)
        : service.interruptTurn(
            conversationId,
            TurnIdSchema.parse(request.turnId),
            action,
          )
    }
  }
}
