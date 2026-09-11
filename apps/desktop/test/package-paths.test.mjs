import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'

import { packagedExecutablePaths } from '../scripts/package-paths.mjs'

test('macOS package smoke launches from the application bundle', () => {
  const root = '/validation/desktop'
  const executables = packagedExecutablePaths(root, 'darwin')
  const bundle = join(
    root,
    'src-tauri',
    'target',
    'release',
    'bundle',
    'macos',
    'CodeTether.app',
    'Contents',
    'MacOS',
  )
  assert.deepEqual(executables, {
    desktop: join(bundle, 'codetether-desktop'),
    host: join(bundle, 'codetether-host'),
  })
})

test('other package smokes retain their native release executables', () => {
  const root = '/validation/desktop'
  const release = join(root, 'src-tauri', 'target', 'release')
  assert.deepEqual(packagedExecutablePaths(root, 'linux'), {
    desktop: join(release, 'codetether-desktop'),
    host: join(release, 'codetether-host'),
  })
  assert.deepEqual(packagedExecutablePaths(root, 'win32'), {
    desktop: join(release, 'codetether-desktop.exe'),
    host: join(release, 'codetether-host.exe'),
  })
})
