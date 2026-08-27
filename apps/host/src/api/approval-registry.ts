import { randomUUID } from 'node:crypto'

import {
  ApprovalRecordSchema,
  ApprovalIdSchema,
  type ApprovalDecision,
  type ApprovalRecord,
  type ConversationId,
  type HostErrorCode,
  type HostEvent,
  type TurnId,
} from '@codetether/protocol'

import type {
  ProviderApprovalRequest,
  ProviderApprovalResolution,
  ProviderRequestId,
} from './agent-runtime.js'
import { publicItemId, type ConversationState } from './host-service-state.js'

const MAX_RESOLVED_APPROVALS = 256
export const MAX_PENDING_APPROVALS = 32

interface ApprovalState {
  record: ApprovalRecord
  readonly providerRequestId: ProviderRequestId
  readonly providerApprovalId: string
  readonly providerThreadId: string
  readonly providerTurnId: string
  readonly providerItemId?: string
  readonly respond: ProviderApprovalRequest['respond']
  resolving: boolean
}

type ApprovalId = ReturnType<typeof ApprovalIdSchema.parse>

export interface ApprovalRegistryOptions {
  readonly providerThreads: ReadonlyMap<string, ConversationId>
  readonly conversations: ReadonlyMap<ConversationId, ConversationState>
  readonly timestamp: () => string
  readonly publish: (event: HostEvent) => void
  readonly serviceError: (
    code: HostErrorCode,
    message: string,
    httpStatus: number,
    details?: Readonly<Record<string, string | number | boolean | null>>,
  ) => Error
}

/** Owns public/provider approval binding and one-shot response lifecycle. */
export class ApprovalRegistry {
  readonly #options: ApprovalRegistryOptions
  readonly #approvals = new Map<ApprovalId, ApprovalState>()
  readonly #providerApprovals = new Map<string, ApprovalId>()
  readonly #resolvedOrder: ApprovalId[] = []

  constructor(options: ApprovalRegistryOptions) {
    this.#options = options
  }

  pendingRecords(): readonly ApprovalRecord[] {
    return [...this.#approvals.values()]
      .filter((state) => state.record.status === 'pending' && !state.resolving)
      .map((state) => state.record)
  }

  request(request: ProviderApprovalRequest): void {
    const conversationId = this.#options.providerThreads.get(
      request.providerThreadId,
    )
    const conversation =
      conversationId === undefined
        ? undefined
        : this.#options.conversations.get(conversationId)
    const turnId = conversation?.providerTurnIds.get(request.providerTurnId)
    const turn =
      turnId === undefined ? undefined : conversation?.turns.get(turnId)
    if (
      conversationId === undefined ||
      conversation === undefined ||
      turnId === undefined ||
      turn === undefined ||
      turn.record.status !== 'running'
    ) {
      request.respond('decline')
      return
    }

    const providerKey = providerApprovalKey(
      request.providerThreadId,
      request.providerTurnId,
      request.providerRequestId,
    )
    if (this.#providerApprovals.has(providerKey)) {
      request.respond('decline')
      throw new Error('Provider reused an active approval request identity')
    }
    if (this.pendingRecords().length >= MAX_PENDING_APPROVALS) {
      // Fail closed before allocating another public/provider binding. The
      // provider may later report this automatic decline as an unknown
      // resolution, which deliberately fails the Runtime rather than risking
      // an approval that CodeTether cannot track.
      request.respond('decline')
      return
    }

    const approvalId = newApprovalId()
    const timestamp = this.#options.timestamp()
    const baseRecord = ApprovalRecordSchema.parse({
      approvalId,
      conversationId,
      turnId,
      kind: request.kind,
      summary: request.summary,
      status: 'pending',
      requestedAt: timestamp,
    })
    const hadProviderItem =
      request.providerItemId === undefined
        ? false
        : turn.providerItems.has(request.providerItemId)
    const itemId =
      request.providerItemId === undefined
        ? undefined
        : publicItemId(turn, request.providerItemId)
    const record: ApprovalRecord = {
      ...baseRecord,
      ...(itemId === undefined ? {} : { itemId }),
    }
    const state: ApprovalState = {
      record,
      providerRequestId: request.providerRequestId,
      providerApprovalId: request.providerApprovalId,
      providerThreadId: request.providerThreadId,
      providerTurnId: request.providerTurnId,
      ...(request.providerItemId === undefined
        ? {}
        : { providerItemId: request.providerItemId }),
      respond: request.respond,
      resolving: false,
    }
    const previousConversation = conversation.record
    this.#approvals.set(approvalId, state)
    this.#providerApprovals.set(providerKey, approvalId)
    conversation.record = {
      ...conversation.record,
      status: 'waiting',
      updatedAt: timestamp,
    }
    try {
      this.#options.publish({
        conversationId,
        turnId,
        ...(itemId === undefined ? {} : { itemId }),
        timestamp,
        type: 'approval.requested',
        payload: { approval: record },
      })
    } catch (error) {
      this.#approvals.delete(approvalId)
      this.#providerApprovals.delete(providerKey)
      conversation.record = previousConversation
      if (
        !hadProviderItem &&
        request.providerItemId !== undefined &&
        turn.providerItems.get(request.providerItemId) === itemId
      ) {
        turn.providerItems.delete(request.providerItemId)
      }
      throw error
    }
  }

  resolveProvider(resolution: ProviderApprovalResolution): void {
    const providerKey = providerApprovalKey(
      resolution.providerThreadId,
      resolution.providerTurnId,
      resolution.providerRequestId,
    )
    const approvalId = this.#providerApprovals.get(providerKey)
    const approval =
      approvalId === undefined ? undefined : this.#approvals.get(approvalId)
    if (approvalId === undefined || approval === undefined) {
      throw new Error('Provider resolved an unknown approval request')
    }
    if (
      approval.providerApprovalId !== resolution.providerApprovalId ||
      approval.providerThreadId !== resolution.providerThreadId ||
      approval.providerTurnId !== resolution.providerTurnId ||
      approval.providerItemId !== resolution.providerItemId ||
      !approval.resolving
    ) {
      throw new Error('Provider approval resolution identity did not match')
    }

    this.#completeResolution(approvalId, approval, resolution.decision, true)
  }

  resolveClient(
    approvalId: ApprovalId,
    decision: ApprovalDecision,
  ): ApprovalRecord {
    const approval = this.#approvals.get(approvalId)
    if (approval === undefined) {
      throw this.#options.serviceError(
        'not_found',
        'Approval was not found',
        404,
      )
    }
    if (approval.record.status !== 'pending' || approval.resolving) {
      throw this.#options.serviceError(
        'conflict',
        'Approval is no longer pending',
        409,
      )
    }
    this.#assertBinding(approval)
    approval.resolving = true
    try {
      approval.respond(decision)
    } catch (error) {
      approval.resolving = false
      throw this.#options.serviceError(
        'provider_error',
        'Provider approval response failed',
        500,
        { cause: safeErrorName(error) },
      )
    }
    return approval.record
  }

  declineForTurn(conversationId: ConversationId, turnId: TurnId): void {
    for (const approval of this.#approvals.values()) {
      if (
        approval.record.conversationId !== conversationId ||
        approval.record.turnId !== turnId ||
        approval.record.status !== 'pending' ||
        approval.resolving
      ) {
        continue
      }
      approval.resolving = true
      try {
        approval.respond('decline')
      } catch (error) {
        approval.resolving = false
        throw new Error('Failed to decline a terminal Turn approval', {
          cause: error,
        })
      }
    }
  }

  declineAll(): void {
    for (const approval of this.#approvals.values()) {
      if (approval.record.status !== 'pending' || approval.resolving) continue
      approval.resolving = true
      try {
        approval.respond('decline')
      } catch {
        // Runtime shutdown remains the final cleanup authority.
      }
    }
  }

  resolveAllForRuntimeFailure(): void {
    for (const [approvalId, approval] of this.#approvals) {
      if (approval.record.status !== 'pending') continue
      if (!approval.resolving) {
        approval.resolving = true
        try {
          approval.respond('decline')
        } catch {
          // The runtime has already failed; public state still terminates.
        }
      }
      if (approval.record.status === 'pending') {
        this.#completeResolution(approvalId, approval, 'decline', false)
      }
    }
  }

  #assertBinding(approval: ApprovalState): void {
    const conversation = this.#options.conversations.get(
      approval.record.conversationId,
    )
    const turn = conversation?.turns.get(approval.record.turnId)
    const providerItem =
      approval.providerItemId === undefined
        ? undefined
        : turn?.providerItems.get(approval.providerItemId)
    if (
      conversation === undefined ||
      turn === undefined ||
      conversation.providerThreadId !== approval.providerThreadId ||
      turn.providerTurnId !== approval.providerTurnId ||
      conversation.record.activeTurnId !== approval.record.turnId ||
      turn.record.status !== 'running' ||
      providerItem !== approval.record.itemId ||
      this.#providerApprovals.get(
        providerApprovalKey(
          approval.providerThreadId,
          approval.providerTurnId,
          approval.providerRequestId,
        ),
      ) !== approval.record.approvalId
    ) {
      throw this.#options.serviceError(
        'conflict',
        'Approval binding is no longer valid',
        409,
      )
    }
  }

  #hasUnresolvedForTurn(
    conversationId: ConversationId,
    turnId: TurnId,
  ): boolean {
    return [...this.#approvals.values()].some(
      (approval) =>
        approval.record.conversationId === conversationId &&
        approval.record.turnId === turnId &&
        approval.record.status === 'pending',
    )
  }

  #evictResolved(): void {
    while (this.#resolvedOrder.length > MAX_RESOLVED_APPROVALS) {
      const oldest = this.#resolvedOrder.shift()
      if (oldest !== undefined) this.#approvals.delete(oldest)
    }
  }

  #completeResolution(
    approvalId: ApprovalId,
    approval: ApprovalState,
    decision: ApprovalDecision,
    restoreRunningConversation: boolean,
  ): void {
    const resolvedAt = this.#options.timestamp()
    approval.record = {
      ...approval.record,
      status: 'resolved',
      decision,
      resolvedAt,
    }
    approval.resolving = false
    this.#providerApprovals.delete(
      providerApprovalKey(
        approval.providerThreadId,
        approval.providerTurnId,
        approval.providerRequestId,
      ),
    )
    const conversation = this.#options.conversations.get(
      approval.record.conversationId,
    )
    if (
      restoreRunningConversation &&
      conversation?.record.activeTurnId === approval.record.turnId &&
      conversation.record.status === 'waiting' &&
      !this.#hasUnresolvedForTurn(
        approval.record.conversationId,
        approval.record.turnId,
      )
    ) {
      conversation.record = {
        ...conversation.record,
        status: 'running',
        updatedAt: resolvedAt,
      }
    }
    this.#options.publish({
      conversationId: approval.record.conversationId,
      turnId: approval.record.turnId,
      ...(approval.record.itemId === undefined
        ? {}
        : { itemId: approval.record.itemId }),
      timestamp: resolvedAt,
      type: 'approval.resolved',
      payload: { approval: approval.record },
    })
    this.#resolvedOrder.push(approvalId)
    this.#evictResolved()
  }
}

function newApprovalId(): ApprovalId {
  return ApprovalIdSchema.parse(`approval_${randomUUID().replaceAll('-', '')}`)
}

function providerApprovalKey(
  providerThreadId: string,
  providerTurnId: string,
  providerRequestId: ProviderRequestId,
): string {
  return JSON.stringify([
    providerThreadId,
    providerTurnId,
    typeof providerRequestId === 'number'
      ? ['number', providerRequestId]
      : ['string', providerRequestId],
  ])
}

function safeErrorName(error: unknown): string {
  return error instanceof Error && error.name.trim().length > 0
    ? error.name
    : 'Error'
}
