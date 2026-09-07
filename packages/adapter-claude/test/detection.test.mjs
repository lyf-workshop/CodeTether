import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  ClaudeCodeDetector,
  ClaudeCodeOwnedProcessCleanupError,
  detectClaudeCode,
  prepareClaudeCode,
} from '../dist/index.js'

const fixture = fileURLToPath(
  new URL('./fixtures/fake-claude.mjs', import.meta.url),
)
const launcher = {
  kind: 'native',
  executable: process.execPath,
  prefixArguments: [fixture],
  sourcePath: process.execPath,
}

async function waitForPid(path) {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    try {
      const value = Number.parseInt(await readFile(path, 'utf8'), 10)
      if (Number.isSafeInteger(value) && value > 0) return value
    } catch {
      // The bounded fixture may not have reached its auth probe yet.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
  }
  throw new Error('fixture process identity was not observed')
}

function processExists(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code !== 'ESRCH'
  }
}

async function waitForProcessExit(pid) {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    if (!processExists(pid)) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
  }
  assert.fail(`fixture process ${String(pid)} remained alive`)
}

test('detects the exact tested version and caches the probe', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'codetether-claude-detect-'))
  const countPath = join(root, 'count.txt')
  await writeFile(countPath, '')
  t.after(async () => {
    await import('node:fs/promises').then(({ rm }) =>
      rm(root, { recursive: true, force: true }),
    )
  })
  const detector = new ClaudeCodeDetector({
    launcher,
    environment: {
      ...process.env,
      FAKE_CLAUDE_COUNT_PATH: countPath,
      FAKE_CLAUDE_VERSION: '2.1.251',
    },
  })

  const [first, second] = await Promise.all([
    detector.detect(),
    detector.detect(),
  ])
  assert.equal(first, second)
  assert.equal(first.status, 'available')
  assert.equal(first.version, '2.1.251')
  assert.equal(first.executablePath, process.execPath)
  assert.equal((await readFile(countPath, 'utf8')).trim(), 'version\nauth')
})

test('marks an unknown version unsupported instead of available', async () => {
  const result = await detectClaudeCode({
    launcher,
    environment: {
      ...process.env,
      FAKE_CLAUDE_VERSION: '2.2.0',
    },
  })
  assert.equal(result.status, 'unsupportedVersion')
  assert.equal(result.version, '2.2.0')
})

test('keeps both accepted and current verified Claude versions available', async () => {
  for (const version of ['2.1.250', '2.1.251', '2.1.263']) {
    const result = await detectClaudeCode({
      launcher,
      environment: {
        ...process.env,
        FAKE_CLAUDE_VERSION: version,
      },
    })
    assert.equal(result.status, 'available')
    assert.equal(result.version, version)
  }
})

test('maps invalid output and a missing executable to distinct states', async () => {
  const invalid = await detectClaudeCode({
    launcher,
    environment: {
      ...process.env,
      FAKE_CLAUDE_SCENARIO: 'version-invalid',
    },
  })
  assert.equal(invalid.status, 'misconfigured')
  assert.equal(invalid.diagnosticCode, 'version_output_invalid')

  const missing = await detectClaudeCode({
    platform: 'win32',
    environment: { Path: resolve('Z:\\missing-claude-path') },
  })
  assert.equal(missing.status, 'notInstalled')
  assert.equal(missing.diagnosticCode, 'provider_not_installed')
})

test('requires a bounded machine-readable logged-in auth status', async () => {
  for (const [authStatus, diagnosticCode] of [
    ['logged-out', 'auth_not_logged_in'],
    ['malformed', 'auth_status_invalid'],
    ['failure', 'auth_status_probe_failed'],
    ['hang', 'auth_status_probe_timeout'],
  ]) {
    const result = await detectClaudeCode({
      launcher,
      // This bound must include the separate --version child before the auth
      // child starts. A cold Windows Node process can legitimately take more
      // than 100 ms, which would test the wrong timeout boundary.
      timeoutMs: authStatus === 'hang' ? 3000 : 5000,
      environment: {
        ...process.env,
        FAKE_CLAUDE_AUTH_STATUS: authStatus,
      },
    })
    assert.equal(result.status, 'misconfigured')
    assert.equal(result.diagnosticCode, diagnosticCode)
  }
})

test('lifecycle abort waits for the exact in-flight auth probe tree to exit', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'codetether-claude-abort-'))
  const authPidPath = join(root, 'auth.pid')
  const childPidPath = join(root, 'auth-child.pid')
  const processOwnership =
    process.platform === 'win32' ? 'direct-child' : 'posix-process-group'
  t.after(async () => {
    await import('node:fs/promises').then(({ rm }) =>
      rm(root, { recursive: true, force: true }),
    )
  })
  const controller = new AbortController()
  const preparationPromise = prepareClaudeCode({
    launcher: {
      ...launcher,
      prefixArguments: [
        ...launcher.prefixArguments,
        '--fixture-auth-status=hang',
        `--fixture-auth-pid=${authPidPath}`,
        ...(process.platform === 'win32'
          ? []
          : [`--fixture-auth-child-pid=${childPidPath}`]),
      ],
    },
    timeoutMs: 30_000,
    signal: controller.signal,
    processOwnership,
    environment: {
      ...process.env,
    },
  })
  const authPid = await waitForPid(authPidPath)
  const childPid =
    process.platform === 'win32' ? undefined : await waitForPid(childPidPath)

  controller.abort()
  const preparation = await preparationPromise

  assert.equal(preparation.detection.status, 'misconfigured')
  assert.equal(
    preparation.detection.diagnosticCode,
    'auth_status_probe_aborted',
  )
  await waitForProcessExit(authPid)
  if (childPid !== undefined) await waitForProcessExit(childPid)
})

test(
  'successful POSIX auth probe also cleans descendants before settling',
  { skip: process.platform === 'win32' },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'codetether-claude-success-'))
    const childPidPath = join(root, 'auth-child.pid')
    let childPid
    t.after(async () => {
      if (childPid !== undefined && processExists(childPid)) {
        process.kill(childPid, 'SIGKILL')
      }
      await import('node:fs/promises').then(({ rm }) =>
        rm(root, { recursive: true, force: true }),
      )
    })
    const preparation = await prepareClaudeCode({
      launcher: {
        ...launcher,
        prefixArguments: [
          ...launcher.prefixArguments,
          `--fixture-auth-child-pid=${childPidPath}`,
        ],
      },
      timeoutMs: 5_000,
      processOwnership: 'posix-process-group',
      environment: { ...process.env },
    })
    childPid = await waitForPid(childPidPath)

    assert.equal(preparation.detection.status, 'available')
    await waitForProcessExit(childPid)
  },
)

test(
  'POSIX preparation propagates an unverified process-group cleanup',
  { skip: process.platform === 'win32' },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'codetether-claude-failure-'))
    const authPidPath = join(root, 'auth.pid')
    const childPidPath = join(root, 'auth-child.pid')
    const originalKill = process.kill
    let authPid
    let childPid
    t.after(async () => {
      process.kill = originalKill
      if (authPid !== undefined) {
        try {
          originalKill.call(process, -authPid, 'SIGKILL')
        } catch (error) {
          if (error?.code !== 'ESRCH') throw error
        }
      }
      if (childPid !== undefined) await waitForProcessExit(childPid)
      await import('node:fs/promises').then(({ rm }) =>
        rm(root, { recursive: true, force: true }),
      )
    })
    process.kill = (pid, signal) => {
      if (pid < 0 && signal !== 0) {
        const error = new Error('controlled process-group signal failure')
        error.code = 'EPERM'
        throw error
      }
      return originalKill.call(process, pid, signal)
    }
    const preparation = prepareClaudeCode({
      launcher: {
        ...launcher,
        prefixArguments: [
          ...launcher.prefixArguments,
          `--fixture-auth-pid=${authPidPath}`,
          `--fixture-auth-child-pid=${childPidPath}`,
        ],
      },
      timeoutMs: 1_000,
      processOwnership: 'posix-process-group',
      environment: { ...process.env },
    })
    authPid = await waitForPid(authPidPath)
    childPid = await waitForPid(childPidPath)

    await assert.rejects(
      preparation,
      (error) => error instanceof ClaudeCodeOwnedProcessCleanupError,
    )
  },
)

test('prepares restricted turns with only allowlisted user configuration', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'codetether-claude-config-'))
  const settingsPath = join(root, 'settings.json')
  await writeFile(
    settingsPath,
    JSON.stringify({
      env: {
        ANTHROPIC_AUTH_TOKEN: 'fixture-auth-token',
        ANTHROPIC_BASE_URL: 'https://example.invalid',
        UNSAFE_ARBITRARY_VALUE: 'must-not-cross',
        CLAUDE_CODE_ENTRYPOINT: 'must-not-cross',
      },
      hooks: { PreToolUse: [{ command: 'must-not-load' }] },
      enabledPlugins: { unsafe: true },
    }),
  )
  t.after(async () => {
    await import('node:fs/promises').then(({ rm }) =>
      rm(root, { recursive: true, force: true }),
    )
  })

  const preparation = await prepareClaudeCode({
    launcher,
    settingsPath,
    environment: {
      ...process.env,
      FAKE_CLAUDE_VERSION: '2.1.251',
      GITHUB_TOKEN: 'must-not-cross',
      AWS_SECRET_ACCESS_KEY: 'must-not-cross',
      NODE_OPTIONS: '--require=must-not-cross',
      CODETETHER_AUDIT_SECRET: 'must-not-cross',
    },
  })
  assert.equal(preparation.detection.status, 'available')
  const environment = preparation.runtimeEnvironment()
  assert.equal(environment.ANTHROPIC_AUTH_TOKEN, 'fixture-auth-token')
  assert.equal(environment.ANTHROPIC_BASE_URL, 'https://example.invalid')
  assert.equal(environment.UNSAFE_ARBITRARY_VALUE, undefined)
  assert.equal(environment.CLAUDE_CODE_ENTRYPOINT, undefined)
  assert.equal(environment.GITHUB_TOKEN, undefined)
  assert.equal(environment.AWS_SECRET_ACCESS_KEY, undefined)
  assert.equal(environment.NODE_OPTIONS, undefined)
  assert.equal(environment.CODETETHER_AUDIT_SECRET, undefined)
  assert.doesNotMatch(JSON.stringify(preparation), /fixture-auth-token/)
  assert.doesNotMatch(JSON.stringify(preparation), /must-not-load/)
})

test('explicit process auth wins over the user settings projection', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'codetether-claude-config-'))
  const settingsPath = join(root, 'settings.json')
  await writeFile(
    settingsPath,
    JSON.stringify({ env: { ANTHROPIC_API_KEY: 'settings-auth' } }),
  )
  t.after(async () => {
    await import('node:fs/promises').then(({ rm }) =>
      rm(root, { recursive: true, force: true }),
    )
  })

  const preparation = await prepareClaudeCode({
    launcher,
    settingsPath,
    environment: {
      ...process.env,
      ANTHROPIC_API_KEY: 'process-auth',
    },
  })
  assert.equal(
    preparation.runtimeEnvironment().ANTHROPIC_API_KEY,
    'process-auth',
  )
})
