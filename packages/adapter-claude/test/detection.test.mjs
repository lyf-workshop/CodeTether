import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  ClaudeCodeDetector,
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
  for (const version of ['2.1.250', '2.1.251']) {
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
      timeoutMs: authStatus === 'hang' ? 100 : 5000,
      environment: {
        ...process.env,
        FAKE_CLAUDE_AUTH_STATUS: authStatus,
      },
    })
    assert.equal(result.status, 'misconfigured')
    assert.equal(result.diagnosticCode, diagnosticCode)
  }
})

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
