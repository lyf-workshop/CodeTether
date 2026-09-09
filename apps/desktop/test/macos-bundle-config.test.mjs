import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const macosConfiguration = JSON.parse(
  await readFile(
    new URL('../src-tauri/tauri.macos.conf.json', import.meta.url),
    'utf8',
  ),
)

test('macOS Alpha bundles receive a complete ad-hoc resource seal', () => {
  assert.equal(macosConfiguration.bundle.macOS.signingIdentity, '-')
  assert.equal(macosConfiguration.bundle.macOS.hardenedRuntime, false)
  assert.deepEqual(macosConfiguration.bundle.targets, ['app', 'dmg'])
})
