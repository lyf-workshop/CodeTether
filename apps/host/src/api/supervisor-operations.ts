import {
  ActionIdSchema,
  ApprovalIdSchema,
  AttentionIdSchema,
  ConversationIdSchema,
  ConversationSearchQuerySchema,
  ListAttentionQuerySchema,
  MachineIdSchema,
  ManualConversationTitleSchema,
  ProjectIdSchema,
  TurnIdSchema,
  protocolVersion,
  type ConversationFileChangeRecord,
  type ProjectRecord,
  type SupervisorAttentionListResponse,
} from '@codetether/protocol'
import {
  supervisorProjectCreateDataSchema,
  supervisorTransportLimits,
  type SupervisorB1Operation,
} from '@codetether/supervisor-transport'

import {
  boundedSupervisorRows,
  supervisorJsonBytes,
  supervisorRowsByteBudget,
  truncateSupervisorText,
} from '../supervisor-read-budget.js'
import { HostServiceError, type HostService } from './host-service.js'

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
    case 'project.create': {
      const machineId = MachineIdSchema.parse(request.machineId)
      const action = {
        actionId: ActionIdSchema.parse(request.actionId),
        path: request.path,
        ...(request.name === undefined ? {} : { name: request.name }),
      }
      const localMachineId = service
        .listMachines()
        .machines.find((machine) => machine.kind === 'local')?.machineId
      const requestId =
        'requestId' in request ? String(request.requestId) : undefined
      const beforeCreate = (project: ProjectRecord) => {
        const location = project.locations.find(
          (candidate) => candidate.machineId === machineId,
        )
        if (location === undefined) {
          throw new Error('Created Project has no target Location')
        }
        boundedProjectCreationData(
          machineId === localMachineId
            ? { project, created: true }
            : { project, location, created: true },
          machineId,
          requestId,
        )
      }
      const created =
        machineId === localMachineId
          ? service.createProject(action, beforeCreate)
          : service.createRemoteProject(machineId, action, beforeCreate)
      return created.then((response) =>
        boundedProjectCreationData(response.data, machineId, requestId),
      )
    }
    case 'project.remove':
      return service
        .deleteProject(ProjectIdSchema.parse(request.projectId), {
          actionId: ActionIdSchema.parse(request.actionId),
        })
        .then((response) => response.data)
    case 'conversation.search':
      return service.searchProjectConversations(
        ProjectIdSchema.parse(request.projectId),
        ConversationSearchQuerySchema.parse({
          q: request.query,
          archive: request.archive,
          provider: request.provider,
          status: request.status,
          limit: request.limit,
          cursor: request.cursor,
        }),
        { maximumResultsBytes: supervisorRowsByteBudget },
      )
    case 'conversation.pin':
    case 'conversation.rename':
    case 'conversation.restore': {
      const conversationId = ConversationIdSchema.parse(request.conversationId)
      service.getSupervisorConversation(
        MachineIdSchema.parse(request.machineId),
        ProjectIdSchema.parse(request.projectId),
        conversationId,
      )
      const action = { actionId: ActionIdSchema.parse(request.actionId) }
      if (request.operation === 'conversation.pin') {
        const mutation = request.pinned
          ? service.pinConversation(conversationId, action)
          : service.unpinConversation(conversationId, action)
        return mutation.then((response) => response.data)
      }
      if (request.operation === 'conversation.rename') {
        return service
          .renameConversation(conversationId, {
            ...action,
            title: ManualConversationTitleSchema.parse(request.title),
          })
          .then((response) => response.data)
      }
      return service
        .unarchiveConversation(conversationId, action)
        .then((response) => response.data)
    }
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

function boundedProjectCreationData(
  data:
    | Awaited<ReturnType<HostService['createProject']>>['data']
    | Awaited<ReturnType<HostService['createRemoteProject']>>['data'],
  machineId: string,
  requestId = `sreq_${'x'.repeat(96)}`,
): unknown {
  const frameBytes = (value: unknown) =>
    supervisorJsonBytes({
      type: 'supervisor.response',
      protocolVersion: 1,
      requestId,
      ok: true,
      data: value,
    })
  if (frameBytes(data) <= supervisorTransportLimits.maximumFrameBytes) {
    return data
  }
  const location = data.project.locations.find(
    (candidate) => candidate.machineId === machineId,
  )
  if (location === undefined) {
    throw new Error('Created Project has no Location on the target Machine')
  }
  const projected = {
    ...data,
    project: {
      ...data.project,
      locations: [location],
      _projection: {
        type: 'target_location_only',
        reason: 'frame_size_exceeded',
        completeSizeEstimate: supervisorJsonBytes(data.project),
        omittedLocationCount: data.project.locations.length - 1,
      },
    },
  }
  if (frameBytes(projected) > supervisorTransportLimits.maximumFrameBytes) {
    throw new HostServiceError(
      'invalid_request',
      'Project creation response exceeds the Supervisor frame budget',
      422,
    )
  }
  return supervisorProjectCreateDataSchema.parse(projected)
}
