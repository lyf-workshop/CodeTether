import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultKnownPaths } from '../dist/installation.js'

test('Finder-like empty environment has bounded Apple Silicon and Intel candidates', () => {
  assert.deepEqual(defaultKnownPaths({}, 'darwin'), [
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
  ])
  assert.deepEqual(defaultKnownPaths({}, 'linux'), [])
  assert.deepEqual(defaultKnownPaths({}, 'win32'), [])
})
