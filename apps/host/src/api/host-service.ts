import { randomUUID } from 'node:crypto'

import type { AgentEvent } from '@codetether/agent-core'
import {
  ActionIdSchema,
  ApprovalIdSchema,
  AttentionIdSchema,
  AttentionListResponseSchema,
  ConversationIdSchema,
  ConversationListResponseSchema,
  ConversationRecordSchema,
  ConversationSummarySchema,
  EpochIdSchema,
  formatLastEventId,
  GetConversationResponseSchema,
  HostEventSchema,
  HostEventEnvelopeSchema,
  ListAttentionQuerySchema,
  ProjectIdSchema,
  ListProjectConversationsQuerySchema,
  protocolVersion,
  TimestampSchema,
  TurnIdSchema,
  type BootstrapResponse,
  type ApprovalRecord,
  type AttentionId,
  type AttentionListResponse,
  type ConversationId,
  type ConversationApprovalHistoryRecord,
  type ConversationListResponse,
  type ConversationRecord,
  type ConversationRuntimeSnapshot,
  type ConversationSummary,
  type CreateConversationRequest,
  type CreateConversationResponse,
  type HostErrorCode,
  type HostEvent,
  type HostEventEnvelope,
  type HostSnapshot,
  type CreateProjectRequest,
  type CreateProjectResponse,
  type DeleteProjectRequest,
  type DeleteProjectResponse,
  type GetProjectResponse,
  type GetConversationResponse,
  type InterruptTurnRequest,
  type InterruptTurnResponse,
  type ListProjectsResponse,
  type ListAttentionQuery,
  type ListProjectConversationsQuery,
  type ProjectId,
  type ResolveApprovalRequest,
  type ResolveApprovalResponse,
  type ResolveAttentionRequest,
  type ResolveAttentionResponse,
  type StartTurnRequest,
  type StartTurnResponse,
  type TurnId,
  type TurnRecord,
} from '@codetether/protocol'

import {
  DEFAULT_CONVERSATION_TITLE,
  generateConversationTitle,
} from '../conversation-title.js'
import {
  ConversationStore,
  DURABLE_TURN_SNAPSHOT_VERSION,
  captureTurnPresentation,
  initialTurnPresentation,
  readDurableConversationDetail,
  restoreDurableConversations,
  type DurableApprovalHistoryRecord,
  type DurableConversation,
  type RestoredDurableConversation,
  type DurableTurnSnapshot,
} from '../persistence/index.js'

import {
  ActionIdConflictError,
  ActionIdempotencyCache,
  ActionIdempotencyCapacityError,
} from './action-idempotency-cache.js'
import {
  ProviderConversationUnavailableError,
  type AgentHostRuntime,
} from './agent-runtime.js'
import { ApprovalRegistry } from './approval-registry.js'
import {
  listAttention,
  recordAttention,
  resolveAttention as resolveDurableAttention,
  type AttentionSourceEvent,
  type AttentionTransition,
} from './attention-service.js'
import {
  ConversationRuntimeHistory,
  type ConversationRuntimeHistoryLimits,
} from './conversation-runtime-history.js'
import { HostEventPublisher } from './host-event-publisher.js'
import type { ReplayResetReason } from './host-event-replay-buffer.js'
import type { ConversationState, TurnState } from './host-service-state.js'
import {
  ProjectRegistry,
  ProjectRegistryError,
  type ProjectConversationReservation,
} from './project-registry.js'
import { ProviderEventTranslator } from './provider-event-translator.js'
import { WorkspacePolicy } from './workspace-policy.js'

const MAX_PENDING_PROVIDER_EVENTS = 512
const MAX_PENDING_PROVIDER_EVENT_BYTES = 4 * 1024 * 1024
export const DEFAULT_MAX_CONVERSATIONS = 8
export const DEFAULT_PERSISTENCE_FLUSH_MS = 300

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
  readonly historyLimits?: ConversationRuntimeHistoryLimits
  readonly maxConversations?: number
  readonly persistence?: ConversationStore
  readonly persistenceFlushMs?: number
}

/** Runtime authority for live state, optionally backed by durable normalized snapshots. */
export class HostService {
  readonly publisher: HostEventPublisher
  readonly #runtime: AgentHostRuntime
  readonly #workspacePolicy: WorkspacePolicy
  readonly #hostVersion: string
  readonly #now: () => Date
  readonly #actions = new ActionIdempotencyCache()
  readonly #inFlightActions = new Set<Promise<unknown>>()
  readonly #conversations = new Map<ConversationId, ConversationState>()
  readonly #providerThreads = new Map<string, ConversationId>()
  readonly #approvalRegistry: ApprovalRegistry
  readonly #runtimeHistory: ConversationRuntimeHistory
  readonly #providerEventTranslator: ProviderEventTranslator
  readonly #maxConversations: number
  readonly #persistence?: ConversationStore
  readonly #projects: ProjectRegistry
  readonly #persistenceFlushMs: number
  readonly #dirtyTurns = new Map<TurnId, ConversationId>()
  readonly #hydrations = new Map<ConversationId, Promise<ConversationState>>()
  readonly #runtimeAccess = new Map<ConversationId, number>()
  readonly #runtimePins = new Map<ConversationId, number>()
  readonly #pendingProviderEvents: AgentEvent[] = []
  #runtimeAccessSequence = 0
  #runtimeReservations = 0
  #pendingProviderEventBytes = 0
  #persistenceTimer?: ReturnType<typeof setTimeout>
  #persistenceFailure?: Error
  readonly #unsubscribeEvents: () => void
  readonly #unsubscribeApprovals: () => void
  readonly #unsubscribeFailures: () => void
  #runtimeFailure?: Error
  #closePromise?: Promise<void>
  #acceptingActions = true
  #closingRuntime = false

  constructor(options: HostServiceOptions) {
    this.#runtime = options.runtime
    this.#workspacePolicy = options.workspacePolicy
    this.publisher = options.publisher
    this.#hostVersion = options.hostVersion
    this.#now = options.now ?? (() => new Date())
    this.#maxConversations = positiveInteger(
      options.maxConversations,
      DEFAULT_MAX_CONVERSATIONS,
      'maxConversations',
    )
    this.#runtimeHistory = new ConversationRuntimeHistory(options.historyLimits)
    this.#persistence = options.persistence
    this.#persistenceFlushMs = nonNegativeInteger(
      options.persistenceFlushMs,
      DEFAULT_PERSISTENCE_FLUSH_MS,
      'persistenceFlushMs',
    )
    this.#projects = new ProjectRegistry({
      workspacePolicy: this.#workspacePolicy,
      ...(this.#persistence === undefined
        ? {}
        : { persistence: this.#persistence }),
      now: () => TimestampSchema.parse(this.#timestamp()),
      writeDurable: (operation) => this.#writeDurable(operation),
      hasRuntimeConversations: (projectId) =>
        [...this.#conversations.values()].some(
          (conversation) => conversation.record.projectId === projectId,
        ),
    })
    this.#restoreDurableState()
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
        resume: this.#persistence !== undefined && this.#runtimeAvailable(),
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
      conversationRuntimes: [...this.#runtimeHistory.snapshots()],
    }
  }

  /** Assembly-only compatibility path for explicit command-line roots. */
  async registerInitialProjectRoots(roots: readonly string[]): Promise<void> {
    await this.#projects.registerInitialRoots(roots)
  }

  async listProjects(): Promise<ListProjectsResponse> {
    return {
      protocolVersion,
      projects: [...(await this.#projects.list())],
    }
  }

  async getProject(projectId: ProjectId): Promise<GetProjectResponse> {
    try {
      return {
        protocolVersion,
        project: await this.#projects.get(ProjectIdSchema.parse(projectId)),
      }
    } catch (error) {
      throw projectServiceError(error)
    }
  }

  async listProjectConversations(
    projectId: ProjectId,
    query: ListProjectConversationsQuery,
  ): Promise<ConversationListResponse> {
    if (this.#persistence === undefined) {
      throw new HostServiceError(
        'runtime_unavailable',
        'Durable Conversation index is unavailable',
        503,
      )
    }
    const id = ProjectIdSchema.parse(projectId)
    const options = ListProjectConversationsQuerySchema.parse(query)
    try {
      await this.#projects.get(id)
    } catch (error) {
      throw projectServiceError(error)
    }
    return ConversationListResponseSchema.parse({
      protocolVersion,
      conversations: this.#persistence.listProjectConversations(id, options),
    })
  }

  getConversation(conversationId: ConversationId): GetConversationResponse {
    if (this.#persistence === undefined) {
      throw new HostServiceError(
        'runtime_unavailable',
        'Durable Conversation history is unavailable',
        503,
      )
    }
    const id = ConversationIdSchema.parse(conversationId)
    const durable = readDurableConversationDetail(this.#persistence, id, {
      maxTurns: this.#runtimeHistory.maxTurns,
      maxEntries: this.#runtimeHistory.maxEntries,
    })
    if (durable === undefined) {
      throw new HostServiceError('not_found', 'Conversation was not found', 404)
    }

    const hydrated = this.#conversations.get(id)
    const runtime =
      hydrated === undefined
        ? durable.runtime
        : (this.#runtimeHistory.snapshotFor(id) ?? durable.runtime)
    const record = hydrated?.record ?? durable.record
    if (hydrated !== undefined) this.#touchConversation(id)

    const currentApprovals =
      hydrated === undefined
        ? []
        : this.#approvalRegistry.recordsForConversation(id)
    const pendingApprovals = this.#approvalRegistry
      .pendingRecords()
      .filter((approval) => approval.conversationId === id)
    const approvalHistory = this.#conversationApprovalHistory(
      durable.approvals,
      currentApprovals,
      runtime,
    )
    const totalTurnCount = durable.history.totalTurns

    return GetConversationResponseSchema.parse({
      protocolVersion,
      conversation: conversationSummary(record),
      runtime,
      history: {
        hasOlderHistory: totalTurnCount > runtime.turns.length,
        retainedTurnCount: runtime.turns.length,
        totalTurnCount,
      },
      pendingApprovals,
      approvalHistory,
    })
  }

  listAttention(query: ListAttentionQuery): AttentionListResponse {
    const store = this.#requireAttentionStore()
    const options = ListAttentionQuerySchema.parse(query)
    if (options.projectId !== undefined) {
      try {
        // Durable Attention remains readable when the registered workspace is
        // unavailable, so validate identity without probing the filesystem.
        this.#projects.require(options.projectId)
      } catch (error) {
        throw projectServiceError(error)
      }
    }
    return AttentionListResponseSchema.parse(listAttention(store, options))
  }

  async resolveAttention(
    attentionId: AttentionId,
    request: ResolveAttentionRequest,
  ): Promise<ResolveAttentionResponse> {
    return await this.#executeAction(
      request.actionId,
      `attention.resolve:${attentionId}`,
      { attentionId, request },
      async () => {
        const store = this.#requireAttentionStore()
        const id = AttentionIdSchema.parse(attentionId)
        const existing = store.getAttentionItem(id)
        if (existing === undefined) {
          throw new HostServiceError(
            'not_found',
            'Attention item was not found',
            404,
          )
        }
        if (existing.type === 'approval') {
          throw new HostServiceError(
            'unsupported',
            'Approval Attention must be resolved through the Approval endpoint',
            422,
          )
        }
        if (existing.status !== 'open') {
          throw new HostServiceError(
            'conflict',
            'Attention item is no longer open',
            409,
          )
        }
        const result = this.#writeDurableResult(() =>
          resolveDurableAttention(store, id, this.#timestamp()),
        )
        if (result === undefined) {
          throw new Error('Durable Attention disappeared during resolution')
        }
        if (result.changed) {
          this.#publishAttention({
            type: 'attention.resolved',
            attention: result.attention,
          })
        }
        return {
          protocolVersion,
          actionId: request.actionId,
          status: 'completed',
          data: { attention: result.attention },
        }
      },
      false,
    )
  }

  async createProject(
    request: CreateProjectRequest,
  ): Promise<CreateProjectResponse> {
    return await this.#executeAction(
      request.actionId,
      'project.create',
      request,
      async () => {
        try {
          const data = await this.#projects.create(request.path, request.name)
          return {
            protocolVersion,
            actionId: request.actionId,
            status: 'completed',
            data,
          }
        } catch (error) {
          throw projectServiceError(error)
        }
      },
      false,
    )
  }

  async deleteProject(
    projectId: ProjectId,
    request: DeleteProjectRequest,
  ): Promise<DeleteProjectResponse> {
    return await this.#executeAction(
      request.actionId,
      `project.delete:${projectId}`,
      { projectId, request },
      async () => {
        try {
          const deletedProjectId = this.#projects.delete(
            ProjectIdSchema.parse(projectId),
          )
          return {
            protocolVersion,
            actionId: request.actionId,
            status: 'completed',
            data: { projectId: deletedProjectId },
          }
        } catch (error) {
          throw projectServiceError(error)
        }
      },
      false,
    )
  }

  async createConversation(
    request: CreateConversationRequest,
  ): Promise<CreateConversationResponse> {
    return await this.#executeAction(
      request.actionId,
      'conversation.create',
      request,
      async () => {
        const workspace = await this.#reserveConversationProject(request)
        try {
          const releaseRuntimeSlot = this.#reserveRuntimeSlot()
          try {
            const projectId = workspace.project.projectId
            const cwd = workspace.cwd
            const timestamp = this.#timestamp()
            const conversationId = newConversationId()
            const creatingConversation: DurableConversation = {
              conversationId,
              projectId,
              title: DEFAULT_CONVERSATION_TITLE,
              provider: 'codex',
              cwd,
              ...(request.model === undefined ? {} : { model: request.model }),
              ...(request.reasoning === undefined
                ? {}
                : { reasoning: request.reasoning }),
              status: 'creating',
              createdAt: timestamp,
              updatedAt: timestamp,
              lastActivityAt: timestamp,
            }
            this.#writeDurable(() => {
              this.#persistence?.createConversation(creatingConversation)
            })

            let provider:
              | Awaited<ReturnType<AgentHostRuntime['startConversation']>>
              | undefined
            try {
              provider = await this.#runtime.startConversation({
                cwd,
                ...(request.model === undefined
                  ? {}
                  : { model: request.model }),
                ...(request.reasoning === undefined
                  ? {}
                  : { reasoning: request.reasoning }),
              })
            } catch (error) {
              this.#rollbackCreatingConversation(conversationId)
              if (!this.#runtimeAvailable()) throw runtimeUnavailableError()
              throw providerCommandError('create conversation', error)
            }
            this.#assertRuntimeAvailable()

            if (
              provider.providerThreadId.trim().length === 0 ||
              this.#providerThreads.has(provider.providerThreadId) ||
              this.#persistence
                ?.listConversations()
                .some(
                  (conversation) =>
                    conversation.providerThreadId === provider.providerThreadId,
                ) === true
            ) {
              this.#rollbackCreatingConversation(conversationId)
              throw new HostServiceError(
                'provider_error',
                'Codex returned an invalid or reused Thread identity',
                500,
              )
            }

            let record
            try {
              record = ConversationRecordSchema.parse({
                conversationId,
                projectId,
                title: DEFAULT_CONVERSATION_TITLE,
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
                lastActivityAt: timestamp,
              })
            } catch (error) {
              this.#rollbackCreatingConversation(conversationId)
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
              providerSession: 'ready',
              startingTurn: false,
            }
            this.#writeDurable(() => {
              this.#persistence?.updateConversation(
                this.#durableConversation(state),
              )
            })
            this.#conversations.set(conversationId, state)
            this.#providerThreads.set(provider.providerThreadId, conversationId)
            this.#publish({
              conversationId,
              timestamp,
              type: 'conversation.started',
              payload: { conversation: record },
            })
            this.#flushProviderEvents()
            this.#touchConversation(conversationId)
            return {
              protocolVersion,
              actionId: request.actionId,
              status: 'completed',
              data: { conversation: record },
            }
          } finally {
            releaseRuntimeSlot()
          }
        } finally {
          workspace.release()
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
        const inputBytes = Buffer.byteLength(request.input.text, 'utf8')
        const inputRuntimeBytes = Buffer.byteLength(
          JSON.stringify(request.input.text),
          'utf8',
        )
        if (
          inputBytes > this.#runtimeHistory.inputByteLimit ||
          !this.#runtimeHistory.canRetainInput(request.input.text)
        ) {
          throw new HostServiceError(
            'invalid_request',
            'Turn input exceeds the Host runtime history byte limit',
            422,
            {
              maxBytes: this.#runtimeHistory.inputByteLimit,
              actualBytes: inputBytes,
              runtimeEncodedBytes: inputRuntimeBytes,
            },
          )
        }
        const parsedConversationId = ConversationIdSchema.parse(conversationId)
        const releaseRuntimePin =
          this.#pinRuntimeConversation(parsedConversationId)
        let conversation: ConversationState
        try {
          conversation =
            await this.#ensureConversationHydrated(parsedConversationId)
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
        } finally {
          releaseRuntimePin()
        }
        this.#touchConversation(conversation.record.conversationId)
        let authorizedCwd: string
        try {
          const projectId = conversation.record.projectId
          if (projectId === undefined) {
            throw new HostServiceError(
              'project_unavailable',
              'Conversation has no durable Project identity',
              409,
            )
          }
          authorizedCwd = (
            await this.#projects.authorizeConversation(
              projectId,
              conversation.record.cwd,
            )
          ).cwd
          await this.#ensureProviderConversation(conversation, authorizedCwd)
        } catch (error) {
          conversation.startingTurn = false
          throw projectServiceError(error)
        }

        const timestamp = this.#timestamp()
        const turnId = newTurnId()
        const record: TurnRecord = {
          turnId,
          conversationId,
          status: 'running',
          input: {
            ...request.input,
            timestamp,
          },
          startedAt: timestamp,
        }
        const nextConversationRecord = ConversationRecordSchema.parse({
          ...conversation.record,
          ...(shouldGenerateConversationTitle(conversation)
            ? { title: generateConversationTitle(request.input.text) }
            : {}),
          updatedAt: timestamp,
          lastActivityAt: timestamp,
        })
        try {
          this.#writeDurable(() => {
            this.#persistence?.runInTransaction(() => {
              this.#persistence?.createTurn({
                turnId,
                conversationId,
                input: record.input!,
                status: 'starting',
                startedAt: timestamp,
                snapshotVersion: DURABLE_TURN_SNAPSHOT_VERSION,
                snapshot: initialTurnPresentation(record),
              })
              this.#persistence?.updateConversation({
                ...this.#durableConversation(conversation),
                title:
                  nextConversationRecord.title ?? DEFAULT_CONVERSATION_TITLE,
                updatedAt: nextConversationRecord.updatedAt,
                lastActivityAt:
                  nextConversationRecord.lastActivityAt ??
                  nextConversationRecord.updatedAt,
              })
            })
          })
          conversation.record = nextConversationRecord
        } catch (error) {
          conversation.startingTurn = false
          throw error
        }

        let provider:
          Awaited<ReturnType<AgentHostRuntime['startTurn']>> | undefined
        let startError: unknown
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
          startError = error
        } finally {
          conversation.startingTurn = false
        }
        if (startError !== undefined) {
          const unavailable = !this.#runtimeAvailable()
          this.#recordProviderStartFailure(
            conversation,
            record,
            unavailable ? 'runtime_unavailable' : 'provider_error',
            unavailable
              ? 'Codex runtime became unavailable'
              : 'Codex failed to start Turn',
          )
          this.#flushProviderEvents()
          if (unavailable) throw runtimeUnavailableError()
          throw providerCommandError('start turn', startError)
        }
        this.#assertRuntimeAvailable()

        if (
          provider === undefined ||
          provider.providerTurnId.trim().length === 0 ||
          conversation.providerTurnIds.has(provider.providerTurnId)
        ) {
          this.#recordProviderStartFailure(
            conversation,
            record,
            'provider_error',
            'Codex returned an invalid Turn identity',
          )
          this.#flushProviderEvents()
          throw new HostServiceError(
            'provider_error',
            'Codex returned an invalid or reused Turn identity',
            500,
          )
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
        this.#writeDurable(() => {
          this.#persistence?.runInTransaction(() => {
            this.#persistence?.updateTurn({
              turnId,
              conversationId,
              providerTurnId: provider.providerTurnId,
              input: record.input!,
              status: 'running',
              startedAt: timestamp,
              snapshotVersion: DURABLE_TURN_SNAPSHOT_VERSION,
              snapshot: initialTurnPresentation(record),
            })
            this.#persistence?.updateConversation(
              this.#durableConversation(conversation),
            )
          })
        })
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
        const parsedConversationId = ConversationIdSchema.parse(conversationId)
        const releaseRuntimePin =
          this.#pinRuntimeConversation(parsedConversationId)
        let conversation: ConversationState
        let turn: TurnState
        try {
          conversation =
            await this.#ensureConversationHydrated(parsedConversationId)
          turn = this.#requireTurn(conversation, turnId)
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
          if (turn.providerTurnId === undefined) {
            throw new HostServiceError(
              'conflict',
              'Turn has no active Provider identity',
              409,
            )
          }
          turn.interrupting = true
        } finally {
          releaseRuntimePin()
        }
        this.#touchConversation(conversation.record.conversationId)
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
        this.#touchConversation(approval.conversationId)
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
    if (this.#closePromise === undefined) {
      // Stop new action admission synchronously, but keep the Runtime usable
      // until every action already admitted has reached its durable boundary.
      this.#acceptingActions = false
      this.#closePromise = this.#close()
    }
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
      ...(turn.record.input === undefined ? {} : { input: turn.record.input }),
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
      status:
        status === 'failed'
          ? 'failed'
          : status === 'interrupted'
            ? 'idle'
            : 'completed',
      updatedAt: completedAt,
      lastActivityAt: completedAt,
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
    const parsed = HostEventSchema.parse(event)
    if (parsed.type === 'stream.reset') {
      throw new Error('stream.reset cannot enter runtime history')
    }
    this.#touchConversation(parsed.conversationId)
    const nextSeq = this.publisher.currentSeq + 1
    const preview = HostEventEnvelopeSchema.parse({
      ...parsed,
      protocolVersion,
      epoch: this.publisher.epoch,
      seq: nextSeq,
      eventId: formatLastEventId({
        epoch: this.publisher.epoch,
        seq: nextSeq,
      }),
    })
    if (preview.type === 'stream.reset') {
      throw new Error('stream.reset cannot enter runtime history')
    }
    const previousRuntime = this.#runtimeHistory.snapshotFor(
      parsed.conversationId,
    )
    const eviction = this.#runtimeHistory.apply(preview)
    let attention: AttentionTransition | undefined
    try {
      attention = this.#recordDurableEvent(parsed)
    } catch (error) {
      if (previousRuntime === undefined) {
        this.#runtimeHistory.delete(parsed.conversationId)
      } else {
        this.#runtimeHistory.restore(previousRuntime)
      }
      this.#publishDurabilityFailureForTerminal(parsed)
      throw error
    }
    this.#pruneEvictedRuntimeIdentity(eviction)
    const envelope = this.publisher.publish(parsed)
    if (envelope.eventId !== preview.eventId) {
      throw new Error('Host event sequence changed during durable publication')
    }
    if (attention !== undefined) this.#publishAttention(attention)
    if (eviction.snapshotRequired) {
      this.publisher.publishSnapshotBoundary(event.timestamp)
    }
  }

  #publishAttention(transition: AttentionTransition): void {
    const attention = transition.attention
    this.publisher.publish(
      HostEventSchema.parse({
        conversationId: attention.conversationId,
        ...(attention.turnId === undefined ? {} : { turnId: attention.turnId }),
        timestamp: attention.updatedAt,
        type: transition.type,
        payload: { attention },
      }),
    )
  }

  #publishDurabilityFailureForTerminal(
    event: Exclude<HostEvent, { type: 'stream.reset' }>,
  ): void {
    if (
      event.type !== 'turn.completed' &&
      event.type !== 'turn.failed' &&
      event.type !== 'turn.interrupted'
    ) {
      return
    }
    const conversation = this.#conversations.get(event.conversationId)
    const turn = conversation?.turns.get(event.turnId)
    if (conversation === undefined || turn === undefined) return
    const error = {
      code: 'runtime_unavailable' as const,
      message: 'Conversation durability became unavailable',
    }
    const completedAt = this.#timestamp()
    turn.record = {
      turnId: turn.record.turnId,
      conversationId: turn.record.conversationId,
      status: 'failed',
      ...(turn.record.input === undefined ? {} : { input: turn.record.input }),
      startedAt: turn.record.startedAt,
      completedAt,
      error,
    }
    const failedConversation: ConversationRecord = {
      ...conversation.record,
      status: 'failed',
      updatedAt: completedAt,
      lastActivityAt: completedAt,
    }
    Reflect.deleteProperty(failedConversation, 'activeTurnId')
    conversation.record = failedConversation
    this.#publish({
      conversationId: event.conversationId,
      turnId: event.turnId,
      timestamp: completedAt,
      type: 'turn.failed',
      payload: { error },
    })
  }

  #pruneEvictedRuntimeIdentity(
    eviction: ReturnType<ConversationRuntimeHistory['apply']>,
  ): void {
    const conversation = this.#conversations.get(eviction.conversationId)
    if (conversation === undefined) return

    for (const turnId of eviction.turnIds) {
      const turn = conversation.turns.get(turnId)
      if (turn === undefined || turn.record.status === 'running') continue
      conversation.turns.delete(turnId)
      if (turn.providerTurnId !== undefined) {
        conversation.providerTurnIds.delete(turn.providerTurnId)
      }
    }

    for (const [turnId, turn] of conversation.turns) {
      const retained = this.#runtimeHistory.retainedTurnRecord(
        eviction.conversationId,
        turnId,
      )
      if (retained !== undefined) turn.record = retained
    }

    const pendingItems = new Set(
      this.#approvalRegistry
        .pendingRecords()
        .filter(
          (approval) => approval.conversationId === eviction.conversationId,
        )
        .flatMap((approval) =>
          approval.itemId === undefined ? [] : [approval.itemId],
        ),
    )
    for (const [turnId, turn] of conversation.turns) {
      // Provider Item identity is Turn-scoped protocol state, not presentation
      // history. Releasing it while the Turn is active would reassign a new
      // public ItemId if the Provider emits another lifecycle event. Once the
      // Turn is terminal, sweep every binding that is no longer represented by
      // retained history or a still-pending Approval.
      if (turn.record.status === 'running') continue
      const retainedItems = this.#runtimeHistory.retainedItemIds(
        eviction.conversationId,
        turnId,
      )
      for (const [providerItemId, publicId] of turn.providerItems) {
        if (!retainedItems.has(publicId) && !pendingItems.has(publicId)) {
          turn.providerItems.delete(providerItemId)
        }
      }
    }
  }

  #restoreDurableState(): void {
    if (this.#persistence === undefined) return
    const restored = restoreDurableConversations(this.#persistence, {
      maxConversations: this.#maxConversations,
      maxTurns: this.#runtimeHistory.maxTurns,
      maxEntries: this.#runtimeHistory.maxEntries,
      now: TimestampSchema.parse(this.#timestamp()),
    })
    let restoredPresentationOrder = 0
    for (const durable of restored) {
      const runtime = this.#installRestoredConversation(durable)
      for (const entry of [
        ...runtime.messages,
        ...runtime.tools,
        ...runtime.changes,
      ]) {
        restoredPresentationOrder = Math.max(
          restoredPresentationOrder,
          entry.order,
        )
      }
    }
    for (const durable of [...restored].reverse()) {
      this.#touchConversation(durable.record.conversationId)
    }
    const restoredIds = new Set(
      restored.map((durable) => durable.record.conversationId),
    )
    const hasColdProviderConversation = this.#persistence
      .listConversations()
      .some(
        (conversation) =>
          conversation.status !== 'creating' &&
          conversation.providerThreadId !== undefined &&
          !restoredIds.has(conversation.conversationId),
      )
    this.publisher.initializeSequence(
      hasColdProviderConversation
        ? Math.max(restoredPresentationOrder, this.#runtimeHistory.maxEntries)
        : restoredPresentationOrder,
    )
  }

  #installRestoredConversation(
    durable: RestoredDurableConversation,
  ): ConversationRuntimeSnapshot {
    const providerOwner = this.#providerThreads.get(durable.providerThreadId)
    if (
      providerOwner !== undefined &&
      providerOwner !== durable.record.conversationId
    ) {
      throw new Error('Durable Provider Conversation identity is not unique')
    }
    this.#runtimeHistory.restore(durable.runtime)
    const runtime = this.#runtimeHistory.snapshotFor(
      durable.record.conversationId,
    )
    if (runtime === undefined) {
      throw new Error('Restored Conversation runtime was not retained')
    }
    const providerTurns = new Map(
      durable.providerTurns.map((turn) => [turn.turnId, turn.providerTurnId]),
    )
    const turns = new Map<TurnId, TurnState>()
    const providerTurnIds = new Map<string, TurnId>()
    for (const record of runtime.turns) {
      const providerTurnId = providerTurns.get(record.turnId)
      turns.set(record.turnId, {
        record,
        ...(providerTurnId === undefined ? {} : { providerTurnId }),
        providerItems: new Map(),
        interrupting: false,
      })
      if (providerTurnId !== undefined) {
        providerTurnIds.set(providerTurnId, record.turnId)
      }
    }
    const state: ConversationState = {
      record: durable.record,
      providerThreadId: durable.providerThreadId,
      turns,
      providerTurnIds,
      providerSession: 'needs-resume',
      startingTurn: false,
    }
    this.#conversations.set(durable.record.conversationId, state)
    this.#providerThreads.set(
      durable.providerThreadId,
      durable.record.conversationId,
    )
    return runtime
  }

  async #ensureConversationHydrated(
    conversationId: ConversationId,
  ): Promise<ConversationState> {
    const existing = this.#conversations.get(conversationId)
    if (existing !== undefined) return existing

    const pending = this.#hydrations.get(conversationId)
    if (pending !== undefined) return await pending

    const hydration = this.#hydrateConversation(conversationId)
    this.#hydrations.set(conversationId, hydration)
    try {
      return await hydration
    } finally {
      if (this.#hydrations.get(conversationId) === hydration) {
        this.#hydrations.delete(conversationId)
      }
    }
  }

  async #hydrateConversation(
    conversationId: ConversationId,
  ): Promise<ConversationState> {
    if (this.#persistence === undefined) {
      throw new HostServiceError('not_found', 'Conversation was not found', 404)
    }
    const durableConversation =
      this.#persistence.getConversation(conversationId)
    if (
      durableConversation === undefined ||
      durableConversation.status === 'creating'
    ) {
      throw new HostServiceError('not_found', 'Conversation was not found', 404)
    }
    if (durableConversation.providerThreadId === undefined) {
      throw providerConversationUnavailableError()
    }
    const durable = readDurableConversationDetail(
      this.#persistence,
      conversationId,
      {
        maxTurns: this.#runtimeHistory.maxTurns,
        maxEntries: this.#runtimeHistory.maxEntries,
      },
    )
    if (durable === undefined) {
      throw new HostServiceError('not_found', 'Conversation was not found', 404)
    }
    const releaseRuntimeSlot = this.#reserveRuntimeSlot(conversationId)
    try {
      const alreadyHydrated = this.#conversations.get(conversationId)
      if (alreadyHydrated !== undefined) return alreadyHydrated
      const providerOwner = this.#providerThreads.get(
        durableConversation.providerThreadId,
      )
      if (providerOwner !== undefined && providerOwner !== conversationId) {
        throw new HostServiceError(
          'provider_error',
          'Durable Provider Conversation identity is not unique',
          500,
        )
      }
      this.#installRestoredConversation({
        record: durable.record,
        providerThreadId: durableConversation.providerThreadId,
        runtime: durable.runtime,
        providerTurns: this.#persistence
          .listRecentTurns(conversationId, this.#runtimeHistory.maxTurns)
          .flatMap((turn) =>
            turn.providerTurnId === undefined
              ? []
              : [
                  {
                    turnId: turn.turnId,
                    providerTurnId: turn.providerTurnId,
                  },
                ],
          ),
        expiredApprovals: durable.approvals.filter(
          (approval) => approval.lifecycle === 'expired',
        ).length,
      })
      const hydrated = this.#conversations.get(conversationId)
      if (hydrated === undefined) {
        throw new Error('Hydrated Conversation runtime was not retained')
      }
      this.#touchConversation(conversationId)
      return hydrated
    } finally {
      releaseRuntimeSlot()
    }
  }

  #reserveRuntimeSlot(protectedConversationId?: ConversationId): () => void {
    while (
      this.#conversations.size + this.#runtimeReservations >=
      this.#maxConversations
    ) {
      if (this.#persistence === undefined) {
        throw new HostServiceError(
          'runtime_unavailable',
          'Host Conversation capacity is temporarily exhausted',
          503,
          { maxConversations: this.#maxConversations },
        )
      }
      const candidate = this.#runtimeEvictionCandidate(protectedConversationId)
      if (candidate === undefined) {
        throw new HostServiceError(
          'runtime_unavailable',
          'Host Conversation working set is temporarily exhausted',
          503,
          { maxConversations: this.#maxConversations },
        )
      }
      this.#evictRuntimeConversation(candidate)
    }

    this.#runtimeReservations += 1
    let released = false
    return () => {
      if (released) return
      released = true
      this.#runtimeReservations -= 1
    }
  }

  #runtimeEvictionCandidate(
    protectedConversationId?: ConversationId,
  ): ConversationId | undefined {
    let candidate: ConversationId | undefined
    let oldestAccess = Number.POSITIVE_INFINITY
    for (const [conversationId, conversation] of this.#conversations) {
      if (
        conversationId === protectedConversationId ||
        this.#hydrations.has(conversationId) ||
        (this.#runtimePins.get(conversationId) ?? 0) > 0 ||
        !this.#canEvictRuntimeConversation(conversationId, conversation)
      ) {
        continue
      }
      const access = this.#runtimeAccess.get(conversationId) ?? 0
      if (access < oldestAccess) {
        candidate = conversationId
        oldestAccess = access
      }
    }
    return candidate
  }

  #canEvictRuntimeConversation(
    conversationId: ConversationId,
    conversation: ConversationState,
  ): boolean {
    if (
      conversation.startingTurn ||
      (this.#runtimePins.get(conversationId) ?? 0) > 0 ||
      conversation.record.activeTurnId !== undefined ||
      conversation.record.status === 'running' ||
      conversation.record.status === 'waiting' ||
      this.#approvalRegistry.hasPendingForConversation(conversationId)
    ) {
      return false
    }
    if ([...conversation.turns.values()].some((turn) => turn.interrupting)) {
      return false
    }
    return ![...this.#dirtyTurns.values()].includes(conversationId)
  }

  #evictRuntimeConversation(conversationId: ConversationId): void {
    const conversation = this.#conversations.get(conversationId)
    if (conversation === undefined) return
    if (!this.#canEvictRuntimeConversation(conversationId, conversation)) {
      throw new Error('Attempted to evict a protected Conversation runtime')
    }
    this.#conversations.delete(conversationId)
    if (
      this.#providerThreads.get(conversation.providerThreadId) ===
      conversationId
    ) {
      this.#providerThreads.delete(conversation.providerThreadId)
    }
    this.#runtimeHistory.delete(conversationId)
    this.#runtimeAccess.delete(conversationId)
  }

  #touchConversation(conversationId: ConversationId): void {
    if (!this.#conversations.has(conversationId)) return
    this.#runtimeAccessSequence += 1
    this.#runtimeAccess.set(conversationId, this.#runtimeAccessSequence)
  }

  #pinRuntimeConversation(conversationId: ConversationId): () => void {
    this.#runtimePins.set(
      conversationId,
      (this.#runtimePins.get(conversationId) ?? 0) + 1,
    )
    let released = false
    return () => {
      if (released) return
      released = true
      const remaining = (this.#runtimePins.get(conversationId) ?? 1) - 1
      if (remaining <= 0) this.#runtimePins.delete(conversationId)
      else this.#runtimePins.set(conversationId, remaining)
    }
  }

  #conversationApprovalHistory(
    durableApprovals: readonly DurableApprovalHistoryRecord[],
    currentApprovals: readonly ApprovalRecord[],
    runtime: ConversationRuntimeSnapshot,
  ): ConversationApprovalHistoryRecord[] {
    const retainedTurns = new Set(runtime.turns.map((turn) => turn.turnId))
    const history = new Map<string, ConversationApprovalHistoryRecord>()
    for (const approval of durableApprovals) {
      if (
        approval.lifecycle === 'pending' ||
        !retainedTurns.has(approval.record.turnId)
      ) {
        continue
      }
      if (approval.lifecycle === 'resolved') {
        history.set(approval.record.approvalId, {
          lifecycle: 'resolved',
          approval: approval.record,
        })
        continue
      }
      if (approval.expiredAt === undefined) {
        throw new Error('Expired durable Approval has no expiration time')
      }
      history.set(approval.record.approvalId, {
        lifecycle: 'expired',
        approval: approval.record,
        expiredAt: approval.expiredAt,
        reason: 'host_restart',
      })
    }
    for (const approval of currentApprovals) {
      if (
        approval.status === 'resolved' &&
        retainedTurns.has(approval.turnId)
      ) {
        history.set(approval.approvalId, {
          lifecycle: 'resolved',
          approval,
        })
      }
    }
    return [...history.values()].sort((left, right) =>
      left.approval.requestedAt.localeCompare(right.approval.requestedAt),
    )
  }

  async #ensureProviderConversation(
    conversation: ConversationState,
    authorizedCwd: string,
  ): Promise<void> {
    if (conversation.providerSession === 'ready') return
    if (conversation.providerSession === 'unavailable') {
      throw providerConversationUnavailableError()
    }
    try {
      const resumed = await this.#runtime.resumeConversation({
        providerThreadId: conversation.providerThreadId,
        cwd: authorizedCwd,
      })
      if (resumed.providerThreadId !== conversation.providerThreadId) {
        throw new ProviderConversationUnavailableError(
          'codex',
          conversation.providerThreadId,
        )
      }
      if (
        resumed.model !== undefined &&
        resumed.model !== conversation.record.model
      ) {
        conversation.record = {
          ...conversation.record,
          model: resumed.model,
          updatedAt: this.#timestamp(),
        }
        this.#writeDurable(() => {
          this.#persistence?.updateConversation(
            this.#durableConversation(conversation),
          )
        })
      }
      conversation.providerSession = 'ready'
    } catch (error) {
      if (error instanceof ProviderConversationUnavailableError) {
        conversation.providerSession = 'unavailable'
        throw providerConversationUnavailableError()
      }
      if (!this.#runtimeAvailable()) throw runtimeUnavailableError()
      throw providerCommandError('resume conversation', error)
    }
  }

  #recordProviderStartFailure(
    conversation: ConversationState,
    record: TurnRecord,
    code: HostErrorCode,
    message: string,
  ): void {
    const state: TurnState = {
      record,
      providerItems: new Map(),
      interrupting: false,
    }
    conversation.turns.set(record.turnId, state)
    conversation.record = {
      ...conversation.record,
      status: 'running',
      activeTurnId: record.turnId,
      updatedAt: record.startedAt,
    }
    this.#publish({
      conversationId: record.conversationId,
      turnId: record.turnId,
      timestamp: record.startedAt,
      type: 'turn.started',
      payload: { turn: record },
    })
    const completedAt = this.#timestamp()
    const error = { code, message }
    this.#completeTurn(conversation, state, 'failed', completedAt, { error })
    this.#publish({
      conversationId: record.conversationId,
      turnId: record.turnId,
      timestamp: completedAt,
      type: 'turn.failed',
      payload: { error },
    })
  }

  #recordDurableEvent(
    event: Exclude<HostEvent, { type: 'stream.reset' }>,
  ): AttentionTransition | undefined {
    if (
      this.#persistence === undefined ||
      this.#persistenceFailure !== undefined ||
      event.turnId === undefined
    ) {
      return undefined
    }
    this.#dirtyTurns.set(event.turnId, event.conversationId)
    if (
      event.type === 'turn.started' ||
      event.type === 'approval.requested' ||
      event.type === 'approval.resolved' ||
      event.type === 'turn.completed' ||
      event.type === 'turn.failed' ||
      event.type === 'turn.interrupted'
    ) {
      const attention = this.#flushDurableTurn(
        event.conversationId,
        event.turnId,
        isAttentionSourceEvent(event) ? event : undefined,
      )
      this.#dirtyTurns.delete(event.turnId)
      return attention
    }
    this.#schedulePersistenceFlush()
    return undefined
  }

  #schedulePersistenceFlush(): void {
    if (
      this.#persistence === undefined ||
      this.#persistenceFailure !== undefined ||
      this.#persistenceTimer !== undefined
    ) {
      return
    }
    this.#persistenceTimer = setTimeout(() => {
      this.#persistenceTimer = undefined
      try {
        this.#flushAllDurableTurns()
      } catch {
        // #writeDurable already transitioned the Host to a failed-safe state.
      }
    }, this.#persistenceFlushMs)
    this.#persistenceTimer.unref?.()
  }

  #flushAllDurableTurns(): void {
    if (this.#persistenceTimer !== undefined) {
      clearTimeout(this.#persistenceTimer)
      this.#persistenceTimer = undefined
    }
    if (
      this.#persistence === undefined ||
      this.#persistenceFailure !== undefined
    ) {
      this.#dirtyTurns.clear()
      return
    }
    const dirty = [...this.#dirtyTurns]
    this.#dirtyTurns.clear()
    for (const [turnId, conversationId] of dirty) {
      this.#flushDurableTurn(conversationId, turnId)
    }
  }

  #flushDurableTurn(
    conversationId: ConversationId,
    turnId: TurnId,
    attentionEvent?: AttentionSourceEvent,
  ): AttentionTransition | undefined {
    const conversation = this.#conversations.get(conversationId)
    const turn = conversation?.turns.get(turnId)
    const runtime = this.#runtimeHistory.snapshotFor(conversationId)
    if (
      conversation === undefined ||
      turn === undefined ||
      runtime === undefined
    ) {
      return undefined
    }
    if (turn.record.input === undefined) {
      throw new Error('A durable Turn requires canonical input')
    }
    const status =
      turn.record.status === 'running'
        ? conversation.record.status === 'waiting'
          ? 'waiting'
          : 'running'
        : turn.record.status
    const durableTurn: DurableTurnSnapshot = {
      turnId,
      conversationId,
      ...(turn.providerTurnId === undefined
        ? {}
        : { providerTurnId: turn.providerTurnId }),
      input: turn.record.input,
      status,
      startedAt: turn.record.startedAt,
      ...(turn.record.completedAt === undefined
        ? {}
        : { completedAt: turn.record.completedAt }),
      snapshotVersion: DURABLE_TURN_SNAPSHOT_VERSION,
      snapshot: captureTurnPresentation(
        runtime,
        turnId,
        this.#approvalRegistry.recordsForTurn(conversationId, turnId),
      ),
    }
    let attention: AttentionTransition | undefined
    this.#writeDurable(() => {
      this.#persistence?.runInTransaction(() => {
        this.#persistence?.updateTurn(durableTurn)
        this.#persistence?.updateConversation(
          this.#durableConversation(conversation),
        )
        if (attentionEvent !== undefined && this.#persistence !== undefined) {
          attention = recordAttention(
            this.#persistence,
            attentionEvent,
            conversation.record,
          )
        }
      })
    })
    return attention
  }

  #durableConversation(conversation: ConversationState): DurableConversation {
    return {
      conversationId: conversation.record.conversationId,
      projectId: ProjectIdSchema.parse(conversation.record.projectId),
      title: conversation.record.title ?? DEFAULT_CONVERSATION_TITLE,
      provider: conversation.record.provider,
      providerThreadId: conversation.providerThreadId,
      cwd: conversation.record.cwd,
      ...(conversation.record.model === undefined
        ? {}
        : { model: conversation.record.model }),
      ...(conversation.record.reasoning === undefined
        ? {}
        : { reasoning: conversation.record.reasoning }),
      status: conversation.record.status,
      createdAt: conversation.record.createdAt,
      updatedAt: conversation.record.updatedAt,
      lastActivityAt:
        conversation.record.lastActivityAt ?? conversation.record.updatedAt,
    }
  }

  async #reserveConversationProject(
    request: CreateConversationRequest,
  ): Promise<ProjectConversationReservation> {
    try {
      return 'projectId' in request
        ? await this.#projects.reserveConversationCreation(request.projectId)
        : await this.#projects.reserveLegacyConversationCreation(request.cwd)
    } catch (error) {
      throw projectServiceError(error)
    }
  }

  #rollbackCreatingConversation(conversationId: ConversationId): void {
    this.#writeDurable(() => {
      this.#persistence?.deleteConversation(conversationId)
    })
  }

  #requireAttentionStore(): ConversationStore {
    if (
      this.#persistence === undefined ||
      this.#persistenceFailure !== undefined
    ) {
      throw new HostServiceError(
        'runtime_unavailable',
        'Durable Attention index is unavailable',
        503,
      )
    }
    return this.#persistence
  }

  #writeDurable(operation: () => void): void {
    if (this.#persistence === undefined) return
    try {
      operation()
    } catch (error) {
      this.#handlePersistenceFailure(toError(error))
      throw runtimeUnavailableError('Conversation durability is unavailable')
    }
  }

  #writeDurableResult<T>(operation: () => T): T {
    let result!: T
    this.#writeDurable(() => {
      result = operation()
    })
    return result
  }

  #handlePersistenceFailure(error: Error): void {
    if (this.#persistenceFailure !== undefined) return
    this.#persistenceFailure = error
    this.#dirtyTurns.clear()
    if (this.#persistenceTimer !== undefined) {
      clearTimeout(this.#persistenceTimer)
      this.#persistenceTimer = undefined
    }
    this.#handleRuntimeFailure(
      new Error('Conversation durability became unavailable', { cause: error }),
    )
    void this.#runtime.close().catch(() => undefined)
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
    requireRuntime = true,
  ): Promise<T> {
    try {
      this.#assertAcceptingActions()
      const task = this.#actions.execute(
        actionId,
        operation,
        input,
        async () => {
          this.#assertAcceptingActions()
          if (requireRuntime) this.#assertRuntimeAvailable()
          return await action()
        },
      )
      this.#inFlightActions.add(task)
      void task
        .finally(() => {
          this.#inFlightActions.delete(task)
        })
        .catch(() => undefined)
      return await task
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
    await Promise.allSettled([...this.#inFlightActions])
    this.#closingRuntime = true
    // A shutdown-only decline releases the live Provider request, but it is
    // not a user decision. Stop consuming Provider resolution callbacks first
    // so the pending durable Approval remains the restart reconciliation
    // authority and becomes host_restart/expired on the next Host open.
    this.#unsubscribeApprovals()
    this.#approvalRegistry.declineAll()
    const failures: unknown[] = []
    try {
      try {
        await this.#runtime.close()
      } catch (error) {
        failures.push(error)
      }
      try {
        this.#flushAllDurableTurns()
      } catch (error) {
        failures.push(error)
      }
      try {
        this.#persistence?.close()
      } catch (error) {
        failures.push(error)
      }
    } finally {
      if (this.#persistenceTimer !== undefined) {
        clearTimeout(this.#persistenceTimer)
        this.#persistenceTimer = undefined
      }
      this.#unsubscribeEvents()
      this.#unsubscribeFailures()
      this.#actions.clear()
      this.#hydrations.clear()
      this.#runtimeAccess.clear()
      this.#runtimePins.clear()
      this.#pendingProviderEvents.length = 0
      this.#pendingProviderEventBytes = 0
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) {
      throw new AggregateError(failures, 'Host service shutdown failed')
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
      message:
        this.#persistenceFailure === undefined
          ? 'Codex runtime became unavailable'
          : 'Conversation durability became unavailable',
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
      this.#runtime.available !== false &&
      this.#runtimeFailure === undefined &&
      this.#persistenceFailure === undefined &&
      !this.#closingRuntime
    )
  }

  #assertRuntimeAvailable(): void {
    if (!this.#runtimeAvailable()) throw runtimeUnavailableError()
  }

  #assertAcceptingActions(): void {
    if (!this.#acceptingActions) {
      throw runtimeUnavailableError('Host is shutting down')
    }
  }
}

function shouldGenerateConversationTitle(
  conversation: ConversationState,
): boolean {
  return (
    conversation.record.title === undefined ||
    (conversation.record.title === DEFAULT_CONVERSATION_TITLE &&
      conversation.turns.size === 0)
  )
}

function isAttentionSourceEvent(
  event: Exclude<HostEvent, { type: 'stream.reset' }>,
): event is AttentionSourceEvent {
  return (
    event.type === 'approval.requested' ||
    event.type === 'approval.resolved' ||
    event.type === 'turn.completed' ||
    event.type === 'turn.failed'
  )
}

function conversationSummary(record: ConversationRecord): ConversationSummary {
  if (
    record.projectId === undefined ||
    record.title === undefined ||
    record.lastActivityAt === undefined
  ) {
    throw new Error('Durable Conversation summary metadata is incomplete')
  }
  return ConversationSummarySchema.parse({
    conversationId: record.conversationId,
    projectId: record.projectId,
    title: record.title,
    provider: record.provider,
    ...(record.model === undefined ? {} : { model: record.model }),
    ...(record.reasoning === undefined ? {} : { reasoning: record.reasoning }),
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastActivityAt: record.lastActivityAt,
  })
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

function positiveInteger(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`)
  }
  return resolved
}

function nonNegativeInteger(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`)
  }
  return resolved
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

function runtimeUnavailableError(
  message = 'Codex runtime is unavailable',
): HostServiceError {
  return new HostServiceError('runtime_unavailable', message, 503)
}

function providerConversationUnavailableError(): HostServiceError {
  return new HostServiceError(
    'provider_conversation_unavailable',
    'The Codex conversation can no longer be resumed',
    409,
  )
}

function projectServiceError(error: unknown): Error {
  if (error instanceof HostServiceError) return error
  if (!(error instanceof ProjectRegistryError)) {
    return error instanceof Error ? error : new Error(String(error))
  }
  switch (error.code) {
    case 'not_found':
      return new HostServiceError('not_found', error.message, 404)
    case 'has_conversations':
      return new HostServiceError(
        'project_has_conversations',
        error.message,
        409,
      )
    case 'unavailable':
      return new HostServiceError('project_unavailable', error.message, 409)
    case 'invalid_path':
      return new HostServiceError('invalid_request', error.message, 422)
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}
