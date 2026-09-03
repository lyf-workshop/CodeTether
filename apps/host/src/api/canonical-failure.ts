import {
  canonicalFailure,
  isCanonicalFailureReason,
  type AgentProvider,
  type CanonicalFailure,
  type CanonicalFailureReason,
  type ProviderExecutionHealthState,
} from '@codetether/agent-core'
import {
  CanonicalFailureSchema,
  type HostError,
  type HostErrorCode,
} from '@codetether/protocol'

interface FailureCarrier {
  readonly failure?: unknown
  readonly failureReason?: unknown
  readonly code?: unknown
}

/**
 * Reads only CodeTether-owned structured fields. Provider messages, stderr and
 * payloads are deliberately never inspected here.
 */
export function classifyCanonicalFailure(
  error: unknown,
  occurredAt: string,
  fallback: CanonicalFailureReason = 'provider_error',
): CanonicalFailure {
  if (typeof error === 'object' && error !== null) {
    const carrier = error as FailureCarrier
    const parsed = CanonicalFailureSchema.safeParse(carrier.failure)
    if (parsed.success) {
      if (
        carrier.code === 'remote_execution_lost' &&
        !isExecutionLossReason(parsed.data.reason)
      ) {
        return canonicalFailure('execution_lost', occurredAt)
      }
      return parsed.data
    }
    if (isCanonicalFailureReason(carrier.failureReason)) {
      return canonicalFailure(carrier.failureReason, occurredAt)
    }
    const mapped = legacyCodeReason(carrier.code)
    if (mapped !== undefined) return canonicalFailure(mapped, occurredAt)
  }
  return canonicalFailure(fallback, occurredAt)
}

export function safeProviderHostError(
  provider: AgentProvider,
  failure: CanonicalFailure,
): HostError {
  return {
    code: hostErrorCode(failure.reason),
    message: safeFailureMessage(provider, failure.reason),
    failure,
  }
}

export function safeFailureMessage(
  provider: AgentProvider,
  reason: CanonicalFailureReason,
): string {
  const name = provider === 'codex' ? 'Codex' : 'Claude Code'
  switch (reason) {
    case 'login_required':
      return `${name} requires login on this Machine`
    case 'authentication_expired':
      return `${name} authentication has expired`
    case 'authentication_invalid':
      return `${name} authentication is not valid`
    case 'account_unavailable':
      return `${name} account is unavailable`
    case 'usage_limit_reached':
      return `${name} usage limit has been reached`
    case 'rate_limited':
      return `${name} is temporarily rate limited`
    case 'provider_capacity_limited':
      return `${name} service capacity is temporarily limited`
    case 'provider_not_installed':
      return `${name} is not installed`
    case 'provider_unsupported_version':
      return `${name} version is not supported`
    case 'provider_misconfigured':
      return `${name} is not configured for execution`
    case 'provider_service_unavailable':
      return `${name} service is temporarily unavailable`
    case 'provider_start_failed':
      return `${name} failed to start`
    case 'provider_crashed':
      return `${name} process exited unexpectedly`
    case 'provider_session_lost':
      return `${name} session can no longer be resumed`
    case 'provider_protocol_error':
      return `${name} returned an unsupported response`
    case 'machine_offline':
      return 'The owning Machine is offline'
    case 'node_disconnected':
      return 'The remote Node disconnected'
    case 'machine_identity_mismatch':
      return 'The remote Machine identity could not be verified'
    case 'remote_execution_unavailable':
      return `Remote ${name} execution is unavailable`
    case 'project_location_missing':
      return 'The registered Project Location does not exist'
    case 'project_location_invalid':
      return 'The registered Project Location is invalid'
    case 'project_location_unavailable':
      return 'The registered Project Location is unavailable'
    case 'execution_capacity_reached':
      return 'The active execution capacity has been reached'
    case 'conversation_busy':
      return 'The Conversation already has active work'
    case 'execution_lost':
      return 'Execution ownership was lost before completion could be verified'
    case 'execution_ownership_uncertain':
      return 'Remote execution acceptance could not be verified'
    case 'output_limit_exceeded':
      return `${name} output exceeded the safe limit`
    case 'protocol_limit_exceeded':
      return `${name} protocol data exceeded the safe limit`
    case 'transport_lost':
      return 'The remote transport was lost during execution'
    case 'transport_authentication_failed':
      return 'The remote transport could not be authenticated'
    case 'reconnecting':
      return 'The remote Machine is reconnecting'
    case 'provider_error':
      return `${name} execution failed`
    case 'runtime_error':
      return `${name} runtime failed`
    case 'unknown_failure':
      return 'CodeTether could not determine a more specific failure reason'
  }
}

export function providerExecutionHealthState(
  failure: CanonicalFailure,
): ProviderExecutionHealthState {
  if (failure.category === 'quota') return 'degraded'
  if (failure.reason === 'provider_crashed') return 'degraded'
  return 'unavailable'
}

export function failureAffectsProviderExecutionHealth(
  failure: CanonicalFailure,
): boolean {
  return (
    failure.source === 'provider' ||
    failure.reason === 'runtime_error' ||
    failure.reason === 'execution_lost' ||
    failure.reason === 'protocol_limit_exceeded' ||
    failure.reason === 'output_limit_exceeded'
  )
}

function hostErrorCode(reason: CanonicalFailureReason): HostErrorCode {
  switch (reason) {
    case 'provider_not_installed':
      return 'provider_not_installed'
    case 'provider_unsupported_version':
      return 'provider_version_unsupported'
    case 'provider_start_failed':
      return 'provider_start_failed'
    case 'provider_session_lost':
      return 'provider_session_lost'
    case 'project_location_invalid':
      return 'project_location_invalid'
    case 'project_location_missing':
      return 'project_location_missing'
    case 'project_location_unavailable':
      return 'project_unavailable'
    case 'machine_identity_mismatch':
      return 'machine_identity_mismatch'
    case 'transport_authentication_failed':
      return 'machine_authentication_failed'
    case 'machine_offline':
    case 'node_disconnected':
    case 'reconnecting':
    case 'transport_lost':
      return 'machine_connection_failed'
    case 'execution_capacity_reached':
      return 'runtime_unavailable'
    case 'conversation_busy':
      return 'conflict'
    case 'provider_misconfigured':
    case 'provider_service_unavailable':
    case 'provider_crashed':
    case 'remote_execution_unavailable':
    case 'execution_lost':
    case 'execution_ownership_uncertain':
      return 'provider_unavailable'
    case 'login_required':
    case 'authentication_expired':
    case 'authentication_invalid':
    case 'account_unavailable':
    case 'usage_limit_reached':
    case 'rate_limited':
    case 'provider_capacity_limited':
    case 'provider_protocol_error':
    case 'output_limit_exceeded':
    case 'protocol_limit_exceeded':
    case 'provider_error':
      return 'provider_error'
    case 'runtime_error':
    case 'unknown_failure':
      return 'runtime_unavailable'
  }
}

function legacyCodeReason(value: unknown): CanonicalFailureReason | undefined {
  switch (value) {
    case 'provider_not_installed':
      return 'provider_not_installed'
    case 'provider_version_unsupported':
      return 'provider_unsupported_version'
    case 'provider_start_failed':
      return 'provider_start_failed'
    case 'provider_session_lost':
      return 'provider_session_lost'
    case 'provider_unavailable':
      // This legacy code covered local/remote startup, process, service and
      // generic runtime failures. Specificity is available only through a
      // structured Phase 6D failure; never guess a service outage.
      return 'provider_error'
    case 'remote_execution_lost':
      return 'execution_lost'
    case 'runtime_unavailable':
      return 'runtime_error'
    default:
      return undefined
  }
}

function isExecutionLossReason(reason: CanonicalFailureReason): boolean {
  return (
    reason === 'execution_lost' ||
    reason === 'execution_ownership_uncertain' ||
    reason === 'output_limit_exceeded' ||
    reason === 'protocol_limit_exceeded' ||
    reason === 'transport_lost'
  )
}
