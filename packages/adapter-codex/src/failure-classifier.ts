import type { CanonicalFailureReason } from '@codetether/agent-core'

const CONNECTION_FAILURE_KINDS = new Set([
  'httpConnectionFailed',
  'responseStreamConnectionFailed',
  'responseStreamDisconnected',
  'responseTooManyFailedAttempts',
])

/**
 * Maps only Codex App Server's stable structured codexErrorInfo field.
 * Provider prose and additionalDetails are deliberately never inspected.
 */
export function classifyCodexErrorInfo(value: unknown): CanonicalFailureReason {
  if (typeof value === 'string') {
    switch (value) {
      case 'usageLimitExceeded':
        return 'usage_limit_reached'
      case 'sessionBudgetExceeded':
        // This is the Provider session's rollout/token budget, not proof that
        // the account usage quota was exhausted. The current canonical model
        // has no narrower truthful reason, so remain conservative.
        return 'provider_error'
      case 'unauthorized':
        return 'login_required'
      case 'serverOverloaded':
        return 'provider_capacity_limited'
      case 'internalServerError':
        return 'provider_service_unavailable'
      default:
        return 'provider_error'
    }
  }

  if (!isRecord(value)) return 'provider_error'
  const entries = Object.entries(value)
  if (entries.length !== 1) return 'provider_error'
  const [kind, details] = entries[0] ?? []
  if (kind === undefined || !CONNECTION_FAILURE_KINDS.has(kind)) {
    return 'provider_error'
  }
  const status = isRecord(details) ? details.httpStatusCode : undefined
  if (status === 401) return 'authentication_invalid'
  if (status === 429) return 'rate_limited'
  if (
    typeof status === 'number' &&
    Number.isInteger(status) &&
    status >= 500 &&
    status <= 599
  ) {
    return 'provider_service_unavailable'
  }
  return 'provider_error'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
