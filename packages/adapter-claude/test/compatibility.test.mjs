import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'

import {
  CLAUDE_CODE_RUNTIME_CLI_CONTRACT,
  ClaudeCodeOwnedProcessCleanupError,
  observeClaudeCodeBackendConfiguration,
  observeClaudeCodeInstallation,
} from '../dist/index.js'

const executable = join(tmpdir(), 'codetether-claude-compatibility-fixture')
const installation = {
  launcherPath: executable,
  launcher: {
    kind: 'native',
    launcherPath: executable,
    executable,
    prefixArguments: [],
    sourcePath: executable,
  },
  fileIdentity: 'fixture-claude-installation',
  launcherKind: 'native',
  installMethod: 'manual',
}
const requiredHelp = `Options:
  --print                              Print response and exit
  --input-format <format>              Input format choices: "text", "stream-json"
  --output-format <format>             Output format choices: "text", "json", "stream-json"
  --verbose                            Enable verbose stream events
  --include-partial-messages           Include partial stream-json messages
  --resume [value]                     Resume a conversation by session ID
  --session-id <uuid>                  Use a specific session ID
  --restricted                         Enable restricted mode
  --strict-mcp-config                  Ignore other MCP configurations
  --tools <tools...>                   Specify tools such as Read, Glob, Grep
  --allowedTools, --allowed-tools <tools...>
                                       Specify allowed tools
  --permission-mode <mode>             Choices: "acceptEdits", "dontAsk"
  --effort <level>                     Choices: "low", "medium", "high", "xhigh", "max"
  --no-chrome                          Disable browser integration
  --disable-slash-commands             Disable slash commands`

const latestHelp = requiredHelp.replace(
  'Specify tools such as Read, Glob, Grep',
  'Specify tool names (e.g. "Bash,Edit,Read")',
)

test('admits the latest REAL-validated profile despite its abbreviated tool help example', async () => {
  const observation = await observeClaudeCodeInstallation({
    installation,
    environment: { HOME: tmpdir(), PATH: process.env.PATH },
    settingsPath: join(tmpdir(), 'codetether-missing-claude-settings.json'),
    probeVersion: async () => '2.1.268 (Claude Code)',
    probeHelp: async () => latestHelp,
    fingerprint: async () => '2'.repeat(64),
  })

  assert.equal(observation.compatibility.state, 'verified')
  assert.equal(observation.compatibility.runtimeReadiness, 'ready')
  for (const capability of Object.values(
    observation.compatibility.capabilities,
  )) {
    assert.equal(capability.observed, 'supported')
    assert.equal(capability.effective, true)
  }
})

test('unknown Claude versions probe execution without inference and limit unsupported store discovery', async () => {
  let authProbes = 0
  const observation = await observeClaudeCodeInstallation({
    installation,
    environment: {
      HOME: tmpdir(),
      PATH: process.env.PATH,
      ANTHROPIC_BASE_URL: 'https://gateway.example.test/v1',
      ANTHROPIC_AUTH_TOKEN: 'fixture-secret-never-returned',
    },
    settingsPath: join(tmpdir(), 'codetether-missing-claude-settings.json'),
    checkFirstPartyAuth: true,
    probeVersion: async () => '9.9.9 (Claude Code)',
    probeHelp: async () => requiredHelp,
    probeAuthStatus: async () => {
      authProbes += 1
      return false
    },
    fingerprint: async () => 'a'.repeat(64),
  })

  assert.equal(observation.compatibility.state, 'limited')
  assert.equal(observation.compatibility.runtimeReadiness, 'limited')
  assert.deepEqual(observation.compatibility.capabilities.execution, {
    observed: 'supported',
    enabled: true,
    effective: true,
  })
  assert.deepEqual(
    observation.compatibility.capabilities.nativeSessionDiscovery,
    { observed: 'unsupported', enabled: true, effective: false },
  )
  assert.deepEqual(observation.compatibility.capabilities.fileRead, {
    observed: 'supported',
    enabled: true,
    effective: true,
  })
  assert.deepEqual(observation.compatibility.capabilities.search, {
    observed: 'supported',
    enabled: true,
    effective: true,
  })
  assert.deepEqual(observation.compatibility.capabilities.toolEvents, {
    observed: 'supported',
    enabled: true,
    effective: true,
  })
  assert.equal(observation.backend.mode, 'custom_gateway')
  assert.equal(observation.backend.readiness, 'unknown')
  assert.equal(observation.backend.hasAuthToken, true)
  assert.equal(authProbes, 0, 'custom gateways never require first-party auth')
  assert.equal(JSON.stringify(observation).includes('fixture-secret'), false)
})

test('unavailable Claude observation preserves CodeTether capability policy separately', async () => {
  const observation = await observeClaudeCodeInstallation({
    installation,
    environment: { HOME: tmpdir(), PATH: process.env.PATH },
    settingsPath: join(tmpdir(), 'codetether-missing-claude-settings.json'),
    probeVersion: async () => {
      throw new Error('bounded fixture failure')
    },
    fingerprint: async () => 'd'.repeat(64),
  })

  assert.equal(observation.compatibility.state, 'unavailable')
  assert.equal(observation.privateRevision, 'd'.repeat(64))
  for (const capability of Object.values(
    observation.compatibility.capabilities,
  )) {
    assert.equal(capability.observed, 'unavailable')
    assert.equal(capability.enabled, true)
    assert.equal(capability.effective, false)
  }
})

test('backend revisions describe safe configuration shape and never credential values', () => {
  const first = observeClaudeCodeBackendConfiguration({
    sourceEnvironment: {
      ANTHROPIC_BASE_URL:
        'https://user:password@gateway.example.test/private?token=one',
      ANTHROPIC_AUTH_TOKEN: 'first-secret-value',
    },
    effectiveEnvironment: {
      ANTHROPIC_BASE_URL: 'https://gateway.example.test/v1?token=one',
      ANTHROPIC_AUTH_TOKEN: 'first-secret-value',
    },
  })
  const second = observeClaudeCodeBackendConfiguration({
    sourceEnvironment: {
      ANTHROPIC_BASE_URL:
        'https://gateway.example.test/another-private-path?token=two',
      ANTHROPIC_AUTH_TOKEN: 'second-secret-value',
    },
    effectiveEnvironment: {
      ANTHROPIC_BASE_URL:
        'https://gateway.example.test/another-private-path?token=two',
      ANTHROPIC_AUTH_TOKEN: 'second-secret-value',
    },
  })

  assert.equal(
    first.privateConfigurationRevision,
    second.privateConfigurationRevision,
  )
  assert.equal(second.sanitizedOrigin, 'gateway.example.test')
  assert.equal(JSON.stringify(second).includes('second-secret-value'), false)
  assert.equal(JSON.stringify(second).includes('another-private-path'), false)
  assert.equal(JSON.stringify(second).includes('token=two'), false)
})

test('malformed version output continues bounded contract probing without guessing a version', async () => {
  let helpProbes = 0
  const observation = await observeClaudeCodeInstallation({
    installation,
    environment: { HOME: tmpdir(), PATH: process.env.PATH },
    settingsPath: join(tmpdir(), 'codetether-missing-claude-settings.json'),
    probeVersion: async () => 'Claude changed its version prose',
    probeHelp: async () => {
      helpProbes += 1
      return requiredHelp
    },
    fingerprint: async () => 'e'.repeat(64),
  })

  assert.equal(helpProbes, 1)
  assert.equal(observation.version, undefined)
  assert.equal(observation.compatibility.state, 'limited')
  assert.equal(observation.compatibility.capabilities.execution.effective, true)
  assert.equal(
    observation.compatibility.capabilities.nativeSessionDiscovery.effective,
    false,
  )
})

test('missing optional effort support limits only reasoning control', async () => {
  const observation = await observeClaudeCodeInstallation({
    installation,
    environment: { HOME: tmpdir(), PATH: process.env.PATH },
    settingsPath: join(tmpdir(), 'codetether-missing-claude-settings.json'),
    probeVersion: async () => '9.9.9 (Claude Code)',
    probeHelp: async () => requiredHelp.replace('--effort', ''),
    fingerprint: async () => 'f'.repeat(64),
  })

  assert.equal(observation.compatibility.state, 'limited')
  assert.equal(observation.compatibility.runtimeReadiness, 'limited')
  assert.equal(observation.compatibility.capabilities.execution.effective, true)
  assert.equal(observation.compatibility.capabilities.streaming.effective, true)
  assert.equal(
    observation.compatibility.capabilities.reasoningControl.effective,
    false,
  )
})

test('every frozen effort value is required before reasoning control is effective', async () => {
  for (const level of CLAUDE_CODE_RUNTIME_CLI_CONTRACT.effortLevels) {
    const observation = await observeClaudeCodeInstallation({
      installation,
      environment: { HOME: tmpdir(), PATH: process.env.PATH },
      settingsPath: join(tmpdir(), 'codetether-missing-claude-settings.json'),
      probeVersion: async () => '2.1.263 (Claude Code)',
      probeHelp: async () =>
        requiredHelp.replace(`"${level}"`, '"removed-effort-level"'),
      fingerprint: async () => '8'.repeat(64),
    })

    assert.equal(observation.compatibility.state, 'limited')
    assert.equal(
      observation.compatibility.capabilities.execution.effective,
      true,
    )
    assert.equal(
      observation.compatibility.capabilities.reasoningControl.effective,
      false,
      `${level} must be checked`,
    )
  }
})

test('observes first-party, Bedrock, Vertex, mixed-source, and conflicting backend modes without values', () => {
  const firstParty = observeClaudeCodeBackendConfiguration({
    sourceEnvironment: {},
    effectiveEnvironment: {},
  })
  assert.equal(firstParty.mode, 'first_party')
  assert.equal(firstParty.configurationValid, true)

  const bedrock = observeClaudeCodeBackendConfiguration({
    sourceEnvironment: { CLAUDE_CODE_USE_BEDROCK: 'true' },
    effectiveEnvironment: { CLAUDE_CODE_USE_BEDROCK: 'true' },
  })
  assert.equal(bedrock.mode, 'bedrock')
  assert.equal(bedrock.source, 'process_environment')
  assert.equal(bedrock.bedrockConfigured, true)

  const vertex = observeClaudeCodeBackendConfiguration({
    sourceEnvironment: {},
    effectiveEnvironment: { CLAUDE_CODE_USE_VERTEX: '1' },
  })
  assert.equal(vertex.mode, 'vertex')
  assert.equal(vertex.source, 'provider_settings')
  assert.equal(vertex.vertexConfigured, true)

  const mixed = observeClaudeCodeBackendConfiguration({
    sourceEnvironment: { ANTHROPIC_AUTH_TOKEN: 'process-secret' },
    effectiveEnvironment: {
      ANTHROPIC_AUTH_TOKEN: 'process-secret',
      ANTHROPIC_API_KEY: 'settings-secret',
    },
  })
  assert.equal(mixed.mode, 'first_party')
  assert.equal(mixed.source, 'mixed')
  assert.equal(JSON.stringify(mixed).includes('process-secret'), false)
  assert.equal(JSON.stringify(mixed).includes('settings-secret'), false)

  const conflict = observeClaudeCodeBackendConfiguration({
    sourceEnvironment: {},
    effectiveEnvironment: {
      ANTHROPIC_BASE_URL: 'https://gateway.example.test/v1',
      CLAUDE_CODE_USE_BEDROCK: 'true',
    },
  })
  assert.equal(conflict.mode, 'unknown')
  assert.equal(conflict.configurationValid, false)
})

test('first-party auth observation is readiness only and does not alter runtime compatibility', async () => {
  for (const [loggedIn, expected] of [
    [false, 'authentication_required'],
    [true, 'ready'],
  ]) {
    const observation = await observeClaudeCodeInstallation({
      installation,
      environment: { HOME: tmpdir(), PATH: process.env.PATH },
      settingsPath: join(tmpdir(), 'codetether-missing-claude-settings.json'),
      checkFirstPartyAuth: true,
      probeVersion: async () => '2.1.263 (Claude Code)',
      probeHelp: async () => requiredHelp,
      probeAuthStatus: async () => loggedIn,
      fingerprint: async () => '1'.repeat(64),
    })
    assert.equal(observation.compatibility.state, 'verified')
    assert.equal(observation.backend.mode, 'first_party')
    assert.equal(observation.backend.readiness, expected)
  }
})

test('version and help probes preserve unverified owned-process cleanup', async () => {
  for (const failingProbe of ['version', 'help']) {
    const cleanupFailure = new ClaudeCodeOwnedProcessCleanupError()
    await assert.rejects(
      observeClaudeCodeInstallation({
        installation,
        environment: { HOME: tmpdir(), PATH: process.env.PATH },
        settingsPath: join(tmpdir(), 'codetether-missing-claude-settings.json'),
        probeVersion: async () => {
          if (failingProbe === 'version') throw cleanupFailure
          return '2.1.263 (Claude Code)'
        },
        probeHelp: async () => {
          if (failingProbe === 'help') throw cleanupFailure
          return requiredHelp
        },
        fingerprint: async () => 'a'.repeat(64),
      }),
      (error) => error === cleanupFailure,
      `${failingProbe} cleanup failure must not become an unavailable observation`,
    )
  }
})

test('first-party auth probe preserves unverified owned-process cleanup', async () => {
  const cleanupFailure = new ClaudeCodeOwnedProcessCleanupError()
  await assert.rejects(
    observeClaudeCodeInstallation({
      installation,
      environment: { HOME: tmpdir(), PATH: process.env.PATH },
      settingsPath: join(tmpdir(), 'codetether-missing-claude-settings.json'),
      checkFirstPartyAuth: true,
      probeVersion: async () => '2.1.263 (Claude Code)',
      probeHelp: async () => requiredHelp,
      probeAuthStatus: async () => {
        throw cleanupFailure
      },
      fingerprint: async () => 'b'.repeat(64),
    }),
    (error) => error === cleanupFailure,
  )
})

test('reachable backend readiness cannot make an incompatible runtime executable', async () => {
  let authProbes = 0
  const observation = await observeClaudeCodeInstallation({
    installation,
    environment: { HOME: tmpdir(), PATH: process.env.PATH },
    settingsPath: join(tmpdir(), 'codetether-missing-claude-settings.json'),
    checkFirstPartyAuth: true,
    probeVersion: async () => '99.0.0 (Claude Code)',
    probeHelp: async () => requiredHelp.replace('--output-format', ''),
    probeAuthStatus: async () => {
      authProbes += 1
      return true
    },
    fingerprint: async () => '2'.repeat(64),
  })

  assert.equal(authProbes, 1)
  assert.equal(observation.backend.readiness, 'ready')
  assert.equal(observation.compatibility.state, 'incompatible')
  assert.equal(observation.compatibility.runtimeReadiness, 'blocked')
  assert.equal(
    observation.compatibility.capabilities.execution.effective,
    false,
  )
})

test('every exact required production flag is contract authority for unknown revisions', async () => {
  for (const flag of [
    ...CLAUDE_CODE_RUNTIME_CLI_CONTRACT.executionFlags,
    ...CLAUDE_CODE_RUNTIME_CLI_CONTRACT.streamingFlags,
  ]) {
    const observation = await observeClaudeCodeInstallation({
      installation,
      environment: { HOME: tmpdir(), PATH: process.env.PATH },
      settingsPath: join(tmpdir(), 'codetether-missing-claude-settings.json'),
      probeVersion: async () => '9.9.9 (Claude Code)',
      probeHelp: async () => requiredHelp.replace(flag, '--removed-contract'),
      fingerprint: async () => flag.padEnd(64, '0').slice(0, 64),
    })

    assert.equal(
      observation.compatibility.state,
      'incompatible',
      `${flag} must be checked`,
    )
    assert.equal(
      observation.compatibility.capabilities.execution.effective,
      false,
    )
    assert.equal(
      observation.compatibility.capabilities.streaming.effective,
      false,
    )
  }
})

test('a required flag mentioned only in help prose is not treated as a declaration', async () => {
  const observation = await observeClaudeCodeInstallation({
    installation,
    environment: { HOME: tmpdir(), PATH: process.env.PATH },
    settingsPath: join(tmpdir(), 'codetether-missing-claude-settings.json'),
    probeVersion: async () => '9.9.9 (Claude Code)',
    probeHelp: async () =>
      requiredHelp
        .replace('--strict-mcp-config', '--removed-mcp-contract')
        .replace(
          'Enable restricted mode',
          `Enable restricted mode
                                       --strict-mcp-config is referenced here`,
        ),
    fingerprint: async () => '7'.repeat(64),
  })

  assert.equal(observation.compatibility.state, 'incompatible')
})

test('exact production values are validated within their owning option blocks', async () => {
  for (const help of [
    requiredHelp.replace(
      'Input format choices: "text", "stream-json"',
      'Input format choices: "text"',
    ),
    requiredHelp.replace(
      'Output format choices: "text", "json", "stream-json"',
      'Output format choices: "text", "json"',
    ),
    requiredHelp.replace('"acceptEdits", "dontAsk"', '"acceptEdits"'),
  ]) {
    const observation = await observeClaudeCodeInstallation({
      installation,
      environment: { HOME: tmpdir(), PATH: process.env.PATH },
      settingsPath: join(tmpdir(), 'codetether-missing-claude-settings.json'),
      probeVersion: async () => '9.9.9 (Claude Code)',
      probeHelp: async () => help,
      fingerprint: async () => '3'.repeat(64),
    })
    assert.equal(observation.compatibility.state, 'incompatible')
  }
})

test('native-resume-only loss keeps fresh execution and streaming available', async () => {
  const observation = await observeClaudeCodeInstallation({
    installation,
    environment: { HOME: tmpdir(), PATH: process.env.PATH },
    settingsPath: join(tmpdir(), 'codetether-missing-claude-settings.json'),
    probeVersion: async () => '2.1.263 (Claude Code)',
    probeHelp: async () => requiredHelp.replace('--resume', '--removed-resume'),
    fingerprint: async () => '4'.repeat(64),
  })

  assert.equal(observation.compatibility.state, 'limited')
  assert.equal(observation.compatibility.capabilities.execution.effective, true)
  assert.equal(observation.compatibility.capabilities.streaming.effective, true)
  assert.equal(
    observation.compatibility.capabilities.nativeResume.effective,
    false,
  )
  assert.equal(
    observation.compatibility.capabilities.reasoningControl.effective,
    true,
  )
  assert.equal(
    observation.compatibility.capabilities.nativeSessionDiscovery.effective,
    true,
  )
})

test('unknown-version loss of a frozen Read/Search contract is incompatible', async () => {
  const searchDeclaredHelp = requiredHelp
  const withoutRead = await observeClaudeCodeInstallation({
    installation,
    environment: { HOME: tmpdir(), PATH: process.env.PATH },
    settingsPath: join(tmpdir(), 'codetether-missing-claude-settings.json'),
    probeVersion: async () => '9.9.9 (Claude Code)',
    probeHelp: async () => searchDeclaredHelp.replace('Read, ', ''),
    fingerprint: async () => '9'.repeat(64),
  })

  assert.equal(withoutRead.compatibility.state, 'incompatible')
  assert.equal(withoutRead.compatibility.runtimeReadiness, 'blocked')
  assert.equal(
    withoutRead.compatibility.capabilities.execution.effective,
    false,
  )
  assert.equal(withoutRead.compatibility.capabilities.fileRead.effective, false)
  assert.equal(withoutRead.compatibility.capabilities.search.effective, false)
  assert.equal(
    withoutRead.compatibility.capabilities.toolEvents.effective,
    false,
  )
})

test('opaque wrappers cannot claim native-session store affinity', async () => {
  const observation = await observeClaudeCodeInstallation({
    installation: { ...installation, launcherKind: 'wrapper' },
    environment: { HOME: tmpdir(), PATH: process.env.PATH },
    settingsPath: join(tmpdir(), 'codetether-missing-claude-settings.json'),
    probeVersion: async () => '2.1.263 (Claude Code)',
    probeHelp: async () => requiredHelp,
    fingerprint: async () => 'b'.repeat(64),
  })

  assert.equal(observation.compatibility.state, 'limited')
  assert.equal(observation.compatibility.capabilities.execution.effective, true)
  assert.equal(
    observation.compatibility.capabilities.nativeSessionDiscovery.effective,
    false,
  )
})

test('same-version replacement is re-probed instead of inheriting verified status', async () => {
  let helpProbes = 0
  const observe = async (revision, help) =>
    await observeClaudeCodeInstallation({
      installation,
      environment: { HOME: tmpdir(), PATH: process.env.PATH },
      settingsPath: join(tmpdir(), 'codetether-missing-claude-settings.json'),
      probeVersion: async () => '2.1.263 (Claude Code)',
      probeHelp: async () => {
        helpProbes += 1
        return help
      },
      fingerprint: async () => revision,
    })

  const original = await observe('5'.repeat(64), requiredHelp)
  const replacement = await observe(
    '6'.repeat(64),
    requiredHelp.replace('--strict-mcp-config', '--removed-mcp-contract'),
  )

  assert.equal(original.compatibility.state, 'verified')
  assert.equal(replacement.compatibility.state, 'incompatible')
  assert.notEqual(original.privateRevision, replacement.privateRevision)
  assert.equal(helpProbes, 2)
})
