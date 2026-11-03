import {
  AttentionListResponseSchema,
  ConversationFileChangeRecordSchema,
  GetMachineResponseSchema,
  InterruptTurnResponseSchema,
  ListMachinesResponseSchema,
  ResolveApprovalResponseSchema,
  ResolveAttentionResponseSchema,
  type ActionId,
} from '@codetether/protocol'

import {
  disconnectRemoteSupervisor,
  parseConversation,
  readRemoteConversationHistory,
  readRemoteMachine,
  readRemoteMachines,
  type RemoteSupervisorSession,
} from '../runtime/account/remote-supervisor.js'
import { hostBaseUrl } from '../runtime/host/host-config.js'
import {
  openSupervisorCheckSession,
  type SupervisorCheckConnectionOptions,
} from './supervisor-check-client.js'
import {
  checkErrorCategory,
  SupervisorCheckError,
} from './supervisor-check-model.js'

type ConversationTarget = {
  machineId: string
  projectId: string
  conversationId: string
}

export type DiagnosticMutation =
  | { operation: 'attention.resolve'; attentionId: string }
  | {
      operation: 'approval.resolve'
      approvalId: string
      decision: 'accept' | 'decline'
    }
  | ({ operation: 'turn.interrupt'; turnId: string } & ConversationTarget)

type ReadOperation =
  | { operation: 'conversation.recent'; machineId: string; limit: number }
  | { operation: 'attention.list'; status: 'open'; limit: number }
  | ({ operation: 'conversation.changes' } & ConversationTarget)

export interface OperationMeasurement {
  readonly operation:
    ReadOperation['operation'] | DiagnosticMutation['operation']
  readonly status: '成功' | '失败' | '未执行'
  readonly transport: RemoteSupervisorSession['transport']
  readonly elapsedMs: number | null
  readonly detail?: string
}

export async function withDiagnosticSession<T>(
  options: SupervisorCheckConnectionOptions,
  run: (session: RemoteSupervisorSession, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(30_000)])
  const session = await openSupervisorCheckSession({ ...options, signal })
  try {
    return await run(session, signal)
  } finally {
    await disconnectRemoteSupervisor(session)
  }
}

function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    invalid()
  return value as Record<string, unknown>
}

function invalid(): never {
  throw new SupervisorCheckError('invalid_response')
}

async function postOperation(
  session: RemoteSupervisorSession,
  body: ReadOperation | (DiagnosticMutation & { actionId: ActionId }),
  signal: AbortSignal,
): Promise<unknown> {
  signal.throwIfAborted()
  const response = await fetch(
    `${hostBaseUrl}/api/v1/remote-supervisor/sessions/${encodeURIComponent(session.sessionId)}/operations`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    },
  )
  if (!response.ok)
    throw new Error(`remote_supervisor_${String(response.status)}`)
  return await response.json()
}

export async function inspectDiagnosticOperations(
  session: RemoteSupervisorSession,
  signal: AbortSignal,
): Promise<{
  readonly measurements: readonly OperationMeasurement[]
  readonly actions: readonly DiagnosticMutation[]
}> {
  const measurements: OperationMeasurement[] = []
  const actions: DiagnosticMutation[] = []
  const transport = session.transport
  async function measure<T>(
    operation: ReadOperation,
    parse: (value: unknown) => T,
  ): Promise<T | undefined> {
    const started = performance.now()
    try {
      const value = parse(await postOperation(session, operation, signal))
      measurements.push({
        operation: operation.operation,
        status: '成功',
        transport,
        elapsedMs: elapsed(started),
      })
      return value
    } catch (error) {
      signal.throwIfAborted()
      measurements.push({
        operation: operation.operation,
        status: '失败',
        transport,
        elapsedMs: elapsed(started),
        detail: diagnosticOperationError(error),
      })
      return undefined
    }
  }

  const machines = ListMachinesResponseSchema.safeParse(
    await readRemoteMachines(session, signal),
  )
  if (!machines.success) invalid()
  const machineId = (
    machines.data.machines.find((machine) => machine.isLocal) ??
    machines.data.machines[0]
  )?.machineId
  const recent =
    machineId === undefined
      ? undefined
      : await measure(
          { operation: 'conversation.recent', machineId, limit: 30 },
          (value) => {
            const result = parseObject(value)
            if (
              result.protocolVersion !== 1 ||
              !Array.isArray(result.conversations) ||
              result.conversations.length > 30
            )
              invalid()
            const rows = result.conversations.map((row: unknown) =>
              parseConversation(parseObject(row)),
            )
            if (rows.some((row) => row.machineId !== machineId)) invalid()
            return rows
          },
        )
  if (machineId === undefined)
    measurements.push({
      operation: 'conversation.recent',
      status: '未执行',
      transport,
      elapsedMs: null,
      detail: 'no_machine',
    })

  const attention = await measure(
    { operation: 'attention.list', status: 'open', limit: 30 },
    (value) => {
      const result = AttentionListResponseSchema.safeParse(value)
      if (!result.success) invalid()
      return result.data.items.filter((item) => item.status === 'open')
    },
  )
  const first = recent?.[0]
  if (first === undefined) {
    measurements.push({
      operation: 'conversation.changes',
      status: '未执行',
      transport,
      elapsedMs: null,
      detail: 'no_conversation',
    })
  } else {
    await measure(
      {
        operation: 'conversation.changes',
        machineId: first.machineId,
        projectId: first.projectId,
        conversationId: first.conversationId,
      },
      (value) => {
        const result = parseObject(value)
        if (
          result.protocolVersion !== 1 ||
          result.conversationId !== first.conversationId ||
          !Array.isArray(result.changes) ||
          result.changes.some(
            (row: unknown) =>
              !ConversationFileChangeRecordSchema.safeParse(row).success,
          )
        )
          invalid()
      },
    )
  }

  if (session.control !== 'control') return { measurements, actions }
  const review = attention?.find((item) => item.type !== 'approval')
  if (review !== undefined)
    actions.push({
      operation: 'attention.resolve',
      attentionId: review.attentionId,
    })
  if (machineId === undefined || recent === undefined || recent.length === 0)
    return { measurements, actions }
  const machine = GetMachineResponseSchema.safeParse(
    await readRemoteMachine(session, machineId, signal),
  )
  if (!machine.success || machine.data.machine.machineId !== machineId)
    return { measurements, actions }
  const capabilities = new Map(
    machine.data.providers.map((provider) => [
      provider.provider,
      provider.capabilities,
    ]),
  )
  const approval = attention?.find(
    (item) =>
      item.type === 'approval' &&
      recent.some(
        (row) =>
          row.conversationId === item.conversationId &&
          row.projectId === item.projectId &&
          capabilities.get(row.provider)?.approvals === true,
      ),
  )
  if (approval?.type === 'approval') {
    actions.push(
      {
        operation: 'approval.resolve',
        approvalId: approval.payload.approvalId,
        decision: 'accept',
      },
      {
        operation: 'approval.resolve',
        approvalId: approval.payload.approvalId,
        decision: 'decline',
      },
    )
  }
  const running = recent.find(
    (row) =>
      (row.status === 'running' || row.status === 'waiting') &&
      capabilities.get(row.provider)?.interrupt === true,
  )
  if (running !== undefined) {
    const { machineId, projectId, conversationId } = running
    const history = await readRemoteConversationHistory(
      session,
      machineId,
      projectId,
      conversationId,
      { limit: 1 },
      signal,
    )
    const turn =
      history.source === 'durable'
        ? history.runtime.turns.find((row) => row.status === 'running')
        : undefined
    if (turn !== undefined)
      actions.push({
        operation: 'turn.interrupt',
        machineId,
        projectId,
        conversationId,
        turnId: turn.turnId,
      })
  }
  return { measurements, actions }
}

export async function runDiagnosticMutation(
  session: RemoteSupervisorSession,
  action: DiagnosticMutation,
  actionId: ActionId,
  signal: AbortSignal,
): Promise<OperationMeasurement> {
  if (session.control !== 'control')
    throw new SupervisorCheckError('authorization_unavailable')
  const started = performance.now()
  const base = { operation: action.operation, transport: session.transport }
  try {
    const value = await postOperation(session, { ...action, actionId }, signal)
    const schema =
      action.operation === 'approval.resolve'
        ? ResolveApprovalResponseSchema
        : action.operation === 'attention.resolve'
          ? ResolveAttentionResponseSchema
          : InterruptTurnResponseSchema
    const result = schema.safeParse(value)
    if (!result.success || result.data.actionId !== actionId) invalid()
    return {
      ...base,
      status: result.data.status === 'rejected' ? '失败' : '成功',
      elapsedMs: elapsed(started),
      detail: result.data.status,
    }
  } catch (error) {
    signal.throwIfAborted()
    return {
      ...base,
      status: '失败',
      elapsedMs: elapsed(started),
      detail: diagnosticOperationError(error),
    }
  }
}

export function diagnosticOperationError(error: unknown): string {
  if (error instanceof Error && error.message === 'remote_supervisor_409')
    return 'conflict_409'
  if (error instanceof Error && error.message === 'remote_supervisor_422')
    return 'unsupported_422'
  return checkErrorCategory(error)
}

function elapsed(started: number) {
  return Math.max(0, Math.round(performance.now() - started))
}
