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
  readonly #completion: Promise<void>
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
