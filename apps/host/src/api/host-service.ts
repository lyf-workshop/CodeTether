import { randomUUID } from 'node:crypto'

import {
  canonicalFailure,
  type AgentEvent,
  type AgentProvider,
  type CanonicalFailure,
  type CanonicalFailureReason,
  type NativeProviderSessionCandidate,
  type ProviderSessionDiscovery,
  type ProviderSessionDiscoveryPage,
  type ProviderSessionResumeStatus,
} from '@codetether/agent-core'
import {
  ActionIdSchema,
  AdoptProviderSessionResponseSchema,
  ApprovalIdSchema,
  AttentionIdSchema,
  AttentionListResponseSchema,
  ConversationIdSchema,
  ConversationListResponseSchema,
  ConversationRecordSchema,
  ConversationSearchQuerySchema,
  ConversationSearchResponseSchema,
  ConversationSummarySchema,
  ConfigureMachineRelayResponseSchema,
  DisconnectMachineRelayResponseSchema,
  EnrollMachineRelayResponseSchema,
  EpochIdSchema,
  formatLastEventId,
  GetConversationResponseSchema,
  GetMachineResponseSchema,
  HostEventSchema,
  HostEventEnvelopeSchema,
  ListAttentionQuerySchema,
  ListMachinesResponseSchema,
  RemoveMachineRelayResponseSchema,
  RefreshMachineProvidersResponseSchema,
  RetryMachineRelayResponseSchema,
  ProjectIdSchema,
  MachineIdSchema,
  MachinePairingAttemptIdSchema,
  ListProjectConversationsQuerySchema,
  providerSessionDiscoveryLimits,
  protocolVersion,
  DiscoverProviderSessionsQuerySchema,
  DiscoverProviderSessionsResponseSchema,
  DiscoveryCandidateIdSchema,
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
  type ConfigureMachineRelayRequest,
  type ConfigureMachineRelayResponse,
  type CancelRemoteMachinePairingRequest,
  type CancelRemoteMachinePairingResponse,
  type ConfirmRemoteMachinePairingRequest,
  type ConfirmRemoteMachinePairingResponse,
  type CreateConversationRequest,
  type CreateConversationResponse,
  type DisconnectMachineRelayRequest,
  type DisconnectMachineRelayResponse,
  type EnrollMachineRelayRequest,
  type EnrollMachineRelayResponse,
  type HostError,
  type HostErrorCode,
  type HostEvent,
  type HostEventEnvelope,
  type HostSnapshot,
  type AdoptProviderSessionRequest,
  type AdoptProviderSessionResponse,
  type DiscoverProviderSessionsQuery,
  type DiscoverProviderSessionsResponse,
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
  type RelayMachineConnectivity,
  type MachinePairingAttemptId,
  type PinConversationRequest,
  type PinConversationResponse,
  type ProjectId,
  type MachineId,
  type ProviderDescriptor,
  type MachineProviderLifecycle,
  type ProviderInstallationId,
  type ProviderInstallationRevision,
  type ProviderInstallationSummary,
  type ProviderExecutionHealth,
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
  type RetryMachineRelayRequest,
  type RetryMachineRelayResponse,
  type RefreshMachineProvidersRequest,
  type RefreshMachineProvidersResponse,
  type RemoveMachineRelayRequest,
  type RemoveMachineRelayResponse,
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
  NativeProviderSessionBindingConflictError,
  captureTurnPresentation,
  initialTurnPresentation,
  parseDurableTurnPresentation,
  readDurableConversationDetail,
  restoreDurableConversations,
  type DurableApprovalHistoryRecord,
  type DurableConversation,
  type DurableConversationMutationResult,
  type DurableMachine,
  type DurableProviderExecutionHealthObservation,
  type DurableProviderInstallation,
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
  type ProviderRuntimeInstallation,
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
import { ProviderSessionDiscoveryRegistry } from './provider-session-discovery-registry.js'
import { encodeRemoteProviderSessionBinding } from './remote-provider-session-binding.js'
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
import {
  classifyCanonicalFailure,
  failureAffectsProviderExecutionHealth,
  providerExecutionHealthState,
  safeProviderHostError,
} from './canonical-failure.js'
import {
  ControllerRelayCoordinatorError,
  UnavailableControllerRelayCoordinator,
  type ControllerRelayCoordinator,
} from './controller-relay-coordinator.js'

const MAX_PENDING_PROVIDER_EVENTS = 512
const MAX_PENDING_PROVIDER_EVENT_BYTES = 4 * 1024 * 1024
const MAX_DISCOVERED_NATIVE_SESSIONS = 1_000
const PROVIDER_SESSION_ADAPTER_PAGE_SIZE = 100
const PROVIDER_SESSION_DISCOVERY_TOTAL_TIMEOUT_MS = 60_000
const PROVIDER_SESSION_DISCOVERY_MAXIMUM_PAGES = 100
const PROVIDER_SESSION_PRIVATE_ID_MAXIMUM_BYTES = 4 * 1024
const PROVIDER_SESSION_REVISION_MAXIMUM_BYTES = 128
const DEFAULT_MAX_CONCURRENT_PROVIDER_SESSION_SCANS = 4
export const DEFAULT_MAX_CONVERSATIONS = 8
export const DEFAULT_PERSISTENCE_FLUSH_MS = 300

interface PendingProviderEvent {
  readonly machineId: MachineId
  readonly runtime: AgentHostRuntime
  readonly event: AgentEvent
  readonly bytes: number
}

interface PendingProviderStartFailure {
  readonly key: string
  readonly machineId: MachineId
  readonly provider: AgentProvider
  readonly providerThreadId: string
  readonly providerTurnId: string
  readonly cleanup: Promise<void>
}

interface InFlightProviderSessionScan {
  readonly abort: AbortController
  promise: Promise<ProviderSessionDiscoveryPage>
  waiters: number
  settled: boolean
}

export class HostServiceError extends Error {
  constructor(
    readonly code: HostErrorCode,
    message: string,
    readonly httpStatus: number,
    readonly details?: HostError['details'],
    readonly failure?: CanonicalFailure,
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
  /** Initial presentation-safe local lifecycle observations. */
  readonly providerLifecycles?: readonly MachineProviderLifecycle[]
  /** Read-only Machine-local native-session metadata adapters. */
  readonly providerSessionDiscoveries?: readonly ProviderSessionDiscovery[]
  readonly workspacePolicy: WorkspacePolicy
  readonly publisher: HostEventPublisher
  readonly hostVersion: string
  readonly now?: () => Date
  readonly historyLimits?: ConversationRuntimeHistoryLimits
  readonly maxConversations?: number
  readonly persistence?: ConversationStore
  readonly persistenceFlushMs?: number
  /** Internal deterministic-test seam; production uses the fixed bounded scan deadline. */
  readonly providerSessionDiscoveryTimeoutMs?: number
  /** Internal deterministic-test seam; production admits a small process-wide scan set. */
  readonly maxConcurrentProviderSessionScans?: number
  /** True only for the Desktop-owned sidecar assembly. */
  readonly desktopManaged?: boolean
  readonly remoteMachineCoordinator?: RemoteMachineCoordinator
  readonly controllerRelayCoordinator?: ControllerRelayCoordinator
  /**
   * Bounded local recovery hook owned by the Host assembly. It may probe only
   * the fixed Provider executable and is invoked solely by an explicit
   * Conversation/Turn action after that Provider became unavailable.
   */
  readonly refreshUnavailableLocalProvider?: (
    provider: AgentProvider,
  ) => Promise<AgentHostRuntime>
  /** One Host-owned bounded lifecycle refresh authority per local Provider. */
  readonly refreshLocalProviderLifecycle?: (
    provider: AgentProvider,
  ) => Promise<{
    readonly runtime: AgentHostRuntime
    readonly lifecycle: MachineProviderLifecycle
    readonly sessionDiscovery?: ProviderSessionDiscovery
    /** Optional two-phase lifecycle publication owned by the local coordinator. */
    readonly commit?: () => MachineProviderLifecycle
    /** Releases a staged runtime if Host handoff cannot be completed safely. */
    readonly discard?: () => Promise<void>
  }>
}

/** Runtime authority for live state, optionally backed by durable normalized snapshots. */
export class HostService {
  readonly publisher: HostEventPublisher
  readonly #providers: ProviderRegistry
  readonly #providerSessionDiscoveries = new Map<
    AgentProvider,
    ProviderSessionDiscovery
  >()
  readonly #providerSessionCandidates: ProviderSessionDiscoveryRegistry
  readonly #providerSessionScans = new Map<
    string,
    InFlightProviderSessionScan
  >()
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
  readonly #controllerRelay: ControllerRelayCoordinator
  readonly #refreshUnavailableLocalProvider?: (
    provider: AgentProvider,
  ) => Promise<AgentHostRuntime>
  readonly #refreshLocalProviderLifecycle?: HostServiceOptions['refreshLocalProviderLifecycle']
  readonly #localProviderRefreshes = new Map<AgentProvider, Promise<void>>()
  readonly #projects: ProjectRegistry
  readonly #persistenceFlushMs: number
  readonly #providerSessionDiscoveryTimeoutMs: number
  readonly #maxConcurrentProviderSessionScans: number
  readonly #dirtyTurns = new Map<TurnId, ConversationId>()
  readonly #hydrations = new Map<ConversationId, Promise<ConversationState>>()
  readonly #runtimeAccess = new Map<ConversationId, number>()
  readonly #runtimePins = new Map<ConversationId, number>()
  readonly #pendingRuntimeDisposals = new Set<Promise<void>>()
  readonly #pendingProviderEvents: PendingProviderEvent[] = []
  readonly #pendingProviderStartFailures = new Map<
    string,
    PendingProviderStartFailure
  >()
  #runtimeAccessSequence = 0
  #runtimeReservations = 0
  #failedRuntimeDisposals = 0
  #pendingProviderEventBytes = 0
  #persistenceTimer?: ReturnType<typeof setTimeout>
  #persistenceFailure?: Error
  readonly #unsubscribeEvents = new Set<() => void>()
  readonly #unsubscribeApprovals = new Set<() => void>()
  readonly #unsubscribeFailures = new Set<() => void>()
  #unsubscribeRemoteMachineStatus?: () => void
  #unsubscribeRemoteMachineRemoval?: () => void
  #unsubscribeRemoteProviderDiscovery?: () => void
  #unsubscribeControllerRelay?: () => void
  readonly #runtimeFailures = new Map<AgentProvider, Error>()
  readonly #machineRuntimeFailures = new Map<string, Error>()
  readonly #providerExecutionHealth = new Map<
    string,
    DurableProviderExecutionHealthObservation
  >()
  /** Health observations established during this Host/connection epoch. */
  readonly #currentProviderExecutionHealth = new Set<string>()
  /** Monotonic Host-owned generation for every observed remote transport loss. */
  readonly #remoteTransportGenerations = new Map<MachineId, number>()
  readonly #runtimeSubscriptions = new Map<
    AgentHostRuntime,
    readonly [() => void, () => void, () => void]
  >()
  #closePromise?: Promise<void>
  #acceptingActions = true
  #closingRuntime = false

  constructor(options: HostServiceOptions) {
    const configuredRuntimes =
      options.runtimes ??
      (options.runtime === undefined ? [] : [options.runtime])
    this.#providers =
      options.providerRegistry ??
      new ProviderRegistry(configuredRuntimes, options.providerLifecycles)
    if (this.#providers.runtimes().length === 0) {
      throw new Error('Host requires at least one Provider runtime')
    }
    this.#workspacePolicy = options.workspacePolicy
    this.publisher = options.publisher
    this.#hostVersion = options.hostVersion
    this.#now = options.now ?? (() => new Date())
    this.#providerSessionCandidates = new ProviderSessionDiscoveryRegistry({
      now: () => this.#now().getTime(),
    })
    for (const discovery of options.providerSessionDiscoveries ?? []) {
      if (this.#providerSessionDiscoveries.has(discovery.provider)) {
        throw new Error(
          `Host received duplicate Provider session discovery adapter: ${discovery.provider}`,
        )
      }
      this.#providerSessionDiscoveries.set(discovery.provider, discovery)
    }
    this.#refreshUnavailableLocalProvider =
      options.refreshUnavailableLocalProvider
    this.#refreshLocalProviderLifecycle = options.refreshLocalProviderLifecycle
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
    this.#providerSessionDiscoveryTimeoutMs = positiveInteger(
      options.providerSessionDiscoveryTimeoutMs,
      PROVIDER_SESSION_DISCOVERY_TOTAL_TIMEOUT_MS,
      'providerSessionDiscoveryTimeoutMs',
    )
    this.#maxConcurrentProviderSessionScans = positiveInteger(
      options.maxConcurrentProviderSessionScans,
      DEFAULT_MAX_CONCURRENT_PROVIDER_SESSION_SCANS,
      'maxConcurrentProviderSessionScans',
    )
    this.#remoteMachines =
      options.remoteMachineCoordinator ??
      new UnavailableRemoteMachineCoordinator()
    this.#controllerRelay =
      options.controllerRelayCoordinator ??
      new UnavailableControllerRelayCoordinator()
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
      createRemoteProvider: (machineId, provider, installation) => {
        if (installation === undefined) return undefined
        switch (provider) {
          case 'codex':
            return this.#remoteMachines.openCodexSession === undefined
              ? undefined
              : new RemoteCodexHostRuntime({
                  machineId,
                  providerInstallationId: installation.installationId,
                  installationRevision: installation.installationRevision,
                  now: this.#now,
                  opener: {
                    open: async (input) => {
                      if (
                        input.providerInstallationId === undefined ||
                        input.expectedInstallationRevision === undefined
                      ) {
                        throw new Error(
                          'Remote Codex installation identity is missing',
                        )
                      }
                      return await this.#openRemoteCodexSession({
                        ...input,
                        providerInstallationId: input.providerInstallationId,
                        expectedInstallationRevision:
                          input.expectedInstallationRevision,
                      })
                    },
                  },
                })
          case 'claude-code':
            return this.#remoteMachines.openClaudeSession === undefined
              ? undefined
              : new RemoteClaudeHostRuntime({
                  machineId,
                  providerInstallationId: installation.installationId,
                  installationRevision: installation.installationRevision,
                  now: this.#now,
                  opener: {
                    open: async (input) => {
                      if (
                        input.providerInstallationId === undefined ||
                        input.expectedInstallationRevision === undefined
                      ) {
                        throw new Error(
                          'Remote Claude Code installation identity is missing',
                        )
                      }
                      return await this.#openRemoteClaudeSession({
                        ...input,
                        providerInstallationId: input.providerInstallationId,
                        expectedInstallationRevision:
                          input.expectedInstallationRevision,
                      })
                    },
                  },
                })
        }
      },
    })
    this.#unsubscribeRemoteMachineStatus =
      this.#remoteMachines.subscribeStatus?.((machineId, connectionState) => {
        try {
          if (connectionState !== 'online') {
            this.#remoteTransportGenerations.set(
              machineId,
              this.#remoteTransportGeneration(machineId) + 1,
            )
            this.#terminalizeActiveRemoteTurnsForTransportLoss(machineId)
            this.#invalidateRemoteProviderSessions(machineId)
            this.#markProviderExecutionHealthLastKnown(machineId)
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
        // Durable revocation recovery may finish after a Host restart, outside
        // the synchronous unpair action. Tear down the now-orphaned Relay
        // worker/configuration as a separate infrastructure lifecycle step.
        void this.#controllerRelay.remove(machineId).catch(() => undefined)
        try {
          this.#machines.removeRemote(machineId)
        } catch (error) {
          if (!(error instanceof MachineRegistryError)) throw error
          return
        }
        this.#forgetProviderExecutionHealth(machineId)
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
    this.#unsubscribeControllerRelay = this.#controllerRelay.subscribe(
      (machineId) => {
        try {
          const durable = this.#persistence?.getMachine(machineId)
          const trust = this.#persistence?.getTrustedMachinePeer(machineId)
          if (durable?.kind !== 'remote' || trust?.trustState !== 'active') {
            return
          }
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
      },
    )
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
      executionSucceeded: (conversation) =>
        this.#recordProviderExecutionSuccess(conversation),
      executionFailed: (conversation, _provider, error) =>
        this.#recordProviderExecutionFailure(conversation, error),
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
        providerLifecycles: this.#providerLifecyclesForMachine(machine),
        projects,
        conversations,
        ...(machine.kind === 'remote'
          ? {
              connection: this.#remoteConnection(machine),
              providerDiscovery:
                remoteProviderPresentation?.providerDiscovery ?? {
                  state: 'not_observed' as const,
                },
              relay: this.#publicRelayConnectivity(machine.machineId),
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
        if (persistence.getMachineRelayConfiguration(id) !== undefined) {
          try {
            await this.#controllerRelay.remove(id)
          } catch (error) {
            throw controllerRelayServiceError(error, this.#timestamp())
          }
        }
        this.#writeDurable(() => {
          if (!persistence.deleteRemoteMachine(id)) {
            throw new Error('Remote Machine disappeared during unpair')
          }
        })
        this.#machines.removeRemote(id)
        this.#forgetProviderExecutionHealth(id)
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
        if (machine.kind === 'local') {
          if (this.#refreshLocalProviderLifecycle === undefined) {
            throw new HostServiceError(
              'unsupported',
              'Local Provider lifecycle refresh is unavailable',
              409,
            )
          }
          await Promise.all(
            (['codex', 'claude-code'] as const).map(
              async (provider) =>
                await this.#refreshLocalProviderForExplicitStart(id, provider),
            ),
          )
          const providerLifecycles = this.#providers.lifecycles()
          const observedAt = providerLifecycles
            .flatMap((lifecycle) =>
              lifecycle.installations.map(
                (installation) => installation.lastObservedAt,
              ),
            )
            .sort()
            .at(-1)
          return RefreshMachineProvidersResponseSchema.parse({
            protocolVersion,
            actionId: request.actionId,
            status: 'completed',
            data: {
              machineId: id,
              providers: this.#providerDescriptors(),
              providerLifecycles,
              providerDiscovery:
                observedAt === undefined
                  ? { state: 'not_observed' }
                  : { state: 'current', observedAt },
            },
          })
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
              providerLifecycles:
                this.#persistence?.listProviderLifecycles(id) ?? [],
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

  async configureMachineRelay(
    machineId: MachineId,
    request: ConfigureMachineRelayRequest,
  ): Promise<ConfigureMachineRelayResponse> {
    const id = MachineIdSchema.parse(machineId)
    return await this.#executeAction(
      request.actionId,
      `machine.relay.configure:${id}`,
      { machineId: id, request },
      async () => {
        const { trust } = this.#requireRemoteMachineTrust(id)
        try {
          const relay = await this.#controllerRelay.configure(trust, {
            endpoint: request.endpoint,
            relayIdentityFingerprint: request.relayIdentityFingerprint,
            ...(request.displayLabel === undefined
              ? {}
              : { displayLabel: request.displayLabel }),
          })
          return ConfigureMachineRelayResponseSchema.parse({
            protocolVersion,
            actionId: request.actionId,
            status: 'completed',
            data: {
              machineId: id,
              relay: this.#publicRelayConnectivity(id, relay),
            },
          })
        } catch (error) {
          throw controllerRelayServiceError(error, this.#timestamp())
        }
      },
      false,
    )
  }

  async enrollMachineRelay(
    machineId: MachineId,
    request: EnrollMachineRelayRequest,
  ): Promise<EnrollMachineRelayResponse> {
    const id = MachineIdSchema.parse(machineId)
    return await this.#executeAction(
      request.actionId,
      `machine.relay.enroll:${id}`,
      // The bounded action cache retains only a digest of this input; the
      // one-time token is never persisted or logged by Host.
      { machineId: id, request },
      async () => {
        const { trust } = this.#requireRemoteMachineTrust(id)
        try {
          const relay = await this.#controllerRelay.enroll(
            trust,
            request.enrollmentToken,
          )
          return EnrollMachineRelayResponseSchema.parse({
            protocolVersion,
            actionId: request.actionId,
            status: 'completed',
            data: {
              machineId: id,
              relay: this.#publicRelayConnectivity(id, relay),
            },
          })
        } catch (error) {
          throw controllerRelayServiceError(error, this.#timestamp())
        }
      },
      false,
    )
  }

  async retryMachineRelay(
    machineId: MachineId,
    request: RetryMachineRelayRequest,
  ): Promise<RetryMachineRelayResponse> {
    const id = MachineIdSchema.parse(machineId)
    return await this.#executeAction(
      request.actionId,
      `machine.relay.retry:${id}`,
      { machineId: id, request },
      async () => {
        const { trust } = this.#requireRemoteMachineTrust(id)
        try {
          const relay = await this.#controllerRelay.retry(trust)
          return RetryMachineRelayResponseSchema.parse({
            protocolVersion,
            actionId: request.actionId,
            status: 'accepted',
            data: {
              machineId: id,
              relay: this.#publicRelayConnectivity(id, relay),
            },
          })
        } catch (error) {
          throw controllerRelayServiceError(error, this.#timestamp())
        }
      },
      false,
    )
  }

  async disconnectMachineRelay(
    machineId: MachineId,
    request: DisconnectMachineRelayRequest,
  ): Promise<DisconnectMachineRelayResponse> {
    const id = MachineIdSchema.parse(machineId)
    return await this.#executeAction(
      request.actionId,
      `machine.relay.disconnect:${id}`,
      { machineId: id, request },
      async () => {
        this.#requireRemoteMachineTrust(id)
        try {
          const relay = await this.#controllerRelay.disconnect(id)
          return DisconnectMachineRelayResponseSchema.parse({
            protocolVersion,
            actionId: request.actionId,
            status: 'completed',
            data: {
              machineId: id,
              relay: this.#publicRelayConnectivity(id, relay),
            },
          })
        } catch (error) {
          throw controllerRelayServiceError(error, this.#timestamp())
        }
      },
      false,
    )
  }

  async removeMachineRelay(
    machineId: MachineId,
    request: RemoveMachineRelayRequest,
  ): Promise<RemoveMachineRelayResponse> {
    const id = MachineIdSchema.parse(machineId)
    return await this.#executeAction(
      request.actionId,
      `machine.relay.remove:${id}`,
      { machineId: id, request },
      async () => {
        this.#requireRemoteMachineTrust(id)
        try {
          const relay = await this.#controllerRelay.remove(id)
          return RemoveMachineRelayResponseSchema.parse({
            protocolVersion,
            actionId: request.actionId,
            status: 'completed',
            data: {
              machineId: id,
              relay: this.#publicRelayConnectivity(id, relay),
            },
          })
        } catch (error) {
          throw controllerRelayServiceError(error, this.#timestamp())
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
          machine = this.#machines.get(request.machineId)
          if (machine.availability !== 'available') {
            throw machineUnavailableError(machine, this.#timestamp())
          }
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

  async discoverProviderSessions(
    projectId: ProjectId,
    machineId: MachineId,
    query: DiscoverProviderSessionsQuery,
    signal?: AbortSignal,
  ): Promise<DiscoverProviderSessionsResponse> {
    if (this.#persistence === undefined) {
      throw new HostServiceError(
        'runtime_unavailable',
        'Durable Provider session adoption is unavailable',
        503,
      )
    }
    const project = ProjectIdSchema.parse(projectId)
    const machine = MachineIdSchema.parse(machineId)
    const options = DiscoverProviderSessionsQuerySchema.parse(query)
    if (options.cursor !== undefined) {
      const cached = this.#providerSessionCandidates.page({
        projectId: project,
        machineId: machine,
        ...(options.provider === undefined
          ? {}
          : { providerFilter: options.provider }),
        cursor: options.cursor,
        limit: options.limit,
      })
      if (cached === undefined) {
        throw new HostServiceError(
          'provider_session_candidate_expired',
          'Previous conversation results expired; scan again',
          409,
        )
      }
      return DiscoverProviderSessionsResponseSchema.parse(cached)
    }

    let durableProject
    let machineRecord
    try {
      durableProject = this.#projects.require(project)
      machineRecord = this.#machines.get(machine)
    } catch (error) {
      if (error instanceof ProjectRegistryError)
        throw projectServiceError(error)
      throw machineServiceError(error)
    }
    const location = durableProject.locations.find(
      (candidate) => candidate.machineId === machine,
    )
    if (location === undefined) {
      throw new HostServiceError(
        'project_location_not_found',
        'Project has no location on the selected Machine',
        404,
      )
    }
    const providers: readonly AgentProvider[] =
      options.provider === undefined
        ? ['codex', 'claude-code']
        : [options.provider]
    const discoveryInstallations = new Map<
      AgentProvider,
      ProviderRuntimeInstallation
    >()
    for (const provider of providers) {
      const lifecycle = this.#providerLifecyclesForMachine(machineRecord).find(
        (candidate) => candidate.provider === provider,
      )
      if (lifecycle === undefined) continue
      const installation = this.#providerInstallation(
        machine,
        provider,
        lifecycle.selectedInstallationId,
      )
      if (
        installation?.revision !== undefined &&
        installation.availability === 'available'
      ) {
        discoveryInstallations.set(provider, {
          installationId: installation.installationId,
          installationRevision: installation.revision,
        })
      }
    }
    const pages = await Promise.all(
      providers.map(async (provider) => {
        if (
          machineRecord.kind === 'remote' &&
          machineRecord.connectionState !== 'online'
        ) {
          return unavailableProviderSessionDiscoveryPage(
            provider,
            'machine_offline',
          )
        }
        try {
          return this.#withCurrentProviderSessionResumeStatus(
            machine,
            provider,
            await this.#scanProviderSessions(
              project,
              machine,
              location.rootPath,
              provider,
              signal,
            ),
          )
        } catch (error) {
          if (signal?.aborted || isAbortError(error)) throw error
          return unavailableProviderSessionDiscoveryPage(
            provider,
            'provider_session_discovery_unavailable',
          )
        }
      }),
    )
    const response = this.#providerSessionCandidates.createSnapshot({
      projectId: project,
      machineId: machine,
      rootPath: location.rootPath,
      ...(options.provider === undefined
        ? {}
        : { providerFilter: options.provider }),
      pages,
      installationForProvider: (provider) =>
        discoveryInstallations.get(provider),
      adoptedConversation: (candidate) =>
        this.#persistence?.getConversationByProviderSession(
          machine,
          candidate.provider,
          this.#materializeProviderSessionBinding(
            machine,
            candidate.provider,
            candidate.nativeSessionId,
          ),
        )?.conversationId,
      limit: options.limit,
    })
    return DiscoverProviderSessionsResponseSchema.parse(response)
  }

  async adoptProviderSession(
    projectId: ProjectId,
    machineId: MachineId,
    request: AdoptProviderSessionRequest,
  ): Promise<AdoptProviderSessionResponse> {
    const project = ProjectIdSchema.parse(projectId)
    const machine = MachineIdSchema.parse(machineId)
    const candidateId = DiscoveryCandidateIdSchema.parse(
      request.discoveryCandidateId,
    )
    return await this.#executeAction(
      request.actionId,
      `provider.session.adopt:${project}:${machine}`,
      { projectId: project, machineId: machine, candidateId },
      async () => {
        const persistence = this.#persistence
        if (persistence === undefined) {
          throw new HostServiceError(
            'runtime_unavailable',
            'Durable Provider session adoption is unavailable',
            503,
          )
        }
        const candidate = this.#providerSessionCandidates.candidate(
          candidateId,
          { projectId: project, machineId: machine },
        )
        if (candidate === undefined) throw expiredDiscoveryCandidate()
        if (candidate.native.resumeStatus !== 'supported') {
          throw providerUnavailableError(
            candidate.native.provider,
            this.#providerDescriptorForMachine(
              machine,
              candidate.native.provider,
            ),
          )
        }
        let durableProject
        try {
          durableProject = this.#projects.require(project)
        } catch (error) {
          if (error instanceof ProjectRegistryError) {
            throw expiredDiscoveryCandidate()
          }
          throw error
        }
        const location = durableProject.locations.find(
          (entry) => entry.machineId === machine,
        )
        if (
          location === undefined ||
          location.rootPath !== candidate.rootPath
        ) {
          throw expiredDiscoveryCandidate()
        }
        const validated =
          await this.#validateProviderSessionCandidate(candidate)
        if (
          validated === undefined ||
          validated.provider !== candidate.native.provider ||
          validated.nativeSessionId !== candidate.native.nativeSessionId ||
          validated.revision !== candidate.native.revision ||
          validated.workingDirectory !== candidate.native.workingDirectory ||
          validated.resumeStatus !== 'supported'
        ) {
          throw expiredDiscoveryCandidate()
        }
        this.#assertProviderSessionResumeReady(machine, validated.provider)
        const providerInstallation =
          candidate.providerInstallationId === undefined
            ? undefined
            : this.#requireProviderRuntimeInstallation(
                machine,
                validated.provider,
                candidate.providerInstallationId,
              )
        if (
          candidate.installationRevision !== undefined &&
          providerInstallation?.installationRevision !==
            candidate.installationRevision
        ) {
          throw expiredDiscoveryCandidate()
        }
        const reservation = await this.#projects.reserveConversationCreation(
          project,
          machine,
          validated.workingDirectory,
        )
        try {
          const timestamp = TimestampSchema.parse(this.#timestamp())
          let adoption
          try {
            adoption = this.#writeDurableResult(() =>
              persistence.createOrGetAdoptedConversation({
                conversationId: newConversationId(),
                projectId: project,
                machineId: machine,
                title: validated.title,
                titleSource: 'generated',
                provider: validated.provider,
                ...(providerInstallation === undefined
                  ? {}
                  : {
                      providerInstallationId:
                        providerInstallation.installationId,
                    }),
                providerThreadId: this.#materializeProviderSessionBinding(
                  machine,
                  validated.provider,
                  validated.nativeSessionId,
                ),
                cwd: reservation.cwd,
                status: 'idle',
                createdAt: timestamp,
                updatedAt: timestamp,
                lastActivityAt: validated.lastActiveAt ?? timestamp,
              }),
            )
          } catch (error) {
            if (error instanceof NativeProviderSessionBindingConflictError) {
              throw new HostServiceError(
                'conflict',
                'Previous Provider conversation is already bound elsewhere',
                409,
              )
            }
            throw error
          }
          const conversation = conversationRecordFromDurable(
            adoption.conversation,
          )
          this.#providerSessionCandidates.markAdopted(
            machine,
            validated.provider,
            validated.nativeSessionId,
            conversation.conversationId,
          )
          if (adoption.created) {
            this.#publish({
              conversationId: conversation.conversationId,
              timestamp,
              type: 'conversation.started',
              payload: { conversation },
            })
          }
          return AdoptProviderSessionResponseSchema.parse({
            protocolVersion,
            actionId: request.actionId,
            status: 'completed',
            data: {
              conversation,
              disposition: adoption.created ? 'adopted' : 'already_adopted',
            },
          })
        } finally {
          reservation.release()
        }
      },
      false,
    )
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
    const durableConversation = this.#persistence.getConversation(id)
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
    const providerLifecycle =
      durableConversation?.providerInstallationId === undefined
        ? undefined
        : this.#providerInstallation(
            durableConversation.machineId,
            durableConversation.provider,
            durableConversation.providerInstallationId,
          )
    const providerSessionRequiresResume =
      hydrated === undefined
        ? durableConversation?.providerThreadId !== undefined
        : hydrated.providerSession !== 'ready' &&
          hydrated.providerSession !== 'uninitialized'

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
      ...(providerLifecycle === undefined ? {} : { providerLifecycle }),
      providerSessionRequiresResume,
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
          machine = this.#machines.get(request.machineId)
          if (machine.availability !== 'available') {
            throw machineUnavailableError(machine, this.#timestamp())
          }
        } catch (error) {
          throw machineServiceError(error)
        }
        await this.#refreshLocalProviderForExplicitStart(
          machine.machineId,
          request.provider,
        )
        const machineProvider = this.#providerDescriptorForMachine(
          machine.machineId,
          request.provider,
        )
        if (
          machineProvider === undefined ||
          machineProvider.availability !== 'available' ||
          !this.#machineRuntimeAvailable(machine.machineId, request.provider)
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
          const releaseRuntimeSlot = await this.#reserveRuntimeSlot()
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
              ...(runtime.installation === undefined
                ? {}
                : {
                    providerInstallationId: runtime.installation.installationId,
                  }),
              origin: 'codetether',
              providerSessionMaterialized: false,
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
                origin: 'codetether',
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
                origin: 'codetether',
                ...(runtime.installation === undefined
                  ? {}
                  : {
                      providerInstallationId:
                        runtime.installation.installationId,
                    }),
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
              const observedAt = this.#timestamp()
              const failure = classifyCanonicalFailure(
                error,
                observedAt,
                'provider_start_failed',
              )
              if (failureAffectsProviderExecutionHealth(failure)) {
                this.#recordProviderExecutionHealth({
                  machineId: machine.machineId,
                  provider: request.provider,
                  state: providerExecutionHealthState(failure),
                  failure,
                  observedAt: TimestampSchema.parse(observedAt),
                })
              }
              throw hostServiceErrorForFailure(request.provider, failure)
            }
            try {
              this.#assertMachineRuntimeAvailable(
                machine.machineId,
                request.provider,
              )

              const sessionKey = providerSessionKey(
                machine.machineId,
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
                      conversation.machineId === machine.machineId &&
                      conversation.provider === request.provider &&
                      conversation.providerThreadId ===
                        provider.providerThreadId,
                  ) === true
              ) {
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
                  origin: 'codetether',
                  provider: request.provider,
                  cwd,
                  ...(provider.model === undefined &&
                  request.model === undefined
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
                throw providerCommandError(
                  request.provider,
                  'return valid conversation metadata',
                  error,
                )
              }
              const state: ConversationState = {
                record,
                origin: 'codetether',
                ...(runtime.installation === undefined
                  ? {}
                  : {
                      providerInstallationId:
                        runtime.installation.installationId,
                    }),
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
            } catch (error) {
              return await this.#rollbackAcquiredProviderConversation(
                conversationId,
                request.provider,
                provider.providerThreadId,
                runtime,
                error,
              )
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
        const parsedConversationId = ConversationIdSchema.parse(conversationId)
        const durableActionTurn = this.#persistence?.getTurnForStartAction(
          request.actionId,
        )
        if (durableActionTurn !== undefined) {
          if (
            durableActionTurn.conversationId !== parsedConversationId ||
            durableActionTurn.input.type !== request.input.type ||
            durableActionTurn.input.text !== request.input.text
          ) {
            throw new HostServiceError(
              'conflict',
              'Action id was already used for a different Turn start',
              409,
            )
          }
          return {
            protocolVersion,
            actionId: request.actionId,
            status: 'accepted',
            data: {
              turn: parseDurableTurnPresentation(durableActionTurn.snapshot)
                .turn,
            },
          }
        }
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
          const machine = this.#machines.get(conversationMachineId)
          if (machine.availability !== 'available') {
            throw machineUnavailableError(machine, this.#timestamp())
          }
        } catch (error) {
          throw machineServiceError(error)
        }
        await this.#refreshLocalProviderForExplicitStart(
          conversationMachineId,
          conversationProvider,
        )
        this.#assertMachineRuntimeAvailable(
          conversationMachineId,
          conversationProvider,
        )
        const admittedTransportGeneration = this.#remoteTransportGeneration(
          conversationMachineId,
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
            const failure = canonicalFailure(
              'conversation_busy',
              this.#timestamp(),
            )
            throw new HostServiceError(
              'conflict',
              'Conversation already has an active Turn',
              409,
              undefined,
              failure,
            )
          }
          this.#assertProviderInstallationCapabilities(
            conversation.record.machineId,
            conversation.record.provider,
            conversation.providerInstallationId,
            conversation.providerSession !== 'ready' &&
              conversation.providerSession !== 'uninitialized',
            conversation.record.provider === 'claude-code' &&
              conversation.record.reasoning !== undefined,
          )
          conversation.startingTurn = true
        } finally {
          releaseRuntimePin()
        }
        this.#touchConversation(conversation.record.conversationId)
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
            this.#persistence?.createTurnForStartAction({
              actionId: request.actionId,
              turn: {
                turnId,
                conversationId,
                input: record.input!,
                status: 'starting',
                startedAt: timestamp,
                snapshotVersion: DURABLE_TURN_SNAPSHOT_VERSION,
                snapshot: initialTurnPresentation(record),
              },
              conversation: {
                ...this.#durableConversation(conversation),
                title:
                  nextConversationRecord.title ?? DEFAULT_CONVERSATION_TITLE,
                updatedAt: nextConversationRecord.updatedAt,
                lastActivityAt:
                  nextConversationRecord.lastActivityAt ??
                  nextConversationRecord.updatedAt,
              },
            })
          })
          conversation.record = nextConversationRecord
        } catch (error) {
          conversation.startingTurn = false
          throw error
        }

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
              conversation.record.machineId,
              conversation.record.cwd,
            )
          ).cwd
        } catch (error) {
          conversation.startingTurn = false
          const mapped = projectServiceError(error)
          const failure = classifyCanonicalFailure(
            mapped,
            this.#timestamp(),
            'project_location_unavailable',
          )
          this.#recordProviderStartFailure(
            conversation,
            record,
            safeProviderHostError(conversation.record.provider, failure),
          )
          throw hostServiceErrorForFailure(
            conversation.record.provider,
            failure,
          )
        }

        let runtime: AgentHostRuntime
        try {
          await this.#releaseObsoleteConversationInstallation(conversation)
          runtime = this.#requireMachineProviderRuntime(
            conversation.record.machineId,
            conversation.record.provider,
            conversation,
          )
          await this.#ensureProviderConversation(
            conversation,
            authorizedCwd,
            runtime,
          )
          if (
            this.#remoteTransportLostSince(
              conversation.record.machineId,
              admittedTransportGeneration,
            )
          ) {
            throw hostServiceErrorForFailure(
              conversation.record.provider,
              canonicalFailure('transport_lost', this.#timestamp()),
            )
          }
        } catch (error) {
          conversation.startingTurn = false
          const failure = classifyCanonicalFailure(
            error,
            this.#timestamp(),
            'provider_start_failed',
          )
          this.#recordProviderStartFailure(
            conversation,
            record,
            safeProviderHostError(conversation.record.provider, failure),
          )
          throw hostServiceErrorForFailure(
            conversation.record.provider,
            failure,
          )
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
        const transportLostDuringStart = this.#remoteTransportLostSince(
          conversation.record.machineId,
          admittedTransportGeneration,
        )
        const providerStartFailure = this.#findPendingProviderStartFailure(
          conversation.record.machineId,
          conversation.record.provider,
          requireProviderThreadId(conversation),
          provider?.providerTurnId,
        )
        if (providerStartFailure !== undefined) {
          const cleanupError =
            await this.#settlePendingProviderStartFailure(providerStartFailure)
          conversation.startingTurn = false
          conversation.providerSessionMaterialized = true
          conversation.providerSession =
            cleanupError === undefined ? 'needs-resume' : 'unavailable'
          const failure = canonicalFailure(
            'protocol_limit_exceeded',
            this.#timestamp(),
          )
          const responseFailure =
            cleanupError === undefined
              ? failure
              : canonicalFailure(
                  'execution_ownership_uncertain',
                  this.#timestamp(),
                )
          const error = safeProviderHostError(
            conversation.record.provider,
            responseFailure,
          )
          this.#recordProviderStartFailure(conversation, record, error)
          this.#flushProviderEvents()
          throw hostServiceErrorForFailure(
            conversation.record.provider,
            responseFailure,
          )
        }
        if (transportLostDuringStart) {
          conversation.startingTurn = false
          this.#invalidateRemoteProviderSession(conversation)
          const failure = canonicalFailure('transport_lost', this.#timestamp())
          const failedTurn = this.#recordProviderStartFailure(
            conversation,
            record,
            safeProviderHostError(conversation.record.provider, failure),
          )
          this.#flushProviderEvents()
          // The Provider accepted the execution before the authenticated
          // transport was lost. Preserve the frozen accepted-start contract:
          // the action resolves to its one durable terminal Turn rather than
          // making an HTTP response look like proof that execution never
          // started. Replaying this action resolves to the same failed Turn.
          return {
            protocolVersion,
            actionId: request.actionId,
            status: 'accepted',
            data: { turn: failedTurn },
          }
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
          const failure = classifyCanonicalFailure(
            startError,
            this.#timestamp(),
            unavailable
              ? 'remote_execution_unavailable'
              : 'provider_start_failed',
          )
          const error = safeProviderHostError(
            conversation.record.provider,
            failure,
          )
          this.#recordProviderStartFailure(conversation, record, error)
          this.#flushProviderEvents()
          throw hostServiceErrorForFailure(
            conversation.record.provider,
            failure,
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
          const cleanupVerified = await this.#disposeInvalidProviderTurnSession(
            conversation,
            runtime,
          )
          const failure = canonicalFailure(
            cleanupVerified
              ? 'provider_protocol_error'
              : 'execution_ownership_uncertain',
            this.#timestamp(),
          )
          this.#recordProviderStartFailure(
            conversation,
            record,
            safeProviderHostError(conversation.record.provider, failure),
          )
          this.#flushProviderEvents()
          throw hostServiceErrorForFailure(
            conversation.record.provider,
            failure,
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
        const runtime =
          this.#machineRuntimes.existingSession(
            conversation.record.machineId,
            conversation.record.provider,
            conversation.providerInstallationId,
            requireProviderThreadId(conversation),
          ) ??
          this.#requireMachineProviderRuntime(
            conversation.record.machineId,
            conversation.record.provider,
            conversation,
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

  /**
   * Private Desktop lifecycle seam. Platform resume/network-restored hints
   * are advisory and coalesced by the existing socket owners; they never
   * create an action, Provider session, Turn, or deferred Prompt.
   */
  requestNetworkRecovery(reason: 'desktop_resume'): {
    readonly relayWorkers: number
    readonly machineWorkers: number
  } {
    if (reason !== 'desktop_resume' || !this.#acceptingActions) {
      return { relayWorkers: 0, machineWorkers: 0 }
    }
    let relayWorkers = 0
    let machineWorkers = 0
    try {
      relayWorkers = this.#controllerRelay.requestReconnect?.() ?? 0
    } catch {
      // Recovery hints are best effort. Keep independent socket owners
      // isolated so one observer cannot prevent the other from waking.
    }
    try {
      machineWorkers = this.#remoteMachines.requestReconnect?.() ?? 0
    } catch {
      // The coordinator remains responsible for its canonical status/error.
    }
    return { relayWorkers, machineWorkers }
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

  #acceptProviderEvent(
    machineId: MachineId,
    runtime: AgentHostRuntime,
    event: AgentEvent,
  ): void {
    if (this.#providerEventTranslator.translate(machineId, event)) return
    if (!('turnId' in event)) {
      throw new Error('Provider emitted an unbound event without Turn identity')
    }
    if (
      this.#findPendingProviderStartFailure(
        machineId,
        event.provider,
        event.threadId,
      ) !== undefined
    ) {
      return
    }
    const bytes = Buffer.byteLength(JSON.stringify(event), 'utf8')
    if (
      this.#pendingProviderEvents.length >= MAX_PENDING_PROVIDER_EVENTS ||
      this.#pendingProviderEventBytes + bytes > MAX_PENDING_PROVIDER_EVENT_BYTES
    ) {
      this.#rejectPendingProviderStart(machineId, runtime, event)
      return
    }
    this.#pendingProviderEvents.push({ machineId, runtime, event, bytes })
    this.#pendingProviderEventBytes += bytes
  }

  #rejectPendingProviderStart(
    machineId: MachineId,
    runtime: AgentHostRuntime,
    event: AgentEvent & { readonly turnId: string },
  ): void {
    const existing = this.#findPendingProviderStartFailure(
      machineId,
      event.provider,
      event.threadId,
    )
    if (existing !== undefined) return

    this.#dropPendingProviderEvents(
      machineId,
      event.provider,
      event.threadId,
      event.turnId,
    )
    const key = providerStartFailureKey(
      machineId,
      event.provider,
      event.threadId,
      event.turnId,
    )
    const cleanup =
      runtime.disposeConversation === undefined
        ? Promise.reject(
            new Error(
              'Provider runtime cannot release exact session ownership',
            ),
          )
        : Promise.resolve().then(async () => {
            await runtime.disposeConversation?.({
              providerThreadId: event.threadId,
            })
          })
    const failure: PendingProviderStartFailure = {
      key,
      machineId,
      provider: event.provider,
      providerThreadId: event.threadId,
      providerTurnId: event.turnId,
      cleanup,
    }
    this.#pendingProviderStartFailures.set(key, failure)
    // Event observers are synchronous Provider callbacks. Keep rejection
    // observed here; the owning Start action awaits and classifies it below.
    void cleanup.catch(() => {
      const conversationId = this.#providerThreads.get(
        providerSessionKey(machineId, event.provider, event.threadId),
      )
      const conversation =
        conversationId === undefined
          ? undefined
          : this.#conversations.get(conversationId)
      if (
        conversation?.record.machineId === machineId &&
        conversation.record.provider === event.provider
      ) {
        conversation.providerSession = 'unavailable'
      }
    })
  }

  #findPendingProviderStartFailure(
    machineId: MachineId,
    provider: AgentProvider,
    providerThreadId: string,
    providerTurnId?: string,
  ): PendingProviderStartFailure | undefined {
    if (providerTurnId !== undefined) {
      const exact = this.#pendingProviderStartFailures.get(
        providerStartFailureKey(
          machineId,
          provider,
          providerThreadId,
          providerTurnId,
        ),
      )
      if (exact !== undefined) return exact
    }
    return [...this.#pendingProviderStartFailures.values()].find(
      (failure) =>
        failure.machineId === machineId &&
        failure.provider === provider &&
        failure.providerThreadId === providerThreadId,
    )
  }

  #dropPendingProviderEvents(
    machineId: MachineId,
    provider: AgentProvider,
    providerThreadId: string,
    providerTurnId: string,
  ): void {
    const retained = this.#pendingProviderEvents.filter(
      (pending) =>
        pending.machineId !== machineId ||
        pending.event.provider !== provider ||
        pending.event.threadId !== providerThreadId ||
        !('turnId' in pending.event) ||
        pending.event.turnId !== providerTurnId,
    )
    this.#pendingProviderEvents.length = 0
    this.#pendingProviderEvents.push(...retained)
    this.#pendingProviderEventBytes = retained.reduce(
      (total, pending) => total + pending.bytes,
      0,
    )
  }

  async #settlePendingProviderStartFailure(
    failure: PendingProviderStartFailure,
  ): Promise<unknown | undefined> {
    try {
      await failure.cleanup
      if (this.#pendingProviderStartFailures.get(failure.key) === failure) {
        this.#pendingProviderStartFailures.delete(failure.key)
      }
      return undefined
    } catch (error) {
      // Retain the rejected cleanup as a permanent session-scoped barrier.
      return error
    }
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
    for (const buffered of pending) {
      if (
        !this.#providerEventTranslator.translate(
          buffered.machineId,
          buffered.event,
        )
      ) {
        this.#acceptProviderEvent(
          buffered.machineId,
          buffered.runtime,
          buffered.event,
        )
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
    const completedAt = this.#timestamp()
    const error = {
      code: 'runtime_unavailable' as const,
      message: 'Conversation durability became unavailable',
      failure: canonicalFailure('runtime_error', completedAt),
    }
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
      durable.record.machineId,
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
      origin: durable.origin,
      ...(durable.providerInstallationId === undefined
        ? {}
        : { providerInstallationId: durable.providerInstallationId }),
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
    const releaseRuntimeSlot = await this.#reserveRuntimeSlot(conversationId)
    try {
      const alreadyHydrated = this.#conversations.get(conversationId)
      if (alreadyHydrated !== undefined) return alreadyHydrated
      // Slot admission may wait for an exact Provider-session disposal. Read
      // durable truth again after that wait so metadata mutations such as
      // Archive cannot be overwritten by a stale pre-admission snapshot.
      const currentDurableConversation =
        this.#persistence.getConversation(conversationId)
      if (
        currentDurableConversation === undefined ||
        currentDurableConversation.status === 'creating'
      ) {
        throw new HostServiceError(
          'not_found',
          'Conversation was not found',
          404,
        )
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
        throw new HostServiceError(
          'not_found',
          'Conversation was not found',
          404,
        )
      }
      if (currentDurableConversation.providerThreadId === undefined) {
        const machine = this.#machines.get(durable.record.machineId)
        if (machine.kind !== 'remote' || durable.history.totalTurns !== 0) {
          throw providerConversationUnavailableError(
            currentDurableConversation.provider,
          )
        }
        this.#runtimeHistory.restore(durable.runtime)
        this.#conversations.set(conversationId, {
          record: durable.record,
          origin: currentDurableConversation.origin,
          ...(currentDurableConversation.providerInstallationId === undefined
            ? {}
            : {
                providerInstallationId:
                  currentDurableConversation.providerInstallationId,
              }),
          turns: new Map(),
          providerTurnIds: new Map(),
          providerSessionMaterialized: false,
          providerSession: 'uninitialized',
          startingTurn: false,
        })
      } else {
        const providerOwner = this.#providerThreads.get(
          providerSessionKey(
            currentDurableConversation.machineId,
            currentDurableConversation.provider,
            currentDurableConversation.providerThreadId,
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
          providerThreadId: currentDurableConversation.providerThreadId,
          origin: currentDurableConversation.origin,
          ...(currentDurableConversation.providerInstallationId === undefined
            ? {}
            : {
                providerInstallationId:
                  currentDurableConversation.providerInstallationId,
              }),
          providerSessionMaterialized:
            currentDurableConversation.providerSessionMaterialized,
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

  async #reserveRuntimeSlot(
    protectedConversationId?: ConversationId,
  ): Promise<() => void> {
    while (
      this.#conversations.size +
        this.#runtimeReservations +
        this.#pendingRuntimeDisposals.size +
        this.#failedRuntimeDisposals >=
      this.#maxConversations
    ) {
      if (this.#pendingRuntimeDisposals.size > 0) {
        await Promise.race(this.#pendingRuntimeDisposals)
        continue
      }
      if (this.#persistence === undefined) {
        const failure = canonicalFailure(
          'execution_capacity_reached',
          this.#timestamp(),
        )
        throw new HostServiceError(
          'runtime_unavailable',
          'Host Conversation capacity is temporarily exhausted',
          503,
          { maxConversations: this.#maxConversations },
          failure,
        )
      }
      const candidate = this.#runtimeEvictionCandidate(protectedConversationId)
      if (candidate === undefined) {
        const failure = canonicalFailure(
          'execution_capacity_reached',
          this.#timestamp(),
        )
        throw new HostServiceError(
          'runtime_unavailable',
          'Host Conversation working set is temporarily exhausted',
          503,
          { maxConversations: this.#maxConversations },
          failure,
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
      const runtime = this.#machineRuntimes.existingSession(
        conversation.record.machineId,
        conversation.record.provider,
        conversation.providerInstallationId,
        providerThreadId,
      )
      if (runtime?.disposeConversation !== undefined) {
        const disposal: Promise<void> = Promise.resolve()
          .then(
            async () =>
              await runtime.disposeConversation?.({ providerThreadId }),
          )
          .then(async () => {
            await this.#machineRuntimes.retireIfIdle(runtime)
          })
          .catch(() => {
            // A failed exact-session cleanup remains charged to the global
            // budget. The Host cannot safely assume that Provider ownership
            // was released until the owning runtime itself is shut down.
            this.#failedRuntimeDisposals += 1
          })
          .finally(() => {
            this.#pendingRuntimeDisposals.delete(disposal)
          })
        this.#pendingRuntimeDisposals.add(disposal)
      }
      if (
        this.#providerThreads.get(
          providerSessionKey(
            conversation.record.machineId,
            conversation.record.provider,
            providerThreadId,
          ),
        ) === conversationId
      ) {
        this.#providerThreads.delete(
          providerSessionKey(
            conversation.record.machineId,
            conversation.record.provider,
            providerThreadId,
          ),
        )
      }
    }
    this.#runtimeHistory.delete(conversationId)
    this.#runtimeAccess.delete(conversationId)
  }

  async #disposeInvalidProviderTurnSession(
    conversation: ConversationState,
    runtime: AgentHostRuntime,
  ): Promise<boolean> {
    const providerThreadId = conversation.providerThreadId
    if (
      providerThreadId === undefined ||
      runtime.disposeConversation === undefined
    ) {
      return false
    }
    conversation.providerSession = 'needs-resume'
    conversation.providerSessionMaterialized = true
    try {
      // `runtime` is the exact Machine + Provider owner selected for this
      // Turn. Wait for its session-scoped cleanup before publishing failure,
      // so a malformed/reused acknowledgement cannot leave untracked work.
      await runtime.disposeConversation({ providerThreadId })
      return true
    } catch {
      conversation.providerSession = 'unavailable'
      return false
    }
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

  #terminalizeActiveRemoteTurnsForTransportLoss(machineId: MachineId): void {
    // Graceful Host shutdown owns its own reconciliation path. A live Host
    // observing a trusted transport transition, however, knows that any
    // active remote Turn lost its Controller channel and must fail closed.
    if (this.#closePromise !== undefined) return
    const occurredAt = this.#timestamp()
    for (const conversation of this.#conversations.values()) {
      if (conversation.record.machineId !== machineId) continue
      const activeTurnId = conversation.record.activeTurnId
      if (activeTurnId === undefined) continue
      const turn = conversation.turns.get(activeTurnId)
      if (turn === undefined || turn.record.status !== 'running') continue
      const failure = canonicalFailure('transport_lost', occurredAt)
      const error = safeProviderHostError(conversation.record.provider, failure)
      this.#completeTurn(conversation, turn, 'failed', occurredAt, { error })
      this.#publish({
        conversationId: conversation.record.conversationId,
        turnId: turn.record.turnId,
        timestamp: occurredAt,
        type: 'turn.failed',
        payload: { error },
      })
    }
  }

  #remoteTransportGeneration(machineId: MachineId): number {
    return this.#remoteTransportGenerations.get(machineId) ?? 0
  }

  #remoteTransportLostSince(machineId: MachineId, generation: number): boolean {
    if (machineId === this.#machines.localMachineId()) return false
    if (this.#remoteTransportGeneration(machineId) !== generation) return true
    try {
      const machine = this.#machines.get(machineId)
      return machine.kind === 'remote' && machine.connectionState !== 'online'
    } catch {
      return true
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
    const runtime = this.#machineRuntimes.existingSession(
      conversation.record.machineId,
      conversation.record.provider,
      conversation.providerInstallationId,
      providerThreadId,
    )
    if (runtime?.disposeConversation !== undefined) {
      void runtime
        .disposeConversation({ providerThreadId })
        .then(async () => await this.#machineRuntimes.retireIfIdle(runtime))
        .catch(() => undefined)
    }
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
    const previousProviderSession = conversation.providerSession
    const previousProviderThreadId = conversation.providerThreadId
    const previousRecord = conversation.record
    let acquiredProviderThreadId: string | undefined
    let retained = false
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
      acquiredProviderThreadId = resumed.providerThreadId
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
        conversation.record.machineId,
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
              candidate.machineId === conversation.record.machineId &&
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
      // This Host-private native Session identity is durable before the
      // Prompt can cross the remote transport. A retry can therefore resume
      // rather than silently creating a second Provider Session.
      this.#writeDurable(() => {
        this.#persistence?.updateConversation(
          this.#durableConversation(conversation),
        )
      })
      this.#providerThreads.set(sessionKey, conversation.record.conversationId)
      conversation.providerSession = 'ready'
      retained = true
    } catch (error) {
      if (!retained && acquiredProviderThreadId !== undefined) {
        conversation.record = previousRecord
        conversation.providerThreadId = previousProviderThreadId
        conversation.providerSession = previousProviderSession
        try {
          await runtime.disposeConversation?.({
            providerThreadId: acquiredProviderThreadId,
          })
        } catch (cleanupError) {
          conversation.providerSession = 'unavailable'
          throw providerCommandError(
            conversation.record.provider,
            'clean up conversation ownership',
            new AggregateError(
              [error, cleanupError],
              'Provider acquisition and exact cleanup both failed',
            ),
          )
        }
      }
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
    error: HostError,
  ): TurnRecord {
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
    this.#completeTurn(conversation, state, 'failed', completedAt, { error })
    this.#publish({
      conversationId: record.conversationId,
      turnId: record.turnId,
      timestamp: completedAt,
      type: 'turn.failed',
      payload: { error },
    })
    this.#recordProviderExecutionFailure(conversation, error)
    return state.record
  }

  #recordProviderExecutionSuccess(conversation: ConversationState): void {
    this.#recordProviderExecutionHealth({
      machineId: conversation.record.machineId,
      provider: conversation.record.provider,
      state: 'healthy',
      observedAt: TimestampSchema.parse(this.#timestamp()),
    })
    this.#recordProviderBackendReadiness(conversation, 'ready')
  }

  #recordProviderExecutionFailure(
    conversation: ConversationState,
    error: HostError,
  ): void {
    const failure = error.failure
    if (
      failure === undefined ||
      !failureAffectsProviderExecutionHealth(failure)
    ) {
      return
    }
    this.#recordProviderExecutionHealth({
      machineId: conversation.record.machineId,
      provider: conversation.record.provider,
      state: providerExecutionHealthState(failure),
      failure,
      observedAt: TimestampSchema.parse(this.#timestamp()),
    })
    const backendReadiness = backendReadinessForFailure(failure.reason)
    if (backendReadiness !== undefined) {
      this.#recordProviderBackendReadiness(
        conversation,
        backendReadiness,
        failure,
      )
    }
  }

  #recordProviderBackendReadiness(
    conversation: ConversationState,
    readiness:
      'ready' | 'unavailable' | 'authentication_required' | 'misconfigured',
    failure?: CanonicalFailure,
  ): void {
    const persistence = this.#persistence
    const installationId = conversation.providerInstallationId
    if (persistence === undefined || installationId === undefined) return
    const installation = persistence.getProviderInstallation(installationId)
    if (
      installation?.revision === undefined ||
      installation.backend === undefined
    ) {
      return
    }
    const observedAt = TimestampSchema.parse(this.#timestamp())
    const backendConfiguration = {
      mode: installation.backend.mode,
      freshness: installation.backend.freshness,
      configurationRevision: installation.backend.configurationRevision,
      configuration: installation.backend.configuration,
      sanitizedOrigin: installation.backend.sanitizedOrigin,
    }
    let retained: DurableProviderInstallation
    try {
      retained = this.#writeDurableResult(() =>
        persistence.recordProviderBackendObservation(
          installationId,
          installation.revision,
          {
            ...backendConfiguration,
            readiness,
            freshness: 'current',
            observedAt,
            ...(failure === undefined ? {} : { failure }),
          },
        ),
      )
    } catch {
      return
    }
    if (conversation.record.machineId === this.#machines.localMachineId()) {
      const lifecycle = this.#providers.lifecycle(conversation.record.provider)
      if (lifecycle !== undefined) {
        this.#providers.setLifecycle({
          ...lifecycle,
          installations: lifecycle.installations.map((candidate) =>
            candidate.installationId === retained.installationId
              ? {
                  installationId: retained.installationId,
                  provider: retained.provider,
                  selected: retained.selected,
                  ...(retained.version === undefined
                    ? {}
                    : { version: retained.version }),
                  launcherKind: retained.launcherKind,
                  installMethod: retained.installMethod,
                  availability: retained.availability,
                  ...(retained.revision === undefined
                    ? {}
                    : { revision: retained.revision }),
                  firstObservedAt: retained.firstObservedAt,
                  lastObservedAt: retained.lastObservedAt,
                  ...(retained.compatibility === undefined
                    ? {}
                    : { compatibility: retained.compatibility }),
                  ...(retained.backend === undefined
                    ? {}
                    : { backend: retained.backend }),
                }
              : candidate,
          ),
        })
      }
    }
  }

  #recordProviderExecutionHealth(
    observation: DurableProviderExecutionHealthObservation,
  ): void {
    const key = machineRuntimeKey(observation.machineId, observation.provider)
    const existing =
      this.#providerExecutionHealth.get(key) ??
      this.#persistence?.getProviderExecutionHealth(
        observation.machineId,
        observation.provider,
      )
    if (
      existing !== undefined &&
      timestampAfter(existing.observedAt, observation.observedAt)
    ) {
      return
    }
    const retained =
      this.#persistence === undefined
        ? observation
        : this.#writeDurableResult(() =>
            this.#persistence!.recordProviderExecutionHealth(observation),
          )
    this.#providerExecutionHealth.set(key, retained)
    this.#currentProviderExecutionHealth.add(key)
    try {
      const machine = this.#machines.get(observation.machineId)
      this.#publish({
        conversationId: null,
        timestamp: observation.observedAt,
        type: 'machine.updated',
        payload: { machine },
      })
    } catch (error) {
      if (!(error instanceof MachineRegistryError)) throw error
    }
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
      ...(conversation.providerInstallationId === undefined
        ? {}
        : {
            providerInstallationId: conversation.providerInstallationId,
          }),
      origin: conversation.origin,
      providerSessionMaterialized: conversation.providerSessionMaterialized,
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

  async #rollbackAcquiredProviderConversation(
    conversationId: ConversationId,
    provider: AgentProvider,
    providerThreadId: string,
    runtime: AgentHostRuntime,
    cause: unknown,
  ): Promise<never> {
    const results = await Promise.allSettled([
      Promise.resolve().then(() =>
        this.#rollbackCreatingConversation(conversationId),
      ),
      runtime.disposeConversation === undefined
        ? Promise.resolve()
        : runtime.disposeConversation({ providerThreadId }),
    ])
    const rollbackFailures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    )
    if (rollbackFailures.length > 0) {
      throw providerCommandError(
        provider,
        'clean up conversation ownership',
        new AggregateError(
          [cause, ...rollbackFailures],
          'Provider acquisition rollback did not complete',
        ),
      )
    }
    throw cause
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
    readonly providerInstallationId: ProviderInstallationId
    readonly expectedInstallationRevision: ProviderInstallationRevision
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
        providerInstallationId: input.providerInstallationId,
        expectedInstallationRevision: input.expectedInstallationRevision,
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
    readonly providerInstallationId: ProviderInstallationId
    readonly expectedInstallationRevision: ProviderInstallationRevision
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
        providerInstallationId: input.providerInstallationId,
        expectedInstallationRevision: input.expectedInstallationRevision,
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

  #publicRelayConnectivity(
    machineId: MachineId,
    status: RelayMachineConnectivity = this.#controllerRelay.status(machineId),
  ): RelayMachineConnectivity {
    // Phase 7A presence is only infrastructure reachability. The product may
    // advertise Internet execution only after this Host epoch has completed
    // the existing peer-authenticated Machine TLS handshake through a Relay
    // channel for the exact durable Machine trust.
    const internetExecutionEnabled =
      status.internetExecutionEnabled &&
      this.#remoteMachines.relayExecutionAvailable?.(machineId) === true
    return internetExecutionEnabled === status.internetExecutionEnabled
      ? status
      : { ...status, internetExecutionEnabled }
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
        error instanceof RemoteMachineProjectLocationConflictError ||
        error instanceof NativeProviderSessionBindingConflictError
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

  async #scanProviderSessions(
    projectId: ProjectId,
    machineId: MachineId,
    rootPath: string,
    provider: AgentProvider,
    signal?: AbortSignal,
  ): Promise<ProviderSessionDiscoveryPage> {
    signal?.throwIfAborted()
    const key = `${projectId}\0${machineId}\0${provider}\0${rootPath}`
    let scan = this.#providerSessionScans.get(key)
    if (scan?.abort.signal.aborted === true) {
      await scan.promise.catch(() => undefined)
      signal?.throwIfAborted()
      return await this.#scanProviderSessions(
        projectId,
        machineId,
        rootPath,
        provider,
        signal,
      )
    }
    if (scan === undefined) {
      if (
        this.#providerSessionScans.size >=
        this.#maxConcurrentProviderSessionScans
      ) {
        return unavailableProviderSessionDiscoveryPage(
          provider,
          'provider_session_discovery_unavailable',
        )
      }
      const abort = new AbortController()
      const created: InFlightProviderSessionScan = {
        abort,
        waiters: 0,
        settled: false,
        promise: Promise.resolve(
          unavailableProviderSessionDiscoveryPage(
            provider,
            'provider_session_discovery_unavailable',
          ),
        ),
      }
      created.promise = this.#scanProviderSessionsOnce(
        projectId,
        machineId,
        rootPath,
        provider,
        abort.signal,
      ).finally(() => {
        created.settled = true
        if (this.#providerSessionScans.get(key) === created) {
          this.#providerSessionScans.delete(key)
        }
      })
      this.#providerSessionScans.set(key, created)
      scan = created
    }
    scan.waiters += 1
    try {
      return await waitForProviderSessionScan(scan.promise, signal)
    } finally {
      scan.waiters -= 1
      if (scan.waiters === 0 && !scan.settled) scan.abort.abort()
    }
  }

  #materializeProviderSessionBinding(
    machineId: MachineId,
    provider: AgentProvider,
    nativeSessionId: string,
  ): string {
    return machineId === this.#machines.localMachineId()
      ? nativeSessionId
      : encodeRemoteProviderSessionBinding(provider, machineId, nativeSessionId)
  }

  #withCurrentProviderSessionResumeStatus(
    machineId: MachineId,
    provider: AgentProvider,
    page: ProviderSessionDiscoveryPage,
  ): ProviderSessionDiscoveryPage {
    const current = this.#providerSessionResumeStatus(machineId, provider)
    return {
      ...page,
      resumeStatus: intersectProviderSessionResumeStatus(
        page.resumeStatus,
        current,
      ),
      candidates: page.candidates.map((candidate) => ({
        ...candidate,
        resumeStatus: intersectProviderSessionResumeStatus(
          candidate.resumeStatus,
          current,
        ),
      })),
    }
  }

  #providerSessionResumeStatus(
    machineId: MachineId,
    provider: AgentProvider,
  ): ProviderSessionResumeStatus {
    const installation = this.#providerInstallation(machineId, provider)
    if (
      installation?.compatibility !== undefined &&
      installation.compatibility.capabilities.nativeResume.effective !== true
    ) {
      return installation.compatibility.capabilities.nativeResume.observed ===
        'unsupported'
        ? 'unsupported'
        : 'unavailable'
    }
    const descriptor = this.#providerDescriptorForMachine(machineId, provider)
    if (descriptor?.availability === 'unsupported_version') {
      return 'unsupported'
    }
    if (descriptor?.availability !== 'available') return 'unavailable'
    if (!descriptor.capabilities.resume) return 'unsupported'
    if (!this.#machineRuntimeAvailable(machineId, provider)) {
      return 'unavailable'
    }
    const health = descriptor.executionHealth
    return health?.freshness === 'current' &&
      (health.state === 'degraded' || health.state === 'unavailable')
      ? 'unavailable'
      : 'supported'
  }

  #assertProviderSessionResumeReady(
    machineId: MachineId,
    provider: AgentProvider,
  ): void {
    if (
      this.#providerSessionResumeStatus(machineId, provider) === 'supported'
    ) {
      return
    }
    throw providerUnavailableError(
      provider,
      this.#providerDescriptorForMachine(machineId, provider),
    )
  }

  async #scanProviderSessionsOnce(
    projectId: ProjectId,
    machineId: MachineId,
    rootPath: string,
    provider: AgentProvider,
    signal?: AbortSignal,
  ): Promise<ProviderSessionDiscoveryPage> {
    const installation = this.#providerInstallation(machineId, provider)
    if (
      installation?.compatibility !== undefined &&
      installation.compatibility.capabilities.nativeSessionDiscovery
        .effective !== true
    ) {
      return unavailableProviderSessionDiscoveryPage(
        provider,
        'provider_session_format_unsupported',
        'unsupported',
      )
    }
    if (machineId === this.#machines.localMachineId()) {
      const authorized = await this.#projects.authorizeConversation(
        projectId,
        machineId,
        rootPath,
      )
      const discovery = this.#providerSessionDiscoveries.get(provider)
      if (discovery === undefined) {
        return unavailableProviderSessionDiscoveryPage(
          provider,
          'provider_session_discovery_unavailable',
          'unsupported',
        )
      }
      return await collectProviderSessionDiscovery(
        discovery,
        authorized.cwd,
        signal,
        this.#providerSessionDiscoveryTimeoutMs,
      )
    }
    const { durable, trust } = this.#requireRemoteMachineTrust(machineId)
    if (installation?.revision === undefined) {
      return unavailableProviderSessionDiscoveryPage(
        provider,
        'provider_session_discovery_unavailable',
        'unavailable',
      )
    }
    const discover = this.#remoteMachines.discoverProviderSessions
    if (discover === undefined) {
      return unavailableProviderSessionDiscoveryPage(
        provider,
        'provider_session_discovery_unavailable',
        'unsupported',
      )
    }
    return await discover.call(this.#remoteMachines, durable, trust, {
      provider,
      projectId,
      rootPath,
      providerInstallationId: installation.installationId,
      expectedInstallationRevision: installation.revision,
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async #validateProviderSessionCandidate(candidate: {
    readonly projectId: ProjectId
    readonly machineId: MachineId
    readonly rootPath: string
    readonly providerInstallationId?: ProviderInstallationId
    readonly installationRevision?: ProviderInstallationRevision
    readonly native: NativeProviderSessionCandidate
  }): Promise<NativeProviderSessionCandidate | undefined> {
    if (candidate.providerInstallationId !== undefined) {
      const current = this.#providerInstallation(
        candidate.machineId,
        candidate.native.provider,
        candidate.providerInstallationId,
      )
      if (
        current?.revision === undefined ||
        current.revision !== candidate.installationRevision
      ) {
        return undefined
      }
    }
    if (candidate.machineId === this.#machines.localMachineId()) {
      const discovery = this.#providerSessionDiscoveries.get(
        candidate.native.provider,
      )
      if (discovery === undefined) return undefined
      // Revalidate current ProjectLocation authorization before reading the
      // exact Provider-owned native metadata again.
      await this.#projects.authorizeConversation(
        candidate.projectId,
        candidate.machineId,
        candidate.native.workingDirectory,
      )
      const validated = await discovery.validateCandidate({
        projectRoot: candidate.rootPath,
        nativeSessionId: candidate.native.nativeSessionId,
        revision: candidate.native.revision,
      })
      return validated !== undefined &&
        isValidNativeProviderSessionCandidate(
          validated,
          candidate.native.provider,
          candidate.rootPath,
        )
        ? validated
        : undefined
    }
    const { durable, trust } = this.#requireRemoteMachineTrust(
      candidate.machineId,
    )
    const validate = this.#remoteMachines.validateProviderSession
    if (validate === undefined) return undefined
    if (
      candidate.providerInstallationId === undefined ||
      candidate.installationRevision === undefined
    ) {
      return undefined
    }
    const validated = await validate.call(
      this.#remoteMachines,
      durable,
      trust,
      {
        provider: candidate.native.provider,
        projectId: candidate.projectId,
        rootPath: candidate.rootPath,
        nativeSessionId: candidate.native.nativeSessionId,
        revision: candidate.native.revision,
        providerInstallationId: candidate.providerInstallationId,
        expectedInstallationRevision: candidate.installationRevision,
      },
    )
    return validated !== undefined &&
      isValidNativeProviderSessionCandidate(
        validated,
        candidate.native.provider,
        candidate.rootPath,
      )
      ? validated
      : undefined
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
    // Discovery is request-scoped and bounded. Let any exact scan already in
    // progress release its Provider metadata client/file handles before the
    // owning registries are torn down; no reconnect or background scan is
    // created during shutdown.
    for (const scan of this.#providerSessionScans.values()) scan.abort.abort()
    await Promise.allSettled(
      [...this.#providerSessionScans.values()].map(({ promise }) => promise),
    )
    this.#closingRuntime = true
    // A shutdown-only decline releases the live Provider request, but it is
    // not a user decision. Stop consuming Provider resolution callbacks first
    // so the pending durable Approval remains the restart reconciliation
    // authority and becomes host_restart/expired on the next Host open.
    for (const unsubscribe of this.#unsubscribeApprovals) unsubscribe()
    this.#approvalRegistry.declineAll()
    try {
      await Promise.allSettled([...this.#pendingRuntimeDisposals])
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
        await this.#controllerRelay.close()
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
      this.#unsubscribeEvents.clear()
      this.#unsubscribeApprovals.clear()
      this.#unsubscribeFailures.clear()
      this.#runtimeSubscriptions.clear()
      this.#unsubscribeRemoteMachineStatus?.()
      this.#unsubscribeRemoteMachineStatus = undefined
      this.#unsubscribeRemoteMachineRemoval?.()
      this.#unsubscribeRemoteMachineRemoval = undefined
      this.#unsubscribeRemoteProviderDiscovery?.()
      this.#unsubscribeRemoteProviderDiscovery = undefined
      this.#unsubscribeControllerRelay?.()
      this.#unsubscribeControllerRelay = undefined
      this.#actions.clear()
      this.#hydrations.clear()
      this.#runtimeAccess.clear()
      this.#runtimePins.clear()
      this.#pendingRuntimeDisposals.clear()
      this.#failedRuntimeDisposals = 0
      this.#pendingProviderEvents.length = 0
      this.#pendingProviderEventBytes = 0
      this.#pendingProviderStartFailures.clear()
      this.#providerSessionScans.clear()
      this.#providerSessionCandidates.clear()
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
      (pending) =>
        pending.machineId !== this.#machines.localMachineId() ||
        pending.event.provider !== provider,
    )
    this.#pendingProviderEvents.length = 0
    this.#pendingProviderEvents.push(...retainedEvents)
    this.#pendingProviderEventBytes = retainedEvents.reduce(
      (total, pending) => total + pending.bytes,
      0,
    )
    const timestamp = this.#timestamp()
    const canonical = classifyCanonicalFailure(
      failure,
      timestamp,
      this.#persistenceFailure === undefined
        ? 'runtime_error'
        : 'runtime_error',
    )
    const error = safeProviderHostError(provider, canonical)
    if (
      this.#persistenceFailure === undefined &&
      failureAffectsProviderExecutionHealth(canonical)
    ) {
      this.#recordProviderExecutionHealth({
        machineId: this.#machines.localMachineId(),
        provider,
        state: providerExecutionHealthState(canonical),
        failure: canonical,
        observedAt: TimestampSchema.parse(timestamp),
      })
    }
    for (const conversation of this.#conversations.values()) {
      if (
        conversation.record.machineId !== this.#machines.localMachineId() ||
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
    const lifecycle = this.#providers.lifecycle(provider)
    const selected = lifecycle?.installations.find(
      (installation) =>
        installation.installationId === lifecycle.selectedInstallationId,
    )
    const lifecycleReady =
      lifecycle === undefined ||
      (selected?.availability === 'available' &&
        selected.revision !== undefined &&
        selected.compatibility !== undefined &&
        selected.compatibility.capabilities.execution.effective &&
        (selected.compatibility.state === 'verified' ||
          selected.compatibility.state === 'compatible_unverified' ||
          selected.compatibility.state === 'limited'))
    return (
      runtime !== undefined &&
      runtime.available !== false &&
      descriptor?.availability === 'available' &&
      lifecycleReady &&
      !this.#runtimeFailures.has(provider)
    )
  }

  async #refreshLocalProviderForExplicitStart(
    machineId: MachineId,
    provider: AgentProvider,
  ): Promise<void> {
    if (
      machineId !== this.#machines.localMachineId() ||
      (this.#refreshLocalProviderLifecycle === undefined &&
        this.#refreshUnavailableLocalProvider === undefined) ||
      this.#persistenceFailure !== undefined
    ) {
      return
    }
    if (this.#localProviderHasActiveTurn(provider)) return
    const current = this.#providers.get(provider)
    if (
      this.#refreshLocalProviderLifecycle === undefined &&
      (current === undefined ||
        (current.available !== false && !this.#runtimeFailures.has(provider)))
    ) {
      return
    }
    const inFlight = this.#localProviderRefreshes.get(provider)
    if (inFlight !== undefined) {
      await inFlight
      return
    }
    const refresh = (async (): Promise<void> => {
      const previous = this.#providers.get(provider)
      if (previous === undefined) return
      const knownFatalFailure = this.#runtimeFailures.get(provider)
      const lifecycleResult =
        await this.#refreshLocalProviderLifecycle?.(provider)
      const replacement =
        lifecycleResult?.runtime ??
        (await this.#refreshUnavailableLocalProvider?.(provider))
      const discardReplacement = async (): Promise<void> => {
        if (lifecycleResult?.discard !== undefined) {
          await lifecycleResult.discard().catch(() => undefined)
          return
        }
        await replacement?.close().catch(() => undefined)
      }
      if (replacement === undefined || replacement.provider !== provider) {
        await discardReplacement()
        throw new Error('Local Provider recovery returned the wrong identity')
      }
      if (replacement !== previous) {
        if (lifecycleResult !== undefined) {
          try {
            this.#providers.assertReplacementWithLifecycle(
              previous,
              replacement,
              lifecycleResult.lifecycle,
            )
          } catch (error) {
            await discardReplacement()
            throw error
          }
        }
        this.#unsubscribeRuntime(previous)
        try {
          await previous.close()
        } catch (error) {
          // Codex retains and rethrows the exact fatal failure that already
          // caused Host terminalization after its child has been shut down.
          // That identity is cleanup-complete, not a second cleanup failure.
          // Any different rejection remains uncertain and blocks replacement.
          if (knownFatalFailure === undefined || error !== knownFatalFailure) {
            await discardReplacement()
            throw error
          }
        }
        if (lifecycleResult === undefined) {
          this.#providers.replace(previous, replacement)
        } else {
          let lifecycle: MachineProviderLifecycle
          try {
            lifecycle = lifecycleResult.commit?.() ?? lifecycleResult.lifecycle
          } catch (error) {
            await discardReplacement()
            throw error
          }
          this.#providers.replaceWithLifecycle(previous, replacement, lifecycle)
        }
        this.#invalidateLocalProviderSessions(provider)
      } else if (lifecycleResult !== undefined) {
        let lifecycle: MachineProviderLifecycle
        try {
          lifecycle = lifecycleResult.commit?.() ?? lifecycleResult.lifecycle
        } catch (error) {
          await discardReplacement()
          throw error
        }
        this.#providers.setLifecycle(lifecycle)
      }
      if (lifecycleResult?.sessionDiscovery !== undefined) {
        this.#providerSessionDiscoveries.set(
          provider,
          lifecycleResult.sessionDiscovery,
        )
      }
      this.#runtimeFailures.delete(provider)
      if (replacement.available !== false) {
        this.#subscribeRuntime(replacement, machineId)
      }
    })()
    this.#localProviderRefreshes.set(provider, refresh)
    try {
      await refresh
    } finally {
      if (this.#localProviderRefreshes.get(provider) === refresh) {
        this.#localProviderRefreshes.delete(provider)
      }
    }
  }

  #localProviderHasActiveTurn(provider: AgentProvider): boolean {
    return [...this.#conversations.values()].some(
      (conversation) =>
        conversation.record.machineId === this.#machines.localMachineId() &&
        conversation.record.provider === provider &&
        (conversation.startingTurn ||
          conversation.record.activeTurnId !== undefined ||
          conversation.record.status === 'running'),
    )
  }

  #invalidateLocalProviderSessions(provider: AgentProvider): void {
    for (const conversation of this.#conversations.values()) {
      if (
        conversation.record.machineId === this.#machines.localMachineId() &&
        conversation.record.provider === provider &&
        conversation.providerSession !== 'uninitialized'
      ) {
        conversation.providerSession = 'needs-resume'
      }
    }
  }

  #providerDescriptors(): readonly ProviderDescriptor[] {
    const machine = this.#machines.get(this.#machines.localMachineId())
    return this.#providers.descriptors().map((descriptor) =>
      providerDescriptorWithLifecycleCapabilities(
        {
          ...descriptor,
          executionHealth: this.#providerExecutionHealthPresentation(
            machine,
            descriptor.provider,
            descriptor.executionHealth,
          ),
        },
        this.#providers.lifecycle(descriptor.provider),
      ),
    )
  }

  #providerLifecyclesForMachine(
    machine: MachineSummary,
  ): readonly MachineProviderLifecycle[] {
    if (machine.kind === 'local') return this.#providers.lifecycles()
    const lifecycles =
      this.#persistence?.listProviderLifecycles(machine.machineId) ?? []
    const providerObservation = this.#persistence?.getRemoteProviderObservation(
      machine.machineId,
    )
    const providerObservationIsCurrent =
      machine.connectionState === 'online' &&
      providerObservation !== undefined &&
      this.#remoteMachines.providerDiscoveryCurrent?.(
        machine.machineId,
        providerObservation.observedAt,
      ) === true
    return lifecycles.map((lifecycle) => {
      // A legacy/partial Node can return a current Provider descriptor without
      // the additive Phase 8B installation graph. Retained lifecycle data is
      // then explicitly last-known instead of being promoted by connectivity.
      return {
        ...lifecycle,
        installations: lifecycle.installations.map((installation) => {
          const installationIsCurrent =
            providerObservationIsCurrent &&
            installation.lastObservedAt === providerObservation.observedAt
          if (installationIsCurrent) return installation
          return {
            ...installation,
            ...(installation.compatibility === undefined
              ? {}
              : {
                  compatibility: {
                    ...installation.compatibility,
                    freshness:
                      installation.compatibility.freshness === 'not_observed'
                        ? ('not_observed' as const)
                        : ('last_known' as const),
                  },
                }),
            ...(installation.backend === undefined
              ? {}
              : {
                  backend: {
                    ...installation.backend,
                    freshness:
                      installation.backend.freshness === 'not_observed'
                        ? ('not_observed' as const)
                        : ('last_known' as const),
                  },
                }),
          }
        }),
      }
    })
  }

  #providerInstallation(
    machineId: MachineId,
    provider: AgentProvider,
    installationId?: ProviderInstallationId,
  ): ProviderInstallationSummary | undefined {
    const machine = this.#machines.get(machineId)
    const lifecycle = this.#providerLifecyclesForMachine(machine).find(
      (candidate) => candidate.provider === provider,
    )
    const selectedId = installationId ?? lifecycle?.selectedInstallationId
    return selectedId === undefined
      ? undefined
      : lifecycle?.installations.find(
          (installation) => installation.installationId === selectedId,
        )
  }

  #requireProviderRuntimeInstallation(
    machineId: MachineId,
    provider: AgentProvider,
    installationId?: ProviderInstallationId,
  ): ProviderRuntimeInstallation {
    const installation = this.#providerInstallation(
      machineId,
      provider,
      installationId,
    )
    if (
      installation === undefined ||
      installation.availability !== 'available' ||
      installation.revision === undefined ||
      installation.compatibility === undefined ||
      installation.compatibility.freshness !== 'current' ||
      (installation.compatibility.state !== 'verified' &&
        installation.compatibility.state !== 'compatible_unverified' &&
        installation.compatibility.state !== 'limited') ||
      installation.compatibility.capabilities.execution.effective !== true ||
      installation.compatibility.capabilities.streaming.effective !== true ||
      (provider === 'claude-code' &&
        (installation.compatibility.capabilities.fileRead.effective !== true ||
          installation.compatibility.capabilities.search.effective !== true ||
          installation.compatibility.capabilities.toolEvents.effective !==
            true))
    ) {
      throw providerUnavailableError(
        provider,
        this.#providerDescriptorForMachine(machineId, provider),
      )
    }
    return {
      installationId: installation.installationId,
      installationRevision: installation.revision,
    }
  }

  #assertProviderInstallationCapabilities(
    machineId: MachineId,
    provider: AgentProvider,
    installationId: ProviderInstallationId | undefined,
    nativeResumeRequired: boolean,
    reasoningControlRequired = false,
  ): void {
    const lifecycle = this.#providerLifecyclesForMachine(
      this.#machines.get(machineId),
    ).find((candidate) => candidate.provider === provider)
    // Additive compatibility with pre-8B and isolated test runtimes. Product
    // assembly always supplies lifecycle truth once an installation is
    // observed.
    if (lifecycle === undefined) return
    const installation = this.#providerInstallation(
      machineId,
      provider,
      installationId,
    )
    const capabilities = installation?.compatibility?.capabilities
    if (
      installation === undefined ||
      capabilities === undefined ||
      installation.compatibility?.freshness !== 'current' ||
      !capabilities.execution.effective ||
      !capabilities.streaming.effective ||
      (provider === 'claude-code' &&
        (!capabilities.fileRead.effective ||
          !capabilities.search.effective ||
          !capabilities.toolEvents.effective)) ||
      (nativeResumeRequired && !capabilities.nativeResume.effective) ||
      (reasoningControlRequired && !capabilities.reasoningControl.effective)
    ) {
      throw providerUnavailableError(
        provider,
        this.#providerDescriptorForMachine(machineId, provider),
      )
    }
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
    const providerDiscoveryFreshness = current
      ? ('current' as const)
      : ('last_known' as const)
    return {
      providers: observation.providers.map((descriptor) => ({
        ...descriptor,
        executionHealth: this.#providerExecutionHealthPresentation(
          machine,
          descriptor.provider,
          descriptor.executionHealth,
          providerDiscoveryFreshness,
        ),
      })),
      providerDiscovery: {
        state: current ? 'current' : 'last_known',
        observedAt: observation.observedAt,
      },
    }
  }

  #providerExecutionHealthPresentation(
    machine: MachineSummary,
    provider: AgentProvider,
    discoveredHealth?: ProviderExecutionHealth,
    providerDiscoveryFreshness?: 'current' | 'last_known',
  ): ProviderExecutionHealth {
    const key = machineRuntimeKey(machine.machineId, provider)
    const observation =
      this.#providerExecutionHealth.get(key) ??
      this.#persistence?.getProviderExecutionHealth(machine.machineId, provider)
    if (observation !== undefined) {
      this.#providerExecutionHealth.set(key, observation)
    }
    // Discovery may report a bounded blocking condition (for example a
    // machine-readable login failure), but installation/auth probing cannot
    // prove successful Agent execution. Only a completed explicit Turn may
    // establish healthy execution state.
    const discoveredFailureHealth =
      discoveredHealth?.failure === undefined ? undefined : discoveredHealth
    const discoveredIsNewer =
      discoveredFailureHealth !== undefined &&
      (observation === undefined ||
        (discoveredFailureHealth.observedAt !== undefined &&
          !timestampAfter(
            observation.observedAt,
            discoveredFailureHealth.observedAt,
          )))
    const selected = discoveredIsNewer ? discoveredFailureHealth : observation
    const remoteTruthIsStale =
      machine.kind === 'remote' &&
      (machine.connectionState !== 'online' ||
        providerDiscoveryFreshness === 'last_known')
    const freshness = remoteTruthIsStale
      ? ('last_known' as const)
      : discoveredIsNewer && discoveredFailureHealth?.freshness === 'last_known'
        ? ('last_known' as const)
        : discoveredIsNewer || this.#currentProviderExecutionHealth.has(key)
          ? ('current' as const)
          : ('last_known' as const)
    if (selected === undefined) {
      return {
        state: 'unknown',
        freshness: remoteTruthIsStale ? 'last_known' : 'current',
      }
    }
    return {
      state: selected.state,
      freshness,
      ...(selected.observedAt === undefined
        ? {}
        : { observedAt: selected.observedAt }),
      ...(selected.failure === undefined ? {} : { failure: selected.failure }),
    }
  }

  #markProviderExecutionHealthLastKnown(machineId: MachineId): void {
    for (const provider of ['codex', 'claude-code'] as const) {
      this.#currentProviderExecutionHealth.delete(
        machineRuntimeKey(machineId, provider),
      )
    }
  }

  #forgetProviderExecutionHealth(machineId: MachineId): void {
    for (const provider of ['codex', 'claude-code'] as const) {
      const key = machineRuntimeKey(machineId, provider)
      this.#providerExecutionHealth.delete(key)
      this.#currentProviderExecutionHealth.delete(key)
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
    const lifecycle = this.#providerLifecyclesForMachine(
      this.#machines.get(machineId),
    ).find((candidate) => candidate.provider === provider)
    if (lifecycle !== undefined) {
      const selected = lifecycle.installations.find(
        (installation) =>
          installation.installationId === lifecycle.selectedInstallationId,
      )
      if (
        selected?.availability !== 'available' ||
        selected.revision === undefined ||
        selected.compatibility?.freshness !== 'current' ||
        selected.compatibility?.capabilities.execution.effective !== true
      ) {
        return false
      }
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
      this.#providerDescriptorForMachine(machineId, provider),
    )
  }

  #providerDescriptorForMachine(
    machineId: MachineId,
    provider: AgentProvider,
  ): ProviderDescriptor | undefined {
    const machine = this.#machines.get(machineId)
    const descriptors =
      machine.kind === 'local'
        ? this.#providerDescriptors()
        : this.#remoteProviderPresentation(machine).providers
    return descriptors.find((descriptor) => descriptor.provider === provider)
  }

  /**
   * An in-place revision change preserves logical installation identity, but
   * an idle session must leave its old exact runtime before native resume on
   * the revalidated revision. Active Turns never enter this path.
   */
  async #releaseObsoleteConversationInstallation(
    conversation: ConversationState,
  ): Promise<void> {
    if (conversation.record.machineId === this.#machines.localMachineId())
      return
    const installationId = conversation.providerInstallationId
    if (installationId === undefined) return
    const current = this.#requireProviderRuntimeInstallation(
      conversation.record.machineId,
      conversation.record.provider,
      installationId,
    )
    await this.#machineRuntimes.retireObsoleteIdle(
      conversation.record.machineId,
      conversation.record.provider,
      current,
    )
    const providerThreadId = conversation.providerThreadId
    if (providerThreadId === undefined) return
    const owner = this.#machineRuntimes.existingSession(
      conversation.record.machineId,
      conversation.record.provider,
      installationId,
      providerThreadId,
    )
    if (owner === undefined) return
    if (
      owner.installation?.installationId === current.installationId &&
      owner.installation.installationRevision === current.installationRevision
    ) {
      return
    }
    if (owner.disposeConversation === undefined) {
      throw providerUnavailableError(conversation.record.provider)
    }
    await owner.disposeConversation({ providerThreadId })
    conversation.providerSession = 'needs-resume'
    conversation.providerSessionMaterialized = true
    await this.#machineRuntimes.retireIfIdle(owner)
  }

  #requireMachineProviderRuntime(
    machineId: MachineId,
    provider: AgentProvider,
    conversation?: ConversationState,
  ): AgentHostRuntime {
    this.#assertMachineRuntimeAvailable(machineId, provider)
    let installation: ProviderRuntimeInstallation | undefined
    const lifecycle = this.#providerLifecyclesForMachine(
      this.#machines.get(machineId),
    ).find((candidate) => candidate.provider === provider)
    if (lifecycle !== undefined) {
      installation = this.#requireProviderRuntimeInstallation(
        machineId,
        provider,
        conversation?.providerInstallationId,
      )
      if (
        conversation !== undefined &&
        conversation.providerInstallationId === undefined
      ) {
        const persistence = this.#persistence
        if (persistence === undefined) {
          throw providerUnavailableError(provider)
        }
        this.#writeDurable(() => {
          persistence.bindLegacyConversationInstallation(
            conversation.record.conversationId,
            installation!.installationId,
          )
        })
        conversation.providerInstallationId = installation.installationId
      }
    }
    const runtime = this.#machineRuntimes.get(machineId, provider, installation)
    if (runtime === undefined) throw providerUnavailableError(provider)
    if (
      installation !== undefined &&
      (runtime.installation?.installationId !== installation.installationId ||
        runtime.installation.installationRevision !==
          installation.installationRevision)
    ) {
      throw providerUnavailableError(provider)
    }
    this.#subscribeRuntime(runtime, machineId)
    return runtime
  }

  #subscribeRuntime(runtime: AgentHostRuntime, machineId: MachineId): void {
    if (this.#runtimeSubscriptions.has(runtime)) return
    const fail = (failure: Error): void => {
      if (machineId === this.#machines.localMachineId()) {
        this.#handleRuntimeFailure(runtime.provider, failure)
      } else {
        this.#handleMachineRuntimeFailure(machineId, runtime.provider, failure)
      }
    }
    const unsubscribeEvents = runtime.subscribeEvents((event) => {
      try {
        if (event.provider !== runtime.provider) {
          throw new Error('Provider emitted an event with the wrong identity')
        }
        this.#acceptProviderEvent(machineId, runtime, event)
      } catch (error) {
        // Provider callbacks are owned by the Runtime. Never throw Host
        // translation or durability failures back through that callback,
        // because doing so can bypass the Runtime's exact-child cleanup.
        try {
          fail(toError(error))
        } catch {
          // `fail` has already transitioned the scoped runtime as far as
          // durable authority permits. The Runtime must retain control of
          // its own callback/process teardown path.
        }
      }
    })
    const unsubscribeApprovals = runtime.subscribeApprovals(
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
        this.#approvalRegistry.request(machineId, {
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
    )
    const unsubscribeFailures = runtime.subscribeFailures(fail)
    this.#unsubscribeEvents.add(unsubscribeEvents)
    this.#unsubscribeApprovals.add(unsubscribeApprovals)
    this.#unsubscribeFailures.add(unsubscribeFailures)
    this.#runtimeSubscriptions.set(runtime, [
      unsubscribeEvents,
      unsubscribeApprovals,
      unsubscribeFailures,
    ])
  }

  #unsubscribeRuntime(runtime: AgentHostRuntime): void {
    const subscriptions = this.#runtimeSubscriptions.get(runtime)
    if (subscriptions === undefined) return
    this.#runtimeSubscriptions.delete(runtime)
    const [events, approvals, failures] = subscriptions
    this.#unsubscribeEvents.delete(events)
    this.#unsubscribeApprovals.delete(approvals)
    this.#unsubscribeFailures.delete(failures)
    approvals()
    events()
    failures()
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
    const retainedEvents = this.#pendingProviderEvents.filter(
      (pending) =>
        pending.machineId !== machineId || pending.event.provider !== provider,
    )
    this.#pendingProviderEvents.length = 0
    this.#pendingProviderEvents.push(...retainedEvents)
    this.#pendingProviderEventBytes = retainedEvents.reduce(
      (total, pending) => total + pending.bytes,
      0,
    )
    const timestamp = this.#timestamp()
    const canonical = classifyCanonicalFailure(
      failure,
      timestamp,
      'execution_lost',
    )
    const error = safeProviderHostError(provider, canonical)
    if (
      this.#persistenceFailure === undefined &&
      failureAffectsProviderExecutionHealth(canonical)
    ) {
      this.#recordProviderExecutionHealth({
        machineId,
        provider,
        state: providerExecutionHealthState(canonical),
        failure: canonical,
        observedAt: TimestampSchema.parse(timestamp),
      })
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
    (conversation.record.origin ?? 'codetether') === 'codetether' &&
    conversation.record.titleSource === 'generated' &&
    conversation.turns.size === 0
  )
}

function intersectProviderSessionResumeStatus(
  nativeStatus: ProviderSessionResumeStatus,
  currentStatus: ProviderSessionResumeStatus,
): ProviderSessionResumeStatus {
  if (nativeStatus === 'unsupported' || currentStatus === 'unsupported') {
    return 'unsupported'
  }
  if (nativeStatus === 'unavailable' || currentStatus === 'unavailable') {
    return 'unavailable'
  }
  return 'supported'
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
    origin: record.origin ?? 'codetether',
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

async function collectProviderSessionDiscovery(
  discovery: ProviderSessionDiscovery,
  projectRoot: string,
  signal?: AbortSignal,
  timeoutMs = PROVIDER_SESSION_DISCOVERY_TOTAL_TIMEOUT_MS,
): Promise<ProviderSessionDiscoveryPage> {
  const pages: ProviderSessionDiscoveryPage[] = []
  const observedCursors = new Set<string>()
  const scanDeadline = AbortSignal.timeout(timeoutMs)
  const scanSignal =
    signal === undefined
      ? scanDeadline
      : AbortSignal.any([signal, scanDeadline])
  let scanDeadlineReached = false
  let cursor: string | undefined
  let remaining = MAX_DISCOVERED_NATIVE_SESSIONS
  let remainingPages = PROVIDER_SESSION_DISCOVERY_MAXIMUM_PAGES
  do {
    signal?.throwIfAborted()
    let page: ProviderSessionDiscoveryPage
    try {
      const discovered = await discovery.discover({
        projectRoot,
        ...(cursor === undefined ? {} : { cursor }),
        limit: Math.min(PROVIDER_SESSION_ADAPTER_PAGE_SIZE, remaining),
        signal: scanSignal,
      })
      const requestedLimit = Math.min(
        PROVIDER_SESSION_ADAPTER_PAGE_SIZE,
        remaining,
      )
      if (
        !isValidProviderSessionDiscoveryPage(
          discovered,
          discovery.provider,
          projectRoot,
          requestedLimit,
        )
      ) {
        return unavailableProviderSessionDiscoveryPage(
          discovery.provider,
          'provider_session_format_unsupported',
        )
      }
      page = discovered
    } catch (error) {
      if (scanDeadline.aborted && signal?.aborted !== true) {
        if (pages.length === 0) {
          return unavailableProviderSessionDiscoveryPage(
            discovery.provider,
            'provider_session_discovery_unavailable',
          )
        }
        scanDeadlineReached = true
        break
      }
      throw error
    }
    const firstPage = pages[0]
    if (
      page.provider !== discovery.provider ||
      page.candidates.some(
        (candidate) =>
          candidate.provider !== discovery.provider ||
          candidate.workingDirectory !== projectRoot,
      ) ||
      (firstPage !== undefined &&
        (page.status !== firstPage.status ||
          page.resumeStatus !== firstPage.resumeStatus ||
          page.providerVersion !== firstPage.providerVersion))
    ) {
      return unavailableProviderSessionDiscoveryPage(
        discovery.provider,
        'provider_session_format_unsupported',
      )
    }
    pages.push(page)
    remainingPages -= 1
    if (page.status !== 'supported') break
    remaining -= page.candidates.length
    cursor = page.nextCursor
    if (cursor !== undefined) {
      if (observedCursors.has(cursor)) {
        return unavailableProviderSessionDiscoveryPage(
          discovery.provider,
          'provider_session_format_unsupported',
        )
      }
      observedCursors.add(cursor)
    }
  } while (cursor !== undefined && remaining > 0 && remainingPages > 0)

  const first = pages[0]
  if (first === undefined) {
    return unavailableProviderSessionDiscoveryPage(
      discovery.provider,
      'provider_session_discovery_unavailable',
    )
  }
  const candidates = pages.flatMap((page) => page.candidates)
  return {
    provider: discovery.provider,
    status: first.status,
    resumeStatus: first.resumeStatus,
    ...(first.providerVersion === undefined
      ? {}
      : { providerVersion: first.providerVersion }),
    candidates: candidates.slice(0, MAX_DISCOVERED_NATIVE_SESSIONS),
    ...(first.failureReason === undefined
      ? {}
      : { failureReason: first.failureReason }),
    metrics: pages.reduce(
      (total, page) => ({
        filesInspected: safeProviderSessionMetricSum(
          total.filesInspected,
          page.metrics.filesInspected,
        ),
        candidatesParsed: safeProviderSessionMetricSum(
          total.candidatesParsed,
          page.metrics.candidatesParsed,
        ),
        candidatesMatched: safeProviderSessionMetricSum(
          total.candidatesMatched,
          page.metrics.candidatesMatched,
        ),
        corruptEntriesSkipped: safeProviderSessionMetricSum(
          total.corruptEntriesSkipped,
          page.metrics.corruptEntriesSkipped,
        ),
        elapsedMs: safeProviderSessionMetricSum(
          total.elapsedMs,
          page.metrics.elapsedMs,
        ),
        truncated:
          total.truncated ||
          page.metrics.truncated ||
          remaining === 0 ||
          (remainingPages === 0 && cursor !== undefined) ||
          scanDeadlineReached,
      }),
      {
        filesInspected: 0,
        candidatesParsed: 0,
        candidatesMatched: 0,
        corruptEntriesSkipped: 0,
        elapsedMs: 0,
        truncated:
          remaining === 0 ||
          (remainingPages === 0 && cursor !== undefined) ||
          scanDeadlineReached,
      },
    ),
  }
}

function isValidProviderSessionDiscoveryPage(
  value: unknown,
  provider: AgentProvider,
  projectRoot: string,
  requestedLimit: number,
): value is ProviderSessionDiscoveryPage {
  if (!isUnknownRecord(value) || value.provider !== provider) return false
  if (!isProviderSessionDiscoveryStatus(value.status)) return false
  if (!isProviderSessionResumeStatus(value.resumeStatus)) return false
  if (!Array.isArray(value.candidates)) return false
  if (value.candidates.length > requestedLimit) return false
  if (value.status !== 'supported' && value.candidates.length > 0) return false
  if ((value.status === 'supported') === (value.failureReason !== undefined)) {
    return false
  }
  if (
    value.failureReason !== undefined &&
    !isProviderSessionDiscoveryFailureReason(value.failureReason)
  ) {
    return false
  }
  if (
    value.providerVersion !== undefined &&
    (!isTrimmedBoundedText(value.providerVersion, 120) ||
      value.providerVersion.includes('\0'))
  ) {
    return false
  }
  if (
    value.nextCursor !== undefined &&
    (value.status !== 'supported' ||
      !isTrimmedBoundedText(
        value.nextCursor,
        providerSessionDiscoveryLimits.maximumCursorCodeUnits,
      ) ||
      value.nextCursor.includes('\0'))
  ) {
    return false
  }
  if (!isProviderSessionDiscoveryMetrics(value.metrics)) return false
  return value.candidates.every((candidate) =>
    isValidNativeProviderSessionCandidate(candidate, provider, projectRoot),
  )
}

function isValidNativeProviderSessionCandidate(
  value: unknown,
  provider: AgentProvider,
  projectRoot: string,
): value is NativeProviderSessionCandidate {
  if (!isUnknownRecord(value) || value.provider !== provider) return false
  if (value.workingDirectory !== projectRoot) return false
  if (
    !isBoundedOpaqueText(
      value.nativeSessionId,
      PROVIDER_SESSION_PRIVATE_ID_MAXIMUM_BYTES,
    ) ||
    !isBoundedOpaqueText(
      value.revision,
      PROVIDER_SESSION_REVISION_MAXIMUM_BYTES,
    ) ||
    !/^[A-Za-z0-9_-]+$/u.test(value.revision)
  ) {
    return false
  }
  if (
    !isTrimmedBoundedText(
      value.title,
      providerSessionDiscoveryLimits.maximumTitleCodeUnits,
    )
  ) {
    return false
  }
  if (
    (value.createdAt !== undefined &&
      !TimestampSchema.safeParse(value.createdAt).success) ||
    (value.lastActiveAt !== undefined &&
      !TimestampSchema.safeParse(value.lastActiveAt).success)
  ) {
    return false
  }
  if (
    value.providerVersion !== undefined &&
    (!isTrimmedBoundedText(value.providerVersion, 120) ||
      value.providerVersion.includes('\0'))
  ) {
    return false
  }
  return (
    isProviderSessionResumeStatus(value.resumeStatus) &&
    (value.historicalTranscript === 'supported' ||
      value.historicalTranscript === 'unsupported' ||
      value.historicalTranscript === 'unavailable')
  )
}

function isProviderSessionDiscoveryMetrics(value: unknown): boolean {
  if (!isUnknownRecord(value) || typeof value.truncated !== 'boolean') {
    return false
  }
  return [
    value.filesInspected,
    value.candidatesParsed,
    value.candidatesMatched,
    value.corruptEntriesSkipped,
    value.elapsedMs,
  ].every(
    (metric) =>
      typeof metric === 'number' && Number.isSafeInteger(metric) && metric >= 0,
  )
}

function safeProviderSessionMetricSum(left: number, right: number): number {
  return left > Number.MAX_SAFE_INTEGER - right
    ? Number.MAX_SAFE_INTEGER
    : left + right
}

function isProviderSessionDiscoveryStatus(
  value: unknown,
): value is ProviderSessionDiscoveryPage['status'] {
  return (
    value === 'supported' || value === 'unsupported' || value === 'unavailable'
  )
}

function isProviderSessionResumeStatus(
  value: unknown,
): value is ProviderSessionResumeStatus {
  return (
    value === 'supported' || value === 'unsupported' || value === 'unavailable'
  )
}

function isProviderSessionDiscoveryFailureReason(
  value: unknown,
): value is NonNullable<ProviderSessionDiscoveryPage['failureReason']> {
  return (
    value === 'provider_session_discovery_unavailable' ||
    value === 'provider_session_format_unsupported' ||
    value === 'provider_session_store_unreadable' ||
    value === 'machine_offline'
  )
}

function isTrimmedBoundedText(
  value: unknown,
  maximumCodeUnits: number,
): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximumCodeUnits &&
    value === value.trim()
  )
}

function isBoundedOpaqueText(
  value: unknown,
  maximumBytes: number,
): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !value.includes('\0') &&
    Buffer.byteLength(value, 'utf8') <= maximumBytes
  )
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function unavailableProviderSessionDiscoveryPage(
  provider: AgentProvider,
  failureReason:
    | 'provider_session_discovery_unavailable'
    | 'provider_session_format_unsupported'
    | 'provider_session_store_unreadable'
    | 'machine_offline',
  status: 'unsupported' | 'unavailable' = 'unavailable',
): ProviderSessionDiscoveryPage {
  return {
    provider,
    status,
    resumeStatus: status,
    candidates: [],
    failureReason,
    metrics: {
      filesInspected: 0,
      candidatesParsed: 0,
      candidatesMatched: 0,
      corruptEntriesSkipped: 0,
      elapsedMs: 0,
      truncated: false,
    },
  }
}

async function waitForProviderSessionScan(
  promise: Promise<ProviderSessionDiscoveryPage>,
  signal?: AbortSignal,
): Promise<ProviderSessionDiscoveryPage> {
  if (signal === undefined) return await promise
  signal.throwIfAborted()
  return await new Promise<ProviderSessionDiscoveryPage>((resolve, reject) => {
    let settled = false
    const finish = (action: () => void): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      action()
    }
    const abort = (): void => {
      const error = new Error('Provider session discovery was cancelled')
      error.name = 'AbortError'
      finish(() => reject(error))
    }
    signal.addEventListener('abort', abort, { once: true })
    void promise.then(
      (page) => finish(() => resolve(page)),
      (error: unknown) => finish(() => reject(error)),
    )
  })
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function expiredDiscoveryCandidate(): HostServiceError {
  return new HostServiceError(
    'provider_session_candidate_expired',
    'Previous conversation changed or expired; scan again',
    409,
  )
}

function conversationRecordFromDurable(
  conversation: DurableConversation,
): ConversationRecord {
  return ConversationRecordSchema.parse({
    conversationId: conversation.conversationId,
    projectId: conversation.projectId,
    machineId: conversation.machineId,
    title: conversation.title,
    titleSource: conversation.titleSource,
    origin: conversation.origin,
    ...(conversation.pinnedAt === undefined
      ? {}
      : { pinnedAt: conversation.pinnedAt }),
    ...(conversation.archivedAt === undefined
      ? {}
      : { archivedAt: conversation.archivedAt }),
    provider: conversation.provider,
    cwd: conversation.cwd,
    ...(conversation.model === undefined ? {} : { model: conversation.model }),
    ...(conversation.reasoning === undefined
      ? {}
      : { reasoning: conversation.reasoning }),
    status: conversation.status,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    lastActivityAt: conversation.lastActivityAt,
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

function backendReadinessForFailure(
  reason: CanonicalFailureReason,
): 'unavailable' | 'authentication_required' | 'misconfigured' | undefined {
  switch (reason) {
    case 'login_required':
    case 'authentication_expired':
    case 'authentication_invalid':
      return 'authentication_required'
    case 'provider_misconfigured':
      return 'misconfigured'
    case 'account_unavailable':
    case 'usage_limit_reached':
    case 'rate_limited':
    case 'provider_capacity_limited':
    case 'provider_service_unavailable':
      return 'unavailable'
    default:
      return undefined
  }
}

function providerDescriptorWithLifecycleCapabilities(
  descriptor: ProviderDescriptor,
  lifecycle: MachineProviderLifecycle | undefined,
): ProviderDescriptor {
  const selected = lifecycle?.installations.find(
    ({ installationId }) => installationId === lifecycle.selectedInstallationId,
  )
  const compatibility = selected?.compatibility
  if (compatibility === undefined) return descriptor

  const executionReady =
    compatibility.capabilities.execution.effective === true &&
    compatibility.capabilities.streaming.effective === true &&
    (descriptor.provider === 'codex' ||
      (compatibility.capabilities.fileRead.effective === true &&
        compatibility.capabilities.search.effective === true &&
        compatibility.capabilities.toolEvents.effective === true)) &&
    (compatibility.state === 'verified' ||
      compatibility.state === 'compatible_unverified' ||
      compatibility.state === 'limited')
  const effective = (
    capability:
      | 'streaming'
      | 'nativeResume'
      | 'fileRead'
      | 'search'
      | 'toolEvents'
      | 'reasoningControl',
  ): boolean =>
    executionReady && compatibility.capabilities[capability].effective === true
  const capabilities = {
    ...descriptor.capabilities,
    streaming: effective('streaming'),
    resume: effective('nativeResume'),
    fileRead: effective('fileRead'),
    search: effective('search'),
    toolEvents: effective('toolEvents'),
    reasoningControl: effective('reasoningControl'),
  }
  const { reasoningLabel, reasoningOptions, ...withoutReasoning } = descriptor
  return {
    ...withoutReasoning,
    capabilities,
    ...(capabilities.reasoningControl
      ? {
          ...(reasoningLabel === undefined ? {} : { reasoningLabel }),
          ...(reasoningOptions === undefined ? {} : { reasoningOptions }),
        }
      : {}),
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
  occurredAt = new Date().toISOString(),
): HostServiceError {
  void operation
  const failure = classifyCanonicalFailure(error, occurredAt, 'provider_error')
  const safe = safeProviderHostError(provider, failure)
  return new HostServiceError(
    safe.code,
    safe.message,
    failureHttpStatus(failure),
    undefined,
    failure,
  )
}

function hostServiceErrorForFailure(
  provider: AgentProvider,
  failure: CanonicalFailure,
): HostServiceError {
  const safe = safeProviderHostError(provider, failure)
  return new HostServiceError(
    safe.code,
    safe.message,
    failureHttpStatus(failure),
    undefined,
    failure,
  )
}

function controllerRelayServiceError(
  error: unknown,
  occurredAt: string,
): Error {
  if (error instanceof HostServiceError) return error
  if (!(error instanceof ControllerRelayCoordinatorError)) {
    return error instanceof Error ? error : new Error(String(error))
  }
  const reason = isRelayFailureReason(error.reason)
    ? error.reason
    : 'relay_unreachable'
  const failure = canonicalFailure(reason, occurredAt)
  const status =
    reason === 'relay_rate_limited'
      ? 429
      : reason === 'relay_unreachable'
        ? 503
        : reason === 'relay_not_configured'
          ? 409
          : 403
  return new HostServiceError(
    reason,
    relayFailureMessage(reason),
    status,
    undefined,
    failure,
  )
}

function isRelayFailureReason(
  reason: CanonicalFailureReason,
): reason is
  | 'relay_not_configured'
  | 'relay_unreachable'
  | 'relay_authentication_failed'
  | 'relay_identity_mismatch'
  | 'relay_protocol_incompatible'
  | 'relay_revoked'
  | 'relay_rate_limited' {
  return (
    reason === 'relay_not_configured' ||
    reason === 'relay_unreachable' ||
    reason === 'relay_authentication_failed' ||
    reason === 'relay_identity_mismatch' ||
    reason === 'relay_protocol_incompatible' ||
    reason === 'relay_revoked' ||
    reason === 'relay_rate_limited'
  )
}

function relayFailureMessage(
  reason: ReturnType<typeof canonicalFailure>['reason'],
): string {
  switch (reason) {
    case 'relay_not_configured':
      return 'Internet Relay is not configured'
    case 'relay_unreachable':
      return 'Internet Relay is temporarily unreachable'
    case 'relay_authentication_failed':
      return 'Internet Relay authentication failed'
    case 'relay_identity_mismatch':
      return 'Internet Relay identity did not match its confirmed identity'
    case 'relay_protocol_incompatible':
      return 'Internet Relay version is incompatible'
    case 'relay_revoked':
      return 'Internet Relay enrollment was revoked'
    case 'relay_rate_limited':
      return 'Internet Relay temporarily limited connection attempts'
    default:
      return 'Internet Relay control connection failed'
  }
}

function remoteProviderCommandError(
  error: unknown,
  provider: AgentProvider = 'codex',
): Error {
  if (error instanceof HostServiceError) return error
  if (!(error instanceof RemoteMachineCoordinatorError)) {
    return error instanceof Error ? error : new Error(String(error))
  }
  const reason: CanonicalFailureReason = (() => {
    switch (error.code) {
      case 'provider_start_failed':
        return 'provider_start_failed'
      case 'provider_session_lost':
        return 'provider_session_lost'
      case 'provider_unavailable':
        return 'provider_service_unavailable'
      case 'remote_execution_unavailable':
        return 'remote_execution_unavailable'
      case 'remote_execution_lost':
        return 'execution_ownership_uncertain'
      case 'remote_policy_violation':
        return 'provider_protocol_error'
      case 'conversation_busy':
      case 'duplicate_action_conflict':
      case 'conflict':
        return 'conversation_busy'
      case 'project_location_path_invalid':
      case 'project_location_not_directory':
        return 'project_location_invalid'
      case 'project_location_missing':
        return 'project_location_missing'
      case 'project_location_inaccessible':
        return 'project_location_unavailable'
      case 'authentication_failed':
        return 'transport_authentication_failed'
      case 'identity_mismatch':
        return 'machine_identity_mismatch'
      case 'connection_failed':
      case 'unavailable':
        return 'node_disconnected'
      default:
        return 'remote_execution_unavailable'
    }
  })()
  const failure = classifyCanonicalFailure(
    error,
    new Date().toISOString(),
    reason,
  )
  if (
    error.code === 'provider_start_failed' ||
    error.code === 'provider_session_lost' ||
    error.code === 'provider_unavailable' ||
    error.code === 'remote_execution_unavailable' ||
    error.code === 'remote_execution_lost' ||
    error.code === 'remote_policy_violation' ||
    error.code === 'conversation_busy' ||
    error.code === 'duplicate_action_conflict' ||
    error.code === 'conflict'
  ) {
    const safe = safeProviderHostError(provider, failure)
    return new HostServiceError(
      safe.code,
      safe.message,
      failureHttpStatus(failure),
      undefined,
      failure,
    )
  }
  switch (error.code) {
    case 'project_location_path_invalid':
    case 'project_location_missing':
    case 'project_location_not_directory':
    case 'project_location_inaccessible':
    case 'authentication_failed':
    case 'identity_mismatch': {
      const safe = safeProviderHostError(provider, failure)
      return new HostServiceError(
        safe.code,
        safe.message,
        failureHttpStatus(failure),
        undefined,
        failure,
      )
    }
    case 'protocol_incompatible':
      return new HostServiceError(
        'machine_protocol_incompatible',
        'Remote Machine protocol is incompatible',
        409,
        undefined,
        failure,
      )
    default:
      return new HostServiceError(
        'machine_connection_failed',
        'Remote Machine connection failed',
        503,
        undefined,
        failure,
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
  if (descriptor.availability !== 'available') return false
  const enabledCapabilities = Object.entries(descriptor.capabilities)
    .filter(([, enabled]) => enabled)
    .map(([capability]) => capability)
    .sort()
  if (descriptor.provider === 'codex') {
    return (
      codexTransportAvailable &&
      descriptor.capabilities.streaming &&
      enabledCapabilities.every(
        (capability) => capability === 'resume' || capability === 'streaming',
      )
    )
  }
  const allowed = new Set([
    'fileRead',
    'reasoningControl',
    'resume',
    'search',
    'streaming',
    'toolEvents',
  ])
  return (
    claudeTransportAvailable &&
    descriptor.capabilities.streaming &&
    descriptor.capabilities.fileRead &&
    descriptor.capabilities.search &&
    descriptor.capabilities.toolEvents &&
    enabledCapabilities.every((capability) => allowed.has(capability)) &&
    (descriptor.capabilities.reasoningControl
      ? descriptor.reasoningOptions?.length === 5 &&
        descriptor.reasoningOptions.every(
          (option, index) =>
            option.id === ['low', 'medium', 'high', 'xhigh', 'max'][index],
        )
      : descriptor.reasoningLabel === undefined &&
        descriptor.reasoningOptions === undefined)
  )
}

function runtimeUnavailableError(
  message = 'Codex runtime is unavailable',
): HostServiceError {
  const failure = canonicalFailure('runtime_error', new Date().toISOString())
  return new HostServiceError(
    'runtime_unavailable',
    message,
    503,
    undefined,
    failure,
  )
}

function providerConversationUnavailableError(
  provider: AgentProvider,
): HostServiceError {
  const failure = canonicalFailure(
    'provider_session_lost',
    new Date().toISOString(),
  )
  const safe = safeProviderHostError(provider, failure)
  return new HostServiceError(safe.code, safe.message, 409, undefined, failure)
}

function providerUnavailableError(
  provider: AgentProvider,
  descriptor?: ProviderDescriptor,
): HostServiceError {
  const installationReason: CanonicalFailureReason | undefined =
    descriptor?.availability === 'not_installed'
      ? 'provider_not_installed'
      : descriptor?.availability === 'unsupported_version'
        ? 'provider_unsupported_version'
        : descriptor?.availability === 'misconfigured'
          ? 'provider_misconfigured'
          : descriptor?.availability === 'unavailable'
            ? 'provider_service_unavailable'
            : undefined
  const currentExecutionFailure =
    descriptor?.availability === 'available' &&
    descriptor.executionHealth?.freshness === 'current'
      ? descriptor.executionHealth.failure
      : undefined
  const failure =
    installationReason === undefined
      ? (currentExecutionFailure ??
        canonicalFailure(
          'provider_service_unavailable',
          new Date().toISOString(),
        ))
      : canonicalFailure(installationReason, new Date().toISOString())
  const safe = safeProviderHostError(provider, failure)
  return new HostServiceError(
    safe.code,
    safe.message,
    failureHttpStatus(failure),
    undefined,
    failure,
  )
}

function failureHttpStatus(failure: CanonicalFailure): number {
  switch (failure.reason) {
    case 'login_required':
    case 'authentication_expired':
    case 'authentication_invalid':
    case 'transport_authentication_failed':
      return 401
    case 'rate_limited':
    case 'usage_limit_reached':
    case 'provider_capacity_limited':
      return 429
    case 'conversation_busy':
    case 'provider_session_lost':
    case 'machine_identity_mismatch':
    case 'project_location_missing':
    case 'project_location_invalid':
    case 'project_location_unavailable':
      return 409
    case 'provider_not_installed':
    case 'provider_unsupported_version':
    case 'provider_misconfigured':
    case 'provider_service_unavailable':
    case 'provider_start_failed':
    case 'remote_execution_unavailable':
    case 'machine_offline':
    case 'node_disconnected':
    case 'reconnecting':
    case 'execution_capacity_reached':
      return 503
    default:
      return 500
  }
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

function timestampAfter(left: string, right: string): boolean {
  // Both values have already crossed TimestampSchema. Compare instants rather
  // than their ISO spellings because the public protocol admits explicit UTC
  // offsets as well as the canonical `Z` form.
  return Date.parse(left) > Date.parse(right)
}

function providerStartFailureKey(
  machineId: MachineId,
  provider: AgentProvider,
  providerThreadId: string,
  providerTurnId: string,
): string {
  return JSON.stringify([
    MachineIdSchema.parse(machineId),
    provider,
    providerThreadId,
    providerTurnId,
  ])
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

function machineUnavailableError(
  machine: MachineSummary,
  occurredAt: string,
): HostServiceError {
  const reason: CanonicalFailureReason =
    machine.connectionState === 'connecting'
      ? 'reconnecting'
      : machine.connectionState === 'authentication_failed'
        ? 'transport_authentication_failed'
        : machine.connectionState === 'incompatible'
          ? 'remote_execution_unavailable'
          : machine.connectionState === 'offline'
            ? 'machine_offline'
            : 'node_disconnected'
  const failure = canonicalFailure(reason, occurredAt)
  const code: HostErrorCode =
    reason === 'transport_authentication_failed'
      ? 'machine_authentication_failed'
      : machine.connectionState === 'incompatible'
        ? 'machine_protocol_incompatible'
        : 'machine_unreachable'
  const message =
    reason === 'reconnecting'
      ? 'Remote Machine is reconnecting'
      : reason === 'transport_authentication_failed'
        ? 'Remote Machine authentication failed'
        : reason === 'remote_execution_unavailable'
          ? 'Remote Machine execution is incompatible'
          : reason === 'machine_offline'
            ? 'Remote Machine is offline'
            : 'Remote Node is disconnected'
  return new HostServiceError(code, message, 503, undefined, failure)
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
      return infrastructureFailureError(
        'machine_connection_failed',
        'Remote Machine pairing is currently unavailable',
        503,
        'node_disconnected',
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
      return infrastructureFailureError(
        'machine_authentication_failed',
        'Remote Machine authentication failed',
        401,
        'transport_authentication_failed',
      )
    case 'identity_mismatch':
      return infrastructureFailureError(
        'machine_identity_mismatch',
        'Remote Machine identity does not match the trusted identity',
        409,
        'machine_identity_mismatch',
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
      return infrastructureFailureError(
        'machine_connection_failed',
        'Remote Machine connection failed',
        503,
        'node_disconnected',
      )
    case 'project_location_path_invalid':
    case 'project_location_not_directory':
      return infrastructureFailureError(
        'project_location_invalid',
        'Remote Project Location path is invalid',
        422,
        'project_location_invalid',
      )
    case 'project_location_missing':
      return infrastructureFailureError(
        'project_location_missing',
        'Remote Project Location directory does not exist',
        404,
        'project_location_missing',
      )
    case 'project_location_inaccessible':
      return infrastructureFailureError(
        'project_location_inaccessible',
        'Remote Project Location directory is inaccessible',
        403,
        'project_location_unavailable',
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

function infrastructureFailureError(
  code: HostErrorCode,
  message: string,
  httpStatus: number,
  reason: CanonicalFailureReason,
): HostServiceError {
  return new HostServiceError(
    code,
    message,
    httpStatus,
    undefined,
    canonicalFailure(reason, new Date().toISOString()),
  )
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
      return projectFailureError(
        'project_unavailable',
        error.message,
        409,
        'project_location_unavailable',
      )
    case 'invalid_path':
      return projectFailureError(
        'invalid_request',
        error.message,
        422,
        'project_location_invalid',
      )
    case 'location_conflict':
      return new HostServiceError(
        'project_location_conflict',
        error.message,
        409,
      )
    case 'location_not_found':
      return projectFailureError(
        'project_location_not_found',
        error.message,
        404,
        'project_location_missing',
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

function projectFailureError(
  code: HostErrorCode,
  message: string,
  httpStatus: number,
  reason: CanonicalFailureReason,
): HostServiceError {
  return new HostServiceError(
    code,
    message,
    httpStatus,
    undefined,
    canonicalFailure(reason, new Date().toISOString()),
  )
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}
