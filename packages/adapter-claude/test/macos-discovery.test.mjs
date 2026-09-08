import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultKnownPaths } from '../dist/installation.js'

test('Finder-like empty environment uses bounded existing lifecycle candidates', () => {
  assert.deepEqual(defaultKnownPaths({}, 'darwin'), [
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ])
  assert.deepEqual(defaultKnownPaths({}, 'linux'), [])
  assert.deepEqual(defaultKnownPaths({}, 'win32'), [])
})
