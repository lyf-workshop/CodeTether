import { basename, dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import type { Duplex } from 'node:stream'

import {
  canonicalFailure,
  type CanonicalFailureReason,
} from '@codetether/agent-core'
import {
  ControllerIdSchema,
  ReconnectWakeCoordinator,
  readMachineTlsIdentityFile,
} from '@codetether/machine-transport'
import {
  MachineIdSchema,
  RelayEndpointSchema,
  RelayEnrollmentTokenSchema,
  RelayIdentityFingerprintSchema,
  TimestampSchema,
  type MachineId,
  type RelayEndpoint,
  type RelayEnrollmentToken,
  type RelayIdentityFingerprint,
  type RelayMachineConnectivity,
} from '@codetether/protocol'
import {
  RelayClientError,
  connectRelayControl,
  type ConnectRelayControlOptions,
  type ConnectedRelayControl,
  type RelayControlConnection,
} from '@codetether/relay-client'
import {
  relayProtocolLimits,
  relayPublicKeySpkiFromCertificate,
  type RelayConnectionEpoch,
} from '@codetether/relay-protocol'

import type {
  ConversationStore,
  DurableMachineRelayConfiguration,
  DurableTrustedMachinePeer,
} from '../persistence/index.js'

export class ControllerRelayCoordinatorError extends Error {
  constructor(
    readonly reason: CanonicalFailureReason,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'ControllerRelayCoordinatorError'
  }
}

export interface ConfigureControllerRelayInput {
  readonly endpoint: RelayEndpoint
  readonly relayIdentityFingerprint: RelayIdentityFingerprint
  readonly displayLabel?: string
}

export interface ControllerRelayCoordinator {
  status(machineId: MachineId): RelayMachineConnectivity
  /** Process-private current Relay epoch; never exposed through Protocol/Web. */
  connectionEpoch?(machineId: MachineId): RelayConnectionEpoch | undefined
  subscribe(
    listener: (machineId: MachineId, status: RelayMachineConnectivity) => void,
  ): () => void
  /**
   * Wakes the existing Host-owned reconnect workers after a platform/network
   * lifecycle signal. This never creates product work or changes trust.
   * Returns the number of workers that accepted a coalesced wake request.
   */
  requestReconnect?(): number
  configure(
    trust: DurableTrustedMachinePeer,
    input: ConfigureControllerRelayInput,
  ): Promise<RelayMachineConnectivity>
  enroll(
    trust: DurableTrustedMachinePeer,
    token: RelayEnrollmentToken,
  ): Promise<RelayMachineConnectivity>
  retry(trust: DurableTrustedMachinePeer): Promise<RelayMachineConnectivity>
  openMachineChannel(
    trust: DurableTrustedMachinePeer,
    signal?: AbortSignal,
  ): Promise<Duplex>
  /** Dedicated teardown path; it never admits ordinary Machine execution. */
  openMachineRevocationChannel?(
    trust: DurableTrustedMachinePeer,
    signal?: AbortSignal,
  ): Promise<Duplex>
  disconnect(machineId: MachineId): Promise<RelayMachineConnectivity>
  remove(machineId: MachineId): Promise<RelayMachineConnectivity>
  close(): Promise<void>
}

interface RelayWorker {
  readonly abort: AbortController
  readonly reconnect: ReconnectWakeCoordinator
  task: Promise<void>
  connection?: RelayControlConnection
  cycleAbort?: AbortController
}

type ConnectRelay = typeof connectRelayControl

export interface SecureControllerRelayCoordinatorOptions {
  readonly persistence: ConversationStore
  readonly clientBuildIdentity: string
  readonly credentialDirectory?: string
  readonly connect?: ConnectRelay
  readonly now?: () => Date
  readonly random?: () => number
  readonly reconnectInitialDelayMs?: number
  readonly reconnectMaximumDelayMs?: number
  readonly reconnectStableResetMs?: number
  readonly monotonicNow?: () => number
}

const DEFAULT_RECONNECT_STABLE_RESET_MS = 60_000

/**
 * Host-owned, outbound-only Relay client. It owns infrastructure enrollment,
 * presence and bounded Machine byte channels, but has no Provider, Project,
 * Conversation or Turn semantics.
 */
export class SecureControllerRelayCoordinator implements ControllerRelayCoordinator {
  readonly #persistence: ConversationStore
  readonly #clientBuildIdentity: string
  readonly #credentialDirectory: string
  readonly #connect: ConnectRelay
  readonly #now: () => Date
  readonly #random: () => number
  readonly #initialDelayMs: number
  readonly #maximumDelayMs: number
  readonly #stableResetMs: number
  readonly #monotonicNow: () => number
  readonly #workers = new Map<MachineId, RelayWorker>()
  readonly #statuses = new Map<MachineId, RelayMachineConnectivity>()
  readonly #listeners = new Set<
    (machineId: MachineId, status: RelayMachineConnectivity) => void
  >()
  #closed = false

  private constructor(options: SecureControllerRelayCoordinatorOptions) {
    this.#persistence = options.persistence
    this.#clientBuildIdentity = options.clientBuildIdentity
    this.#credentialDirectory = resolve(
      options.credentialDirectory ??
        join(dirname(options.persistence.databasePath), 'machine-credentials'),
    )
    this.#connect = options.connect ?? connectRelayControl
    this.#now = options.now ?? (() => new Date())
    this.#random = options.random ?? Math.random
    this.#initialDelayMs = positiveInteger(
      options.reconnectInitialDelayMs,
      relayProtocolLimits.reconnectInitialDelayMs,
      'Relay reconnect initial delay',
    )
    this.#maximumDelayMs = positiveInteger(
      options.reconnectMaximumDelayMs,
      relayProtocolLimits.reconnectMaximumDelayMs,
      'Relay reconnect maximum delay',
    )
    if (this.#initialDelayMs > this.#maximumDelayMs) {
      throw new TypeError('Relay reconnect delay bounds are invalid')
    }
    this.#stableResetMs = positiveInteger(
      options.reconnectStableResetMs,
      DEFAULT_RECONNECT_STABLE_RESET_MS,
      'Relay reconnect stable reset',
    )
    this.#monotonicNow = options.monotonicNow ?? (() => performance.now())
  }

  static async create(
    options: SecureControllerRelayCoordinatorOptions,
  ): Promise<SecureControllerRelayCoordinator> {
    const coordinator = new SecureControllerRelayCoordinator(options)
    for (const configuration of options.persistence.listEnabledMachineRelayConfigurations()) {
      if (configuration.enrollmentState === 'enrolled') {
        coordinator.#startWorker(configuration.machineId)
      }
    }
    return coordinator
  }

  status(machineId: MachineId): RelayMachineConnectivity {
    const id = MachineIdSchema.parse(machineId)
    return this.#statuses.get(id) ?? this.#durableStatus(id)
  }

  connectionEpoch(machineId: MachineId): RelayConnectionEpoch | undefined {
    const id = MachineIdSchema.parse(machineId)
    return this.#workers.get(id)?.connection?.connectionEpoch
  }

  subscribe(
    listener: (machineId: MachineId, status: RelayMachineConnectivity) => void,
  ): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  requestReconnect(): number {
    if (this.#closed) return 0
    let requested = 0
    for (const [machineId, worker] of this.#workers) {
      if (!worker.reconnect.requestWake()) continue
      requested += 1
      const connection = worker.connection
      worker.connection = undefined
      const configuration =
        this.#persistence.getMachineRelayConfiguration(machineId)
      if (configuration !== undefined) {
        this.#setStatus(
          machineId,
          this.#statusFromConfiguration(configuration, 'reconnecting'),
        )
      }
      worker.cycleAbort?.abort()
      void connection?.close().catch(() => undefined)
    }
    return requested
  }

  async configure(
    trust: DurableTrustedMachinePeer,
    input: ConfigureControllerRelayInput,
  ): Promise<RelayMachineConnectivity> {
    this.#assertOpen()
    const endpoint = RelayEndpointSchema.parse(input.endpoint)
    const relayIdentityFingerprint = RelayIdentityFingerprintSchema.parse(
      input.relayIdentityFingerprint,
    )
    await this.#stopWorker(trust.machineId)

    // A configuration is retained only after the endpoint proves the exact
    // explicitly confirmed Relay identity. Unknown peer authentication is an
    // expected first-enrollment result after that signed challenge succeeds.
    let authenticated: ConnectedRelayControl | undefined
    try {
      authenticated = await this.#connectOnce(
        trust,
        { endpoint, relayIdentityFingerprint },
        undefined,
      )
    } catch (error) {
      if (!isUnknownEnrollment(error)) {
        this.#restoreDurableWorker(trust.machineId)
        throw coordinatorError(error)
      }
    }

    try {
      let configuration = this.#persistence.configureMachineRelay(
        trust.machineId,
        endpoint,
        relayIdentityFingerprint,
        this.#timestamp(),
        input.displayLabel,
      )
      if (authenticated !== undefined) {
        if (configuration.enrollmentState === 'required') {
          configuration = this.#persistence.markMachineRelayEnrolled(
            trust.machineId,
            this.#timestamp(),
          )
        }
        const transferred = authenticated
        authenticated = undefined
        this.#startWorker(trust.machineId, transferred)
        return this.status(trust.machineId)
      }

      this.#setStatus(
        trust.machineId,
        this.#statusFromConfiguration(configuration),
      )
      return this.status(trust.machineId)
    } catch (error) {
      await authenticated?.connection.close().catch(() => undefined)
      this.#restoreDurableWorker(trust.machineId)
      throw error
    }
  }

  async enroll(
    trust: DurableTrustedMachinePeer,
    token: RelayEnrollmentToken,
  ): Promise<RelayMachineConnectivity> {
    this.#assertOpen()
    const enrollmentToken = RelayEnrollmentTokenSchema.parse(token)
    const configuration = this.#requireConfiguration(trust.machineId)
    await this.#stopWorker(trust.machineId)

    let connected: ConnectedRelayControl | undefined
    try {
      if (configuration.enrollmentState === 'revoked') {
        // Normal authentication is intentionally denied after revocation.
        // Only this explicit action with a newly supplied one-time token may
        // restore the exact existing Controller identity and role.
        connected = await this.#connectOnce(
          trust,
          configuration,
          enrollmentToken,
        )
      } else {
        // Recover the committed-enrollment/lost-response window before trying
        // the one-time token. This avoids interpreting response loss as proof
        // that token consumption did not happen. If the Relay has revoked an
        // otherwise locally enrolled peer, this explicit token-bearing action
        // is also the only allowed path back to an enrolled state.
        try {
          connected = await this.#connectOnce(trust, configuration, undefined)
        } catch (error) {
          if (!canExplicitlyEnroll(error)) throw error
          connected = await this.#connectOnce(
            trust,
            configuration,
            enrollmentToken,
          )
        }
      }
    } catch (error) {
      const failure = coordinatorError(error)
      this.#setFailureStatus(trust.machineId, failure.reason)
      throw failure
    }

    try {
      if (configuration.enrollmentState !== 'enrolled') {
        this.#persistence.markMachineRelayEnrolled(
          trust.machineId,
          this.#timestamp(),
        )
      }
      const transferred = connected
      connected = undefined
      this.#startWorker(trust.machineId, transferred)
      return this.status(trust.machineId)
    } catch (error) {
      await connected?.connection.close().catch(() => undefined)
      this.#restoreDurableWorker(trust.machineId)
      throw error
    }
  }

  async retry(
    trust: DurableTrustedMachinePeer,
  ): Promise<RelayMachineConnectivity> {
    this.#assertOpen()
    const configuration = this.#requireConfiguration(trust.machineId)
    if (configuration.enrollmentState !== 'enrolled') {
      throw new ControllerRelayCoordinatorError(
        configuration.enrollmentState === 'revoked'
          ? 'relay_revoked'
          : 'relay_not_configured',
        'Internet Relay enrollment is not available',
      )
    }
    await this.#stopWorker(trust.machineId)
    this.#persistence.setMachineRelayEnabled(
      trust.machineId,
      true,
      this.#timestamp(),
    )
    this.#startWorker(trust.machineId)
    return this.status(trust.machineId)
  }

  async openMachineChannel(
    trust: DurableTrustedMachinePeer,
    signal?: AbortSignal,
  ): Promise<Duplex> {
    return await this.#openMachineChannel(trust, 'active', signal)
  }

  async openMachineRevocationChannel(
    trust: DurableTrustedMachinePeer,
    signal?: AbortSignal,
  ): Promise<Duplex> {
    return await this.#openMachineChannel(trust, 'revoking', signal)
  }

  async #openMachineChannel(
    trust: DurableTrustedMachinePeer,
    requiredTrustState: 'active' | 'revoking',
    signal?: AbortSignal,
  ): Promise<Duplex> {
    this.#assertOpen()
    const current = this.#persistence.getTrustedMachinePeer(trust.machineId)
    if (
      current?.trustState !== requiredTrustState ||
      trust.trustState !== requiredTrustState ||
      current.nodeIdentity !== trust.nodeIdentity ||
      current.peerKeyFingerprint !== trust.peerKeyFingerprint ||
      current.controllerKeyFingerprint !== trust.controllerKeyFingerprint ||
      current.controllerCredentialRef !== trust.controllerCredentialRef
    ) {
      throw new ControllerRelayCoordinatorError(
        'relay_authentication_failed',
        'Internet Relay Machine channel is not bound to current Machine trust',
      )
    }
    const status = this.status(trust.machineId)
    const worker = this.#workers.get(trust.machineId)
    if (
      !status.internetExecutionEnabled ||
      status.nodePresence !== 'online' ||
      worker?.connection === undefined
    ) {
      throw new ControllerRelayCoordinatorError(
        status.state === 'connected'
          ? 'relay_peer_offline'
          : (status.failure?.reason ?? 'relay_unreachable'),
        'Internet Relay Machine transport is unavailable',
      )
    }
    const connection = worker.connection
    try {
      const stream = await connection.openMachineChannel(
        current.peerKeyFingerprint,
        signal === undefined ? {} : { signal },
      )
      if (worker.connection !== connection) {
        stream.destroy()
        throw new ControllerRelayCoordinatorError(
          'relay_channel_lost',
          'Internet Relay Machine channel generation changed while opening',
        )
      }
      return stream
    } catch (error) {
      throw coordinatorError(error)
    }
  }

  async disconnect(machineId: MachineId): Promise<RelayMachineConnectivity> {
    const id = MachineIdSchema.parse(machineId)
    await this.#stopWorker(id)
    const configuration = this.#persistence.setMachineRelayEnabled(
      id,
      false,
      this.#timestamp(),
    )
    const status = this.#statusFromConfiguration(configuration)
    this.#setStatus(id, status)
    return status
  }

  async remove(machineId: MachineId): Promise<RelayMachineConnectivity> {
    const id = MachineIdSchema.parse(machineId)
    await this.#stopWorker(id)
    this.#persistence.deleteMachineRelayConfiguration(id)
    this.#statuses.delete(id)
    const status = this.#durableStatus(id)
    for (const listener of this.#listeners) listener(id, status)
    return status
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    await Promise.all(
      [...this.#workers.keys()].map(async (id) => this.#stopWorker(id)),
    )
    this.#listeners.clear()
  }

  #startWorker(
    machineId: MachineId,
    initialConnection?: ConnectedRelayControl,
  ): void {
    if (this.#closed || this.#workers.has(machineId)) {
      void initialConnection?.connection.close().catch(() => undefined)
      return
    }
    const abort = new AbortController()
    const worker: RelayWorker = {
      abort,
      reconnect: new ReconnectWakeCoordinator({
        initialDelayMs: this.#initialDelayMs,
        maximumDelayMs: this.#maximumDelayMs,
        stableResetMs: this.#stableResetMs,
        random: this.#random,
      }),
      task: Promise.resolve(),
    }
    // Publish ownership before an already-authenticated transferred
    // connection can synchronously enter the generation guard.
    this.#workers.set(machineId, worker)
    worker.task = this.#runWorker(machineId, worker, initialConnection).finally(
      () => {
        if (this.#workers.get(machineId) === worker) {
          this.#workers.delete(machineId)
        }
      },
    )
  }

  async #runWorker(
    machineId: MachineId,
    worker: RelayWorker,
    initialConnection?: ConnectedRelayControl,
  ): Promise<void> {
    let firstAttempt = initialConnection === undefined
    let suppliedConnection = initialConnection
    while (!this.#closed && !worker.abort.signal.aborted) {
      worker.reconnect.consumePendingWake()
      const configuration =
        this.#persistence.getMachineRelayConfiguration(machineId)
      const trust = this.#persistence.getTrustedMachinePeer(machineId)
      if (
        configuration === undefined ||
        !configuration.enabled ||
        configuration.enrollmentState !== 'enrolled' ||
        (trust?.trustState !== 'active' && trust?.trustState !== 'revoking')
      ) {
        return
      }
      this.#setStatus(
        machineId,
        this.#statusFromConfiguration(
          configuration,
          firstAttempt ? 'connecting' : 'reconnecting',
        ),
      )
      firstAttempt = false
      let retryAfterMs = 0
      let connectionAuthenticated = false
      const cycleAbort = new AbortController()
      worker.cycleAbort = cycleAbort
      try {
        if (suppliedConnection === undefined) {
          this.#persistence.recordMachineRelayAttempt(
            machineId,
            this.#timestamp(),
          )
        }
        const connected =
          suppliedConnection ??
          (await this.#connectOnce(
            trust,
            configuration,
            undefined,
            AbortSignal.any([worker.abort.signal, cycleAbort.signal]),
          ))
        suppliedConnection = undefined
        if (
          this.#workers.get(machineId) !== worker ||
          worker.abort.signal.aborted ||
          cycleAbort.signal.aborted
        ) {
          await connected.connection.close().catch(() => undefined)
          continue
        }
        worker.connection = connected.connection
        connectionAuthenticated = true
        worker.reconnect.noteConnected(this.#monotonicNow())
        this.#persistence.recordMachineRelayConnected(
          machineId,
          this.#timestamp(),
        )
        await connected.connection.subscribeToNode(
          trust.peerKeyFingerprint,
          (observation) => {
            if (
              cycleAbort.signal.aborted ||
              worker.connection !== connected.connection
            ) {
              return
            }
            const current =
              this.#persistence.getMachineRelayConfiguration(machineId)
            if (current === undefined) return
            this.#setStatus(
              machineId,
              this.#statusFromConfiguration(
                current,
                'connected',
                observation.state === 'online'
                  ? 'online'
                  : observation.state === 'offline'
                    ? 'offline'
                    : 'unauthorized',
              ),
            )
          },
        )
        if (
          cycleAbort.signal.aborted ||
          worker.connection !== connected.connection
        ) {
          continue
        }
        this.#setStatus(
          machineId,
          this.#statusFromConfiguration(configuration, 'connected'),
        )
        await connected.connection.waitUntilClosed()
      } catch (error) {
        if (this.#closed || worker.abort.signal.aborted) return
        if (cycleAbort.signal.aborted && worker.reconnect.wakePending) {
          continue
        }
        const failure = coordinatorError(error)
        this.#setFailureStatus(machineId, failure.reason)
        if (isPermanentCoordinatorReason(failure.reason)) return
        const relayError = error instanceof RelayClientError ? error : undefined
        retryAfterMs = Math.min(
          relayError?.retryAfterMs ?? 0,
          this.#maximumDelayMs,
        )
      } finally {
        if (connectionAuthenticated) {
          worker.reconnect.noteDisconnected(this.#monotonicNow())
        }
        if (worker.cycleAbort === cycleAbort) worker.cycleAbort = undefined
        const connection = worker.connection
        worker.connection = undefined
        await connection?.close().catch(() => undefined)
      }
      if (!worker.reconnect.wakePending) {
        const wait = await worker.reconnect.wait(retryAfterMs)
        if (wait.outcome === 'closed') return
      }
    }
  }

  async #connectOnce(
    trust: DurableTrustedMachinePeer,
    configuration: Pick<
      DurableMachineRelayConfiguration,
      'endpoint' | 'relayIdentityFingerprint'
    >,
    enrollmentToken?: RelayEnrollmentToken,
    signal?: AbortSignal,
  ): Promise<ConnectedRelayControl> {
    const identity = await this.#loadControllerIdentity(trust)
    const options: ConnectRelayControlOptions = {
      endpoint: {
        host: configuration.endpoint.host,
        port: configuration.endpoint.port,
      },
      tls:
        configuration.endpoint.transportSecurity === 'public_ca'
          ? {
              mode: 'public_ca',
              serverName: configuration.endpoint.host,
            }
          : {
              mode: 'pinned_certificate',
              certificatePublicKeyFingerprint:
                configuration.relayIdentityFingerprint,
            },
      expectedRelayIdentityFingerprint: configuration.relayIdentityFingerprint,
      identity: {
        role: 'controller',
        privateKeyPem: identity.privateKeyPem,
        publicKeySpki: relayPublicKeySpkiFromCertificate(
          identity.certificatePem,
        ),
        publicKeyFingerprint: identity.publicKeyFingerprint,
      },
      clientBuildIdentity: this.#clientBuildIdentity,
      ...(enrollmentToken === undefined ? {} : { enrollmentToken }),
      ...(signal === undefined ? {} : { signal }),
      now: this.#now,
    }
    return await this.#connect(options)
  }

  async #loadControllerIdentity(trust: DurableTrustedMachinePeer) {
    const credentialRef = trust.controllerCredentialRef
    const name = basename(credentialRef)
    if (
      name !== credentialRef ||
      !name.endsWith('.json') ||
      !ControllerIdSchema.safeParse(name.slice(0, -5)).success
    ) {
      throw new ControllerRelayCoordinatorError(
        'relay_authentication_failed',
        'Controller Relay credential reference is invalid',
      )
    }
    let identity
    try {
      identity = await readMachineTlsIdentityFile(
        join(this.#credentialDirectory, name),
      )
    } catch (error) {
      throw new ControllerRelayCoordinatorError(
        'relay_authentication_failed',
        'Controller Relay credential is unavailable',
        { cause: error },
      )
    }
    if (identity.publicKeyFingerprint !== trust.controllerKeyFingerprint) {
      throw new ControllerRelayCoordinatorError(
        'relay_identity_mismatch',
        'Controller Relay credential does not match Machine trust',
      )
    }
    return identity
  }

  async #stopWorker(machineId: MachineId): Promise<void> {
    const worker = this.#workers.get(machineId)
    if (worker === undefined) return
    const connection = worker.connection
    worker.connection = undefined
    worker.abort.abort()
    worker.cycleAbort?.abort()
    worker.reconnect.close()
    await connection?.close().catch(() => undefined)
    await worker.task.catch(() => undefined)
  }

  #restoreDurableWorker(machineId: MachineId): void {
    const configuration =
      this.#persistence.getMachineRelayConfiguration(machineId)
    if (
      configuration !== undefined &&
      configuration.enabled &&
      configuration.enrollmentState === 'enrolled' &&
      !this.#closed
    ) {
      this.#setStatus(
        machineId,
        this.#statusFromConfiguration(configuration, 'reconnecting'),
      )
      this.#startWorker(machineId)
      return
    }
    this.#setStatus(machineId, this.#durableStatus(machineId))
  }

  #durableStatus(machineId: MachineId): RelayMachineConnectivity {
    const configuration =
      this.#persistence.getMachineRelayConfiguration(machineId)
    if (configuration === undefined) {
      return {
        state: 'not_configured',
        enrollment: 'not_configured',
        nodePresence: 'not_observed',
        internetExecutionEnabled: false,
      }
    }
    return this.#statusFromConfiguration(configuration)
  }

  #statusFromConfiguration(
    configuration: DurableMachineRelayConfiguration,
    state?: RelayMachineConnectivity['state'],
    nodePresence: RelayMachineConnectivity['nodePresence'] = 'not_observed',
  ): RelayMachineConnectivity {
    const connectionState =
      state ??
      (configuration.enrollmentState === 'required'
        ? 'enrollment_required'
        : configuration.enrollmentState === 'revoked'
          ? 'revoked'
          : 'offline')
    return {
      state: connectionState,
      enrollment: configuration.enrollmentState,
      nodePresence,
      internetExecutionEnabled:
        connectionState === 'connected' &&
        configuration.enrollmentState === 'enrolled' &&
        nodePresence === 'online',
      endpoint: configuration.endpoint,
      relayIdentityFingerprint: configuration.relayIdentityFingerprint,
      ...(configuration.displayLabel === undefined
        ? {}
        : { displayLabel: configuration.displayLabel }),
      ...(configuration.lastConnectedAt === undefined
        ? {}
        : { lastConnectedAt: configuration.lastConnectedAt }),
      ...(configuration.lastAttemptAt === undefined
        ? {}
        : { lastAttemptAt: configuration.lastAttemptAt }),
    }
  }

  #setFailureStatus(
    machineId: MachineId,
    reason: CanonicalFailureReason,
  ): void {
    const configuration = this.#requireConfiguration(machineId)
    let state: RelayMachineConnectivity['state'] = 'offline'
    if (reason === 'relay_identity_mismatch') state = 'identity_mismatch'
    if (reason === 'relay_protocol_incompatible') state = 'incompatible'
    if (reason === 'relay_revoked') {
      state = 'revoked'
      if (configuration.enrollmentState !== 'revoked') {
        this.#persistence.markMachineRelayRevoked(machineId, this.#timestamp())
      }
    }
    if (reason === 'relay_authentication_failed') {
      state = 'authentication_failed'
    }
    this.#setStatus(machineId, {
      ...this.#statusFromConfiguration(
        this.#persistence.getMachineRelayConfiguration(machineId) ??
          configuration,
        state,
      ),
      failure: canonicalFailure(reason, this.#timestamp()),
    })
  }

  #setStatus(machineId: MachineId, status: RelayMachineConnectivity): void {
    this.#statuses.set(machineId, status)
    for (const listener of this.#listeners) {
      try {
        listener(machineId, status)
      } catch {
        // Connectivity observers cannot take ownership of the one Relay
        // worker or interrupt its generation cleanup.
      }
    }
  }

  #requireConfiguration(
    machineId: MachineId,
  ): DurableMachineRelayConfiguration {
    const configuration =
      this.#persistence.getMachineRelayConfiguration(machineId)
    if (configuration === undefined) {
      throw new ControllerRelayCoordinatorError(
        'relay_not_configured',
        'Internet Relay is not configured',
      )
    }
    return configuration
  }

  #timestamp() {
    return TimestampSchema.parse(this.#now().toISOString())
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new ControllerRelayCoordinatorError(
        'relay_unreachable',
        'Controller Relay coordinator is closed',
      )
    }
  }
}

export class UnavailableControllerRelayCoordinator implements ControllerRelayCoordinator {
  status(): RelayMachineConnectivity {
    return {
      state: 'not_configured',
      enrollment: 'not_configured',
      nodePresence: 'not_observed',
      internetExecutionEnabled: false,
    }
  }

  connectionEpoch(): undefined {
    return undefined
  }

  subscribe(): () => void {
    return () => undefined
  }

  async configure(): Promise<RelayMachineConnectivity> {
    throw unavailableRelay()
  }

  async enroll(): Promise<RelayMachineConnectivity> {
    throw unavailableRelay()
  }

  async retry(): Promise<RelayMachineConnectivity> {
    throw unavailableRelay()
  }

  async openMachineChannel(): Promise<Duplex> {
    throw unavailableRelay()
  }

  async openMachineRevocationChannel(): Promise<Duplex> {
    throw unavailableRelay()
  }

  async disconnect(): Promise<RelayMachineConnectivity> {
    throw unavailableRelay()
  }

  async remove(): Promise<RelayMachineConnectivity> {
    throw unavailableRelay()
  }

  async close(): Promise<void> {}
}

function isUnknownEnrollment(error: unknown): boolean {
  return (
    error instanceof RelayClientError &&
    (error.code === 'relay_authentication_failed' ||
      error.code === 'relay_enrollment_required')
  )
}

function canExplicitlyEnroll(error: unknown): boolean {
  return (
    isUnknownEnrollment(error) ||
    (error instanceof RelayClientError && error.code === 'relay_revoked')
  )
}

function coordinatorError(error: unknown): ControllerRelayCoordinatorError {
  if (error instanceof ControllerRelayCoordinatorError) return error
  let reason: CanonicalFailureReason = 'relay_unreachable'
  if (error instanceof RelayClientError) {
    switch (error.code) {
      case 'relay_identity_mismatch':
      case 'relay_tls_identity_mismatch':
        reason = 'relay_identity_mismatch'
        break
      case 'relay_protocol_incompatible':
        reason = 'relay_protocol_incompatible'
        break
      case 'relay_authentication_failed':
      case 'relay_enrollment_required':
        reason = 'relay_authentication_failed'
        break
      case 'relay_revoked':
        reason = 'relay_revoked'
        break
      case 'relay_rate_limited':
      case 'relay_capacity_reached':
        reason = 'relay_rate_limited'
        break
      case 'relay_channel_open_failed':
        reason = 'relay_channel_open_failed'
        break
      case 'relay_channel_lost':
        reason = 'relay_channel_lost'
        break
      case 'relay_peer_offline':
        reason = 'relay_peer_offline'
        break
      case 'relay_transport_capacity_reached':
        reason = 'relay_transport_capacity_reached'
        break
      case 'relay_unreachable':
      case 'relay_protocol_error':
      case 'relay_closed':
        reason =
          error.code === 'relay_protocol_error'
            ? 'relay_protocol_error'
            : 'relay_unreachable'
        break
    }
  }
  return new ControllerRelayCoordinatorError(
    reason,
    'Internet Relay control connection failed',
    { cause: error },
  )
}

function isPermanentCoordinatorReason(reason: CanonicalFailureReason): boolean {
  return (
    reason === 'relay_identity_mismatch' ||
    reason === 'relay_protocol_incompatible' ||
    reason === 'relay_revoked' ||
    reason === 'relay_authentication_failed'
  )
}

function unavailableRelay(): ControllerRelayCoordinatorError {
  return new ControllerRelayCoordinatorError(
    'relay_not_configured',
    'Internet Relay is unavailable',
  )
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new TypeError(`${name} must be a positive integer`)
  }
  return resolved
}
