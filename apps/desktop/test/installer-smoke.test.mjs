import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { win32 } from 'node:path'
import test from 'node:test'

import {
  assertOwnedTemporaryRoot,
  assertInstalledShortcuts,
  assertTrayQuitResult,
  installerArguments,
  InstallerSmokeCleanupUnsafeError,
  normalizeRegistryPath,
  parseInstallerSmokeMode,
  validateInstallerSmokeSession,
  waitForChildProcessExit,
  waitForChildSpawn,
} from '../scripts/installer-smoke.mjs'

const temporaryDirectory = 'C:\\Temp'
const root = win32.join(temporaryDirectory, 'codetether-installed-smoke-test')

const join = win32.join

test('installer smoke modes are explicit', () => {
  assert.equal(parseInstallerSmokeMode([]), 'run')
  assert.equal(parseInstallerSmokeMode(['run']), 'run')
  assert.equal(parseInstallerSmokeMode(['hold']), 'hold')
  assert.equal(parseInstallerSmokeMode(['cleanup']), 'cleanup')
  assert.throws(() => parseInstallerSmokeMode(['unknown']))
  assert.throws(() => parseInstallerSmokeMode(['hold', 'cleanup']))
})

test('installer smoke accepts only its exact temp-root prefix', () => {
  assert.equal(assertOwnedTemporaryRoot(root, temporaryDirectory), root)
  assert.throws(() =>
    assertOwnedTemporaryRoot('C:\\Users\\Administrator', temporaryDirectory),
  )
  assert.throws(() =>
    assertOwnedTemporaryRoot(
      join(temporaryDirectory, 'other-product-smoke-test'),
      temporaryDirectory,
    ),
  )
})

test('installer smoke state keeps every mutable path under its owned root', () => {
  const value = {
    schemaVersion: 1,
    productName: 'CodeTether',
    root,
    installRoot: join(root, 'app'),
    dataDirectory: join(root, 'data'),
    webViewDataDirectory: join(root, 'webview'),
    projectDirectory: join(root, 'workspace', '项目测试 (Folder Picker)'),
    desktopExecutable: join(root, 'app', 'codetether-desktop.exe'),
    hostExecutable: join(root, 'app', 'codetether-host.exe'),
    uninstallExecutable: join(root, 'app', 'uninstall.exe'),
    desktopPid: 1234,
  }
  assert.equal(
    validateInstallerSmokeSession(value, temporaryDirectory).installRoot,
    join(root, 'app'),
  )
  assert.throws(() =>
    validateInstallerSmokeSession(
      {
        ...value,
        dataDirectory: 'C:\\Users\\Administrator\\AppData\\Local\\CodeTether',
      },
      temporaryDirectory,
    ),
  )
  assert.throws(() =>
    validateInstallerSmokeSession(
      { ...value, desktopPid: -1 },
      temporaryDirectory,
    ),
  )
})

test('quoted NSIS registry paths normalize without shell parsing', () => {
  assert.equal(
    normalizeRegistryPath('  "C:\\Temp\\CodeTether App"  '),
    'C:\\Temp\\CodeTether App',
  )
  assert.equal(
    normalizeRegistryPath('C:\\Temp\\CodeTether App'),
    'C:\\Temp\\CodeTether App',
  )
})

test('installer smoke keeps shortcut registration enabled', () => {
  assert.deepEqual(installerArguments(join(root, 'app')), [
    '/S',
    `/D=${join(root, 'app')}`,
  ])
  assert.equal(installerArguments(join(root, 'app')).includes('/NS'), false)
})

test('installed shortcuts must target the isolated Desktop executable', () => {
  const executable = join(root, 'app', 'codetether-desktop.exe')
  const shortcut = {
    path: join(
      'C:\\Users\\Administrator\\AppData\\Roaming',
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs',
      'CodeTether.lnk',
    ),
    target: executable,
  }
  assert.deepEqual(assertInstalledShortcuts([shortcut], executable), [shortcut])
  assert.throws(() => assertInstalledShortcuts([], executable))
  assert.throws(() =>
    assertInstalledShortcuts(
      [{ ...shortcut, target: 'C:\\Program Files\\Other\\other.exe' }],
      executable,
    ),
  )
})

test('tray quit confirmation is bound to the exact owned Desktop identity', () => {
  const result = {
    quitRequested: true,
    desktopPid: 1234,
    trayTooltip: 'CodeTether',
    menuItem: '退出 CodeTether',
    selectionMethod: 'uia-owned-popup-exact-label',
    processIds: [1234, 5678],
  }
  assert.equal(assertTrayQuitResult(result, 1234), result)
  assert.throws(() => assertTrayQuitResult(result, 4321))
  assert.throws(() =>
    assertTrayQuitResult({ ...result, menuItem: 'Exit' }, 1234),
  )
  assert.throws(() =>
    assertTrayQuitResult({ ...result, processIds: [5678] }, 1234),
  )
  assert.throws(() =>
    assertTrayQuitResult({ ...result, selectionMethod: 'keyboard' }, 1234),
  )
})

test('Desktop spawn errors are consumed through the startup promise', async () => {
  const child = new EventEmitter()
  const startup = waitForChildSpawn(child, 'Installed Desktop')
  queueMicrotask(() => child.emit('error', new Error('access denied')))

  await assert.rejects(startup, /Installed Desktop spawn failed: access denied/)
  assert.equal(child.listenerCount('error'), 0)
  assert.equal(child.listenerCount('spawn'), 0)
})

test('a timed-out child is observed exiting before timeout is reported', async () => {
  const child = new EventEmitter()
  let exited = false
  child.kill = () => {
    setTimeout(() => {
      exited = true
      child.emit('close', null, 'SIGTERM')
    }, 5)
    return true
  }

  await assert.rejects(
    waitForChildProcessExit(child, {
      label: 'NSIS installer',
      terminationTimeoutMs: 100,
      timeoutMs: 1,
    }),
    /NSIS installer timed out after 1 ms/,
  )
  assert.equal(exited, true)
})

test('an unconfirmed child exit is marked unsafe for automatic cleanup', async () => {
  const child = new EventEmitter()
  child.kill = () => false

  await assert.rejects(
    waitForChildProcessExit(child, {
      label: 'NSIS uninstaller',
      terminationTimeoutMs: 5,
      timeoutMs: 1,
    }),
    (error) =>
      error instanceof InstallerSmokeCleanupUnsafeError &&
      /exit could not be confirmed/.test(error.message),
  )
})
