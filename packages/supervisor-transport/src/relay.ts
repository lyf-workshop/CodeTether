import { Buffer } from 'node:buffer'
import { Duplex } from 'node:stream'

import {
  connectRelayTls,
  type RelayClientEndpoint,
  type RelayClientTlsPolicy,
} from '@codetether/relay-client'
import {
  FramedRelayConnection,
  RelayChallengeMessageSchema,
  RelayErrorMessageSchema,
  RelaySupervisorServerMessageSchema,
  fingerprintRelayPublicKeySpki,
  newRelayRequestId,
  relayChallengeTranscript,
  relayProtocolLimits,
  relayProtocolVersion,
  relayPublicKeySpkiFromCertificate,
  relaySupervisorAuthenticationTranscript,
  signRelayTranscript,
  verifyRelayTranscript,
  type RelayChallengeMessage,
  type RelaySupervisorChannelBinding,
  type RelaySupervisorClientMessage,
  type RelaySupervisorServerMessage,
} from '@codetether/relay-protocol'
import { z } from 'zod'

import { supervisorTransportLimits } from './constants.js'
import { SupervisorClientError } from './client.js'
import type { SupervisorTlsIdentity } from './tls.js'

const InitialSupervisorRelayResponseSchema = z.union([
  RelaySupervisorServerMessageSchema,
  RelayErrorMessageSchema,
])

export interface SupervisorRelayConnectionOptions {
  readonly endpoint: RelayClientEndpoint
  readonly tls: RelayClientTlsPolicy
  readonly expectedRelayId: string
  readonly expectedRelayFingerprint: string
  readonly rendezvousId: string
  readonly rendezvousCapability: string
  readonly hostTransportFingerprint: string
  readonly identity: SupervisorTlsIdentity
  readonly clientBuildIdentity: string
  readonly signal?: AbortSignal
  readonly now?: () => Date
}

export interface SupervisorRelayChannelOffer {
  readonly deviceTransportFingerprint: string
  accept(): Promise<Duplex>
  reject(): Promise<void>
}

export class SupervisorRelayControlConnection {
  readonly role: 'host' | 'device'
  readonly connectionEpoch: string
  readonly completion: Promise<void>
  readonly #framed: FramedRelayConnection
  readonly #deviceRequestId: string | undefined
  readonly #deviceChannel = deferred<Duplex>()
  readonly #hostOffers = new Map<
    string,
    {
      readonly binding: RelaySupervisorChannelBinding
      readonly opened: ReturnType<typeof deferred<Duplex>>
      decided: boolean
    }
  >()
  readonly #channels = new Map<string, SupervisorRelayChannelDuplex>()
  readonly #closedChannels = new Map<
    string,
    {
      readonly binding: RelaySupervisorChannelBinding
      readonly timer: ReturnType<typeof setTimeout>
      remainingExactFrames: number
    }
  >()
  #offerHandler:
    ((offer: SupervisorRelayChannelOffer) => void | Promise<void>) | undefined
  #failure: Error | undefined
  #closing = false

  constructor(
    framed: FramedRelayConnection,
    ready: Extract<
      RelaySupervisorServerMessage,
      { readonly type: 'supervisor.ready' }
    >,
    deviceRequestId?: string,
  ) {
    this.#framed = framed
    this.role = ready.role
    this.connectionEpoch = ready.connectionEpoch
    this.#deviceRequestId = deviceRequestId
    this.completion = this.#run()
    void this.completion.catch(() => undefined)
  }

  setChannelHandler(
    handler: (offer: SupervisorRelayChannelOffer) => void | Promise<void>,
  ): () => void {
    if (this.role !== 'host' || this.#offerHandler !== undefined) {
      throw new SupervisorClientError('relay_protocol_error')
    }
    this.#offerHandler = handler
    return () => {
      if (this.#offerHandler === handler) this.#offerHandler = undefined
    }
  }

  async openDeviceChannel(signal?: AbortSignal): Promise<Duplex> {
    if (this.role !== 'device') {
      throw new SupervisorClientError('relay_protocol_error')
    }
    return await waitForDeferred(this.#deviceChannel, signal)
  }

  close(): void {
    if (this.#closing) return
    this.#closing = true
    for (const closed of this.#closedChannels.values())
      clearTimeout(closed.timer)
    this.#closedChannels.clear()
    for (const channel of this.#channels.values()) channel.destroy()
    this.#framed.end()
  }

  async #run(): Promise<void> {
    try {
      while (!this.#closing && !this.#framed.closed) {
        const message = await this.#framed.receive(
          RelaySupervisorServerMessageSchema,
          { timeoutMs: null },
        )
        await this.#handle(message)
      }
    } catch (error) {
      if (!this.#closing) {
        this.#failure = relayFailure(error)
        throw this.#failure
      }
    } finally {
      const failure =
        this.#failure ?? new SupervisorClientError('relay_unavailable')
      this.#deviceChannel.reject(failure)
      for (const pending of this.#hostOffers.values()) {
        pending.opened.reject(failure)
      }
      this.#hostOffers.clear()
      for (const channel of this.#channels.values())
        channel.connectionLost(failure)
      for (const closed of this.#closedChannels.values())
        clearTimeout(closed.timer)
      this.#closedChannels.clear()
      this.#framed.destroy()
    }
  }

  async #handle(message: RelaySupervisorServerMessage): Promise<void> {
    if (message.type === 'heartbeat.ping') {
      if (message.connectionEpoch !== this.connectionEpoch) {
        throw new SupervisorClientError('relay_protocol_error')
      }
      await this.#send({
        type: 'heartbeat.pong',
        protocolVersion: relayProtocolVersion,
        connectionEpoch: this.connectionEpoch as never,
        pingId: message.pingId,
      })
      return
    }
    if (message.type === 'supervisor.ready') {
      throw new SupervisorClientError('relay_protocol_error')
    }
    if (message.type === 'supervisor.channel.offer') {
      await this.#handleOffer(message)
      return
    }
    if (message.type === 'supervisor.channel.opened') {
      this.#handleOpened(message)
      return
    }
    if (
      message.type === 'supervisor.channel.reject' ||
      message.type === 'supervisor.channel.error'
    ) {
      this.#handleRejected(message.requestId)
      return
    }
    if (
      message.type === 'supervisor.channel.closed' &&
      !this.#channels.has(message.channelId)
    ) {
      if (this.#acceptClosedChannelFrame(message)) return
      if (
        this.#hostOffers.has(message.requestId) ||
        (this.role === 'device' && message.requestId === this.#deviceRequestId)
      ) {
        this.#handleRejected(message.requestId)
        return
      }
      throw new SupervisorClientError('relay_protocol_error')
    }
    const channel = this.#channels.get(message.channelId)
    if (channel === undefined) {
      if (this.#acceptClosedChannelFrame(message)) return
      throw new SupervisorClientError('relay_protocol_error')
    }
    if (!channel.matchesBinding(message)) {
      if (this.#acceptClosedChannelFrame(message)) return
      throw new SupervisorClientError('relay_protocol_error')
    }
    if (message.type === 'supervisor.channel.data') {
      channel.receiveData(message.sequence, message.data)
    } else if (message.type === 'supervisor.channel.data.ack') {
      channel.receiveAcknowledgement(message.acknowledgedSequence)
    } else {
      channel.receiveClosed(message.reason)
    }
  }

  async #handleOffer(
    message: Extract<
      RelaySupervisorServerMessage,
      { readonly type: 'supervisor.channel.offer' }
    >,
  ): Promise<void> {
    if (
      this.role !== 'host' ||
      message.connectionEpoch !== this.connectionEpoch ||
      message.hostConnectionEpoch !== this.connectionEpoch
    ) {
      throw new SupervisorClientError('relay_protocol_error')
    }
    if (
      this.#channels.size + this.#hostOffers.size >=
      relayProtocolLimits.maximumChannelsPerPeer
    ) {
      const binding = bindingOf(message)
      await this.#send({
        type: 'supervisor.channel.reject',
        protocolVersion: relayProtocolVersion,
        connectionEpoch: this.connectionEpoch as never,
        ...binding,
        requestId: message.requestId,
        reason: 'not_available',
      })
      this.#rememberClosedChannel(binding)
      return
    }
    const opened = deferred<Duplex>()
    const pending = {
      binding: bindingOf(message),
      opened,
      decided: false,
    }
    this.#hostOffers.set(message.requestId, pending)
    let decided = false
    const offer: SupervisorRelayChannelOffer = {
      deviceTransportFingerprint: message.deviceTransportFingerprint,
      accept: async () => {
        if (decided) throw new SupervisorClientError('relay_protocol_error')
        decided = true
        pending.decided = true
        await this.#send({
          type: 'supervisor.channel.accept',
          protocolVersion: relayProtocolVersion,
          connectionEpoch: this.connectionEpoch as never,
          ...pending.binding,
          requestId: message.requestId,
        })
        return await opened.promise
      },
      reject: async () => {
        if (decided) return
        decided = true
        pending.decided = true
        this.#hostOffers.delete(message.requestId)
        await this.#send({
          type: 'supervisor.channel.reject',
          protocolVersion: relayProtocolVersion,
          connectionEpoch: this.connectionEpoch as never,
          ...pending.binding,
          requestId: message.requestId,
          reason: 'not_available',
        })
        this.#rememberClosedChannel(pending.binding)
      },
    }
    const handler = this.#offerHandler
    if (handler === undefined) await offer.reject()
    else {
      void Promise.resolve(handler(offer)).catch(() => offer.reject())
    }
  }

  #handleOpened(
    message: Extract<
      RelaySupervisorServerMessage,
      { readonly type: 'supervisor.channel.opened' }
    >,
  ): void {
    if (message.connectionEpoch !== this.connectionEpoch) {
      throw new SupervisorClientError('relay_protocol_error')
    }
    const binding = bindingOf(message)
    if (this.role === 'host') {
      const pending = this.#hostOffers.get(message.requestId)
      if (
        pending === undefined ||
        !pending.decided ||
        !sameBinding(pending.binding, binding)
      ) {
        throw new SupervisorClientError('relay_protocol_error')
      }
      this.#hostOffers.delete(message.requestId)
      const channel = this.#createChannel(binding)
      pending.opened.resolve(channel)
      return
    }
    if (message.requestId !== this.#deviceRequestId) {
      throw new SupervisorClientError('relay_protocol_error')
    }
    this.#deviceChannel.resolve(this.#createChannel(binding))
  }

  #handleRejected(requestId: string): void {
    const failure = new SupervisorClientError('relay_unavailable')
    if (this.role === 'device' && requestId === this.#deviceRequestId) {
      this.#deviceChannel.reject(failure)
      return
    }
    const pending = this.#hostOffers.get(requestId)
    if (pending !== undefined) {
      this.#hostOffers.delete(requestId)
      pending.opened.reject(failure)
      this.#rememberClosedChannel(pending.binding)
    }
  }

  #createChannel(
    binding: RelaySupervisorChannelBinding,
  ): SupervisorRelayChannelDuplex {
    if (
      this.#channels.size >= relayProtocolLimits.maximumChannelsPerPeer ||
      this.#channels.has(binding.channelId)
    ) {
      throw new SupervisorClientError('relay_protocol_error')
    }
    const channel = new SupervisorRelayChannelDuplex(binding, {
      connectionEpoch: this.connectionEpoch,
      send: (message) => this.#send(message),
      release: (released) => {
        if (this.#channels.get(binding.channelId) === released) {
          this.#channels.delete(binding.channelId)
          this.#rememberClosedChannel(binding)
        }
      },
    })
    this.#channels.set(binding.channelId, channel)
    return channel
  }

  #rememberClosedChannel(binding: RelaySupervisorChannelBinding): void {
    const key = bindingKey(binding)
    const prior = this.#closedChannels.get(key)
    if (prior !== undefined) clearTimeout(prior.timer)
    if (
      this.#closedChannels.size >= relayProtocolLimits.maximumChannelsPerPeer
    ) {
      const oldest = this.#closedChannels.keys().next().value
      if (oldest !== undefined) {
        clearTimeout(this.#closedChannels.get(oldest)!.timer)
        this.#closedChannels.delete(oldest)
      }
    }
    const timer = setTimeout(() => {
      if (this.#closedChannels.get(key)?.timer === timer) {
        this.#closedChannels.delete(key)
      }
    }, relayProtocolLimits.channelAcknowledgementTimeoutMs)
    timer.unref()
    this.#closedChannels.set(key, {
      binding,
      timer,
      remainingExactFrames: relayProtocolLimits.maximumTerminalChannelFrames,
    })
  }

  #acceptClosedChannelFrame(message: RelaySupervisorServerMessage): boolean {
    if (message.type !== 'supervisor.channel.closed') return false
    const closed = this.#closedChannels.get(bindingKey(message))
    if (
      closed === undefined ||
      closed.remainingExactFrames <= 0 ||
      !sameBinding(closed.binding, message)
    ) {
      return false
    }
    closed.remainingExactFrames -= 1
    return true
  }

  async #send(message: RelaySupervisorClientMessage): Promise<void> {
    if (this.#closing || this.#failure !== undefined) {
      throw this.#failure ?? new SupervisorClientError('relay_unavailable')
    }
    await this.#framed.send(message)
  }
}

export async function connectSupervisorRelayHost(
  options: SupervisorRelayConnectionOptions,
): Promise<SupervisorRelayControlConnection> {
  return await connectSupervisorRelayControl(options, 'host')
}

export async function connectSupervisorRelayDevice(
  options: SupervisorRelayConnectionOptions,
): Promise<SupervisorRelayControlConnection> {
  return await connectSupervisorRelayControl(options, 'device')
}

async function connectSupervisorRelayControl(
  options: SupervisorRelayConnectionOptions,
  role: 'host' | 'device',
): Promise<SupervisorRelayControlConnection> {
  const socket = await connectRelayTls({
    endpoint: options.endpoint,
    tls: options.tls,
    signal: options.signal,
    timeoutMs: supervisorTransportLimits.handshakeTimeoutMs,
  })
  const framed = new FramedRelayConnection(socket)
  try {
    const challenge = await framed.receive(RelayChallengeMessageSchema, {
      signal: options.signal,
      timeoutMs: supervisorTransportLimits.handshakeTimeoutMs,
    })
    assertRelayChallenge(options, challenge)
    const transportPublicKeySpki = relayPublicKeySpkiFromCertificate(
      options.identity.certificatePem,
    )
    const transportFingerprint = fingerprintRelayPublicKeySpki(
      transportPublicKeySpki,
    )
    if (
      role === 'host' &&
      transportFingerprint !== options.hostTransportFingerprint
    ) {
      throw new SupervisorClientError('host_identity_mismatch')
    }
    const requestId = role === 'device' ? newRelayRequestId() : undefined
    const transcriptInput = {
      challenge,
      role,
      rendezvousId: options.rendezvousId,
      rendezvousCapability: options.rendezvousCapability,
      hostTransportFingerprint: options.hostTransportFingerprint,
      transportPublicKeySpki,
      transportFingerprint,
      clientBuildIdentity: options.clientBuildIdentity,
      ...(requestId === undefined ? {} : { requestId }),
    }
    await framed.send({
      type:
        role === 'host'
          ? 'supervisor.host.register'
          : 'supervisor.device.connect',
      protocolVersion: relayProtocolVersion,
      role,
      ...(requestId === undefined ? {} : { requestId }),
      rendezvousId: options.rendezvousId,
      rendezvousCapability: options.rendezvousCapability,
      hostTransportFingerprint: options.hostTransportFingerprint,
      transportPublicKeySpki,
      transportFingerprint,
      clientBuildIdentity: options.clientBuildIdentity,
      signature: signRelayTranscript(
        options.identity.privateKeyPem,
        relaySupervisorAuthenticationTranscript(transcriptInput),
      ),
    })
    const response = await framed.receive(
      InitialSupervisorRelayResponseSchema,
      {
        signal: options.signal,
        timeoutMs: supervisorTransportLimits.handshakeTimeoutMs,
      },
    )
    if (response.type !== 'supervisor.ready' || response.role !== role) {
      throw new SupervisorClientError('relay_unavailable')
    }
    return new SupervisorRelayControlConnection(framed, response, requestId)
  } catch (error) {
    framed.destroy()
    throw relayFailure(error)
  }
}

function assertRelayChallenge(
  options: SupervisorRelayConnectionOptions,
  challenge: RelayChallengeMessage,
): void {
  const now = options.now?.() ?? new Date()
  const { signature, ...unsigned } = challenge
  if (
    challenge.relayId !== options.expectedRelayId ||
    challenge.relayFingerprint !== options.expectedRelayFingerprint ||
    fingerprintRelayPublicKeySpki(challenge.relayPublicKeySpki) !==
      challenge.relayFingerprint ||
    !verifyRelayTranscript(
      challenge.relayPublicKeySpki,
      relayChallengeTranscript(unsigned),
      signature,
    ) ||
    Date.parse(challenge.issuedAt) > now.getTime() + 60_000 ||
    Date.parse(challenge.expiresAt) <= now.getTime()
  ) {
    throw new SupervisorClientError('relay_identity_mismatch')
  }
}

type ChannelClientMessage = Extract<
  RelaySupervisorClientMessage,
  {
    readonly type:
      | 'supervisor.channel.data'
      | 'supervisor.channel.data.ack'
      | 'supervisor.channel.close'
  }
>

interface SupervisorRelayChannelTransport {
  readonly connectionEpoch: string
  readonly send: (message: ChannelClientMessage) => Promise<void>
  readonly release: (channel: SupervisorRelayChannelDuplex) => void
}

class SupervisorRelayChannelDuplex extends Duplex {
  readonly #binding: RelaySupervisorChannelBinding
  readonly #transport: SupervisorRelayChannelTransport
  #incomingSequence = 1
  #outgoingSequence = 1
  #outstanding:
    | {
        readonly sequence: number
        readonly resolve: () => void
        readonly reject: (error: Error) => void
        readonly timer: ReturnType<typeof setTimeout>
      }
    | undefined
  #pendingReadAck: number | undefined
  #terminal = false

  constructor(
    binding: RelaySupervisorChannelBinding,
    transport: SupervisorRelayChannelTransport,
  ) {
    super({
      allowHalfOpen: false,
      decodeStrings: true,
      readableHighWaterMark: relayProtocolLimits.maximumChannelDataBytes,
      writableHighWaterMark: relayProtocolLimits.maximumChannelDataBytes,
    })
    this.#binding = binding
    this.#transport = transport
  }

  matchesBinding(value: RelaySupervisorChannelBinding): boolean {
    return sameBinding(this.#binding, value)
  }

  receiveData(sequence: number, data: string): void {
    if (this.#terminal) return
    if (
      sequence !== this.#incomingSequence ||
      this.#pendingReadAck !== undefined
    ) {
      this.destroy(new SupervisorClientError('relay_protocol_error'))
      return
    }
    const bytes = Buffer.from(data, 'base64url')
    this.#incomingSequence += 1
    if (this.push(bytes)) void this.#ack(sequence)
    else this.#pendingReadAck = sequence
  }

  receiveAcknowledgement(sequence: number): void {
    const pending = this.#outstanding
    if (this.#terminal || pending?.sequence !== sequence) {
      this.destroy(new SupervisorClientError('relay_protocol_error'))
      return
    }
    clearTimeout(pending.timer)
    this.#outstanding = undefined
    this.#outgoingSequence += 1
    pending.resolve()
  }

  receiveClosed(reason: string): void {
    if (this.#terminal) return
    const error =
      reason === 'peer_closed'
        ? undefined
        : new SupervisorClientError('relay_unavailable')
    // The Relay has already removed this channel. Mark it terminal before
    // destroying the Duplex so _destroy never emits a stale close frame that
    // could incorrectly terminate the still-valid peer control connection.
    this.#finish(error)
    if (reason === 'peer_closed') {
      this.push(null)
    } else this.destroy(error)
  }

  connectionLost(error: Error): void {
    if (!this.#terminal) this.destroy(error)
  }

  override _read(): void {
    const sequence = this.#pendingReadAck
    if (sequence === undefined || this.#terminal) return
    this.#pendingReadAck = undefined
    void this.#ack(sequence)
  }

  override _write(
    chunk: Buffer | string | Uint8Array,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const bytes = Buffer.isBuffer(chunk)
      ? chunk
      : typeof chunk === 'string'
        ? Buffer.from(chunk, encoding)
        : Buffer.from(chunk)
    void this.#writeBytes(bytes).then(() => callback(), callback)
  }

  override _final(callback: (error?: Error | null) => void): void {
    if (this.#terminal) return callback()
    this.#finish()
    void this.#transport
      .send({
        type: 'supervisor.channel.close',
        protocolVersion: relayProtocolVersion,
        connectionEpoch: this.#transport.connectionEpoch as never,
        ...this.#binding,
        reason: 'completed',
      })
      .then(() => callback(), callback)
  }

  override _destroy(
    error: Error | null,
    callback: (error?: Error | null) => void,
  ): void {
    if (this.#terminal) return callback(error)
    this.#finish(error ?? undefined)
    void this.#transport
      .send({
        type: 'supervisor.channel.close',
        protocolVersion: relayProtocolVersion,
        connectionEpoch: this.#transport.connectionEpoch as never,
        ...this.#binding,
        reason: error === null ? 'cancelled' : 'transport_closed',
      })
      .then(
        () => callback(error),
        () => callback(error),
      )
  }

  async #writeBytes(bytes: Buffer): Promise<void> {
    for (
      let offset = 0;
      offset < bytes.length;
      offset += relayProtocolLimits.maximumChannelDataBytes
    ) {
      const chunk = bytes.subarray(
        offset,
        Math.min(
          bytes.length,
          offset + relayProtocolLimits.maximumChannelDataBytes,
        ),
      )
      await this.#writeChunk(chunk)
    }
  }

  async #writeChunk(chunk: Buffer): Promise<void> {
    if (this.#terminal || this.#outstanding !== undefined) {
      throw new SupervisorClientError('relay_unavailable')
    }
    const sequence = this.#outgoingSequence
    const completion = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.#outstanding?.sequence !== sequence) return
        this.#outstanding = undefined
        reject(new SupervisorClientError('relay_unavailable'))
        this.destroy(new SupervisorClientError('relay_unavailable'))
      }, relayProtocolLimits.channelAcknowledgementTimeoutMs)
      this.#outstanding = { sequence, resolve, reject, timer }
    })
    void completion.catch(() => undefined)
    await this.#transport.send({
      type: 'supervisor.channel.data',
      protocolVersion: relayProtocolVersion,
      connectionEpoch: this.#transport.connectionEpoch as never,
      ...this.#binding,
      sequence,
      data: chunk.toString('base64url'),
    })
    await completion
  }

  async #ack(sequence: number): Promise<void> {
    await this.#transport.send({
      type: 'supervisor.channel.data.ack',
      protocolVersion: relayProtocolVersion,
      connectionEpoch: this.#transport.connectionEpoch as never,
      ...this.#binding,
      acknowledgedSequence: sequence,
    })
  }

  #finish(error?: Error): void {
    if (this.#terminal) return
    this.#terminal = true
    this.#pendingReadAck = undefined
    const outstanding = this.#outstanding
    if (outstanding !== undefined) {
      clearTimeout(outstanding.timer)
      this.#outstanding = undefined
      outstanding.reject(
        error ?? new SupervisorClientError('relay_unavailable'),
      )
    }
    this.#transport.release(this)
  }
}

function bindingOf(
  value: RelaySupervisorChannelBinding,
): RelaySupervisorChannelBinding {
  return {
    channelId: value.channelId,
    channelGeneration: value.channelGeneration,
    deviceConnectionEpoch: value.deviceConnectionEpoch,
    hostConnectionEpoch: value.hostConnectionEpoch,
  }
}

function bindingKey(value: RelaySupervisorChannelBinding): string {
  return `${value.channelId}:${value.channelGeneration}:${value.deviceConnectionEpoch}:${value.hostConnectionEpoch}`
}

function sameBinding(
  left: RelaySupervisorChannelBinding,
  right: RelaySupervisorChannelBinding,
): boolean {
  return (
    left.channelId === right.channelId &&
    left.channelGeneration === right.channelGeneration &&
    left.deviceConnectionEpoch === right.deviceConnectionEpoch &&
    left.hostConnectionEpoch === right.hostConnectionEpoch
  )
}

function relayFailure(error: unknown): Error {
  return error instanceof SupervisorClientError
    ? error
    : new SupervisorClientError('relay_unavailable')
}

function deferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (error: Error) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  void promise.catch(() => undefined)
  return { promise, resolve, reject }
}

async function waitForDeferred<T>(
  value: ReturnType<typeof deferred<T>>,
  signal?: AbortSignal,
): Promise<T> {
  if (signal === undefined) return await value.promise
  if (signal.aborted) throw new SupervisorClientError('relay_unavailable')
  return await Promise.race([
    value.promise,
    new Promise<T>((_resolve, reject) => {
      signal.addEventListener(
        'abort',
        () => reject(new SupervisorClientError('relay_unavailable')),
        { once: true },
      )
    }),
  ])
}
