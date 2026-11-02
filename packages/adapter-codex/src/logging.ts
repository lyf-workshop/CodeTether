import type { CanonicalFailureReason } from '@codetether/agent-core'

import type {
  JsonRpcId,
  JsonRpcIncoming,
  JsonRpcNotification,
  JsonRpcRequest,
} from './protocol.js'
import { isRecord } from './protocol.js'

export interface ProtocolLogEntry {
  readonly direction: 'send' | 'receive'
  readonly timestamp: string
  readonly id?: JsonRpcId
  readonly method?: string
}

export type ProtocolLogger = (entry: ProtocolLogEntry) => void

const SECRET_KEY = /authorization|credential|password|secret|token|api.?key/i
const FAILURE_VARIANT = /^[A-Za-z][A-Za-z0-9]{0,63}$/u

/** Local diagnostics only: never serialize Provider prose, details or identity. */
export function logCodexFailure(
  codexErrorInfo: unknown,
  reason: CanonicalFailureReason,
): void {
  const entries = isRecord(codexErrorInfo) ? Object.entries(codexErrorInfo) : []
  const entry = entries.length === 1 ? entries[0] : undefined
  const candidate =
    typeof codexErrorInfo === 'string' ? codexErrorInfo : entry?.[0]
  const variant =
    typeof candidate === 'string' &&
    FAILURE_VARIANT.exec(candidate)?.[0] === candidate
      ? candidate
      : 'unknown'
  const details = entry?.[1]
  const status = isRecord(details) ? details.httpStatusCode : undefined
  const httpStatus =
    typeof status === 'number' && Number.isInteger(status)
      ? String(status)
      : 'none'
  try {
    process.stderr.write(
      `[codex:failure] variant=${variant} httpStatus=${httpStatus} reason=${reason}\n`,
    )
  } catch {
    // A failed diagnostic sink must not change terminal failure semantics.
  }
}

export function redactProtocolValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[depth-limited]'
  if (Array.isArray(value)) {
    return value.map((item) => redactProtocolValue(item, depth + 1))
  }
  if (!isRecord(value)) return value

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      SECRET_KEY.test(key)
        ? '[redacted]'
        : redactProtocolValue(nested, depth + 1),
    ]),
  )
}

export function createStderrProtocolLogger(): ProtocolLogger {
  return (entry) => {
    const parts = [
      entry.timestamp,
      entry.direction === 'send' ? '→' : '←',
      entry.direction === 'send' ? (entry.method ?? 'response') : 'frame',
    ]
    if (entry.direction === 'send' && entry.id !== undefined) {
      parts.push(`id=${String(entry.id)}`)
    }
    process.stderr.write(`[codex:protocol] ${parts.join(' ')}\n`)
  }
}

export function protocolLogEntry(
  direction: ProtocolLogEntry['direction'],
  message: JsonRpcIncoming | JsonRpcRequest | JsonRpcNotification,
): ProtocolLogEntry {
  if (direction === 'receive') {
    return {
      direction,
      timestamp: new Date().toISOString(),
    }
  }
  const record = message as unknown as Record<string, unknown>
  const id = safeProtocolId(record.id)
  const method = safeProtocolMethod(record.method)
  return {
    direction,
    timestamp: new Date().toISOString(),
    ...(id === undefined ? {} : { id }),
    ...(method === undefined ? {} : { method }),
  }
}

function safeProtocolId(value: unknown): JsonRpcId | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/u.test(value)) {
    return undefined
  }
  return value
}

function safeProtocolMethod(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9._/-]{1,128}$/u.test(value)
    ? value
    : undefined
}
