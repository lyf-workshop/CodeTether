import { StringDecoder } from 'node:string_decoder'

/** Frames UTF-8, newline-delimited protocol messages across arbitrary chunks. */
export class JsonRpcLineDecoder {
  readonly #decoder = new StringDecoder('utf8')
  #buffer = ''

  push(chunk: Uint8Array | string): string[] {
    this.#buffer += this.#decoder.write(Buffer.from(chunk))
    return this.#drainCompleteLines()
  }

  end(): string[] {
    this.#buffer += this.#decoder.end()
    const lines = this.#drainCompleteLines()
    const finalLine = this.#buffer.endsWith('\r')
      ? this.#buffer.slice(0, -1)
      : this.#buffer

    this.#buffer = ''
    if (finalLine.trim().length > 0) {
      lines.push(finalLine)
    }
    return lines
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
