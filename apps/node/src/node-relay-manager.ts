import { X509Certificate, randomBytes } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import type { Duplex } from 'node:stream'

import {
  ReconnectWakeCoordinator,
  type PublicKeyFingerprint,
} from '@codetether/machine-transport'
import {
  RelayClientError,
  connectRelayControl,
  isPermanentRelayClientError,
  type ConnectRelayControlOptions,
  type RelayControlConnection,
  type RelayIncomingPairingChannelOffer,
  type RelayIncomingMachineChannelOffer,
} from '@codetether/relay-client'
import {
  RelayPairingCapabilitySchema,
  newRelayPairingRendezvousId,
  relayProtocolLimits,
  relayPublicKeySpkiFromCertificate,
  type RelayPairingRendezvousId,
  type RelayPublicKeyFingerprint,
} from '@codetether/relay-protocol'

import {
  consumeNodeRelayEnrollmentToken,
  readNodeRelayEnrollmentToken,
  readPendingNodeRelayEnrollmentToken,
  readNodeRelayRegistration,
  writeNodeRelayRegistration,
  type NodeRelayConfiguration,
  type NodeRelayEnrollmentToken,
  type NodeRelayRegistration,
} from './relay-state.js'
import type { NodeStateStore, TrustedController } from './state-store.js'

const DEFAULT_RECONNECT_STABLE_RESET_MS = 60_000

export const nodeRelayStatuses = [
  'connecting',
  'connected',
  'reconnecting',
  'enrollment_required',
  'authentication_failed',
  'identity_mismatch',
  'incompatible',
  'revoked',
  'offline',
  'closed',
] as const
export type NodeRelayStatus = (typeof nodeRelayStatuses)[number]

export interface NodeRelayStatusObservation {
  readonly status: NodeRelayStatus
  readonly observedAt: string
  readonly errorCode?: RelayClientError['code']
}

export interface NodeRelayMachineChannel {
  readonly stream: Duplex
  readonly controllerFingerprint: PublicKeyFingerprint
}

export type NodeRelayMachineChannelHandler = (
  channel: NodeRelayMachineChannel,
) => void | Promise<void>

export type NodeRelayPairingChannelHandler = (
  channel: NodeRelayMachineChannel,
) => void | Promise<void>

export interface NodeRelayPairingTarget {
  readonly kind: 'relay'
  readonly endpoint: {
    readonly host: string
    readonly port: number
    readonly transportSecurity: 'public_ca' | 'pinned_identity'
  }
  readonly relayIdentityFingerprint: RelayPublicKeyFingerprint
  readonly nodeFingerprint: RelayPublicKeyFingerprint
  readonly rendezvousId: RelayPairingRendezvousId
  readonly rendezvousCapability: string
}

interface PendingPairingRendezvous {
  readonly target: NodeRelayPairingTarget
  readonly expiresAt: Date
  readonly onAvailable: (target: NodeRelayPairingTarget) => void
  expirationTimer: NodeJS.Timeout
  registeredConnection?: RelayControlConnection
  removeRegistration?: () => Promise<void>
  registrationTask?: Promise<void>
  consumed: boolean
}

type ConnectRelay = typeof connectRelayControl

export interface NodeRelayManagerOptions {
  readonly state: NodeStateStore
  readonly configuration: NodeRelayConfiguration
  readonly clientBuildIdentity: string
  readonly connect?: ConnectRelay
  readonly now?: () => Date
  readonly random?: () => number
  readonly monotonicNow?: () => number
  readonly reconnectInitialDelayMs?: number
  readonly reconnectMaximumDelayMs?: number
  readonly reconnectStableResetMs?: number
  readonly onStatus?: (observation: NodeRelayStatusObservation) => void
  readonly readEnrollmentToken?: typeof readNodeRelayEnrollmentToken
  readonly readPendingEnrollmentToken?: typeof readPendingNodeRelayEnrollmentToken
  readonly consumeEnrollmentToken?: typeof consumeNodeRelayEnrollmentToken
  readonly readRegistration?: typeof readNodeRelayRegistration
  readonly writeRegistration?: typeof writeNodeRelayRegistration
}

/** Owns one outbound Relay control connection and its bounded Machine channels. */
export class NodeRelayManager {
  readonly #state: NodeStateStore
  readonly #configuration: NodeRelayConfiguration
  readonly #clientBuildIdentity: string
  readonly #connect: ConnectRelay
  readonly #now: () => Date
  readonly #monotonicNow: () => number
  readonly #reconnect: ReconnectWakeCoordinator
  readonly #onStatus: (observation: NodeRelayStatusObservation) => void
  readonly #readEnrollmentToken: typeof readNodeRelayEnrollmentToken
  readonly #readPendingEnrollmentToken: typeof readPendingNodeRelayEnrollmentToken
  readonly #consumeEnrollmentToken: typeof consumeNodeRelayEnrollmentToken
  readonly #readRegistration: typeof readNodeRelayRegistration
  readonly #writeRegistration: typeof writeNodeRelayRegistration
  readonly #abort = new AbortController()
  readonly #machineChannels = new Map<
    Duplex,
    {
      readonly connection: RelayControlConnection
      readonly controllerFingerprint: PublicKeyFingerprint
    }
  >()
  readonly #pairingChannels = new Map<Duplex, RelayControlConnection>()
  #worker: Promise<void> | undefined
  #connection: RelayControlConnection | undefined
  #cycleAbort: AbortController | undefined
  #machineChannelHandler: NodeRelayMachineChannelHandler | undefined
  #pairingChannelHandler: NodeRelayPairingChannelHandler | undefined
  #pairingRendezvous: PendingPairingRendezvous | undefined
  #registration: NodeRelayRegistration | undefined
  #grantRevision = 0
  #appliedGrantRevision = -1
  #grantTask: Promise<void> | undefined
  #closed = false
  #status: NodeRelayStatus = 'offline'

  constructor(options: NodeRelayManagerOptions) {
    this.#state = options.state
    this.#configuration = options.configuration
    this.#clientBuildIdentity = options.clientBuildIdentity
    this.#connect = options.connect ?? connectRelayControl
    this.#now = options.now ?? (() => new Date())
    this.#monotonicNow = options.monotonicNow ?? (() => performance.now())
    const initialDelayMs = positiveInteger(
      options.reconnectInitialDelayMs,
      relayProtocolLimits.reconnectInitialDelayMs,
      'Relay reconnect initial delay',
    )
    const maximumDelayMs = positiveInteger(
      options.reconnectMaximumDelayMs,
      relayProtocolLimits.reconnectMaximumDelayMs,
      'Relay reconnect maximum delay',
    )
    const stableResetMs = positiveInteger(
      options.reconnectStableResetMs,
      DEFAULT_RECONNECT_STABLE_RESET_MS,
      'Relay reconnect stable reset',
    )
    this.#reconnect = new ReconnectWakeCoordinator({
      initialDelayMs,
      maximumDelayMs,
      stableResetMs,
      random: options.random,
    })
    this.#onStatus = options.onStatus ?? (() => undefined)
    this.#readEnrollmentToken =
      options.readEnrollmentToken ?? readNodeRelayEnrollmentToken
    this.#readPendingEnrollmentToken =
      options.readPendingEnrollmentToken ?? readPendingNodeRelayEnrollmentToken
    this.#consumeEnrollmentToken =
      options.consumeEnrollmentToken ?? consumeNodeRelayEnrollmentToken
    this.#readRegistration =
      options.readRegistration ?? readNodeRelayRegistration
    this.#writeRegistration =
      options.writeRegistration ?? writeNodeRelayRegistration
  }

  get status(): NodeRelayStatus {
    return this.#status
  }

  get workerActive(): boolean {
    return this.#worker !== undefined
  }

  get activeMachineChannelCount(): number {
    return this.#machineChannels.size
  }

  /**
   * Invalidates an apparently-live Relay connection or expedites its one
   * existing backoff worker after a network/resume lifecycle signal.
   */
  requestReconnect(): boolean {
    if (
      this.#closed ||
      !this.#configuration.enabled ||
      !isReconnectableStatus(this.#status)
    ) {
      return false
    }
    const accepted = this.#reconnect.requestWake()
    if (!accepted) return false
    const connection = this.#connection
    this.#connection = undefined
    if (connection !== undefined) {
      this.#destroyMachineChannels(connection)
      this.#destroyPairingChannels(connection)
      this.#detachPairingRegistration(connection)
    }
    this.#setStatus('reconnecting')
    this.#cycleAbort?.abort()
    if (connection === undefined) {
      this.start()
    } else {
      void connection.close().catch(() => undefined)
    }
    return true
  }

  setMachineChannelHandler(
    handler: NodeRelayMachineChannelHandler,
  ): () => void {
    if (this.#closed) throw new Error('Node Relay manager is closed')
    if (this.#machineChannelHandler !== undefined) {
      throw new Error('Node Relay Machine channel handler is already installed')
    }
    this.#machineChannelHandler = handler
    let removed = false
    return () => {
      if (removed) return
      removed = true
      if (this.#machineChannelHandler !== handler) return
      this.#machineChannelHandler = undefined
      this.#destroyMachineChannels()
    }
  }

  setPairingChannelHandler(
    handler: NodeRelayPairingChannelHandler,
  ): () => void {
    if (this.#closed) throw new Error('Node Relay manager is closed')
    if (this.#pairingChannelHandler !== undefined) {
      throw new Error('Node Relay pairing channel handler is already installed')
    }
    this.#pairingChannelHandler = handler
    let removed = false
    return () => {
      if (removed) return
      removed = true
      if (this.#pairingChannelHandler !== handler) return
      this.#pairingChannelHandler = undefined
      this.#destroyPairingChannels()
    }
  }

  /** Publishes one bounded pairing capability on the current or next live Relay connection. */
  enablePairingRendezvous(
    expiresAt: Date,
    onAvailable: (target: NodeRelayPairingTarget) => void,
  ): () => Promise<void> {
    if (this.#closed) throw new Error('Node Relay manager is closed')
    const previousCancellation = this.#cancelPairingRendezvous()
    const expiry = new Date(expiresAt)
    const lifetimeMs = expiry.getTime() - this.#now().getTime()
    if (
      !Number.isFinite(expiry.getTime()) ||
      lifetimeMs <= 0 ||
      lifetimeMs > relayProtocolLimits.maximumPairingLifetimeMs
    ) {
      throw new TypeError('Relay pairing rendezvous expiry is invalid')
    }
    const target: NodeRelayPairingTarget = {
      kind: 'relay',
      endpoint: {
        ...this.#configuration.endpoint,
        transportSecurity:
          this.#configuration.tls.mode === 'public_ca'
            ? 'public_ca'
            : 'pinned_identity',
      },
      relayIdentityFingerprint: this.#configuration.relayIdentityFingerprint,
      nodeFingerprint: this.#state.identity.publicKeyFingerprint,
      rendezvousId: newRelayPairingRendezvousId(),
      rendezvousCapability: RelayPairingCapabilitySchema.parse(
        randomBytes(32).toString('base64url'),
      ),
    }
    const rendezvous: PendingPairingRendezvous = {
      target,
      expiresAt: expiry,
      onAvailable,
      expirationTimer: setTimeout(() => {
        void this.#cancelPairingRendezvous(rendezvous)
      }, lifetimeMs),
      consumed: false,
    }
    this.#pairingRendezvous = rendezvous
    const connection = this.#connection
    if (connection !== undefined) {
      void previousCancellation
        .then(
          async () =>
            await this.#registerPairingRendezvous(connection, rendezvous),
        )
        .catch(() => {
          void connection.close().catch(() => undefined)
        })
    }
    let cancelled = false
    return async () => {
      if (cancelled) return
      cancelled = true
      await this.#cancelPairingRendezvous(rendezvous)
    }
  }

  async reconcileTrustedController(
    controller: TrustedController,
  ): Promise<void> {
    const connection = this.#connection
    if (
      this.#closed ||
      connection === undefined ||
      controller.publicKeySpki === undefined
    ) {
      throw new RelayClientError(
        'relay_unreachable',
        'Internet Relay Controller reconciliation is unavailable',
      )
    }
    try {
      await connection.reconcileTrustedController({
        publicKeySpki: controller.publicKeySpki,
        fingerprint: controller.publicKeyFingerprint,
      })
    } catch (error) {
      // Durable Machine trust remains authoritative. Reconnect retries only
      // the idempotent Relay projection; it never replays pairing.
      this.synchronizeMachineTrust()
      throw error
    }
  }

  start(): void {
    if (
      this.#closed ||
      !this.#configuration.enabled ||
      this.#worker !== undefined
    ) {
      return
    }
    this.#worker = this.#run()
      .catch((error: unknown) => {
        if (this.#closed) return
        const failure = relayManagerError(error)
        this.#setStatus(
          isPermanentRelayClientError(failure)
            ? permanentStatus(failure)
            : 'offline',
          failure.code,
        )
      })
      .finally(() => {
        this.#worker = undefined
      })
  }

  /** Coalesces pairing/unpair changes into the one current grant update. */
  synchronizeMachineTrust(): void {
    if (this.#closed) return
    this.#closeUnauthorizedMachineChannels()
    this.#grantRevision += 1
    const connection = this.#connection
    if (connection !== undefined) {
      void this.#flushGrant(connection).catch(() => {
        void connection.close().catch(() => undefined)
      })
    }
  }

  async close(): Promise<void> {
    if (this.#closed) {
      await this.#worker
      return
    }
    await this.#cancelPairingRendezvous().catch(() => undefined)
    this.#closed = true
    this.#reconnect.close()
    this.#cycleAbort?.abort()
    this.#abort.abort()
    this.#destroyMachineChannels()
    this.#destroyPairingChannels()
    await this.#connection?.close().catch(() => undefined)
    await this.#worker
    await this.#grantTask?.catch(() => undefined)
    this.#setStatus('closed')
  }

  async #run(): Promise<void> {
    this.#registration = await this.#readRegistration(this.#state.dataDirectory)
    if (
      this.#registration !== undefined &&
      this.#registration.relayIdentityFingerprint !==
        this.#configuration.relayIdentityFingerprint
    ) {
      this.#setStatus('identity_mismatch', 'relay_identity_mismatch')
      return
    }
    let firstAttempt = true
    while (!this.#closed && !this.#abort.signal.aborted) {
      const cycleAbort = new AbortController()
      this.#cycleAbort = cycleAbort
      this.#reconnect.consumePendingWake()
      this.#setStatus(firstAttempt ? 'connecting' : 'reconnecting')
      firstAttempt = false
      let token: NodeRelayEnrollmentToken | undefined
      let ownedConnection: RelayControlConnection | undefined
      let attemptedEnrollment = false
      let authenticatedConnection = false
      let retryAfterMs = 0
      let removeMachineChannelHandler: (() => void) | undefined
      let removePairingChannelHandler: (() => void) | undefined
      let channelConnection: RelayControlConnection | undefined
      try {
        let connected
        if (this.#registration !== undefined) {
          try {
            connected = await this.#connectOnce(undefined, cycleAbort.signal)
          } catch (error) {
            if (
              !(error instanceof RelayClientError) ||
              error.code !== 'relay_revoked'
            ) {
              throw error
            }
            // Revocation remains terminal for ordinary reconnect. Only an
            // explicitly placed fresh enrollment token may restore the exact
            // durable Node identity and role.
            token = await this.#readEnrollmentToken(this.#state.dataDirectory)
            if (token === undefined) {
              this.#setStatus('revoked', error.code)
              return
            }
            attemptedEnrollment = true
            connected = await this.#connectOnce(token.secret, cycleAbort.signal)
          }
        } else {
          // Authentication by the durable Node key is attempted first. This
          // recovers the post-commit/pre-response enrollment-loss window
          // without replaying or retaining the one-time token.
          try {
            connected = await this.#connectOnce(undefined, cycleAbort.signal)
          } catch (error) {
            if (!isUnknownEnrollment(error)) throw error
            token = await this.#readEnrollmentToken(this.#state.dataDirectory)
            if (token === undefined) {
              this.#setStatus('enrollment_required')
              return
            }
            attemptedEnrollment = true
            connected = await this.#connectOnce(token.secret, cycleAbort.signal)
          }
        }
        ownedConnection = connected.connection
        if (this.#closed || this.#abort.signal.aborted) return
        if (cycleAbort.signal.aborted) continue

        const nextRegistration: NodeRelayRegistration = {
          schemaVersion: 1,
          relayId: connected.registration.relayId,
          relayIdentityFingerprint:
            connected.registration.relayIdentityFingerprint,
          peerId: connected.registration.peerId,
          observedAt: connected.registration.authenticatedAt,
        }
        if (token === undefined) {
          // Authentication may have recovered an enrollment whose ready frame
          // or local cleanup was lost. Only the exact input atomically claimed
          // before that attempt is eligible for cleanup; a concurrently placed
          // replacement remains untouched.
          token = await this.#readPendingEnrollmentToken(
            this.#state.dataDirectory,
          )
        }
        if (!sameRegistration(this.#registration, nextRegistration)) {
          await this.#writeRegistration(
            this.#state.dataDirectory,
            nextRegistration,
          )
          if (this.#closed || this.#abort.signal.aborted) return
          if (cycleAbort.signal.aborted) continue
          this.#registration = nextRegistration
        }
        if (token !== undefined) {
          try {
            await this.#consumeEnrollmentToken(this.#state.dataDirectory, token)
          } finally {
            // Do not retain a plaintext one-time secret for the lifetime of
            // the persistent Relay connection, including on cleanup failure.
            token = undefined
          }
        }
        if (this.#closed || this.#abort.signal.aborted) return
        if (cycleAbort.signal.aborted) continue

        const activeConnection = ownedConnection
        this.#connection = activeConnection
        channelConnection = activeConnection
        removeMachineChannelHandler = activeConnection.setMachineChannelHandler(
          async (offer) =>
            await this.#handleMachineChannelOffer(
              activeConnection,
              offer,
              cycleAbort.signal,
            ),
        )
        removePairingChannelHandler = activeConnection.setPairingChannelHandler(
          async (offer) =>
            await this.#handlePairingChannelOffer(
              activeConnection,
              offer,
              cycleAbort.signal,
            ),
        )
        this.#appliedGrantRevision = -1
        await this.#flushGrant(activeConnection)
        const pairingRendezvous = this.#pairingRendezvous
        if (pairingRendezvous !== undefined && !pairingRendezvous.consumed) {
          await this.#registerPairingRendezvous(
            activeConnection,
            pairingRendezvous,
          )
        }
        if (
          cycleAbort.signal.aborted ||
          this.#connection !== activeConnection
        ) {
          continue
        }
        this.#setStatus('connected')
        this.#reconnect.noteConnected(this.#monotonicNow())
        authenticatedConnection = true
        // A lifecycle signal that arrived during authentication conservatively
        // invalidates this candidate. The one pending wake then expedites its
        // replacement without creating a second connection owner.
        if (this.#reconnect.wakePending) {
          void activeConnection.close().catch(() => undefined)
        }
        await activeConnection.waitUntilClosed()
        if (this.#closed || this.#abort.signal.aborted) return
        if (cycleAbort.signal.aborted && this.#reconnect.wakePending) continue
        this.#reconnect.noteDisconnected(this.#monotonicNow())
        authenticatedConnection = false
        this.#setStatus('offline', 'relay_closed')
      } catch (error) {
        if (this.#closed || this.#abort.signal.aborted) return
        if (cycleAbort.signal.aborted && this.#reconnect.wakePending) continue
        if (authenticatedConnection) {
          this.#reconnect.noteDisconnected(this.#monotonicNow())
          authenticatedConnection = false
        }
        const failedConnection = this.#connection ?? ownedConnection
        this.#connection = undefined
        ownedConnection = undefined
        removeMachineChannelHandler?.()
        removeMachineChannelHandler = undefined
        removePairingChannelHandler?.()
        removePairingChannelHandler = undefined
        if (failedConnection !== undefined) {
          this.#destroyMachineChannels(failedConnection)
          this.#destroyPairingChannels(failedConnection)
          this.#detachPairingRegistration(failedConnection)
        }
        await failedConnection?.close().catch(() => undefined)
        const failure = relayManagerError(error)
        if (failure.code === 'relay_enrollment_required') {
          if (token !== undefined) {
            await this.#consumeEnrollmentToken(
              this.#state.dataDirectory,
              token,
            ).catch(() => undefined)
          }
          this.#setStatus('enrollment_required', failure.code)
          return
        }
        if (
          attemptedEnrollment &&
          failure.code === 'relay_authentication_failed'
        ) {
          this.#setStatus('authentication_failed', failure.code)
          return
        }
        token = undefined
        if (
          isPermanentRelayClientError(failure) ||
          (failure.code === 'relay_authentication_failed' &&
            this.#registration !== undefined)
        ) {
          this.#setStatus(permanentStatus(failure), failure.code)
          return
        }
        this.#setStatus('offline', failure.code)
        retryAfterMs = failure.retryAfterMs ?? 0
      } finally {
        if (authenticatedConnection) {
          this.#reconnect.noteDisconnected(this.#monotonicNow())
        }
        removeMachineChannelHandler?.()
        removePairingChannelHandler?.()
        if (channelConnection !== undefined) {
          this.#destroyMachineChannels(channelConnection)
          this.#destroyPairingChannels(channelConnection)
          this.#detachPairingRegistration(channelConnection)
        }
        const connection = this.#connection ?? ownedConnection
        this.#connection = undefined
        if (this.#cycleAbort === cycleAbort) this.#cycleAbort = undefined
        await connection?.close().catch(() => undefined)
      }
      if (!this.#reconnect.wakePending) {
        const wait = await this.#reconnect.wait(retryAfterMs)
        if (wait.outcome === 'closed') return
      }
    }
  }

  async #connectOnce(enrollmentToken?: string, cycleSignal?: AbortSignal) {
    const certificate = new X509Certificate(this.#state.identity.certificatePem)
    const peerPublicKeySpki = relayPublicKeySpkiFromCertificate(certificate.raw)
    const options: ConnectRelayControlOptions = {
      endpoint: this.#configuration.endpoint,
      tls: this.#configuration.tls,
      expectedRelayIdentityFingerprint:
        this.#configuration.relayIdentityFingerprint,
      ...(this.#registration === undefined
        ? {}
        : { expectedRelayId: this.#registration.relayId }),
      identity: {
        role: 'node',
        privateKeyPem: this.#state.identity.privateKeyPem,
        publicKeySpki: peerPublicKeySpki,
        publicKeyFingerprint: this.#state.identity.publicKeyFingerprint,
      },
      clientBuildIdentity: this.#clientBuildIdentity,
      ...(enrollmentToken === undefined ? {} : { enrollmentToken }),
      ...(this.#currentControllerFingerprint() === undefined
        ? {}
        : {
            authorizedControllerFingerprint:
              this.#currentControllerFingerprint(),
          }),
      signal:
        cycleSignal === undefined
          ? this.#abort.signal
          : AbortSignal.any([this.#abort.signal, cycleSignal]),
      now: this.#now,
    }
    return await this.#connect(options)
  }

  async #handleMachineChannelOffer(
    connection: RelayControlConnection,
    offer: RelayIncomingMachineChannelOffer,
    cycleSignal: AbortSignal,
  ): Promise<void> {
    const handler = this.#machineChannelHandler
    const trustedFingerprint = this.#currentControllerFingerprint()
    if (
      this.#closed ||
      cycleSignal.aborted ||
      connection !== this.#connection ||
      handler === undefined ||
      trustedFingerprint === undefined ||
      offer.controllerFingerprint !== trustedFingerprint
    ) {
      await offer.reject('not_available').catch(() => undefined)
      return
    }
    let stream: Duplex
    try {
      stream = await offer.accept()
    } catch {
      return
    }
    if (
      this.#closed ||
      cycleSignal.aborted ||
      connection !== this.#connection ||
      handler !== this.#machineChannelHandler ||
      offer.controllerFingerprint !== this.#currentControllerFingerprint()
    ) {
      stream.destroy()
      return
    }
    const entry = {
      connection,
      controllerFingerprint: offer.controllerFingerprint,
    }
    this.#machineChannels.set(stream, entry)
    stream.once('close', () => {
      if (this.#machineChannels.get(stream) === entry) {
        this.#machineChannels.delete(stream)
      }
    })
    try {
      await handler({
        stream,
        controllerFingerprint: offer.controllerFingerprint,
      })
    } catch {
      stream.destroy()
    }
  }

  async #registerPairingRendezvous(
    connection: RelayControlConnection,
    rendezvous: PendingPairingRendezvous,
  ): Promise<void> {
    if (rendezvous.registrationTask !== undefined) {
      await rendezvous.registrationTask
      return
    }
    if (
      this.#closed ||
      this.#connection !== connection ||
      this.#pairingRendezvous !== rendezvous ||
      rendezvous.consumed ||
      rendezvous.expiresAt.getTime() <= this.#now().getTime()
    ) {
      return
    }
    if (rendezvous.registeredConnection === connection) return
    const task = (async (): Promise<void> => {
      const removeRegistration = await connection.registerPairingRendezvous({
        rendezvousId: rendezvous.target.rendezvousId,
        rendezvousCapability: rendezvous.target.rendezvousCapability,
        expiresAt: rendezvous.expiresAt,
      })
      if (
        this.#closed ||
        this.#connection !== connection ||
        this.#pairingRendezvous !== rendezvous ||
        rendezvous.consumed ||
        rendezvous.expiresAt.getTime() <= this.#now().getTime()
      ) {
        await removeRegistration().catch(() => undefined)
        return
      }
      rendezvous.registeredConnection = connection
      rendezvous.removeRegistration = removeRegistration
      rendezvous.onAvailable(rendezvous.target)
    })()
    rendezvous.registrationTask = task
    try {
      await task
    } finally {
      if (rendezvous.registrationTask === task) {
        rendezvous.registrationTask = undefined
      }
    }
  }

  async #cancelPairingRendezvous(
    expected?: PendingPairingRendezvous,
  ): Promise<void> {
    const rendezvous = this.#pairingRendezvous
    if (
      rendezvous === undefined ||
      (expected !== undefined && rendezvous !== expected)
    ) {
      return
    }
    this.#pairingRendezvous = undefined
    rendezvous.consumed = true
    clearTimeout(rendezvous.expirationTimer)
    await rendezvous.registrationTask?.catch(() => undefined)
    const removeRegistration = rendezvous.removeRegistration
    rendezvous.registeredConnection = undefined
    rendezvous.removeRegistration = undefined
    this.#destroyPairingChannels()
    await removeRegistration?.().catch(() => undefined)
  }

  #detachPairingRegistration(connection: RelayControlConnection): void {
    const rendezvous = this.#pairingRendezvous
    if (rendezvous?.registeredConnection !== connection) return
    rendezvous.registeredConnection = undefined
    rendezvous.removeRegistration = undefined
  }

  async #handlePairingChannelOffer(
    connection: RelayControlConnection,
    offer: RelayIncomingPairingChannelOffer,
    cycleSignal: AbortSignal,
  ): Promise<void> {
    const handler = this.#pairingChannelHandler
    const rendezvous = this.#pairingRendezvous
    if (
      this.#closed ||
      cycleSignal.aborted ||
      connection !== this.#connection ||
      handler === undefined ||
      rendezvous === undefined ||
      rendezvous.consumed ||
      rendezvous.registeredConnection !== connection ||
      rendezvous.expiresAt.getTime() <= this.#now().getTime()
    ) {
      await offer.reject('not_available').catch(() => undefined)
      return
    }
    let stream: Duplex
    try {
      stream = await offer.accept()
    } catch {
      return
    }
    if (
      this.#closed ||
      cycleSignal.aborted ||
      connection !== this.#connection ||
      handler !== this.#pairingChannelHandler ||
      rendezvous !== this.#pairingRendezvous ||
      rendezvous.consumed
    ) {
      stream.destroy()
      return
    }
    rendezvous.consumed = true
    clearTimeout(rendezvous.expirationTimer)
    rendezvous.registeredConnection = undefined
    rendezvous.removeRegistration = undefined
    this.#pairingChannels.set(stream, connection)
    stream.once('close', () => {
      if (this.#pairingChannels.get(stream) === connection) {
        this.#pairingChannels.delete(stream)
      }
    })
    try {
      await handler({
        stream,
        controllerFingerprint: offer.controllerFingerprint,
      })
    } catch {
      stream.destroy()
    }
  }

  #closeUnauthorizedMachineChannels(): void {
    const current = this.#currentControllerFingerprint()
    for (const [stream, entry] of this.#machineChannels) {
      if (entry.controllerFingerprint !== current) {
        this.#machineChannels.delete(stream)
        stream.destroy()
      }
    }
  }

  #destroyMachineChannels(connection?: RelayControlConnection): void {
    for (const [stream, entry] of this.#machineChannels) {
      if (connection === undefined || entry.connection === connection) {
        this.#machineChannels.delete(stream)
        stream.destroy()
      }
    }
  }

  #destroyPairingChannels(connection?: RelayControlConnection): void {
    for (const [stream, owner] of this.#pairingChannels) {
      if (connection === undefined || owner === connection) {
        this.#pairingChannels.delete(stream)
        stream.destroy()
      }
    }
  }

  async #flushGrant(connection: RelayControlConnection): Promise<void> {
    while (
      !this.#closed &&
      connection === this.#connection &&
      this.#appliedGrantRevision !== this.#grantRevision
    ) {
      const existing = this.#grantTask
      if (existing !== undefined) {
        await existing
        continue
      }
      const task = this.#drainGrant(connection)
      this.#grantTask = task
      try {
        await task
      } finally {
        if (this.#grantTask === task) this.#grantTask = undefined
      }
    }
  }

  async #drainGrant(connection: RelayControlConnection): Promise<void> {
    while (
      !this.#closed &&
      connection === this.#connection &&
      this.#appliedGrantRevision !== this.#grantRevision
    ) {
      const revision = this.#grantRevision
      const controller = this.#state.trustedController()
      if (controller?.publicKeySpki !== undefined) {
        // Machine trust is already durable at this point. Reconciliation is
        // idempotent so reconnect can recover a lost post-trust acknowledgement
        // with the same Controller key before making the normal grant visible.
        await connection.reconcileTrustedController({
          publicKeySpki: controller.publicKeySpki,
          fingerprint: controller.publicKeyFingerprint,
        })
      }
      await connection.replaceAuthorizedController(
        controller?.publicKeyFingerprint,
      )
      this.#appliedGrantRevision = revision
    }
  }

  #currentControllerFingerprint(): RelayPublicKeyFingerprint | undefined {
    return this.#state.trustedController()?.publicKeyFingerprint
  }

  #setStatus(
    status: NodeRelayStatus,
    errorCode?: RelayClientError['code'],
  ): void {
    if (this.#status === status && errorCode === undefined) return
    this.#status = status
    try {
      this.#onStatus({
        status,
        observedAt: this.#now().toISOString(),
        ...(errorCode === undefined ? {} : { errorCode }),
      })
    } catch {
      // Status observers cannot take ownership of the Relay worker.
    }
  }
}

function isUnknownEnrollment(error: unknown): boolean {
  return (
    error instanceof RelayClientError &&
    (error.code === 'relay_authentication_failed' ||
      error.code === 'relay_enrollment_required')
  )
}

function relayManagerError(error: unknown): RelayClientError {
  return error instanceof RelayClientError
    ? error
    : new RelayClientError(
        'relay_unreachable',
        'Internet Relay is unreachable',
        undefined,
        { cause: error },
      )
}

function permanentStatus(error: RelayClientError): NodeRelayStatus {
  if (
    error.code === 'relay_identity_mismatch' ||
    error.code === 'relay_tls_identity_mismatch'
  ) {
    return 'identity_mismatch'
  }
  if (error.code === 'relay_protocol_incompatible') return 'incompatible'
  if (error.code === 'relay_revoked') return 'revoked'
  if (error.code === 'relay_authentication_failed') {
    return 'authentication_failed'
  }
  return 'offline'
}

function isReconnectableStatus(status: NodeRelayStatus): boolean {
  return (
    status === 'connecting' ||
    status === 'connected' ||
    status === 'reconnecting' ||
    status === 'offline'
  )
}

function sameRegistration(
  left: NodeRelayRegistration | undefined,
  right: NodeRelayRegistration,
): boolean {
  return (
    left !== undefined &&
    left.relayId === right.relayId &&
    left.relayIdentityFingerprint === right.relayIdentityFingerprint &&
    left.peerId === right.peerId
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
