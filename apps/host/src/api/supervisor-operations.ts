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

import {
  boundedSupervisorRows,
  supervisorJsonBytes,
  supervisorRowsByteBudget,
  truncateSupervisorText,
} from '../supervisor-read-budget.js'
import type { HostService } from './host-service.js'

function boundedChanges(
  rows: readonly ConversationFileChangeRecord[],
  offset: number,
) {
  const changes: ConversationFileChangeRecord[] = []
  const maximumRowsBytes = supervisorRowsByteBudget - 2
  let remaining = maximumRowsBytes
  let omittedDiffs = 0
  let omittedChanges = 0
  let nextOffset = offset
  for (const change of rows.slice(offset)) {
    const { diff, ...metadata } = change
    const changeBytes = supervisorJsonBytes(change) + 1
    const projected =
      diff !== undefined && changeBytes > maximumRowsBytes ? metadata : change
    const bytes =
      projected === change ? changeBytes : supervisorJsonBytes(projected) + 1
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
      const conversations = boundedSupervisorRows(recent)
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
      const compact = attention.items.map((item) => {
        if (
          item.type !== 'approval' ||
          item.payload.actionSubtitle === undefined ||
          supervisorJsonBytes(item) <= supervisorRowsByteBudget - 2
        )
          return item
        return {
          ...item,
          payload: {
            ...item.payload,
            actionSubtitle: truncateSupervisorText(
              item.payload.actionSubtitle,
              8192,
            ),
          },
        }
      })
      const items = boundedSupervisorRows(compact)
      return {
        ...attention,
        items,
        truncated:
          items.length < attention.items.length ||
          items.some((item, index) => item !== attention.items[index]),
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
