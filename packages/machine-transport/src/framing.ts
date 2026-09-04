import type { Duplex } from 'node:stream'

import type { z } from 'zod'

import { machineTransportLimits } from './constants.js'
import { MachineTransportError } from './errors.js'

const fatalUtf8Decoder = new TextDecoder('utf-8', { fatal: true })

export class MachineFrameDecoder {
  #buffer = Buffer.alloc(0)

  push(chunk: Buffer): unknown[] {
    if (chunk.length === 0) return []
    const values: unknown[] = []
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
      if (length === 0 || length > machineTransportLimits.maximumFrameBytes) {
        throw malformed('Machine frame length is invalid')
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
      let text: string
      try {
        text = fatalUtf8Decoder.decode(body)
      } catch (error) {
        throw malformed('Machine frame is not valid UTF-8', error)
      }
      try {
        values.push(JSON.parse(text) as unknown)
      } catch (error) {
        throw malformed('Machine frame is not valid JSON', error)
      }
      this.#buffer = Buffer.alloc(0)
      if (values.length > machineTransportLimits.maximumQueuedFrames + 1) {
        throw malformed('Machine message queue exceeded its bound')
      }
    }
    return values
  }

  finish(): void {
    if (this.#buffer.length !== 0) {
      throw malformed('Machine connection ended with an incomplete frame')
    }
  }

  #appendResidual(bytes: Buffer): void {
    if (bytes.length === 0) return
    if (
      this.#buffer.length + bytes.length >
      machineTransportLimits.maximumBufferedBytes
    ) {
      throw malformed('Machine frame buffer exceeded its bound')
    }
    this.#buffer = Buffer.concat([this.#buffer, bytes])
  }
}

export function encodeMachineFrame(value: unknown): Buffer {
  const json = JSON.stringify(value)
  if (json === undefined)
    throw new TypeError('Machine message must be JSON serializable')
  const body = Buffer.from(json, 'utf8')
  if (
    body.length === 0 ||
    body.length > machineTransportLimits.maximumFrameBytes
  ) {
    throw new RangeError('Machine message exceeds the frame bound')
  }
  const frame = Buffer.allocUnsafe(body.length + 4)
  frame.writeUInt32BE(body.length, 0)
  body.copy(frame, 4)
  return frame
}

export class FramedMachineConnection {
  readonly #stream: Duplex
  readonly #decoder = new MachineFrameDecoder()
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
        this.#fail(error instanceof Error ? error : new Error(String(error)))
      }
    })
    stream.once('error', (error) => this.#fail(connectionFailure(error)))
    stream.once('end', () => {
      try {
        this.#decoder.finish()
        this.#fail(
          new MachineTransportError(
            'connection_failed',
            'Machine connection ended',
          ),
        )
      } catch (error) {
        this.#fail(error instanceof Error ? error : new Error(String(error)))
      }
    })
    stream.once('close', () => {
      this.#closed = true
      this.#fail(
        new MachineTransportError(
          'connection_failed',
          'Machine connection closed',
        ),
      )
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
    if (this.#failure !== undefined) throw this.#failure
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      this.destroy(malformed('Machine message failed strict validation'))
      throw malformed('Machine message failed strict validation')
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
    if (this.#pendingSends >= machineTransportLimits.maximumQueuedFrames) {
      const error = new MachineTransportError(
        'connection_failed',
        'Machine send queue exceeded its bound',
      )
      this.#fail(error)
      throw error
    }
    const frame = encodeMachineFrame(value)
    this.#pendingSends += 1
    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false
        const timeoutMs =
          options.timeoutMs ?? machineTransportLimits.messageTimeoutMs
        const settle = (error?: Error) => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          options.signal?.removeEventListener('abort', abort)
          if (error === undefined) resolve()
          else {
            this.#fail(error)
            reject(error)
          }
        }
        const abort = () =>
          settle(
            new MachineTransportError(
              'connection_failed',
              'Machine send was cancelled',
            ),
          )
        const timeout = setTimeout(
          () =>
            settle(
              new MachineTransportError('timeout', 'Machine send timed out'),
            ),
          timeoutMs,
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
        ? machineTransportLimits.messageTimeoutMs
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
          : setTimeout(() => {
              waiter.reject(
                new MachineTransportError(
                  'timeout',
                  'Machine message timed out',
                ),
              )
            }, timeoutMs)
      const abort = () => {
        waiter.reject(
          new MachineTransportError(
            'connection_failed',
            'Machine request was cancelled',
          ),
        )
      }
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
    if (this.#queue.length >= machineTransportLimits.maximumQueuedFrames) {
      this.#fail(malformed('Machine message queue exceeded its bound'))
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

function malformed(message: string, cause?: unknown): MachineTransportError {
  return new MachineTransportError('malformed_message', message, { cause })
}

function connectionFailure(cause: unknown): MachineTransportError {
  return new MachineTransportError(
    'connection_failed',
    'Machine connection failed',
    { cause },
  )
}
