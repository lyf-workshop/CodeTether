import {
  createServer as createHttpServer,
  type Server as HttpServer,
} from 'node:http'
import { readdirSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import {
  createServer as createTlsServer,
  type Server as TlsServer,
  type TLSSocket,
} from 'node:tls'

import {
  FramedRelayConnection,
  RelayClientMessageSchema,
  type RelayChallengeMessage,
  type RelayClientMessage,
  type RelayConnectionEpoch,
  type RelayErrorCode,
  type RelayPingId,
  type RelayPublicKeyFingerprint,
  RelayProtocolError,
  fingerprintRelayPublicKeySpki,
  newRelayChallengeId,
  newRelayConnectionEpoch,
  newRelayNonce,
  newRelayPingId,
  relayAuthenticationTranscript,
  relayChallengeTranscript,
  relayEnrollmentTranscript,
  relayProtocolAlpn,
  relayProtocolLimits,
  relayProtocolVersion,
  signRelayTranscript,
  verifyRelayTranscript,
} from '@codetether/relay-protocol'
import { z } from 'zod'

import {
  RelayConnectionRegistry,
  type RelayOwnedConnection,
} from './connection-registry.js'
import type { RelayPeerRecord } from './internal-types.js'
import { BoundedTokenBucketRateLimiter } from './rate-limiter.js'
import { createJsonRelayLogger, type RelaySafeLogger } from './safe-log.js'
import { RelayStateStore } from './state-store.js'

const unknownSchema = z.unknown()
const maximumPendingHeartbeatPings = 8

export interface RelayTlsConfiguration {
  readonly certificatePem: string | Buffer
  readonly privateKeyPem: string | Buffer
}

export interface RelayServiceOptions {
  readonly stateStore: RelayStateStore
  readonly tls: RelayTlsConfiguration
  readonly host?: string
  readonly port?: number
  readonly managementHost?: string
  readonly managementPort?: number | null
  readonly logger?: RelaySafeLogger
  readonly maximumConnections?: number
  readonly maximumConnectionsPerAddress?: number
  readonly heartbeatIntervalMs?: number
  readonly heartbeatTimeoutMs?: number
  readonly handshakeTimeoutMs?: number
  readonly challengeLifetimeMs?: number
}

export interface RelayServiceMetrics {
  readonly uptimeSeconds: number
  readonly processRssBytes: number
  readonly fileDescriptorCount: number | null
  readonly activeTlsConnections: number
  readonly authenticatedConnections: number
  readonly authenticatedControllers: number
  readonly authenticatedNodes: number
  readonly pendingControlMessagesUpperBound: number
  readonly connectionRegistryEntries: number
  readonly acceptedConnections: number
  readonly authenticatedReconnects: number
  readonly reconnectReplacements: number
  readonly authenticationFailures: number
  readonly enrollmentSuccesses: number
  readonly enrollmentFailures: number
  readonly rateLimitEvents: number
  readonly malformedFrames: number
  readonly heartbeatTimeouts: number
}

interface MutableMetrics {
  acceptedConnections: number
  authenticatedReconnects: number
  reconnectReplacements: number
  authenticationFailures: number
  enrollmentSuccesses: number
  enrollmentFailures: number
  rateLimitEvents: number
  malformedFrames: number
  heartbeatTimeouts: number
}

interface Subscription {
  readonly requestId: string
  readonly targetNodeFingerprint: RelayPublicKeyFingerprint
}

class ActiveConnection implements RelayOwnedConnection {
  readonly subscriptions = new Map<string, Subscription>()
  readonly pendingPings = new Map<RelayPingId, number>()
  lastHeartbeatAcknowledgedAt = Date.now()
  invalidated = false
  readonly #invalidate: (reason: 'replaced' | 'revoked' | 'shutdown') => void

  constructor(
    readonly peer: RelayPeerRecord,
    readonly epoch: RelayConnectionEpoch,
    readonly channel: FramedRelayConnection,
    invalidate: (reason: 'replaced' | 'revoked' | 'shutdown') => void,
  ) {
    this.#invalidate = invalidate
  }

  invalidate(reason: 'replaced' | 'revoked' | 'shutdown'): void {
    if (this.invalidated) return
    this.invalidated = true
    this.#invalidate(reason)
  }
}

export class RelayService {
  readonly #store: RelayStateStore
  readonly #options: Required<
    Pick<
      RelayServiceOptions,
      | 'host'
      | 'port'
      | 'managementHost'
      | 'maximumConnections'
      | 'maximumConnectionsPerAddress'
      | 'heartbeatIntervalMs'
      | 'heartbeatTimeoutMs'
      | 'handshakeTimeoutMs'
      | 'challengeLifetimeMs'
    >
  > & { readonly managementPort: number | null }
  readonly #logger: RelaySafeLogger
  readonly #server: TlsServer
  readonly #registry = new RelayConnectionRegistry<ActiveConnection>()
  readonly #rawSockets = new Set<TLSSocket>()
  readonly #addressCounts = new Map<string, number>()
  readonly #admissionLimiter: BoundedTokenBucketRateLimiter
  readonly #authenticationLimiter: BoundedTokenBucketRateLimiter
  readonly #authenticationIdentityLimiter: BoundedTokenBucketRateLimiter
  readonly #enrollmentLimiter: BoundedTokenBucketRateLimiter
  readonly #metrics: MutableMetrics = {
    acceptedConnections: 0,
    authenticatedReconnects: 0,
    reconnectReplacements: 0,
    authenticationFailures: 0,
    enrollmentSuccesses: 0,
    enrollmentFailures: 0,
    rateLimitEvents: 0,
    malformedFrames: 0,
    heartbeatTimeouts: 0,
  }
  readonly #startedAt = Date.now()
  #managementServer: HttpServer | undefined
  #started = false
  #closing = false

  constructor(options: RelayServiceOptions) {
    this.#store = options.stateStore
    this.#logger = options.logger ?? createJsonRelayLogger()
    this.#options = {
      host: options.host ?? '0.0.0.0',
      port: options.port ?? 443,
      managementHost: options.managementHost ?? '127.0.0.1',
      managementPort: options.managementPort ?? null,
      maximumConnections:
        options.maximumConnections ?? relayProtocolLimits.maximumConnections,
      maximumConnectionsPerAddress:
        options.maximumConnectionsPerAddress ??
        relayProtocolLimits.maximumConnectionsPerAddress,
      heartbeatIntervalMs:
        options.heartbeatIntervalMs ?? relayProtocolLimits.heartbeatIntervalMs,
      heartbeatTimeoutMs:
        options.heartbeatTimeoutMs ?? relayProtocolLimits.heartbeatTimeoutMs,
      handshakeTimeoutMs:
        options.handshakeTimeoutMs ?? relayProtocolLimits.handshakeTimeoutMs,
      challengeLifetimeMs:
        options.challengeLifetimeMs ?? relayProtocolLimits.challengeLifetimeMs,
    }
    validateServiceBounds(this.#options)
    this.#admissionLimiter = new BoundedTokenBucketRateLimiter({
      capacity: 240,
      refillIntervalMs: 60_000,
      maximumEntries: relayProtocolLimits.maximumRateLimitEntries,
    })
    this.#authenticationLimiter = new BoundedTokenBucketRateLimiter({
      capacity: 180,
      refillIntervalMs: 60_000,
      maximumEntries: relayProtocolLimits.maximumRateLimitEntries,
    })
    this.#authenticationIdentityLimiter = new BoundedTokenBucketRateLimiter({
      capacity: 120,
      refillIntervalMs: 60_000,
      maximumEntries: relayProtocolLimits.maximumRateLimitEntries,
    })
    this.#enrollmentLimiter = new BoundedTokenBucketRateLimiter({
      capacity: relayProtocolLimits.enrollmentMaximumAttempts,
      refillIntervalMs: 10 * 60_000,
      maximumEntries: relayProtocolLimits.maximumRateLimitEntries,
    })
    this.#server = createTlsServer(
      {
        key: options.tls.privateKeyPem,
        cert: options.tls.certificatePem,
        minVersion: 'TLSv1.3',
        maxVersion: 'TLSv1.3',
        ALPNProtocols: [relayProtocolAlpn],
        requestCert: false,
        rejectUnauthorized: false,
      },
      (socket) => void this.#handleSecureConnection(socket),
    )
    this.#server.on('connection', (socket) => {
      const tlsSocket = socket as TLSSocket
      const address = normalizeAddress(tlsSocket.remoteAddress)
      const rate = this.#admissionLimiter.consume(address)
      const current = this.#addressCounts.get(address) ?? 0
      if (
        !rate.allowed ||
        this.#rawSockets.size >= this.#options.maximumConnections ||
        current >= this.#options.maximumConnectionsPerAddress
      ) {
        if (!rate.allowed) this.#recordRateLimit()
        tlsSocket.destroy()
        return
      }
      this.#metrics.acceptedConnections += 1
      this.#rawSockets.add(tlsSocket)
      this.#addressCounts.set(address, current + 1)
      tlsSocket.setTimeout(this.#options.handshakeTimeoutMs, () =>
        tlsSocket.destroy(),
      )
      tlsSocket.once('close', () => {
        this.#rawSockets.delete(tlsSocket)
        const remaining = (this.#addressCounts.get(address) ?? 1) - 1
        if (remaining <= 0) this.#addressCounts.delete(address)
        else this.#addressCounts.set(address, remaining)
      })
    })
    this.#server.on('tlsClientError', () => {
      this.#metrics.authenticationFailures += 1
    })
  }

  get relayId(): string {
    return this.#store.identity.relayId
  }

  get relayFingerprint(): string {
    return this.#store.identity.publicKeyFingerprint
  }

  get listeningAddress(): AddressInfo | undefined {
    const address = this.#server.address()
    return typeof address === 'object' && address !== null ? address : undefined
  }

  get managementAddress(): AddressInfo | undefined {
    const address = this.#managementServer?.address()
    return typeof address === 'object' && address !== null ? address : undefined
  }

  async start(): Promise<void> {
    if (this.#started) return
    if (this.#closing) throw new Error('Relay service is closing')
    await listen(this.#server, this.#options.port, this.#options.host)
    if (this.#options.managementPort !== null) {
      this.#managementServer = this.#createManagementServer()
      await listen(
        this.#managementServer,
        this.#options.managementPort,
        this.#options.managementHost,
      )
    }
    this.#started = true
    this.#logger.log('relay.started')
  }

  metrics(): RelayServiceMetrics {
    return {
      uptimeSeconds: Math.max(0, (Date.now() - this.#startedAt) / 1_000),
      processRssBytes: process.memoryUsage().rss,
      fileDescriptorCount: currentFileDescriptorCount(),
      activeTlsConnections: this.#rawSockets.size,
      authenticatedConnections: this.#registry.count(),
      authenticatedControllers: this.#registry.count('controller'),
      authenticatedNodes: this.#registry.count('node'),
      pendingControlMessagesUpperBound:
        this.#registry.count() * relayProtocolLimits.maximumQueuedFrames,
      connectionRegistryEntries: this.#registry.count(),
      ...this.#metrics,
    }
  }

  revokePeer(peerId: Parameters<RelayStateStore['revokePeer']>[0]): boolean {
    const revoked = this.#store.revokePeer(peerId)
    if (!revoked) return false
    const peer = this.#store.getPeerById(peerId)
    if (peer !== undefined) {
      this.#registry.current(peer.fingerprint)?.invalidate('revoked')
      this.#logger.log('peer.revoked', {
        peerReference: peer.peerId,
        role: peer.role,
      })
    }
    return true
  }

  async close(): Promise<void> {
    if (this.#closing) return
    this.#closing = true
    this.#registry.clear('shutdown')
    for (const socket of this.#rawSockets) socket.destroy()
    await Promise.all([
      closeServer(this.#server),
      this.#managementServer === undefined
        ? Promise.resolve()
        : closeServer(this.#managementServer),
    ])
    this.#store.close()
    this.#logger.log('relay.stopped')
  }

  async #handleSecureConnection(socket: TLSSocket): Promise<void> {
    socket.setTimeout(0)
    if (this.#closing || socket.alpnProtocol !== relayProtocolAlpn) {
      socket.destroy()
      return
    }
    const address = normalizeAddress(socket.remoteAddress)
    const channel = new FramedRelayConnection(socket)
    let active: ActiveConnection | undefined
    try {
      const challenge = this.#createChallenge()
      await channel.send(challenge, {
        timeoutMs: this.#options.handshakeTimeoutMs,
      })
      const raw = await channel.receive(unknownSchema, {
        timeoutMs: this.#options.handshakeTimeoutMs,
      })
      assertCompatibleProtocol(raw)
      const parsed = RelayClientMessageSchema.safeParse(raw)
      if (!parsed.success) {
        throw new RelayProtocolError(
          'malformed_message',
          'Relay handshake message is invalid',
        )
      }
      if (
        parsed.data.type !== 'peer.enroll' &&
        parsed.data.type !== 'peer.authenticate'
      ) {
        throw new RelayProtocolError(
          'authentication_failed',
          'Relay authentication failed',
        )
      }
      if (Date.now() >= Date.parse(challenge.expiresAt)) {
        throw new RelayProtocolError(
          'authentication_failed',
          'Relay authentication failed',
        )
      }
      const authRate = this.#authenticationLimiter.consume(address)
      const identityRate = this.#authenticationIdentityLimiter.consume(
        parsed.data.peerFingerprint,
      )
      if (!authRate.allowed || !identityRate.allowed) {
        this.#recordRateLimit()
        throw new RelayProtocolError('rate_limited', 'Relay rate limit reached')
      }
      const peer =
        parsed.data.type === 'peer.enroll'
          ? this.#enroll(challenge, parsed.data, address)
          : this.#authenticate(challenge, parsed.data)
      const epoch = newRelayConnectionEpoch()
      active = new ActiveConnection(peer, epoch, channel, (reason) => {
        if (reason === 'replaced') {
          void sendError(
            channel,
            'stale_connection',
            'Relay connection was replaced',
          )
        } else if (reason === 'revoked') {
          void sendError(channel, 'revoked', 'Relay enrollment was revoked')
        }
        channel.destroy()
      })
      const replaced = this.#registry.replace(active)
      if (replaced !== undefined) {
        this.#metrics.reconnectReplacements += 1
        this.#logger.log('connection.replaced', {
          peerReference: peer.peerId,
          role: peer.role,
          connectionEpoch: epoch,
        })
      }
      this.#store.recordAuthenticated(peer.peerId, peer.clientBuildIdentity)
      await channel.send({
        type: 'peer.ready',
        protocolVersion: relayProtocolVersion,
        peerId: peer.peerId,
        role: peer.role,
        connectionEpoch: epoch,
        heartbeatIntervalMs: this.#options.heartbeatIntervalMs,
        heartbeatTimeoutMs: this.#options.heartbeatTimeoutMs,
        authenticatedAt: new Date().toISOString(),
      })
      this.#logger.log('connection.authenticated', {
        peerReference: peer.peerId,
        role: peer.role,
        connectionEpoch: epoch,
      })
      if (peer.role === 'node')
        await this.#publishNodePresence(peer.fingerprint)
      await this.#authenticatedLoop(active)
    } catch (error) {
      const failure = normalizeServiceError(error)
      if (failure.code === 'malformed_message')
        this.#metrics.malformedFrames += 1
      if (failure.code === 'authentication_failed') {
        this.#metrics.authenticationFailures += 1
      }
      if (!channel.closed)
        await sendError(channel, failure.code, failure.message)
      this.#logger.log('connection.rejected', { code: failure.code })
    } finally {
      if (active !== undefined && this.#registry.remove(active)) {
        if (active.peer.role === 'node') {
          await this.#publishNodePresence(active.peer.fingerprint)
        }
        this.#logger.log('connection.closed', {
          peerReference: active.peer.peerId,
          role: active.peer.role,
          connectionEpoch: active.epoch,
        })
      }
      channel.destroy()
    }
  }

  #createChallenge(): RelayChallengeMessage {
    const issuedAt = new Date()
    const unsigned = {
      type: 'relay.challenge' as const,
      protocolVersion: relayProtocolVersion,
      relayId: this.#store.identity.relayId,
      relayPublicKeySpki: this.#store.identity.publicKeySpki,
      relayFingerprint: this.#store.identity.publicKeyFingerprint,
      challengeId: newRelayChallengeId(),
      nonce: newRelayNonce(),
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(
        issuedAt.getTime() + this.#options.challengeLifetimeMs,
      ).toISOString(),
    }
    return {
      ...unsigned,
      signature: signRelayTranscript(
        this.#store.identity.privateKeyPem,
        relayChallengeTranscript(unsigned),
      ),
    }
  }

  #enroll(
    challenge: RelayChallengeMessage,
    message: Extract<RelayClientMessage, { readonly type: 'peer.enroll' }>,
    address: string,
  ): RelayPeerRecord {
    const limit = this.#enrollmentLimiter.consume(address)
    if (!limit.allowed) {
      this.#recordRateLimit()
      throw new RelayProtocolError('rate_limited', 'Relay rate limit reached')
    }
    try {
      if (
        fingerprintRelayPublicKeySpki(message.peerPublicKeySpki) !==
          message.peerFingerprint ||
        !verifyRelayTranscript(
          message.peerPublicKeySpki,
          relayEnrollmentTranscript({
            challenge,
            role: message.role,
            enrollmentToken: message.enrollmentToken,
            peerPublicKeySpki: message.peerPublicKeySpki,
            peerFingerprint: message.peerFingerprint,
            clientBuildIdentity: message.clientBuildIdentity,
            ...(message.role === 'node' &&
            message.authorizedControllerFingerprint !== undefined
              ? {
                  authorizedControllerFingerprint:
                    message.authorizedControllerFingerprint,
                }
              : {}),
          }),
          message.signature,
        )
      ) {
        throw new RelayProtocolError(
          'authentication_failed',
          'Relay authentication failed',
        )
      }
      const peer = this.#store.enroll({
        token: message.enrollmentToken,
        role: message.role,
        publicKeySpki: message.peerPublicKeySpki,
        fingerprint: message.peerFingerprint,
        clientBuildIdentity: message.clientBuildIdentity,
        ...(message.role === 'node' &&
        message.authorizedControllerFingerprint !== undefined
          ? {
              authorizedControllerFingerprint:
                message.authorizedControllerFingerprint,
            }
          : {}),
      })
      this.#metrics.enrollmentSuccesses += 1
      this.#logger.log('enrollment.succeeded', {
        peerReference: peer.peerId,
        role: peer.role,
      })
      return peer
    } catch (error) {
      this.#metrics.enrollmentFailures += 1
      this.#store.recordEnrollmentFailure(message.enrollmentToken)
      if (error instanceof RelayProtocolError) throw error
      throw new RelayProtocolError(
        'authentication_failed',
        'Relay authentication failed',
      )
    }
  }

  #authenticate(
    challenge: RelayChallengeMessage,
    message: Extract<
      RelayClientMessage,
      { readonly type: 'peer.authenticate' }
    >,
  ): RelayPeerRecord {
    const peer = this.#store.getPeerByFingerprint(message.peerFingerprint)
    if (
      peer === undefined ||
      peer.role !== message.role ||
      !verifyRelayTranscript(
        peer.publicKeySpki,
        relayAuthenticationTranscript({
          challenge,
          peerFingerprint: message.peerFingerprint,
          role: message.role,
          clientBuildIdentity: message.clientBuildIdentity,
        }),
        message.signature,
      )
    ) {
      throw new RelayProtocolError(
        'authentication_failed',
        'Relay authentication failed',
      )
    }
    if (peer.revokedAt !== undefined) {
      throw new RelayProtocolError('revoked', 'Relay enrollment was revoked')
    }
    this.#metrics.authenticatedReconnects += 1
    this.#store.recordAuthenticated(peer.peerId, message.clientBuildIdentity)
    return { ...peer, clientBuildIdentity: message.clientBuildIdentity }
  }

  async #authenticatedLoop(connection: ActiveConnection): Promise<void> {
    const heartbeat = setInterval(
      () => void this.#heartbeat(connection),
      this.#options.heartbeatIntervalMs,
    )
    heartbeat.unref()
    try {
      while (this.#registry.owns(connection) && !connection.invalidated) {
        const raw = await connection.channel.receive(unknownSchema, {
          timeoutMs: null,
        })
        assertCompatibleProtocol(raw)
        const parsed = RelayClientMessageSchema.safeParse(raw)
        if (!parsed.success) {
          throw new RelayProtocolError(
            'malformed_message',
            'Relay control message is invalid',
          )
        }
        await this.#handleAuthenticatedMessage(connection, parsed.data)
      }
    } finally {
      clearInterval(heartbeat)
    }
  }

  async #handleAuthenticatedMessage(
    connection: ActiveConnection,
    message: RelayClientMessage,
  ): Promise<void> {
    if (
      message.type === 'peer.enroll' ||
      message.type === 'peer.authenticate'
    ) {
      throw new RelayProtocolError(
        'malformed_message',
        'Relay authentication is already complete',
      )
    }
    if (message.connectionEpoch !== connection.epoch) {
      throw new RelayProtocolError(
        'stale_connection',
        'Relay connection epoch is stale',
      )
    }
    if (message.type === 'heartbeat.pong') {
      if (!connection.pendingPings.delete(message.pingId)) return
      connection.lastHeartbeatAcknowledgedAt = Date.now()
      return
    }
    if (message.type === 'peer.goodbye') {
      connection.channel.end()
      return
    }
    if (message.type === 'grant.replace') {
      if (connection.peer.role !== 'node') throw notAuthorized()
      this.#store.replaceGrant(
        connection.peer.peerId,
        message.authorizedControllerFingerprint,
      )
      await connection.channel.send({
        type: 'grant.replaced',
        protocolVersion: relayProtocolVersion,
        connectionEpoch: connection.epoch,
        requestId: message.requestId,
        observedAt: new Date().toISOString(),
      })
      await this.#publishNodePresence(connection.peer.fingerprint)
      return
    }
    if (
      message.type === 'rendezvous.subscribe' ||
      message.type === 'rendezvous.unsubscribe'
    ) {
      if (connection.peer.role !== 'controller') throw notAuthorized()
      if (
        !this.#store.canControllerObserveNode(
          connection.peer.fingerprint,
          message.targetNodeFingerprint,
        )
      ) {
        throw notAuthorized()
      }
      if (message.type === 'rendezvous.unsubscribe') {
        const subscription = connection.subscriptions.get(
          message.targetNodeFingerprint,
        )
        if (subscription?.requestId === message.requestId) {
          connection.subscriptions.delete(message.targetNodeFingerprint)
        }
        return
      }
      if (
        !connection.subscriptions.has(message.targetNodeFingerprint) &&
        connection.subscriptions.size >=
          relayProtocolLimits.maximumSubscriptionsPerController
      ) {
        throw new RelayProtocolError(
          'capacity_reached',
          'Relay subscription capacity reached',
        )
      }
      connection.subscriptions.set(message.targetNodeFingerprint, {
        requestId: message.requestId,
        targetNodeFingerprint: message.targetNodeFingerprint,
      })
      await this.#sendPresence(
        connection,
        connection.subscriptions.get(message.targetNodeFingerprint)!,
      )
    }
  }

  async #heartbeat(connection: ActiveConnection): Promise<void> {
    if (!this.#registry.owns(connection) || connection.invalidated) return
    const currentPeer = this.#store.getPeerById(connection.peer.peerId)
    if (currentPeer?.revokedAt !== undefined || currentPeer === undefined) {
      connection.invalidate('revoked')
      return
    }
    const now = Date.now()
    if (
      now - connection.lastHeartbeatAcknowledgedAt >
      this.#options.heartbeatTimeoutMs
    ) {
      this.#metrics.heartbeatTimeouts += 1
      this.#logger.log('heartbeat.timeout', {
        peerReference: connection.peer.peerId,
        role: connection.peer.role,
        connectionEpoch: connection.epoch,
      })
      connection.channel.destroy()
      return
    }
    for (const [pingId, sentAt] of connection.pendingPings) {
      if (now - sentAt > this.#options.heartbeatTimeoutMs) {
        connection.pendingPings.delete(pingId)
      }
    }
    while (connection.pendingPings.size >= maximumPendingHeartbeatPings) {
      const oldest = connection.pendingPings.keys().next().value
      if (oldest === undefined) break
      connection.pendingPings.delete(oldest)
    }
    const pingId = newRelayPingId()
    connection.pendingPings.set(pingId, now)
    await connection.channel
      .send({
        type: 'heartbeat.ping',
        protocolVersion: relayProtocolVersion,
        connectionEpoch: connection.epoch,
        pingId,
        sentAt: new Date(now).toISOString(),
      })
      .catch(() => undefined)
  }

  async #publishNodePresence(
    nodeFingerprint: RelayPublicKeyFingerprint,
  ): Promise<void> {
    const sends: Promise<void>[] = []
    for (const controller of this.#registry.values()) {
      if (controller.peer.role !== 'controller') continue
      const subscription = controller.subscriptions.get(nodeFingerprint)
      if (subscription === undefined) continue
      if (
        !this.#store.canControllerObserveNode(
          controller.peer.fingerprint,
          nodeFingerprint,
        )
      ) {
        controller.subscriptions.delete(nodeFingerprint)
        sends.push(
          this.#sendPresence(controller, subscription, 'unavailable').catch(
            () => undefined,
          ),
        )
      } else {
        sends.push(
          this.#sendPresence(controller, subscription).catch(() => undefined),
        )
      }
    }
    await Promise.all(sends)
  }

  async #sendPresence(
    controller: ActiveConnection,
    subscription: Subscription,
    override?: 'unavailable',
  ): Promise<void> {
    const node = this.#registry.current(subscription.targetNodeFingerprint)
    const online =
      override === undefined &&
      node?.peer.role === 'node' &&
      this.#registry.owns(node)
    await controller.channel.send({
      type: 'rendezvous.status',
      protocolVersion: relayProtocolVersion,
      connectionEpoch: controller.epoch,
      requestId: subscription.requestId,
      targetNodeFingerprint: subscription.targetNodeFingerprint,
      state: override ?? (online ? 'online' : 'offline'),
      observedAt: new Date().toISOString(),
    })
  }

  #recordRateLimit(): void {
    this.#metrics.rateLimitEvents += 1
    this.#logger.log('rate_limit.applied', { code: 'rate_limited' })
  }

  #createManagementServer(): HttpServer {
    return createHttpServer((request, response) => {
      response.setHeader('Cache-Control', 'no-store')
      response.setHeader('Connection', 'close')
      response.setHeader('Content-Type', 'application/json; charset=utf-8')
      if (request.method !== 'GET') {
        response.statusCode = 405
        response.end('{"status":"method_not_allowed"}\n')
        return
      }
      if (request.url === '/healthz') {
        response.statusCode = 200
        response.end('{"status":"ok"}\n')
        return
      }
      if (request.url === '/readyz') {
        response.statusCode = this.#started && !this.#closing ? 200 : 503
        response.end(
          `${JSON.stringify({ status: this.#started && !this.#closing ? 'ready' : 'not_ready' })}\n`,
        )
        return
      }
      if (request.url === '/metrics') {
        response.statusCode = 200
        response.end(`${JSON.stringify(this.metrics())}\n`)
        return
      }
      response.statusCode = 404
      response.end('{"status":"not_found"}\n')
    })
  }
}

async function sendError(
  channel: FramedRelayConnection,
  code: RelayErrorCode,
  message: string,
): Promise<void> {
  await channel
    .send({
      type: 'relay.error',
      protocolVersion: relayProtocolVersion,
      code,
      message: safeErrorMessage(code, message),
    })
    .catch(() => undefined)
}

function safeErrorMessage(code: RelayErrorCode, message: string): string {
  const allowlisted: Partial<Record<RelayErrorCode, readonly string[]>> = {
    authentication_failed: ['Relay authentication failed'],
    enrollment_invalid: ['Relay enrollment failed'],
    enrollment_expired: ['Relay enrollment failed'],
    enrollment_consumed: ['Relay enrollment failed'],
    identity_mismatch: ['Relay enrollment failed'],
    revoked: ['Relay enrollment was revoked'],
    rate_limited: ['Relay rate limit reached'],
    not_authorized: ['Relay action is not authorized'],
    stale_connection: ['Relay connection epoch is stale'],
    protocol_incompatible: ['Relay protocol version is incompatible'],
    malformed_message: [
      'Relay handshake message is invalid',
      'Relay control message is invalid',
      'Relay authentication is already complete',
    ],
    capacity_reached: ['Relay subscription capacity reached'],
  }
  return allowlisted[code]?.includes(message)
    ? message
    : code === 'protocol_incompatible'
      ? 'Relay protocol version is incompatible'
      : 'Relay connection failed'
}

function normalizeServiceError(error: unknown): RelayProtocolError {
  if (error instanceof RelayProtocolError) return error
  return new RelayProtocolError('connection_failed', 'Relay connection failed')
}

function assertCompatibleProtocol(value: unknown): void {
  if (
    typeof value === 'object' &&
    value !== null &&
    'protocolVersion' in value &&
    (value as { readonly protocolVersion?: unknown }).protocolVersion !==
      relayProtocolVersion
  ) {
    throw new RelayProtocolError(
      'protocol_incompatible',
      'Relay protocol version is incompatible',
    )
  }
}

function notAuthorized(): RelayProtocolError {
  return new RelayProtocolError(
    'not_authorized',
    'Relay action is not authorized',
  )
}

function normalizeAddress(address: string | undefined): string {
  if (address === undefined || address.length === 0) return 'unknown'
  return address.length <= 64 ? address : 'oversized-address'
}

function currentFileDescriptorCount(): number | null {
  try {
    return readdirSync('/proc/self/fd').length
  } catch {
    return null
  }
}

function validateServiceBounds(options: {
  readonly port: number
  readonly managementHost: string
  readonly managementPort: number | null
  readonly maximumConnections: number
  readonly maximumConnectionsPerAddress: number
  readonly heartbeatIntervalMs: number
  readonly heartbeatTimeoutMs: number
  readonly handshakeTimeoutMs: number
  readonly challengeLifetimeMs: number
}): void {
  if (!['127.0.0.1', '::1', 'localhost'].includes(options.managementHost)) {
    throw new RangeError('Relay management listener must be loopback-only')
  }
  for (const port of [options.port, options.managementPort]) {
    if (
      port !== null &&
      (!Number.isSafeInteger(port) || port < 0 || port > 65_535)
    ) {
      throw new RangeError('Relay port is invalid')
    }
  }
  if (
    !Number.isSafeInteger(options.maximumConnections) ||
    options.maximumConnections <= 0 ||
    options.maximumConnections > relayProtocolLimits.maximumConnections ||
    !Number.isSafeInteger(options.maximumConnectionsPerAddress) ||
    options.maximumConnectionsPerAddress <= 0 ||
    options.maximumConnectionsPerAddress > options.maximumConnections ||
    options.maximumConnectionsPerAddress >
      relayProtocolLimits.maximumConnectionsPerAddress ||
    !Number.isSafeInteger(options.heartbeatIntervalMs) ||
    options.heartbeatIntervalMs < 10 ||
    options.heartbeatIntervalMs > 60_000 ||
    !Number.isSafeInteger(options.heartbeatTimeoutMs) ||
    options.heartbeatTimeoutMs <= options.heartbeatIntervalMs ||
    options.heartbeatTimeoutMs > 180_000 ||
    !Number.isSafeInteger(options.handshakeTimeoutMs) ||
    options.handshakeTimeoutMs <= 0 ||
    options.handshakeTimeoutMs > relayProtocolLimits.handshakeTimeoutMs ||
    !Number.isSafeInteger(options.challengeLifetimeMs) ||
    options.challengeLifetimeMs <= 0 ||
    options.challengeLifetimeMs > relayProtocolLimits.challengeLifetimeMs
  ) {
    throw new RangeError('Relay service bounds are invalid')
  }
}

async function listen(
  server: TlsServer | HttpServer,
  port: number,
  host: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}

async function closeServer(server: TlsServer | HttpServer): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve) => server.close(() => resolve()))
}
