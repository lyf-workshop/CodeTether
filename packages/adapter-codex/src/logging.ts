import type {
  JsonRpcId,
  JsonRpcIncoming,
  JsonRpcNotification,
  JsonRpcRequest,
} from './protocol.js'
import { isRecord, readString } from './protocol.js'

export interface ProtocolLogEntry {
  readonly direction: 'send' | 'receive'
  readonly timestamp: string
  readonly id?: JsonRpcId
  readonly method?: string
  readonly threadId?: string
  readonly turnId?: string
  readonly payload?: unknown
}

export type ProtocolLogger = (entry: ProtocolLogEntry) => void

const SECRET_KEY = /authorization|credential|password|secret|token|api.?key/i

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

export function createStderrProtocolLogger(options?: {
  readonly includePayload?: boolean
}): ProtocolLogger {
  return (entry) => {
    const parts = [
      entry.timestamp,
      entry.direction === 'send' ? '→' : '←',
      entry.method ?? 'response',
    ]
    if (entry.id !== undefined) parts.push(`id=${String(entry.id)}`)
    if (entry.threadId !== undefined) parts.push(`thread=${entry.threadId}`)
    if (entry.turnId !== undefined) parts.push(`turn=${entry.turnId}`)
    if (options?.includePayload === true && entry.payload !== undefined) {
      parts.push(JSON.stringify(redactProtocolValue(entry.payload)))
    }
    process.stderr.write(`[codex:protocol] ${parts.join(' ')}\n`)
  }
}

export function protocolLogEntry(
  direction: ProtocolLogEntry['direction'],
  message: JsonRpcIncoming | JsonRpcRequest | JsonRpcNotification,
): ProtocolLogEntry {
  const record = message as unknown as Record<string, unknown>
  const params = isRecord(record.params) ? record.params : undefined
  const result = isRecord(record.result) ? record.result : undefined
  const thread =
    result !== undefined && isRecord(result.thread) ? result.thread : undefined
  const turn =
    result !== undefined && isRecord(result.turn) ? result.turn : undefined
  const paramsThread =
    params !== undefined && isRecord(params.thread) ? params.thread : undefined
  const paramsTurn =
    params !== undefined && isRecord(params.turn) ? params.turn : undefined
  const threadId =
    readString(params ?? {}, 'threadId') ??
    readString(paramsThread ?? {}, 'id') ??
    readString(thread ?? {}, 'id')
  const turnId =
    readString(params ?? {}, 'turnId') ??
    readString(paramsTurn ?? {}, 'id') ??
    readString(turn ?? {}, 'id')

  return {
    direction,
    timestamp: new Date().toISOString(),
    ...(typeof record.id === 'string' || typeof record.id === 'number'
      ? { id: record.id }
      : {}),
    ...(typeof record.method === 'string' ? { method: record.method } : {}),
    ...(threadId === undefined ? {} : { threadId }),
    ...(turnId === undefined ? {} : { turnId }),
    payload: message,
  }
}
