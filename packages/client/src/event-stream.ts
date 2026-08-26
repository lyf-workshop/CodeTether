import {
  HostEventEnvelopeSchema,
  LastEventIdSchema,
  parseLastEventId,
  type EventCursor,
  type HostEventEnvelope,
  type LastEventId,
} from '@codetether/protocol'

import { CodeTetherProtocolError } from './errors.js'
import {
  ServerSentEventLimitError,
  ServerSentEventParser,
} from './sse-parser.js'

export class CodeTetherEventStream implements AsyncIterable<HostEventEnvelope> {
  readonly #body: ReadableStream<Uint8Array>
  readonly #controller: AbortController
  readonly #detachExternalSignal: () => void
  readonly #maxFrameBytes?: number
  #reader?: ReadableStreamDefaultReader<Uint8Array>
  #consumed = false
  #closed = false
  #lastEventId?: LastEventId
  #cursor?: EventCursor
  #receivedEvent = false

  constructor(
    body: ReadableStream<Uint8Array>,
    controller: AbortController,
    detachExternalSignal: () => void,
    initialLastEventId?: LastEventId,
    maxFrameBytes?: number,
  ) {
    this.#body = body
    this.#controller = controller
    this.#detachExternalSignal = detachExternalSignal
    this.#lastEventId = initialLastEventId
    this.#cursor = parseLastEventId(initialLastEventId) ?? undefined
    this.#maxFrameBytes = maxFrameBytes
  }

  get lastEventId(): LastEventId | undefined {
    return this.#lastEventId
  }

  [Symbol.asyncIterator](): AsyncIterator<HostEventEnvelope> {
    if (this.#consumed) {
      throw new Error('A CodeTether event stream can only be consumed once')
    }
    this.#consumed = true
    const iterator = this.#iterate()
    let pendingNext: Promise<IteratorResult<HostEventEnvelope>> | undefined
    return {
      next: () => {
        const pending = iterator.next()
        pendingNext = pending
        const clearPending = (): void => {
          if (pendingNext === pending) pendingNext = undefined
        }
        void pending.then(clearPending, clearPending)
        return pending
      },
      return: async () => {
        await this.close()
        await pendingNext?.catch(() => undefined)
        await iterator.return(undefined)
        return { done: true, value: undefined }
      },
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    this.#controller.abort()
    this.#detachExternalSignal()
    await this.#reader?.cancel().catch(() => undefined)
  }

  async *#iterate(): AsyncGenerator<HostEventEnvelope> {
    const parser = new ServerSentEventParser({
      ...(this.#maxFrameBytes === undefined
        ? {}
        : { maxFrameBytes: this.#maxFrameBytes }),
    })
    const reader = this.#body.getReader()
    this.#reader = reader
    let completed = false
    try {
      while (!this.#closed) {
        let result
        try {
          result = await reader.read()
        } catch (error) {
          if (this.#closed) break
          throw error
        }
        if (result.done) break
        const frames = normalizeParserLimit(() => parser.push(result.value))
        for (const frame of frames) {
          yield this.#parseFrame(frame)
        }
      }
      if (!this.#closed) {
        for (const frame of normalizeParserLimit(() => parser.finish())) {
          yield this.#parseFrame(frame)
        }
      }
      completed = true
    } finally {
      this.#closed = true
      this.#detachExternalSignal()
      if (!completed) await reader.cancel().catch(() => undefined)
      reader.releaseLock()
      this.#reader = undefined
    }
  }

  #parseFrame(frame: {
    readonly id: string
    readonly event: string
    readonly data: string
  }): HostEventEnvelope {
    let payload: unknown
    try {
      payload = JSON.parse(frame.data)
    } catch (error) {
      throw new CodeTetherProtocolError(
        'CodeTether event stream returned invalid JSON',
        { cause: error },
      )
    }

    let event: HostEventEnvelope
    try {
      event = HostEventEnvelopeSchema.parse(payload)
    } catch (error) {
      throw new CodeTetherProtocolError(
        'CodeTether event stream returned an invalid event envelope',
        { cause: error },
      )
    }
    if (frame.event !== event.type) {
      throw new CodeTetherProtocolError(
        'Server-Sent Event type does not match the CodeTether event envelope',
      )
    }
    if (frame.id.length === 0 || frame.id !== event.eventId) {
      throw new CodeTetherProtocolError(
        'Server-Sent Event id does not match the CodeTether event envelope',
      )
    }
    if (event.type === 'stream.reset' && this.#receivedEvent) {
      throw new CodeTetherProtocolError(
        'stream.reset must be the first event on a recovery stream',
      )
    }
    const previous = this.#cursor
    const isInitialReset = !this.#receivedEvent && event.type === 'stream.reset'
    if (
      previous !== undefined &&
      !isInitialReset &&
      (event.epoch !== previous.epoch || event.seq !== previous.seq + 1)
    ) {
      throw new CodeTetherProtocolError(
        'CodeTether event stream sequence is not contiguous with its cursor',
      )
    }
    this.#receivedEvent = true
    this.#cursor = { epoch: event.epoch, seq: event.seq }
    this.#lastEventId = LastEventIdSchema.parse(event.eventId)
    return event
  }
}

function normalizeParserLimit<T>(parse: () => T): T {
  try {
    return parse()
  } catch (error) {
    if (error instanceof ServerSentEventLimitError) {
      throw new CodeTetherProtocolError(
        'CodeTether event stream exceeded its inbound frame limit',
        { cause: error },
      )
    }
    throw error
  }
}

export function linkedAbortController(signal?: AbortSignal): {
  readonly controller: AbortController
  readonly detach: () => void
} {
  const controller = new AbortController()
  if (signal === undefined) return { controller, detach: () => undefined }

  const abort = (): void => controller.abort(signal.reason)
  if (signal.aborted) abort()
  else signal.addEventListener('abort', abort, { once: true })
  return {
    controller,
    detach: () => signal.removeEventListener('abort', abort),
  }
}
