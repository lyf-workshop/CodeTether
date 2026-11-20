import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { dirname } from 'node:path'

export const LOCAL_LOG_MAX_FILE_BYTES = 256 * 1024
export const LOCAL_LOG_MAX_FILES = 8

interface BoundedLocalJsonlOptions {
  readonly maxFileBytes?: number
  readonly maxFiles?: number
}

/** Best-effort, owner-only append for already sanitized JSON lines. */
export class BoundedLocalJsonl {
  readonly #path: string | undefined
  readonly #maxFileBytes: number
  readonly #maxFiles: number

  constructor(
    path: string | undefined,
    options: BoundedLocalJsonlOptions = {},
  ) {
    this.#path = path
    this.#maxFileBytes = options.maxFileBytes ?? LOCAL_LOG_MAX_FILE_BYTES
    this.#maxFiles = options.maxFiles ?? LOCAL_LOG_MAX_FILES
  }

  append(line: string): void {
    if (this.#path === undefined || !line.endsWith('\n')) return
    const bytes = Buffer.from(line, 'utf8')
    if (
      bytes.length > this.#maxFileBytes ||
      line.slice(0, -1).includes('\n') ||
      line.slice(0, -1).includes('\r')
    ) {
      return
    }
    let descriptor: number | undefined
    try {
      mkdirSync(dirname(this.#path), { recursive: true, mode: 0o700 })
      descriptor = this.#open()
      if (descriptor === undefined) return
      const stat = fstatSync(descriptor)
      if (stat.size + bytes.length > this.#maxFileBytes) {
        closeSync(descriptor)
        descriptor = undefined
        if (!this.#rotate()) return
        descriptor = this.#open()
        if (descriptor === undefined) return
      }
      let offset = 0
      while (offset < bytes.length) {
        const written = writeSync(
          descriptor,
          bytes,
          offset,
          bytes.length - offset,
        )
        if (written <= 0) return
        offset += written
      }
    } catch {
      // Diagnostics must never affect the Host's product behavior.
    } finally {
      if (descriptor !== undefined) {
        try {
          closeSync(descriptor)
        } catch {
          // This is a best-effort local sink.
        }
      }
    }
  }

  #open(): number | undefined {
    let descriptor: number | undefined
    try {
      descriptor = openSync(
        this.#path!,
        constants.O_WRONLY |
          constants.O_APPEND |
          constants.O_CREAT |
          (constants.O_NOFOLLOW ?? 0),
        0o600,
      )
      const stat = fstatSync(descriptor)
      if (
        !stat.isFile() ||
        (typeof process.getuid === 'function' && stat.uid !== process.getuid())
      ) {
        return undefined
      }
      fchmodSync(descriptor, 0o600)
      const opened = descriptor
      descriptor = undefined
      return opened
    } catch {
      return undefined
    } finally {
      if (descriptor !== undefined) {
        try {
          closeSync(descriptor)
        } catch {
          // Best effort.
        }
      }
    }
  }

  #rotate(): boolean {
    if (this.#path === undefined) return false
    try {
      try {
        unlinkSync(`${this.#path}.${this.#maxFiles - 1}`)
      } catch {
        // The oldest generation may not exist yet.
      }
      for (let index = this.#maxFiles - 2; index >= 1; index--) {
        try {
          renameSync(`${this.#path}.${index}`, `${this.#path}.${index + 1}`)
        } catch {
          // Missing older generations are normal during early rotation.
        }
      }
      renameSync(this.#path, `${this.#path}.1`)
      return true
    } catch {
      return false
    }
  }
}
