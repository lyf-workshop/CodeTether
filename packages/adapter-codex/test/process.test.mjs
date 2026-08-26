import assert from 'node:assert/strict'
import test from 'node:test'

import { sanitizeCodexChildEnvironment } from '../dist/process.js'

test('child App Server does not inherit a parent Codex control context', () => {
  const environment = sanitizeCodexChildEnvironment({
    PATH: 'runtime-path',
    CODEX_HOME: 'runtime-home',
    CODEX_ACCESS_TOKEN: 'preserved-auth-value',
    CODEX_CI: '1',
    CODEX_PERMISSION_PROFILE: 'parent-permissions',
    CODEX_SESSION_ID: 'parent-session',
    CODEX_THREAD_ID: 'parent-thread',
  })

  assert.deepEqual(environment, {
    PATH: 'runtime-path',
    CODEX_HOME: 'runtime-home',
    CODEX_ACCESS_TOKEN: 'preserved-auth-value',
  })
})

test('control variable matching is case-insensitive on Windows-style input', () => {
  assert.deepEqual(
    sanitizeCodexChildEnvironment({
      Path: 'runtime-path',
      codex_session_id: 'parent-session',
    }),
    { Path: 'runtime-path' },
  )
})
