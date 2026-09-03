import assert from 'node:assert/strict'
import test from 'node:test'

import {
  classifyClaudeCodeDetectionFailure,
  classifyClaudeCodeProviderFailure,
  ClaudeCodeOwnedProcessCleanupError,
  ClaudeCodeProcessExitError,
  ClaudeCodeProtocolError,
  ClaudeCodeSessionLostError,
  ClaudeCodeStartError,
} from '../dist/index.js'

const detectionBase = {
  provider: 'claude-code',
  capabilities: {},
  durationMs: 1,
}

test('classifies exact Claude stream-json failure tokens without prose matching', () => {
  for (const [assistantError, subtype, expected] of [
    ['authentication_failed', undefined, 'authentication_invalid'],
    ['oauth_org_not_allowed', undefined, 'account_unavailable'],
    ['billing_error', undefined, 'account_unavailable'],
    ['model_not_found', undefined, 'provider_error'],
    ['rate_limit', undefined, 'rate_limited'],
    ['server_error', undefined, 'provider_service_unavailable'],
    ['max_output_tokens', undefined, 'output_limit_exceeded'],
    [undefined, 'error_max_budget_usd', 'provider_error'],
    ['rate limit in private prose', undefined, 'provider_error'],
    [undefined, 'future_unknown_subtype', 'provider_error'],
  ]) {
    assert.equal(
      classifyClaudeCodeProviderFailure(assistantError, subtype),
      expected,
    )
  }
})

test('treats adversarial Claude diagnostic prose as an unknown safe failure', () => {
  const payloads = [
    '<img src=x onerror=stealCredentials()>',
    '[Authenticate now](https://malicious.invalid/auth)',
    '\u001B]8;;https://malicious.invalid\u0007click\u001B]8;;\u0007',
    '\u0000\u0008\u000Dfake terminal control',
    'x'.repeat(256 * 1024),
    'API_KEY=private-secret',
    '{"error":"rate_limit"}',
    'invalid replacement character \uFFFD',
  ]

  for (const payload of payloads) {
    const classified = classifyClaudeCodeProviderFailure(payload, undefined)
    assert.equal(classified, 'provider_error')
    assert.doesNotMatch(classified, /img|malicious|private|API_KEY/u)
  }
})

test('classifies bounded Claude detection results', () => {
  assert.equal(
    classifyClaudeCodeDetectionFailure({
      ...detectionBase,
      status: 'notInstalled',
      diagnosticCode: 'provider_not_installed',
    }),
    'provider_not_installed',
  )
  assert.equal(
    classifyClaudeCodeDetectionFailure({
      ...detectionBase,
      status: 'misconfigured',
      diagnosticCode: 'auth_not_logged_in',
    }),
    'login_required',
  )
  assert.equal(
    classifyClaudeCodeDetectionFailure({
      ...detectionBase,
      status: 'misconfigured',
      diagnosticCode: 'auth_status_invalid',
    }),
    'provider_misconfigured',
  )
})

test('exposes controlled reasons on Claude lifecycle failures', () => {
  assert.equal(
    new ClaudeCodeStartError().failureReason,
    'provider_start_failed',
  )
  assert.equal(
    new ClaudeCodeProcessExitError().failureReason,
    'provider_crashed',
  )
  assert.equal(
    new ClaudeCodeOwnedProcessCleanupError().failureReason,
    'execution_ownership_uncertain',
  )
  assert.equal(
    new ClaudeCodeSessionLostError().failureReason,
    'provider_session_lost',
  )
  assert.equal(
    new ClaudeCodeProtocolError().failureReason,
    'provider_protocol_error',
  )
})
