import { createHash } from 'node:crypto'

const safeEventPattern = /^[a-z][a-z0-9_.-]{0,63}$/u
const safeRolePattern = /^(controller|node)$/u
const safeCodePattern = /^[a-z][a-z0-9_]{0,63}$/u

export type RelayLogEvent =
  | 'relay.started'
  | 'relay.stopped'
  | 'connection.accepted'
  | 'connection.authenticated'
  | 'connection.closed'
  | 'connection.replaced'
  | 'connection.rejected'
  | 'enrollment.succeeded'
  | 'authentication.failed'
  | 'rate_limit.applied'
  | 'heartbeat.timeout'
  | 'peer.revoked'

export interface RelaySafeLogger {
  log(
    event: RelayLogEvent,
    fields?: {
      readonly code?: string
      readonly role?: 'controller' | 'node'
      readonly peerReference?: string
      readonly connectionEpoch?: string
    },
  ): void
}

export function createJsonRelayLogger(
  write: (line: string) => void = (line) => process.stdout.write(line),
): RelaySafeLogger {
  return {
    log(event, fields = {}) {
      if (!safeEventPattern.test(event)) return
      const record: Record<string, string> = {
        timestamp: new Date().toISOString(),
        event,
      }
      if (fields.code !== undefined && safeCodePattern.test(fields.code)) {
        record.code = fields.code
      }
      if (fields.role !== undefined && safeRolePattern.test(fields.role)) {
        record.role = fields.role
      }
      if (fields.peerReference !== undefined) {
        record.peer = opaqueReference(fields.peerReference)
      }
      if (fields.connectionEpoch !== undefined) {
        record.connection = opaqueReference(fields.connectionEpoch)
      }
      write(`${JSON.stringify(record)}\n`)
    },
  }
}

export function opaqueReference(value: string): string {
  return createHash('sha256')
    .update(value, 'utf8')
    .digest('base64url')
    .slice(0, 12)
}
