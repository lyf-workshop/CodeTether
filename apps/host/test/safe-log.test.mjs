import assert from 'node:assert/strict'
import test from 'node:test'

import { safeErrorNameForLog } from '../dist/api/safe-log.js'
import { developmentProviderDiagnosticForLog } from '../dist/runtime/development-codex-runtime.js'

test('safe log error names reject controls, injection, and oversized values', () => {
  const safe = new Error('private message is never logged')
  safe.name = 'ProviderStartError'
  assert.equal(safeErrorNameForLog(safe), 'ProviderStartError')

  for (const hostileName of [
    'ProviderError\n[codetether:forged] accepted',
    '\u001b[31mProviderError',
    'Provider Error',
    `Provider${'X'.repeat(256)}`,
  ]) {
    const hostile = new Error('private message is never logged')
    hostile.name = hostileName
    assert.equal(safeErrorNameForLog(hostile), 'Error')
  }
  assert.equal(safeErrorNameForLog({ name: 'ForgedError' }), 'Error')
})

test('development runtime suppresses Provider-controlled protocol identifiers', () => {
  const expected = {
    'unknown-notification': '[codex:unknown-notification] suppressed\n',
    'unknown-request': '[codex:unknown-request] suppressed\n',
    'unknown-response': '[codex:unknown-response] suppressed\n',
  }
  const hostileValues = [
    'method\n[codetether:forged] accepted',
    '\u001b[31mprivate diagnostic\u001b[0m',
    `oversized-${'X'.repeat(100_000)}`,
    'Authorization: Bearer phase6d-private-token-material',
    'provider-session-private-identity',
    { toString: () => 'private-object-text' },
  ]

  for (const [kind, diagnostic] of Object.entries(expected)) {
    for (const hostile of hostileValues) {
      const output = developmentProviderDiagnosticForLog(kind, hostile)
      assert.equal(output, diagnostic)
      assert.ok(output.length < 80)
      assert.doesNotMatch(
        output,
        /forged|private|bearer|token|session|oversized/iu,
      )
      assert.equal(output.includes('\u001b'), false)
    }
  }
})
