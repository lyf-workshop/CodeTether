import { spawn } from 'node:child_process'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)))
const executable = join(
  desktopDirectory,
  'src-tauri',
  'target',
  'release',
  process.platform === 'win32'
    ? 'codetether-desktop.exe'
    : 'codetether-desktop',
)
await stat(executable)
const hostExecutable = join(
  desktopDirectory,
  'src-tauri',
  'target',
  'release',
  process.platform === 'win32' ? 'codetether-host.exe' : 'codetether-host',
)
await stat(hostExecutable)

if (await isListening(4317)) {
  throw new Error('Package smoke requires port 4317 to be free')
}

const dataDirectory = await mkdtemp(join(tmpdir(), 'codetether-desktop-smoke-'))
const startedAt = performance.now()
const child = spawn(executable, ['--desktop-smoke-exit-after-ready'], {
  cwd: desktopDirectory,
  env: {
    ...process.env,
    CODETETHER_DATA_DIR: dataDirectory,
    CODETETHER_DESKTOP_TEST_SUPPRESS_DIALOG: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})

let diagnostics = ''
child.stdout.on('data', (chunk) => {
  diagnostics += chunk.toString()
})
child.stderr.on('data', (chunk) => {
  diagnostics += chunk.toString()
})

const exitCode = await new Promise((resolveExit, reject) => {
  let timedOut = false
  let forcedExitTimeout
  const timeout = setTimeout(() => {
    timedOut = true
    child.kill()
    forcedExitTimeout = setTimeout(() => {
      reject(
        new Error(
          `Packaged Desktop did not exit after a smoke timeout\n${diagnostics}`,
        ),
      )
    }, 5_000)
  }, 45_000)
  child.once('error', (error) => {
    clearTimeout(timeout)
    clearTimeout(forcedExitTimeout)
    reject(error)
  })
  child.once('exit', (code) => {
    clearTimeout(timeout)
    clearTimeout(forcedExitTimeout)
    if (timedOut) {
      reject(new Error(`Packaged Desktop smoke timed out\n${diagnostics}`))
    } else {
      resolveExit(code)
    }
  })
})

if (exitCode !== 0) {
  throw new Error(
    `Packaged Desktop exited with ${String(exitCode)}\n${diagnostics}`,
  )
}
const databasePath = join(dataDirectory, 'codetether.sqlite3')
const database = await stat(databasePath)
if (database.size === 0) {
  throw new Error('Packaged Host created an empty SQLite database')
}
await waitUntilNotListening(4317, 10_000)
await removeOwnedTemporaryDirectory(dataDirectory)
process.stdout.write(
  `${JSON.stringify({
    executable,
    hostExecutable,
    dataDirectory,
    databasePath,
    databaseBytes: database.size,
    dataDirectoryCleaned: true,
    elapsedMs: Math.round(performance.now() - startedAt),
    exitCode,
  })}\n`,
)

async function removeOwnedTemporaryDirectory(directory) {
  const resolved = resolve(directory)
  if (
    dirname(resolved) !== resolve(tmpdir()) ||
    !basename(resolved).startsWith('codetether-desktop-smoke-')
  ) {
    throw new Error(
      `Refusing to remove unexpected smoke directory: ${resolved}`,
    )
  }
  await rm(resolved, { recursive: true, force: true })
}

async function isListening(port) {
  return await new Promise((resolveListening) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    socket.setTimeout(300)
    socket.once('connect', () => {
      socket.destroy()
      resolveListening(true)
    })
    const resolveClosed = () => {
      socket.destroy()
      resolveListening(false)
    }
    socket.once('timeout', resolveClosed)
    socket.once('error', resolveClosed)
  })
}

async function waitUntilNotListening(port, timeoutMs) {
  const deadline = performance.now() + timeoutMs
  while (performance.now() < deadline) {
    if (!(await isListening(port))) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error(`Owned Host still listens on ${String(port)} after exit`)
}
