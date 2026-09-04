import type { Duplex } from 'node:stream'

import type { z } from 'zod'

import { relayProtocolLimits } from './constants.js'
import { RelayProtocolError } from './errors.js'

const fatalUtf8Decoder = new TextDecoder('utf-8', { fatal: true })

export interface DecodedRelayFrame {
  readonly value: unknown
  /** Exact length-prefixed wire bytes retained by the receive queue. */
  readonly wireBytes: number
}

export interface RelayFramingQueueMetrics {
  readonly queuedInboundFrames: number
  readonly queuedInboundBytes: number
  readonly pendingOutboundFrames: number
  readonly pendingOutboundBytes: number
}

export interface FramedRelayConnectionOptions {
  /** Aggregate instrumentation only. The callback never receives frame data. */
  readonly onQueueMetricsChanged?: (metrics: RelayFramingQueueMetrics) => void
}

export class RelayFrameDecoder {
  #buffer = Buffer.alloc(0)

  push(chunk: Buffer): unknown[] {
    return this.pushFrames(chunk).map((frame) => frame.value)
  }

  pushFrames(chunk: Buffer): DecodedRelayFrame[] {
    if (chunk.length === 0) return []
    const frames: DecodedRelayFrame[] = []
    let offset = 0
    while (offset < chunk.length) {
      if (this.#buffer.length < 4) {
        const headerBytes = Math.min(
          4 - this.#buffer.length,
          chunk.length - offset,
        )
        this.#appendResidual(chunk.subarray(offset, offset + headerBytes))
        offset += headerBytes
        if (this.#buffer.length < 4) break
      }
      const length = this.#buffer.readUInt32BE(0)
      if (length === 0 || length > relayProtocolLimits.maximumFrameBytes) {
        throw malformed('Relay frame length is invalid')
      }
      const totalLength = length + 4
      const bodyBytes = Math.min(
        totalLength - this.#buffer.length,
        chunk.length - offset,
      )
      this.#appendResidual(chunk.subarray(offset, offset + bodyBytes))
      offset += bodyBytes
      if (this.#buffer.length < totalLength) break
      const body = this.#buffer.subarray(4, length + 4)
      try {
        frames.push({
          value: JSON.parse(fatalUtf8Decoder.decode(body)) as unknown,
          wireBytes: totalLength,
        })
      } catch (error) {
        throw malformed('Relay frame is not valid UTF-8 JSON', error)
      }
      this.#buffer = Buffer.alloc(0)
      // FramedRelayConnection can deliver one frame directly to its current
      // waiter and retain at most the configured queue. Refuse an arbitrarily
      // large coalesced network chunk before materializing an unbounded array.
      if (frames.length > relayProtocolLimits.maximumQueuedFrames + 1) {
        throw malformed('Relay receive queue exceeded its bound')
      }
    }
    return frames
  }

  finish(): void {
    if (this.#buffer.length !== 0) {
      throw malformed('Relay connection ended with an incomplete frame')
    }
  }

  #appendResidual(bytes: Buffer): void {
    if (bytes.length === 0) return
    if (
      this.#buffer.length + bytes.length >
      relayProtocolLimits.maximumBufferedBytes
    ) {
      throw malformed('Relay frame buffer exceeded its bound')
    }
    this.#buffer = Buffer.concat([this.#buffer, bytes])
  }
}

export function encodeRelayFrame(value: unknown): Buffer {
  const json = JSON.stringify(value)
  if (json === undefined) {
    throw new TypeError('Relay message must be JSON serializable')
  }
  const body = Buffer.from(json, 'utf8')
  if (
    body.length === 0 ||
    body.length > relayProtocolLimits.maximumFrameBytes
  ) {
    throw new RangeError('Relay message exceeds the frame bound')
  }
  const frame = Buffer.allocUnsafe(body.length + 4)
  frame.writeUInt32BE(body.length, 0)
  body.copy(frame, 4)
  return frame
}

export class FramedRelayConnection {
  readonly #stream: Duplex
  readonly #decoder = new RelayFrameDecoder()
  readonly #queue: DecodedRelayFrame[] = []
  readonly #waiters: Array<{
    resolve: (value: unknown) => void
    reject: (error: Error) => void
  }> = []
  #failure: Error | undefined
  #closed = false
  #pendingSends = 0
  #pendingSendBytes = 0
  #queuedInboundBytes = 0
  readonly #onQueueMetricsChanged:
    ((metrics: RelayFramingQueueMetrics) => void) | undefined

  constructor(stream: Duplex, options: FramedRelayConnectionOptions = {}) {
    this.#stream = stream
    this.#onQueueMetricsChanged = options.onQueueMetricsChanged
    stream.on('data', (chunk: Buffer | string) => {
      try {
        const frames = this.#decoder.pushFrames(
          typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk,
        )
        for (const frame of frames) this.#enqueue(frame)
      } catch (error) {
        this.#fail(error instanceof Error ? error : malformed('Relay failed'))
      }
    })
    stream.once('error', (error) => this.#fail(connectionFailure(error)))
    stream.once('end', () => {
      try {
        this.#decoder.finish()
        this.#fail(connectionFailure(new Error('Relay connection ended')))
      } catch (error) {
        this.#fail(error instanceof Error ? error : malformed('Relay ended'))
      }
    })
    stream.once('close', () => {
      this.#closed = true
      this.#fail(connectionFailure(new Error('Relay connection closed')))
    })
  }

  get closed(): boolean {
    return this.#closed || this.#failure !== undefined
  }

  get queueMetrics(): RelayFramingQueueMetrics {
    return {
      queuedInboundFrames: this.#queue.length,
      queuedInboundBytes: this.#queuedInboundBytes,
      pendingOutboundFrames: this.#pendingSends,
      pendingOutboundBytes: this.#pendingSendBytes,
    }
  }

  async receive<T>(
    schema: z.ZodType<T>,
    options: {
      readonly timeoutMs?: number | null
      readonly signal?: AbortSignal
    } = {},
  ): Promise<T> {
    const raw = await this.#next(options)
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      const error = malformed('Relay message failed strict validation')
      this.#fail(error)
      throw error
    }
    return parsed.data
  }

  async send(
    value: unknown,
    options: {
      readonly timeoutMs?: number
      readonly signal?: AbortSignal
    } = {},
  ): Promise<void> {
    if (this.#failure !== undefined) throw this.#failure
    if (this.#pendingSends >= relayProtocolLimits.maximumQueuedFrames) {
      const error = connectionFailure(
        new Error('Relay send queue exceeded its bound'),
      )
      this.#fail(error)
      throw error
    }
    const frame = encodeRelayFrame(value)
    this.#pendingSends += 1
    this.#pendingSendBytes += frame.length
    this.#notifyQueueMetrics()
    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false
        const settle = (error?: Error) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          options.signal?.removeEventListener('abort', abort)
          if (error === undefined) resolve()
          else reject(error)
        }
        const abort = () =>
          settle(connectionFailure(new Error('Relay send was cancelled')))
        const timer = setTimeout(
          () =>
            settle(new RelayProtocolError('timeout', 'Relay send timed out')),
          options.timeoutMs ?? relayProtocolLimits.messageTimeoutMs,
        )
        if (options.signal?.aborted === true) {
          abort()
          return
        }
        options.signal?.addEventListener('abort', abort, { once: true })
        this.#stream.write(frame, (error) =>
          settle(
            error === null || error === undefined
              ? undefined
              : connectionFailure(error),
          ),
        )
      })
    } catch (error) {
      const failure =
        error instanceof Error
          ? error
          : connectionFailure(new Error('Relay send failed'))
      this.#fail(failure)
      throw failure
    } finally {
      this.#pendingSends -= 1
      this.#pendingSendBytes -= frame.length
      this.#notifyQueueMetrics()
    }
  }

  end(): void {
    this.#closed = true
    this.#stream.end()
  }

  destroy(error?: Error): void {
    this.#closed = true
    this.#stream.destroy(error)
  }

  async #next(options: {
    readonly timeoutMs?: number | null
    readonly signal?: AbortSignal
  }): Promise<unknown> {
    if (this.#failure !== undefined) throw this.#failure
    if (this.#queue.length > 0) {
      const frame = this.#queue.shift()!
      this.#queuedInboundBytes -= frame.wireBytes
      this.#notifyQueueMetrics()
      return frame.value
    }
    const timeoutMs =
      options.timeoutMs === undefined
        ? relayProtocolLimits.messageTimeoutMs
        : options.timeoutMs
    return await new Promise<unknown>((resolve, reject) => {
      let settled = false
      const waiter = {
        resolve: (value: unknown) => settle(() => resolve(value)),
        reject: (error: Error) => settle(() => reject(error)),
      }
      const timeout =
        timeoutMs === null
          ? undefined
          : setTimeout(
              () =>
                waiter.reject(
                  new RelayProtocolError('timeout', 'Relay message timed out'),
                ),
              timeoutMs,
            )
      const abort = () =>
        waiter.reject(
          connectionFailure(new Error('Relay receive was cancelled')),
        )
      const settle = (result: () => void) => {
        if (settled) return
        settled = true
        if (timeout !== undefined) clearTimeout(timeout)
        options.signal?.removeEventListener('abort', abort)
        const index = this.#waiters.indexOf(waiter)
        if (index >= 0) this.#waiters.splice(index, 1)
        result()
      }
      this.#waiters.push(waiter)
      if (options.signal?.aborted === true) abort()
      else options.signal?.addEventListener('abort', abort, { once: true })
    })
  }

  #enqueue(frame: DecodedRelayFrame): void {
    if (this.#failure !== undefined) return
    const waiter = this.#waiters.shift()
    if (waiter !== undefined) {
      waiter.resolve(frame.value)
      return
    }
    if (this.#queue.length >= relayProtocolLimits.maximumQueuedFrames) {
      this.#fail(malformed('Relay receive queue exceeded its bound'))
      return
    }
    this.#queue.push(frame)
    this.#queuedInboundBytes += frame.wireBytes
    this.#notifyQueueMetrics()
  }

  #fail(error: Error): void {
    if (this.#failure !== undefined) return
    this.#failure = error
    const hadQueuedFrames = this.#queue.length > 0
    this.#queue.length = 0
    this.#queuedInboundBytes = 0
    if (hadQueuedFrames) this.#notifyQueueMetrics()
    for (const waiter of this.#waiters.splice(0)) waiter.reject(error)
    if (!this.#stream.destroyed) this.#stream.destroy()
  }

  #notifyQueueMetrics(): void {
    try {
      this.#onQueueMetricsChanged?.(this.queueMetrics)
    } catch {
      // Metrics must never alter transport correctness or close a peer.
    }
  }
}

function malformed(message: string, cause?: unknown): RelayProtocolError {
  return new RelayProtocolError('malformed_message', message, { cause })
}

function connectionFailure(cause: unknown): RelayProtocolError {
  return new RelayProtocolError(
    'connection_failed',
    'Relay connection failed',
    {
      cause,
    },
  )
}
