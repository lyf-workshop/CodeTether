import assert from 'node:assert/strict'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  CodexOwnedProcessCleanupError,
  runBoundedCodexProbe,
} from '../dist/index.js'

test('Codex version/help probes admit only the Provider environment allowlist', async () => {
  const secretSentinel = 'codetether-node-relay-secret-sentinel'
  const output = await runBoundedCodexProbe({
    executable: process.execPath,
    arguments: [
      '--eval',
      `process.stdout.write(JSON.stringify({ secret: process.env.CODETETHER_NODE_RELAY_PRIVATE_KEY, providerKeyPresent: process.env.CODEX_API_KEY === 'fixture-provider-key', pathPresent: typeof process.env.PATH === 'string' }))`,
    ],
    environment: {
      ...process.env,
      CODETETHER_NODE_RELAY_PRIVATE_KEY: secretSentinel,
      CODEX_API_KEY: 'fixture-provider-key',
    },
  })

  assert.deepEqual(JSON.parse(output), {
    providerKeyPresent: true,
    pathPresent: true,
  })
  assert.equal(output.includes(secretSentinel), false)
})

for (const failureMode of ['timeout', 'output', 'abort']) {
  test(`Codex ${failureMode} probe failure awaits confirmed child cleanup`, async () => {
    const fixture = await createProbeFixture(false)
    try {
      const controller = new AbortController()
      const promise = runProbeFixture(fixture.pidPath, failureMode, controller)
      if (failureMode === 'abort') {
        await waitForFile(fixture.pidPath)
        controller.abort()
      }
      await assert.rejects(
        promise,
        failureMode === 'timeout'
          ? /timed out/u
          : failureMode === 'output'
            ? /exceeded its bound/u
            : { name: 'AbortError' },
      )
      const [pid] = await readPids(fixture.pidPath)
      assert.equal(isProcessAlive(pid), false)
    } finally {
      await fixture.cleanup()
    }
  })
}

test('Codex abort reports typed ownership uncertainty when exact probe cleanup fails', async () => {
  const fixture = await createProbeFixture(false)
  const cleanupFailure = new Error('test-owned private cleanup failure')
  const controller = new AbortController()
  try {
    const promise = runProbeFixture(
      fixture.pidPath,
      'abort',
      controller,
      false,
      async (child) => {
        await terminateFixtureChild(child)
        throw cleanupFailure
      },
    )
    await waitForFile(fixture.pidPath)
    controller.abort()
    await assert.rejects(
      promise,
      (error) =>
        error instanceof CodexOwnedProcessCleanupError &&
        error.failureReason === 'execution_ownership_uncertain' &&
        error.cause === cleanupFailure,
    )
    const [pid] = await readPids(fixture.pidPath)
    assert.equal(isProcessAlive(pid), false)
  } finally {
    await fixture.cleanup()
  }
})

test(
  'Codex successful probe reports typed ownership uncertainty when final group cleanup fails',
  { skip: process.platform === 'win32' },
  async () => {
    const cleanupFailure = new Error('test-owned private final cleanup failure')
    await assert.rejects(
      runBoundedCodexProbe({
        executable: process.execPath,
        arguments: ['--eval', "process.stdout.write('codex-cli 0.149.1')"],
        environment: { ...process.env },
        closeOwnedProcess: async () => {
          throw cleanupFailure
        },
      }),
      (error) =>
        error instanceof CodexOwnedProcessCleanupError &&
        error.failureReason === 'execution_ownership_uncertain' &&
        error.cause === cleanupFailure,
    )
  },
)

for (const failureMode of ['timeout', 'output', 'abort']) {
  test(
    `Codex ${failureMode} probe failure removes its exact POSIX descendant group`,
    { skip: process.platform === 'win32' },
    async () => {
      const fixture = await createProbeFixture(true)
      try {
        const controller = new AbortController()
        const promise = runProbeFixture(
          fixture.pidPath,
          failureMode,
          controller,
          true,
        )
        if (failureMode === 'abort') {
          await waitForFile(fixture.pidPath)
          controller.abort()
        }
        await assert.rejects(promise)
        const pids = await readPids(fixture.pidPath)
        assert.equal(pids.length, 2)
        for (const pid of pids) assert.equal(isProcessAlive(pid), false)
      } finally {
        await fixture.cleanup()
      }
    },
  )
}

async function createProbeFixture(withDescendant) {
  const nonce = `${String(process.pid)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  const pidPath = join(tmpdir(), `codetether-codex-probe-${nonce}.json`)
  await writeFile(pidPath, '')
  return {
    pidPath,
    withDescendant,
    cleanup: async () => await rm(pidPath, { force: true }),
  }
}

function runProbeFixture(
  pidPath,
  failureMode,
  controller,
  withDescendant = false,
  closeOwnedProcess,
) {
  const script = withDescendant
    ? `const { spawn } = require('node:child_process'); const { writeFileSync } = require('node:fs'); const descendant = spawn(process.execPath, ['--eval', 'setInterval(() => undefined, 60000)'], { stdio: 'ignore' }); writeFileSync(process.argv[1], JSON.stringify([process.pid, descendant.pid])); ${failureMode === 'output' ? "process.stdout.write('x'.repeat(8192));" : ''} setInterval(() => undefined, 60000);`
    : `const { writeFileSync } = require('node:fs'); writeFileSync(process.argv[1], JSON.stringify([process.pid])); ${failureMode === 'output' ? "process.stdout.write('x'.repeat(8192));" : ''} setInterval(() => undefined, 60000);`
  return runBoundedCodexProbe({
    executable: process.execPath,
    arguments: ['--eval', script, pidPath],
    environment: { ...process.env },
    timeoutMs: failureMode === 'timeout' ? 1_000 : 10_000,
    maximumOutputBytes: failureMode === 'output' ? 64 : 4 * 1024,
    signal: controller.signal,
    ...(closeOwnedProcess === undefined ? {} : { closeOwnedProcess }),
  })
}

async function terminateFixtureChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const closed = new Promise((resolve) => child.once('close', resolve))
  child.kill('SIGKILL')
  await closed
}

async function waitForFile(path) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const source = await readFile(path, 'utf8')
    if (source.length > 0) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('Probe fixture did not publish its process identity')
}

async function readPids(path) {
  await waitForFile(path)
  const parsed = JSON.parse(await readFile(path, 'utf8'))
  assert.ok(Array.isArray(parsed))
  return parsed
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
      return false
    }
    if (
      process.platform === 'win32' &&
      error instanceof Error &&
      'code' in error &&
      error.code === 'EINVAL'
    ) {
      return false
    }
    throw error
  }
}
