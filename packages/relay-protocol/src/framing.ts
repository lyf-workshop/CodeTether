import type { Duplex } from 'node:stream'

import type { z } from 'zod'

import { relayProtocolLimits } from './constants.js'
import { RelayProtocolError } from './errors.js'

const fatalUtf8Decoder = new TextDecoder('utf-8', { fatal: true })

export class RelayFrameDecoder {
  #buffer = Buffer.alloc(0)

  push(chunk: Buffer): unknown[] {
    if (chunk.length === 0) return []
    if (
      this.#buffer.length + chunk.length >
      relayProtocolLimits.maximumBufferedBytes
    ) {
      throw malformed('Relay frame buffer exceeded its bound')
    }
    this.#buffer = Buffer.concat([this.#buffer, chunk])
    const values: unknown[] = []
    while (this.#buffer.length >= 4) {
      const length = this.#buffer.readUInt32BE(0)
      if (length === 0 || length > relayProtocolLimits.maximumFrameBytes) {
        throw malformed('Relay frame length is invalid')
      }
      if (this.#buffer.length < length + 4) break
      const body = this.#buffer.subarray(4, length + 4)
      this.#buffer = this.#buffer.subarray(length + 4)
      try {
        values.push(JSON.parse(fatalUtf8Decoder.decode(body)) as unknown)
      } catch (error) {
        throw malformed('Relay frame is not valid UTF-8 JSON', error)
      }
    }
    return values
  }

  finish(): void {
    if (this.#buffer.length !== 0) {
      throw malformed('Relay connection ended with an incomplete frame')
    }
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
  readonly #queue: unknown[] = []
  readonly #waiters: Array<{
    resolve: (value: unknown) => void
    reject: (error: Error) => void
  }> = []
  #failure: Error | undefined
  #closed = false
  #pendingSends = 0

  constructor(stream: Duplex) {
    this.#stream = stream
    stream.on('data', (chunk: Buffer | string) => {
      try {
        const values = this.#decoder.push(
          typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk,
        )
        for (const value of values) this.#enqueue(value)
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
    if (this.#queue.length > 0) return this.#queue.shift()
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

  #enqueue(value: unknown): void {
    if (this.#failure !== undefined) return
    const waiter = this.#waiters.shift()
    if (waiter !== undefined) {
      waiter.resolve(value)
      return
    }
    if (this.#queue.length >= relayProtocolLimits.maximumQueuedFrames) {
      this.#fail(malformed('Relay receive queue exceeded its bound'))
      return
    }
    this.#queue.push(value)
  }

  #fail(error: Error): void {
    if (this.#failure !== undefined) return
    this.#failure = error
    this.#queue.length = 0
    for (const waiter of this.#waiters.splice(0)) waiter.reject(error)
    if (!this.#stream.destroyed) this.#stream.destroy()
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
