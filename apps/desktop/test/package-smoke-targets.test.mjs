import assert from 'node:assert/strict'
import test from 'node:test'

import { packageSmokeScripts } from '../scripts/package-smoke-targets.mjs'

test('package smoke adds the Windows-only lifecycle suite on Windows', () => {
  assert.deepEqual(packageSmokeScripts('win32'), [
    './package-smoke.mjs',
    './lifecycle-smoke.mjs',
  ])
})

test('package smoke stays portable on macOS and Linux', () => {
  assert.deepEqual(packageSmokeScripts('darwin'), ['./package-smoke.mjs'])
  assert.deepEqual(packageSmokeScripts('linux'), ['./package-smoke.mjs'])
})
