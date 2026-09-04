export const canonicalFailureCategories = [
  'authentication',
  'quota',
  'provider',
  'machine',
  'project',
  'runtime',
  'transport',
  'generic',
] as const

export type CanonicalFailureCategory =
  (typeof canonicalFailureCategories)[number]

export const canonicalFailureReasons = [
  'login_required',
  'authentication_expired',
  'authentication_invalid',
  'account_unavailable',
  'usage_limit_reached',
  'rate_limited',
  'provider_capacity_limited',
  'provider_not_installed',
  'provider_unsupported_version',
  'provider_misconfigured',
  'provider_service_unavailable',
  'provider_start_failed',
  'provider_crashed',
  'provider_session_lost',
  'provider_protocol_error',
  'machine_offline',
  'node_disconnected',
  'machine_identity_mismatch',
  'remote_execution_unavailable',
  'project_location_missing',
  'project_location_invalid',
  'project_location_unavailable',
  'execution_capacity_reached',
  'conversation_busy',
  'execution_lost',
  'execution_ownership_uncertain',
  'output_limit_exceeded',
  'protocol_limit_exceeded',
  'transport_lost',
  'transport_authentication_failed',
  'reconnecting',
  'relay_not_configured',
  'relay_unreachable',
  'relay_authentication_failed',
  'relay_identity_mismatch',
  'relay_protocol_incompatible',
  'relay_revoked',
  'relay_rate_limited',
  'relay_channel_open_failed',
  'relay_channel_lost',
  'relay_peer_offline',
  'relay_transport_capacity_reached',
  'relay_protocol_error',
  'provider_error',
  'runtime_error',
  'unknown_failure',
] as const

export type CanonicalFailureReason = (typeof canonicalFailureReasons)[number]

export const canonicalFailureRetryabilities = [
  'retry_now',
  'retry_later',
  'retry_after_user_action',
  'not_retryable',
  'unknown',
] as const

export type CanonicalFailureRetryability =
  (typeof canonicalFailureRetryabilities)[number]

export const canonicalFailureUserActions = [
  'retry',
  'wait',
  'login_on_machine',
  'open_machine',
  'open_project',
  'repair_project_location',
  'reconnect_machine',
  'reinstall_provider',
  'update_provider',
  'reduce_active_work',
  'view_details',
  'contact_provider',
  'none',
] as const

export type CanonicalFailureUserAction =
  (typeof canonicalFailureUserActions)[number]

export const canonicalFailureSources = [
  'provider',
  'machine',
  'transport',
  'project',
  'runtime',
  'relay',
] as const

export type CanonicalFailureSource = (typeof canonicalFailureSources)[number]

export interface CanonicalFailure {
  readonly category: CanonicalFailureCategory
  readonly reason: CanonicalFailureReason
  readonly retryability: CanonicalFailureRetryability
  readonly userAction: CanonicalFailureUserAction
  readonly source: CanonicalFailureSource
  readonly occurredAt: string
  /** Stable CodeTether-owned support code. Never contains Provider text. */
  readonly technicalCode: CanonicalFailureReason
}

type CanonicalFailureProfile = Omit<
  CanonicalFailure,
  'occurredAt' | 'reason' | 'technicalCode'
>

const profiles: Readonly<
  Record<CanonicalFailureReason, CanonicalFailureProfile>
> = {
  login_required: {
    category: 'authentication',
    retryability: 'retry_after_user_action',
    userAction: 'login_on_machine',
    source: 'provider',
  },
  authentication_expired: {
    category: 'authentication',
    retryability: 'retry_after_user_action',
    userAction: 'login_on_machine',
    source: 'provider',
  },
  authentication_invalid: {
    category: 'authentication',
    retryability: 'retry_after_user_action',
    userAction: 'login_on_machine',
    source: 'provider',
  },
  account_unavailable: {
    category: 'authentication',
    retryability: 'retry_after_user_action',
    userAction: 'contact_provider',
    source: 'provider',
  },
  usage_limit_reached: {
    category: 'quota',
    retryability: 'retry_later',
    userAction: 'wait',
    source: 'provider',
  },
  rate_limited: {
    category: 'quota',
    retryability: 'retry_later',
    userAction: 'wait',
    source: 'provider',
  },
  provider_capacity_limited: {
    category: 'quota',
    retryability: 'retry_later',
    userAction: 'wait',
    source: 'provider',
  },
  provider_not_installed: {
    category: 'provider',
    retryability: 'retry_after_user_action',
    userAction: 'reinstall_provider',
    source: 'provider',
  },
  provider_unsupported_version: {
    category: 'provider',
    retryability: 'retry_after_user_action',
    userAction: 'update_provider',
    source: 'provider',
  },
  provider_misconfigured: {
    category: 'provider',
    retryability: 'retry_after_user_action',
    userAction: 'open_machine',
    source: 'provider',
  },
  provider_service_unavailable: {
    category: 'provider',
    retryability: 'retry_later',
    userAction: 'wait',
    source: 'provider',
  },
  provider_start_failed: {
    category: 'provider',
    retryability: 'retry_now',
    userAction: 'retry',
    source: 'provider',
  },
  provider_crashed: {
    category: 'provider',
    // A dead process proves terminal ownership, but it does not prove that
    // earlier Tool/file/shell side effects did not occur. Without a separate
    // durable safety fact, replaying the old Prompt is not safe.
    retryability: 'unknown',
    userAction: 'view_details',
    source: 'provider',
  },
  provider_session_lost: {
    category: 'provider',
    retryability: 'not_retryable',
    userAction: 'view_details',
    source: 'provider',
  },
  provider_protocol_error: {
    category: 'provider',
    retryability: 'retry_after_user_action',
    userAction: 'update_provider',
    source: 'provider',
  },
  machine_offline: {
    category: 'machine',
    retryability: 'retry_later',
    userAction: 'reconnect_machine',
    source: 'machine',
  },
  node_disconnected: {
    category: 'machine',
    retryability: 'retry_later',
    userAction: 'reconnect_machine',
    source: 'machine',
  },
  machine_identity_mismatch: {
    category: 'machine',
    retryability: 'retry_after_user_action',
    userAction: 'open_machine',
    source: 'machine',
  },
  remote_execution_unavailable: {
    category: 'machine',
    retryability: 'retry_after_user_action',
    userAction: 'open_machine',
    source: 'machine',
  },
  project_location_missing: {
    category: 'project',
    retryability: 'retry_after_user_action',
    userAction: 'repair_project_location',
    source: 'project',
  },
  project_location_invalid: {
    category: 'project',
    retryability: 'retry_after_user_action',
    userAction: 'repair_project_location',
    source: 'project',
  },
  project_location_unavailable: {
    category: 'project',
    retryability: 'retry_after_user_action',
    userAction: 'open_project',
    source: 'project',
  },
  execution_capacity_reached: {
    category: 'runtime',
    retryability: 'retry_later',
    userAction: 'reduce_active_work',
    source: 'runtime',
  },
  conversation_busy: {
    category: 'runtime',
    retryability: 'retry_later',
    userAction: 'wait',
    source: 'runtime',
  },
  execution_lost: {
    category: 'runtime',
    retryability: 'not_retryable',
    userAction: 'view_details',
    source: 'runtime',
  },
  execution_ownership_uncertain: {
    category: 'runtime',
    retryability: 'not_retryable',
    userAction: 'view_details',
    source: 'runtime',
  },
  output_limit_exceeded: {
    category: 'runtime',
    retryability: 'not_retryable',
    userAction: 'view_details',
    source: 'runtime',
  },
  protocol_limit_exceeded: {
    category: 'runtime',
    retryability: 'not_retryable',
    userAction: 'view_details',
    source: 'runtime',
  },
  transport_lost: {
    category: 'transport',
    retryability: 'not_retryable',
    userAction: 'view_details',
    source: 'transport',
  },
  transport_authentication_failed: {
    category: 'transport',
    retryability: 'retry_after_user_action',
    userAction: 'open_machine',
    source: 'transport',
  },
  reconnecting: {
    category: 'transport',
    retryability: 'retry_later',
    userAction: 'wait',
    source: 'transport',
  },
  relay_not_configured: {
    category: 'transport',
    retryability: 'retry_after_user_action',
    userAction: 'open_machine',
    source: 'relay',
  },
  relay_unreachable: {
    category: 'transport',
    retryability: 'retry_later',
    userAction: 'wait',
    source: 'relay',
  },
  relay_authentication_failed: {
    category: 'authentication',
    retryability: 'retry_after_user_action',
    userAction: 'open_machine',
    source: 'relay',
  },
  relay_identity_mismatch: {
    category: 'transport',
    retryability: 'retry_after_user_action',
    userAction: 'open_machine',
    source: 'relay',
  },
  relay_protocol_incompatible: {
    category: 'transport',
    retryability: 'retry_after_user_action',
    userAction: 'open_machine',
    source: 'relay',
  },
  relay_revoked: {
    category: 'authentication',
    retryability: 'retry_after_user_action',
    userAction: 'open_machine',
    source: 'relay',
  },
  relay_rate_limited: {
    category: 'transport',
    retryability: 'retry_later',
    userAction: 'wait',
    source: 'relay',
  },
  relay_channel_open_failed: {
    category: 'transport',
    retryability: 'retry_later',
    userAction: 'wait',
    source: 'relay',
  },
  relay_channel_lost: {
    category: 'transport',
    retryability: 'not_retryable',
    userAction: 'view_details',
    source: 'relay',
  },
  relay_peer_offline: {
    category: 'transport',
    retryability: 'retry_later',
    userAction: 'wait',
    source: 'relay',
  },
  relay_transport_capacity_reached: {
    category: 'runtime',
    retryability: 'retry_later',
    userAction: 'reduce_active_work',
    source: 'relay',
  },
  relay_protocol_error: {
    category: 'transport',
    retryability: 'retry_after_user_action',
    userAction: 'open_machine',
    source: 'relay',
  },
  provider_error: {
    category: 'generic',
    retryability: 'unknown',
    userAction: 'view_details',
    source: 'provider',
  },
  runtime_error: {
    category: 'generic',
    retryability: 'unknown',
    userAction: 'view_details',
    source: 'runtime',
  },
  unknown_failure: {
    category: 'generic',
    retryability: 'unknown',
    userAction: 'view_details',
    source: 'runtime',
  },
}

export function canonicalFailure(
  reason: CanonicalFailureReason,
  occurredAt: string,
): CanonicalFailure {
  return {
    ...profiles[reason],
    reason,
    occurredAt,
    technicalCode: reason,
  }
}

export function isCanonicalFailureReason(
  value: unknown,
): value is CanonicalFailureReason {
  return (
    typeof value === 'string' &&
    (canonicalFailureReasons as readonly string[]).includes(value)
  )
}

export const providerExecutionHealthStates = [
  'healthy',
  'degraded',
  'unavailable',
  'unknown',
] as const

export type ProviderExecutionHealthState =
  (typeof providerExecutionHealthStates)[number]

export const providerExecutionHealthFreshness = [
  'current',
  'last_known',
] as const

export type ProviderExecutionHealthFreshness =
  (typeof providerExecutionHealthFreshness)[number]

export interface ProviderExecutionHealth {
  readonly state: ProviderExecutionHealthState
  readonly freshness: ProviderExecutionHealthFreshness
  readonly observedAt?: string
  readonly failure?: CanonicalFailure
}
