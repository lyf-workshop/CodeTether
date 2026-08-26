export interface ServerSentEventFrame {
  readonly id: string
  readonly event: string
  readonly data: string
}

export interface ServerSentEventParserOptions {
  readonly maxFrameBytes?: number
}

const DEFAULT_MAX_FRAME_BYTES = 10 * 1024 * 1024

export class ServerSentEventLimitError extends Error {
  constructor(readonly maxFrameBytes: number) {
    super(`Server-Sent Event exceeded the ${String(maxFrameBytes)} byte limit`)
    this.name = 'ServerSentEventLimitError'
  }
}

/** Incrementally frames UTF-8 Server-Sent Events across arbitrary chunks. */
export class ServerSentEventParser {
  readonly #decoder = new TextDecoder()
  readonly #encoder = new TextEncoder()
  readonly #maxFrameBytes: number
  #text = ''
  #unprocessedBytes = 0
  #frameBytes = 0
  #dataLines: string[] = []
  #eventType = ''
  #lastEventId = ''
  #atStart = true
  #finished = false

  constructor(options: ServerSentEventParserOptions = {}) {
    this.#maxFrameBytes = positiveInteger(
      options.maxFrameBytes,
      DEFAULT_MAX_FRAME_BYTES,
      'maxFrameBytes',
    )
  }

  push(chunk: Uint8Array): readonly ServerSentEventFrame[] {
    if (this.#finished) {
      throw new Error('Cannot push to a finished Server-Sent Event parser')
    }
    return this.#consume(this.#decoder.decode(chunk, { stream: true }), false)
  }

  finish(): readonly ServerSentEventFrame[] {
    if (this.#finished) return []
    this.#finished = true
    return this.#consume(this.#decoder.decode(), true)
  }

  #consume(text: string, final: boolean): readonly ServerSentEventFrame[] {
    if (this.#atStart && text.length > 0) {
      this.#atStart = false
      const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
      this.#text += withoutBom
      this.#unprocessedBytes += this.#encodedBytes(withoutBom)
    } else {
      this.#text += text
      this.#unprocessedBytes += this.#encodedBytes(text)
    }

    const frames: ServerSentEventFrame[] = []
    while (this.#text.length > 0) {
      const lineEnding = findLineEnding(this.#text)
      if (lineEnding === -1) break
      if (
        this.#text[lineEnding] === '\r' &&
        lineEnding === this.#text.length - 1 &&
        !final
      ) {
        break
      }

      const line = this.#text.slice(0, lineEnding)
      const lineEndingLength =
        this.#text[lineEnding] === '\r' && this.#text[lineEnding + 1] === '\n'
          ? 2
          : 1
      const consumed = this.#text.slice(0, lineEnding + lineEndingLength)
      const consumedBytes = this.#encodedBytes(consumed)
      this.#unprocessedBytes -= consumedBytes
      this.#frameBytes += consumedBytes
      this.#assertProcessedFrameWithinLimit()
      this.#text = this.#text.slice(lineEnding + lineEndingLength)
      const frame = this.#processLine(line)
      if (frame !== undefined) frames.push(frame)
    }

    this.#assertWithinLimit()

    if (final && this.#text.length > 0) {
      this.#frameBytes += this.#unprocessedBytes
      this.#unprocessedBytes = 0
      this.#assertWithinLimit()
      const frame = this.#processLine(this.#text)
      this.#text = ''
      if (frame !== undefined) frames.push(frame)
    }
    return frames
  }

  #processLine(line: string): ServerSentEventFrame | undefined {
    if (line.length === 0) return this.#dispatch()
    if (line.startsWith(':')) return undefined

    const separator = line.indexOf(':')
    const field = separator === -1 ? line : line.slice(0, separator)
    let value = separator === -1 ? '' : line.slice(separator + 1)
    if (value.startsWith(' ')) value = value.slice(1)

    switch (field) {
      case 'data':
        this.#dataLines.push(value)
        break
      case 'event':
        this.#eventType = value
        break
      case 'id':
        if (!value.includes('\u0000')) this.#lastEventId = value
        break
      default:
        // Unknown fields and `retry` are intentionally caller-controlled.
        break
    }
    return undefined
  }

  #dispatch(): ServerSentEventFrame | undefined {
    this.#frameBytes = 0
    if (this.#dataLines.length === 0) {
      this.#eventType = ''
      return undefined
    }
    const frame: ServerSentEventFrame = {
      id: this.#lastEventId,
      event: this.#eventType.length > 0 ? this.#eventType : 'message',
      data: this.#dataLines.join('\n'),
    }
    this.#dataLines = []
    this.#eventType = ''
    return frame
  }

  #assertWithinLimit(): void {
    if (this.#frameBytes + this.#unprocessedBytes > this.#maxFrameBytes) {
      throw new ServerSentEventLimitError(this.#maxFrameBytes)
    }
  }

  #assertProcessedFrameWithinLimit(): void {
    if (this.#frameBytes > this.#maxFrameBytes) {
      throw new ServerSentEventLimitError(this.#maxFrameBytes)
    }
  }

  #encodedBytes(value: string): number {
    return this.#encoder.encode(value).byteLength
  }
}

function findLineEnding(value: string): number {
  const carriageReturn = value.indexOf('\r')
  const lineFeed = value.indexOf('\n')
  if (carriageReturn === -1) return lineFeed
  if (lineFeed === -1) return carriageReturn
  return Math.min(carriageReturn, lineFeed)
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return resolved
}
