import { StringDecoder } from 'node:string_decoder'

import { JsonRpcLineTooLongError } from './errors.js'

export const DEFAULT_JSON_RPC_MAX_LINE_BYTES = 16 * 1024 * 1024

export interface JsonRpcLineDecoderOptions {
  readonly maxLineBytes?: number
}

/** Frames UTF-8, newline-delimited protocol messages across arbitrary chunks. */
export class JsonRpcLineDecoder {
  readonly #decoder = new StringDecoder('utf8')
  readonly #maxLineBytes: number
  #buffer = ''
  #lineBytes = 0
  #lastLineByte?: number

  constructor(options: JsonRpcLineDecoderOptions = {}) {
    const maxLineBytes = options.maxLineBytes ?? DEFAULT_JSON_RPC_MAX_LINE_BYTES
    if (!Number.isSafeInteger(maxLineBytes) || maxLineBytes <= 0) {
      throw new RangeError('maxLineBytes must be a positive safe integer')
    }
    this.#maxLineBytes = maxLineBytes
  }

  push(chunk: Uint8Array | string): string[] {
    const input = Buffer.from(chunk)
    const lines: string[] = []
    let offset = 0
    let newlineIndex = input.indexOf(0x0a, offset)

    while (newlineIndex >= 0) {
      const framedChunk = input.subarray(offset, newlineIndex + 1)
      this.#trackLineBytes(framedChunk.subarray(0, -1))
      this.#buffer += this.#decoder.write(framedChunk)
      lines.push(...this.#drainCompleteLines())
      this.#lineBytes = 0
      this.#lastLineByte = undefined
      offset = newlineIndex + 1
      newlineIndex = input.indexOf(0x0a, offset)
    }

    const remainder = input.subarray(offset)
    if (remainder.length > 0) {
      this.#trackLineBytes(remainder)
      this.#buffer += this.#decoder.write(remainder)
    }

    return lines
  }

  end(): string[] {
    this.#buffer += this.#decoder.end()
    const lines = this.#drainCompleteLines()
    const finalLine = this.#buffer.endsWith('\r')
      ? this.#buffer.slice(0, -1)
      : this.#buffer

    this.#buffer = ''
    this.#lineBytes = 0
    this.#lastLineByte = undefined
    if (finalLine.trim().length > 0) {
      lines.push(finalLine)
    }
    return lines
  }

  #trackLineBytes(chunk: Uint8Array): void {
    this.#lineBytes += chunk.byteLength
    if (chunk.byteLength > 0) {
      this.#lastLineByte = chunk[chunk.byteLength - 1]
    }

    const contentBytes =
      this.#lastLineByte === 0x0d ? this.#lineBytes - 1 : this.#lineBytes
    if (contentBytes > this.#maxLineBytes) {
      throw new JsonRpcLineTooLongError(this.#maxLineBytes, contentBytes)
    }
  }

  #drainCompleteLines(): string[] {
    const lines: string[] = []
    let newlineIndex = this.#buffer.indexOf('\n')

    while (newlineIndex >= 0) {
      const rawLine = this.#buffer.slice(0, newlineIndex)
      this.#buffer = this.#buffer.slice(newlineIndex + 1)
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
      if (line.trim().length > 0) {
        lines.push(line)
      }
      newlineIndex = this.#buffer.indexOf('\n')
    }

    return lines
  }
}
