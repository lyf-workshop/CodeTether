import {
  createServer as createHttpServer,
  type Server as HttpServer,
} from 'node:http'
import { readdirSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { performance } from 'node:perf_hooks'
import {
  createServer as createTlsServer,
  type Server as TlsServer,
  type TLSSocket,
} from 'node:tls'

import {
  FramedRelayConnection,
  type RelayFramingQueueMetrics,
  type RelayChannelClosedReason,
  type RelayChannelId,
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
  RelayChannelRegistry,
  type RelayEphemeralChannel,
} from './channel-registry.js'
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
  readonly maximumChannels?: number
  readonly maximumChannelsPerPeer?: number
  readonly maximumChannelOpenAttemptsPerMinute?: number
  readonly channelOpenTimeoutMs?: number
  readonly channelAcknowledgementTimeoutMs?: number
  /** Monotonic elapsed-time source; wall time remains presentation-only. */
  readonly monotonicNow?: () => number
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
  readonly queuedInboundFrames: number
  readonly queuedInboundBytes: number
  readonly pendingOutboundFrames: number
  readonly pendingOutboundBytes: number
  readonly framedQueueFrames: number
  readonly framedQueueBytes: number
  readonly framedQueueFramesHighWaterMark: number
  readonly framedQueueBytesHighWaterMark: number
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
  readonly activeChannels: number
  readonly openingChannels: number
  readonly terminalChannelTombstones: number
  readonly pendingChannelDataFrames: number
  readonly pendingChannelDataBytes: number
  readonly pendingChannelDataFramesHighWaterMark: number
  readonly pendingChannelDataBytesHighWaterMark: number
  readonly channelOpenRequests: number
  readonly channelAccepted: number
  readonly channelRejected: number
  readonly channelClosed: number
  readonly channelErrors: number
  readonly channelDataFramesForwarded: number
  readonly channelDataBytesForwarded: number
  readonly controllerToRelayChannelBytes: number
  readonly relayToNodeChannelBytes: number
  readonly nodeToRelayChannelBytes: number
  readonly relayToControllerChannelBytes: number
  readonly channelBackpressureFailures: number
  readonly staleChannelFrames: number
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
  channelOpenRequests: number
  channelAccepted: number
  channelRejected: number
  channelClosed: number
  channelErrors: number
  channelDataFramesForwarded: number
  channelDataBytesForwarded: number
  controllerToRelayChannelBytes: number
  relayToNodeChannelBytes: number
  nodeToRelayChannelBytes: number
  relayToControllerChannelBytes: number
  channelBackpressureFailures: number
  staleChannelFrames: number
}

interface MutableFramingQueueMetrics {
  queuedInboundFrames: number
  queuedInboundBytes: number
  pendingOutboundFrames: number
  pendingOutboundBytes: number
}

interface Subscription {
  readonly requestId: string
  readonly targetNodeFingerprint: RelayPublicKeyFingerprint
}

interface ClosedChannelTombstone {
  readonly channel: RelayEphemeralChannel<ActiveConnection>
  readonly timer: NodeJS.Timeout
  exactLateFrames: number
}

class ActiveConnection implements RelayOwnedConnection {
  readonly subscriptions = new Map<string, Subscription>()
  readonly pendingPings = new Map<RelayPingId, number>()
  lastHeartbeatAcknowledgedAt: number
  staleChannelFrames = 0
  invalidated = false
  readonly #invalidate: (reason: 'replaced' | 'revoked' | 'shutdown') => void

  constructor(
    readonly peer: RelayPeerRecord,
    readonly epoch: RelayConnectionEpoch,
    readonly channel: FramedRelayConnection,
    invalidate: (reason: 'replaced' | 'revoked' | 'shutdown') => void,
    monotonicNow: number,
  ) {
    this.#invalidate = invalidate
    this.lastHeartbeatAcknowledgedAt = monotonicNow
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
      | 'maximumChannels'
      | 'maximumChannelsPerPeer'
      | 'maximumChannelOpenAttemptsPerMinute'
      | 'channelOpenTimeoutMs'
      | 'channelAcknowledgementTimeoutMs'
    >
  > & { readonly managementPort: number | null }
  readonly #logger: RelaySafeLogger
  readonly #monotonicNow: () => number
  readonly #server: TlsServer
  readonly #registry = new RelayConnectionRegistry<ActiveConnection>()
  readonly #channels: RelayChannelRegistry<ActiveConnection>
  readonly #channelOpenTimers = new Map<RelayChannelId, NodeJS.Timeout>()
  readonly #channelAcknowledgementTimers = new Map<string, NodeJS.Timeout>()
  readonly #closedChannelTombstones = new Map<
    RelayChannelId,
    ClosedChannelTombstone
  >()
  readonly #rawSockets = new Set<TLSSocket>()
  readonly #framingQueues = new Map<
    FramedRelayConnection,
    RelayFramingQueueMetrics
  >()
  readonly #framingQueueTotals: MutableFramingQueueMetrics = {
    queuedInboundFrames: 0,
    queuedInboundBytes: 0,
    pendingOutboundFrames: 0,
    pendingOutboundBytes: 0,
  }
  readonly #addressCounts = new Map<string, number>()
  readonly #admissionLimiter: BoundedTokenBucketRateLimiter
  readonly #authenticationLimiter: BoundedTokenBucketRateLimiter
  readonly #authenticationIdentityLimiter: BoundedTokenBucketRateLimiter
  readonly #enrollmentLimiter: BoundedTokenBucketRateLimiter
  readonly #channelOpenLimiter: BoundedTokenBucketRateLimiter
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
    channelOpenRequests: 0,
    channelAccepted: 0,
    channelRejected: 0,
    channelClosed: 0,
    channelErrors: 0,
    channelDataFramesForwarded: 0,
    channelDataBytesForwarded: 0,
    controllerToRelayChannelBytes: 0,
    relayToNodeChannelBytes: 0,
    nodeToRelayChannelBytes: 0,
    relayToControllerChannelBytes: 0,
    channelBackpressureFailures: 0,
    staleChannelFrames: 0,
  }
  readonly #startedAt: number
  #framedQueueFramesHighWaterMark = 0
  #framedQueueBytesHighWaterMark = 0
  #pendingChannelDataFramesHighWaterMark = 0
  #pendingChannelDataBytesHighWaterMark = 0
  #managementServer: HttpServer | undefined
  #started = false
  #closing = false

  constructor(options: RelayServiceOptions) {
    this.#store = options.stateStore
    this.#logger = options.logger ?? createJsonRelayLogger()
    this.#monotonicNow = options.monotonicNow ?? (() => performance.now())
    this.#startedAt = this.#monotonicNow()
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
      maximumChannels:
        options.maximumChannels ?? relayProtocolLimits.maximumChannels,
      maximumChannelsPerPeer:
        options.maximumChannelsPerPeer ??
        relayProtocolLimits.maximumChannelsPerPeer,
      maximumChannelOpenAttemptsPerMinute:
        options.maximumChannelOpenAttemptsPerMinute ??
        relayProtocolLimits.maximumChannelOpenAttemptsPerMinute,
      channelOpenTimeoutMs:
        options.channelOpenTimeoutMs ??
        relayProtocolLimits.channelOpenTimeoutMs,
      channelAcknowledgementTimeoutMs:
        options.channelAcknowledgementTimeoutMs ??
        relayProtocolLimits.channelAcknowledgementTimeoutMs,
    }
    validateServiceBounds(this.#options)
    this.#channels = new RelayChannelRegistry(
      this.#options.maximumChannels,
      this.#options.maximumChannelsPerPeer,
    )
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
    this.#channelOpenLimiter = new BoundedTokenBucketRateLimiter({
      capacity: this.#options.maximumChannelOpenAttemptsPerMinute,
      refillIntervalMs: 60_000,
      maximumEntries: relayProtocolLimits.maximumRateLimitEntries,
    })
    this.#server = createTlsServer(
      {
        key: options.tls.privateKeyPem,
        cert: options.tls.certificatePem,
        minVersion: 'TLSv1.3',
        maxVersion: 'TLSv1.3',
        ALPNProtocols: [relayProtocolAlpn],
        handshakeTimeout: this.#options.handshakeTimeoutMs,
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
    const framedQueueFrames =
      this.#framingQueueTotals.queuedInboundFrames +
      this.#framingQueueTotals.pendingOutboundFrames
    const framedQueueBytes =
      this.#framingQueueTotals.queuedInboundBytes +
      this.#framingQueueTotals.pendingOutboundBytes
    return {
      uptimeSeconds: Math.max(
        0,
        (this.#monotonicNow() - this.#startedAt) / 1_000,
      ),
      processRssBytes: process.memoryUsage().rss,
      fileDescriptorCount: currentFileDescriptorCount(),
      activeTlsConnections: this.#rawSockets.size,
      authenticatedConnections: this.#registry.count(),
      authenticatedControllers: this.#registry.count('controller'),
      authenticatedNodes: this.#registry.count('node'),
      pendingControlMessagesUpperBound:
        this.#registry.count() * relayProtocolLimits.maximumQueuedFrames,
      ...this.#framingQueueTotals,
      framedQueueFrames,
      framedQueueBytes,
      framedQueueFramesHighWaterMark: this.#framedQueueFramesHighWaterMark,
      framedQueueBytesHighWaterMark: this.#framedQueueBytesHighWaterMark,
      connectionRegistryEntries: this.#registry.count(),
      activeChannels: this.#channels.count,
      openingChannels: this.#channels.openingCount,
      terminalChannelTombstones: this.#closedChannelTombstones.size,
      pendingChannelDataFrames: this.#channels.outstandingDataFrames,
      pendingChannelDataBytes: this.#channels.outstandingDataBytes,
      pendingChannelDataFramesHighWaterMark:
        this.#pendingChannelDataFramesHighWaterMark,
      pendingChannelDataBytesHighWaterMark:
        this.#pendingChannelDataBytesHighWaterMark,
      ...this.#metrics,
    }
  }

  revokePeer(peerId: Parameters<RelayStateStore['revokePeer']>[0]): boolean {
    const revoked = this.#store.revokePeer(peerId)
    if (!revoked) return false
    const peer = this.#store.getPeerById(peerId)
    if (peer !== undefined) {
      const connection = this.#registry.current(peer.fingerprint)
      if (connection !== undefined) {
        void this.#closeChannelsForConnection(
          connection,
          'authorization_revoked',
        )
      }
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
    await this.#closeAllChannels('relay_shutdown')
    this.#clearClosedChannelTombstones()
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
    const observed = { channel: undefined as FramedRelayConnection | undefined }
    const channel = new FramedRelayConnection(socket, {
      onQueueMetricsChanged: (metrics) => {
        if (observed.channel !== undefined)
          this.#observeFramingQueue(observed.channel, metrics)
      },
    })
    observed.channel = channel
    this.#framingQueues.set(channel, channel.queueMetrics)
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
      active = new ActiveConnection(
        peer,
        epoch,
        channel,
        (reason) => {
          if (active !== undefined) {
            void this.#closeChannelsForConnection(
              active,
              reason === 'replaced'
                ? 'connection_replaced'
                : reason === 'revoked'
                  ? 'authorization_revoked'
                  : 'relay_shutdown',
            )
          }
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
        },
        this.#monotonicNow(),
      )
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
        await this.#closeChannelsForConnection(active, 'peer_disconnected')
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
      this.#removeFramingQueue(channel)
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
        if (!this.#registry.owns(connection) || connection.invalidated) break
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
    if (!this.#registry.owns(connection) || connection.invalidated) {
      throw new RelayProtocolError(
        'stale_connection',
        'Relay connection epoch is stale',
      )
    }
    if (
      message.type === 'channel.open' ||
      message.type === 'channel.accept' ||
      message.type === 'channel.reject' ||
      message.type === 'channel.data' ||
      message.type === 'channel.data.ack' ||
      message.type === 'channel.close'
    ) {
      await this.#handleChannelMessage(connection, message)
      return
    }
    if (message.type === 'heartbeat.pong') {
      if (!connection.pendingPings.delete(message.pingId)) return
      connection.lastHeartbeatAcknowledgedAt = this.#monotonicNow()
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
      await this.#closeUnauthorizedChannelsForNode(connection)
      if (!this.#registry.owns(connection) || connection.invalidated) return
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

  async #handleChannelMessage(
    connection: ActiveConnection,
    message: Extract<
      RelayClientMessage,
      { readonly type: `channel.${string}` }
    >,
  ): Promise<void> {
    if (message.type === 'channel.open') {
      await this.#openChannel(connection, message)
      return
    }
    const channel = this.#resolveChannel(connection, message)
    if (channel === undefined) return
    if (message.type === 'channel.accept') {
      if (
        connection !== channel.node ||
        channel.state !== 'opening' ||
        message.requestId !== channel.requestId
      ) {
        await this.#failChannel(channel, 'invalid_state')
        return
      }
      this.#clearChannelOpenTimer(channel.channelId)
      channel.state = 'open'
      try {
        await Promise.all([
          this.#sendChannelOpened(channel, channel.controller),
          this.#sendChannelOpened(channel, channel.node),
        ])
        if (!this.#channels.owns(channel)) return
        this.#metrics.channelAccepted += 1
      } catch {
        await this.#closeChannel(channel, 'peer_disconnected')
      }
      return
    }
    if (message.type === 'channel.reject') {
      if (
        connection !== channel.node ||
        channel.state !== 'opening' ||
        message.requestId !== channel.requestId
      ) {
        await this.#failChannel(channel, 'invalid_state')
        return
      }
      this.#removeChannel(channel)
      this.#metrics.channelRejected += 1
      await this.#sendIfCurrent(channel.controller, {
        ...this.#channelBinding(channel, channel.controller),
        type: 'channel.reject',
        requestId: channel.requestId,
        reason: message.reason,
      })
      return
    }
    if (message.type === 'channel.data') {
      await this.#forwardChannelData(connection, channel, message)
      return
    }
    if (message.type === 'channel.data.ack') {
      await this.#forwardChannelAcknowledgement(connection, channel, message)
      return
    }
    await this.#closeChannel(channel, 'peer_closed')
  }

  async #openChannel(
    controller: ActiveConnection,
    message: Extract<RelayClientMessage, { readonly type: 'channel.open' }>,
  ): Promise<void> {
    this.#metrics.channelOpenRequests += 1
    const openRate = this.#channelOpenLimiter.consume(
      controller.peer.fingerprint,
    )
    if (!openRate.allowed) {
      this.#recordRateLimit()
      await sendError(
        controller.channel,
        'rate_limited',
        'Relay rate limit reached',
      )
      controller.invalidated = true
      controller.channel.destroy()
      return
    }
    if (
      controller.peer.role !== 'controller' ||
      !this.#store.canControllerObserveNode(
        controller.peer.fingerprint,
        message.targetNodeFingerprint,
      )
    ) {
      await this.#sendChannelOpenError(
        controller,
        message.requestId,
        'not_authorized',
      )
      return
    }
    const node = this.#registry.current(message.targetNodeFingerprint)
    if (
      node === undefined ||
      node.peer.role !== 'node' ||
      !this.#registry.owns(node) ||
      node.invalidated
    ) {
      await this.#sendChannelOpenError(
        controller,
        message.requestId,
        'peer_unavailable',
      )
      return
    }
    const created = this.#channels.create({
      requestId: message.requestId,
      purpose: message.purpose,
      controller,
      node,
    })
    if (!created.ok) {
      await this.#sendChannelOpenError(
        controller,
        message.requestId,
        created.reason === 'duplicate' ? 'internal' : 'capacity_reached',
      )
      return
    }
    const channel = created.channel
    this.#startChannelOpenTimer(channel)
    try {
      await node.channel.send(
        {
          ...this.#channelBinding(channel, node),
          type: 'channel.offer',
          requestId: channel.requestId,
          controllerFingerprint: controller.peer.fingerprint,
          purpose: channel.purpose,
        },
        { timeoutMs: this.#options.channelAcknowledgementTimeoutMs },
      )
      if (
        !this.#registry.owns(controller) ||
        !this.#registry.owns(node) ||
        !this.#channels.owns(channel)
      ) {
        await this.#closeChannel(channel, 'connection_replaced')
      }
    } catch {
      this.#removeChannel(channel)
      await this.#sendChannelOpenError(
        controller,
        message.requestId,
        'peer_unavailable',
      )
    }
  }

  #resolveChannel(
    connection: ActiveConnection,
    message: Exclude<
      Extract<RelayClientMessage, { readonly type: `channel.${string}` }>,
      { readonly type: 'channel.open' }
    >,
  ): RelayEphemeralChannel<ActiveConnection> | undefined {
    const channel = this.#channels.get(message.channelId)
    if (channel === undefined) {
      const tombstone = this.#closedChannelTombstones.get(message.channelId)
      if (
        tombstone !== undefined &&
        this.#matchesClosedChannel(tombstone.channel, connection, message)
      ) {
        return undefined
      }
      this.#recordStaleChannelFrame(connection)
      return undefined
    }
    if (connection !== channel.controller && connection !== channel.node) {
      this.#recordStaleChannelFrame(connection)
      return undefined
    }
    if (
      message.channelGeneration !== channel.channelGeneration ||
      message.controllerConnectionEpoch !== channel.controllerConnectionEpoch ||
      message.nodeConnectionEpoch !== channel.nodeConnectionEpoch
    ) {
      if (this.#recordStaleChannelFrame(connection)) {
        void this.#failChannel(channel, 'stale_channel')
      }
      return undefined
    }
    return channel
  }

  #matchesClosedChannel(
    channel: RelayEphemeralChannel<ActiveConnection>,
    connection: ActiveConnection,
    message: {
      readonly channelGeneration: string
      readonly controllerConnectionEpoch: string
      readonly nodeConnectionEpoch: string
    },
  ): boolean {
    const exact =
      (connection === channel.controller || connection === channel.node) &&
      message.channelGeneration === channel.channelGeneration &&
      message.controllerConnectionEpoch === channel.controllerConnectionEpoch &&
      message.nodeConnectionEpoch === channel.nodeConnectionEpoch
    if (!exact) return false
    const tombstone = this.#closedChannelTombstones.get(channel.channelId)
    if (tombstone?.channel !== channel) return false
    tombstone.exactLateFrames += 1
    return (
      tombstone.exactLateFrames <=
      relayProtocolLimits.maximumTerminalChannelFrames
    )
  }

  #recordStaleChannelFrame(connection: ActiveConnection): boolean {
    this.#metrics.staleChannelFrames += 1
    connection.staleChannelFrames += 1
    if (
      connection.staleChannelFrames <
      relayProtocolLimits.maximumStaleChannelFramesPerConnection
    ) {
      return true
    }
    this.#recordRateLimit()
    connection.invalidated = true
    connection.channel.destroy()
    return false
  }

  async #forwardChannelData(
    sender: ActiveConnection,
    channel: RelayEphemeralChannel<ActiveConnection>,
    message: Extract<RelayClientMessage, { readonly type: 'channel.data' }>,
  ): Promise<void> {
    if (channel.state !== 'open') {
      await this.#failChannel(channel, 'invalid_state')
      return
    }
    const senderIsController = sender === channel.controller
    const outstanding = senderIsController
      ? channel.controllerOutstandingSequence
      : channel.nodeOutstandingSequence
    const expected = senderIsController
      ? channel.nextControllerSequence
      : channel.nextNodeSequence
    if (outstanding !== undefined || message.sequence !== expected) {
      if (outstanding !== undefined)
        this.#metrics.channelBackpressureFailures += 1
      await this.#failChannel(channel, 'flow_control_violation')
      return
    }
    if (senderIsController) {
      channel.controllerOutstandingSequence = message.sequence
      channel.controllerOutstandingBytes = decodedBase64UrlBytes(message.data)
      channel.nextControllerSequence += 1
    } else {
      channel.nodeOutstandingSequence = message.sequence
      channel.nodeOutstandingBytes = decodedBase64UrlBytes(message.data)
      channel.nextNodeSequence += 1
    }
    this.#observePendingChannelData()
    const recipient = senderIsController ? channel.node : channel.controller
    try {
      await recipient.channel.send(
        {
          ...this.#channelBinding(channel, recipient),
          type: 'channel.data',
          sequence: message.sequence,
          data: message.data,
        },
        { timeoutMs: this.#options.channelAcknowledgementTimeoutMs },
      )
      if (!this.#channels.owns(channel)) return
      const forwardedBytes = decodedBase64UrlBytes(message.data)
      this.#metrics.channelDataFramesForwarded += 1
      this.#metrics.channelDataBytesForwarded += forwardedBytes
      if (senderIsController) {
        this.#metrics.controllerToRelayChannelBytes += forwardedBytes
        this.#metrics.relayToNodeChannelBytes += forwardedBytes
      } else {
        this.#metrics.nodeToRelayChannelBytes += forwardedBytes
        this.#metrics.relayToControllerChannelBytes += forwardedBytes
      }
      const stillOutstanding = senderIsController
        ? channel.controllerOutstandingSequence
        : channel.nodeOutstandingSequence
      if (stillOutstanding === message.sequence) {
        this.#startChannelAcknowledgementTimer(
          channel,
          senderIsController ? 'controller' : 'node',
          message.sequence,
        )
      }
    } catch {
      await this.#closeChannel(channel, 'peer_disconnected')
    }
  }

  async #forwardChannelAcknowledgement(
    acknowledger: ActiveConnection,
    channel: RelayEphemeralChannel<ActiveConnection>,
    message: Extract<RelayClientMessage, { readonly type: 'channel.data.ack' }>,
  ): Promise<void> {
    if (channel.state !== 'open') {
      await this.#failChannel(channel, 'invalid_state')
      return
    }
    const acknowledgesController = acknowledger === channel.node
    const outstanding = acknowledgesController
      ? channel.controllerOutstandingSequence
      : channel.nodeOutstandingSequence
    if (outstanding !== message.acknowledgedSequence) {
      await this.#failChannel(channel, 'flow_control_violation')
      return
    }
    const recipient = acknowledgesController ? channel.controller : channel.node
    try {
      await recipient.channel.send(
        {
          ...this.#channelBinding(channel, recipient),
          type: 'channel.data.ack',
          acknowledgedSequence: message.acknowledgedSequence,
        },
        { timeoutMs: this.#options.channelAcknowledgementTimeoutMs },
      )
      if (!this.#channels.owns(channel)) return
      if (acknowledgesController) {
        channel.controllerOutstandingSequence = undefined
        channel.controllerOutstandingBytes = undefined
        this.#clearChannelAcknowledgementTimer(channel, 'controller')
      } else {
        channel.nodeOutstandingSequence = undefined
        channel.nodeOutstandingBytes = undefined
        this.#clearChannelAcknowledgementTimer(channel, 'node')
      }
    } catch {
      await this.#closeChannel(channel, 'peer_disconnected')
    }
  }

  #channelBinding(
    channel: RelayEphemeralChannel<ActiveConnection>,
    recipient: ActiveConnection,
  ) {
    return {
      protocolVersion: relayProtocolVersion,
      connectionEpoch: recipient.epoch,
      channelId: channel.channelId,
      channelGeneration: channel.channelGeneration,
      controllerConnectionEpoch: channel.controllerConnectionEpoch,
      nodeConnectionEpoch: channel.nodeConnectionEpoch,
    } as const
  }

  async #sendChannelOpened(
    channel: RelayEphemeralChannel<ActiveConnection>,
    recipient: ActiveConnection,
  ): Promise<void> {
    if (!this.#registry.owns(recipient) || recipient.invalidated) {
      throw new RelayProtocolError(
        'stale_connection',
        'Relay connection epoch is stale',
      )
    }
    await recipient.channel.send(
      {
        ...this.#channelBinding(channel, recipient),
        type: 'channel.opened',
        requestId: channel.requestId,
        purpose: channel.purpose,
      },
      { timeoutMs: this.#options.channelAcknowledgementTimeoutMs },
    )
  }

  async #sendChannelOpenError(
    controller: ActiveConnection,
    requestId: Extract<
      RelayClientMessage,
      { readonly type: 'channel.open' }
    >['requestId'],
    code:
      'capacity_reached' | 'not_authorized' | 'peer_unavailable' | 'internal',
  ): Promise<void> {
    this.#metrics.channelErrors += 1
    await this.#sendIfCurrent(controller, {
      type: 'channel.error',
      protocolVersion: relayProtocolVersion,
      connectionEpoch: controller.epoch,
      requestId,
      code,
    })
  }

  async #closeChannel(
    channel: RelayEphemeralChannel<ActiveConnection>,
    reason: RelayChannelClosedReason,
  ): Promise<void> {
    if (!this.#removeChannel(channel)) return
    this.#metrics.channelClosed += 1
    await Promise.all([
      this.#sendIfCurrent(channel.controller, {
        ...this.#channelBinding(channel, channel.controller),
        type: 'channel.closed',
        requestId: channel.requestId,
        reason,
      }),
      this.#sendIfCurrent(channel.node, {
        ...this.#channelBinding(channel, channel.node),
        type: 'channel.closed',
        requestId: channel.requestId,
        reason,
      }),
    ])
  }

  async #failChannel(
    channel: RelayEphemeralChannel<ActiveConnection>,
    code:
      | 'stale_channel'
      | 'invalid_state'
      | 'flow_control_violation'
      | 'capacity_reached'
      | 'not_authorized'
      | 'peer_unavailable'
      | 'internal',
  ): Promise<void> {
    if (!this.#removeChannel(channel)) return
    this.#metrics.channelErrors += 1
    await Promise.all([
      this.#sendIfCurrent(channel.controller, {
        ...this.#channelBinding(channel, channel.controller),
        type: 'channel.error',
        requestId: channel.requestId,
        code,
      }),
      this.#sendIfCurrent(channel.node, {
        ...this.#channelBinding(channel, channel.node),
        type: 'channel.error',
        requestId: channel.requestId,
        code,
      }),
    ])
  }

  async #sendIfCurrent(
    connection: ActiveConnection,
    message: unknown,
  ): Promise<void> {
    if (!this.#registry.owns(connection) || connection.invalidated) return
    await connection.channel
      .send(message, {
        timeoutMs: this.#options.channelAcknowledgementTimeoutMs,
      })
      .catch(() => undefined)
  }

  #startChannelOpenTimer(
    channel: RelayEphemeralChannel<ActiveConnection>,
  ): void {
    const timer = setTimeout(() => {
      if (!this.#channels.owns(channel) || channel.state !== 'opening') return
      void this.#closeChannel(channel, 'timeout')
    }, this.#options.channelOpenTimeoutMs)
    timer.unref()
    this.#channelOpenTimers.set(channel.channelId, timer)
  }

  #clearChannelOpenTimer(channelId: RelayChannelId): void {
    const timer = this.#channelOpenTimers.get(channelId)
    if (timer !== undefined) clearTimeout(timer)
    this.#channelOpenTimers.delete(channelId)
  }

  #startChannelAcknowledgementTimer(
    channel: RelayEphemeralChannel<ActiveConnection>,
    senderRole: 'controller' | 'node',
    sequence: number,
  ): void {
    const key = channelAcknowledgementKey(channel.channelId, senderRole)
    const timer = setTimeout(() => {
      if (!this.#channels.owns(channel)) return
      const outstanding =
        senderRole === 'controller'
          ? channel.controllerOutstandingSequence
          : channel.nodeOutstandingSequence
      if (outstanding !== sequence) return
      this.#metrics.channelBackpressureFailures += 1
      void this.#failChannel(channel, 'flow_control_violation')
    }, this.#options.channelAcknowledgementTimeoutMs)
    timer.unref()
    this.#channelAcknowledgementTimers.set(key, timer)
  }

  #clearChannelAcknowledgementTimer(
    channel: RelayEphemeralChannel<ActiveConnection>,
    senderRole: 'controller' | 'node',
  ): void {
    const key = channelAcknowledgementKey(channel.channelId, senderRole)
    const timer = this.#channelAcknowledgementTimers.get(key)
    if (timer !== undefined) clearTimeout(timer)
    this.#channelAcknowledgementTimers.delete(key)
  }

  #removeChannel(channel: RelayEphemeralChannel<ActiveConnection>): boolean {
    if (!this.#channels.remove(channel)) return false
    this.#clearChannelOpenTimer(channel.channelId)
    this.#clearChannelAcknowledgementTimer(channel, 'controller')
    this.#clearChannelAcknowledgementTimer(channel, 'node')
    this.#rememberClosedChannel(channel)
    return true
  }

  #rememberClosedChannel(
    channel: RelayEphemeralChannel<ActiveConnection>,
  ): void {
    const previous = this.#closedChannelTombstones.get(channel.channelId)
    if (previous !== undefined) clearTimeout(previous.timer)
    this.#closedChannelTombstones.delete(channel.channelId)
    while (
      this.#closedChannelTombstones.size >= this.#options.maximumChannels
    ) {
      const oldestId = this.#closedChannelTombstones.keys().next().value as
        RelayChannelId | undefined
      if (oldestId === undefined) break
      const oldest = this.#closedChannelTombstones.get(oldestId)
      if (oldest !== undefined) clearTimeout(oldest.timer)
      this.#closedChannelTombstones.delete(oldestId)
    }
    const timer = setTimeout(() => {
      if (
        this.#closedChannelTombstones.get(channel.channelId)?.timer === timer
      ) {
        this.#closedChannelTombstones.delete(channel.channelId)
      }
    }, this.#options.channelAcknowledgementTimeoutMs)
    timer.unref()
    this.#closedChannelTombstones.set(channel.channelId, {
      channel,
      timer,
      exactLateFrames: 0,
    })
  }

  #clearClosedChannelTombstones(): void {
    for (const tombstone of this.#closedChannelTombstones.values()) {
      clearTimeout(tombstone.timer)
    }
    this.#closedChannelTombstones.clear()
  }

  async #closeChannelsForConnection(
    connection: ActiveConnection,
    reason: RelayChannelClosedReason,
  ): Promise<void> {
    await Promise.all(
      this.#channels
        .channelsForConnection(connection)
        .map((channel) => this.#closeChannel(channel, reason)),
    )
  }

  async #closeUnauthorizedChannelsForNode(
    node: ActiveConnection,
  ): Promise<void> {
    await Promise.all(
      this.#channels
        .channelsForConnection(node)
        .filter(
          (channel) =>
            !this.#store.canControllerObserveNode(
              channel.controller.peer.fingerprint,
              node.peer.fingerprint,
            ),
        )
        .map((channel) => this.#closeChannel(channel, 'authorization_revoked')),
    )
  }

  async #closeAllChannels(reason: RelayChannelClosedReason): Promise<void> {
    await Promise.all(
      this.#channels
        .values()
        .map((channel) => this.#closeChannel(channel, reason)),
    )
  }

  async #heartbeat(connection: ActiveConnection): Promise<void> {
    if (!this.#registry.owns(connection) || connection.invalidated) return
    const currentPeer = this.#store.getPeerById(connection.peer.peerId)
    if (currentPeer?.revokedAt !== undefined || currentPeer === undefined) {
      connection.invalidate('revoked')
      return
    }
    const now = this.#monotonicNow()
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
        sentAt: new Date().toISOString(),
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

  #observeFramingQueue(
    connection: FramedRelayConnection,
    next: RelayFramingQueueMetrics,
  ): void {
    const previous = this.#framingQueues.get(connection)
    if (previous === undefined) return
    this.#framingQueues.set(connection, next)
    this.#framingQueueTotals.queuedInboundFrames +=
      next.queuedInboundFrames - previous.queuedInboundFrames
    this.#framingQueueTotals.queuedInboundBytes +=
      next.queuedInboundBytes - previous.queuedInboundBytes
    this.#framingQueueTotals.pendingOutboundFrames +=
      next.pendingOutboundFrames - previous.pendingOutboundFrames
    this.#framingQueueTotals.pendingOutboundBytes +=
      next.pendingOutboundBytes - previous.pendingOutboundBytes
    this.#observeFramingQueueHighWater()
  }

  #removeFramingQueue(connection: FramedRelayConnection): void {
    const previous = this.#framingQueues.get(connection)
    if (previous === undefined) return
    this.#framingQueues.delete(connection)
    this.#framingQueueTotals.queuedInboundFrames -= previous.queuedInboundFrames
    this.#framingQueueTotals.queuedInboundBytes -= previous.queuedInboundBytes
    this.#framingQueueTotals.pendingOutboundFrames -=
      previous.pendingOutboundFrames
    this.#framingQueueTotals.pendingOutboundBytes -=
      previous.pendingOutboundBytes
  }

  #observeFramingQueueHighWater(): void {
    const frames =
      this.#framingQueueTotals.queuedInboundFrames +
      this.#framingQueueTotals.pendingOutboundFrames
    const bytes =
      this.#framingQueueTotals.queuedInboundBytes +
      this.#framingQueueTotals.pendingOutboundBytes
    this.#framedQueueFramesHighWaterMark = Math.max(
      this.#framedQueueFramesHighWaterMark,
      frames,
    )
    this.#framedQueueBytesHighWaterMark = Math.max(
      this.#framedQueueBytesHighWaterMark,
      bytes,
    )
  }

  #observePendingChannelData(): void {
    this.#pendingChannelDataFramesHighWaterMark = Math.max(
      this.#pendingChannelDataFramesHighWaterMark,
      this.#channels.outstandingDataFrames,
    )
    this.#pendingChannelDataBytesHighWaterMark = Math.max(
      this.#pendingChannelDataBytesHighWaterMark,
      this.#channels.outstandingDataBytes,
    )
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

function channelAcknowledgementKey(
  channelId: RelayChannelId,
  senderRole: 'controller' | 'node',
): string {
  return `${channelId}:${senderRole}`
}

function decodedBase64UrlBytes(value: string): number {
  return Math.floor((value.length * 3) / 4)
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
  readonly maximumChannels: number
  readonly maximumChannelsPerPeer: number
  readonly maximumChannelOpenAttemptsPerMinute: number
  readonly channelOpenTimeoutMs: number
  readonly channelAcknowledgementTimeoutMs: number
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
    options.challengeLifetimeMs > relayProtocolLimits.challengeLifetimeMs ||
    !Number.isSafeInteger(options.maximumChannels) ||
    options.maximumChannels <= 0 ||
    options.maximumChannels > relayProtocolLimits.maximumChannels ||
    !Number.isSafeInteger(options.maximumChannelsPerPeer) ||
    options.maximumChannelsPerPeer <= 0 ||
    options.maximumChannelsPerPeer > options.maximumChannels ||
    options.maximumChannelsPerPeer >
      relayProtocolLimits.maximumChannelsPerPeer ||
    !Number.isSafeInteger(options.maximumChannelOpenAttemptsPerMinute) ||
    options.maximumChannelOpenAttemptsPerMinute <= 0 ||
    options.maximumChannelOpenAttemptsPerMinute >
      relayProtocolLimits.maximumChannelOpenAttemptsPerMinute ||
    !Number.isSafeInteger(options.channelOpenTimeoutMs) ||
    options.channelOpenTimeoutMs <= 0 ||
    options.channelOpenTimeoutMs > relayProtocolLimits.channelOpenTimeoutMs ||
    !Number.isSafeInteger(options.channelAcknowledgementTimeoutMs) ||
    options.channelAcknowledgementTimeoutMs <= 0 ||
    options.channelAcknowledgementTimeoutMs >
      relayProtocolLimits.channelAcknowledgementTimeoutMs
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
