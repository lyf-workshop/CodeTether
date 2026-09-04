import { Buffer } from 'node:buffer'
import { Duplex } from 'node:stream'

import {
  relayProtocolLimits,
  relayProtocolVersion,
  type RelayClientMessage,
  type RelayChannelClosedReason,
  type RelayChannelData,
  type RelayChannelErrorCode,
  type RelayChannelGeneration,
  type RelayChannelId,
  type RelayConnectionEpoch,
} from '@codetether/relay-protocol'

import { RelayClientError } from './errors.js'

type RelayMachineChannelClientMessage = Extract<
  RelayClientMessage,
  { readonly type: 'channel.data' | 'channel.data.ack' | 'channel.close' }
>

export interface RelayMachineChannelBinding {
  readonly channelId: RelayChannelId
  readonly channelGeneration: RelayChannelGeneration
  readonly controllerConnectionEpoch: RelayConnectionEpoch
  readonly nodeConnectionEpoch: RelayConnectionEpoch
}

interface RelayMachineChannelTransport {
  readonly localConnectionEpoch: RelayConnectionEpoch
  readonly send: (message: RelayMachineChannelClientMessage) => Promise<void>
  readonly release: (channel: RelayMachineChannelDuplex) => void
}

export class RelayMachineChannelDuplex extends Duplex {
  readonly binding: RelayMachineChannelBinding
  readonly #transport: RelayMachineChannelTransport
  #nextIncomingSequence = 1
  #nextOutgoingSequence = 1
  #outstandingWrite:
    | {
        readonly sequence: number
        readonly resolve: () => void
        readonly reject: (error: Error) => void
        readonly timer: ReturnType<typeof setTimeout>
      }
    | undefined
  #pendingReadAcknowledgement: number | undefined
  #acknowledgementInFlight: number | undefined
  #closeSent = false
  #remoteTerminal = false
  #released = false
  #terminal = false

  constructor(
    binding: RelayMachineChannelBinding,
    transport: RelayMachineChannelTransport,
  ) {
    super({
      allowHalfOpen: false,
      decodeStrings: true,
      readableHighWaterMark: relayProtocolLimits.maximumChannelDataBytes,
      writableHighWaterMark: relayProtocolLimits.maximumChannelDataBytes,
    })
    this.binding = binding
    this.#transport = transport
  }

  matchesBinding(binding: RelayMachineChannelBinding): boolean {
    return (
      binding.channelId === this.binding.channelId &&
      binding.channelGeneration === this.binding.channelGeneration &&
      binding.controllerConnectionEpoch ===
        this.binding.controllerConnectionEpoch &&
      binding.nodeConnectionEpoch === this.binding.nodeConnectionEpoch
    )
  }

  receiveData(sequence: number, data: RelayChannelData): void {
    if (this.#terminal) return
    if (
      sequence !== this.#nextIncomingSequence ||
      this.#pendingReadAcknowledgement !== undefined ||
      this.#acknowledgementInFlight !== undefined
    ) {
      this.#failProtocol('Internet Relay channel data was out of sequence')
      return
    }
    const chunk = Buffer.from(data, 'base64url')
    if (
      chunk.length === 0 ||
      chunk.length > relayProtocolLimits.maximumChannelDataBytes
    ) {
      this.#failProtocol('Internet Relay channel data exceeded its bound')
      return
    }
    this.#nextIncomingSequence += 1
    if (this.push(chunk)) this.#sendAcknowledgement(sequence)
    else this.#pendingReadAcknowledgement = sequence
  }

  receiveAcknowledgement(sequence: number): void {
    if (this.#terminal) return
    const pending = this.#outstandingWrite
    if (pending === undefined || pending.sequence !== sequence) {
      this.#failProtocol(
        'Internet Relay channel acknowledgement was out of sequence',
      )
      return
    }
    clearTimeout(pending.timer)
    this.#outstandingWrite = undefined
    this.#nextOutgoingSequence += 1
    pending.resolve()
  }

  receiveClosed(reason: RelayChannelClosedReason): void {
    if (this.#terminal) return
    this.#remoteTerminal = true
    if (reason === 'peer_closed') {
      this.#markTerminal()
      this.push(null)
      return
    }
    this.destroy(closedReasonError(reason))
  }

  receiveError(code: RelayChannelErrorCode): void {
    if (this.#terminal) return
    this.#remoteTerminal = true
    this.destroy(channelError(code))
  }

  connectionLost(cause: RelayClientError): void {
    if (this.#terminal) return
    this.#remoteTerminal = true
    if (cause.code === 'relay_protocol_error') {
      this.destroy(cause)
      return
    }
    this.destroy(
      new RelayClientError(
        'relay_channel_lost',
        'Internet Relay Machine channel was lost',
        undefined,
        { cause },
      ),
    )
  }

  override _read(): void {
    const sequence = this.#pendingReadAcknowledgement
    if (sequence === undefined || this.#terminal) return
    this.#pendingReadAcknowledgement = undefined
    this.#sendAcknowledgement(sequence)
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
    void this.#writeBytes(bytes).then(
      () => callback(),
      (error: unknown) => callback(asError(error)),
    )
  }

  override _final(callback: (error?: Error | null) => void): void {
    if (this.#terminal) {
      callback()
      return
    }
    this.#closeSent = true
    this.#markTerminal()
    this.push(null)
    void this.#transport
      .send({
        type: 'channel.close',
        protocolVersion: relayProtocolVersion,
        connectionEpoch: this.#transport.localConnectionEpoch,
        ...this.binding,
        reason: 'completed',
      })
      .then(
        () => callback(),
        (error: unknown) => callback(channelLostError(error)),
      )
  }

  override _destroy(
    error: Error | null,
    callback: (error?: Error | null) => void,
  ): void {
    if (this.#terminal) {
      callback(error)
      return
    }
    const shouldNotifyPeer = !this.#remoteTerminal && !this.#closeSent
    this.#closeSent = true
    this.#markTerminal(error ?? undefined)
    if (!shouldNotifyPeer) {
      callback(error)
      return
    }
    void this.#transport
      .send({
        type: 'channel.close',
        protocolVersion: relayProtocolVersion,
        connectionEpoch: this.#transport.localConnectionEpoch,
        ...this.binding,
        reason: error === null ? 'cancelled' : 'transport_closed',
      })
      .then(
        () => callback(error),
        () => callback(error),
      )
  }

  async #writeBytes(bytes: Buffer): Promise<void> {
    if (this.#terminal) throw channelClosedError()
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
      await this.#sendChunk(chunk)
    }
  }

  async #sendChunk(chunk: Buffer): Promise<void> {
    if (this.#terminal) throw channelClosedError()
    if (this.#outstandingWrite !== undefined) {
      throw new RelayClientError(
        'relay_protocol_error',
        'Internet Relay Machine channel flow control was violated',
      )
    }
    const sequence = this.#nextOutgoingSequence
    if (!Number.isSafeInteger(sequence) || sequence <= 0) {
      throw new RelayClientError(
        'relay_protocol_error',
        'Internet Relay Machine channel sequence was exhausted',
      )
    }
    const acknowledgement = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.#outstandingWrite?.sequence !== sequence) return
        this.#outstandingWrite = undefined
        const failure = new RelayClientError(
          'relay_channel_lost',
          'Internet Relay Machine channel acknowledgement timed out',
        )
        reject(failure)
        this.destroy(failure)
      }, relayProtocolLimits.channelAcknowledgementTimeoutMs)
      this.#outstandingWrite = { sequence, resolve, reject, timer }
    })
    void acknowledgement.catch(() => undefined)
    try {
      await this.#transport.send({
        type: 'channel.data',
        protocolVersion: relayProtocolVersion,
        connectionEpoch: this.#transport.localConnectionEpoch,
        ...this.binding,
        sequence,
        data: chunk.toString('base64url'),
      })
      await acknowledgement
    } catch (error) {
      const failure = channelLostError(error)
      this.#rejectOutstandingWrite(sequence, failure)
      throw failure
    }
  }

  #rejectOutstandingWrite(sequence: number, failure: Error): void {
    const pending = this.#outstandingWrite
    if (pending === undefined || pending.sequence !== sequence) return
    clearTimeout(pending.timer)
    this.#outstandingWrite = undefined
    pending.reject(failure)
  }

  #sendAcknowledgement(sequence: number): void {
    if (this.#terminal) return
    if (this.#acknowledgementInFlight !== undefined) {
      this.#failProtocol(
        'Internet Relay Machine channel acknowledgement overlapped',
      )
      return
    }
    this.#acknowledgementInFlight = sequence
    void this.#transport
      .send({
        type: 'channel.data.ack',
        protocolVersion: relayProtocolVersion,
        connectionEpoch: this.#transport.localConnectionEpoch,
        ...this.binding,
        acknowledgedSequence: sequence,
      })
      .then(
        () => {
          if (this.#acknowledgementInFlight === sequence) {
            this.#acknowledgementInFlight = undefined
          }
        },
        (error: unknown) => this.destroy(channelLostError(error)),
      )
  }

  #failProtocol(message: string): void {
    this.destroy(new RelayClientError('relay_protocol_error', message))
  }

  #markTerminal(error?: Error): void {
    if (this.#terminal) return
    this.#terminal = true
    this.#pendingReadAcknowledgement = undefined
    this.#acknowledgementInFlight = undefined
    const pending = this.#outstandingWrite
    if (pending !== undefined) {
      clearTimeout(pending.timer)
      this.#outstandingWrite = undefined
      pending.reject(error ?? channelClosedError())
    }
    if (!this.#released) {
      this.#released = true
      this.#transport.release(this)
    }
  }
}

function channelClosedError(): RelayClientError {
  return new RelayClientError(
    'relay_channel_lost',
    'Internet Relay Machine channel is closed',
  )
}

function channelLostError(error: unknown): RelayClientError {
  return error instanceof RelayClientError &&
    (error.code === 'relay_channel_lost' ||
      error.code === 'relay_protocol_error' ||
      error.code === 'relay_transport_capacity_reached')
    ? error
    : new RelayClientError(
        'relay_channel_lost',
        'Internet Relay Machine channel was lost',
        undefined,
        { cause: error },
      )
}

function closedReasonError(reason: RelayChannelClosedReason): RelayClientError {
  switch (reason) {
    case 'capacity_reached':
      return new RelayClientError(
        'relay_transport_capacity_reached',
        'Internet Relay Machine channel capacity was reached',
      )
    case 'authorization_revoked':
      return new RelayClientError(
        'relay_channel_lost',
        'Internet Relay Machine channel authorization was revoked',
      )
    case 'connection_replaced':
    case 'peer_disconnected':
    case 'relay_shutdown':
    case 'timeout':
      return channelClosedError()
    case 'protocol_error':
      return new RelayClientError(
        'relay_protocol_error',
        'Internet Relay Machine channel protocol failed',
      )
    case 'peer_closed':
      return channelClosedError()
  }
}

function channelError(code: RelayChannelErrorCode): RelayClientError {
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
      return new RelayClientError(
        'relay_protocol_error',
        'Internet Relay Machine channel protocol failed',
      )
  }
}

function asError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new RelayClientError(
        'relay_channel_lost',
        'Internet Relay Machine channel failed',
      )
}
