import type { CanonicalFailureReason } from '@codetether/agent-core'

import type { ClaudeCodeDetection } from './types.js'

export type ClaudeCodeDetectionFailureReason =
  | 'login_required'
  | 'provider_not_installed'
  | 'provider_unsupported_version'
  | 'provider_misconfigured'

/** Maps only exact Claude stream-json enum tokens, never Provider prose. */
export function classifyClaudeCodeProviderFailure(
  assistantError: string | undefined,
  resultSubtype: string | undefined,
): CanonicalFailureReason {
  // Result subtypes describe the invocation lifecycle. In particular,
  // `error_max_budget_usd` is a configured per-Turn budget, not evidence that
  // the Provider account quota is exhausted. Keep unknown subtype failures
  // conservative instead of inventing account recovery guidance.
  void resultSubtype
  switch (assistantError) {
    case 'authentication_failed':
      return 'authentication_invalid'
    case 'oauth_org_not_allowed':
    case 'billing_error':
      return 'account_unavailable'
    case 'model_not_found':
      // This does not prove an account-level outage, and the frozen product
      // does not have a narrower model-availability recovery reason.
      return 'provider_error'
    case 'rate_limit':
      return 'rate_limited'
    case 'server_error':
      return 'provider_service_unavailable'
    case 'max_output_tokens':
      return 'output_limit_exceeded'
    default:
      return 'provider_error'
  }
}

/** Maps the adapter's bounded machine-readable detection result. */
export function classifyClaudeCodeDetectionFailure(
  detection: ClaudeCodeDetection,
): ClaudeCodeDetectionFailureReason | undefined {
  switch (detection.status) {
    case 'available':
      return undefined
    case 'notInstalled':
      return 'provider_not_installed'
    case 'unsupportedVersion':
      return 'provider_unsupported_version'
    case 'misconfigured':
      return detection.diagnosticCode === 'auth_not_logged_in'
        ? 'login_required'
        : 'provider_misconfigured'
  }
}
