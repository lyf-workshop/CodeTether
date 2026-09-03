import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { ClaudeCodeOwnedProcessCleanupError } from '@codetether/adapter-claude'

import {
  RemoteProviderDetector,
  isRemoteCodexExecutionVersion,
  supportsRemoteClaudeExecutionPlatform,
  supportsRemoteCodexExecutionPlatform,
} from '../dist/provider-discovery.js'

const fixedNow = new Date('2026-08-31T12:34:56.000Z')

function probe(provider, script, overrides = {}) {
  return {
    provider,
    displayName: provider === 'codex' ? 'Codex' : 'Claude Code',
    executable: process.execPath,
    arguments: ['-e', script],
    parseVersion:
      provider === 'codex'
        ? (output) => /^codex-cli (\S+)$/u.exec(output)?.[1]
        : (output) => /^(\S+) \(Claude Code\)$/u.exec(output)?.[1],
    isSupportedVersion:
      provider === 'codex' ? () => true : (version) => version === '2.1.251',
    ...overrides,
  }
}

function detector(codexScript, claudeScript, options = {}) {
  return new RemoteProviderDetector({
    probes: [probe('codex', codexScript), probe('claude-code', claudeScript)],
    timeoutMs: 500,
    maximumOutputBytes: 128,
    now: () => fixedNow,
    claudeExecutionProbe: async () => ({ available: false }),
    ...options,
  })
}

test('bounded discovery advertises only the Codex text execution foundation', async () => {
  const instance = detector(
    "process.stdout.write('codex-cli 0.149.1')",
    "process.stdout.write('2.1.251 (Claude Code)')",
  )
  try {
    const first = instance.discover()
    const duplicate = instance.discover()
    assert.equal(first, duplicate)
    const result = await first
    assert.equal(result.observedAt, fixedNow.toISOString())
    assert.deepEqual(
      result.providers.map(({ provider, availability, version }) => ({
        provider,
        availability,
        version,
      })),
      [
        { provider: 'codex', availability: 'available', version: '0.149.1' },
        {
          provider: 'claude-code',
          availability: 'available',
          version: '2.1.251',
        },
      ],
    )
    for (const provider of result.providers) {
      assert.deepEqual(
        Object.entries(provider.capabilities)
          .filter(([, enabled]) => enabled)
          .map(([capability]) => capability)
          .sort(),
        provider.provider === 'codex' && supportsRemoteCodexExecutionPlatform()
          ? ['resume', 'streaming']
          : [],
      )
      assert.equal('executablePath' in provider, false)
      assert.equal('rawOutput' in provider, false)
    }
  } finally {
    await instance.close()
  }
})

test('production remote Codex execution is gated to the tested version', () => {
  assert.equal(isRemoteCodexExecutionVersion('0.149.1'), true)
  assert.equal(isRemoteCodexExecutionVersion('0.149.0'), false)
  assert.equal(isRemoteCodexExecutionVersion('0.150.0'), false)
  assert.equal(supportsRemoteCodexExecutionPlatform('linux'), true)
  assert.equal(supportsRemoteCodexExecutionPlatform('darwin'), true)
  assert.equal(supportsRemoteCodexExecutionPlatform('win32'), false)
  assert.equal(supportsRemoteClaudeExecutionPlatform('linux'), true)
  assert.equal(supportsRemoteClaudeExecutionPlatform('darwin'), true)
  assert.equal(supportsRemoteClaudeExecutionPlatform('win32'), false)
})

test('authenticated tested Claude advertises only the restricted execution matrix', async () => {
  const instance = detector(
    "process.stdout.write('codex-cli 0.149.1')",
    "process.stdout.write('2.1.251 (Claude Code)')",
    {
      platform: 'linux',
      claudeExecutionProbe: async () => ({
        available: true,
        version: '2.1.251',
      }),
    },
  )
  try {
    const claude = (await instance.discover()).providers.find(
      ({ provider }) => provider === 'claude-code',
    )
    assert.equal(claude.availability, 'available')
    assert.deepEqual(
      Object.entries(claude.capabilities)
        .filter(([, enabled]) => enabled)
        .map(([capability]) => capability)
        .sort(),
      [
        'fileRead',
        'reasoningControl',
        'resume',
        'search',
        'streaming',
        'toolEvents',
      ],
    )
    assert.equal(claude.reasoningLabel, '思考强度')
    assert.deepEqual(
      claude.reasoningOptions.map(({ id }) => id),
      ['low', 'medium', 'high', 'xhigh', 'max'],
    )
    assert.equal('launcher' in claude, false)
    assert.equal('environment' in claude, false)
  } finally {
    await instance.close()
  }
})

test('Claude installation truth remains separate from authenticated execution truth', async () => {
  const instance = detector(
    "process.stdout.write('codex-cli 0.149.1')",
    "process.stdout.write('2.1.251 (Claude Code)')",
    {
      platform: 'linux',
      claudeExecutionProbe: async () => ({ available: false }),
    },
  )
  try {
    const claude = (await instance.discover()).providers.find(
      ({ provider }) => provider === 'claude-code',
    )
    assert.equal(claude.availability, 'available')
    assert.equal(
      Object.values(claude.capabilities).some((enabled) => enabled),
      false,
    )
    assert.equal(claude.reasoningOptions, undefined)
  } finally {
    await instance.close()
  }
})

test('Claude login health is a controlled execution diagnostic, not installation truth', async () => {
  const instance = detector(
    "process.stdout.write('codex-cli 0.149.1')",
    "process.stdout.write('2.1.251 (Claude Code)')",
    {
      platform: 'linux',
      claudeExecutionProbe: async () => ({
        available: false,
        failureReason: 'login_required',
        rawDiagnostic: '<script>private token and auth path</script>',
      }),
    },
  )
  try {
    const claude = (await instance.discover()).providers.find(
      ({ provider }) => provider === 'claude-code',
    )
    assert.equal(claude.availability, 'available')
    assert.equal(claude.version, '2.1.251')
    assert.equal(
      Object.values(claude.capabilities).some((enabled) => enabled),
      false,
    )
    assert.equal(claude.executionFailureReason, 'login_required')
    assert.doesNotMatch(
      JSON.stringify(claude),
      /script|private token|auth path|rawDiagnostic/u,
    )
  } finally {
    await instance.close()
  }
})

test('valid untested Codex remains discoverable without execution capabilities', async () => {
  const instance = new RemoteProviderDetector({
    probes: [
      probe('codex', "process.stdout.write('codex-cli 0.151.0')", {
        isSupportedVersion: isRemoteCodexExecutionVersion,
      }),
      probe('claude-code', "process.stdout.write('2.1.251 (Claude Code)')"),
    ],
    timeoutMs: 500,
    maximumOutputBytes: 128,
    now: () => fixedNow,
  })
  try {
    const [codex] = (await instance.discover()).providers
    assert.equal(codex.availability, 'available')
    assert.equal(codex.version, '0.151.0')
    assert.equal(
      Object.values(codex.capabilities).some((enabled) => enabled),
      false,
    )
  } finally {
    await instance.close()
  }
})

test('missing, unsupported, malformed, and nonzero probes fail safely', async () => {
  const missing = new RemoteProviderDetector({
    probes: [
      {
        ...probe('codex', ''),
        executable: `codetether-missing-${Date.now()}`,
        arguments: ['--version'],
      },
      probe('claude-code', "process.stdout.write('9.9.9 (Claude Code)')"),
    ],
    timeoutMs: 500,
    maximumOutputBytes: 128,
  })
  try {
    const result = await missing.discover()
    assert.equal(result.providers[0].availability, 'not_installed')
    assert.equal(result.providers[1].availability, 'unsupported_version')
    assert.equal(result.providers[1].version, '9.9.9')
  } finally {
    await missing.close()
  }

  for (const script of [
    "process.stdout.write('not a version')",
    "process.stderr.write('private diagnostic with /secret/path'); process.exit(7)",
    'process.stdout.write(Buffer.from([0xff]))',
  ]) {
    const broken = detector(
      script,
      "process.stdout.write('2.1.251 (Claude Code)')",
    )
    try {
      const result = await broken.discover()
      assert.equal(result.providers[0].availability, 'misconfigured')
      assert.equal(result.providers[0].version, undefined)
      assert.equal(JSON.stringify(result).includes('private diagnostic'), false)
      assert.equal(JSON.stringify(result).includes('/secret/path'), false)
    } finally {
      await broken.close()
    }
  }
})

test('timeouts and oversized stdout or stderr terminate boundedly', async () => {
  const cases = [
    'setInterval(() => {}, 1000)',
    "process.stdout.write('x'.repeat(256)); setInterval(() => {}, 1000)",
    "process.stderr.write('x'.repeat(256)); setInterval(() => {}, 1000)",
  ]
  for (const script of cases) {
    const instance = detector(
      script,
      "process.stdout.write('2.1.251 (Claude Code)')",
      { timeoutMs: 100 },
    )
    try {
      const startedAt = performance.now()
      const result = await instance.discover()
      assert.equal(result.providers[0].availability, 'unavailable')
      assert.ok(performance.now() - startedAt < 2_000)
    } finally {
      await instance.close()
    }
  }
})

test('probe environment is allowlisted and repeated refresh starts fresh probes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-detect-'))
  const counter = join(directory, 'counter')
  const counterScript = `
    const fs = require('node:fs');
    const path = ${JSON.stringify(counter)};
    let count = 0;
    try { count = Number(fs.readFileSync(path, 'utf8')); } catch {}
    fs.writeFileSync(path, String(count + 1));
    if (process.env.CODETETHER_SECRET_FOR_TEST) process.exit(9);
    process.stdout.write('codex-cli 0.149.1');
  `
  const instance = detector(
    counterScript,
    "process.stdout.write('2.1.251 (Claude Code)')",
    {
      environment: {
        ...process.env,
        CODETETHER_SECRET_FOR_TEST: 'must-not-cross',
      },
    },
  )
  try {
    assert.equal(
      (await instance.discover()).providers[0].availability,
      'available',
    )
    assert.equal(
      (await instance.discover()).providers[0].availability,
      'available',
    )
    assert.equal(await readFile(counter, 'utf8'), '2')
  } finally {
    await instance.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('closing detection terminates its exact hanging children', async () => {
  const instance = detector(
    'setInterval(() => {}, 1000)',
    'setInterval(() => {}, 1000)',
    { timeoutMs: 5_000 },
  )
  const discovery = instance.discover()
  await new Promise((resolve) => setTimeout(resolve, 30))
  const startedAt = performance.now()
  await instance.close()
  assert.ok(performance.now() - startedAt < 2_000)
  const result = await discovery
  assert.equal(
    result.providers.every(
      ({ availability }) => availability === 'misconfigured',
    ),
    true,
  )
})

test('closing detection aborts and awaits an in-flight Claude auth gate', async () => {
  let observedSignal
  const instance = detector(
    "process.stdout.write('codex-cli 0.149.1')",
    "process.stdout.write('2.1.251 (Claude Code)')",
    {
      platform: 'linux',
      claudeExecutionProbe: async (signal) => {
        observedSignal = signal
        return await new Promise((resolvePromise) => {
          signal.addEventListener(
            'abort',
            () => resolvePromise({ available: false }),
            { once: true },
          )
        })
      },
    },
  )
  const discovery = instance.discover()
  const deadline = Date.now() + 2_000
  while (observedSignal === undefined && Date.now() < deadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
  }
  assert.ok(observedSignal)

  await instance.close()
  assert.equal(observedSignal.aborted, true)
  const result = await discovery
  const claude = result.providers.find(
    ({ provider }) => provider === 'claude-code',
  )
  assert.equal(
    Object.values(claude.capabilities).some((enabled) => enabled),
    false,
  )
})

test('Claude probe cleanup failure remains fatal through detector close', async () => {
  const cleanupFailure = new ClaudeCodeOwnedProcessCleanupError()
  const instance = detector(
    "process.stdout.write('codex-cli 0.149.1')",
    "process.stdout.write('2.1.251 (Claude Code)')",
    {
      platform: 'linux',
      claudeExecutionProbe: async () => {
        throw cleanupFailure
      },
    },
  )

  await assert.rejects(instance.discover(), (error) => error === cleanupFailure)
  await assert.rejects(instance.discover(), (error) => error === cleanupFailure)
  await assert.rejects(instance.close(), (error) => error === cleanupFailure)
  await assert.rejects(instance.close(), (error) => error === cleanupFailure)
})
