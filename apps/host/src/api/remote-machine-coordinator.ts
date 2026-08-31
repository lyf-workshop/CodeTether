import { X509Certificate } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { basename, dirname, join, resolve } from 'node:path'

import {
  MachineIdSchema,
  MachinePairingAttemptIdSchema,
  RemoteMachinePairingCandidateSchema,
  TimestampSchema,
  machineWireLimits,
  type MachineConnectionState,
  type MachineId,
  type MachinePairingAttemptId,
  type RemoteMachineAddress,
  type RemoteMachineConnection,
  type RemoteMachinePairingCandidate,
  type Timestamp,
} from '@codetether/protocol'
import {
  ControllerIdSchema,
  MachineTransportError,
  PairingCodeSchema,
  PublicKeyFingerprintSchema,
  beginRemoteMachinePairing,
  connectTrustedRemoteMachine,
  createMachineTlsIdentityFile,
  deleteMachineTlsIdentityFile,
  machineProtocolVersion,
  machineTransportLimits,
  newControllerId,
  NodeIdSchema,
  readMachineTlsIdentityFile,
  type AuthenticatedRemoteMachineConnection,
  type MachineControllerIdentity,
  type PendingRemoteMachinePairing,
  type TrustedRemotePeer,
  type ValidatedRemoteProjectLocation,
} from '@codetether/machine-transport'

import type {
  ConversationStore,
  DurableMachine,
  DurableTrustedMachineEndpoint,
  DurableTrustedMachinePeer,
} from '../persistence/index.js'
import type { RemoteMachineStatusSource } from './machine-registry.js'

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

export class RemoteMachineCoordinatorError extends Error {
  constructor(
    readonly code: RemoteMachineCoordinatorErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'RemoteMachineCoordinatorError'
  }
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
  subscribeStatus?(
    listener: (
      machineId: MachineId,
      connectionState: MachineConnectionState,
    ) => void,
  ): () => void
  subscribeRemoval?(listener: (machineId: MachineId) => void): () => void
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
  close?(): Promise<void>
}

/** Default keeps remote transport unavailable without affecting local work. */
export class UnavailableRemoteMachineCoordinator implements RemoteMachineCoordinator {
  connectionState(): MachineConnectionState | undefined {
    return undefined
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
  task?: Promise<void>
}

interface CoordinatorTransport {
  beginPairing: typeof beginRemoteMachinePairing
  connectTrusted: typeof connectTrustedRemoteMachine
}

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
  readonly #pending = new Map<MachinePairingAttemptId, PendingPairing>()
  readonly #workers = new Map<MachineId, RemoteWorker>()
  /** Mutating connection operations are linearized per durable Machine. */
  readonly #machineOperations = new Map<MachineId, Promise<unknown>>()
  readonly #states = new Map<MachineId, MachineConnectionState>()
  readonly #lastAttemptAt = new Map<MachineId, Timestamp>()
  readonly #listeners = new Set<
    (machineId: MachineId, state: MachineConnectionState) => void
  >()
  readonly #removalListeners = new Set<(machineId: MachineId) => void>()
  readonly #deleteCredentialFile: typeof deleteMachineTlsIdentityFile
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
    }
    this.#deleteCredentialFile =
      options.deleteCredentialFile ?? deleteMachineTlsIdentityFile
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

  connectionDetails(machineId: MachineId): RemoteMachineConnection | undefined {
    const id = MachineIdSchema.parse(machineId)
    const state = this.#states.get(id)
    if (state === undefined || state === 'local') return undefined
    const preferred = this.#persistence
      .getTrustedMachinePeer(id)
      ?.endpoints.find((endpoint) => endpoint.preferred)
    return {
      state,
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
    return await this.#serializeMachineOperation(id, async () => {
      const current = this.#requireCurrentActiveTrust(machine, trust)
      await this.#stopWorker(id)
      this.#setState(id, 'connecting')
      // Retry acknowledges immediately with an observable fresh attempt even
      // if loading the private controller credential has not completed yet.
      this.#recordAttempt(id)
      this.#startWorker(current.machine, current.trust)
      return this.connectionDetails(id) ?? { state: 'connecting' }
    })
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
      await this.#stopWorker(id)
      this.#setState(id, 'connecting')
      let connection: AuthenticatedRemoteMachineConnection | undefined
      let authenticatedEndpoint: DurableTrustedMachineEndpoint | undefined
      let lastConnectionError: unknown
      try {
        const controller = await this.#loadController(current.trust)
        for (const endpoint of current.trust.endpoints) {
          try {
            this.#recordAttempt(id)
            connection = await this.#transport.connectTrusted({
              peer: trustedPeer(
                current.machine,
                current.trust,
                endpoint.address,
              ),
              controller,
            })
            authenticatedEndpoint = endpoint
            break
          } catch (error) {
            lastConnectionError = error
            this.#persistence.recordTrustedMachineEndpointFailure(
              id,
              endpoint.address,
              TimestampSchema.parse(this.#now().toISOString()),
            )
          }
        }
        if (connection === undefined || authenticatedEndpoint === undefined) {
          throw (
            lastConnectionError ?? new Error('No trusted endpoint is available')
          )
        }

        const authenticatedAt = TimestampSchema.parse(this.#now().toISOString())
        this.#persistence.recordTrustedMachineAuthentication(
          id,
          authenticatedEndpoint.address,
          authenticatedAt,
          authenticatedEndpoint.source,
        )
        this.#setState(id, 'online')
        const validated = await connection.validateProjectLocation(rootPath)
        connection.close()
        connection = undefined
        setTimeout(() => this.#startDurableWorker(id), 0)
        return validated
      } catch (error) {
        connection?.close()
        if (isProjectLocationValidationError(error)) {
          // The pinned peer remains healthy when it truthfully rejects only
          // the requested directory. Path failures must not poison Machine
          // trust or trigger an authentication state.
          this.#setState(id, 'online')
        } else {
          this.#setState(id, connectionStateFor(lastConnectionError ?? error))
        }
        setTimeout(() => this.#startDurableWorker(id), 0)
        throw coordinatorError(error)
      }
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
      let connection: AuthenticatedRemoteMachineConnection | undefined
      let authenticatedRevokeAttempt = false
      let authenticatedRevokeRejected = false
      try {
        const current = this.#requireCurrentRevokingTrust(machine, trust)
        const controller = await this.#loadController(current.trust)
        let connectionError: unknown
        for (const endpoint of current.trust.endpoints) {
          try {
            this.#recordAttempt(id)
            connection = await this.#transport.connectTrusted({
              peer: trustedPeer(
                current.machine,
                current.trust,
                endpoint.address,
              ),
              controller,
            })
            break
          } catch (error) {
            connectionError = error
            this.#persistence.recordTrustedMachineEndpointFailure(
              id,
              endpoint.address,
              TimestampSchema.parse(this.#now().toISOString()),
            )
          }
        }
        if (connection === undefined) {
          throw connectionError ?? new Error('No trusted endpoint is available')
        }
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
    await Promise.allSettled(cleanups)
    this.#listeners.clear()
    this.#removalListeners.clear()
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
    let delayMs = 1_000
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
          let lastError: unknown
          for (const endpoint of trust.endpoints) {
            try {
              this.#recordAttempt(machine.machineId)
              connection = await this.#transport.connectTrusted({
                peer: trustedPeer(machine, trust, endpoint.address),
                controller,
                signal: worker.abort.signal,
              })
              break
            } catch (error) {
              lastError = error
              this.#persistence.recordTrustedMachineEndpointFailure(
                machine.machineId,
                endpoint.address,
                TimestampSchema.parse(this.#now().toISOString()),
              )
            }
          }
          if (connection === undefined) {
            throw lastError ?? new Error('No trusted endpoint is available')
          }
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

  async #runWorker(
    machine: DurableMachine,
    initialTrust: DurableTrustedMachinePeer,
    worker: RemoteWorker,
  ): Promise<void> {
    let delayMs = 1_000
    let trust = initialTrust
    while (!this.#closed && !worker.abort.signal.aborted) {
      this.#setState(machine.machineId, 'connecting')
      let cycleError: unknown
      let cycleHasRetryableEndpointFailure = false
      let authenticatedEndpoint: DurableTrustedMachineEndpoint | undefined
      let heartbeatActive = false
      try {
        const controller = await this.#loadController(trust)
        let connection: AuthenticatedRemoteMachineConnection | undefined
        for (const endpoint of trust.endpoints) {
          try {
            this.#recordAttempt(machine.machineId)
            connection = await this.#transport.connectTrusted({
              peer: trustedPeer(machine, trust, endpoint.address),
              controller,
              signal: worker.abort.signal,
            })
            authenticatedEndpoint = endpoint
            break
          } catch (error) {
            cycleError = error
            if (!isPermanentConnectionError(error)) {
              cycleHasRetryableEndpointFailure = true
            }
            if (worker.abort.signal.aborted || this.#closed) return
            this.#persistence.recordTrustedMachineEndpointFailure(
              machine.machineId,
              endpoint.address,
              TimestampSchema.parse(this.#now().toISOString()),
            )
          }
        }
        if (connection === undefined || authenticatedEndpoint === undefined) {
          throw cycleError ?? new Error('No trusted endpoint is available')
        }
        worker.connection = connection
        const authenticatedAt = TimestampSchema.parse(this.#now().toISOString())
        if (trust.trustState === 'pending') {
          trust = this.#persistence.activateTrustedMachinePeer(
            machine.machineId,
            authenticatedAt,
          )
        } else {
          trust = this.#persistence.recordTrustedMachineAuthentication(
            machine.machineId,
            authenticatedEndpoint.address,
            authenticatedAt,
            authenticatedEndpoint.source,
          )
        }
        cycleError = undefined
        this.#setState(machine.machineId, 'online')
        delayMs = 1_000
        heartbeatActive = true
        while (!this.#closed && !worker.abort.signal.aborted) {
          await abortableDelay(this.#heartbeatIntervalMs, worker.abort.signal)
          await connection.ping(worker.abort.signal)
        }
      } catch (error) {
        if (worker.abort.signal.aborted || this.#closed) return
        if (heartbeatActive && authenticatedEndpoint !== undefined) {
          this.#persistence.recordTrustedMachineEndpointFailure(
            machine.machineId,
            authenticatedEndpoint.address,
            TimestampSchema.parse(this.#now().toISOString()),
          )
        }
        const state = connectionStateFor(cycleError ?? error)
        this.#setState(machine.machineId, state)
        if (isPermanentConnectionError(cycleError ?? error)) {
          if (trust.trustState === 'pending') {
            try {
              await this.#discardPendingTrust(machine.machineId, trust)
              return
            } catch {
              // The private credential is the final local authority. Keep the
              // pending record and retry bounded cleanup rather than losing
              // its only durable reference.
            }
          } else if (!cycleHasRetryableEndpointFailure) {
            return
          }
        }
      } finally {
        worker.connection?.close()
        worker.connection = undefined
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
    if (this.#states.get(machineId) === state) return
    this.#states.set(machineId, state)
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
    switch (error.code) {
      case 'pairing_failed':
        return new RemoteMachineCoordinatorError(
          'pairing_code_invalid',
          'Pairing code is invalid',
        )
      case 'pairing_expired':
        return new RemoteMachineCoordinatorError(
          'pairing_code_expired',
          'Pairing code has expired',
        )
      case 'pairing_rate_limited':
      case 'busy':
        return new RemoteMachineCoordinatorError(
          'pairing_rate_limited',
          'Pairing attempts are temporarily limited',
        )
      case 'authentication_failed':
      case 'malformed_message':
        return new RemoteMachineCoordinatorError(
          'authentication_failed',
          'Remote Machine authentication failed',
        )
      case 'identity_mismatch':
        return new RemoteMachineCoordinatorError(
          'identity_mismatch',
          'Remote Machine identity does not match durable trust',
        )
      case 'protocol_incompatible':
        return new RemoteMachineCoordinatorError(
          'protocol_incompatible',
          'Remote Machine protocol is incompatible',
        )
      case 'pairing_disabled':
        return new RemoteMachineCoordinatorError(
          'pairing_code_expired',
          'Pairing mode is no longer active',
        )
      case 'connection_failed':
      case 'timeout':
        return new RemoteMachineCoordinatorError(
          'connection_failed',
          'Remote Machine connection failed',
        )
      case 'project_location_path_invalid':
        return new RemoteMachineCoordinatorError(
          'project_location_path_invalid',
          'Project Location path is invalid',
        )
      case 'project_location_missing':
        return new RemoteMachineCoordinatorError(
          'project_location_missing',
          'Project Location directory does not exist',
        )
      case 'project_location_not_directory':
        return new RemoteMachineCoordinatorError(
          'project_location_not_directory',
          'Project Location path is not a directory',
        )
      case 'project_location_inaccessible':
        return new RemoteMachineCoordinatorError(
          'project_location_inaccessible',
          'Project Location directory is inaccessible',
        )
    }
  }
  return new RemoteMachineCoordinatorError(
    'connection_failed',
    'Remote Machine connection failed',
  )
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
