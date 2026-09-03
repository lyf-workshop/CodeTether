import assert from 'node:assert/strict'
import test from 'node:test'

import { protocolLogEntry } from '../dist/index.js'

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
