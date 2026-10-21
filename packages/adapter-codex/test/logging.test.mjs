import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CodexEventNormalizer,
  JsonRpcRemoteError,
  protocolLogEntry,
} from '../dist/index.js'

test('protocol log entries retain only bounded CodeTether-safe routing metadata', () => {
  const secret = 'PRIVATE_PROMPT_AND_TOKEN'
  const hostile = protocolLogEntry('receive', {
    id: `${'x'.repeat(80)}\n${secret}`,
    method: `turn/completed\u001b[31m\n${secret}`,
    params: {
      threadId: `private-session-${secret}`,
      turnId: `private-turn-${secret}`,
      input: secret,
      authorization: secret,
    },
  })

  assert.deepEqual(Object.keys(hostile).sort(), ['direction', 'timestamp'])
  assert.equal(JSON.stringify(hostile).includes(secret), false)

  const syntacticallySafeSecret = protocolLogEntry('receive', {
    id: 'private-provider-session-token',
    method: 'Authorization/Bearer-secret',
    params: {},
  })
  assert.deepEqual(Object.keys(syntacticallySafeSecret).sort(), [
    'direction',
    'timestamp',
  ])
  assert.doesNotMatch(
    JSON.stringify(syntacticallySafeSecret),
    /authorization|bearer|secret|session|token/iu,
  )

  const ordinary = protocolLogEntry('send', {
    id: 17,
    method: 'thread/start',
    params: { input: secret },
  })
  assert.equal(ordinary.direction, 'send')
  assert.equal(ordinary.id, 17)
  assert.equal(ordinary.method, 'thread/start')
  assert.equal(JSON.stringify(ordinary).includes(secret), false)
})

test('failure logs retain only bounded variants, integer status and unchanged canonical reasons', (t) => {
  const writes = []
  t.mock.method(process.stderr, 'write', (chunk) => {
    writes.push(String(chunk))
    return true
  })
  const privateDetail =
    'SYNTHETIC_PRIVATE_DETAIL /private/project sk-synthetic Bearer synthetic ' +
    'sensitive'.repeat(32_768)
  const cases = [
    ['usageLimitExceeded', 'usageLimitExceeded', 'none', 'usage_limit_reached'],
    ['unauthorized', 'unauthorized', 'none', 'login_required'],
    ['rateLimitExceeded', 'rateLimitExceeded', 'none', 'provider_error'],
    ['A'.repeat(64), 'A'.repeat(64), 'none', 'provider_error'],
    [
      {
        responseStreamConnectionFailed: {
          httpStatusCode: 429,
          additionalDetails: privateDetail,
        },
      },
      'responseStreamConnectionFailed',
      '429',
      'rate_limited',
    ],
    [
      { httpConnectionFailed: { httpStatusCode: 401 } },
      'httpConnectionFailed',
      '401',
      'authentication_invalid',
    ],
    [
      { futureVariant: { httpStatusCode: 503 } },
      'futureVariant',
      '503',
      'provider_error',
    ],
    [{ futureVariant: null }, 'futureVariant', 'none', 'provider_error'],
    [{ futureVariant: 503 }, 'futureVariant', 'none', 'provider_error'],
    [
      { futureVariant: { nested: { httpStatusCode: 503 } } },
      'futureVariant',
      'none',
      'provider_error',
    ],
    ...[undefined, null, false, 503, [], {}, { first: {}, second: {} }].map(
      (value) => [value, 'unknown', 'none', 'provider_error'],
    ),
    ...[
      '',
      'A'.repeat(65),
      '1invalid',
      'invalid-name',
      '非类型',
      'invalid\n',
      'invalid\r',
      'invalid\nforged',
      'invalid\u001b[31m',
      privateDetail,
    ].flatMap((variant) => [
      [variant, 'unknown', 'none', 'provider_error'],
      [{ [variant]: {} }, 'unknown', 'none', 'provider_error'],
    ]),
    ...[
      undefined,
      null,
      '503',
      503.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ].map((httpStatusCode) => [
      { futureVariant: { httpStatusCode } },
      'futureVariant',
      'none',
      'provider_error',
    ]),
  ]

  for (const [codexErrorInfo, variant, httpStatus, reason] of cases) {
    const expected = `[codex:failure] variant=${variant} httpStatus=${httpStatus} reason=${reason}\n`
    writes.length = 0
    const normalized = new CodexEventNormalizer().normalize({
      method: 'turn/completed',
      params: {
        threadId: 'synthetic-private-session',
        turn: {
          id: 'synthetic-private-turn',
          status: 'failed',
          error: {
            codexErrorInfo,
            message: privateDetail,
            additionalDetails: privateDetail,
          },
        },
      },
    })
    assert.equal(normalized.events[0].error.failure.reason, reason)
    assert.deepEqual(writes, [expected])

    writes.length = 0
    const rejected = new JsonRpcRemoteError(
      'synthetic/private/method',
      -32_000,
      privateDetail,
      { codexErrorInfo, additionalDetails: privateDetail },
    )
    assert.equal(rejected.failureReason, reason)
    assert.deepEqual(writes, [expected])
    assert.doesNotMatch(writes.join(''), /synthetic|private|Bearer|sensitive/u)
    assert.ok(Buffer.byteLength(writes[0], 'utf8') < 192)
  }
})

test('successful, interrupted and retryable notifications do not log terminal failures', (t) => {
  const writes = []
  t.mock.method(process.stderr, 'write', (chunk) => {
    writes.push(String(chunk))
    return true
  })
  const normalizer = new CodexEventNormalizer()
  for (const status of ['completed', 'interrupted']) {
    normalizer.normalize({
      method: 'turn/completed',
      params: { threadId: 'thread-a', turn: { id: 'turn-a', status } },
    })
  }
  normalizer.normalize({
    method: 'error',
    params: { codexErrorInfo: 'usageLimitExceeded', willRetry: true },
  })
  assert.deepEqual(writes, [])
})

test('unavailable stderr cannot change failure classification or terminal normalization', (t) => {
  t.mock.method(process.stderr, 'write', () => {
    throw new Error('synthetic diagnostic stream unavailable')
  })
  const rejected = new JsonRpcRemoteError('turn/start', -32_000, '', {
    codexErrorInfo: 'usageLimitExceeded',
  })
  assert.equal(rejected.failureReason, 'usage_limit_reached')
  const normalized = new CodexEventNormalizer().normalize({
    method: 'turn/completed',
    params: {
      threadId: 'thread-a',
      turn: {
        id: 'turn-a',
        status: 'failed',
        error: { codexErrorInfo: 'unauthorized' },
      },
    },
  })
  assert.equal(normalized.events[0].type, 'turn.failed')
  assert.equal(normalized.events[0].error.failure.reason, 'login_required')
})
