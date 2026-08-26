import { randomUUID } from 'node:crypto'

import type { AgentEvent } from '@codetether/agent-core'
import {
  ActionIdSchema,
  ApprovalIdSchema,
  ConversationIdSchema,
  ConversationRecordSchema,
  EpochIdSchema,
  formatLastEventId,
  HostEventSchema,
  HostEventEnvelopeSchema,
  protocolVersion,
  TurnIdSchema,
  type BootstrapResponse,
  type ConversationId,
  type CreateConversationRequest,
  type CreateConversationResponse,
  type HostErrorCode,
  type HostEvent,
  type HostEventEnvelope,
  type HostSnapshot,
  type InterruptTurnRequest,
  type InterruptTurnResponse,
  type ResolveApprovalRequest,
  type ResolveApprovalResponse,
  type StartTurnRequest,
  type StartTurnResponse,
  type TurnId,
  type TurnRecord,
} from '@codetether/protocol'

import {
  ActionIdConflictError,
  ActionIdempotencyCache,
  ActionIdempotencyCapacityError,
} from './action-idempotency-cache.js'
import type { AgentHostRuntime } from './agent-runtime.js'
import { ApprovalRegistry } from './approval-registry.js'
import { HostEventPublisher } from './host-event-publisher.js'
import type { ReplayResetReason } from './host-event-replay-buffer.js'
import type { ConversationState, TurnState } from './host-service-state.js'
import { ProviderEventTranslator } from './provider-event-translator.js'
import { WorkspacePolicy, WorkspacePolicyError } from './workspace-policy.js'

const MAX_PENDING_PROVIDER_EVENTS = 512
const MAX_PENDING_PROVIDER_EVENT_BYTES = 4 * 1024 * 1024

export class HostServiceError extends Error {
  constructor(
    readonly code: HostErrorCode,
    message: string,
    readonly httpStatus: number,
    readonly details?: Readonly<
      Record<string, string | number | boolean | null>
    >,
  ) {
    super(message)
    this.name = 'HostServiceError'
  }
}

export interface HostServiceOptions {
  readonly runtime: AgentHostRuntime
  readonly workspacePolicy: WorkspacePolicy
  readonly publisher: HostEventPublisher
  readonly hostVersion: string
  readonly now?: () => Date
}

/** In-memory authority for CodeTether Protocol identities and live state. */
export class HostService {
  readonly publisher: HostEventPublisher
  readonly #runtime: AgentHostRuntime
  readonly #workspacePolicy: WorkspacePolicy
  readonly #hostVersion: string
  readonly #now: () => Date
  readonly #actions = new ActionIdempotencyCache()
  readonly #conversations = new Map<ConversationId, ConversationState>()
  readonly #providerThreads = new Map<string, ConversationId>()
  readonly #approvalRegistry: ApprovalRegistry
  readonly #providerEventTranslator: ProviderEventTranslator
  readonly #pendingProviderEvents: AgentEvent[] = []
  #pendingProviderEventBytes = 0
  readonly #unsubscribeEvents: () => void
  readonly #unsubscribeApprovals: () => void
  readonly #unsubscribeFailures: () => void
  #runtimeFailure?: Error
  #closePromise?: Promise<void>

  constructor(options: HostServiceOptions) {
    this.#runtime = options.runtime
    this.#workspacePolicy = options.workspacePolicy
    this.publisher = options.publisher
    this.#hostVersion = options.hostVersion
    this.#now = options.now ?? (() => new Date())
    this.#approvalRegistry = new ApprovalRegistry({
      providerThreads: this.#providerThreads,
      conversations: this.#conversations,
      timestamp: () => this.#timestamp(),
      publish: (event) => this.#publish(event),
      serviceError: (code, message, httpStatus, details) =>
        new HostServiceError(code, message, httpStatus, details),
    })
    this.#providerEventTranslator = new ProviderEventTranslator({
      providerThreads: this.#providerThreads,
      conversations: this.#conversations,
      publish: (event) => this.#publish(event),
      completeTurn: (conversation, turn, status, completedAt, fields) =>
        this.#completeTurn(conversation, turn, status, completedAt, fields),
    })
    this.#unsubscribeEvents = this.#runtime.subscribeEvents((event) => {
      this.#acceptProviderEvent(event)
    })
    this.#unsubscribeApprovals = this.#runtime.subscribeApprovals(
      (request) => this.#approvalRegistry.request(request),
      (resolution) => this.#approvalRegistry.resolveProvider(resolution),
    )
    this.#unsubscribeFailures = this.#runtime.subscribeFailures((failure) => {
      this.#handleRuntimeFailure(failure)
    })
  }

  bootstrap(): BootstrapResponse {
    return {
      protocolVersion,
      hostVersion: this.#hostVersion,
      epoch: this.publisher.epoch,
      capabilities: {
        codex: this.#runtimeAvailable(),
        approvals: this.#runtimeAvailable(),
        interrupt: this.#runtimeAvailable(),
        resume: false,
        diff: this.#runtimeAvailable(),
        streaming: true,
      },
    }
  }

  snapshot(): HostSnapshot {
    const activeTurns: TurnRecord[] = []
    for (const conversation of this.#conversations.values()) {
      for (const turn of conversation.turns.values()) {
        if (turn.record.status === 'running') activeTurns.push(turn.record)
      }
    }
    return {
      protocolVersion,
      epoch: this.publisher.epoch,
      currentSeq: this.publisher.currentSeq,
      conversations: [...this.#conversations.values()].map(
        (state) => state.record,
      ),
      activeTurns,
      pendingApprovals: [...this.#approvalRegistry.pendingRecords()],
    }
  }

  async createConversation(
    request: CreateConversationRequest,
  ): Promise<CreateConversationResponse> {
    return await this.#executeAction(
      request.actionId,
      'conversation.create',
      request,
      async () => {
        let cwd: string
        try {
          cwd = await this.#workspacePolicy.authorize(request.cwd)
        } catch (error) {
          if (error instanceof WorkspacePolicyError) {
            throw new HostServiceError('invalid_request', error.message, 422)
          }
          throw error
        }

        let provider
        try {
          provider = await this.#runtime.startConversation({
            cwd,
            ...(request.model === undefined ? {} : { model: request.model }),
            ...(request.reasoning === undefined
              ? {}
              : { reasoning: request.reasoning }),
          })
        } catch (error) {
          if (!this.#runtimeAvailable()) throw runtimeUnavailableError()
          throw providerCommandError('create conversation', error)
        }
        this.#assertRuntimeAvailable()

        if (
          provider.providerThreadId.trim().length === 0 ||
          this.#providerThreads.has(provider.providerThreadId)
        ) {
          throw new HostServiceError(
            'provider_error',
            'Codex returned an invalid or reused Thread identity',
            500,
          )
        }

        const timestamp = this.#timestamp()
        const conversationId = newConversationId()
        let record
        try {
          record = ConversationRecordSchema.parse({
            conversationId,
            provider: 'codex',
            cwd,
            ...(provider.model === undefined && request.model === undefined
              ? {}
              : { model: provider.model ?? request.model }),
            ...(request.reasoning === undefined
              ? {}
              : { reasoning: request.reasoning }),
            status: 'idle',
            createdAt: timestamp,
            updatedAt: timestamp,
          })
        } catch (error) {
          throw providerCommandError(
            'return valid conversation metadata',
            error,
          )
        }
        const state: ConversationState = {
          record,
          providerThreadId: provider.providerThreadId,
          turns: new Map(),
          providerTurnIds: new Map(),
          startingTurn: false,
        }
        this.#conversations.set(conversationId, state)
        this.#providerThreads.set(provider.providerThreadId, conversationId)
        this.#publish({
          conversationId,
          timestamp,
          type: 'conversation.started',
          payload: { conversation: record },
        })
        this.#flushProviderEvents()
        return {
          protocolVersion,
          actionId: request.actionId,
          status: 'completed',
          data: { conversation: record },
        }
      },
    )
  }

  async startTurn(
    conversationId: ConversationId,
    request: StartTurnRequest,
  ): Promise<StartTurnResponse> {
    return await this.#executeAction(
      request.actionId,
      `turn.start:${conversationId}`,
      { conversationId, request },
      async () => {
        const conversation = this.#requireConversation(conversationId)
        if (
          conversation.startingTurn ||
          conversation.record.activeTurnId !== undefined
        ) {
          throw new HostServiceError(
            'conflict',
            'Conversation already has an active Turn',
            409,
          )
        }

        conversation.startingTurn = true
        let provider
        try {
          provider = await this.#runtime.startTurn({
            providerThreadId: conversation.providerThreadId,
            input: request.input.text,
            ...(conversation.record.model === undefined
              ? {}
              : { model: conversation.record.model }),
            ...(conversation.record.reasoning === undefined
              ? {}
              : { reasoning: conversation.record.reasoning }),
          })
        } catch (error) {
          if (!this.#runtimeAvailable()) throw runtimeUnavailableError()
          throw providerCommandError('start turn', error)
        } finally {
          conversation.startingTurn = false
        }
        this.#assertRuntimeAvailable()

        if (
          provider.providerTurnId.trim().length === 0 ||
          conversation.providerTurnIds.has(provider.providerTurnId)
        ) {
          throw new HostServiceError(
            'provider_error',
            'Codex returned an invalid or reused Turn identity',
            500,
          )
        }

        const timestamp = this.#timestamp()
        const turnId = newTurnId()
        const record: TurnRecord = {
          turnId,
          conversationId,
          status: 'running',
          startedAt: timestamp,
        }
        const state: TurnState = {
          record,
          providerTurnId: provider.providerTurnId,
          providerItems: new Map(),
          interrupting: false,
        }
        conversation.turns.set(turnId, state)
        conversation.providerTurnIds.set(provider.providerTurnId, turnId)
        conversation.record = {
          ...conversation.record,
          status: 'running',
          activeTurnId: turnId,
          updatedAt: timestamp,
        }
        this.#publish({
          conversationId,
          turnId,
          timestamp,
          type: 'turn.started',
          payload: { turn: record },
        })
        this.#flushProviderEvents()
        return {
          protocolVersion,
          actionId: request.actionId,
          status: 'accepted',
          data: { turn: record },
        }
      },
    )
  }

  async interruptTurn(
    conversationId: ConversationId,
    turnId: TurnId,
    request: InterruptTurnRequest,
  ): Promise<InterruptTurnResponse> {
    return await this.#executeAction(
      request.actionId,
      `turn.interrupt:${conversationId}:${turnId}`,
      { conversationId, turnId, request },
      async () => {
        const conversation = this.#requireConversation(conversationId)
        const turn = this.#requireTurn(conversation, turnId)
        if (
          turn.record.status !== 'running' ||
          conversation.record.activeTurnId !== turnId
        ) {
          throw new HostServiceError(
            'conflict',
            'Turn is not active and cannot be interrupted',
            409,
          )
        }
        if (turn.interrupting) {
          throw new HostServiceError(
            'conflict',
            'Turn interruption is already pending',
            409,
          )
        }

        turn.interrupting = true
        try {
          await this.#runtime.interruptTurn({
            providerThreadId: conversation.providerThreadId,
            providerTurnId: turn.providerTurnId,
          })
        } catch (error) {
          turn.interrupting = false
          if (!this.#runtimeAvailable()) throw runtimeUnavailableError()
          throw providerCommandError('interrupt turn', error)
        }
        this.#assertRuntimeAvailable()
        return {
          protocolVersion,
          actionId: request.actionId,
          status: 'accepted',
          data: { turn: turn.record },
        }
      },
    )
  }

  async resolveApproval(
    approvalId: ReturnType<typeof ApprovalIdSchema.parse>,
    request: ResolveApprovalRequest,
  ): Promise<ResolveApprovalResponse> {
    return await this.#executeAction(
      request.actionId,
      `approval.resolve:${approvalId}`,
      { approvalId, request },
      async () => {
        const approval = this.#approvalRegistry.resolveClient(
          approvalId,
          request.decision,
        )
        return {
          protocolVersion,
          actionId: request.actionId,
          status: 'accepted',
          data: { approval },
        }
      },
    )
  }

  createStreamReset(reason: ReplayResetReason): HostEventEnvelope {
    const seq = this.publisher.currentSeq
    return HostEventEnvelopeSchema.parse({
      protocolVersion,
      epoch: this.publisher.epoch,
      seq,
      eventId: formatLastEventId({ epoch: this.publisher.epoch, seq }),
      conversationId: null,
      timestamp: this.#timestamp(),
      type: 'stream.reset',
      payload: { reason },
    })
  }

  async close(): Promise<void> {
    this.#closePromise ??= this.#close()
    await this.#closePromise
  }

  #acceptProviderEvent(event: AgentEvent): void {
    if (this.#providerEventTranslator.translate(event)) return
    const bytes = Buffer.byteLength(JSON.stringify(event), 'utf8')
    if (
      this.#pendingProviderEvents.length >= MAX_PENDING_PROVIDER_EVENTS ||
      this.#pendingProviderEventBytes + bytes > MAX_PENDING_PROVIDER_EVENT_BYTES
    ) {
      throw new Error('Pending provider event binding buffer is full')
    }
    this.#pendingProviderEvents.push(event)
    this.#pendingProviderEventBytes += bytes
  }

  #completeTurn(
    conversation: ConversationState,
    turn: TurnState,
    status: Exclude<TurnRecord['status'], 'running'>,
    completedAt: string,
    fields: Pick<TurnRecord, 'finalMessage' | 'error'>,
  ): void {
    this.#approvalRegistry.declineForTurn(
      turn.record.conversationId,
      turn.record.turnId,
    )
    turn.record = {
      turnId: turn.record.turnId,
      conversationId: turn.record.conversationId,
      status,
      startedAt: turn.record.startedAt,
      completedAt,
      ...(fields.finalMessage === undefined
        ? {}
        : { finalMessage: fields.finalMessage }),
      ...(fields.error === undefined ? {} : { error: fields.error }),
    }
    turn.interrupting = false
    conversation.record = {
      ...conversation.record,
      status: status === 'failed' ? 'failed' : 'completed',
      updatedAt: completedAt,
    }
    const withoutActive = { ...conversation.record }
    Reflect.deleteProperty(withoutActive, 'activeTurnId')
    conversation.record = withoutActive
  }

  #flushProviderEvents(): void {
    if (this.#pendingProviderEvents.length === 0) return
    const pending = this.#pendingProviderEvents.splice(0)
    this.#pendingProviderEventBytes = 0
    for (const event of pending) {
      if (!this.#providerEventTranslator.translate(event)) {
        this.#acceptProviderEvent(event)
      }
    }
  }

  #publish(event: HostEvent): void {
    this.publisher.publish(HostEventSchema.parse(event))
  }

  #requireConversation(conversationId: ConversationId): ConversationState {
    const conversation = this.#conversations.get(conversationId)
    if (conversation === undefined) {
      throw new HostServiceError('not_found', 'Conversation was not found', 404)
    }
    return conversation
  }

  #requireTurn(conversation: ConversationState, turnId: TurnId): TurnState {
    const turn = conversation.turns.get(turnId)
    if (turn === undefined) {
      throw new HostServiceError('not_found', 'Turn was not found', 404)
    }
    return turn
  }

  async #executeAction<T>(
    actionId: ReturnType<typeof ActionIdSchema.parse>,
    operation: string,
    input: unknown,
    action: () => Promise<T>,
  ): Promise<T> {
    try {
      return await this.#actions.execute(
        actionId,
        operation,
        input,
        async () => {
          this.#assertRuntimeAvailable()
          return await action()
        },
      )
    } catch (error) {
      if (error instanceof ActionIdConflictError) {
        throw new HostServiceError('conflict', error.message, 409)
      }
      if (error instanceof ActionIdempotencyCapacityError) {
        throw new HostServiceError(
          'runtime_unavailable',
          'Host action capacity is temporarily exhausted',
          503,
        )
      }
      throw error
    }
  }

  async #close(): Promise<void> {
    this.#approvalRegistry.declineAll()
    try {
      await this.#runtime.close()
    } finally {
      this.#unsubscribeEvents()
      this.#unsubscribeApprovals()
      this.#unsubscribeFailures()
      this.#actions.clear()
      this.#pendingProviderEvents.length = 0
      this.#pendingProviderEventBytes = 0
    }
  }

  #timestamp(): string {
    return this.#now().toISOString()
  }

  #handleRuntimeFailure(failure: Error): void {
    if (
      this.#runtimeFailure !== undefined ||
      this.#closePromise !== undefined
    ) {
      return
    }
    this.#runtimeFailure = failure
    this.#pendingProviderEvents.length = 0
    this.#pendingProviderEventBytes = 0
    const timestamp = this.#timestamp()
    const error = {
      code: 'runtime_unavailable' as const,
      message: 'Codex runtime became unavailable',
    }
    for (const conversation of this.#conversations.values()) {
      const activeTurnId = conversation.record.activeTurnId
      if (activeTurnId === undefined) continue
      const turn = conversation.turns.get(activeTurnId)
      if (turn === undefined || turn.record.status !== 'running') continue
      this.#completeTurn(conversation, turn, 'failed', timestamp, { error })
      this.#publish({
        conversationId: conversation.record.conversationId,
        turnId: turn.record.turnId,
        timestamp,
        type: 'turn.failed',
        payload: { error },
      })
    }
    this.#approvalRegistry.resolveAllForRuntimeFailure()
  }

  #runtimeAvailable(): boolean {
    return (
      this.#runtimeFailure === undefined && this.#closePromise === undefined
    )
  }

  #assertRuntimeAvailable(): void {
    if (!this.#runtimeAvailable()) throw runtimeUnavailableError()
  }
}

function newConversationId(): ReturnType<typeof ConversationIdSchema.parse> {
  return ConversationIdSchema.parse(`conv_${compactUuid()}`)
}

function newTurnId(): ReturnType<typeof TurnIdSchema.parse> {
  return TurnIdSchema.parse(`turn_${compactUuid()}`)
}

export function newEpoch(): ReturnType<typeof EpochIdSchema.parse> {
  return EpochIdSchema.parse(randomUUID())
}

function compactUuid(): string {
  return randomUUID().replaceAll('-', '')
}

function providerCommandError(
  operation: string,
  error: unknown,
): HostServiceError {
  return new HostServiceError(
    'provider_error',
    `Codex failed to ${operation}`,
    500,
    { cause: safeErrorName(error) },
  )
}

function safeErrorName(error: unknown): string {
  return error instanceof Error && error.name.trim().length > 0
    ? error.name
    : 'Error'
}

function runtimeUnavailableError(): HostServiceError {
  return new HostServiceError(
    'runtime_unavailable',
    'Codex runtime is unavailable',
    503,
  )
}
