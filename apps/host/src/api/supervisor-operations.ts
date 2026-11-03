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
} from '@codetether/protocol'
import type { SupervisorB1Operation } from '@codetether/supervisor-transport'

import { HostServiceError, type HostService } from './host-service.js'

// Supervisor uses the same 16 KiB framing as Machine transport. Leave space
// for the response envelope and summaries around these variable-sized rows.
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
  for (const change of rows.slice(offset)) {
    const { diff, ...metadata } = change
    const projected =
      diff !== undefined && rowBytes(change) > maximumRowsBytes
        ? metadata
        : change
    const bytes = rowBytes(projected)
    if (bytes > remaining) {
      if (changes.length === 0) {
        throw new HostServiceError(
          'runtime_unavailable',
          'Change is too large for remote transport',
          503,
        )
      }
      break
    }
    if (projected !== change) omittedDiffs += 1
    changes.push(projected)
    remaining -= bytes
  }
  const nextOffset = offset + changes.length
  return {
    changes,
    omittedDiffs,
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
      return { ...attention, items: boundedRows(attention.items) }
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
