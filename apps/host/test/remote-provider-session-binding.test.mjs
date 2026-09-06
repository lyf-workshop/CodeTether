import assert from 'node:assert/strict'
import test from 'node:test'

import {
  decodeRemoteProviderSessionBinding,
  encodeRemoteProviderSessionBinding,
} from '../dist/api/remote-provider-session-binding.js'

const machineId = 'machine_phase8abinding01'

test('remote Provider session binding preserves the frozen private runtime format', () => {
  const codexNative = 'native-codex-phase8a'
  const claudeNative = '123e4567-e89b-42d3-a456-426614174000'
  const expectedCodex = `remote-codex-v1:${Buffer.from(
    JSON.stringify({ version: 1, machineId, providerThreadId: codexNative }),
    'utf8',
  ).toString('base64url')}`
  const expectedClaude = `remote-claude-v1:${Buffer.from(
    JSON.stringify({ version: 1, machineId, providerSessionId: claudeNative }),
    'utf8',
  ).toString('base64url')}`

  assert.equal(
    encodeRemoteProviderSessionBinding('codex', machineId, codexNative),
    expectedCodex,
  )
  assert.equal(
    encodeRemoteProviderSessionBinding('claude-code', machineId, claudeNative),
    expectedClaude,
  )
  assert.equal(
    decodeRemoteProviderSessionBinding('codex', machineId, expectedCodex),
    codexNative,
  )
  assert.equal(
    decodeRemoteProviderSessionBinding(
      'claude-code',
      machineId,
      expectedClaude,
    ),
    claudeNative,
  )

  assert.throws(() =>
    decodeRemoteProviderSessionBinding(
      'codex',
      'machine_phase8abinding02',
      expectedCodex,
    ),
  )
  assert.throws(() =>
    decodeRemoteProviderSessionBinding('claude-code', machineId, expectedCodex),
  )
})
