import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { createHostProcessLifecycle } from '../dist/host-process-lifecycle.js'
import { ConversationStore } from '../dist/persistence/index.js'
import {
  parseServeArguments,
  resolveHostVersion,
} from '../dist/serve-config.js'

const hostRoot = fileURLToPath(new URL('../', import.meta.url))
const serveEntry = join(hostRoot, 'dist', 'serve.js')
const desktopOrigin = 'http://tauri.localhost'

test('Desktop-managed lifecycle accepts only its shutdown line and cleans listeners', async () => {
  const signalSource = new EventEmitter()
  const input = new PassThrough()
  const lifecycle = createHostProcessLifecycle({
    desktopManaged: true,
    input,
    signalSource,
  })

  input.write('unknown\r\nshut')
  input.write('down\r\n')
  assert.equal(await lifecycle.activated, false)
  assert.equal(await lifecycle.requested, 'desktop_shutdown')
  assert.equal(lifecycle.isRequested, true)
  assert.equal(signalSource.listenerCount('SIGINT'), 0)
  assert.equal(signalSource.listenerCount('SIGTERM'), 0)
  assert.equal(input.listenerCount('data'), 0)
  assert.equal(input.listenerCount('end'), 0)
})

test('Desktop-managed lifecycle requires an exact activation before startup', async () => {
  const input = new PassThrough()
  const lifecycle = createHostProcessLifecycle({
    desktopManaged: true,
    input,
    signalSource: new EventEmitter(),
  })

  input.write('not-start\nstart\n')
  assert.equal(await lifecycle.activated, true)
  assert.equal(lifecycle.isRequested, false)
  input.write('shutdown\n')
  assert.equal(await lifecycle.requested, 'desktop_shutdown')
})

test('Desktop-managed lifecycle treats EOF and a corrupt oversized channel as shutdown', async () => {
  const eofInput = new PassThrough()
  const eofLifecycle = createHostProcessLifecycle({
    desktopManaged: true,
    input: eofInput,
    signalSource: new EventEmitter(),
  })
  eofInput.end()
  assert.equal(await eofLifecycle.requested, 'desktop_parent_eof')

  const corruptInput = new PassThrough()
  const corruptLifecycle = createHostProcessLifecycle({
    desktopManaged: true,
    input: corruptInput,
    signalSource: new EventEmitter(),
    maxDesktopCommandBytes: 8,
  })
  corruptInput.write('123456789')
  assert.equal(await corruptLifecycle.requested, 'desktop_channel_error')
})

test('Browser lifecycle ignores stdin EOF and retains existing signal shutdown', async () => {
  const signalSource = new EventEmitter()
  const input = new PassThrough()
  const lifecycle = createHostProcessLifecycle({
    desktopManaged: false,
    input,
    signalSource,
  })
  let requested = false
  void lifecycle.requested.then(() => {
    requested = true
  })

  input.end()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(requested, false)
  signalSource.emit('SIGTERM')
  assert.equal(await lifecycle.requested, 'SIGTERM')
})

test('managed serve configuration excludes Browser dev origins and supports injected versions', async () => {
  assert.deepEqual(parseServeArguments([], { desktopManaged: false }).origins, [
    'http://127.0.0.1:5173',
    'http://localhost:5173',
  ])
  assert.deepEqual(
    parseServeArguments(['--origin', desktopOrigin], {
      desktopManaged: true,
    }).origins,
    [desktopOrigin],
  )
  assert.equal(
    await resolveHostVersion({
      env: { CODETETHER_HOST_VERSION: ' 0.0.0+desktop-test ' },
      packageJsonUrl: new URL('file:///must-not-be-read/package.json'),
    }),
    '0.0.0+desktop-test',
  )
  assert.equal(
    await resolveHostVersion({
      injectedVersion: '0.0.0+compile-revision',
      env: { CODETETHER_HOST_VERSION: '0.0.0+environment-revision' },
    }),
    '0.0.0+compile-revision',
  )
})

test('managed serve performs a real graceful shutdown through stdin', async (t) => {
  const harness = await spawnManagedHost(t)
  const ready = await harness.ready

  assert.equal(ready.host, '127.0.0.1')
  assert.deepEqual(ready.allowedOrigins, [desktopOrigin])
  const bootstrap = await fetch(`${ready.baseUrl}/api/v1/bootstrap`, {
    headers: { Origin: desktopOrigin },
  })
  assert.equal(bootstrap.status, 200)
  assert.equal(
    (await bootstrap.json()).hostVersion,
    '0.0.0+desktop-lifecycle-test',
  )
  const deniedBrowserOrigin = await fetch(`${ready.baseUrl}/api/v1/bootstrap`, {
    headers: { Origin: 'http://127.0.0.1:5173' },
  })
  assert.equal(deniedBrowserOrigin.status, 403)
  await deniedBrowserOrigin.arrayBuffer()
  const liveEvents = await fetch(`${ready.baseUrl}/api/v1/events`, {
    headers: { Origin: desktopOrigin },
  })
  assert.equal(liveEvents.status, 200)

  const exit = waitForExit(harness.child, 10_000, harness.diagnostics)
  const shutdownStartedAt = performance.now()
  assert.equal(harness.child.stdin.destroyed, false)
  await new Promise((resolve, reject) => {
    harness.child.stdin.write('shutdown\n', (error) => {
      if (error === null || error === undefined) resolve()
      else reject(error)
    })
  })
  assert.deepEqual(await exit, { code: 0, signal: null })
  assert.ok(
    performance.now() - shutdownStartedAt < 3_000,
    'A live SSE client must not hold graceful shutdown open',
  )
  await liveEvents.body?.cancel().catch(() => undefined)
  assert.equal(harness.child.stdin.destroyed, true)
  assertDatabaseReopens(ready.databasePath)
  await assert.rejects(
    fetch(`${ready.baseUrl}/api/v1/bootstrap`, {
      signal: AbortSignal.timeout(2_000),
    }),
  )
})

test('managed serve observes parent EOF even when it happens during startup', async (t) => {
  const harness = await spawnManagedHost(t, { waitForReady: false })
  const exit = waitForExit(harness.child, 10_000, harness.diagnostics)
  harness.child.stdin.end()

  assert.deepEqual(await exit, { code: 0, signal: null })
  assertDatabaseReopens(harness.databasePath)
})

test('managed serve does not initialize Host state before Desktop activation', async (t) => {
  const harness = await spawnManagedHost(t, {
    activate: false,
    waitForReady: false,
  })
  let wroteOutput = false
  harness.child.stdout.once('data', () => {
    wroteOutput = true
  })
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(wroteOutput, false)

  const exit = waitForExit(harness.child, 10_000, harness.diagnostics)
  harness.child.stdin.end()
  assert.deepEqual(await exit, { code: 0, signal: null })
})

async function spawnManagedHost(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-managed-host-'))
  const dataDirectory = join(directory, 'data')
  const databasePath = join(dataDirectory, 'codetether.sqlite3')
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => name.toUpperCase() !== 'PATH',
    ),
  )
  environment.PATH = ''
  environment.CODETETHER_DATA_DIR = dataDirectory
  environment.CODETETHER_DESKTOP_MANAGED = '1'
  environment.CODETETHER_HOST_VERSION = '0.0.0+desktop-lifecycle-test'
  const child = spawn(
    process.execPath,
    [serveEntry, '--port', '0', '--origin', desktopOrigin],
    {
      cwd: hostRoot,
      env: environment,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )
  const diagnostics = []
  child.stderr.on('data', (chunk) => diagnostics.push(chunk))
  if (options.activate !== false) child.stdin.write('start\n')
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.stdin.end()
      await waitForExit(child, 3_000).catch(async () => {
        child.kill()
        await waitForExit(child, 3_000).catch(() => undefined)
      })
    }
    await rm(directory, { recursive: true, force: true })
  })

  return {
    child,
    databasePath,
    diagnostics,
    ready:
      options.waitForReady === false
        ? Promise.resolve(undefined)
        : readReadyLine(child, diagnostics),
  }
}

async function readReadyLine(child, diagnostics, timeoutMs = 10_000) {
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(
        new Error(
          `Managed Host did not become ready: ${Buffer.concat(diagnostics).toString('utf8')}`,
        ),
      )
    }, timeoutMs)
    const onError = (error) => {
      cleanup()
      reject(error)
    }
    const onExit = (code, signal) => {
      cleanup()
      reject(
        new Error(
          `Managed Host exited before readiness (${String(code)}, ${String(signal)}): ${Buffer.concat(diagnostics).toString('utf8')}`,
        ),
      )
    }
    const cleanup = () => {
      clearTimeout(timer)
      child.off('error', onError)
      child.off('exit', onExit)
      lines.close()
    }
    child.once('error', onError)
    child.once('exit', onExit)
    lines.once('line', (line) => {
      cleanup()
      try {
        resolve(JSON.parse(line))
      } catch (error) {
        reject(error)
      }
    })
  })
}

async function waitForExit(child, timeoutMs = 10_000, diagnostics = []) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode }
  }
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off('exit', onExit)
      reject(
        new Error(
          `Managed Host did not exit in time: ${Buffer.concat(diagnostics).toString('utf8')}`,
        ),
      )
    }, timeoutMs)
    const onExit = (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal })
    }
    child.once('exit', onExit)
  })
}

function assertDatabaseReopens(databasePath) {
  assert.equal(typeof databasePath, 'string')
  const store = ConversationStore.open({ databasePath })
  store.close()
}
