import { X509Certificate } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { basename, dirname, join, resolve } from 'node:path'
import type { Duplex } from 'node:stream'

import {
  canonicalFailure,
  isCanonicalFailureReason,
  type CanonicalFailure,
} from '@codetether/agent-core'

import {
  ConversationIdSchema,
  MachineIdSchema,
  MachinePairingAttemptIdSchema,
  RemoteMachinePairingCandidateSchema,
  TimestampSchema,
  machineWireLimits,
  type MachineConnectionState,
  type MachineExecutionTransport,
  type MachineId,
  type MachinePairingAttemptId,
  type RemoteMachineAddress,
  type RemoteMachineConnection,
  type RemoteMachinePairingCandidate,
  type ProviderDescriptor,
  type Timestamp,
} from '@codetether/protocol'
import {
  ControllerIdSchema,
  MachineTransportError,
  PairingCodeSchema,
  PublicKeyFingerprintSchema,
  beginRemoteMachinePairing,
  connectTrustedRemoteMachine,
  connectTrustedRemoteMachineOverStream,
  createMachineTlsIdentityFile,
  deleteMachineTlsIdentityFile,
  machineProtocolVersion,
  machineTransportLimits,
  newControllerId,
  NodeIdSchema,
  openRemoteClaudeSession,
  openRemoteClaudeSessionOverStream,
  openRemoteCodexSession,
  openRemoteCodexSessionOverStream,
  readMachineTlsIdentityFile,
  MachineTransportActionIdSchema,
  MachineTransportConversationIdSchema,
  MachineTransportProjectIdSchema,
  MachineTransportTurnIdSchema,
  RemoteClaudeProviderIdentitySchema,
  RemoteCodexProviderIdentitySchema,
  type AuthenticatedRemoteMachineConnection,
  type MachineControllerIdentity,
  type PendingRemoteMachinePairing,
  type TrustedRemotePeer,
  type ValidatedRemoteProjectLocation,
  type RemoteProviderDiscovery,
  type RemoteClaudeSession as MachineTransportRemoteClaudeSession,
  type RemoteCodexSession as MachineTransportRemoteCodexSession,
} from '@codetether/machine-transport'

import type {
  ConversationStore,
  DurableMachine,
  DurableRemoteProviderObservation,
  DurableTrustedMachineEndpoint,
  DurableTrustedMachinePeer,
} from '../persistence/index.js'
import type { RemoteMachineStatusSource } from './machine-registry.js'
import type {
  RemoteClaudeEffort,
  RemoteClaudeRuntimeSession,
} from './remote-claude-host-runtime.js'
import type { RemoteCodexRuntimeSession } from './remote-codex-host-runtime.js'

export type RemoteMachineCoordinatorErrorCode =
  | 'not_found'
  | 'unavailable'
  | 'pairing_code_invalid'
  | 'pairing_code_expired'
  | 'pairing_rate_limited'
  | 'authentication_failed'
  | 'identity_mismatch'
  | 'conflict'
  | 'protocol_incompatible'
  | 'connection_failed'
  | 'project_location_path_invalid'
  | 'project_location_missing'
  | 'project_location_not_directory'
  | 'project_location_inaccessible'
  | 'remote_execution_unavailable'
  | 'provider_unavailable'
  | 'provider_start_failed'
  | 'provider_session_lost'
  | 'remote_execution_lost'
  | 'remote_policy_violation'
  | 'conversation_busy'
  | 'duplicate_action_conflict'

export class RemoteMachineCoordinatorError extends Error {
  constructor(
    readonly code: RemoteMachineCoordinatorErrorCode,
    message: string,
    options?: ErrorOptions & { readonly failure?: CanonicalFailure },
  ) {
    super(message, options)
    this.name = 'RemoteMachineCoordinatorError'
    this.failure = options?.failure
  }

  /** Canonical diagnostic from an authenticated bounded Node response. */
  readonly failure?: CanonicalFailure
}

/** The Node committed revocation, but local credential cleanup is still pending. */
export class RemoteMachineRevocationPendingError extends RemoteMachineCoordinatorError {
  constructor() {
    super(
      'connection_failed',
      'Remote Machine trust was revoked; local security cleanup is still pending',
    )
    this.name = 'RemoteMachineRevocationPendingError'
  }
}

export interface ConfirmedRemoteMachine {
  readonly machine: DurableMachine
  readonly trust: DurableTrustedMachinePeer
}

/**
 * Narrow Host-to-transport boundary. Implementations own TLS/pairing/session
 * state; the Host owns durable Machine and trust records.
 */
export interface RemoteMachineCoordinator extends RemoteMachineStatusSource {
  connectionDetails?(machineId: MachineId): RemoteMachineConnection | undefined
  /**
   * True only after this Host epoch has authenticated the exact paired Machine
   * through a current Relay connection generation. Relay presence alone is
   * intentionally insufficient for the public execution-eligibility claim.
   */
  relayExecutionAvailable?(machineId: MachineId): boolean
  subscribeStatus?(
    listener: (
      machineId: MachineId,
      connectionState: MachineConnectionState,
    ) => void,
  ): () => void
  subscribeRemoval?(listener: (machineId: MachineId) => void): () => void
  subscribeProviderDiscovery?(
    listener: (observation: DurableRemoteProviderObservation) => void,
  ): () => void
  providerDiscoveryCurrent?(
    machineId: MachineId,
    observedAt: Timestamp,
  ): boolean
  openCodexSession?(
    machine: DurableMachine,
    trust: DurableTrustedMachinePeer,
    input: {
      readonly conversationId: string
      readonly projectId: string
      readonly rootPath: string
      readonly providerThreadId?: string
    },
  ): Promise<RemoteCodexRuntimeSession>
  openClaudeSession?(
    machine: DurableMachine,
    trust: DurableTrustedMachinePeer,
    input: {
      readonly conversationId: string
      readonly projectId: string
      readonly rootPath: string
      readonly providerSessionId?: string
      readonly providerSessionMaterialized?: boolean
      readonly effort?: RemoteClaudeEffort
    },
  ): Promise<RemoteClaudeRuntimeSession>
  beginPairing(input: {
    readonly address: RemoteMachineAddress
    readonly pairingCode: string
  }): Promise<RemoteMachinePairingCandidate>
  confirmPairing(
    pairingAttemptId: MachinePairingAttemptId,
    stageTrust: (candidate: ConfirmedRemoteMachine) => void | Promise<void>,
  ): Promise<ConfirmedRemoteMachine>
  cancelPairing(pairingAttemptId: MachinePairingAttemptId): Promise<void>
  unpair(
    machine: DurableMachine,
    trust: DurableTrustedMachinePeer,
  ): Promise<void>
  retry(
    machine: DurableMachine,
    trust: DurableTrustedMachinePeer,
  ): Promise<RemoteMachineConnection>
  updateAddress(
    machine: DurableMachine,
    trust: DurableTrustedMachinePeer,
    address: RemoteMachineAddress,
  ): Promise<RemoteMachineConnection>
  validateProjectLocation?(
    machine: DurableMachine,
    trust: DurableTrustedMachinePeer,
    rootPath: string,
  ): Promise<ValidatedRemoteProjectLocation>
  discoverProviders?(
    machine: DurableMachine,
    trust: DurableTrustedMachinePeer,
  ): Promise<DurableRemoteProviderObservation>
  close?(): Promise<void>
}

/** Default keeps remote transport unavailable without affecting local work. */
export class UnavailableRemoteMachineCoordinator implements RemoteMachineCoordinator {
  connectionState(): MachineConnectionState | undefined {
    return undefined
  }

  relayExecutionAvailable(): boolean {
    return false
  }

  async beginPairing(): Promise<RemoteMachinePairingCandidate> {
    throw unavailable()
  }

  async confirmPairing(): Promise<ConfirmedRemoteMachine> {
    throw unavailable()
  }

  async cancelPairing(): Promise<void> {
    throw unavailable()
  }

  async unpair(): Promise<void> {
    throw unavailable()
  }

  async retry(): Promise<RemoteMachineConnection> {
    throw unavailable()
  }

  async updateAddress(): Promise<RemoteMachineConnection> {
    throw unavailable()
  }

  async validateProjectLocation(): Promise<ValidatedRemoteProjectLocation> {
    throw unavailable()
  }

  async discoverProviders(): Promise<DurableRemoteProviderObservation> {
    throw unavailable()
  }
}

interface PendingPairing {
  readonly pending: PendingRemoteMachinePairing
  readonly controller: MachineControllerIdentity
  readonly credentialRef: string
  readonly credentialPath: string
  expirationTimer?: ReturnType<typeof setTimeout>
}

interface RemoteWorker {
  abort: AbortController
  connection?: AuthenticatedRemoteMachineConnection
  transport?: Exclude<MachineExecutionTransport, 'unavailable'>
  task?: Promise<void>
}

interface ProviderDiscoveryTask {
  readonly abort: AbortController
  connection?: AuthenticatedRemoteMachineConnection
  task?: Promise<DurableRemoteProviderObservation>
}

interface RelayVerificationTask {
  readonly abort: AbortController
  readonly relayEpoch: string
  task?: Promise<void>
}

type RoutedMachineConnection =
  | {
      readonly connection: AuthenticatedRemoteMachineConnection
      readonly transport: 'direct'
      readonly endpoint: DurableTrustedMachineEndpoint
      readonly relayEpoch?: never
    }
  | {
      readonly connection: AuthenticatedRemoteMachineConnection
      readonly transport: 'relay'
      readonly endpoint?: never
      /** The exact outer Relay generation that carried peer authentication. */
      readonly relayEpoch: string
    }

interface TrackedExecutionSession {
  readonly transport: Exclude<MachineExecutionTransport, 'unavailable'>
  readonly session: { readonly closed: boolean }
}

interface CoordinatorTransport {
  beginPairing: typeof beginRemoteMachinePairing
  connectTrusted: typeof connectTrustedRemoteMachine
  openCodexSession?: typeof openRemoteCodexSession
  openClaudeSession?: typeof openRemoteClaudeSession
  connectTrustedOverStream?: typeof connectTrustedRemoteMachineOverStream
  openCodexSessionOverStream?: typeof openRemoteCodexSessionOverStream
  openClaudeSessionOverStream?: typeof openRemoteClaudeSessionOverStream
}

export interface RelayMachineTransport {
  status(machineId: MachineId): {
    readonly internetExecutionEnabled: boolean
  }
  /** Exact process-private outer Relay epoch when one is current. */
  connectionEpoch?(machineId: MachineId): string | undefined
  openMachineChannel(
    trust: DurableTrustedMachinePeer,
    signal?: AbortSignal,
  ): Promise<Duplex>
  openMachineRevocationChannel?(
    trust: DurableTrustedMachinePeer,
    signal?: AbortSignal,
  ): Promise<Duplex>
  subscribe(listener: (machineId: MachineId) => void): () => void
}

export type RemoteMachineTransportPolicy =
  'direct_first' | 'direct_only' | 'relay_only'

export interface SecureRemoteMachineCoordinatorOptions {
  readonly persistence: ConversationStore
  readonly credentialDirectory?: string
  /** Explicitly test-only. Production pairing always rejects loopback. */
  readonly allowLoopbackForTests?: boolean
  readonly heartbeatIntervalMs?: number
  readonly reconnectMaximumDelayMs?: number
  readonly now?: () => Date
  readonly random?: () => number
  /** Narrow deterministic seam for Host coordinator tests. */
  readonly transport?: CoordinatorTransport
  readonly relayTransport?: RelayMachineTransport
  /** Internal validation seam; normal product policy is direct-first. */
  readonly transportPolicy?: RemoteMachineTransportPolicy
  /** Narrow deterministic seam for credential-cleanup failure tests. */
  readonly deleteCredentialFile?: typeof deleteMachineTlsIdentityFile
}

/** Production Host coordinator for the bounded Host-to-Node transport. */
export class SecureRemoteMachineCoordinator implements RemoteMachineCoordinator {
  readonly #persistence: ConversationStore
  readonly #credentialDirectory: string
  readonly #allowLoopback: boolean
  readonly #heartbeatIntervalMs: number
  readonly #reconnectMaximumDelayMs: number
  readonly #now: () => Date
  readonly #random: () => number
  readonly #transport: CoordinatorTransport
  readonly #relayTransport: RelayMachineTransport | undefined
  readonly #transportPolicy: RemoteMachineTransportPolicy
  readonly #pending = new Map<MachinePairingAttemptId, PendingPairing>()
  readonly #workers = new Map<MachineId, RemoteWorker>()
  /** Mutating connection operations are linearized per durable Machine. */
  readonly #machineOperations = new Map<MachineId, Promise<unknown>>()
  readonly #retryTasks = new Map<MachineId, Promise<RemoteMachineConnection>>()
  readonly #providerDiscoveryTasks = new Map<MachineId, ProviderDiscoveryTask>()
  readonly #relayVerificationTasks = new Map<MachineId, RelayVerificationTask>()
  readonly #currentProviderObservations = new Map<MachineId, Timestamp>()
  readonly #states = new Map<MachineId, MachineConnectionState>()
  readonly #directStates = new Map<MachineId, MachineConnectionState>()
  readonly #lastExecutionTransports = new Map<
    MachineId,
    Exclude<MachineExecutionTransport, 'unavailable'>
  >()
  /** Current-Host observations of a peer-authenticated Machine TLS session. */
  readonly #relayVerifiedMachines = new Map<MachineId, string>()
  readonly #executionSessions = new Map<
    MachineId,
    Set<TrackedExecutionSession>
  >()
  /** Idle-route state withheld only while an independent session proves life. */
  readonly #deferredIdleRouteStates = new Map<
    MachineId,
    MachineConnectionState
  >()
  readonly #lastAttemptAt = new Map<MachineId, Timestamp>()
  readonly #listeners = new Set<
    (machineId: MachineId, state: MachineConnectionState) => void
  >()
  readonly #removalListeners = new Set<(machineId: MachineId) => void>()
  readonly #providerDiscoveryListeners = new Set<
    (observation: DurableRemoteProviderObservation) => void
  >()
  readonly #deleteCredentialFile: typeof deleteMachineTlsIdentityFile
  readonly #unsubscribeRelayStatus: (() => void) | undefined
  #pendingReservations = 0
  #closed = false

  private constructor(options: SecureRemoteMachineCoordinatorOptions) {
    this.#persistence = options.persistence
    this.#credentialDirectory = resolve(
      options.credentialDirectory ??
        join(dirname(options.persistence.databasePath), 'machine-credentials'),
    )
    this.#allowLoopback = options.allowLoopbackForTests === true
    this.#heartbeatIntervalMs = positiveInteger(
      options.heartbeatIntervalMs,
      machineTransportLimits.heartbeatIntervalMs,
      'heartbeat interval',
    )
    this.#reconnectMaximumDelayMs = positiveInteger(
      options.reconnectMaximumDelayMs,
      machineTransportLimits.heartbeatIntervalMs,
      'reconnect maximum delay',
    )
    this.#now = options.now ?? (() => new Date())
    this.#random = options.random ?? Math.random
    this.#transport = options.transport ?? {
      beginPairing: beginRemoteMachinePairing,
      connectTrusted: connectTrustedRemoteMachine,
      openCodexSession: openRemoteCodexSession,
      openClaudeSession: openRemoteClaudeSession,
      connectTrustedOverStream: connectTrustedRemoteMachineOverStream,
      openCodexSessionOverStream: openRemoteCodexSessionOverStream,
      openClaudeSessionOverStream: openRemoteClaudeSessionOverStream,
    }
    this.#relayTransport = options.relayTransport
    this.#transportPolicy = options.transportPolicy ?? 'direct_first'
    if (
      this.#transportPolicy !== 'direct_first' &&
      this.#transportPolicy !== 'direct_only' &&
      this.#transportPolicy !== 'relay_only'
    ) {
      throw new TypeError('Remote Machine transport policy is invalid')
    }
    this.#deleteCredentialFile =
      options.deleteCredentialFile ?? deleteMachineTlsIdentityFile
    this.#unsubscribeRelayStatus = this.#relayTransport?.subscribe(
      (machineId) => {
        const relayStatus = this.#relayTransport?.status(machineId)
        if (relayStatus?.internetExecutionEnabled !== true) {
          // Reconnect creates a new Relay epoch/channel generation. The old
          // inner Machine authentication proof cannot authorize that epoch.
          this.#relayVerifiedMachines.delete(machineId)
          // A new online observation can race this asynchronous stop while the
          // old task still owns the per-Machine slot. Reconcile again only
          // after that stale task has released ownership so the current Relay
          // epoch always receives its own inner Machine authentication.
          void this.#stopRelayVerification(machineId).then(() => {
            this.#reconcileRelayVerification(machineId)
          })
          return
        }
        const relayEpoch = this.#relayTransport?.connectionEpoch?.(machineId)
        if (relayEpoch === undefined) return
        if (this.#relayVerifiedMachines.get(machineId) !== relayEpoch) {
          this.#relayVerifiedMachines.delete(machineId)
        }
        const verification = this.#relayVerificationTasks.get(machineId)
        if (
          verification !== undefined &&
          verification.relayEpoch !== relayEpoch
        ) {
          void this.#stopRelayVerification(machineId).then(() => {
            this.#reconcileRelayVerification(machineId)
          })
          return
        }
        this.#reconcileRelayVerification(machineId)
      },
    )
  }

  static async create(
    options: SecureRemoteMachineCoordinatorOptions,
  ): Promise<SecureRemoteMachineCoordinator> {
    const coordinator = new SecureRemoteMachineCoordinator(options)
    await coordinator.#recoverDurablePeers()
    return coordinator
  }

  connectionState(machineId: MachineId): MachineConnectionState | undefined {
    return this.#states.get(MachineIdSchema.parse(machineId))
  }

  relayExecutionAvailable(machineId: MachineId): boolean {
    const id = MachineIdSchema.parse(machineId)
    return (
      this.#persistence.getTrustedMachinePeer(id)?.trustState === 'active' &&
      this.#relayVerifiedMachines.get(id) ===
        this.#relayTransport?.connectionEpoch?.(id) &&
      this.#relayTransport?.status(id).internetExecutionEnabled === true
    )
  }

  connectionDetails(machineId: MachineId): RemoteMachineConnection | undefined {
    const id = MachineIdSchema.parse(machineId)
    const state = this.#states.get(id)
    if (state === undefined || state === 'local') return undefined
    const observedDirectState = this.#directStates.get(id)
    const directState =
      observedDirectState === undefined || observedDirectState === 'local'
        ? state
        : observedDirectState
    const activeTransport =
      this.#liveExecutionTransport(id) ?? this.#workers.get(id)?.transport
    const executionTransport: MachineExecutionTransport =
      state === 'online'
        ? (activeTransport ?? this.#lastExecutionTransports.get(id) ?? 'direct')
        : 'unavailable'
    const preferred = this.#persistence
      .getTrustedMachinePeer(id)
      ?.endpoints.find((endpoint) => endpoint.preferred)
    return {
      state,
      directState,
      executionTransport,
      ...(preferred?.lastSuccessfulAt === undefined
        ? {}
        : {
            currentEndpoint: preferred.address,
            lastSuccessfulAt: preferred.lastSuccessfulAt,
          }),
      ...(this.#lastAttemptAt.get(id) === undefined
        ? {}
        : { lastAttemptAt: this.#lastAttemptAt.get(id) }),
    }
  }

  subscribeStatus(
    listener: (machineId: MachineId, state: MachineConnectionState) => void,
  ): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  subscribeRemoval(listener: (machineId: MachineId) => void): () => void {
    this.#removalListeners.add(listener)
    return () => this.#removalListeners.delete(listener)
  }

  subscribeProviderDiscovery(
    listener: (observation: DurableRemoteProviderObservation) => void,
  ): () => void {
    this.#providerDiscoveryListeners.add(listener)
    return () => this.#providerDiscoveryListeners.delete(listener)
  }

  providerDiscoveryCurrent(
    machineId: MachineId,
    observedAt: Timestamp,
  ): boolean {
    return (
      this.#states.get(MachineIdSchema.parse(machineId)) === 'online' &&
      this.#currentProviderObservations.get(machineId) ===
        TimestampSchema.parse(observedAt)
    )
  }

  providerExecutionAvailable(
    machineId: MachineId,
    provider?: 'codex' | 'claude-code',
  ): boolean {
    const id = MachineIdSchema.parse(machineId)
    const observation = this.#persistence.getRemoteProviderObservation(id)
    return (
      observation !== undefined &&
      this.providerDiscoveryCurrent(id, observation.observedAt) &&
      observation.providers.some(
        (descriptor) =>
          (provider === undefined || descriptor.provider === provider) &&
          remoteProviderExecutionProfileAvailable(
            descriptor,
            this.#transport.openCodexSession !== undefined ||
              this.#transport.openCodexSessionOverStream !== undefined,
            this.#transport.openClaudeSession !== undefined ||
              this.#transport.openClaudeSessionOverStream !== undefined,
          ),
      )
    )
  }

  async beginPairing(input: {
    readonly address: RemoteMachineAddress
    readonly pairingCode: string
  }): Promise<RemoteMachinePairingCandidate> {
    this.#assertOpen()
    if (
      this.#pending.size + this.#pendingReservations >=
      machineWireLimits.pairingAttempts
    ) {
      throw new RemoteMachineCoordinatorError(
        'pairing_rate_limited',
        'The pending pairing limit was reached',
      )
    }
    let pairingCode: ReturnType<typeof PairingCodeSchema.parse>
    try {
      pairingCode = PairingCodeSchema.parse(input.pairingCode)
    } catch {
      throw new RemoteMachineCoordinatorError(
        'pairing_code_invalid',
        'Pairing code is invalid',
      )
    }
    this.#pendingReservations += 1
    let credentialPath: string | undefined
    let controller: MachineControllerIdentity | undefined
    let pending: PendingRemoteMachinePairing | undefined
    let pairingAttemptId: MachinePairingAttemptId | undefined
    let registered = false
    try {
      const endpoint = await resolveLanEndpoint(
        input.address,
        this.#allowLoopback,
      )
      const controllerId = newControllerId()
      const credentialRef = `${controllerId}.json`
      credentialPath = this.#credentialPath(credentialRef)
      controller = {
        controllerId,
        tls: await createMachineTlsIdentityFile(
          credentialPath,
          'CodeTether Controller',
        ),
      }
      pending = await this.#transport.beginPairing({
        endpoint,
        pairingCode,
        controller,
      })
      pairingAttemptId = MachinePairingAttemptIdSchema.parse(
        pending.pairingAttemptId,
      )
      const candidate = parseRemoteMachinePairingCandidate({
        pairingAttemptId,
        machineId: MachineIdSchema.parse(pending.machine.machineId),
        displayName: pending.machine.displayName,
        platform: pending.machine.platform,
        architecture: pending.machine.architecture,
        address: endpoint,
        protocolVersion: machineProtocolVersion,
        expiresAt: TimestampSchema.parse(pending.expiresAt.toISOString()),
        verificationCode: formatVerificationCode(pending.verificationCode),
      })
      if (this.#pending.has(pairingAttemptId)) {
        throw new RemoteMachineCoordinatorError(
          'identity_mismatch',
          'Remote Node reused a live pairing attempt identity',
        )
      }
      // The public attempt identity is the Node's bounded one-time session ID.
      const attempt: PendingPairing = {
        pending,
        controller,
        credentialRef,
        credentialPath,
      }
      const registeredAttemptId = pairingAttemptId
      this.#pending.set(registeredAttemptId, attempt)
      registered = true
      attempt.expirationTimer = setTimeout(
        () => void this.#expirePairing(registeredAttemptId),
        Math.max(0, pending.expiresAt.getTime() - this.#now().getTime()),
      )
      return candidate
    } catch (error) {
      if (registered && pairingAttemptId !== undefined) {
        this.#pending.delete(pairingAttemptId)
      }
      await pending?.cancel().catch(() => undefined)
      if (controller !== undefined && credentialPath !== undefined) {
        await this.#deleteCredentialFile(credentialPath).catch(() => undefined)
      }
      throw coordinatorError(error)
    } finally {
      this.#pendingReservations -= 1
    }
  }

  async confirmPairing(
    pairingAttemptId: MachinePairingAttemptId,
    stageTrust: (candidate: ConfirmedRemoteMachine) => void | Promise<void>,
  ): Promise<ConfirmedRemoteMachine> {
    this.#assertOpen()
    const attemptId = MachinePairingAttemptIdSchema.parse(pairingAttemptId)
    const attempt = this.#pending.get(attemptId)
    if (attempt === undefined) throw pairingNotFound()
    this.#pending.delete(attemptId)
    if (attempt.expirationTimer !== undefined) {
      clearTimeout(attempt.expirationTimer)
    }
    let candidate: ConfirmedRemoteMachine | undefined
    let staged = false
    try {
      const prepared = this.#confirmedCandidate(attempt)
      candidate = prepared
      await stageTrust(prepared)
      staged = true
      const confirmed = await attempt.pending.confirm()
      if (
        confirmed.machine.machineId !== prepared.machine.machineId ||
        confirmed.machine.nodeId !== prepared.trust.nodeIdentity ||
        confirmed.nodeFingerprint !== prepared.trust.peerKeyFingerprint
      ) {
        throw new RemoteMachineCoordinatorError(
          'identity_mismatch',
          'Remote Machine identity changed during confirmation',
        )
      }
      setTimeout(() => this.#startDurableWorker(prepared.machine.machineId), 0)
      return prepared
    } catch (error) {
      await attempt.pending.cancel().catch(() => undefined)
      if (!staged) {
        await this.#deleteCredentialFile(attempt.credentialPath).catch(
          () => undefined,
        )
      } else if (candidate !== undefined) {
        this.#startDurableWorker(candidate.machine.machineId)
      }
      throw coordinatorError(error)
    }
  }

  async cancelPairing(
    pairingAttemptId: MachinePairingAttemptId,
  ): Promise<void> {
    const attemptId = MachinePairingAttemptIdSchema.parse(pairingAttemptId)
    const attempt = this.#pending.get(attemptId)
    if (attempt === undefined) throw pairingNotFound()
    this.#pending.delete(attemptId)
    if (attempt.expirationTimer !== undefined) {
      clearTimeout(attempt.expirationTimer)
    }
    let cancellationError: unknown
    try {
      await attempt.pending.cancel()
    } catch (error) {
      cancellationError = error
    } finally {
      await this.#deleteCredentialFile(attempt.credentialPath).catch(
        () => undefined,
      )
    }
    if (cancellationError !== undefined) {
      throw coordinatorError(cancellationError)
    }
  }

  async retry(
    machine: DurableMachine,
    trust: DurableTrustedMachinePeer,
  ): Promise<RemoteMachineConnection> {
    const id = MachineIdSchema.parse(machine.machineId)
    const existing = this.#retryTasks.get(id)
    if (existing !== undefined) return await existing
    const task = this.#serializeMachineOperation(id, async () => {
      const current = this.#requireCurrentActiveTrust(machine, trust)
      await this.#stopWorker(id)
      this.#setState(id, 'connecting')
      // Retry acknowledges immediately with an observable fresh attempt even
      // if loading the private controller credential has not completed yet.
      this.#recordAttempt(id)
      this.#startWorker(current.machine, current.trust)
      return this.connectionDetails(id) ?? { state: 'connecting' as const }
    })
    this.#retryTasks.set(id, task)
    try {
      return await task
    } finally {
      if (this.#retryTasks.get(id) === task) this.#retryTasks.delete(id)
    }
  }

  async updateAddress(
    machine: DurableMachine,
    trust: DurableTrustedMachinePeer,
    address: RemoteMachineAddress,
  ): Promise<RemoteMachineConnection> {
    const id = MachineIdSchema.parse(machine.machineId)
    return await this.#serializeMachineOperation(id, async () => {
      const current = this.#requireCurrentActiveTrust(machine, trust)
      // A manual address remains an in-memory candidate until this pinned TLS
      // connection succeeds; failed or poisoned candidates never enter SQLite.
      const endpoint = await resolveLanEndpoint(address, this.#allowLoopback)
      await this.#stopWorker(id)
      this.#setState(id, 'connecting')
      this.#recordAttempt(id)
      let connection: AuthenticatedRemoteMachineConnection | undefined
      try {
        const controller = await this.#loadController(current.trust)
        connection = await this.#transport.connectTrusted({
          peer: trustedPeer(current.machine, current.trust, endpoint),
          controller,
        })
        const authenticatedAt = TimestampSchema.parse(this.#now().toISOString())
        this.#persistence.recordTrustedMachineAuthentication(
          id,
          endpoint,
          authenticatedAt,
          'manual',
        )
        this.#setState(id, 'online')
        const result = this.connectionDetails(id) ?? {
          state: 'online' as const,
          currentEndpoint: endpoint,
          lastSuccessfulAt: authenticatedAt,
          lastAttemptAt: authenticatedAt,
        }
        connection.close()
        connection = undefined
        setTimeout(() => this.#startDurableWorker(id), 0)
        return result
      } catch (error) {
        connection?.close()
        const state = connectionStateFor(error)
        this.#setState(id, state === 'offline' ? 'recovery_required' : state)
        setTimeout(() => this.#startDurableWorker(id), 0)
        throw coordinatorError(error)
      }
    })
  }

  async validateProjectLocation(
    machine: DurableMachine,
    trust: DurableTrustedMachinePeer,
    rootPath: string,
  ): Promise<ValidatedRemoteProjectLocation> {
    const id = MachineIdSchema.parse(machine.machineId)
    return await this.#serializeMachineOperation(id, async () => {
      const current = this.#requireCurrentActiveTrust(machine, trust)
      // Validation temporarily replaces the heartbeat connection.  If this
      // Machine was execution-eligible, restore Provider freshness on the
      // same pinned connection before returning; otherwise Start Turn would
      // observe a stale descriptor immediately after its own authorization.
      const restoreExecutionDiscovery = this.providerExecutionAvailable(id)
      const wasOnline = this.#states.get(id) === 'online'
      await this.#stopWorker(id)
      // Replacing one already-authenticated connection with another exact
      // pinned connection is not a Machine outage. In particular, do not tell
      // Host runtimes to invalidate a live native Session merely because the
      // next Turn re-authorizes its registered ProjectLocation. A real dial,
      // authentication, or heartbeat failure below still transitions away
      // from online and invalidates sessions.
      if (!wasOnline) this.#setState(id, 'connecting')
      let route: RoutedMachineConnection | undefined
      try {
        const controller = await this.#loadController(current.trust)
        route = await this.#connectMachineByPolicy(
          current.machine,
          current.trust,
          controller,
        )
        const connection = route.connection

        const authenticatedAt = TimestampSchema.parse(this.#now().toISOString())
        this.#recordAuthenticatedRoute(id, route, authenticatedAt)
        this.#setState(id, 'online')
        const validated = await connection.validateProjectLocation(rootPath)
        if (restoreExecutionDiscovery) {
          await this.#discoverAndPersist(current.machine, connection)
        }
        connection.close()
        route = undefined
        setTimeout(() => this.#startDurableWorker(id), 0)
        return validated
      } catch (error) {
        route?.connection.close()
        if (isProjectLocationValidationError(error)) {
          // The pinned peer remains healthy when it truthfully rejects only
          // the requested directory. Path failures must not poison Machine
          // trust or trigger an authentication state.
          this.#setState(id, 'online')
        } else {
          this.#setState(id, connectionStateFor(error))
        }
        setTimeout(() => this.#startDurableWorker(id), 0)
        throw coordinatorError(error)
      }
    })
  }

  discoverProviders(
    machine: DurableMachine,
    trust: DurableTrustedMachinePeer,
  ): Promise<DurableRemoteProviderObservation> {
    const id = MachineIdSchema.parse(machine.machineId)
    const existing = this.#providerDiscoveryTasks.get(id)
    if (existing?.task !== undefined) return existing.task
    const discovery: ProviderDiscoveryTask = {
      abort: new AbortController(),
    }
    const task = this.#serializeMachineOperation(id, async () => {
      const current = this.#requireCurrentActiveTrust(machine, trust)
      let route: RoutedMachineConnection | undefined
      try {
        const controller = await this.#loadController(current.trust)
        route = await this.#connectMachineByPolicy(
          current.machine,
          current.trust,
          controller,
          discovery.abort.signal,
        )
        const connection = route.connection
        discovery.connection = connection
        this.#recordAuthenticatedRoute(
          id,
          route,
          TimestampSchema.parse(this.#now().toISOString()),
        )
        this.#setState(id, 'online')
        const observation = await this.#discoverAndPersist(
          current.machine,
          connection,
          discovery.abort.signal,
        )
        connection.close()
        route = undefined
        discovery.connection = undefined
        return observation
      } catch (error) {
        route?.connection.close()
        discovery.connection = undefined
        throw coordinatorError(error)
      }
    }).finally(() => {
      if (this.#providerDiscoveryTasks.get(id) === discovery) {
        this.#providerDiscoveryTasks.delete(id)
      }
    })
    discovery.task = task
    this.#providerDiscoveryTasks.set(id, discovery)
    return task
  }

  async openCodexSession(
    machine: DurableMachine,
    trust: DurableTrustedMachinePeer,
    input: {
      readonly conversationId: string
      readonly projectId: string
      readonly rootPath: string
      readonly providerThreadId?: string
    },
  ): Promise<RemoteCodexRuntimeSession> {
    const id = MachineIdSchema.parse(machine.machineId)
    return await this.#serializeMachineOperation(id, async () => {
      const current = this.#requireCurrentActiveTrust(machine, trust)
      if (!this.providerExecutionAvailable(id, 'codex')) {
        throw new RemoteMachineCoordinatorError(
          'remote_execution_unavailable',
          'Remote Codex execution is unavailable on this Machine',
        )
      }
      const controller = await this.#loadController(current.trust)
      let lastError: unknown
      const conversationId = MachineTransportConversationIdSchema.parse(
        input.conversationId,
      )
      const projectId = MachineTransportProjectIdSchema.parse(input.projectId)
      const providerThreadId =
        input.providerThreadId === undefined
          ? undefined
          : RemoteCodexProviderIdentitySchema.parse(input.providerThreadId)
      if (this.#transportPolicy !== 'relay_only') {
        for (const endpoint of current.trust.endpoints) {
          try {
            this.#recordAttempt(id)
            const session = await (
              this.#transport.openCodexSession ?? openRemoteCodexSession
            )({
              peer: trustedPeer(
                current.machine,
                current.trust,
                endpoint.address,
              ),
              controller,
              conversationId,
              projectId,
              rootPath: input.rootPath,
              ...(providerThreadId === undefined ? {} : { providerThreadId }),
            })
            const authenticatedAt = TimestampSchema.parse(
              this.#now().toISOString(),
            )
            this.#persistence.recordTrustedMachineAuthentication(
              id,
              endpoint.address,
              authenticatedAt,
            )
            this.#directStates.set(id, 'online')
            this.#lastExecutionTransports.set(id, 'direct')
            return remoteCodexRuntimeSession(
              session,
              'direct',
              this.#now,
              this.#trackExecutionSession(id, session, 'direct'),
            )
          } catch (error) {
            lastError = error
            // Once the exact Machine has authenticated, a rejected or lost
            // session-open operation may already own native Provider state.
            // Never try either another direct endpoint or Relay afterward.
            if (
              error instanceof MachineTransportError &&
              error.peerAuthenticated
            ) {
              throw coordinatorError(error)
            }
            this.#persistence.recordTrustedMachineEndpointFailure(
              id,
              endpoint.address,
              TimestampSchema.parse(this.#now().toISOString()),
            )
            this.#directStates.set(id, connectionStateFor(error))
            if (isPermanentConnectionError(error)) {
              throw coordinatorError(error)
            }
          }
        }
      }
      if (
        this.#transportPolicy !== 'direct_only' &&
        this.#relayTransport?.status(id).internetExecutionEnabled === true
      ) {
        let stream: Duplex | undefined
        try {
          const relayEpoch = this.#requireCurrentRelayEpoch(id)
          const endpoint = current.trust.endpoints[0]
          if (endpoint === undefined) {
            throw new RemoteMachineCoordinatorError(
              'connection_failed',
              'Trusted Machine identity endpoint is unavailable',
            )
          }
          this.#recordAttempt(id)
          stream = await this.#relayTransport.openMachineChannel(current.trust)
          const open =
            this.#transport.openCodexSessionOverStream ??
            openRemoteCodexSessionOverStream
          const session = await open({
            peer: trustedPeer(current.machine, current.trust, endpoint.address),
            controller,
            stream,
            conversationId,
            projectId,
            rootPath: input.rootPath,
            ...(providerThreadId === undefined ? {} : { providerThreadId }),
          })
          this.#assertCurrentRelayEpoch(id, relayEpoch)
          stream = undefined
          this.#persistence.recordTrustedMachineRelayAuthentication(
            id,
            TimestampSchema.parse(this.#now().toISOString()),
          )
          this.#lastExecutionTransports.set(id, 'relay')
          this.#markRelayVerified(id, relayEpoch)
          return remoteCodexRuntimeSession(
            session,
            'relay',
            this.#now,
            this.#trackExecutionSession(id, session, 'relay'),
          )
        } catch (error) {
          stream?.destroy()
          if (
            error instanceof MachineTransportError &&
            error.peerAuthenticated
          ) {
            throw coordinatorError(error)
          }
          if (isPermanentConnectionError(error)) {
            throw coordinatorError(error)
          }
          throw this.#relayFailure(error, 'relay_channel_open_failed')
        }
      }
      throw coordinatorError(
        lastError ?? new Error('No trusted endpoint is available'),
      )
    })
  }

  async openClaudeSession(
    machine: DurableMachine,
    trust: DurableTrustedMachinePeer,
    input: {
      readonly conversationId: string
      readonly projectId: string
      readonly rootPath: string
      readonly providerSessionId?: string
      readonly providerSessionMaterialized?: boolean
      readonly effort?: RemoteClaudeEffort
    },
  ): Promise<RemoteClaudeRuntimeSession> {
    const id = MachineIdSchema.parse(machine.machineId)
    return await this.#serializeMachineOperation(id, async () => {
      const current = this.#requireCurrentActiveTrust(machine, trust)
      if (!this.providerExecutionAvailable(id, 'claude-code')) {
        throw new RemoteMachineCoordinatorError(
          'remote_execution_unavailable',
          'Remote Claude Code execution is unavailable on this Machine',
        )
      }
      if (
        (input.providerSessionId === undefined) !==
        (input.providerSessionMaterialized === undefined)
      ) {
        throw new RemoteMachineCoordinatorError(
          'remote_policy_violation',
          'Remote Claude Code session materialization state is invalid',
        )
      }
      const controller = await this.#loadController(current.trust)
      let lastError: unknown
      const conversationId = MachineTransportConversationIdSchema.parse(
        input.conversationId,
      )
      const projectId = MachineTransportProjectIdSchema.parse(input.projectId)
      const providerSessionId =
        input.providerSessionId === undefined
          ? undefined
          : RemoteClaudeProviderIdentitySchema.parse(input.providerSessionId)
      if (this.#transportPolicy !== 'relay_only') {
        for (const endpoint of current.trust.endpoints) {
          try {
            this.#recordAttempt(id)
            const open =
              this.#transport.openClaudeSession ?? openRemoteClaudeSession
            const baseInput = {
              peer: trustedPeer(
                current.machine,
                current.trust,
                endpoint.address,
              ),
              controller,
              conversationId,
              projectId,
              rootPath: input.rootPath,
              ...(input.effort === undefined ? {} : { effort: input.effort }),
            }
            const session =
              providerSessionId === undefined
                ? await open(baseInput)
                : await open({
                    ...baseInput,
                    providerSessionId,
                    providerSessionMaterialized:
                      input.providerSessionMaterialized === true,
                  })
            const authenticatedAt = TimestampSchema.parse(
              this.#now().toISOString(),
            )
            this.#persistence.recordTrustedMachineAuthentication(
              id,
              endpoint.address,
              authenticatedAt,
            )
            this.#directStates.set(id, 'online')
            this.#lastExecutionTransports.set(id, 'direct')
            return remoteClaudeRuntimeSession(
              session,
              'direct',
              this.#now,
              this.#trackExecutionSession(id, session, 'direct'),
            )
          } catch (error) {
            lastError = error
            if (
              error instanceof MachineTransportError &&
              error.peerAuthenticated
            ) {
              throw coordinatorError(error)
            }
            this.#persistence.recordTrustedMachineEndpointFailure(
              id,
              endpoint.address,
              TimestampSchema.parse(this.#now().toISOString()),
            )
            this.#directStates.set(id, connectionStateFor(error))
            if (isPermanentConnectionError(error)) {
              throw coordinatorError(error)
            }
          }
        }
      }
      if (
        this.#transportPolicy !== 'direct_only' &&
        this.#relayTransport?.status(id).internetExecutionEnabled === true
      ) {
        let stream: Duplex | undefined
        try {
          const relayEpoch = this.#requireCurrentRelayEpoch(id)
          const endpoint = current.trust.endpoints[0]
          if (endpoint === undefined) {
            throw new RemoteMachineCoordinatorError(
              'connection_failed',
              'Trusted Machine identity endpoint is unavailable',
            )
          }
          this.#recordAttempt(id)
          stream = await this.#relayTransport.openMachineChannel(current.trust)
          const open =
            this.#transport.openClaudeSessionOverStream ??
            openRemoteClaudeSessionOverStream
          const baseInput = {
            peer: trustedPeer(current.machine, current.trust, endpoint.address),
            controller,
            stream,
            conversationId,
            projectId,
            rootPath: input.rootPath,
            ...(input.effort === undefined ? {} : { effort: input.effort }),
          }
          const session =
            providerSessionId === undefined
              ? await open(baseInput)
              : await open({
                  ...baseInput,
                  providerSessionId,
                  providerSessionMaterialized:
                    input.providerSessionMaterialized === true,
                })
          this.#assertCurrentRelayEpoch(id, relayEpoch)
          stream = undefined
          this.#persistence.recordTrustedMachineRelayAuthentication(
            id,
            TimestampSchema.parse(this.#now().toISOString()),
          )
          this.#lastExecutionTransports.set(id, 'relay')
          this.#markRelayVerified(id, relayEpoch)
          return remoteClaudeRuntimeSession(
            session,
            'relay',
            this.#now,
            this.#trackExecutionSession(id, session, 'relay'),
          )
        } catch (error) {
          stream?.destroy()
          if (
            error instanceof MachineTransportError &&
            error.peerAuthenticated
          ) {
            throw coordinatorError(error)
          }
          if (isPermanentConnectionError(error)) {
            throw coordinatorError(error)
          }
          throw this.#relayFailure(error, 'relay_channel_open_failed')
        }
      }
      throw coordinatorError(
        lastError ?? new Error('No trusted endpoint is available'),
      )
    })
  }

  async unpair(
    machine: DurableMachine,
    trust: DurableTrustedMachinePeer,
  ): Promise<void> {
    const id = MachineIdSchema.parse(machine.machineId)
    return await this.#serializeMachineOperation(id, async () => {
      this.#assertOpen()
      await this.#stopWorker(id)
      await this.#stopRelayVerification(id)
      let connection: AuthenticatedRemoteMachineConnection | undefined
      let authenticatedRevokeAttempt = false
      let authenticatedRevokeRejected = false
      try {
        const current = this.#requireCurrentRevokingTrust(machine, trust)
        const controller = await this.#loadController(current.trust)
        connection = (
          await this.#connectRevokingMachine(
            current.machine,
            current.trust,
            controller,
          )
        ).connection
        try {
          authenticatedRevokeAttempt = true
          await connection.revoke()
        } catch (error) {
          // Only this response followed a successful pinned connection.
          authenticatedRevokeRejected =
            isAuthenticatedPeerAuthenticationFailure(error)
          throw error
        }
        connection.close()
        connection = undefined
        try {
          await this.#deleteCredentialRequired(
            current.trust.controllerCredentialRef,
          )
        } catch {
          this.#startRevokingWorker(current.machine, current.trust, true)
          throw new RemoteMachineRevocationPendingError()
        }
        this.#setState(id, 'offline')
      } catch (error) {
        connection?.close()
        if (error instanceof RemoteMachineRevocationPendingError) {
          throw error
        }
        if (authenticatedRevokeAttempt) {
          this.#startRevokingWorker(
            machine,
            trust,
            authenticatedRevokeRejected,
            true,
          )
          throw new RemoteMachineRevocationPendingError()
        }
        throw coordinatorError(error)
      }
    })
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    this.#unsubscribeRelayStatus?.()
    const cleanups: Promise<unknown>[] = []
    for (const attempt of this.#pending.values()) {
      if (attempt.expirationTimer !== undefined) {
        clearTimeout(attempt.expirationTimer)
      }
      cleanups.push(
        (async () => {
          await attempt.pending.cancel().catch(() => undefined)
          await this.#deleteCredentialFile(attempt.credentialPath).catch(
            () => undefined,
          )
        })(),
      )
    }
    this.#pending.clear()
    for (const worker of this.#workers.values()) {
      worker.abort.abort()
      worker.connection?.close()
      if (worker.task !== undefined) cleanups.push(worker.task)
    }
    this.#workers.clear()
    for (const discovery of this.#providerDiscoveryTasks.values()) {
      discovery.abort.abort()
      discovery.connection?.close()
      if (discovery.task !== undefined) cleanups.push(discovery.task)
    }
    this.#providerDiscoveryTasks.clear()
    for (const verification of this.#relayVerificationTasks.values()) {
      verification.abort.abort()
      if (verification.task !== undefined) cleanups.push(verification.task)
    }
    this.#relayVerificationTasks.clear()
    await Promise.allSettled(cleanups)
    this.#listeners.clear()
    this.#removalListeners.clear()
    this.#providerDiscoveryListeners.clear()
    this.#currentProviderObservations.clear()
    this.#directStates.clear()
    this.#lastExecutionTransports.clear()
    this.#relayVerifiedMachines.clear()
    this.#executionSessions.clear()
    this.#deferredIdleRouteStates.clear()
  }

  async #expirePairing(
    pairingAttemptId: MachinePairingAttemptId,
  ): Promise<void> {
    const attempt = this.#pending.get(pairingAttemptId)
    if (attempt === undefined) return
    this.#pending.delete(pairingAttemptId)
    await attempt.pending.cancel().catch(() => undefined)
    await this.#deleteCredentialFile(attempt.credentialPath).catch(
      () => undefined,
    )
  }

  async #recoverDurablePeers(): Promise<void> {
    for (const trust of this.#persistence.listTrustedMachinePeers()) {
      const machine = this.#persistence.getMachine(trust.machineId)
      if (machine === undefined || machine.kind !== 'remote') continue
      if (trust.trustState === 'revoking') {
        this.#startRevokingWorker(machine, trust)
        continue
      }
      this.#states.set(machine.machineId, 'offline')
      this.#startWorker(machine, trust)
    }
  }

  #startRevokingWorker(
    machine: DurableMachine,
    trust: DurableTrustedMachinePeer,
    remoteRevocationKnown = false,
    priorRevokeAttempt = false,
  ): void {
    if (this.#workers.has(machine.machineId)) return
    const worker: RemoteWorker = { abort: new AbortController() }
    this.#workers.set(machine.machineId, worker)
    worker.task = this.#runRevokingWorker(
      machine,
      trust,
      worker,
      remoteRevocationKnown,
      priorRevokeAttempt,
    ).finally(() => {
      if (this.#workers.get(machine.machineId) === worker) {
        this.#workers.delete(machine.machineId)
      }
    })
  }

  async #runRevokingWorker(
    machine: DurableMachine,
    trust: DurableTrustedMachinePeer,
    worker: RemoteWorker,
    remoteRevocationKnown: boolean,
    priorRevokeAttempt: boolean,
  ): Promise<void> {
    let delayMs = Math.min(1_000, this.#reconnectMaximumDelayMs)
    // A Node can only prove that this controller has already been revoked by
    // rejecting the revocation request on an authenticated pinned connection.
    // Do not infer revocation from a later dial error at an old address.
    let remoteRevoked = remoteRevocationKnown
    let revokeAttempted = priorRevokeAttempt
    while (!this.#closed && !worker.abort.signal.aborted) {
      let connection: AuthenticatedRemoteMachineConnection | undefined
      try {
        if (!remoteRevoked) {
          const controller = await this.#loadController(trust)
          connection = (
            await this.#connectRevokingMachine(
              machine,
              trust,
              controller,
              worker.abort.signal,
            )
          ).connection
          worker.connection = connection
          try {
            revokeAttempted = true
            await connection.revoke(worker.abort.signal)
          } catch (error) {
            if (isAuthenticatedPeerAuthenticationFailure(error)) {
              remoteRevoked = true
            }
            throw error
          }
          connection = undefined
          remoteRevoked = true
        }
        await this.#finishRevoking(machine.machineId, trust)
        return
      } catch (error) {
        if (worker.abort.signal.aborted || this.#closed) return
        if (
          !remoteRevoked &&
          revokeAttempted &&
          isAuthenticatedPeerAuthenticationFailure(error)
        ) {
          // This is an explicit protocol rejection from the pinned Node after
          // an earlier revoke request. Local/pre-pin failures and Node-B
          // identity errors carry no such provenance and remain retryable.
          remoteRevoked = true
        }
        this.#states.set(machine.machineId, 'offline')
      } finally {
        connection?.close()
        worker.connection = undefined
      }
      await abortableDelay(
        jitteredDelay(delayMs, this.#random),
        worker.abort.signal,
      ).catch(() => undefined)
      delayMs = Math.min(delayMs * 2, this.#reconnectMaximumDelayMs)
    }
  }

  async #finishRevoking(
    machineId: MachineId,
    trust: DurableTrustedMachinePeer,
  ): Promise<void> {
    await this.#deleteCredentialRequired(trust.controllerCredentialRef)
    const removed = this.#persistence.deleteRemoteMachine(machineId)
    this.#states.delete(machineId)
    this.#deferredIdleRouteStates.delete(machineId)
    if (removed) {
      for (const listener of this.#removalListeners) {
        try {
          listener(machineId)
        } catch {
          // Removal is already durable; listeners are isolated observers.
        }
      }
    }
  }

  async #deleteCredentialRequired(credentialRef: string): Promise<void> {
    try {
      await this.#deleteCredentialFile(this.#credentialPath(credentialRef))
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return
      throw error
    }
  }

  #startDurableWorker(machineId: MachineId): void {
    if (this.#closed || this.#workers.has(machineId)) return
    const machine = this.#persistence.getMachine(machineId)
    const trust = this.#persistence.getTrustedMachinePeer(machineId)
    if (
      machine === undefined ||
      machine.kind !== 'remote' ||
      trust === undefined ||
      trust.trustState === 'revoking'
    ) {
      return
    }
    this.#startWorker(machine, trust)
  }

  async #stopWorker(machineId: MachineId): Promise<void> {
    const worker = this.#workers.get(machineId)
    worker?.abort.abort()
    worker?.connection?.close()
    await worker?.task?.catch(() => undefined)
    if (this.#workers.get(machineId) === worker) {
      this.#workers.delete(machineId)
    }
  }

  #recordAttempt(machineId: MachineId): Timestamp {
    const timestamp = TimestampSchema.parse(this.#now().toISOString())
    this.#lastAttemptAt.set(machineId, timestamp)
    return timestamp
  }

  async #serializeMachineOperation<T>(
    machineId: MachineId,
    operation: () => Promise<T>,
  ): Promise<T> {
    const predecessor = this.#machineOperations.get(machineId)
    const task = (predecessor ?? Promise.resolve()).then(operation)
    // Keep only a fulfilled tail in the coordination map.  Callers still
    // receive the operation's real failure, without leaving an unobserved
    // rejected promise behind solely for cleanup bookkeeping.
    const settled = task
      .then(
        () => undefined,
        () => undefined,
      )
      .then(() => {
        if (this.#machineOperations.get(machineId) === settled) {
          this.#machineOperations.delete(machineId)
        }
      })
    this.#machineOperations.set(machineId, settled)
    return await task
  }

  #requireCurrentActiveTrust(
    machine: DurableMachine,
    trust: DurableTrustedMachinePeer,
  ): {
    readonly machine: DurableMachine
    readonly trust: DurableTrustedMachinePeer
  } {
    this.#assertOpen()
    this.#assertActiveRemoteTrust(machine, trust)
    const currentMachine = this.#persistence.getMachine(machine.machineId)
    const currentTrust = this.#persistence.getTrustedMachinePeer(
      machine.machineId,
    )
    if (
      currentMachine === undefined ||
      currentMachine.kind !== 'remote' ||
      currentTrust === undefined ||
      currentTrust.trustState !== 'active' ||
      currentTrust.nodeIdentity !== trust.nodeIdentity ||
      currentTrust.peerKeyFingerprint !== trust.peerKeyFingerprint
    ) {
      throw new RemoteMachineCoordinatorError(
        'conflict',
        'Remote Machine trust changed while the connection operation waited',
      )
    }
    return { machine: currentMachine, trust: currentTrust }
  }

  #requireCurrentRevokingTrust(
    machine: DurableMachine,
    trust: DurableTrustedMachinePeer,
  ): {
    readonly machine: DurableMachine
    readonly trust: DurableTrustedMachinePeer
  } {
    this.#assertOpen()
    if (machine.kind !== 'remote' || machine.machineId !== trust.machineId) {
      throw new RemoteMachineCoordinatorError(
        'conflict',
        'Remote Machine trust does not match the Machine being unpaired',
      )
    }
    const currentMachine = this.#persistence.getMachine(machine.machineId)
    const currentTrust = this.#persistence.getTrustedMachinePeer(
      machine.machineId,
    )
    if (
      currentMachine === undefined ||
      currentMachine.kind !== 'remote' ||
      currentTrust === undefined ||
      currentTrust.trustState !== 'revoking' ||
      currentTrust.nodeIdentity !== trust.nodeIdentity ||
      currentTrust.peerKeyFingerprint !== trust.peerKeyFingerprint
    ) {
      throw new RemoteMachineCoordinatorError(
        'conflict',
        'Remote Machine trust changed while unpairing',
      )
    }
    return { machine: currentMachine, trust: currentTrust }
  }

  #assertActiveRemoteTrust(
    machine: DurableMachine,
    trust: DurableTrustedMachinePeer,
  ): void {
    if (
      machine.kind !== 'remote' ||
      machine.machineId !== trust.machineId ||
      trust.trustState !== 'active'
    ) {
      throw new RemoteMachineCoordinatorError(
        'conflict',
        'Remote Machine does not have active durable trust',
      )
    }
  }

  #startWorker(
    machine: DurableMachine,
    initialTrust: DurableTrustedMachinePeer,
  ): void {
    if (this.#workers.has(machine.machineId)) return
    const worker: RemoteWorker = { abort: new AbortController() }
    this.#workers.set(machine.machineId, worker)
    worker.task = this.#runWorker(machine, initialTrust, worker).finally(() => {
      if (this.#workers.get(machine.machineId) === worker) {
        this.#workers.delete(machine.machineId)
      }
    })
  }

  #startRelayVerification(
    machine: DurableMachine,
    trust: DurableTrustedMachinePeer,
  ): void {
    const relayEpoch = this.#relayTransport?.connectionEpoch?.(
      machine.machineId,
    )
    if (
      this.#closed ||
      relayEpoch === undefined ||
      this.#relayVerifiedMachines.get(machine.machineId) === relayEpoch ||
      this.#relayVerificationTasks.has(machine.machineId) ||
      this.#relayTransport === undefined ||
      this.#transport.connectTrustedOverStream === undefined
    ) {
      return
    }
    const task: RelayVerificationTask = {
      abort: new AbortController(),
      relayEpoch,
    }
    this.#relayVerificationTasks.set(machine.machineId, task)
    task.task = this.#verifyRelayMachine(
      machine,
      trust,
      relayEpoch,
      task.abort.signal,
    ).finally(() => {
      if (this.#relayVerificationTasks.get(machine.machineId) === task) {
        this.#relayVerificationTasks.delete(machine.machineId)
      }
    })
    void task.task.catch(() => undefined)
  }

  #reconcileRelayVerification(machineId: MachineId): void {
    if (this.#closed) return
    const machine = this.#persistence.getMachine(machineId)
    const trust = this.#persistence.getTrustedMachinePeer(machineId)
    if (
      machine?.kind !== 'remote' ||
      trust?.trustState !== 'active' ||
      this.#relayTransport?.status(machineId).internetExecutionEnabled !== true
    ) {
      return
    }
    if (this.#states.get(machineId) === 'online') {
      this.#startRelayVerification(machine, trust)
      return
    }
    void this.retry(machine, trust).catch(() => undefined)
  }

  async #verifyRelayMachine(
    machine: DurableMachine,
    trust: DurableTrustedMachinePeer,
    relayEpoch: string,
    signal: AbortSignal,
  ): Promise<void> {
    let stream: Duplex | undefined
    let connection: AuthenticatedRemoteMachineConnection | undefined
    try {
      const current = this.#persistence.getTrustedMachinePeer(machine.machineId)
      if (
        current?.trustState !== 'active' ||
        current.nodeIdentity !== trust.nodeIdentity ||
        current.peerKeyFingerprint !== trust.peerKeyFingerprint ||
        this.#relayTransport?.connectionEpoch?.(machine.machineId) !==
          relayEpoch ||
        this.#relayTransport?.status(machine.machineId)
          .internetExecutionEnabled !== true
      ) {
        return
      }
      const identityEndpoint = current.endpoints[0]
      if (identityEndpoint === undefined) return
      const controller = await this.#loadController(current)
      stream = await this.#relayTransport.openMachineChannel(current, signal)
      connection = await this.#transport.connectTrustedOverStream!({
        peer: trustedPeer(machine, current, identityEndpoint.address),
        controller,
        stream,
        signal,
      })
      stream = undefined
      await connection.ping(signal)
      const finalTrust = this.#persistence.getTrustedMachinePeer(
        machine.machineId,
      )
      if (
        !signal.aborted &&
        finalTrust?.trustState === 'active' &&
        finalTrust.nodeIdentity === trust.nodeIdentity &&
        finalTrust.peerKeyFingerprint === trust.peerKeyFingerprint &&
        this.#relayTransport.connectionEpoch?.(machine.machineId) ===
          relayEpoch &&
        this.#relayTransport.status(machine.machineId)
          .internetExecutionEnabled === true
      ) {
        this.#persistence.recordTrustedMachineRelayAuthentication(
          machine.machineId,
          TimestampSchema.parse(this.#now().toISOString()),
        )
        this.#markRelayVerified(machine.machineId, relayEpoch)
      }
    } finally {
      connection?.close()
      stream?.destroy()
    }
  }

  async #stopRelayVerification(machineId: MachineId): Promise<void> {
    const task = this.#relayVerificationTasks.get(machineId)
    if (task === undefined) return
    task.abort.abort()
    await task.task?.catch(() => undefined)
    if (this.#relayVerificationTasks.get(machineId) === task) {
      this.#relayVerificationTasks.delete(machineId)
    }
  }

  #trackExecutionSession(
    machineId: MachineId,
    session: { readonly closed: boolean },
    transport: Exclude<MachineExecutionTransport, 'unavailable'>,
  ): () => void {
    this.#pruneExecutionSessions(machineId)
    // This authenticated session is newer evidence than any failure withheld
    // for an earlier idle route.
    this.#deferredIdleRouteStates.delete(machineId)
    const tracked: TrackedExecutionSession = { transport, session }
    const sessions = this.#executionSessions.get(machineId) ?? new Set()
    sessions.add(tracked)
    this.#executionSessions.set(machineId, sessions)
    return () => {
      sessions.delete(tracked)
      if (sessions.size === 0) {
        this.#executionSessions.delete(machineId)
        const deferred = this.#deferredIdleRouteStates.get(machineId)
        this.#deferredIdleRouteStates.delete(machineId)
        if (
          deferred !== undefined &&
          !this.#closed &&
          this.#persistence.getTrustedMachinePeer(machineId)?.trustState ===
            'active'
        ) {
          this.#setState(machineId, deferred)
        }
      }
    }
  }

  #hasLiveExecutionSession(machineId: MachineId): boolean {
    this.#pruneExecutionSessions(machineId)
    return (this.#executionSessions.get(machineId)?.size ?? 0) > 0
  }

  #liveExecutionTransport(
    machineId: MachineId,
  ): Exclude<MachineExecutionTransport, 'unavailable'> | undefined {
    this.#pruneExecutionSessions(machineId)
    const sessions = this.#executionSessions.get(machineId)
    if (sessions === undefined) return undefined
    const preferred = this.#lastExecutionTransports.get(machineId)
    if (
      preferred !== undefined &&
      [...sessions].some((tracked) => tracked.transport === preferred)
    ) {
      return preferred
    }
    return sessions.values().next().value?.transport
  }

  #pruneExecutionSessions(machineId: MachineId): void {
    const sessions = this.#executionSessions.get(machineId)
    if (sessions === undefined) return
    for (const tracked of sessions) {
      if (tracked.session.closed) sessions.delete(tracked)
    }
    if (sessions.size === 0) this.#executionSessions.delete(machineId)
  }

  /**
   * Opens one peer-authenticated Machine connection for the existing
   * `trust.revoke` operation. Callers cannot use this path for Provider or
   * Project operations because ordinary Relay channels require active trust,
   * while this dedicated opener requires the exact durable revoking record.
   */
  async #connectRevokingMachine(
    machine: DurableMachine,
    trust: DurableTrustedMachinePeer,
    controller: MachineControllerIdentity,
    signal?: AbortSignal,
  ): Promise<RoutedMachineConnection> {
    let lastError: unknown
    if (this.#transportPolicy !== 'relay_only') {
      for (const endpoint of trust.endpoints) {
        try {
          this.#recordAttempt(machine.machineId)
          const connection = await this.#transport.connectTrusted({
            peer: trustedPeer(machine, trust, endpoint.address),
            controller,
            ...(signal === undefined ? {} : { signal }),
          })
          this.#directStates.set(machine.machineId, 'online')
          return { connection, transport: 'direct', endpoint }
        } catch (error) {
          lastError = error
          this.#directStates.set(machine.machineId, connectionStateFor(error))
          if (signal?.aborted === true || this.#closed) throw error
          this.#persistence.recordTrustedMachineEndpointFailure(
            machine.machineId,
            endpoint.address,
            TimestampSchema.parse(this.#now().toISOString()),
          )
          if (
            error instanceof MachineTransportError &&
            error.peerAuthenticated
          ) {
            throw error
          }
        }
      }
    }

    const openRevocation = this.#relayTransport?.openMachineRevocationChannel
    if (
      this.#transportPolicy !== 'direct_only' &&
      openRevocation !== undefined &&
      this.#relayTransport?.status(machine.machineId)
        .internetExecutionEnabled === true
    ) {
      let stream: Duplex | undefined
      try {
        const relayEpoch = this.#requireCurrentRelayEpoch(machine.machineId)
        const identityEndpoint = trust.endpoints[0]
        if (identityEndpoint === undefined) {
          throw new RemoteMachineCoordinatorError(
            'connection_failed',
            'Trusted Machine has no durable identity endpoint',
          )
        }
        this.#recordAttempt(machine.machineId)
        stream = await openRevocation.call(this.#relayTransport, trust, signal)
        const open =
          this.#transport.connectTrustedOverStream ??
          connectTrustedRemoteMachineOverStream
        const connection = await open({
          peer: trustedPeer(machine, trust, identityEndpoint.address),
          controller,
          stream,
          ...(signal === undefined ? {} : { signal }),
        })
        this.#assertCurrentRelayEpoch(machine.machineId, relayEpoch)
        stream = undefined
        return { connection, transport: 'relay', relayEpoch }
      } catch (error) {
        stream?.destroy()
        if (error instanceof MachineTransportError && error.peerAuthenticated) {
          throw error
        }
        if (isPermanentConnectionError(error)) throw error
        lastError = this.#relayFailure(error, 'relay_channel_open_failed')
      }
    }

    throw (
      lastError ??
      new RemoteMachineCoordinatorError(
        'connection_failed',
        'No authenticated Machine revocation transport is available',
      )
    )
  }

  async #connectMachineByPolicy(
    machine: DurableMachine,
    trust: DurableTrustedMachinePeer,
    controller: MachineControllerIdentity,
    signal?: AbortSignal,
    observation?: { retryableDirectFailure: boolean },
  ): Promise<RoutedMachineConnection> {
    let lastError: unknown
    if (
      this.#transportPolicy === 'relay_only' &&
      !this.#directStates.has(machine.machineId)
    ) {
      this.#directStates.set(machine.machineId, 'offline')
    }
    if (this.#transportPolicy !== 'relay_only') {
      this.#directStates.set(machine.machineId, 'connecting')
      for (const endpoint of trust.endpoints) {
        try {
          this.#recordAttempt(machine.machineId)
          const connection = await this.#transport.connectTrusted({
            peer: trustedPeer(machine, trust, endpoint.address),
            controller,
            ...(signal === undefined ? {} : { signal }),
          })
          this.#directStates.set(machine.machineId, 'online')
          return { connection, transport: 'direct', endpoint }
        } catch (error) {
          lastError = error
          this.#directStates.set(machine.machineId, connectionStateFor(error))
          if (!isPermanentConnectionError(error) && observation !== undefined) {
            observation.retryableDirectFailure = true
          }
          if (signal?.aborted === true || this.#closed) throw error
          this.#persistence.recordTrustedMachineEndpointFailure(
            machine.machineId,
            endpoint.address,
            TimestampSchema.parse(this.#now().toISOString()),
          )
          // Identity, authentication, and protocol failures are authoritative
          // for this exact trusted peer. Relay is an alternate transport, not
          // an alternate trust decision, so it must not mask these failures.
          if (isPermanentConnectionError(error)) throw error
          // An authenticated Machine rejection is authoritative. Trying the
          // same semantic peer through Relay cannot make it safe to continue.
          if (
            error instanceof MachineTransportError &&
            error.peerAuthenticated
          ) {
            throw error
          }
        }
      }
    }

    if (
      trust.trustState === 'active' &&
      this.#transportPolicy !== 'direct_only' &&
      this.#relayTransport !== undefined
    ) {
      if (
        !this.#relayTransport.status(machine.machineId).internetExecutionEnabled
      ) {
        if (this.#transportPolicy === 'relay_only') {
          throw this.#relayFailure(undefined, 'relay_transport_unavailable')
        }
      } else {
        this.#recordAttempt(machine.machineId)
        let stream: Duplex | undefined
        try {
          const relayEpoch = this.#requireCurrentRelayEpoch(machine.machineId)
          const endpoint = trust.endpoints[0]
          if (endpoint === undefined) {
            throw new RemoteMachineCoordinatorError(
              'connection_failed',
              'Trusted Machine has no durable identity endpoint',
            )
          }
          stream = await this.#relayTransport.openMachineChannel(trust, signal)
          const open =
            this.#transport.connectTrustedOverStream ??
            connectTrustedRemoteMachineOverStream
          const connection = await open({
            peer: trustedPeer(machine, trust, endpoint.address),
            controller,
            stream,
            ...(signal === undefined ? {} : { signal }),
          })
          this.#assertCurrentRelayEpoch(machine.machineId, relayEpoch)
          stream = undefined
          return { connection, transport: 'relay', relayEpoch }
        } catch (error) {
          stream?.destroy()
          if (isPermanentConnectionError(error)) throw error
          lastError = this.#relayFailure(error, 'relay_channel_open_failed')
        }
      }
    }
    throw (
      lastError ??
      new RemoteMachineCoordinatorError(
        'connection_failed',
        'No authenticated Machine transport is available',
      )
    )
  }

  #recordAuthenticatedRoute(
    machineId: MachineId,
    route: RoutedMachineConnection,
    authenticatedAt: Timestamp,
  ): DurableTrustedMachinePeer {
    this.#lastExecutionTransports.set(machineId, route.transport)
    if (route.transport === 'relay') {
      this.#assertCurrentRelayEpoch(machineId, route.relayEpoch)
      this.#markRelayVerified(machineId, route.relayEpoch)
    }
    return route.endpoint === undefined
      ? this.#persistence.recordTrustedMachineRelayAuthentication(
          machineId,
          authenticatedAt,
        )
      : this.#persistence.recordTrustedMachineAuthentication(
          machineId,
          route.endpoint.address,
          authenticatedAt,
          route.endpoint.source,
        )
  }

  #relayFailure(
    error: unknown,
    fallback: 'relay_transport_unavailable' | 'relay_channel_open_failed',
  ): RemoteMachineCoordinatorError {
    const carrier =
      typeof error === 'object' && error !== null
        ? (error as { readonly reason?: unknown; readonly code?: unknown })
        : undefined
    const reason = isRelayCanonicalFailureReason(carrier?.reason)
      ? carrier.reason
      : isRelayCanonicalFailureReason(carrier?.code)
        ? carrier.code
        : fallback === 'relay_transport_unavailable'
          ? 'relay_unreachable'
          : fallback
    return new RemoteMachineCoordinatorError(
      'connection_failed',
      'Internet Relay Machine transport is unavailable',
      {
        ...(error === undefined ? {} : { cause: error }),
        failure: canonicalFailure(reason, this.#now().toISOString()),
      },
    )
  }

  #requireCurrentRelayEpoch(machineId: MachineId): string {
    const relayEpoch = this.#relayTransport?.connectionEpoch?.(machineId)
    if (
      relayEpoch === undefined ||
      this.#relayTransport?.status(machineId).internetExecutionEnabled !== true
    ) {
      throw this.#relayFailure(undefined, 'relay_transport_unavailable')
    }
    return relayEpoch
  }

  #assertCurrentRelayEpoch(machineId: MachineId, relayEpoch: string): void {
    if (
      this.#relayTransport?.connectionEpoch?.(machineId) !== relayEpoch ||
      this.#relayTransport?.status(machineId).internetExecutionEnabled !== true
    ) {
      throw this.#relayFailure(
        { reason: 'relay_channel_lost' },
        'relay_channel_open_failed',
      )
    }
  }

  #markRelayVerified(machineId: MachineId, relayEpoch: string): void {
    if (
      this.#relayTransport?.connectionEpoch?.(machineId) !== relayEpoch ||
      this.#relayTransport?.status(machineId).internetExecutionEnabled !== true
    ) {
      return
    }
    if (this.#relayVerifiedMachines.get(machineId) === relayEpoch) return
    this.#relayVerifiedMachines.set(machineId, relayEpoch)
    const state = this.#states.get(machineId)
    if (state === undefined) return
    for (const listener of this.#listeners) listener(machineId, state)
  }

  async #runWorker(
    machine: DurableMachine,
    initialTrust: DurableTrustedMachinePeer,
    worker: RemoteWorker,
  ): Promise<void> {
    let delayMs = Math.min(1_000, this.#reconnectMaximumDelayMs)
    let trust = initialTrust
    while (!this.#closed && !worker.abort.signal.aborted) {
      // A successful purpose-specific authenticated handoff (for example
      // ProjectLocation validation immediately before execution) already
      // proves the Machine online. Do not manufacture a transient disconnect
      // or stale a freshly renewed Provider observation while establishing
      // the replacement heartbeat connection. Real dial/heartbeat failure
      // below still transitions offline and invalidates freshness.
      if (this.#states.get(machine.machineId) !== 'online') {
        this.#setState(machine.machineId, 'connecting')
      }
      let authenticatedRoute: RoutedMachineConnection | undefined
      const routeObservation = { retryableDirectFailure: false }
      let heartbeatActive = false
      try {
        const controller = await this.#loadController(trust)
        const route = await this.#connectMachineByPolicy(
          machine,
          trust,
          controller,
          worker.abort.signal,
          routeObservation,
        )
        authenticatedRoute = route
        const connection = route.connection
        worker.connection = connection
        worker.transport = route.transport
        const authenticatedAt = TimestampSchema.parse(this.#now().toISOString())
        if (trust.trustState === 'pending') {
          if (route.transport !== 'direct') {
            throw new RemoteMachineCoordinatorError(
              'authentication_failed',
              'Pending Machine trust cannot be activated through Relay',
            )
          }
          trust = this.#persistence.activateTrustedMachinePeer(
            machine.machineId,
            authenticatedAt,
          )
        } else {
          trust = this.#recordAuthenticatedRoute(
            machine.machineId,
            route,
            authenticatedAt,
          )
        }
        this.#setState(machine.machineId, 'online')
        if (
          route.transport === 'direct' &&
          this.#relayTransport?.status(machine.machineId)
            .internetExecutionEnabled === true
        ) {
          this.#startRelayVerification(machine, trust)
        }
        delayMs = Math.min(1_000, this.#reconnectMaximumDelayMs)
        if (typeof connection.discoverProviders === 'function') {
          void this.discoverProviders(machine, trust).catch(() => undefined)
        }
        heartbeatActive = true
        while (!this.#closed && !worker.abort.signal.aborted) {
          await abortableDelay(this.#heartbeatIntervalMs, worker.abort.signal)
          await connection.ping(worker.abort.signal)
        }
      } catch (error) {
        if (worker.abort.signal.aborted || this.#closed) return
        if (heartbeatActive && authenticatedRoute?.endpoint !== undefined) {
          this.#persistence.recordTrustedMachineEndpointFailure(
            machine.machineId,
            authenticatedRoute.endpoint.address,
            TimestampSchema.parse(this.#now().toISOString()),
          )
        }
        if (authenticatedRoute?.transport === 'direct') {
          this.#directStates.set(machine.machineId, connectionStateFor(error))
        }
        const state = connectionStateFor(error)
        // Purpose-specific Machine sessions own independent authenticated
        // sockets. Losing the idle coordinator route must not abort healthy
        // work on another channel; its own closure will fail that Turn.
        if (this.#hasLiveExecutionSession(machine.machineId)) {
          this.#deferredIdleRouteStates.set(machine.machineId, state)
        } else {
          this.#setState(machine.machineId, state)
        }
        if (isPermanentConnectionError(error)) {
          if (trust.trustState === 'pending') {
            try {
              await this.#discardPendingTrust(machine.machineId, trust)
              return
            } catch {
              // The private credential is the final local authority. Keep the
              // pending record and retry bounded cleanup rather than losing
              // its only durable reference.
            }
          } else if (!routeObservation.retryableDirectFailure) {
            return
          }
        }
      } finally {
        worker.connection?.close()
        worker.connection = undefined
        worker.transport = undefined
      }
      await abortableDelay(
        jitteredDelay(delayMs, this.#random),
        worker.abort.signal,
      ).catch(() => undefined)
      delayMs = Math.min(delayMs * 2, this.#reconnectMaximumDelayMs)
    }
  }

  async #discardPendingTrust(
    machineId: MachineId,
    trust: DurableTrustedMachinePeer,
  ): Promise<void> {
    await this.#deleteCredentialRequired(trust.controllerCredentialRef)
    this.#persistence.deleteRemoteMachine(machineId)
    this.#states.delete(machineId)
    this.#deferredIdleRouteStates.delete(machineId)
  }

  async #discoverAndPersist(
    machine: DurableMachine,
    connection: AuthenticatedRemoteMachineConnection,
    signal?: AbortSignal,
  ): Promise<DurableRemoteProviderObservation> {
    const discovery = await connection.discoverProviders(signal)
    const observation = this.#persistence.recordRemoteProviderObservation(
      remoteProviderObservation(
        machine.machineId,
        discovery,
        this.#now().toISOString(),
      ),
    )
    if (this.#states.get(machine.machineId) === 'online') {
      this.#currentProviderObservations.set(
        machine.machineId,
        observation.observedAt,
      )
    }
    for (const listener of this.#providerDiscoveryListeners) {
      try {
        listener(observation)
      } catch {
        // Discovery is already durable; presentation observers are isolated.
      }
    }
    return observation
  }

  #confirmedCandidate(attempt: PendingPairing): ConfirmedRemoteMachine {
    const trusted = attempt.pending.trustCandidate
    const timestamp = TimestampSchema.parse(this.#now().toISOString())
    const certificatePem = trusted.nodeCertificatePem
    if (certificatePem === undefined) {
      throw new RemoteMachineCoordinatorError(
        'authentication_failed',
        'Remote Machine certificate was unavailable during pairing',
      )
    }
    const peerPublicKeySpki = new X509Certificate(
      certificatePem,
    ).publicKey.export({ type: 'spki', format: 'der' })
    return {
      machine: {
        machineId: MachineIdSchema.parse(trusted.machine.machineId),
        displayName: trusted.machine.displayName,
        kind: 'remote',
        platform: trusted.machine.platform,
        architecture: trusted.machine.architecture,
        createdAt: timestamp,
      },
      trust: {
        machineId: MachineIdSchema.parse(trusted.machine.machineId),
        nodeIdentity: trusted.machine.nodeId,
        peerPublicKeySpki: new Uint8Array(peerPublicKeySpki),
        peerKeyFingerprint: trusted.nodeFingerprint,
        controllerCredentialRef: attempt.credentialRef,
        controllerKeyFingerprint: attempt.controller.tls.publicKeyFingerprint,
        trustState: 'pending',
        protocolVersion: trusted.protocolVersion,
        endpoints: [
          {
            address: trusted.endpoint,
            source: 'pairing',
            preferred: true,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ],
        pairedAt: timestamp,
        updatedAt: timestamp,
      },
    }
  }

  async #loadController(
    trust: DurableTrustedMachinePeer,
  ): Promise<MachineControllerIdentity> {
    const credentialRef = trust.controllerCredentialRef
    const controllerId = ControllerIdSchema.parse(
      basename(credentialRef, '.json'),
    )
    let tls
    try {
      tls = await readMachineTlsIdentityFile(
        this.#credentialPath(credentialRef),
      )
    } catch {
      throw new RemoteMachineCoordinatorError(
        'authentication_failed',
        'Controller credential is unavailable',
      )
    }
    if (tls.publicKeyFingerprint !== trust.controllerKeyFingerprint) {
      throw new RemoteMachineCoordinatorError(
        'identity_mismatch',
        'Controller credential does not match durable trust',
      )
    }
    return { controllerId, tls }
  }

  #credentialPath(credentialRef: string): string {
    const name = basename(credentialRef)
    if (
      name !== credentialRef ||
      !name.endsWith('.json') ||
      !ControllerIdSchema.safeParse(name.slice(0, -5)).success
    ) {
      throw new RemoteMachineCoordinatorError(
        'authentication_failed',
        'Controller credential reference is invalid',
      )
    }
    return join(this.#credentialDirectory, name)
  }

  #setState(machineId: MachineId, state: MachineConnectionState): void {
    // Any newer route observation supersedes a withheld idle-route failure.
    this.#deferredIdleRouteStates.delete(machineId)
    if (this.#states.get(machineId) === state) return
    this.#states.set(machineId, state)
    if (state !== 'online') this.#currentProviderObservations.delete(machineId)
    for (const listener of this.#listeners) listener(machineId, state)
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new RemoteMachineCoordinatorError(
        'unavailable',
        'Remote Machine coordinator is closed',
      )
    }
  }
}

export function parseRemoteMachinePairingCandidate(
  value: RemoteMachinePairingCandidate,
): RemoteMachinePairingCandidate {
  return RemoteMachinePairingCandidateSchema.parse(value)
}

export function remoteProviderObservation(
  machineId: MachineId,
  discovery: RemoteProviderDiscovery,
  receivedAt: string,
): DurableRemoteProviderObservation {
  const observedAt = TimestampSchema.parse(
    new Date(TimestampSchema.parse(receivedAt)).toISOString(),
  )
  const providers: readonly ProviderDescriptor[] = discovery.providers.map(
    ({ reasoningOptions, executionFailureReason, ...provider }) => {
      const executionHealth =
        executionFailureReason !== undefined
          ? {
              state: 'unavailable' as const,
              freshness: 'current' as const,
              observedAt,
              failure: canonicalFailure(executionFailureReason, observedAt),
            }
          : undefined
      return {
        ...provider,
        ...(reasoningOptions === undefined
          ? {}
          : {
              reasoningOptions: reasoningOptions.map((option) => ({
                ...option,
              })),
            }),
        ...(executionHealth === undefined ? {} : { executionHealth }),
      }
    },
  )
  for (const provider of providers) {
    const enabledCapabilities = Object.entries(provider.capabilities)
      .filter(([, enabled]) => enabled)
      .map(([capability]) => capability)
    if (
      enabledCapabilities.length > 0 &&
      !remoteProviderExecutionProfileAvailable(provider, true, true)
    ) {
      throw new RemoteMachineCoordinatorError(
        'protocol_incompatible',
        'Remote Provider capabilities exceed an admitted execution foundation',
      )
    }
  }
  return {
    machineId: MachineIdSchema.parse(machineId),
    providers,
    observedAt,
  }
}

function remoteProviderExecutionProfileAvailable(
  descriptor: ProviderDescriptor,
  codexTransportAvailable: boolean,
  claudeTransportAvailable: boolean,
): boolean {
  const enabled = Object.entries(descriptor.capabilities)
    .filter(([, value]) => value)
    .map(([capability]) => capability)
    .sort()
  if (descriptor.provider === 'codex') {
    return (
      codexTransportAvailable &&
      descriptor.availability === 'available' &&
      enabled.length === 2 &&
      enabled[0] === 'resume' &&
      enabled[1] === 'streaming'
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
    descriptor.availability === 'available' &&
    enabled.length === expected.length &&
    enabled.every((capability, index) => capability === expected[index]) &&
    descriptor.reasoningLabel !== undefined &&
    descriptor.reasoningOptions?.map(({ id }) => id).join(',') ===
      'low,medium,high,xhigh,max'
  )
}

function unavailable(): RemoteMachineCoordinatorError {
  return new RemoteMachineCoordinatorError(
    'unavailable',
    'Remote Machine pairing is currently unavailable',
  )
}

function pairingNotFound(): RemoteMachineCoordinatorError {
  return new RemoteMachineCoordinatorError(
    'not_found',
    'Pairing attempt was not found',
  )
}

function formatVerificationCode(value: string): string {
  if (!/^\d{6}$/u.test(value)) {
    throw new RemoteMachineCoordinatorError(
      'authentication_failed',
      'Pairing verification code was invalid',
    )
  }
  return `${value.slice(0, 3)} ${value.slice(3)}`
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
  label: string,
): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new TypeError(`${label} must be a positive integer`)
  }
  return resolved
}

async function resolveLanEndpoint(
  address: RemoteMachineAddress,
  allowLoopback: boolean,
): Promise<RemoteMachineAddress> {
  const port = address.port
  const literal = parseEndpointHost(address.host)
  if (isIP(literal) !== 0) {
    assertLanAddress(literal, allowLoopback)
    return { host: canonicalIpAddress(literal), port }
  }

  let resolved: readonly { readonly address: string }[]
  try {
    resolved = await boundedDnsLookup(literal)
  } catch {
    throw new RemoteMachineCoordinatorError(
      'connection_failed',
      'Remote Machine address could not be resolved',
    )
  }
  if (resolved.length === 0) {
    throw new RemoteMachineCoordinatorError(
      'connection_failed',
      'Remote Machine address did not resolve',
    )
  }
  for (const entry of resolved) assertLanAddress(entry.address, allowLoopback)
  const selected = resolved[0]?.address
  if (selected === undefined) {
    throw new RemoteMachineCoordinatorError(
      'connection_failed',
      'Remote Machine address did not resolve',
    )
  }
  return { host: canonicalIpAddress(selected), port }
}

function canonicalIpAddress(value: string): string {
  if (isIP(value) !== 6) return value.toLowerCase()
  const hostname = new URL(`http://[${value}]/`).hostname
  return hostname.slice(1, -1).toLowerCase()
}

function parseEndpointHost(value: string): string {
  const starts = value.startsWith('[')
  const ends = value.endsWith(']')
  if (starts !== ends || (starts && value.indexOf(']') !== value.length - 1)) {
    throw new RemoteMachineCoordinatorError(
      'connection_failed',
      'Remote Machine address has malformed IPv6 brackets',
    )
  }
  const host = starts ? value.slice(1, -1) : value
  if (host.includes('[') || host.includes(']') || host.includes('%')) {
    throw new RemoteMachineCoordinatorError(
      'connection_failed',
      'Remote Machine address uses an unsupported IPv6 scope',
    )
  }
  return host
}

async function boundedDnsLookup(
  host: string,
): Promise<readonly { readonly address: string }[]> {
  return await new Promise((resolvePromise, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error('Remote Machine DNS lookup timed out'))
    }, machineTransportLimits.handshakeTimeoutMs)
    timer.unref?.()
    void lookup(host, { all: true, verbatim: true }).then(
      (addresses) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolvePromise(addresses)
      },
      (error: unknown) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function assertLanAddress(value: string, allowLoopback: boolean): void {
  const address = value.toLowerCase()
  if (isIpv4(address)) {
    const [first = -1, second = -1] = address
      .split('.')
      .map((part) => Number(part))
    const loopback = first === 127
    const privateAddress =
      first === 10 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    const linkLocal = first === 169 && second === 254
    if (privateAddress || linkLocal || (allowLoopback && loopback)) return
  } else if (isIP(address) === 6) {
    const first = Number.parseInt(address.split(':')[0] ?? '', 16)
    const loopback = address === '::1'
    const uniqueLocal = Number.isFinite(first) && (first & 0xfe00) === 0xfc00
    if (uniqueLocal || (allowLoopback && loopback)) return
  }
  throw new RemoteMachineCoordinatorError(
    'connection_failed',
    'Remote Machine address must resolve only to a private LAN address',
  )
}

function isIpv4(value: string): boolean {
  return isIP(value) === 4
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

function trustedPeer(
  machine: DurableMachine,
  trust: DurableTrustedMachinePeer,
  endpoint: RemoteMachineAddress,
): TrustedRemotePeer {
  if (trust.protocolVersion !== machineProtocolVersion) {
    throw new RemoteMachineCoordinatorError(
      'protocol_incompatible',
      'Remote Machine protocol is incompatible',
    )
  }
  return {
    machine: {
      machineId: machine.machineId,
      nodeId: NodeIdSchema.parse(trust.nodeIdentity),
      displayName: machine.displayName,
      platform: machine.platform,
      architecture: machine.architecture,
    },
    endpoint,
    nodeFingerprint: PublicKeyFingerprintSchema.parse(trust.peerKeyFingerprint),
    protocolVersion: machineProtocolVersion,
    controllerId: ControllerIdSchema.parse(
      basename(trust.controllerCredentialRef, '.json'),
    ),
  }
}

function jitteredDelay(milliseconds: number, random: () => number): number {
  const sample = random()
  const bounded = Number.isFinite(sample)
    ? Math.min(1, Math.max(0, sample))
    : 0.5
  return Math.max(1, Math.round(milliseconds * (0.8 + bounded * 0.4)))
}

function coordinatorError(error: unknown): RemoteMachineCoordinatorError {
  if (error instanceof RemoteMachineCoordinatorError) return error
  if (error instanceof MachineTransportError) {
    let code: RemoteMachineCoordinatorErrorCode
    let message: string
    switch (error.code) {
      case 'pairing_failed':
        code = 'pairing_code_invalid'
        message = 'Pairing code is invalid'
        break
      case 'pairing_expired':
        code = 'pairing_code_expired'
        message = 'Pairing code has expired'
        break
      case 'pairing_rate_limited':
      case 'busy':
        code = 'pairing_rate_limited'
        message = 'Pairing attempts are temporarily limited'
        break
      case 'authentication_failed':
      case 'malformed_message':
        code = 'authentication_failed'
        message = 'Remote Machine authentication failed'
        break
      case 'identity_mismatch':
        code = 'identity_mismatch'
        message = 'Remote Machine identity does not match durable trust'
        break
      case 'protocol_incompatible':
        code = 'protocol_incompatible'
        message = 'Remote Machine protocol is incompatible'
        break
      case 'pairing_disabled':
        code = 'pairing_code_expired'
        message = 'Pairing mode is no longer active'
        break
      case 'connection_failed':
      case 'timeout':
        code = 'connection_failed'
        message = 'Remote Machine connection failed'
        break
      case 'project_location_path_invalid':
        code = 'project_location_path_invalid'
        message = 'Project Location path is invalid'
        break
      case 'project_location_missing':
        code = 'project_location_missing'
        message = 'Project Location directory does not exist'
        break
      case 'project_location_not_directory':
        code = 'project_location_not_directory'
        message = 'Project Location path is not a directory'
        break
      case 'project_location_inaccessible':
        code = 'project_location_inaccessible'
        message = 'Project Location directory is inaccessible'
        break
      case 'remote_execution_unavailable':
      case 'provider_unavailable':
      case 'provider_start_failed':
      case 'provider_session_lost':
      case 'remote_execution_lost':
      case 'remote_policy_violation':
      case 'conversation_busy':
      case 'duplicate_action_conflict':
        code = error.code
        message = 'Remote Provider execution failed'
        break
    }
    return new RemoteMachineCoordinatorError(code, message, {
      cause: error,
      ...(error.failure === undefined ? {} : { failure: error.failure }),
    })
  }
  return new RemoteMachineCoordinatorError(
    'connection_failed',
    'Remote Machine connection failed',
  )
}

function remoteCodexRuntimeSession(
  session: MachineTransportRemoteCodexSession,
  transport: Exclude<MachineExecutionTransport, 'unavailable'> = 'direct',
  now: () => Date = () => new Date(),
  release: () => void = () => undefined,
): RemoteCodexRuntimeSession {
  return {
    machineId: MachineIdSchema.parse(session.machine.machineId),
    conversationId: ConversationIdSchema.parse(session.conversationId),
    providerThreadId: session.providerThreadId,
    get closed() {
      return session.closed
    },
    startTurn: async (input) => {
      const turn = await session.startTurn({
        actionId: MachineTransportActionIdSchema.parse(input.actionId),
        turnId: MachineTransportTurnIdSchema.parse(input.turnId),
        prompt: input.prompt,
      })
      return {
        events: async function* () {
          let nextSequence = 1
          try {
            for await (const envelope of turn.events()) {
              nextSequence = envelope.sequence + 1
              yield { ...envelope.event, sequence: envelope.sequence }
            }
          } catch (error) {
            if (transport !== 'relay' || !isMachineConnectionLoss(error)) {
              throw error
            }
            yield {
              type: 'turn.failed' as const,
              code: 'remote_execution_lost',
              message: 'Internet Relay Machine channel was lost',
              sequence: nextSequence,
              failure: canonicalFailure(
                'relay_channel_lost',
                TimestampSchema.parse(now().toISOString()),
              ),
            }
          }
        },
      }
    },
    close: async () => {
      try {
        await session.close()
      } finally {
        release()
      }
    },
  }
}

function remoteClaudeRuntimeSession(
  session: MachineTransportRemoteClaudeSession,
  transport: Exclude<MachineExecutionTransport, 'unavailable'> = 'direct',
  now: () => Date = () => new Date(),
  release: () => void = () => undefined,
): RemoteClaudeRuntimeSession {
  return {
    machineId: MachineIdSchema.parse(session.machine.machineId),
    conversationId: ConversationIdSchema.parse(session.conversationId),
    providerSessionId: session.providerSessionId,
    ...(session.effort === undefined ? {} : { effort: session.effort }),
    get closed() {
      return session.closed
    },
    startTurn: async (input) => {
      const turn = await session.startTurn({
        actionId: MachineTransportActionIdSchema.parse(input.actionId),
        turnId: MachineTransportTurnIdSchema.parse(input.turnId),
        prompt: input.prompt,
      })
      return {
        events: async function* () {
          let nextSequence = 1
          try {
            for await (const envelope of turn.events()) {
              nextSequence = envelope.sequence + 1
              yield { ...envelope.event, sequence: envelope.sequence }
            }
          } catch (error) {
            if (transport !== 'relay' || !isMachineConnectionLoss(error)) {
              throw error
            }
            yield {
              type: 'turn.failed' as const,
              code: 'remote_execution_lost',
              message: 'Internet Relay Machine channel was lost',
              sequence: nextSequence,
              failure: canonicalFailure(
                'relay_channel_lost',
                TimestampSchema.parse(now().toISOString()),
              ),
            }
          }
        },
      }
    },
    close: async () => {
      try {
        await session.close()
      } finally {
        release()
      }
    },
  }
}

function isMachineConnectionLoss(error: unknown): boolean {
  return (
    error instanceof MachineTransportError &&
    (error.code === 'connection_failed' || error.code === 'timeout')
  )
}

function isRelayCanonicalFailureReason(
  value: unknown,
): value is CanonicalFailure['reason'] {
  if (!isCanonicalFailureReason(value)) return false
  switch (value) {
    case 'relay_not_configured':
    case 'relay_unreachable':
    case 'relay_authentication_failed':
    case 'relay_identity_mismatch':
    case 'relay_protocol_incompatible':
    case 'relay_revoked':
    case 'relay_rate_limited':
    case 'relay_channel_open_failed':
    case 'relay_channel_lost':
    case 'relay_peer_offline':
    case 'relay_transport_capacity_reached':
    case 'relay_protocol_error':
      return true
    default:
      return false
  }
}

function isProjectLocationValidationError(error: unknown): boolean {
  return (
    error instanceof MachineTransportError &&
    (error.code === 'project_location_path_invalid' ||
      error.code === 'project_location_missing' ||
      error.code === 'project_location_not_directory' ||
      error.code === 'project_location_inaccessible')
  )
}

function connectionStateFor(error: unknown): MachineConnectionState {
  const mapped = coordinatorError(error)
  if (
    mapped.code === 'authentication_failed' ||
    mapped.code === 'identity_mismatch'
  ) {
    return 'authentication_failed'
  }
  if (mapped.code === 'protocol_incompatible') return 'incompatible'
  return 'offline'
}

function isPermanentConnectionError(error: unknown): boolean {
  const code = coordinatorError(error).code
  return (
    code === 'authentication_failed' ||
    code === 'identity_mismatch' ||
    code === 'protocol_incompatible'
  )
}

function isAuthenticatedPeerAuthenticationFailure(error: unknown): boolean {
  return (
    error instanceof MachineTransportError &&
    error.code === 'authentication_failed' &&
    error.peerAuthenticated === true
  )
}

function abortableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    if (signal.aborted) {
      reject(new Error('Aborted'))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error('Aborted'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolvePromise()
    }, milliseconds)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
