import assert from 'node:assert/strict'
import test from 'node:test'

import {
  classifyCodexErrorInfo,
  CodexExecutableNotFoundError,
  CodexProcessError,
  CodexProcessExitError,
  CodexProtocolError,
  JsonRpcLineTooLongError,
  JsonRpcRemoteError,
  JsonRpcRequestTimeoutError,
} from '../dist/index.js'

test('classifies only stable structured Codex error information', () => {
  for (const [value, expected] of [
    ['usageLimitExceeded', 'usage_limit_reached'],
    ['sessionBudgetExceeded', 'provider_error'],
    ['unauthorized', 'login_required'],
    ['serverOverloaded', 'provider_capacity_limited'],
    ['internalServerError', 'provider_service_unavailable'],
    [
      { httpConnectionFailed: { httpStatusCode: 401 } },
      'authentication_invalid',
    ],
    [
      { responseStreamConnectionFailed: { httpStatusCode: 429 } },
      'rate_limited',
    ],
    [
      { responseStreamDisconnected: { httpStatusCode: 503 } },
      'provider_service_unavailable',
    ],
  ]) {
    assert.equal(classifyCodexErrorInfo(value), expected)
  }
  assert.equal(
    classifyCodexErrorInfo({ message: 'rate limit private prose' }),
    'provider_error',
  )
  for (const httpStatusCode of [400, 403, 404, 503.5, '503']) {
    assert.equal(
      classifyCodexErrorInfo({
        responseStreamConnectionFailed: { httpStatusCode },
      }),
      'provider_error',
    )
  }
  assert.equal(
    classifyCodexErrorInfo({ responseStreamDisconnected: {} }),
    'provider_error',
  )
  assert.equal(
    classifyCodexErrorInfo({ httpConnectionFailed: null }),
    'provider_error',
  )
  assert.equal(classifyCodexErrorInfo('futureUnknownVariant'), 'provider_error')
})

test('treats adversarial Codex diagnostic prose as an unknown safe failure', () => {
  const payloads = [
    '<script>stealCredentials()</script>',
    '[Sign in here](https://malicious.invalid/login)',
    '\u001B]8;;https://malicious.invalid\u0007click\u001B]8;;\u0007',
    '\u0000\u0008\u000Dfake terminal control',
    'x'.repeat(256 * 1024),
    'Authorization: Bearer private-token',
    '{"codexErrorInfo":"usageLimitExceeded"}',
    'invalid replacement character \uFFFD',
  ]

  for (const payload of payloads) {
    const classified = classifyCodexErrorInfo(payload)
    assert.equal(classified, 'provider_error')
    assert.doesNotMatch(classified, /script|malicious|private|Authorization/u)
    assert.equal(classifyCodexErrorInfo({ message: payload }), 'provider_error')
  }
})

test('exposes controlled reasons on Codex process and protocol failures', () => {
  const missing = new CodexExecutableNotFoundError('C:\\private\\codex.exe')
  assert.equal(missing.failureReason, 'provider_not_installed')
  assert.doesNotMatch(missing.message, /private|codex\.exe/u)
  assert.equal(
    new CodexProcessError('safe startup failure').failureReason,
    'provider_start_failed',
  )
  assert.equal(
    new CodexProcessExitError(17, null).failureReason,
    'provider_crashed',
  )
  assert.equal(
    new CodexProtocolError('safe malformed response').failureReason,
    'provider_protocol_error',
  )
  assert.equal(
    new JsonRpcLineTooLongError(16, 17).failureReason,
    'protocol_limit_exceeded',
  )
  assert.equal(
    new JsonRpcRequestTimeoutError('turn/start', 100).failureReason,
    'execution_ownership_uncertain',
  )
  assert.equal(
    new JsonRpcRemoteError('turn/start', -32_000, 'private token detail', {
      codexErrorInfo: 'usageLimitExceeded',
    }).failureReason,
    'usage_limit_reached',
  )
  assert.doesNotMatch(
    new JsonRpcRemoteError('turn/start', -32_000, 'private token detail')
      .message,
    /private|token/u,
  )
})
