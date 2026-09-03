import { execFile, spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { relayArtifactName } from './build-relay.mjs'

const relayDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const artifact = join(relayDirectory, 'dist', 'sea', relayArtifactName())
const root = await mkdtemp(join(tmpdir(), 'codetether-relay-sea-smoke-'))
const configurationPath = join(root, 'relay.json')
const stateDirectory = join(root, 'state')
let child

try {
  await writeFile(
    configurationPath,
    `${JSON.stringify(
      {
        stateDirectory,
        listen: { host: '127.0.0.1', port: 0 },
        management: { host: '127.0.0.1', port: 0 },
        tls: { mode: 'pinned_identity' },
      },
      null,
      2,
    )}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  child = spawn(artifact, ['serve', '--config', configurationPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const ready = await waitForReady(child)
  const health = await fetch(`http://127.0.0.1:${ready.managementPort}/healthz`)
  if (health.status !== 200 || (await health.json()).status !== 'ok') {
    throw new Error('Relay SEA health smoke failed')
  }
  const readiness = await fetch(
    `http://127.0.0.1:${ready.managementPort}/readyz`,
  )
  if (readiness.status !== 200 || (await readiness.json()).status !== 'ready') {
    throw new Error('Relay SEA readiness smoke failed')
  }
  child.kill('SIGTERM')
  await waitForExit(child)
  child = undefined

  const identity = JSON.parse(
    await execute(artifact, ['identity', '--state-dir', stateDirectory]),
  )
  if (
    identity.relayId !== ready.relayId ||
    identity.relayFingerprint !== ready.relayFingerprint
  ) {
    throw new Error('Relay SEA identity changed after lifecycle smoke')
  }
  process.stdout.write(
    `${JSON.stringify({
      status: 'passed',
      buildIdentity: ready.buildIdentity,
      relayId: ready.relayId,
      relayFingerprint: ready.relayFingerprint,
    })}\n`,
  )
} finally {
  child?.kill('SIGKILL')
  await rm(root, { recursive: true, force: true })
}

async function waitForReady(process_) {
  let stdout = ''
  let stderrBytes = 0
  process_.stderr.on('data', (chunk) => {
    stderrBytes += chunk.length
    if (stderrBytes > 64 * 1024) process_.kill('SIGKILL')
  })
  return await new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Relay SEA did not become ready'))
      process_.kill('SIGKILL')
    }, 10_000)
    process_.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    process_.once('exit', () => {
      clearTimeout(timer)
      reject(new Error('Relay SEA exited before readiness'))
    })
    process_.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8')
      if (Buffer.byteLength(stdout, 'utf8') > 64 * 1024) {
        clearTimeout(timer)
        reject(new Error('Relay SEA emitted oversized startup output'))
        process_.kill('SIGKILL')
        return
      }
      const lines = stdout.split('\n')
      stdout = lines.pop() ?? ''
      for (const line of lines) {
        try {
          const value = JSON.parse(line)
          if (
            value.event === 'relay.ready' &&
            Number.isSafeInteger(value.port) &&
            Number.isSafeInteger(value.managementPort)
          ) {
            clearTimeout(timer)
            resolvePromise(value)
            return
          }
        } catch {
          // Only the controlled ready record is relevant to this smoke.
        }
      }
    })
  })
}

async function waitForExit(process_) {
  if (process_.exitCode !== null || process_.signalCode !== null) return
  await new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      process_.kill('SIGKILL')
      reject(new Error('Relay SEA did not stop in bounded time'))
    }, 10_000)
    process_.once('exit', () => {
      clearTimeout(timer)
      resolvePromise()
    })
  })
}

async function execute(command, arguments_) {
  return await new Promise((resolvePromise, reject) => {
    execFile(
      command,
      arguments_,
      { encoding: 'utf8', maxBuffer: 64 * 1024, windowsHide: true },
      (error, stdout) => {
        if (error === null) resolvePromise(stdout)
        else reject(error)
      },
    )
  })
}
