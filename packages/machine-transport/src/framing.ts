import type { Duplex } from 'node:stream'

import type { z } from 'zod'

import { machineTransportLimits } from './constants.js'
import { MachineTransportError } from './errors.js'

const fatalUtf8Decoder = new TextDecoder('utf-8', { fatal: true })

export class MachineFrameDecoder {
  #buffer = Buffer.alloc(0)

  push(chunk: Buffer): unknown[] {
    if (chunk.length === 0) return []
    if (
      this.#buffer.length + chunk.length >
      machineTransportLimits.maximumBufferedBytes
    ) {
      throw malformed('Machine frame buffer exceeded its bound')
    }
    this.#buffer = Buffer.concat([this.#buffer, chunk])
    const values: unknown[] = []
    while (this.#buffer.length >= 4) {
      const length = this.#buffer.readUInt32BE(0)
      if (length === 0 || length > machineTransportLimits.maximumFrameBytes) {
        throw malformed('Machine frame length is invalid')
      }
      if (this.#buffer.length < length + 4) break
      const body = this.#buffer.subarray(4, length + 4)
      this.#buffer = this.#buffer.subarray(length + 4)
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
    }
    return values
  }

  finish(): void {
    if (this.#buffer.length !== 0) {
      throw malformed('Machine connection ended with an incomplete frame')
    }
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
    return this.#closed
  }

  async receive<T>(
    schema: z.ZodType<T>,
    options: {
      readonly timeoutMs?: number
      readonly signal?: AbortSignal
    } = {},
  ): Promise<T> {
    const raw = await this.#next(options)
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      this.destroy(malformed('Machine message failed strict validation'))
      throw malformed('Machine message failed strict validation')
    }
    return parsed.data
  }

  async send(value: unknown): Promise<void> {
    if (this.#failure !== undefined) throw this.#failure
    const frame = encodeMachineFrame(value)
    await new Promise<void>((resolve, reject) => {
      this.#stream.write(frame, (error) => {
        if (error === null || error === undefined) resolve()
        else reject(connectionFailure(error))
      })
    })
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
    readonly timeoutMs?: number
    readonly signal?: AbortSignal
  }): Promise<unknown> {
    if (this.#queue.length > 0) return this.#queue.shift()
    if (this.#failure !== undefined) throw this.#failure
    const timeoutMs =
      options.timeoutMs ?? machineTransportLimits.messageTimeoutMs
    return await new Promise<unknown>((resolve, reject) => {
      let settled = false
      const waiter = {
        resolve: (value: unknown) => settle(() => resolve(value)),
        reject: (error: Error) => settle(() => reject(error)),
      }
      const timeout = setTimeout(() => {
        waiter.reject(
          new MachineTransportError('timeout', 'Machine message timed out'),
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
        clearTimeout(timeout)
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
