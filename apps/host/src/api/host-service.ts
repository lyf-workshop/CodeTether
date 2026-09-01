import { randomUUID } from 'node:crypto'

import type { AgentEvent, AgentProvider } from '@codetether/agent-core'
import {
  ActionIdSchema,
  ApprovalIdSchema,
  AttentionIdSchema,
  AttentionListResponseSchema,
  ConversationIdSchema,
  ConversationListResponseSchema,
  ConversationRecordSchema,
  ConversationSearchQuerySchema,
  ConversationSearchResponseSchema,
  ConversationSummarySchema,
  EpochIdSchema,
  formatLastEventId,
  GetConversationResponseSchema,
  GetMachineResponseSchema,
  HostEventSchema,
  HostEventEnvelopeSchema,
  ListAttentionQuerySchema,
  ListMachinesResponseSchema,
  ProjectIdSchema,
  MachineIdSchema,
  MachinePairingAttemptIdSchema,
  ListProjectConversationsQuerySchema,
  protocolVersion,
  TimestampSchema,
  TurnIdSchema,
  type BootstrapResponse,
  type ApprovalRecord,
  type AttentionId,
  type AttentionListResponse,
  type ArchiveConversationRequest,
  type ArchiveConversationResponse,
  type BeginRemoteMachinePairingRequest,
  type BeginRemoteMachinePairingResponse,
  type ConversationId,
  type ConversationApprovalHistoryRecord,
  type ConversationListResponse,
  type ConversationRecord,
  type ConversationSearchQuery,
  type ConversationSearchResponse,
  type ConversationRuntimeSnapshot,
  type ConversationSummary,
  type CancelRemoteMachinePairingRequest,
  type CancelRemoteMachinePairingResponse,
  type ConfirmRemoteMachinePairingRequest,
  type ConfirmRemoteMachinePairingResponse,
  type CreateConversationRequest,
  type CreateConversationResponse,
  type HostErrorCode,
  type HostEvent,
  type HostEventEnvelope,
  type HostSnapshot,
  type CreateProjectRequest,
  type CreateProjectResponse,
  type RegisterProjectLocationRequest,
  type RegisterProjectLocationResponse,
  type RemoveProjectLocationRequest,
  type RemoveProjectLocationResponse,
  type DeleteProjectRequest,
  type DeleteProjectResponse,
  type GetProjectResponse,
  type GetMachineResponse,
  type GetConversationResponse,
  type InterruptTurnRequest,
  type InterruptTurnResponse,
  type ListProjectsResponse,
  type ListMachinesResponse,
  type ListAttentionQuery,
  type ListProjectConversationsQuery,
  type MachineSummary,
  type RemoteMachineConnection,
  type MachinePairingAttemptId,
  type PinConversationRequest,
  type PinConversationResponse,
  type ProjectId,
  type MachineId,
  type ProviderDescriptor,
  type RenameConversationRequest,
  type RenameConversationResponse,
  type ResolveApprovalRequest,
  type ResolveApprovalResponse,
  type ResolveAttentionRequest,
  type ResolveAttentionResponse,
  type StartTurnRequest,
  type StartTurnResponse,
  type TurnId,
  type TurnRecord,
  type UnpairMachineRequest,
  type UnpairMachineResponse,
  type RetryMachineConnectionRequest,
  type RetryMachineConnectionResponse,
  type RefreshMachineProvidersRequest,
  type RefreshMachineProvidersResponse,
  type MachineProviderDiscovery,
  type UpdateMachineConnectionAddressRequest,
  type UpdateMachineConnectionAddressResponse,
  type UnarchiveConversationRequest,
  type UnarchiveConversationResponse,
  type UnpinConversationRequest,
  type UnpinConversationResponse,
} from '@codetether/protocol'

import {
  DEFAULT_CONVERSATION_TITLE,
  generateConversationTitle,
} from '../conversation-title.js'
import {
  ConversationStore,
  ConversationOrganizationConflictError,
  ConversationSearchCursorError,
  DURABLE_TURN_SNAPSHOT_VERSION,
  ProjectLocationConflictError,
  ProjectLocationRemovalError,
  RemoteMachineTrustConflictError,
  RemoteMachineProjectLocationConflictError,
  captureTurnPresentation,
  initialTurnPresentation,
  readDurableConversationDetail,
  restoreDurableConversations,
  type DurableApprovalHistoryRecord,
  type DurableConversation,
  type DurableConversationMutationResult,
  type DurableMachine,
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
import { MachineRegistry, MachineRegistryError } from './machine-registry.js'
import { MachineProviderRuntimeResolver } from './machine-provider-runtime-resolver.js'
import {
  ProjectRegistry,
  ProjectRegistryError,
  type ProjectConversationReservation,
} from './project-registry.js'
import { ProviderEventTranslator } from './provider-event-translator.js'
import { ProviderRegistry, providerSessionKey } from './provider-registry.js'
import {
  RemoteClaudeHostRuntime,
  type RemoteClaudeRuntimeSession,
} from './remote-claude-host-runtime.js'
import {
  RemoteCodexHostRuntime,
  type RemoteCodexRuntimeSession,
} from './remote-codex-host-runtime.js'
import {
  RemoteMachineCoordinatorError,
  RemoteMachineRevocationPendingError,
  UnavailableRemoteMachineCoordinator,
  type ConfirmedRemoteMachine,
  type RemoteMachineCoordinator,
} from './remote-machine-coordinator.js'
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
  /** Compatibility input for the original one-Provider Host assembly. */
  readonly runtime?: AgentHostRuntime
  readonly runtimes?: readonly AgentHostRuntime[]
  readonly providerRegistry?: ProviderRegistry
  readonly workspacePolicy: WorkspacePolicy
  readonly publisher: HostEventPublisher
  readonly hostVersion: string
  readonly now?: () => Date
  readonly historyLimits?: ConversationRuntimeHistoryLimits
  readonly maxConversations?: number
  readonly persistence?: ConversationStore
  readonly persistenceFlushMs?: number
  /** True only for the Desktop-owned sidecar assembly. */
  readonly desktopManaged?: boolean
  readonly remoteMachineCoordinator?: RemoteMachineCoordinator
}

/** Runtime authority for live state, optionally backed by durable normalized snapshots. */
export class HostService {
  readonly publisher: HostEventPublisher
  readonly #providers: ProviderRegistry
  readonly #machineRuntimes: MachineProviderRuntimeResolver
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
  readonly #machines: MachineRegistry
  readonly #remoteMachines: RemoteMachineCoordinator
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
  readonly #unsubscribeEvents: Array<() => void> = []
  readonly #unsubscribeApprovals: Array<() => void> = []
  readonly #unsubscribeFailures: Array<() => void> = []
  #unsubscribeRemoteMachineStatus?: () => void
  #unsubscribeRemoteMachineRemoval?: () => void
  #unsubscribeRemoteProviderDiscovery?: () => void
  readonly #runtimeFailures = new Map<AgentProvider, Error>()
  readonly #machineRuntimeFailures = new Map<string, Error>()
  readonly #subscribedRuntimes = new WeakSet<AgentHostRuntime>()
  #closePromise?: Promise<void>
  #acceptingActions = true
  #closingRuntime = false

  constructor(options: HostServiceOptions) {
    const configuredRuntimes =
      options.runtimes ??
      (options.runtime === undefined ? [] : [options.runtime])
    this.#providers =
      options.providerRegistry ?? new ProviderRegistry(configuredRuntimes)
    if (this.#providers.runtimes().length === 0) {
      throw new Error('Host requires at least one Provider runtime')
    }
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
    this.#remoteMachines =
      options.remoteMachineCoordinator ??
      new UnavailableRemoteMachineCoordinator()
    this.#machines = new MachineRegistry({
      ...(this.#persistence === undefined
        ? {}
        : { persistence: this.#persistence }),
      now: () => TimestampSchema.parse(this.#timestamp()),
      capabilities: {
        projectAccess: true,
        providerExecution: true,
        backgroundRuntime: options.desktopManaged === true,
        nativeFolderPicker: options.desktopManaged === true,
        notifications: options.desktopManaged === true,
      },
      remoteStatus: this.#remoteMachines,
    })
    this.#machineRuntimes = new MachineProviderRuntimeResolver({
      localMachineId: this.#machines.localMachineId(),
      localProviders: this.#providers,
      createRemoteProvider: (machineId, provider) => {
        switch (provider) {
          case 'codex':
            return this.#remoteMachines.openCodexSession === undefined
              ? undefined
              : new RemoteCodexHostRuntime({
                  machineId,
                  now: this.#now,
                  opener: {
                    open: async (input) =>
                      await this.#openRemoteCodexSession(input),
                  },
                })
          case 'claude-code':
            return this.#remoteMachines.openClaudeSession === undefined
              ? undefined
              : new RemoteClaudeHostRuntime({
                  machineId,
                  now: this.#now,
                  opener: {
                    open: async (input) =>
                      await this.#openRemoteClaudeSession(input),
                  },
                })
        }
      },
    })
    this.#unsubscribeRemoteMachineStatus =
      this.#remoteMachines.subscribeStatus?.((machineId, connectionState) => {
        try {
          if (connectionState !== 'online') {
            this.#invalidateRemoteProviderSessions(machineId)
          }
          const durable = this.#persistence?.getMachine(machineId)
          const trust = this.#persistence?.getTrustedMachinePeer(machineId)
          if (
            durable === undefined ||
            durable.kind !== 'remote' ||
            trust?.trustState !== 'active'
          ) {
            return
          }
          let machine
          try {
            machine = this.#machines.refresh(durable)
          } catch (error) {
            if (!(error instanceof MachineRegistryError)) throw error
            machine = this.#machines.retainRemote(durable)
          }
          this.#publish({
            conversationId: null,
            timestamp: this.#timestamp(),
            type: 'machine.updated',
            payload: { machine },
          })
        } catch (error) {
          if (!(error instanceof MachineRegistryError)) throw error
        }
      })
    this.#unsubscribeRemoteMachineRemoval =
      this.#remoteMachines.subscribeRemoval?.((machineId) => {
        try {
          this.#machines.removeRemote(machineId)
        } catch (error) {
          if (!(error instanceof MachineRegistryError)) throw error
          return
        }
        this.#publish({
          conversationId: null,
          timestamp: this.#timestamp(),
          type: 'machine.removed',
          payload: { machineId },
        })
      })
    this.#unsubscribeRemoteProviderDiscovery =
      this.#remoteMachines.subscribeProviderDiscovery?.((observation) => {
        try {
          const durable = this.#persistence?.getMachine(observation.machineId)
          if (durable?.kind !== 'remote') return
          const machine = this.#refreshRemoteMachine(durable)
          this.#publish({
            conversationId: null,
            timestamp: this.#timestamp(),
            type: 'machine.updated',
            payload: { machine },
          })
        } catch (error) {
          if (!(error instanceof MachineRegistryError)) throw error
        }
      })
    this.#projects = new ProjectRegistry({
      workspacePolicy: this.#workspacePolicy,
      ...(this.#persistence === undefined
        ? {}
        : { persistence: this.#persistence }),
      now: () => TimestampSchema.parse(this.#timestamp()),
      localMachineId: this.#machines.localMachineId(),
      machineAvailability: (machineId) =>
        this.#machines.get(machineId).availability,
      authorizeRemoteLocation: async (input) =>
        await this.#authorizeRemoteConversationLocation(input),
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
    for (const runtime of this.#providers.runtimes()) {
      this.#subscribeRuntime(runtime, this.#machines.localMachineId())
    }
  }

  bootstrap(): BootstrapResponse {
    const codex = this.#providers.descriptor('codex')
    return {
      protocolVersion,
      hostVersion: this.#hostVersion,
      epoch: this.publisher.epoch,
      capabilities: {
        codex: this.#runtimeAvailable('codex'),
        approvals:
          this.#runtimeAvailable('codex') &&
          codex?.capabilities.approvals === true,
        interrupt:
          this.#runtimeAvailable('codex') &&
          codex?.capabilities.interrupt === true,
        resume:
          this.#persistence !== undefined &&
          this.#runtimeAvailable('codex') &&
          codex?.capabilities.resume === true,
        diff:
          this.#runtimeAvailable('codex') && codex?.capabilities.diff === true,
        streaming: codex?.capabilities.streaming ?? true,
      },
      providers: this.#providerDescriptors(),
    }
  }

  listMachines(): ListMachinesResponse {
    return ListMachinesResponseSchema.parse({
      protocolVersion,
      machines: this.#machines.list(),
    })
  }

  async getMachine(machineId: MachineId): Promise<GetMachineResponse> {
    try {
      const machine = this.#machines.get(MachineIdSchema.parse(machineId))
      const remoteProviderPresentation =
        machine.kind === 'remote'
          ? this.#remoteProviderPresentation(machine)
          : undefined
      const projects = await this.#projects.listForMachine(machine.machineId)
      const conversations =
        this.#persistence === undefined
          ? [...this.#conversations.values()]
              .map((state) => state.record)
              .filter(
                (conversation) =>
                  conversation.machineId === machine.machineId &&
                  conversation.status !== undefined,
              )
              .map(conversationSummary)
              .sort(
                (left, right) =>
                  right.lastActivityAt.localeCompare(left.lastActivityAt) ||
                  left.conversationId.localeCompare(right.conversationId),
              )
              .slice(0, 100)
          : this.#persistence.listMachineConversations(machine.machineId, 100)
      return GetMachineResponseSchema.parse({
        protocolVersion,
        machine,
        providers:
          remoteProviderPresentation?.providers ??
          this.#providerDescriptorsForMachine(machine.machineId),
        projects,
        conversations,
        ...(machine.kind === 'remote'
          ? {
              connection: this.#remoteConnection(machine),
              providerDiscovery:
                remoteProviderPresentation?.providerDiscovery ?? {
                  state: 'not_observed' as const,
                },
            }
          : {}),
      })
    } catch (error) {
      throw machineServiceError(error)
    }
  }

  async beginRemoteMachinePairing(
    request: BeginRemoteMachinePairingRequest,
  ): Promise<BeginRemoteMachinePairingResponse> {
    return await this.#executeAction(
      request.actionId,
      'machine.pairing.begin',
      request,
      async () => {
        this.#requireDurableMachineState()
        try {
          const candidate = await this.#remoteMachines.beginPairing({
            address: request.address,
            pairingCode: request.pairingCode,
          })
          return {
            protocolVersion,
            actionId: request.actionId,
            status: 'accepted',
            data: { candidate },
          }
        } catch (error) {
          throw remoteMachineServiceError(error)
        }
      },
      false,
    )
  }

  async confirmRemoteMachinePairing(
    pairingAttemptId: MachinePairingAttemptId,
    request: ConfirmRemoteMachinePairingRequest,
  ): Promise<ConfirmRemoteMachinePairingResponse> {
    const attemptId = MachinePairingAttemptIdSchema.parse(pairingAttemptId)
    return await this.#executeAction(
      request.actionId,
      `machine.pairing.confirm:${attemptId}`,
      { pairingAttemptId: attemptId, request },
      async () => {
        const persistence = this.#requireDurableMachineState()
        let staged: ConfirmedRemoteMachine | undefined
        try {
          const confirmed = await this.#remoteMachines.confirmPairing(
            attemptId,
            async (candidate) => {
              assertStagedRemoteMachine(candidate)
              try {
                this.#writeDurable(() => {
                  persistence.createRemoteMachineWithTrust(
                    candidate.machine,
                    candidate.trust,
                  )
                })
              } catch (error) {
                if (error instanceof RemoteMachineTrustConflictError) {
                  throw new RemoteMachineCoordinatorError(
                    error.reason === 'capacity'
                      ? 'conflict'
                      : 'identity_mismatch',
                    error.message,
                  )
                }
                throw error
              }
              staged = candidate
            },
          )
          if (staged === undefined) {
            throw new Error(
              'Remote pairing transport confirmed without staging trust',
            )
          }
          assertSameConfirmedRemoteMachine(staged, confirmed)
          const activatedAt = TimestampSchema.parse(this.#timestamp())
          this.#writeDurable(() => {
            persistence.activateTrustedMachinePeer(
              confirmed.machine.machineId,
              activatedAt,
            )
          })
          const durable = persistence.getMachine(confirmed.machine.machineId)
          if (durable === undefined) {
            throw new Error('Paired remote Machine was not retained')
          }
          const machine = this.#machines.retainRemote(durable)
          this.#publish({
            conversationId: null,
            timestamp: this.#timestamp(),
            type: 'machine.updated',
            payload: { machine },
          })
          return {
            protocolVersion,
            actionId: request.actionId,
            status: 'completed',
            data: { machine },
          }
        } catch (error) {
          throw remoteMachineServiceError(error)
        }
      },
      false,
    )
  }

  async cancelRemoteMachinePairing(
    pairingAttemptId: MachinePairingAttemptId,
    request: CancelRemoteMachinePairingRequest,
  ): Promise<CancelRemoteMachinePairingResponse> {
    const attemptId = MachinePairingAttemptIdSchema.parse(pairingAttemptId)
    return await this.#executeAction(
      request.actionId,
      `machine.pairing.cancel:${attemptId}`,
      { pairingAttemptId: attemptId, request },
      async () => {
        try {
          await this.#remoteMachines.cancelPairing(attemptId)
          return {
            protocolVersion,
            actionId: request.actionId,
            status: 'completed',
            data: { pairingAttemptId: attemptId },
          }
        } catch (error) {
          throw remoteMachineServiceError(error)
        }
      },
      false,
    )
  }

  async unpairMachine(
    machineId: MachineId,
    request: UnpairMachineRequest,
  ): Promise<UnpairMachineResponse> {
    const id = MachineIdSchema.parse(machineId)
    return await this.#executeAction(
      request.actionId,
      `machine.unpair:${id}`,
      { machineId: id, request },
      async () => {
        const persistence = this.#requireDurableMachineState()
        const durable = persistence.getMachine(id)
        const persistedTrust = persistence.getTrustedMachinePeer(id)
        if (durable === undefined || persistedTrust === undefined) {
          throw new HostServiceError('not_found', 'Machine was not found', 404)
        }
        if (durable.kind !== 'remote') {
          throw new HostServiceError(
            'conflict',
            'The local Machine cannot be unpaired',
            409,
          )
        }
        const locationCount = persistence.countProjectLocationsForMachine(id)
        if (locationCount > 0) {
          throw new HostServiceError(
            'machine_has_project_locations',
            'Remove this Machine from its registered Projects before unpairing',
            409,
            { locationCount },
          )
        }
        let trust = persistedTrust
        let markedRevoking = false
        if (trust.trustState === 'active') {
          try {
            this.#writeDurable(() => {
              trust = persistence.markTrustedMachinePeerRevoking(
                id,
                TimestampSchema.parse(this.#timestamp()),
              )
            })
          } catch (error) {
            if (error instanceof RemoteMachineProjectLocationConflictError) {
              throw new HostServiceError(
                'machine_has_project_locations',
                'Remove this Machine from its registered Projects before unpairing',
                409,
                { locationCount: error.locationCount },
              )
            }
            throw error
          }
          markedRevoking = true
        }
        try {
          await this.#remoteMachines.unpair(durable, trust)
        } catch (error) {
          if (
            markedRevoking &&
            !(error instanceof RemoteMachineRevocationPendingError)
          ) {
            const restored = this.#writeDurableResult(() =>
              persistence.restoreRevokingTrustedMachinePeer(
                id,
                TimestampSchema.parse(this.#timestamp()),
              ),
            )
            // The coordinator intentionally does not restart a revoking
            // worker. Once this failed unpair restores active trust, resume
            // ordinary bounded recovery without touching any Provider.
            if (typeof this.#remoteMachines.retry === 'function') {
              void this.#remoteMachines.retry(durable, restored).catch(() => {})
            }
          }
          throw remoteMachineServiceError(error)
        }
        this.#writeDurable(() => {
          if (!persistence.deleteRemoteMachine(id)) {
            throw new Error('Remote Machine disappeared during unpair')
          }
        })
        this.#machines.removeRemote(id)
        this.#publish({
          conversationId: null,
          timestamp: this.#timestamp(),
          type: 'machine.removed',
          payload: { machineId: id },
        })
        return {
          protocolVersion,
          actionId: request.actionId,
          status: 'completed',
          data: { machineId: id },
        }
      },
      false,
    )
  }

  async retryMachineConnection(
    machineId: MachineId,
    request: RetryMachineConnectionRequest,
  ): Promise<RetryMachineConnectionResponse> {
    const id = MachineIdSchema.parse(machineId)
    return await this.#executeAction(
      request.actionId,
      `machine.connection.retry:${id}`,
      { machineId: id, request },
      async () => {
        const { durable, trust } = this.#requireRemoteMachineTrust(id)
        try {
          await this.#remoteMachines.retry(durable, trust)
          const machine = this.#refreshRemoteMachine(durable)
          return {
            protocolVersion,
            actionId: request.actionId,
            status: 'accepted',
            data: {
              machine,
              connection: this.#remoteConnection(machine),
            },
          }
        } catch (error) {
          throw remoteMachineServiceError(error)
        }
      },
      false,
    )
  }

  async refreshMachineProviders(
    machineId: MachineId,
    request: RefreshMachineProvidersRequest,
  ): Promise<RefreshMachineProvidersResponse> {
    const id = MachineIdSchema.parse(machineId)
    return await this.#executeAction(
      request.actionId,
      `machine.providers.refresh:${id}`,
      { machineId: id, request },
      async () => {
        const machine = this.#machines.get(id)
        if (machine.kind !== 'remote') {
          throw new HostServiceError(
            'unsupported',
            'Local Provider discovery is managed by the local Host',
            409,
          )
        }
        if (machine.connectionState !== 'online') {
          throw new HostServiceError(
            'machine_unreachable',
            'Remote Machine must be online to detect Providers',
            503,
          )
        }
        const { durable, trust } = this.#requireRemoteMachineTrust(id)
        const discover = this.#remoteMachines.discoverProviders
        if (discover === undefined) {
          throw new HostServiceError(
            'machine_connection_failed',
            'Remote Provider discovery is unavailable',
            503,
          )
        }
        try {
          const observation = await discover.call(
            this.#remoteMachines,
            durable,
            trust,
          )
          return {
            protocolVersion,
            actionId: request.actionId,
            status: 'completed',
            data: {
              machineId: id,
              providers: [...observation.providers],
              providerDiscovery: {
                state: 'current',
                observedAt: observation.observedAt,
              },
            },
          }
        } catch (error) {
          throw remoteMachineServiceError(error)
        }
      },
      false,
    )
  }

  async updateMachineConnectionAddress(
    machineId: MachineId,
    request: UpdateMachineConnectionAddressRequest,
  ): Promise<UpdateMachineConnectionAddressResponse> {
    const id = MachineIdSchema.parse(machineId)
    return await this.#executeAction(
      request.actionId,
      `machine.connection.address:${id}`,
      { machineId: id, request },
      async () => {
        const { durable, trust } = this.#requireRemoteMachineTrust(id)
        try {
          await this.#remoteMachines.updateAddress(
            durable,
            trust,
            request.address,
          )
          const refreshed = this.#requireDurableMachineState().getMachine(id)
          if (refreshed === undefined) {
            throw new Error('Remote Machine disappeared during address update')
          }
          const machine = this.#refreshRemoteMachine(refreshed)
          return {
            protocolVersion,
            actionId: request.actionId,
            status: 'completed',
            data: {
              machine,
              connection: this.#remoteConnection(machine),
            },
          }
        } catch (error) {
          throw remoteMachineServiceError(error)
        }
      },
      false,
    )
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

  async registerProjectLocation(
    projectId: ProjectId,
    request: RegisterProjectLocationRequest,
  ): Promise<RegisterProjectLocationResponse> {
    const id = ProjectIdSchema.parse(projectId)
    return await this.#executeAction(
      request.actionId,
      `project.location.register:${id}:${request.machineId}`,
      { projectId: id, request },
      async () => {
        try {
          this.#projects.require(id)
        } catch (error) {
          throw projectServiceError(error)
        }
        const { durable, trust } = this.#requireRemoteMachineTrust(
          request.machineId,
        )
        let machine: MachineSummary
        try {
          machine = this.#machines.requireAvailable(request.machineId)
        } catch (error) {
          throw machineServiceError(error)
        }
        if (machine.kind !== 'remote' || machine.connectionState !== 'online') {
          throw new HostServiceError(
            'machine_unreachable',
            'Remote Machine must be online to register a Project Location',
            503,
          )
        }
        const validate = this.#remoteMachines.validateProjectLocation
        if (validate === undefined) {
          throw new HostServiceError(
            'machine_connection_failed',
            'Remote Project Location validation is unavailable',
            503,
          )
        }
        try {
          const validated = await validate.call(
            this.#remoteMachines,
            durable,
            trust,
            request.path,
          )
          const result = await this.#projects.registerRemoteLocation(
            id,
            request.machineId,
            validated.canonicalPath,
          )
          const location = result.project.locations.find(
            (candidate) => candidate.machineId === request.machineId,
          )
          if (location === undefined) {
            throw new Error(
              'Registered Project Location is absent from Project truth',
            )
          }
          return {
            protocolVersion,
            actionId: request.actionId,
            status: 'completed',
            data: {
              project: result.project,
              location,
              created: result.created,
            },
          }
        } catch (error) {
          if (error instanceof ProjectRegistryError) {
            throw projectServiceError(error)
          }
          throw remoteMachineServiceError(error)
        }
      },
      false,
    )
  }

  async removeProjectLocation(
    projectId: ProjectId,
    machineId: MachineId,
    request: RemoveProjectLocationRequest,
  ): Promise<RemoveProjectLocationResponse> {
    const project = ProjectIdSchema.parse(projectId)
    const machine = MachineIdSchema.parse(machineId)
    return await this.#executeAction(
      request.actionId,
      `project.location.remove:${project}:${machine}`,
      { projectId: project, machineId: machine, request },
      async () => {
        try {
          const updated = await this.#projects.removeLocation(project, machine)
          return {
            protocolVersion,
            actionId: request.actionId,
            status: 'completed',
            data: { project: updated, machineId: machine },
          }
        } catch (error) {
          throw projectServiceError(error)
        }
      },
      false,
    )
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
      conversations: this.#persistence.listProjectConversations(id, {
        ...options,
        archived: archiveFilterForStore(options.archived),
      }),
    })
  }

  async searchProjectConversations(
    projectId: ProjectId,
    query: ConversationSearchQuery,
  ): Promise<ConversationSearchResponse> {
    if (this.#persistence === undefined) {
      throw new HostServiceError(
        'runtime_unavailable',
        'Durable Conversation search is unavailable',
        503,
      )
    }
    const id = ProjectIdSchema.parse(projectId)
    const options = ConversationSearchQuerySchema.parse(query)
    try {
      await this.#projects.get(id)
    } catch (error) {
      throw projectServiceError(error)
    }

    try {
      return ConversationSearchResponseSchema.parse({
        protocolVersion,
        ...this.#persistence.searchProjectConversations(id, {
          query: options.q,
          archive: options.archive,
          ...(options.provider === undefined
            ? {}
            : { provider: options.provider }),
          ...(options.status === undefined ? {} : { status: options.status }),
          limit: options.limit,
          ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
        }),
      })
    } catch (error) {
      if (error instanceof ConversationSearchCursorError) {
        throw new HostServiceError(
          'invalid_request',
          'Conversation search cursor is invalid',
          400,
        )
      }
      throw error
    }
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

  async renameConversation(
    conversationId: ConversationId,
    request: RenameConversationRequest,
  ): Promise<RenameConversationResponse> {
    const id = ConversationIdSchema.parse(conversationId)
    return await this.#executeAction(
      request.actionId,
      `conversation.rename:${id}`,
      { conversationId: id, request },
      async () =>
        this.#organizationMutationResponse(
          id,
          request.actionId,
          (store, timestamp) =>
            store.renameConversation(id, request.title, timestamp),
        ),
      false,
    )
  }

  async pinConversation(
    conversationId: ConversationId,
    request: PinConversationRequest,
  ): Promise<PinConversationResponse> {
    const id = ConversationIdSchema.parse(conversationId)
    return await this.#executeAction(
      request.actionId,
      `conversation.pin:${id}`,
      { conversationId: id, request },
      async () =>
        this.#organizationMutationResponse(
          id,
          request.actionId,
          (store, timestamp) => store.pinConversation(id, timestamp),
        ),
      false,
    )
  }

  async unpinConversation(
    conversationId: ConversationId,
    request: UnpinConversationRequest,
  ): Promise<UnpinConversationResponse> {
    const id = ConversationIdSchema.parse(conversationId)
    return await this.#executeAction(
      request.actionId,
      `conversation.unpin:${id}`,
      { conversationId: id, request },
      async () =>
        this.#organizationMutationResponse(
          id,
          request.actionId,
          (store, timestamp) => store.unpinConversation(id, timestamp),
        ),
      false,
    )
  }

  async archiveConversation(
    conversationId: ConversationId,
    request: ArchiveConversationRequest,
  ): Promise<ArchiveConversationResponse> {
    const id = ConversationIdSchema.parse(conversationId)
    return await this.#executeAction(
      request.actionId,
      `conversation.archive:${id}`,
      { conversationId: id, request },
      async () => {
        const runtime = this.#conversations.get(id)
        if (
          runtime?.startingTurn === true ||
          runtime?.record.activeTurnId !== undefined ||
          runtime?.record.status === 'running' ||
          runtime?.record.status === 'waiting' ||
          this.#approvalRegistry.hasPendingForConversation(id)
        ) {
          throw activeConversationArchiveError()
        }
        return this.#organizationMutationResponse(
          id,
          request.actionId,
          (store, timestamp) => store.archiveConversation(id, timestamp),
        )
      },
      false,
    )
  }

  async unarchiveConversation(
    conversationId: ConversationId,
    request: UnarchiveConversationRequest,
  ): Promise<UnarchiveConversationResponse> {
    const id = ConversationIdSchema.parse(conversationId)
    return await this.#executeAction(
      request.actionId,
      `conversation.unarchive:${id}`,
      { conversationId: id, request },
      async () =>
        this.#organizationMutationResponse(
          id,
          request.actionId,
          (store, timestamp) => store.unarchiveConversation(id, timestamp),
        ),
      false,
    )
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
        let machine: MachineSummary
        try {
          machine = this.#machines.requireAvailable(request.machineId)
        } catch (error) {
          throw machineServiceError(error)
        }
        const machineProvider = this.#providerDescriptorsForMachine(
          machine.machineId,
        ).find((descriptor) => descriptor.provider === request.provider)
        if (
          machineProvider === undefined ||
          machineProvider.availability !== 'available'
        ) {
          throw providerUnavailableError(request.provider, machineProvider)
        }
        const runtime = this.#requireMachineProviderRuntime(
          machine.machineId,
          request.provider,
        )
        assertProviderConfiguration(
          machineProvider,
          request.model,
          request.reasoning,
        )
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
              machineId: machine.machineId,
              title: DEFAULT_CONVERSATION_TITLE,
              titleSource: 'generated',
              provider: request.provider,
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

            if (machine.kind === 'remote') {
              const record = ConversationRecordSchema.parse({
                conversationId,
                projectId,
                machineId: machine.machineId,
                title: DEFAULT_CONVERSATION_TITLE,
                titleSource: 'generated',
                provider: request.provider,
                cwd,
                ...(request.model === undefined
                  ? {}
                  : { model: request.model }),
                ...(request.reasoning === undefined
                  ? {}
                  : { reasoning: request.reasoning }),
                status: 'idle',
                createdAt: timestamp,
                updatedAt: timestamp,
                lastActivityAt: timestamp,
              })
              const state: ConversationState = {
                record,
                turns: new Map(),
                providerTurnIds: new Map(),
                providerSessionMaterialized: false,
                providerSession: 'uninitialized',
                startingTurn: false,
              }
              this.#writeDurable(() => {
                this.#persistence?.updateConversation(
                  this.#durableConversation(state),
                )
              })
              this.#conversations.set(conversationId, state)
              this.#publish({
                conversationId,
                timestamp,
                type: 'conversation.started',
                payload: { conversation: record },
              })
              this.#touchConversation(conversationId)
              return {
                protocolVersion,
                actionId: request.actionId,
                status: 'completed',
                data: { conversation: record },
              }
            }

            let provider:
              | Awaited<ReturnType<AgentHostRuntime['startConversation']>>
              | undefined
            try {
              provider = await runtime.startConversation({
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
              if (
                !this.#machineRuntimeAvailable(
                  machine.machineId,
                  request.provider,
                )
              ) {
                throw providerUnavailableError(request.provider)
              }
              throw providerCommandError(
                request.provider,
                'create conversation',
                error,
              )
            }
            this.#assertMachineRuntimeAvailable(
              machine.machineId,
              request.provider,
            )

            const sessionKey = providerSessionKey(
              request.provider,
              provider.providerThreadId,
            )
            if (
              provider.providerThreadId.trim().length === 0 ||
              this.#providerThreads.has(sessionKey) ||
              this.#persistence
                ?.listConversations()
                .some(
                  (conversation) =>
                    conversation.provider === request.provider &&
                    conversation.providerThreadId === provider.providerThreadId,
                ) === true
            ) {
              this.#rollbackCreatingConversation(conversationId)
              throw new HostServiceError(
                'provider_error',
                `${providerDisplayName(request.provider)} returned an invalid or reused Session identity`,
                500,
              )
            }

            let record
            try {
              record = ConversationRecordSchema.parse({
                conversationId,
                projectId,
                machineId: machine.machineId,
                title: DEFAULT_CONVERSATION_TITLE,
                titleSource: 'generated',
                provider: request.provider,
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
                request.provider,
                'return valid conversation metadata',
                error,
              )
            }
            const state: ConversationState = {
              record,
              providerThreadId: provider.providerThreadId,
              turns: new Map(),
              providerTurnIds: new Map(),
              providerSessionMaterialized: false,
              providerSession: 'ready',
              startingTurn: false,
            }
            this.#writeDurable(() => {
              this.#persistence?.updateConversation(
                this.#durableConversation(state),
              )
            })
            this.#conversations.set(conversationId, state)
            this.#providerThreads.set(sessionKey, conversationId)
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
      false,
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
        const runtimeConversation =
          this.#conversations.get(parsedConversationId)?.record
        const durableConversation =
          runtimeConversation === undefined
            ? this.#persistence?.getConversation(parsedConversationId)
            : undefined
        if (
          (durableConversation === undefined &&
            runtimeConversation === undefined) ||
          durableConversation?.status === 'creating'
        ) {
          throw new HostServiceError(
            'not_found',
            'Conversation was not found',
            404,
          )
        }
        if (
          durableConversation?.archivedAt !== undefined ||
          runtimeConversation?.archivedAt !== undefined
        ) {
          throw archivedConversationControlError()
        }
        const conversationProvider =
          durableConversation?.provider ?? runtimeConversation?.provider
        const conversationMachineId =
          durableConversation?.machineId ?? runtimeConversation?.machineId
        if (conversationProvider === undefined) {
          throw new HostServiceError(
            'not_found',
            'Conversation was not found',
            404,
          )
        }
        if (conversationMachineId === undefined) {
          throw new HostServiceError(
            'runtime_unavailable',
            'Conversation has no durable Machine identity',
            503,
          )
        }
        try {
          this.#machines.requireAvailable(conversationMachineId)
        } catch (error) {
          throw machineServiceError(error)
        }
        this.#assertMachineRuntimeAvailable(
          conversationMachineId,
          conversationProvider,
        )
        assertProviderConfiguration(
          this.#providerDescriptorsForMachine(conversationMachineId).find(
            (descriptor) => descriptor.provider === conversationProvider,
          ),
          durableConversation?.model ?? runtimeConversation?.model,
          durableConversation?.reasoning ?? runtimeConversation?.reasoning,
        )
        const releaseRuntimePin =
          this.#pinRuntimeConversation(parsedConversationId)
        let conversation: ConversationState
        try {
          conversation =
            await this.#ensureConversationHydrated(parsedConversationId)
          if (conversation.record.archivedAt !== undefined) {
            throw archivedConversationControlError()
          }
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
        let runtime: AgentHostRuntime
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
              conversation.record.machineId,
              conversation.record.cwd,
            )
          ).cwd
          runtime = this.#requireMachineProviderRuntime(
            conversation.record.machineId,
            conversation.record.provider,
          )
          await this.#ensureProviderConversation(
            conversation,
            authorizedCwd,
            runtime,
          )
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
            ? {
                title: generateConversationTitle(request.input.text),
                titleSource: 'generated' as const,
              }
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
          provider = await runtime.startTurn({
            providerThreadId: requireProviderThreadId(conversation),
            cwd: authorizedCwd,
            input: request.input.text,
            ...(conversation.record.machineId ===
            this.#machines.localMachineId()
              ? {}
              : {
                  conversationId: conversation.record.conversationId,
                  projectId: ProjectIdSchema.parse(
                    conversation.record.projectId,
                  ),
                  machineId: MachineIdSchema.parse(
                    conversation.record.machineId,
                  ),
                  actionId: request.actionId,
                  turnId,
                }),
            ...(conversation.record.model === undefined
              ? {}
              : { model: conversation.record.model }),
            ...(conversation.record.reasoning === undefined
              ? {}
              : { reasoning: conversation.record.reasoning }),
          })
        } catch (error) {
          startError = error
        }
        if (startError !== undefined) {
          conversation.startingTurn = false
          if (
            conversation.record.machineId !== this.#machines.localMachineId()
          ) {
            this.#invalidateRemoteProviderSession(conversation)
          }
          const unavailable = !this.#machineRuntimeAvailable(
            conversation.record.machineId,
            conversation.record.provider,
          )
          this.#recordProviderStartFailure(
            conversation,
            record,
            unavailable ? 'runtime_unavailable' : 'provider_error',
            unavailable
              ? `${providerDisplayName(conversation.record.provider)} is unavailable`
              : `${providerDisplayName(conversation.record.provider)} failed to start Turn`,
          )
          this.#flushProviderEvents()
          if (unavailable) {
            throw providerUnavailableError(conversation.record.provider)
          }
          throw providerCommandError(
            conversation.record.provider,
            'start turn',
            startError,
          )
        }
        if (conversation.record.machineId === this.#machines.localMachineId()) {
          this.#assertMachineRuntimeAvailable(
            conversation.record.machineId,
            conversation.record.provider,
          )
        }

        if (
          provider === undefined ||
          provider.providerTurnId.trim().length === 0 ||
          conversation.providerTurnIds.has(provider.providerTurnId)
        ) {
          conversation.startingTurn = false
          this.#recordProviderStartFailure(
            conversation,
            record,
            'provider_error',
            `${providerDisplayName(conversation.record.provider)} returned an invalid Turn identity`,
          )
          this.#flushProviderEvents()
          throw new HostServiceError(
            'provider_error',
            `${providerDisplayName(conversation.record.provider)} returned an invalid or reused Turn identity`,
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
        // Keep the short provider-event binding window open until both public
        // identities are installed. A very fast remote Turn may emit its
        // terminal event immediately after the start acknowledgement; ending
        // `startingTurn` earlier would classify that event as late and drop it.
        conversation.startingTurn = false
        conversation.providerSessionMaterialized = true
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
      false,
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
        const runtime = this.#requireMachineProviderRuntime(
          conversation.record.machineId,
          conversation.record.provider,
        )
        if (
          this.#providerDescriptorsForMachine(
            conversation.record.machineId,
          ).find(
            (descriptor) =>
              descriptor.provider === conversation.record.provider,
          )?.capabilities.interrupt !== true
        ) {
          turn.interrupting = false
          throw new HostServiceError(
            'unsupported',
            `${providerDisplayName(conversation.record.provider)} does not support interruption in this version`,
            409,
          )
        }
        try {
          await runtime.interruptTurn({
            providerThreadId: requireProviderThreadId(conversation),
            providerTurnId: turn.providerTurnId,
          })
        } catch (error) {
          turn.interrupting = false
          if (
            !this.#machineRuntimeAvailable(
              conversation.record.machineId,
              conversation.record.provider,
            )
          ) {
            throw providerUnavailableError(conversation.record.provider)
          }
          throw providerCommandError(
            conversation.record.provider,
            'interrupt turn',
            error,
          )
        }
        this.#assertMachineRuntimeAvailable(
          conversation.record.machineId,
          conversation.record.provider,
        )
        return {
          protocolVersion,
          actionId: request.actionId,
          status: 'accepted',
          data: { turn: turn.record },
        }
      },
      false,
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
    if (parsed.conversationId !== null) {
      this.#touchConversation(parsed.conversationId)
    }
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
    if (parsed.conversationId === null) {
      const envelope = this.publisher.publish(parsed)
      if (envelope.eventId !== preview.eventId) {
        throw new Error('Host event sequence changed during global publication')
      }
      return
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
    const sessionKey = providerSessionKey(
      durable.record.provider,
      durable.providerThreadId,
    )
    const providerOwner = this.#providerThreads.get(sessionKey)
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
      providerSessionMaterialized: durable.providerSessionMaterialized,
      providerSession: 'needs-resume',
      startingTurn: false,
    }
    this.#conversations.set(durable.record.conversationId, state)
    this.#providerThreads.set(sessionKey, durable.record.conversationId)
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
      if (durableConversation.providerThreadId === undefined) {
        const machine = this.#machines.get(durable.record.machineId)
        if (machine.kind !== 'remote' || durable.history.totalTurns !== 0) {
          throw providerConversationUnavailableError(
            durableConversation.provider,
          )
        }
        this.#runtimeHistory.restore(durable.runtime)
        this.#conversations.set(conversationId, {
          record: durable.record,
          turns: new Map(),
          providerTurnIds: new Map(),
          providerSessionMaterialized: false,
          providerSession: 'uninitialized',
          startingTurn: false,
        })
      } else {
        const providerOwner = this.#providerThreads.get(
          providerSessionKey(
            durableConversation.provider,
            durableConversation.providerThreadId,
          ),
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
          providerSessionMaterialized: durable.history.totalTurns > 0,
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
      }
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
    const providerThreadId = conversation.providerThreadId
    if (providerThreadId !== undefined) {
      void this.#machineRuntimes
        .existing(conversation.record.machineId, conversation.record.provider)
        ?.disposeConversation?.({ providerThreadId })
        .catch(() => undefined)
      if (
        this.#providerThreads.get(
          providerSessionKey(conversation.record.provider, providerThreadId),
        ) === conversationId
      ) {
        this.#providerThreads.delete(
          providerSessionKey(conversation.record.provider, providerThreadId),
        )
      }
    }
    this.#runtimeHistory.delete(conversationId)
    this.#runtimeAccess.delete(conversationId)
  }

  #touchConversation(conversationId: ConversationId): void {
    if (!this.#conversations.has(conversationId)) return
    this.#runtimeAccessSequence += 1
    this.#runtimeAccess.set(conversationId, this.#runtimeAccessSequence)
  }

  #invalidateRemoteProviderSessions(machineId: MachineId): void {
    for (const conversation of this.#conversations.values()) {
      if (conversation.record.machineId !== machineId) continue
      this.#invalidateRemoteProviderSession(conversation)
    }
  }

  #invalidateRemoteProviderSession(conversation: ConversationState): void {
    if (conversation.record.machineId === this.#machines.localMachineId()) {
      return
    }
    const providerThreadId = conversation.providerThreadId
    conversation.providerSession =
      providerThreadId === undefined ? 'uninitialized' : 'needs-resume'
    if (providerThreadId === undefined) return
    void this.#machineRuntimes
      .existing(conversation.record.machineId, conversation.record.provider)
      ?.disposeConversation?.({ providerThreadId })
      .catch(() => undefined)
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
    runtime: AgentHostRuntime,
  ): Promise<void> {
    if (conversation.providerSession === 'ready') {
      const providerThreadId = requireProviderThreadId(conversation)
      if (runtime.hasConversationSession?.(providerThreadId) !== false) return
      conversation.providerSession = 'needs-resume'
    }
    if (conversation.providerSession === 'unavailable') {
      throw providerConversationUnavailableError(conversation.record.provider)
    }
    try {
      const projectId = ProjectIdSchema.parse(conversation.record.projectId)
      const machineId = MachineIdSchema.parse(conversation.record.machineId)
      const remoteContext =
        machineId === this.#machines.localMachineId()
          ? {}
          : {
              conversationId: conversation.record.conversationId,
              projectId,
              machineId,
            }
      const wasUninitialized = conversation.providerSession === 'uninitialized'
      const existingProviderThreadId = conversation.providerThreadId
      const resumed = wasUninitialized
        ? await runtime.startConversation({
            cwd: authorizedCwd,
            ...remoteContext,
            ...(conversation.record.model === undefined
              ? {}
              : { model: conversation.record.model }),
            ...(conversation.record.reasoning === undefined
              ? {}
              : { reasoning: conversation.record.reasoning }),
          })
        : await runtime.resumeConversation({
            providerThreadId: requireProviderThreadId(conversation),
            cwd: authorizedCwd,
            providerSessionMaterialized:
              conversation.providerSessionMaterialized,
            ...(conversation.record.model === undefined
              ? {}
              : { model: conversation.record.model }),
            ...(conversation.record.reasoning === undefined
              ? {}
              : { reasoning: conversation.record.reasoning }),
            ...remoteContext,
          })
      if (
        resumed.providerThreadId.trim().length === 0 ||
        (!wasUninitialized &&
          resumed.providerThreadId !== existingProviderThreadId)
      ) {
        throw new ProviderConversationUnavailableError(
          conversation.record.provider,
          existingProviderThreadId ?? resumed.providerThreadId,
        )
      }
      const sessionKey = providerSessionKey(
        conversation.record.provider,
        resumed.providerThreadId,
      )
      const owner = this.#providerThreads.get(sessionKey)
      if (
        (owner !== undefined && owner !== conversation.record.conversationId) ||
        this.#persistence
          ?.listConversations()
          .some(
            (candidate) =>
              candidate.conversationId !== conversation.record.conversationId &&
              candidate.provider === conversation.record.provider &&
              candidate.providerThreadId === resumed.providerThreadId,
          ) === true
      ) {
        throw new ProviderConversationUnavailableError(
          conversation.record.provider,
          resumed.providerThreadId,
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
      }
      conversation.providerThreadId = resumed.providerThreadId
      try {
        // This Host-private native Session identity is durable before the
        // Prompt can cross the remote transport. A retry can therefore resume
        // rather than silently creating a second Provider Session.
        this.#writeDurable(() => {
          this.#persistence?.updateConversation(
            this.#durableConversation(conversation),
          )
        })
      } catch (error) {
        conversation.providerThreadId = existingProviderThreadId
        if (wasUninitialized) {
          await runtime
            .disposeConversation?.({
              providerThreadId: resumed.providerThreadId,
            })
            .catch(() => undefined)
        }
        throw error
      }
      this.#providerThreads.set(sessionKey, conversation.record.conversationId)
      conversation.providerSession = 'ready'
    } catch (error) {
      if (error instanceof HostServiceError) throw error
      if (error instanceof ProviderConversationUnavailableError) {
        conversation.providerSession = 'unavailable'
        throw providerConversationUnavailableError(conversation.record.provider)
      }
      if (
        !this.#machineRuntimeAvailable(
          conversation.record.machineId,
          conversation.record.provider,
        )
      ) {
        throw providerUnavailableError(conversation.record.provider)
      }
      throw providerCommandError(
        conversation.record.provider,
        'resume conversation',
        error,
      )
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
      machineId: MachineIdSchema.parse(conversation.record.machineId),
      title: conversation.record.title ?? DEFAULT_CONVERSATION_TITLE,
      titleSource: conversation.record.titleSource ?? 'generated',
      ...(conversation.record.pinnedAt === undefined
        ? {}
        : { pinnedAt: conversation.record.pinnedAt }),
      ...(conversation.record.archivedAt === undefined
        ? {}
        : { archivedAt: conversation.record.archivedAt }),
      provider: conversation.record.provider,
      ...(conversation.providerThreadId === undefined
        ? {}
        : { providerThreadId: conversation.providerThreadId }),
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

  #organizationMutationResponse(
    conversationId: ConversationId,
    actionId: ReturnType<typeof ActionIdSchema.parse>,
    mutation: (
      store: ConversationStore,
      timestamp: ReturnType<typeof TimestampSchema.parse>,
    ) => DurableConversationMutationResult,
  ): RenameConversationResponse {
    const store = this.#requireConversationOrganizationStore()
    const existing = store.getConversation(conversationId)
    if (existing === undefined || existing.status === 'creating') {
      throw new HostServiceError('not_found', 'Conversation was not found', 404)
    }

    let result: DurableConversationMutationResult
    try {
      result = mutation(store, TimestampSchema.parse(this.#timestamp()))
    } catch (error) {
      if (error instanceof ConversationOrganizationConflictError) {
        throw conversationOrganizationServiceError(error)
      }
      this.#handlePersistenceFailure(toError(error))
      throw runtimeUnavailableError('Conversation durability is unavailable')
    }

    this.#syncRuntimeOrganization(result.conversation)
    const summary = conversationSummary(result.conversation)
    if (result.changed) this.#publishConversationUpdated(summary)
    return {
      protocolVersion,
      actionId,
      status: 'completed',
      data: { conversation: summary },
    }
  }

  #syncRuntimeOrganization(durable: DurableConversation): void {
    const runtime = this.#conversations.get(durable.conversationId)
    if (runtime === undefined) return
    const record: Record<string, unknown> = {
      ...runtime.record,
      title: durable.title,
      titleSource: durable.titleSource,
      updatedAt: durable.updatedAt,
    }
    if (durable.pinnedAt === undefined) delete record.pinnedAt
    else record.pinnedAt = durable.pinnedAt
    if (durable.archivedAt === undefined) delete record.archivedAt
    else record.archivedAt = durable.archivedAt
    runtime.record = ConversationRecordSchema.parse(record)
  }

  #publishConversationUpdated(conversation: ConversationSummary): void {
    this.publisher.publish(
      HostEventSchema.parse({
        conversationId: conversation.conversationId,
        timestamp: conversation.updatedAt,
        type: 'conversation.updated',
        payload: { conversation },
      }),
    )
  }

  #requireConversationOrganizationStore(): ConversationStore {
    if (
      this.#persistence === undefined ||
      this.#persistenceFailure !== undefined
    ) {
      throw new HostServiceError(
        'runtime_unavailable',
        'Durable Conversation organization is unavailable',
        503,
      )
    }
    return this.#persistence
  }

  async #reserveConversationProject(
    request: CreateConversationRequest,
  ): Promise<ProjectConversationReservation> {
    try {
      return 'projectId' in request
        ? await this.#projects.reserveConversationCreation(
            request.projectId,
            request.machineId,
          )
        : await this.#projects.reserveLegacyConversationCreation(
            request.cwd,
            request.machineId,
          )
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

  #requireDurableMachineState(): ConversationStore {
    if (
      this.#persistence === undefined ||
      this.#persistenceFailure !== undefined
    ) {
      throw new HostServiceError(
        'runtime_unavailable',
        'Durable Machine state is unavailable',
        503,
      )
    }
    return this.#persistence
  }

  #requireRemoteMachineTrust(machineId: MachineId) {
    const persistence = this.#requireDurableMachineState()
    const durable = persistence.getMachine(machineId)
    if (durable === undefined) {
      throw new HostServiceError('not_found', 'Machine was not found', 404)
    }
    if (durable.kind !== 'remote') {
      throw new HostServiceError(
        'conflict',
        'The local Machine does not have a remote connection',
        409,
      )
    }
    const trust = persistence.getTrustedMachinePeer(machineId)
    if (trust === undefined || trust.trustState !== 'active') {
      throw new HostServiceError(
        'conflict',
        'Machine does not have active remote trust',
        409,
      )
    }
    return { durable, trust }
  }

  async #authorizeRemoteConversationLocation(input: {
    readonly projectId: ProjectId
    readonly machineId: MachineId
    readonly rootPath: string
  }): Promise<string> {
    const { durable, trust } = this.#requireRemoteMachineTrust(input.machineId)
    const machine = this.#machines.requireAvailable(input.machineId)
    if (machine.kind !== 'remote' || machine.connectionState !== 'online') {
      throw new ProjectRegistryError(
        'unavailable',
        'Remote Project Location is unavailable while its Machine is offline',
      )
    }
    const validate = this.#remoteMachines.validateProjectLocation
    if (validate === undefined) {
      throw new ProjectRegistryError(
        'unavailable',
        'Remote Project Location validation is unavailable',
      )
    }
    try {
      const validated = await validate.call(
        this.#remoteMachines,
        durable,
        trust,
        input.rootPath,
      )
      return validated.canonicalPath
    } catch {
      throw new ProjectRegistryError(
        'unavailable',
        'Remote Project Location is unavailable or no longer authorized',
      )
    }
  }

  async #openRemoteCodexSession(input: {
    readonly machineId: MachineId
    readonly conversationId: ConversationId
    readonly projectId: ProjectId
    readonly rootPath: string
    readonly providerThreadId?: string
  }): Promise<RemoteCodexRuntimeSession> {
    const { durable, trust } = this.#requireRemoteMachineTrust(input.machineId)
    this.#assertMachineRuntimeAvailable(input.machineId, 'codex')
    const open = this.#remoteMachines.openCodexSession
    if (open === undefined) throw providerUnavailableError('codex')
    try {
      return await open.call(this.#remoteMachines, durable, trust, {
        conversationId: input.conversationId,
        projectId: input.projectId,
        rootPath: input.rootPath,
        ...(input.providerThreadId === undefined
          ? {}
          : { providerThreadId: input.providerThreadId }),
      })
    } catch (error) {
      throw remoteProviderCommandError(error, 'codex')
    }
  }

  async #openRemoteClaudeSession(input: {
    readonly machineId: MachineId
    readonly conversationId: ConversationId
    readonly projectId: ProjectId
    readonly rootPath: string
    readonly providerSessionId?: string
    readonly providerSessionMaterialized?: boolean
    readonly effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  }): Promise<RemoteClaudeRuntimeSession> {
    const { durable, trust } = this.#requireRemoteMachineTrust(input.machineId)
    this.#assertMachineRuntimeAvailable(input.machineId, 'claude-code')
    const open = this.#remoteMachines.openClaudeSession
    if (open === undefined) throw providerUnavailableError('claude-code')
    try {
      return await open.call(this.#remoteMachines, durable, trust, {
        conversationId: input.conversationId,
        projectId: input.projectId,
        rootPath: input.rootPath,
        ...(input.providerSessionId === undefined
          ? {}
          : {
              providerSessionId: input.providerSessionId,
              providerSessionMaterialized:
                input.providerSessionMaterialized ?? false,
            }),
        ...(input.effort === undefined ? {} : { effort: input.effort }),
      })
    } catch (error) {
      throw remoteProviderCommandError(error, 'claude-code')
    }
  }

  #refreshRemoteMachine(durable: DurableMachine): MachineSummary {
    try {
      return this.#machines.refresh(durable)
    } catch (error) {
      if (!(error instanceof MachineRegistryError)) throw error
      return this.#machines.retainRemote(durable)
    }
  }

  #remoteConnection(machine: MachineSummary): RemoteMachineConnection {
    if (machine.kind !== 'remote' || machine.connectionState === 'local') {
      throw new Error('Connection detail is available only for remote Machines')
    }
    const live = this.#remoteMachines.connectionDetails?.(machine.machineId)
    // `machine` and connection detail are separate reads. A concurrent
    // transport transition must not produce an internally inconsistent public
    // response that Protocol v1 rightly rejects.
    if (live !== undefined && live.state === machine.connectionState) {
      return live
    }
    const preferred = this.#persistence
      ?.getTrustedMachinePeer(machine.machineId)
      ?.endpoints.find((endpoint) => endpoint.preferred)
    return {
      state: machine.connectionState,
      ...(preferred?.lastSuccessfulAt === undefined
        ? {}
        : {
            currentEndpoint: preferred.address,
            lastSuccessfulAt: preferred.lastSuccessfulAt,
          }),
    }
  }

  #writeDurable(operation: () => void): void {
    if (this.#persistence === undefined) return
    try {
      operation()
    } catch (error) {
      if (
        error instanceof RemoteMachineTrustConflictError ||
        error instanceof ProjectLocationConflictError ||
        error instanceof ProjectLocationRemovalError ||
        error instanceof RemoteMachineProjectLocationConflictError
      ) {
        throw error
      }
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
    const failure = new Error('Conversation durability became unavailable', {
      cause: error,
    })
    for (const runtime of this.#providers.runtimes()) {
      this.#handleRuntimeFailure(runtime.provider, failure)
    }
    void this.#providers.close().catch(() => undefined)
    for (const [machineId, runtime] of this.#machineRuntimes.remoteRuntimes()) {
      this.#handleMachineRuntimeFailure(machineId, runtime.provider, failure)
    }
    void this.#machineRuntimes.close().catch(() => undefined)
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
    const failures: unknown[] = []
    // The first synchronous flush runs before waiting on Provider-backed
    // actions. Windows session ending can terminate the process before the
    // Provider finishes, so persist the latest normalized Turn projection at
    // the start of every graceful close. A second flush below captures any
    // action that reaches a later durable boundary during the normal budget.
    try {
      this.#flushAllDurableTurns()
    } catch (error) {
      failures.push(error)
    }
    await Promise.allSettled([...this.#inFlightActions])
    this.#closingRuntime = true
    // A shutdown-only decline releases the live Provider request, but it is
    // not a user decision. Stop consuming Provider resolution callbacks first
    // so the pending durable Approval remains the restart reconciliation
    // authority and becomes host_restart/expired on the next Host open.
    for (const unsubscribe of this.#unsubscribeApprovals) unsubscribe()
    this.#approvalRegistry.declineAll()
    try {
      try {
        await this.#providers.close()
      } catch (error) {
        failures.push(error)
      }
      try {
        await this.#machineRuntimes.close()
      } catch (error) {
        failures.push(error)
      }
      try {
        await this.#remoteMachines.close?.()
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
      for (const unsubscribe of this.#unsubscribeEvents) unsubscribe()
      for (const unsubscribe of this.#unsubscribeFailures) unsubscribe()
      this.#unsubscribeRemoteMachineStatus?.()
      this.#unsubscribeRemoteMachineStatus = undefined
      this.#unsubscribeRemoteMachineRemoval?.()
      this.#unsubscribeRemoteMachineRemoval = undefined
      this.#unsubscribeRemoteProviderDiscovery?.()
      this.#unsubscribeRemoteProviderDiscovery = undefined
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

  #handleRuntimeFailure(provider: AgentProvider, failure: Error): void {
    if (
      this.#runtimeFailures.has(provider) ||
      this.#closePromise !== undefined
    ) {
      return
    }
    this.#runtimeFailures.set(provider, failure)
    const retainedEvents = this.#pendingProviderEvents.filter(
      (event) => event.provider !== provider,
    )
    this.#pendingProviderEvents.length = 0
    this.#pendingProviderEvents.push(...retainedEvents)
    this.#pendingProviderEventBytes = retainedEvents.reduce(
      (total, event) =>
        total + Buffer.byteLength(JSON.stringify(event), 'utf8'),
      0,
    )
    const timestamp = this.#timestamp()
    const error = {
      code: 'runtime_unavailable' as const,
      message:
        this.#persistenceFailure === undefined
          ? `${providerDisplayName(provider)} runtime became unavailable`
          : 'Conversation durability became unavailable',
    }
    for (const conversation of this.#conversations.values()) {
      if (conversation.record.provider !== provider) continue
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
    this.#approvalRegistry.resolveAllForProviderFailure(provider)
  }

  #runtimeAvailable(provider?: AgentProvider): boolean {
    if (this.#persistenceFailure !== undefined || this.#closingRuntime) {
      return false
    }
    if (provider === undefined) {
      return this.#providers
        .runtimes()
        .some((runtime) => this.#runtimeAvailable(runtime.provider))
    }
    const runtime = this.#providers.get(provider)
    const descriptor = this.#providers.descriptor(provider)
    return (
      runtime !== undefined &&
      runtime.available !== false &&
      descriptor?.availability === 'available' &&
      !this.#runtimeFailures.has(provider)
    )
  }

  #providerDescriptors(): readonly ProviderDescriptor[] {
    return this.#providers
      .descriptors()
      .map((descriptor) =>
        descriptor.availability === 'available' &&
        !this.#runtimeAvailable(descriptor.provider)
          ? { ...descriptor, availability: 'unavailable' }
          : descriptor,
      )
  }

  #providerDescriptorsForMachine(
    machineId: MachineId,
  ): readonly ProviderDescriptor[] {
    const machine = this.#machines.get(machineId)
    if (machine.kind === 'local') return this.#providerDescriptors()
    if (machine.connectionState !== 'online') return []
    const presentation = this.#remoteProviderPresentation(machine)
    if (presentation.providerDiscovery.state !== 'current') return []
    return presentation.providers.filter(
      (descriptor) =>
        descriptor.availability === 'available' &&
        remoteProviderExecutionProfileAvailable(
          descriptor,
          this.#remoteMachines.openCodexSession !== undefined,
          this.#remoteMachines.openClaudeSession !== undefined,
        ) &&
        !this.#machineRuntimeFailures.has(
          machineRuntimeKey(machine.machineId, descriptor.provider),
        ),
    )
  }

  #remoteProviderPresentation(machine: MachineSummary): {
    readonly providers: readonly ProviderDescriptor[]
    readonly providerDiscovery: MachineProviderDiscovery
  } {
    if (machine.kind !== 'remote') {
      throw new Error('Remote Provider presentation requires a remote Machine')
    }
    const observation = this.#persistence?.getRemoteProviderObservation(
      machine.machineId,
    )
    if (observation === undefined) {
      return { providers: [], providerDiscovery: { state: 'not_observed' } }
    }
    const current =
      machine.connectionState === 'online' &&
      this.#remoteMachines.providerDiscoveryCurrent?.(
        machine.machineId,
        observation.observedAt,
      ) === true
    return {
      providers: observation.providers,
      providerDiscovery: {
        state: current ? 'current' : 'last_known',
        observedAt: observation.observedAt,
      },
    }
  }

  #assertRuntimeAvailable(provider?: AgentProvider): void {
    if (provider === undefined) {
      if (!this.#runtimeAvailable()) throw runtimeUnavailableError()
      return
    }
    if (!this.#runtimeAvailable(provider)) {
      throw providerUnavailableError(
        provider,
        this.#providers.descriptor(provider),
      )
    }
  }

  #machineRuntimeAvailable(
    machineId: MachineId,
    provider: AgentProvider,
  ): boolean {
    if (machineId === this.#machines.localMachineId()) {
      return this.#runtimeAvailable(provider)
    }
    if (this.#persistenceFailure !== undefined || this.#closingRuntime) {
      return false
    }
    return this.#providerDescriptorsForMachine(machineId).some(
      (descriptor) =>
        descriptor.provider === provider &&
        descriptor.availability === 'available',
    )
  }

  #assertMachineRuntimeAvailable(
    machineId: MachineId,
    provider: AgentProvider,
  ): void {
    if (this.#machineRuntimeAvailable(machineId, provider)) return
    throw providerUnavailableError(
      provider,
      this.#providerDescriptorsForMachine(machineId).find(
        (descriptor) => descriptor.provider === provider,
      ),
    )
  }

  #requireMachineProviderRuntime(
    machineId: MachineId,
    provider: AgentProvider,
  ): AgentHostRuntime {
    this.#assertMachineRuntimeAvailable(machineId, provider)
    const runtime = this.#machineRuntimes.get(machineId, provider)
    if (runtime === undefined) throw providerUnavailableError(provider)
    this.#subscribeRuntime(runtime, machineId)
    return runtime
  }

  #subscribeRuntime(runtime: AgentHostRuntime, machineId: MachineId): void {
    if (this.#subscribedRuntimes.has(runtime)) return
    this.#subscribedRuntimes.add(runtime)
    const fail = (failure: Error): void => {
      if (machineId === this.#machines.localMachineId()) {
        this.#handleRuntimeFailure(runtime.provider, failure)
      } else {
        this.#handleMachineRuntimeFailure(machineId, runtime.provider, failure)
      }
    }
    this.#unsubscribeEvents.push(
      runtime.subscribeEvents((event) => {
        if (event.provider !== runtime.provider) {
          fail(new Error('Provider emitted an event with the wrong identity'))
          return
        }
        this.#acceptProviderEvent(event)
      }),
    )
    this.#unsubscribeApprovals.push(
      runtime.subscribeApprovals(
        (request) => {
          if (
            machineId !== this.#machines.localMachineId() ||
            (request.provider !== undefined &&
              request.provider !== runtime.provider)
          ) {
            request.respond('decline')
            fail(new Error('Provider emitted an unsupported Approval'))
            return
          }
          this.#approvalRegistry.request({
            ...request,
            provider: runtime.provider,
          })
        },
        (resolution) => {
          if (
            machineId !== this.#machines.localMachineId() ||
            (resolution.provider !== undefined &&
              resolution.provider !== runtime.provider)
          ) {
            fail(new Error('Provider resolved an unsupported Approval'))
            return
          }
          this.#approvalRegistry.resolveProvider({
            ...resolution,
            provider: runtime.provider,
          })
        },
      ),
    )
    this.#unsubscribeFailures.push(runtime.subscribeFailures(fail))
  }

  #handleMachineRuntimeFailure(
    machineId: MachineId,
    provider: AgentProvider,
    failure: Error,
  ): void {
    if (machineId === this.#machines.localMachineId()) {
      this.#handleRuntimeFailure(provider, failure)
      return
    }
    const key = machineRuntimeKey(machineId, provider)
    if (
      this.#machineRuntimeFailures.has(key) ||
      this.#closePromise !== undefined
    ) {
      return
    }
    this.#machineRuntimeFailures.set(key, failure)
    const timestamp = this.#timestamp()
    const error = {
      code: 'runtime_unavailable' as const,
      message: `${providerDisplayName(provider)} runtime became unavailable on this Machine`,
    }
    for (const conversation of this.#conversations.values()) {
      if (
        conversation.record.machineId !== machineId ||
        conversation.record.provider !== provider
      ) {
        continue
      }
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
    conversation.record.titleSource === 'generated' &&
    conversation.turns.size === 0
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

function conversationSummary(
  record: ConversationRecord | DurableConversation,
): ConversationSummary {
  if (
    record.projectId === undefined ||
    record.title === undefined ||
    record.titleSource === undefined ||
    record.lastActivityAt === undefined
  ) {
    throw new Error('Durable Conversation summary metadata is incomplete')
  }
  return ConversationSummarySchema.parse({
    conversationId: record.conversationId,
    projectId: record.projectId,
    machineId: record.machineId,
    title: record.title,
    titleSource: record.titleSource,
    ...(record.pinnedAt === undefined ? {} : { pinnedAt: record.pinnedAt }),
    ...(record.archivedAt === undefined
      ? {}
      : { archivedAt: record.archivedAt }),
    provider: record.provider,
    ...(record.model === undefined ? {} : { model: record.model }),
    ...(record.reasoning === undefined ? {} : { reasoning: record.reasoning }),
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastActivityAt: record.lastActivityAt,
  })
}

function archiveFilterForStore(
  archived: ListProjectConversationsQuery['archived'],
): 'active' | 'archived' | 'all' {
  switch (archived) {
    case 'false':
      return 'active'
    case 'true':
      return 'archived'
    case 'all':
      return 'all'
  }
}

function activeConversationArchiveError(): HostServiceError {
  return new HostServiceError(
    'conflict',
    'An active Conversation cannot be archived',
    409,
  )
}

function archivedConversationControlError(): HostServiceError {
  return new HostServiceError(
    'conversation_archived',
    'Archived Conversations must be unarchived before starting a Turn',
    409,
  )
}

function conversationOrganizationServiceError(
  error: ConversationOrganizationConflictError,
): HostServiceError {
  switch (error.reason) {
    case 'archived':
      return archivedConversationControlError()
    case 'active':
      return activeConversationArchiveError()
    case 'open_approval':
      return new HostServiceError(
        'conflict',
        'A Conversation with an open Approval cannot be archived',
        409,
      )
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
  provider: AgentProvider,
  operation: string,
  error: unknown,
): HostServiceError {
  const code = providerErrorCode(error)
  return new HostServiceError(
    code,
    `${providerDisplayName(provider)} failed to ${operation}`,
    code === 'provider_session_lost' ? 409 : 500,
    { cause: safeErrorName(error) },
  )
}

function remoteProviderCommandError(
  error: unknown,
  provider: AgentProvider = 'codex',
): Error {
  if (error instanceof HostServiceError) return error
  if (!(error instanceof RemoteMachineCoordinatorError)) {
    return error instanceof Error ? error : new Error(String(error))
  }
  const displayName = providerDisplayName(provider)
  switch (error.code) {
    case 'provider_start_failed':
      return new HostServiceError(
        'provider_start_failed',
        `Remote ${displayName} failed to start`,
        503,
      )
    case 'provider_session_lost':
      return new HostServiceError(
        'provider_session_lost',
        `The remote ${displayName} session is no longer available`,
        409,
      )
    case 'provider_unavailable':
    case 'remote_execution_unavailable':
    case 'remote_execution_lost':
    case 'remote_policy_violation':
      return new HostServiceError(
        'provider_unavailable',
        `Remote ${displayName} execution is unavailable`,
        503,
      )
    case 'conversation_busy':
    case 'duplicate_action_conflict':
    case 'conflict':
      return new HostServiceError(
        'conflict',
        `Remote ${displayName} Conversation has conflicting active work`,
        409,
      )
    case 'project_location_path_invalid':
    case 'project_location_missing':
    case 'project_location_not_directory':
    case 'project_location_inaccessible':
      return new HostServiceError(
        'project_unavailable',
        'Remote Project Location is unavailable',
        409,
      )
    case 'authentication_failed':
    case 'identity_mismatch':
      return new HostServiceError(
        'machine_identity_mismatch',
        'Remote Machine identity could not be authenticated',
        409,
      )
    case 'protocol_incompatible':
      return new HostServiceError(
        'machine_protocol_incompatible',
        'Remote Machine protocol is incompatible',
        409,
      )
    default:
      return new HostServiceError(
        'machine_connection_failed',
        'Remote Machine connection failed',
        503,
      )
  }
}

function assertProviderConfiguration(
  descriptor: ProviderDescriptor | undefined,
  model: string | undefined,
  reasoning: string | undefined,
): void {
  if (
    model !== undefined &&
    (descriptor?.capabilities.modelSelection !== true ||
      (descriptor.models !== undefined &&
        !descriptor.models.some((option) => option.id === model)))
  ) {
    throw new HostServiceError(
      'invalid_request',
      'The selected model is unavailable for this Agent',
      400,
    )
  }
  if (
    reasoning !== undefined &&
    (descriptor?.capabilities.reasoningControl !== true ||
      (descriptor.reasoningOptions !== undefined &&
        !descriptor.reasoningOptions.some((option) => option.id === reasoning)))
  ) {
    throw new HostServiceError(
      'invalid_request',
      'The selected reasoning option is unavailable for this Agent',
      400,
    )
  }
}

function remoteProviderExecutionProfileAvailable(
  descriptor: ProviderDescriptor,
  codexTransportAvailable: boolean,
  claudeTransportAvailable: boolean,
): boolean {
  const enabledCapabilities = Object.entries(descriptor.capabilities)
    .filter(([, enabled]) => enabled)
    .map(([capability]) => capability)
    .sort()
  if (descriptor.provider === 'codex') {
    return (
      codexTransportAvailable &&
      enabledCapabilities.length === 2 &&
      enabledCapabilities[0] === 'resume' &&
      enabledCapabilities[1] === 'streaming'
    )
  }
  const expected = [
    'fileRead',
    'reasoningControl',
    'resume',
    'search',
    'streaming',
    'toolEvents',
  ]
  return (
    claudeTransportAvailable &&
    enabledCapabilities.length === expected.length &&
    enabledCapabilities.every(
      (capability, index) => capability === expected[index],
    ) &&
    descriptor.reasoningOptions?.length === 5 &&
    descriptor.reasoningOptions.every(
      (option, index) =>
        option.id === ['low', 'medium', 'high', 'xhigh', 'max'][index],
    )
  )
}

function providerErrorCode(error: unknown): HostErrorCode {
  if (!(error instanceof Error) || !('code' in error)) return 'provider_error'
  switch (error.code) {
    case 'provider_not_installed':
    case 'provider_version_unsupported':
    case 'provider_start_failed':
    case 'provider_session_lost':
    case 'provider_unavailable':
      return error.code
    default:
      return 'provider_error'
  }
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

function providerConversationUnavailableError(
  provider: AgentProvider,
): HostServiceError {
  return new HostServiceError(
    'provider_session_lost',
    `The ${providerDisplayName(provider)} conversation can no longer be resumed`,
    409,
  )
}

function providerUnavailableError(
  provider: AgentProvider,
  descriptor?: ProviderDescriptor,
): HostServiceError {
  const code: HostErrorCode =
    descriptor?.availability === 'not_installed'
      ? 'provider_not_installed'
      : descriptor?.availability === 'unsupported_version'
        ? 'provider_version_unsupported'
        : 'provider_unavailable'
  const suffix =
    descriptor?.availability === 'misconfigured'
      ? ' is not configured for use'
      : descriptor?.availability === 'unsupported_version'
        ? ' version is not supported'
        : descriptor?.availability === 'not_installed'
          ? ' is not installed'
          : ' is temporarily unavailable'
  return new HostServiceError(
    code,
    `${providerDisplayName(provider)}${suffix}`,
    503,
  )
}

function providerDisplayName(provider: AgentProvider): string {
  return provider === 'codex' ? 'Codex' : 'Claude Code'
}

function requireProviderThreadId(conversation: ConversationState): string {
  if (conversation.providerThreadId === undefined) {
    throw providerConversationUnavailableError(conversation.record.provider)
  }
  return conversation.providerThreadId
}

function machineRuntimeKey(
  machineId: MachineId,
  provider: AgentProvider,
): string {
  return JSON.stringify([MachineIdSchema.parse(machineId), provider])
}

function machineServiceError(error: unknown): Error {
  if (error instanceof HostServiceError) return error
  if (!(error instanceof MachineRegistryError)) {
    return error instanceof Error ? error : new Error(String(error))
  }
  return error.code === 'not_found'
    ? new HostServiceError('not_found', error.message, 404)
    : new HostServiceError('runtime_unavailable', error.message, 503)
}

function remoteMachineServiceError(error: unknown): Error {
  if (error instanceof HostServiceError) return error
  if (error instanceof RemoteMachineTrustConflictError) {
    return new HostServiceError(
      error.reason === 'capacity' ? 'conflict' : 'machine_identity_mismatch',
      error.message,
      409,
    )
  }
  if (!(error instanceof RemoteMachineCoordinatorError)) {
    return error instanceof Error ? error : new Error(String(error))
  }
  switch (error.code) {
    case 'not_found':
      return new HostServiceError(
        'not_found',
        'Pairing attempt was not found',
        404,
      )
    case 'unavailable':
      return new HostServiceError(
        'machine_connection_failed',
        'Remote Machine pairing is currently unavailable',
        503,
      )
    case 'pairing_code_invalid':
      return new HostServiceError(
        'machine_pairing_code_invalid',
        'Pairing code is invalid',
        422,
      )
    case 'pairing_code_expired':
      return new HostServiceError(
        'machine_pairing_code_expired',
        'Pairing code has expired',
        410,
      )
    case 'pairing_rate_limited':
      return new HostServiceError(
        'machine_pairing_rate_limited',
        'Pairing attempts are temporarily limited',
        429,
      )
    case 'authentication_failed':
      return new HostServiceError(
        'machine_authentication_failed',
        'Remote Machine authentication failed',
        401,
      )
    case 'identity_mismatch':
      return new HostServiceError(
        'machine_identity_mismatch',
        'Remote Machine identity does not match the trusted identity',
        409,
      )
    case 'conflict':
      return new HostServiceError(
        'conflict',
        'Remote Machine trust conflicts with existing durable state',
        409,
      )
    case 'protocol_incompatible':
      return new HostServiceError(
        'machine_protocol_incompatible',
        'Remote Machine protocol is incompatible',
        409,
      )
    case 'connection_failed':
      return new HostServiceError(
        'machine_connection_failed',
        'Remote Machine connection failed',
        503,
      )
    case 'project_location_path_invalid':
    case 'project_location_not_directory':
      return new HostServiceError(
        'project_location_invalid',
        'Remote Project Location path is invalid',
        422,
      )
    case 'project_location_missing':
      return new HostServiceError(
        'project_location_missing',
        'Remote Project Location directory does not exist',
        404,
      )
    case 'project_location_inaccessible':
      return new HostServiceError(
        'project_location_inaccessible',
        'Remote Project Location directory is inaccessible',
        403,
      )
    case 'remote_execution_unavailable':
    case 'provider_unavailable':
    case 'provider_start_failed':
    case 'provider_session_lost':
    case 'remote_execution_lost':
    case 'remote_policy_violation':
    case 'conversation_busy':
    case 'duplicate_action_conflict':
      return remoteProviderCommandError(error)
  }
}

function assertStagedRemoteMachine(candidate: ConfirmedRemoteMachine): void {
  if (
    candidate.machine.kind !== 'remote' ||
    candidate.trust.machineId !== candidate.machine.machineId ||
    candidate.trust.trustState !== 'pending'
  ) {
    throw new RemoteMachineCoordinatorError(
      'identity_mismatch',
      'Remote pairing produced an invalid trust candidate',
    )
  }
}

function assertSameConfirmedRemoteMachine(
  staged: ConfirmedRemoteMachine,
  confirmed: ConfirmedRemoteMachine,
): void {
  if (
    staged.machine.machineId !== confirmed.machine.machineId ||
    staged.trust.machineId !== confirmed.trust.machineId ||
    staged.trust.nodeIdentity !== confirmed.trust.nodeIdentity ||
    staged.trust.peerKeyFingerprint !== confirmed.trust.peerKeyFingerprint ||
    staged.trust.controllerCredentialRef !==
      confirmed.trust.controllerCredentialRef ||
    staged.trust.controllerKeyFingerprint !==
      confirmed.trust.controllerKeyFingerprint
  ) {
    throw new RemoteMachineCoordinatorError(
      'identity_mismatch',
      'Remote Machine identity changed during confirmation',
    )
  }
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
    case 'location_conflict':
      return new HostServiceError(
        'project_location_conflict',
        error.message,
        409,
      )
    case 'location_not_found':
      return new HostServiceError(
        'project_location_not_found',
        error.message,
        404,
      )
    case 'location_has_conversations':
      return new HostServiceError(
        'project_location_has_conversations',
        error.message,
        409,
      )
    case 'local_location_required':
      return new HostServiceError(
        'project_location_local_required',
        error.message,
        409,
      )
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}
