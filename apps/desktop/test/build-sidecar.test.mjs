import assert from 'node:assert/strict'
import test from 'node:test'

import {
  commonJsSeaBanner,
  createBuildId,
  createSeaConfiguration,
  sidecarFileName,
} from '../scripts/build-sidecar.mjs'

test('sidecar build identity is revision coupled', () => {
  assert.equal(createBuildId('09b18e67ebf271bf', false), 'git-09b18e67ebf2')
  assert.equal(
    createBuildId('09b18e67ebf271bf', true),
    'git-09b18e67ebf2-dirty',
  )
  assert.throws(() => createBuildId('not-a-revision', false))
})

test('sidecar names follow Tauri target-triple convention', () => {
  assert.equal(
    sidecarFileName('x86_64-pc-windows-msvc', 'win32'),
    'codetether-host-x86_64-pc-windows-msvc.exe',
  )
  assert.equal(
    sidecarFileName('aarch64-apple-darwin', 'darwin'),
    'codetether-host-aarch64-apple-darwin',
  )
})

test('SEA entry stays relative so release binaries do not leak build paths', () => {
  const configuration = createSeaConfiguration('C:\\release\\host.exe')
  assert.equal(configuration.main, 'codetether-host.mjs')
  assert.equal(configuration.output, 'C:\\release\\host.exe')
})

test('sidecar bundle supports CommonJS dependencies inside the ESM SEA', () => {
  assert.match(commonJsSeaBanner, /createRequire as __ctCreateRequire/u)
  assert.match(commonJsSeaBanner, /__ctCreateRequire\(import\.meta\.url\)/u)
})
