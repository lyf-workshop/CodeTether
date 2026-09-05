import {
  FramedRelayConnection,
  RelayChallengeMessageSchema,
  RelayClientBuildIdentitySchema,
  RelayClientMessageSchema,
  RelayEnrollmentTokenSchema,
  RelayIdSchema,
  RelayPublicKeyFingerprintSchema,
  RelayPublicKeySpkiSchema,
  RelayServerMessageSchema,
  fingerprintRelayPublicKeySpki,
  newRelayRequestId,
  relayAuthenticationTranscript,
  relayChallengeTranscript,
  relayEnrollmentTranscript,
  relayProtocolLimits,
  relayProtocolVersion,
  signRelayTranscript,
  verifyRelayTranscript,
  type RelayChallengeMessage,
  type RelayClientMessage,
  type RelayChannelGeneration,
  type RelayChannelId,
  type RelayChannelOfferMessage,
  type RelayChannelRejectReason,
  type RelayConnectionEpoch,
  type RelayId,
  type RelayPeerId,
  type RelayPeerRole,
  type RelayPresenceState,
  type RelayPublicKeyFingerprint,
  type RelayPublicKeySpki,
  type RelayRequestId,
  type RelayServerMessage,
} from '@codetether/relay-protocol'
import type { Duplex } from 'node:stream'
import { z } from 'zod'

import {
  RelayClientError,
  relayConnectionError,
  relayServerError,
} from './errors.js'
import {
  connectRelayTls,
  type RelayClientEndpoint,
  type RelayClientTlsPolicy,
} from './tls.js'
import {
  RelayMachineChannelDuplex,
  type RelayMachineChannelBinding,
} from './machine-channel.js'

const MAXIMUM_CHALLENGE_CLOCK_SKEW_MS = 60_000
const RelayProtocolVersionProbeSchema = z
  .object({ protocolVersion: z.number().int().safe() })
  .passthrough()
const UnknownRelayMessageSchema = z.unknown()

export interface RelayClientIdentity {
  readonly role: RelayPeerRole
  readonly privateKeyPem: string
  readonly publicKeySpki: RelayPublicKeySpki | string
  readonly publicKeyFingerprint: RelayPublicKeyFingerprint | string
}

export interface RelayClientRegistration {
  readonly relayId: RelayId
  readonly relayIdentityFingerprint: RelayPublicKeyFingerprint
  readonly peerId: RelayPeerId
  readonly authenticatedAt: string
}

export interface ConnectRelayControlOptions {
  readonly endpoint: RelayClientEndpoint
  readonly tls: RelayClientTlsPolicy
  readonly expectedRelayIdentityFingerprint: RelayPublicKeyFingerprint | string
  readonly expectedRelayId?: RelayId | string
  readonly identity: RelayClientIdentity
  readonly clientBuildIdentity: string
  /** Present only for an explicit one-time enrollment attempt. */
  readonly enrollmentToken?: string
  /** Only a Node may publish the fingerprint already trusted by Machine pairing. */
  readonly authorizedControllerFingerprint?: string
  readonly signal?: AbortSignal
  readonly now?: () => Date
}

export interface RelayRendezvousObservation {
  readonly targetNodeFingerprint: RelayPublicKeyFingerprint
  readonly state: RelayPresenceState
  readonly observedAt: string
}

export interface RelayIncomingMachineChannelOffer {
  readonly controllerFingerprint: RelayPublicKeyFingerprint
  readonly controllerConnectionEpoch: RelayConnectionEpoch
  readonly nodeConnectionEpoch: RelayConnectionEpoch
  accept(): Promise<Duplex>
  reject(reason?: RelayChannelRejectReason): Promise<void>
}

export type RelayMachineChannelHandler = (
  offer: RelayIncomingMachineChannelOffer,
) => void | Promise<void>

type RelayMachineChannelDataPlaneMessage = Extract<
  RelayClientMessage,
  { readonly type: 'channel.data' | 'channel.data.ack' | 'channel.close' }
>

export interface ConnectedRelayControl {
  readonly connection: RelayControlConnection
  readonly registration: RelayClientRegistration
  readonly enrolled: boolean
}

export async function connectRelayControl(
  options: ConnectRelayControlOptions,
): Promise<ConnectedRelayControl> {
  const identity = validateClientIdentity(options.identity)
  const clientBuildIdentity = RelayClientBuildIdentitySchema.parse(
    options.clientBuildIdentity,
  )
  const expectedFingerprint = RelayPublicKeyFingerprintSchema.parse(
    options.expectedRelayIdentityFingerprint,
  )
  const enrollmentToken = (() => {
    if (options.enrollmentToken === undefined) return undefined
    const parsed = RelayEnrollmentTokenSchema.safeParse(options.enrollmentToken)
    if (!parsed.success) {
      throw new RelayClientError(
        'relay_enrollment_required',
        'Internet Relay enrollment token is invalid',
      )
    }
    return parsed.data
  })()
  const expectedRelayId =
    options.expectedRelayId === undefined
      ? undefined
      : RelayIdSchema.parse(options.expectedRelayId)
  if (
    options.authorizedControllerFingerprint !== undefined &&
    identity.role !== 'node'
  ) {
    throw new TypeError('Only a Relay Node may publish Machine trust')
  }
  const authorizedControllerFingerprint =
    options.authorizedControllerFingerprint === undefined
      ? undefined
      : RelayPublicKeyFingerprintSchema.parse(
          options.authorizedControllerFingerprint,
        )

  const socket = await connectRelayTls({
    endpoint: options.endpoint,
    tls: options.tls,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  const framed = new FramedRelayConnection(socket)
  try {
    const first = await receiveServerMessage(framed, {
      timeoutMs: relayProtocolLimits.authenticationTimeoutMs,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    if (first.type === 'relay.error') throw relayServerError(first)
    const parsedChallenge = RelayChallengeMessageSchema.safeParse(first)
    if (!parsedChallenge.success) {
      throw new RelayClientError(
        'relay_protocol_error',
        'Internet Relay did not begin a valid authentication challenge',
      )
    }
    const challenge = parsedChallenge.data
    assertRelayChallenge(
      challenge,
      expectedFingerprint,
      expectedRelayId,
      options.now?.() ?? new Date(),
    )

    if (enrollmentToken === undefined) {
      await sendClientMessage(
        framed,
        {
          type: 'peer.authenticate',
          protocolVersion: relayProtocolVersion,
          peerFingerprint: identity.publicKeyFingerprint,
          role: identity.role,
          clientBuildIdentity,
          signature: signRelayTranscript(
            identity.privateKeyPem,
            relayAuthenticationTranscript({
              challenge,
              peerFingerprint: identity.publicKeyFingerprint,
              role: identity.role,
              clientBuildIdentity,
            }),
          ),
        },
        options.signal,
      )
    } else {
      await sendClientMessage(
        framed,
        {
          type: 'peer.enroll',
          protocolVersion: relayProtocolVersion,
          role: identity.role,
          enrollmentToken,
          peerPublicKeySpki: identity.publicKeySpki,
          peerFingerprint: identity.publicKeyFingerprint,
          clientBuildIdentity,
          signature: signRelayTranscript(
            identity.privateKeyPem,
            relayEnrollmentTranscript({
              challenge,
              role: identity.role,
              enrollmentToken,
              peerPublicKeySpki: identity.publicKeySpki,
              peerFingerprint: identity.publicKeyFingerprint,
              clientBuildIdentity,
              ...(authorizedControllerFingerprint === undefined
                ? {}
                : { authorizedControllerFingerprint }),
            }),
          ),
          ...(identity.role === 'node' &&
          authorizedControllerFingerprint !== undefined
            ? { authorizedControllerFingerprint }
            : {}),
        },
        options.signal,
      )
    }

    const response = await receiveServerMessage(framed, {
      timeoutMs: relayProtocolLimits.authenticationTimeoutMs,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    if (response.type === 'relay.error') throw relayServerError(response)
    if (response.type !== 'peer.ready' || response.role !== identity.role) {
      throw new RelayClientError(
        'relay_protocol_error',
        'Internet Relay returned an invalid authentication result',
      )
    }
    const connection = new RelayControlConnection(framed, response)
    return {
      connection,
      registration: {
        relayId: challenge.relayId,
        relayIdentityFingerprint: challenge.relayFingerprint,
        peerId: response.peerId,
        authenticatedAt: response.authenticatedAt,
      },
      enrolled: enrollmentToken !== undefined,
    }
  } catch (error) {
    framed.destroy()
    if (error instanceof RelayClientError) throw error
    throw relayConnectionError(error)
  }
}

export class RelayControlConnection {
  readonly peerId: RelayPeerId
  readonly role: RelayPeerRole
  readonly connectionEpoch: RelayConnectionEpoch
  readonly heartbeatIntervalMs: number
  readonly heartbeatTimeoutMs: number
  readonly #framed: FramedRelayConnection
  readonly #grantRequests = new Map<
    RelayRequestId,
    {
      readonly resolve: () => void
      readonly reject: (error: Error) => void
      readonly timer: ReturnType<typeof setTimeout>
    }
  >()
  readonly #rendezvousSubscriptions = new Map<
    RelayRequestId,
    {
      readonly targetNodeFingerprint: RelayPublicKeyFingerprint
      readonly listener: (observation: RelayRendezvousObservation) => void
    }
  >()
  readonly #rendezvousTargets = new Map<
    RelayPublicKeyFingerprint,
    RelayRequestId
  >()
  readonly #machineChannelOpens = new Map<
    RelayRequestId,
    {
      readonly targetNodeFingerprint: RelayPublicKeyFingerprint
      readonly resolve: (channel: Duplex) => void
      readonly reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
      readonly removeAbortListener: () => void
      cancelled: boolean
    }
  >()
  readonly #machineChannels = new Map<
    RelayChannelId,
    {
      readonly requestId: RelayRequestId
      readonly channel: RelayMachineChannelDuplex
      readonly nodeOpening?: {
        readonly promise: Promise<void>
        readonly resolve: () => void
        readonly reject: (error: Error) => void
        readonly timer: ReturnType<typeof setTimeout>
      }
      /** Bounded grace for exact late frames after a terminal channel outcome. */
      releaseTimer?: ReturnType<typeof setTimeout>
      terminalFrames?: number
    }
  >()
  readonly #incomingMachineOffers = new Map<
    RelayChannelId,
    {
      readonly message: RelayChannelOfferMessage
      readonly timer: ReturnType<typeof setTimeout>
      decided: boolean
    }
  >()
  readonly #machineChannelSendQueue: Array<{
    readonly message: RelayMachineChannelDataPlaneMessage
    readonly resolve: () => void
    readonly reject: (error: Error) => void
  }> = []
  readonly #completion: Promise<void>
  #machineChannelHandler: RelayMachineChannelHandler | undefined
  #machineChannelSendActive = false
  #failure: RelayClientError | undefined
  #closing = false

  constructor(
    framed: FramedRelayConnection,
    ready: {
      readonly peerId: RelayPeerId
      readonly role: RelayPeerRole
      readonly connectionEpoch: RelayConnectionEpoch
      readonly heartbeatIntervalMs: number
      readonly heartbeatTimeoutMs: number
    },
  ) {
    this.#framed = framed
    this.peerId = ready.peerId
    this.role = ready.role
    this.connectionEpoch = ready.connectionEpoch
    this.heartbeatIntervalMs = ready.heartbeatIntervalMs
    this.heartbeatTimeoutMs = ready.heartbeatTimeoutMs
    this.#completion = this.#run()
  }

  async replaceAuthorizedController(
    fingerprint?: RelayPublicKeyFingerprint | string,
  ): Promise<void> {
    if (this.role !== 'node') {
      throw new RelayClientError(
        'relay_protocol_error',
        'Only a Relay Node may replace its rendezvous grant',
      )
    }
    this.#assertOpen()
    if (
      this.#grantRequests.size >= relayProtocolLimits.maximumPendingRequests
    ) {
      throw new RelayClientError(
        'relay_capacity_reached',
        'Internet Relay request capacity was reached',
      )
    }
    const parsedFingerprint =
      fingerprint === undefined
        ? undefined
        : RelayPublicKeyFingerprintSchema.parse(fingerprint)
    const requestId = newRelayRequestId()
    const result = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#grantRequests.delete(requestId)
        reject(
          new RelayClientError(
            'relay_unreachable',
            'Internet Relay grant update timed out',
          ),
        )
      }, relayProtocolLimits.messageTimeoutMs)
      this.#grantRequests.set(requestId, { resolve, reject, timer })
    })
    void result.catch(() => undefined)
    try {
      await sendClientMessage(this.#framed, {
        type: 'grant.replace',
        protocolVersion: relayProtocolVersion,
        connectionEpoch: this.connectionEpoch,
        requestId,
        ...(parsedFingerprint === undefined
          ? {}
          : { authorizedControllerFingerprint: parsedFingerprint }),
      })
      await result
    } catch (error) {
      const pending = this.#grantRequests.get(requestId)
      if (pending !== undefined) {
        clearTimeout(pending.timer)
        this.#grantRequests.delete(requestId)
      }
      throw error
    }
  }

  async subscribeToNode(
    targetNodeFingerprint: RelayPublicKeyFingerprint | string,
    listener: (observation: RelayRendezvousObservation) => void,
  ): Promise<() => Promise<void>> {
    if (this.role !== 'controller') {
      throw new RelayClientError(
        'relay_protocol_error',
        'Only a Relay Controller may observe Node presence',
      )
    }
    this.#assertOpen()
    const fingerprint = RelayPublicKeyFingerprintSchema.parse(
      targetNodeFingerprint,
    )
    if (this.#rendezvousTargets.has(fingerprint)) {
      throw new RelayClientError(
        'relay_protocol_error',
        'Internet Relay Node presence is already subscribed',
      )
    }
    if (
      this.#rendezvousSubscriptions.size >=
      relayProtocolLimits.maximumSubscriptionsPerController
    ) {
      throw new RelayClientError(
        'relay_capacity_reached',
        'Internet Relay subscription capacity was reached',
      )
    }
    const requestId = newRelayRequestId()
    this.#rendezvousSubscriptions.set(requestId, {
      targetNodeFingerprint: fingerprint,
      listener,
    })
    this.#rendezvousTargets.set(fingerprint, requestId)
    try {
      await sendClientMessage(this.#framed, {
        type: 'rendezvous.subscribe',
        protocolVersion: relayProtocolVersion,
        connectionEpoch: this.connectionEpoch,
        requestId,
        targetNodeFingerprint: fingerprint,
      })
    } catch (error) {
      this.#rendezvousSubscriptions.delete(requestId)
      if (this.#rendezvousTargets.get(fingerprint) === requestId) {
        this.#rendezvousTargets.delete(fingerprint)
      }
      throw error
    }
    let removed = false
    return async () => {
      if (removed) return
      removed = true
      this.#rendezvousSubscriptions.delete(requestId)
      if (this.#rendezvousTargets.get(fingerprint) === requestId) {
        this.#rendezvousTargets.delete(fingerprint)
      }
      if (this.#closing || this.#failure !== undefined) return
      await sendClientMessage(this.#framed, {
        type: 'rendezvous.unsubscribe',
        protocolVersion: relayProtocolVersion,
        connectionEpoch: this.connectionEpoch,
        requestId,
        targetNodeFingerprint: fingerprint,
      })
    }
  }

  async openMachineChannel(
    targetNodeFingerprint: RelayPublicKeyFingerprint | string,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<Duplex> {
    if (this.role !== 'controller') {
      throw new RelayClientError(
        'relay_protocol_error',
        'Only a Relay Controller may open a Machine channel',
      )
    }
    this.#assertOpen()
    if (
      this.#machineChannels.size + this.#machineChannelOpens.size >=
      relayProtocolLimits.maximumChannelsPerPeer
    ) {
      throw new RelayClientError(
        'relay_transport_capacity_reached',
        'Internet Relay Machine channel capacity was reached',
      )
    }
    const fingerprint = RelayPublicKeyFingerprintSchema.parse(
      targetNodeFingerprint,
    )
    if (options.signal?.aborted === true) {
      throw new RelayClientError(
        'relay_channel_open_failed',
        'Internet Relay Machine channel opening was cancelled',
      )
    }
    const requestId = newRelayRequestId()
    let abort = () => undefined
    const result = new Promise<Duplex>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.#machineChannelOpens.get(requestId)
        if (pending === undefined) return
        pending.removeAbortListener()
        if (pending.cancelled) {
          this.#machineChannelOpens.delete(requestId)
          return
        }
        pending.cancelled = true
        pending.reject(
          new RelayClientError(
            'relay_channel_open_failed',
            'Internet Relay Machine channel opening timed out',
          ),
        )
        pending.timer = setTimeout(() => {
          if (this.#machineChannelOpens.get(requestId) === pending) {
            this.#machineChannelOpens.delete(requestId)
          }
        }, relayProtocolLimits.channelOpenTimeoutMs)
        pending.timer.unref()
      }, relayProtocolLimits.channelOpenTimeoutMs)
      abort = () => {
        const pending = this.#machineChannelOpens.get(requestId)
        if (pending === undefined || pending.cancelled) return
        pending.cancelled = true
        pending.reject(
          new RelayClientError(
            'relay_channel_open_failed',
            'Internet Relay Machine channel opening was cancelled',
          ),
        )
      }
      options.signal?.addEventListener('abort', abort, { once: true })
      this.#machineChannelOpens.set(requestId, {
        targetNodeFingerprint: fingerprint,
        resolve,
        reject,
        timer,
        removeAbortListener: () =>
          options.signal?.removeEventListener('abort', abort),
        cancelled: false,
      })
    })
    void result.catch(() => undefined)
    try {
      await sendClientMessage(this.#framed, {
        type: 'channel.open',
        protocolVersion: relayProtocolVersion,
        connectionEpoch: this.connectionEpoch,
        requestId,
        targetNodeFingerprint: fingerprint,
        purpose: 'machine_tls_v1',
      })
      return await result
    } catch (error) {
      const pending = this.#machineChannelOpens.get(requestId)
      if (pending?.cancelled === true) throw machineChannelOpenError(error)
      if (pending !== undefined) {
        clearTimeout(pending.timer)
        pending.removeAbortListener()
        this.#machineChannelOpens.delete(requestId)
        if (!pending.cancelled) pending.reject(machineChannelOpenError(error))
      }
      throw machineChannelOpenError(error)
    }
  }

  setMachineChannelHandler(handler: RelayMachineChannelHandler): () => void {
    if (this.role !== 'node') {
      throw new RelayClientError(
        'relay_protocol_error',
        'Only a Relay Node may receive Machine channels',
      )
    }
    this.#assertOpen()
    if (this.#machineChannelHandler !== undefined) {
      throw new RelayClientError(
        'relay_protocol_error',
        'Internet Relay Machine channel handler is already installed',
      )
    }
    this.#machineChannelHandler = handler
    let removed = false
    return () => {
      if (removed) return
      removed = true
      if (this.#machineChannelHandler === handler) {
        this.#machineChannelHandler = undefined
      }
    }
  }

  async waitUntilClosed(): Promise<void> {
    await this.#completion
    if (this.#failure !== undefined) throw this.#failure
  }

  async close(): Promise<void> {
    if (this.#closing) {
      await this.#completion
      return
    }
    this.#closing = true
    await sendClientMessage(this.#framed, {
      type: 'peer.goodbye',
      protocolVersion: relayProtocolVersion,
      connectionEpoch: this.connectionEpoch,
    }).catch(() => undefined)
    this.#framed.destroy()
    await this.#completion
  }

  async #run(): Promise<void> {
    try {
      while (!this.#closing && !this.#framed.closed) {
        const message = await receiveServerMessage(this.#framed, {
          timeoutMs: this.heartbeatTimeoutMs,
        })
        if (message.type === 'relay.error') throw relayServerError(message)
        if (
          message.type === 'relay.challenge' ||
          message.connectionEpoch !== this.connectionEpoch
        ) {
          throw new RelayClientError(
            'relay_protocol_error',
            'Internet Relay sent a stale or invalid connection epoch',
          )
        }
        if (message.type === 'heartbeat.ping') {
          await sendClientMessage(this.#framed, {
            type: 'heartbeat.pong',
            protocolVersion: relayProtocolVersion,
            connectionEpoch: this.connectionEpoch,
            pingId: message.pingId,
          })
          continue
        }
        if (message.type === 'grant.replaced') {
          const pending = this.#grantRequests.get(message.requestId)
          if (pending === undefined) {
            throw new RelayClientError(
              'relay_protocol_error',
              'Internet Relay returned an unknown grant request',
            )
          }
          clearTimeout(pending.timer)
          this.#grantRequests.delete(message.requestId)
          pending.resolve()
          continue
        }
        if (message.type === 'rendezvous.status') {
          const subscription = this.#rendezvousSubscriptions.get(
            message.requestId,
          )
          if (
            subscription === undefined ||
            subscription.targetNodeFingerprint !== message.targetNodeFingerprint
          ) {
            throw new RelayClientError(
              'relay_protocol_error',
              'Internet Relay returned an unknown rendezvous request',
            )
          }
          try {
            subscription.listener({
              targetNodeFingerprint: message.targetNodeFingerprint,
              state: message.state,
              observedAt: message.observedAt,
            })
          } catch {
            // Presentation consumers cannot mutate connection ownership.
          }
          continue
        }
        if (message.type === 'channel.offer') {
          this.#receiveMachineChannelOffer(message)
          continue
        }
        if (message.type === 'channel.opened') {
          this.#receiveMachineChannelOpened(message)
          continue
        }
        if (message.type === 'channel.reject') {
          this.#receiveMachineChannelRejected(message)
          continue
        }
        if (message.type === 'channel.data') {
          const channel = this.#boundMachineChannel(message)
          channel.receiveData(message.sequence, message.data)
          continue
        }
        if (message.type === 'channel.data.ack') {
          const channel = this.#boundMachineChannel(message)
          channel.receiveAcknowledgement(message.acknowledgedSequence)
          continue
        }
        if (message.type === 'channel.closed') {
          const entry = this.#machineChannels.get(message.channelId)
          if (entry !== undefined) {
            this.#assertMachineChannelBinding(entry.channel, message)
            if (entry.requestId !== message.requestId) {
              throw machineChannelProtocolError(
                'Internet Relay returned a wrong Machine channel request',
              )
            }
            this.#rejectNodeMachineChannelOpening(
              entry,
              machineChannelClosedWhileOpening(message.reason),
            )
            entry.channel.receiveClosed(message.reason)
            continue
          }
          const offer = this.#incomingMachineOffers.get(message.channelId)
          if (offer !== undefined) {
            if (
              offer.message.requestId !== message.requestId ||
              !sameMachineChannelBinding(offer.message, message)
            ) {
              throw machineChannelProtocolError(
                'Internet Relay returned a stale Machine channel closing',
              )
            }
            clearTimeout(offer.timer)
            offer.decided = true
            this.#incomingMachineOffers.delete(message.channelId)
            continue
          }
          const pending = this.#machineChannelOpens.get(message.requestId)
          if (pending !== undefined) {
            clearTimeout(pending.timer)
            pending.removeAbortListener()
            this.#machineChannelOpens.delete(message.requestId)
            if (!pending.cancelled) {
              pending.reject(machineChannelClosedWhileOpening(message.reason))
            }
          }
          continue
        }
        if (message.type === 'channel.error') {
          if (!('channelId' in message)) {
            this.#receiveMachineChannelOpenError(
              message.requestId,
              message.code,
            )
            continue
          }
          const entry = this.#machineChannels.get(message.channelId)
          if (entry === undefined) continue
          this.#assertMachineChannelBinding(entry.channel, message)
          if (entry.requestId !== message.requestId) {
            throw machineChannelProtocolError(
              'Internet Relay returned a wrong Machine channel request',
            )
          }
          this.#rejectNodeMachineChannelOpening(
            entry,
            machineChannelBoundCodeError(message.code),
          )
          entry.channel.receiveError(message.code)
          continue
        }
        throw new RelayClientError(
          'relay_protocol_error',
          'Internet Relay sent an invalid control message',
        )
      }
    } catch (error) {
      if (!this.#closing) this.#failure = relayConnectionError(error)
    } finally {
      this.#closing = true
      this.#framed.destroy()
      const failure =
        this.#failure ??
        new RelayClientError('relay_closed', 'Internet Relay connection closed')
      for (const pending of this.#grantRequests.values()) {
        clearTimeout(pending.timer)
        pending.reject(failure)
      }
      this.#grantRequests.clear()
      this.#rendezvousSubscriptions.clear()
      this.#rendezvousTargets.clear()
      for (const pending of this.#machineChannelOpens.values()) {
        clearTimeout(pending.timer)
        pending.removeAbortListener()
        if (!pending.cancelled) pending.reject(machineChannelOpenError(failure))
      }
      this.#machineChannelOpens.clear()
      for (const offer of this.#incomingMachineOffers.values()) {
        clearTimeout(offer.timer)
        offer.decided = true
      }
      this.#incomingMachineOffers.clear()
      for (const entry of [...this.#machineChannels.values()]) {
        this.#rejectNodeMachineChannelOpening(
          entry,
          machineChannelOpenError(failure),
        )
        const { channel } = entry
        channel.connectionLost(failure)
        if (entry.releaseTimer !== undefined) clearTimeout(entry.releaseTimer)
      }
      this.#machineChannels.clear()
      this.#rejectMachineChannelSendQueue(failure)
      this.#machineChannelHandler = undefined
    }
  }

  #receiveMachineChannelOffer(message: RelayChannelOfferMessage): void {
    if (
      this.role !== 'node' ||
      message.nodeConnectionEpoch !== this.connectionEpoch ||
      this.#incomingMachineOffers.has(message.channelId) ||
      this.#machineChannels.has(message.channelId)
    ) {
      throw machineChannelProtocolError(
        'Internet Relay returned an invalid Machine channel offer',
      )
    }
    const handler = this.#machineChannelHandler
    if (
      handler === undefined ||
      this.#machineChannels.size + this.#incomingMachineOffers.size >=
        relayProtocolLimits.maximumChannelsPerPeer
    ) {
      void this.#sendMachineChannelRejection(
        message,
        handler === undefined ? 'not_available' : 'capacity_reached',
      )
      return
    }
    const state = {
      message,
      decided: false,
      timer: setTimeout(() => {
        void this.#rejectMachineChannelOffer(message, 'not_available')
      }, relayProtocolLimits.channelOpenTimeoutMs),
    }
    this.#incomingMachineOffers.set(message.channelId, state)
    const offer: RelayIncomingMachineChannelOffer = {
      controllerFingerprint: message.controllerFingerprint,
      controllerConnectionEpoch: message.controllerConnectionEpoch,
      nodeConnectionEpoch: message.nodeConnectionEpoch,
      accept: async () => await this.#acceptMachineChannelOffer(message),
      reject: async (reason = 'not_available') =>
        await this.#rejectMachineChannelOffer(message, reason),
    }
    void Promise.resolve()
      .then(async () => await handler(offer))
      .catch(() => undefined)
      .finally(() => {
        const current = this.#incomingMachineOffers.get(message.channelId)
        if (current !== undefined && !current.decided) {
          void this.#rejectMachineChannelOffer(message, 'not_available')
        }
      })
  }

  async #acceptMachineChannelOffer(
    message: RelayChannelOfferMessage,
  ): Promise<Duplex> {
    this.#assertOpen()
    const state = this.#incomingMachineOffers.get(message.channelId)
    if (state === undefined || state.message !== message || state.decided) {
      throw machineChannelProtocolError(
        'Internet Relay Machine channel offer was already decided',
      )
    }
    state.decided = true
    clearTimeout(state.timer)
    this.#incomingMachineOffers.delete(message.channelId)
    let resolveOpened: () => void = () => undefined
    let rejectOpened: (error: Error) => void = () => undefined
    const opened = new Promise<void>((resolve, reject) => {
      resolveOpened = resolve
      rejectOpened = reject
    })
    void opened.catch(() => undefined)
    const nodeOpening = {
      promise: opened,
      resolve: resolveOpened,
      reject: rejectOpened,
      timer: setTimeout(() => {
        const entry = this.#machineChannels.get(message.channelId)
        if (entry?.nodeOpening !== nodeOpening) return
        const failure = new RelayClientError(
          'relay_channel_open_failed',
          'Internet Relay Machine channel acceptance timed out',
        )
        this.#rejectNodeMachineChannelOpening(entry, failure)
        entry.channel.destroy(failure)
      }, relayProtocolLimits.channelOpenTimeoutMs),
    }
    nodeOpening.timer.unref()
    const channel = this.#createMachineChannel(
      message.requestId,
      message,
      nodeOpening,
    )
    try {
      await sendClientMessage(this.#framed, {
        type: 'channel.accept',
        protocolVersion: relayProtocolVersion,
        connectionEpoch: this.connectionEpoch,
        requestId: message.requestId,
        ...machineChannelBinding(message),
      })
      await opened
      return channel
    } catch (error) {
      const entry = this.#machineChannels.get(message.channelId)
      if (entry !== undefined) {
        this.#rejectNodeMachineChannelOpening(
          entry,
          machineChannelOpenError(error),
        )
      }
      channel.connectionLost(machineChannelOpenError(error))
      throw machineChannelOpenError(error)
    }
  }

  async #rejectMachineChannelOffer(
    message: RelayChannelOfferMessage,
    reason: RelayChannelRejectReason,
  ): Promise<void> {
    const state = this.#incomingMachineOffers.get(message.channelId)
    if (state === undefined || state.message !== message || state.decided) {
      throw machineChannelProtocolError(
        'Internet Relay Machine channel offer was already decided',
      )
    }
    state.decided = true
    clearTimeout(state.timer)
    this.#incomingMachineOffers.delete(message.channelId)
    await this.#sendMachineChannelRejection(message, reason)
  }

  async #sendMachineChannelRejection(
    message: RelayChannelOfferMessage,
    reason: RelayChannelRejectReason,
  ): Promise<void> {
    if (this.#closing || this.#failure !== undefined) return
    await sendClientMessage(this.#framed, {
      type: 'channel.reject',
      protocolVersion: relayProtocolVersion,
      connectionEpoch: this.connectionEpoch,
      requestId: message.requestId,
      ...machineChannelBinding(message),
      reason,
    }).catch(() => undefined)
  }

  #receiveMachineChannelOpened(message: {
    readonly requestId: RelayRequestId
    readonly channelId: RelayChannelId
    readonly channelGeneration: RelayChannelGeneration
    readonly controllerConnectionEpoch: RelayConnectionEpoch
    readonly nodeConnectionEpoch: RelayConnectionEpoch
    readonly purpose: 'machine_tls_v1'
  }): void {
    if (this.role === 'node') {
      if (message.nodeConnectionEpoch !== this.connectionEpoch) {
        throw machineChannelProtocolError(
          'Internet Relay returned an invalid Machine channel opening',
        )
      }
      const entry = this.#machineChannels.get(message.channelId)
      if (entry === undefined || entry.requestId !== message.requestId) {
        throw machineChannelProtocolError(
          'Internet Relay returned an unknown Machine channel opening',
        )
      }
      this.#assertMachineChannelBinding(entry.channel, message)
      if (entry.nodeOpening === undefined) {
        throw machineChannelProtocolError(
          'Internet Relay repeated a Machine channel opening',
        )
      }
      clearTimeout(entry.nodeOpening.timer)
      entry.nodeOpening.resolve()
      this.#machineChannels.set(message.channelId, {
        requestId: entry.requestId,
        channel: entry.channel,
      })
      return
    }
    if (message.controllerConnectionEpoch !== this.connectionEpoch) {
      throw machineChannelProtocolError(
        'Internet Relay returned an invalid Machine channel opening',
      )
    }
    const pending = this.#machineChannelOpens.get(message.requestId)
    if (pending === undefined) {
      throw machineChannelProtocolError(
        'Internet Relay returned an unknown Machine channel opening',
      )
    }
    clearTimeout(pending.timer)
    pending.removeAbortListener()
    this.#machineChannelOpens.delete(message.requestId)
    if (pending.cancelled) {
      void sendClientMessage(this.#framed, {
        type: 'channel.close',
        protocolVersion: relayProtocolVersion,
        connectionEpoch: this.connectionEpoch,
        ...machineChannelBinding(message),
        reason: 'cancelled',
      }).catch(() => undefined)
      return
    }
    try {
      const channel = this.#createMachineChannel(message.requestId, message)
      pending.resolve(channel)
    } catch (error) {
      pending.reject(asRelayClientError(error))
      throw error
    }
  }

  #receiveMachineChannelRejected(message: {
    readonly requestId: RelayRequestId
    readonly controllerConnectionEpoch: RelayConnectionEpoch
    readonly reason: RelayChannelRejectReason
  }): void {
    if (
      this.role !== 'controller' ||
      message.controllerConnectionEpoch !== this.connectionEpoch
    ) {
      throw machineChannelProtocolError(
        'Internet Relay returned an invalid Machine channel rejection',
      )
    }
    const pending = this.#machineChannelOpens.get(message.requestId)
    if (pending === undefined) {
      throw machineChannelProtocolError(
        'Internet Relay returned an unknown Machine channel rejection',
      )
    }
    clearTimeout(pending.timer)
    pending.removeAbortListener()
    this.#machineChannelOpens.delete(message.requestId)
    if (!pending.cancelled)
      pending.reject(machineChannelRejection(message.reason))
  }

  #receiveMachineChannelOpenError(
    requestId: RelayRequestId,
    code:
      'capacity_reached' | 'not_authorized' | 'peer_unavailable' | 'internal',
  ): void {
    if (this.role !== 'controller') {
      throw machineChannelProtocolError(
        'Internet Relay returned a Machine channel opening error to a Node',
      )
    }
    const pending = this.#machineChannelOpens.get(requestId)
    if (pending === undefined) {
      throw machineChannelProtocolError(
        'Internet Relay returned an unknown Machine channel opening error',
      )
    }
    clearTimeout(pending.timer)
    pending.removeAbortListener()
    this.#machineChannelOpens.delete(requestId)
    if (!pending.cancelled) pending.reject(machineChannelOpenCodeError(code))
  }

  #createMachineChannel(
    requestId: RelayRequestId,
    binding: RelayMachineChannelBinding,
    nodeOpening?: {
      readonly promise: Promise<void>
      readonly resolve: () => void
      readonly reject: (error: Error) => void
      readonly timer: ReturnType<typeof setTimeout>
    },
  ): RelayMachineChannelDuplex {
    if (
      this.#machineChannels.has(binding.channelId) ||
      this.#machineChannels.size >= relayProtocolLimits.maximumChannelsPerPeer
    ) {
      throw new RelayClientError(
        'relay_transport_capacity_reached',
        'Internet Relay Machine channel capacity was reached',
      )
    }
    const exactBinding = machineChannelBinding(binding)
    const channel = new RelayMachineChannelDuplex(exactBinding, {
      localConnectionEpoch: this.connectionEpoch,
      send: async (message) => await this.#sendMachineChannelMessage(message),
      release: (released) => {
        const current = this.#machineChannels.get(exactBinding.channelId)
        if (
          current?.channel !== released ||
          current.releaseTimer !== undefined
        ) {
          return
        }
        // The Relay socket and Machine stream are independently framed. An
        // exact data/ACK frame already queued by the Relay may arrive after
        // local TLS/session shutdown or a remote terminal outcome. Retain only
        // this exact bounded binding as a terminal tombstone so it is ignored
        // by the terminal Duplex without weakening unknown/stale rejection.
        current.releaseTimer = setTimeout(() => {
          this.#deleteMachineChannel(exactBinding.channelId, released)
        }, relayProtocolLimits.channelAcknowledgementTimeoutMs)
        current.terminalFrames = 0
        current.releaseTimer.unref()
      },
    })
    this.#machineChannels.set(exactBinding.channelId, {
      requestId,
      channel,
      ...(nodeOpening === undefined ? {} : { nodeOpening }),
    })
    return channel
  }

  #deleteMachineChannel(
    channelId: RelayChannelId,
    expected: RelayMachineChannelDuplex,
  ): void {
    const current = this.#machineChannels.get(channelId)
    if (current?.channel !== expected) return
    if (current.releaseTimer !== undefined) clearTimeout(current.releaseTimer)
    this.#machineChannels.delete(channelId)
  }

  #boundMachineChannel(
    binding: RelayMachineChannelBinding,
  ): RelayMachineChannelDuplex {
    const entry = this.#machineChannels.get(binding.channelId)
    if (entry === undefined) {
      throw machineChannelProtocolError(
        'Internet Relay returned an unknown Machine channel',
      )
    }
    this.#assertMachineChannelBinding(entry.channel, binding)
    if (entry.releaseTimer !== undefined) {
      entry.terminalFrames = (entry.terminalFrames ?? 0) + 1
      if (
        entry.terminalFrames > relayProtocolLimits.maximumTerminalChannelFrames
      ) {
        throw machineChannelProtocolError(
          'Internet Relay repeated a terminal Machine channel frame',
        )
      }
    }
    return entry.channel
  }

  #assertMachineChannelBinding(
    channel: RelayMachineChannelDuplex,
    binding: RelayMachineChannelBinding,
  ): void {
    if (!channel.matchesBinding(binding)) {
      throw machineChannelProtocolError(
        'Internet Relay returned a stale Machine channel binding',
      )
    }
  }

  #rejectNodeMachineChannelOpening(
    entry: {
      readonly nodeOpening?: {
        readonly reject: (error: Error) => void
        readonly timer: ReturnType<typeof setTimeout>
      }
    },
    error: Error,
  ): void {
    if (entry.nodeOpening === undefined) return
    clearTimeout(entry.nodeOpening.timer)
    entry.nodeOpening.reject(error)
  }

  async #sendMachineChannelMessage(
    message: RelayMachineChannelDataPlaneMessage,
  ): Promise<void> {
    this.#assertOpen()
    if (
      this.#machineChannelSendQueue.length >=
      relayProtocolLimits.maximumChannelsPerPeer * 2
    ) {
      throw new RelayClientError(
        'relay_transport_capacity_reached',
        'Internet Relay Machine channel send capacity was reached',
      )
    }
    const result = new Promise<void>((resolve, reject) => {
      const pending = { message, resolve, reject }
      if (message.type === 'channel.data') {
        this.#machineChannelSendQueue.push(pending)
      } else {
        const firstData = this.#machineChannelSendQueue.findIndex(
          (queued) => queued.message.type === 'channel.data',
        )
        if (firstData < 0) this.#machineChannelSendQueue.push(pending)
        else this.#machineChannelSendQueue.splice(firstData, 0, pending)
      }
    })
    void result.catch(() => undefined)
    this.#drainMachineChannelSendQueue()
    await result
  }

  #drainMachineChannelSendQueue(): void {
    if (this.#machineChannelSendActive) return
    this.#machineChannelSendActive = true
    void (async () => {
      try {
        while (this.#machineChannelSendQueue.length > 0) {
          const pending = this.#machineChannelSendQueue.shift()
          if (pending === undefined) break
          try {
            await sendClientMessage(this.#framed, pending.message)
            pending.resolve()
          } catch (error) {
            const failure = machineChannelActiveError(error)
            pending.reject(failure)
            this.#rejectMachineChannelSendQueue(failure)
            break
          }
        }
      } finally {
        this.#machineChannelSendActive = false
        if (
          this.#machineChannelSendQueue.length > 0 &&
          !this.#closing &&
          this.#failure === undefined
        ) {
          this.#drainMachineChannelSendQueue()
        }
      }
    })()
  }

  #rejectMachineChannelSendQueue(error: Error): void {
    for (const pending of this.#machineChannelSendQueue.splice(0)) {
      pending.reject(error)
    }
  }

  #assertOpen(): void {
    if (this.#closing || this.#failure !== undefined || this.#framed.closed) {
      throw (
        this.#failure ??
        new RelayClientError('relay_closed', 'Internet Relay connection closed')
      )
    }
  }
}

function machineChannelBinding(
  value: RelayMachineChannelBinding,
): RelayMachineChannelBinding {
  return {
    channelId: value.channelId,
    channelGeneration: value.channelGeneration,
    controllerConnectionEpoch: value.controllerConnectionEpoch,
    nodeConnectionEpoch: value.nodeConnectionEpoch,
  }
}

function sameMachineChannelBinding(
  left: RelayMachineChannelBinding,
  right: RelayMachineChannelBinding,
): boolean {
  return (
    left.channelId === right.channelId &&
    left.channelGeneration === right.channelGeneration &&
    left.controllerConnectionEpoch === right.controllerConnectionEpoch &&
    left.nodeConnectionEpoch === right.nodeConnectionEpoch
  )
}

function machineChannelProtocolError(message: string): RelayClientError {
  return new RelayClientError('relay_protocol_error', message)
}

function machineChannelOpenError(error: unknown): RelayClientError {
  if (
    error instanceof RelayClientError &&
    (error.code === 'relay_transport_capacity_reached' ||
      error.code === 'relay_peer_offline' ||
      error.code === 'relay_protocol_error' ||
      error.code === 'relay_channel_open_failed')
  ) {
    return error
  }
  return new RelayClientError(
    'relay_channel_open_failed',
    'Internet Relay Machine channel could not be opened',
    undefined,
    { cause: error },
  )
}

function machineChannelActiveError(error: unknown): RelayClientError {
  if (
    error instanceof RelayClientError &&
    (error.code === 'relay_channel_lost' ||
      error.code === 'relay_protocol_error' ||
      error.code === 'relay_transport_capacity_reached')
  ) {
    return error
  }
  return new RelayClientError(
    'relay_channel_lost',
    'Internet Relay Machine channel was lost',
    undefined,
    { cause: error },
  )
}

function machineChannelRejection(
  reason: RelayChannelRejectReason,
): RelayClientError {
  switch (reason) {
    case 'busy':
    case 'capacity_reached':
      return new RelayClientError(
        'relay_transport_capacity_reached',
        'Internet Relay Machine channel capacity was reached',
      )
    case 'not_available':
      return new RelayClientError(
        'relay_channel_open_failed',
        'Internet Relay Machine channel is not available',
      )
    case 'not_supported':
      return machineChannelProtocolError(
        'Internet Relay Machine channel is not supported',
      )
  }
}

function machineChannelOpenCodeError(
  code: 'capacity_reached' | 'not_authorized' | 'peer_unavailable' | 'internal',
): RelayClientError {
  switch (code) {
    case 'capacity_reached':
      return new RelayClientError(
        'relay_transport_capacity_reached',
        'Internet Relay Machine channel capacity was reached',
      )
    case 'peer_unavailable':
      return new RelayClientError(
        'relay_peer_offline',
        'Internet Relay Node is offline',
      )
    case 'internal':
    case 'not_authorized':
      return new RelayClientError(
        'relay_channel_open_failed',
        'Internet Relay Machine channel could not be opened',
      )
  }
}

function machineChannelBoundCodeError(
  code:
    | 'stale_channel'
    | 'invalid_state'
    | 'flow_control_violation'
    | 'capacity_reached'
    | 'not_authorized'
    | 'peer_unavailable'
    | 'internal',
): RelayClientError {
  switch (code) {
    case 'capacity_reached':
      return new RelayClientError(
        'relay_transport_capacity_reached',
        'Internet Relay Machine channel capacity was reached',
      )
    case 'peer_unavailable':
      return new RelayClientError(
        'relay_channel_lost',
        'Internet Relay Machine channel peer is unavailable',
      )
    case 'flow_control_violation':
    case 'internal':
    case 'invalid_state':
    case 'not_authorized':
    case 'stale_channel':
      return machineChannelProtocolError(
        'Internet Relay Machine channel protocol failed',
      )
  }
}

function machineChannelClosedWhileOpening(
  reason:
    | 'peer_closed'
    | 'peer_disconnected'
    | 'authorization_revoked'
    | 'connection_replaced'
    | 'timeout'
    | 'capacity_reached'
    | 'protocol_error'
    | 'relay_shutdown',
): RelayClientError {
  switch (reason) {
    case 'capacity_reached':
      return new RelayClientError(
        'relay_transport_capacity_reached',
        'Internet Relay Machine channel capacity was reached',
      )
    case 'peer_disconnected':
      return new RelayClientError(
        'relay_peer_offline',
        'Internet Relay Node is offline',
      )
    case 'protocol_error':
      return machineChannelProtocolError(
        'Internet Relay Machine channel protocol failed while opening',
      )
    case 'authorization_revoked':
    case 'connection_replaced':
    case 'peer_closed':
    case 'relay_shutdown':
    case 'timeout':
      return new RelayClientError(
        'relay_channel_open_failed',
        'Internet Relay Machine channel could not be opened',
      )
  }
}

function asRelayClientError(error: unknown): RelayClientError {
  return error instanceof RelayClientError
    ? error
    : machineChannelProtocolError('Internet Relay Machine channel failed')
}

function validateClientIdentity(identity: RelayClientIdentity): {
  readonly role: RelayPeerRole
  readonly privateKeyPem: string
  readonly publicKeySpki: RelayPublicKeySpki
  readonly publicKeyFingerprint: RelayPublicKeyFingerprint
} {
  const publicKeySpki = RelayPublicKeySpkiSchema.parse(identity.publicKeySpki)
  const publicKeyFingerprint = RelayPublicKeyFingerprintSchema.parse(
    identity.publicKeyFingerprint,
  )
  if (fingerprintRelayPublicKeySpki(publicKeySpki) !== publicKeyFingerprint) {
    throw new RelayClientError(
      'relay_identity_mismatch',
      'Relay peer identity is inconsistent',
    )
  }
  if (identity.role !== 'controller' && identity.role !== 'node') {
    throw new TypeError('Relay peer role is invalid')
  }
  return { ...identity, publicKeySpki, publicKeyFingerprint }
}

function assertRelayChallenge(
  challenge: RelayChallengeMessage,
  expectedFingerprint: RelayPublicKeyFingerprint,
  expectedRelayId: RelayId | undefined,
  now: Date,
): void {
  if (
    challenge.relayFingerprint !== expectedFingerprint ||
    fingerprintRelayPublicKeySpki(challenge.relayPublicKeySpki) !==
      challenge.relayFingerprint ||
    (expectedRelayId !== undefined && challenge.relayId !== expectedRelayId)
  ) {
    throw new RelayClientError(
      'relay_identity_mismatch',
      'Internet Relay identity did not match its pin',
    )
  }
  const { signature, ...unsigned } = challenge
  if (
    !verifyRelayTranscript(
      challenge.relayPublicKeySpki,
      relayChallengeTranscript(unsigned),
      signature,
    )
  ) {
    throw new RelayClientError(
      'relay_identity_mismatch',
      'Internet Relay identity proof was invalid',
    )
  }
  const issuedAt = Date.parse(challenge.issuedAt)
  const expiresAt = Date.parse(challenge.expiresAt)
  const current = now.getTime()
  if (
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > relayProtocolLimits.challengeLifetimeMs ||
    issuedAt > current + MAXIMUM_CHALLENGE_CLOCK_SKEW_MS ||
    expiresAt < current - MAXIMUM_CHALLENGE_CLOCK_SKEW_MS
  ) {
    throw new RelayClientError(
      'relay_authentication_failed',
      'Internet Relay authentication challenge expired',
    )
  }
}

async function sendClientMessage(
  connection: FramedRelayConnection,
  value: unknown,
  signal?: AbortSignal,
): Promise<void> {
  const message = RelayClientMessageSchema.parse(value)
  await connection.send(message, signal === undefined ? {} : { signal })
}

async function receiveServerMessage(
  connection: FramedRelayConnection,
  options: {
    readonly timeoutMs?: number | null
    readonly signal?: AbortSignal
  } = {},
): Promise<RelayServerMessage> {
  const raw = await connection.receive(UnknownRelayMessageSchema, options)
  const version = RelayProtocolVersionProbeSchema.safeParse(raw)
  if (
    version.success &&
    version.data.protocolVersion !== relayProtocolVersion
  ) {
    throw new RelayClientError(
      'relay_protocol_incompatible',
      'Internet Relay protocol is incompatible',
    )
  }
  const parsed = RelayServerMessageSchema.safeParse(raw)
  if (!parsed.success) {
    throw new RelayClientError(
      'relay_protocol_error',
      'Internet Relay returned an invalid control response',
    )
  }
  return parsed.data
}
