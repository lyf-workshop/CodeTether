import { HostErrorCodeSchema, type HostErrorCode } from '@codetether/protocol'

import type { SupervisorResponse } from './protocol.js'

type SupervisorFailureCode = NonNullable<SupervisorResponse['code']>

export interface SupervisorFailure {
  readonly code: SupervisorFailureCode
  readonly reason?: HostErrorCode
  readonly httpStatus?: 409 | 422
}

const notFoundReasons = new Set<HostErrorCode>([
  'not_found',
  'project_location_not_found',
  'project_location_missing',
])
const conflictReasons = new Set<HostErrorCode>([
  'conflict',
  'project_has_conversations',
  'project_location_conflict',
  'project_location_has_conversations',
  'project_location_local_required',
  'conversation_archived',
  'provider_session_candidate_expired',
])
const invalidRequestReasons = new Set<HostErrorCode>([
  'invalid_request',
  'project_location_invalid',
])
const unavailableReasons = new Set<HostErrorCode>([
  'runtime_unavailable',
  'provider_unavailable',
  'machine_unreachable',
  'machine_connection_failed',
  'provider_session_discovery_unavailable',
])

/** The one Host-to-Supervisor error mapping shared by read and control work. */
export function supervisorFailureFromError(error: unknown): SupervisorFailure {
  const source = errorRecord(error)
  const rawCode =
    typeof source?.code === 'string'
      ? source.code
      : error instanceof Error
        ? error.message
        : undefined
  const hostCode = parseHostErrorCode(rawCode)
  const failure = errorRecord(source?.failure)
  const fallback =
    rawCode === 'invalid_request' ||
    rawCode === 'conflict' ||
    rawCode === 'unavailable'
      ? parseHostErrorCode(failure?.reason)
      : undefined
  const reason = fallback ?? hostCode
  const code = supervisorFailureCode(rawCode, hostCode)
  const status = source?.httpStatus
  return {
    code,
    ...(reason === undefined ? {} : { reason }),
    ...(code === 'unsupported' && (status === 409 || status === 422)
      ? { httpStatus: status }
      : {}),
  }
}

function supervisorFailureCode(
  rawCode: string | undefined,
  hostCode: HostErrorCode | undefined,
): SupervisorFailureCode {
  if (rawCode === 'operation_not_allowed') return 'operation_not_allowed'
  if (rawCode === 'session_expired') return 'session_expired'
  if (rawCode === 'unavailable') return 'unavailable'
  if (hostCode === 'unsupported') return 'unsupported'
  if (hostCode !== undefined) {
    if (notFoundReasons.has(hostCode)) return 'not_found'
    if (conflictReasons.has(hostCode)) return 'conflict'
    if (invalidRequestReasons.has(hostCode)) return 'invalid_request'
    if (unavailableReasons.has(hostCode)) return 'unavailable'
  }
  return 'internal'
}

function parseHostErrorCode(value: unknown): HostErrorCode | undefined {
  const parsed = HostErrorCodeSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

function errorRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
