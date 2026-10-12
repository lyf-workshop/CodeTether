import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  mkdirSync,
  openSync,
  writeSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

export type HostPresenceDiagnosticEvent =
  | 'PRESENCE_PUBLISHER_START'
  | 'PRESENCE_CONFIG_READY'
  | 'PRESENCE_INITIAL_PUBLISH_START'
  | 'PRESENCE_SIGN_START'
  | 'PRESENCE_SIGN_OK'
  | 'PRESENCE_JWS_CREATED'
  | 'PRESENCE_HTTP_START'
  | 'PRESENCE_HTTP_RESULT'
  | 'PRESENCE_RENEWAL_SCHEDULED'
  | 'PRESENCE_RETRY_SCHEDULED'
  | 'PRESENCE_PUBLISHER_SKIP'
  | 'PRESENCE_PUBLISHER_STOP'
  | 'PRESENCE_ERROR'

export type HostPresenceErrorCategory =
  | 'configuration_missing'
  | 'signing'
  | 'jws_validation'
  | 'http_rejected'
  | 'network_timeout'
  | 'network_error'
  | 'unknown'

export interface HostPresenceDiagnosticFields {
  readonly hostId?: string
  readonly generation?: number
  readonly endpointOrigin?: string
  readonly authMode?: 'host_es256_jws'
  readonly statusClass?: '2xx' | '3xx' | '4xx' | '5xx' | 'other'
  readonly errorCategory?: HostPresenceErrorCategory
  readonly retryDelayMs?: number
}

const MAX_LOG_BYTES = 256 * 1024

/**
 * Writes a deliberately narrow local trace for Host-owned Presence only.
 * The file is bounded, user-readable, owner-only, and never contains envelopes
 * or exception text. Failure to write diagnostics never changes liveness.
 */
export class HostPresenceDiagnostics {
  readonly #path: string | undefined

  constructor(databasePath?: string) {
    this.#path =
      databasePath === undefined
        ? undefined
        : join(dirname(databasePath), 'logs', 'host-presence.jsonl')
  }

  record(
    event: HostPresenceDiagnosticEvent,
    fields: HostPresenceDiagnosticFields = {},
  ): void {
    const record = {
      component: 'host',
      event,
      observedAt: new Date().toISOString(),
      ...sanitizeFields(fields),
    }
    const line = `${JSON.stringify(record)}\n`
    try {
      process.stderr.write(line)
    } catch {
      // Diagnostics must never become a Host runtime dependency.
    }
    this.#append(line)
  }

  #append(line: string): void {
    if (this.#path === undefined) return
    let descriptor: number | undefined
    try {
      const directory = dirname(this.#path)
      mkdirSync(directory, { recursive: true, mode: 0o700 })
      const noFollow = constants.O_NOFOLLOW ?? 0
      descriptor = openSync(
        this.#path,
        constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | noFollow,
        0o600,
      )
      const stat = fstatSync(descriptor)
      if (
        !stat.isFile() ||
        (typeof process.getuid === 'function' &&
          stat.uid !== process.getuid()) ||
        stat.size + Buffer.byteLength(line, 'utf8') > MAX_LOG_BYTES
      ) {
        return
      }
      fchmodSync(descriptor, 0o600)
      writeSync(descriptor, line, undefined, 'utf8')
    } catch {
      // Missing/unwritable local diagnostics must not affect Host liveness.
    } finally {
      if (descriptor !== undefined) {
        try {
          closeSync(descriptor)
        } catch {
          // Nothing to recover; this is a best-effort diagnostic sink.
        }
      }
    }
  }
}

function sanitizeFields(
  fields: HostPresenceDiagnosticFields,
): HostPresenceDiagnosticFields {
  const result: {
    hostId?: string
    generation?: number
    endpointOrigin?: string
    authMode?: 'host_es256_jws'
    statusClass?: '2xx' | '3xx' | '4xx' | '5xx' | 'other'
    errorCategory?: HostPresenceErrorCategory
    retryDelayMs?: number
  } = {}
  if (
    fields.hostId !== undefined &&
    /^host_[A-Za-z0-9_-]{16,96}$/u.test(fields.hostId)
  )
    result.hostId = fields.hostId
  if (
    fields.generation !== undefined &&
    Number.isSafeInteger(fields.generation) &&
    fields.generation > 0
  ) {
    result.generation = fields.generation
  }
  if (fields.endpointOrigin !== undefined) {
    try {
      const origin = new URL(fields.endpointOrigin)
      if (
        origin.origin === fields.endpointOrigin &&
        origin.protocol === 'https:'
      )
        result.endpointOrigin = origin.origin
    } catch {
      // Invalid origins are intentionally omitted from diagnostics.
    }
  }
  if (fields.authMode === 'host_es256_jws') result.authMode = fields.authMode
  if (
    fields.statusClass === '2xx' ||
    fields.statusClass === '3xx' ||
    fields.statusClass === '4xx' ||
    fields.statusClass === '5xx' ||
    fields.statusClass === 'other'
  ) {
    result.statusClass = fields.statusClass
  }
  if (
    fields.errorCategory === 'configuration_missing' ||
    fields.errorCategory === 'signing' ||
    fields.errorCategory === 'jws_validation' ||
    fields.errorCategory === 'http_rejected' ||
    fields.errorCategory === 'network_timeout' ||
    fields.errorCategory === 'network_error' ||
    fields.errorCategory === 'unknown'
  ) {
    result.errorCategory = fields.errorCategory
  }
  if (
    fields.retryDelayMs !== undefined &&
    Number.isSafeInteger(fields.retryDelayMs) &&
    fields.retryDelayMs >= 0 &&
    fields.retryDelayMs <= 60_000
  ) {
    result.retryDelayMs = fields.retryDelayMs
  }
  return result
}
