import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'

import { observeClaudeCodeInstallation } from '../dist/index.js'

const executable = join(tmpdir(), 'codetether-claude-lifecycle-fixture')
const installation = {
  launcherPath: executable,
  launcher: {
    kind: 'native',
    launcherPath: executable,
    executable,
    prefixArguments: [],
    sourcePath: executable,
  },
  fileIdentity: 'fixture-claude-lifecycle-installation',
  launcherKind: 'native',
  installMethod: 'unknown',
}
const settingsPath = join(
  tmpdir(),
  'codetether-missing-claude-lifecycle-settings.json',
)
const requiredHelp = `Options:
  --print                              Print response and exit
  --input-format <format>              Choices: "text", "stream-json"
  --output-format <format>             Choices: "text", "json", "stream-json"
  --verbose                            Enable verbose output
  --include-partial-messages           Include partial messages
  --resume [value]                     Resume a conversation
  --session-id <uuid>                  Use a session ID
  --restricted                         Enable restricted mode
  --strict-mcp-config                  Ignore other MCP configurations
  --tools <tools...>                   Specify tools: Read, Glob, Grep
  --allowedTools, --allowed-tools <tools...>
                                       Specify allowed tools
  --permission-mode <mode>             Choices: "acceptEdits", "dontAsk"
  --effort <level>                     Choices: "low", "medium", "high", "xhigh", "max"
  --no-chrome                          Disable browser integration
  --disable-slash-commands             Disable slash commands`

test('older and newer unknown Claude versions stay execution-compatible by capability', async () => {
  for (const version of ['1.0.0', '99.0.0']) {
    const observation = await observeClaudeCodeInstallation({
      installation,
      environment: { HOME: tmpdir(), PATH: process.env.PATH },
      settingsPath,
      probeVersion: async () => `${version} (Claude Code)`,
      probeHelp: async () => requiredHelp,
      fingerprint: async () => version.padEnd(64, 'a').slice(0, 64),
    })

    assert.equal(observation.version, version)
    assert.equal(observation.compatibility.state, 'limited')
    assert.equal(observation.compatibility.runtimeReadiness, 'limited')
    assert.equal(
      observation.compatibility.capabilities.execution.effective,
      true,
    )
    assert.equal(
      observation.compatibility.capabilities.toolEvents.effective,
      true,
    )
    assert.equal(
      observation.compatibility.capabilities.nativeSessionDiscovery.effective,
      false,
    )
  }
})

test('verified Claude versions revalidate the exact CLI contract without inference', async () => {
  let helpProbes = 0
  const observation = await observeClaudeCodeInstallation({
    installation,
    environment: { HOME: tmpdir(), PATH: process.env.PATH },
    settingsPath,
    probeVersion: async () => '2.1.263 (Claude Code)',
    probeHelp: async () => {
      helpProbes += 1
      return requiredHelp
    },
    fingerprint: async () => 'e'.repeat(64),
  })

  assert.equal(observation.compatibility.state, 'verified')
  assert.equal(observation.compatibility.runtimeReadiness, 'ready')
  assert.equal(helpProbes, 1)
})

test('malformed versions and missing mandatory help contracts are incompatible', async () => {
  const common = {
    installation,
    environment: { HOME: tmpdir(), PATH: process.env.PATH },
    settingsPath,
  }
  const malformed = await observeClaudeCodeInstallation({
    ...common,
    probeVersion: async () => 'Claude Code release 2.1.263',
    probeHelp: async () => '',
    fingerprint: async () => 'f'.repeat(64),
  })
  const missingContract = await observeClaudeCodeInstallation({
    ...common,
    probeVersion: async () => '99.0.0 (Claude Code)',
    probeHelp: async () => requiredHelp.replace('--session-id', ''),
    fingerprint: async () => '1'.repeat(64),
  })

  assert.equal(malformed.version, undefined)
  assert.equal(malformed.compatibility.state, 'incompatible')
  assert.equal(malformed.compatibility.failureCode, 'provider_protocol_error')
  assert.equal(missingContract.compatibility.state, 'incompatible')
  assert.equal(
    missingContract.compatibility.capabilities.nativeResume.effective,
    false,
  )
})

test('Claude version probes time out through bounded owned-child cleanup', async () => {
  const observation = await observeClaudeCodeInstallation({
    installation: {
      ...installation,
      launcher: {
        kind: 'native',
        launcherPath: process.execPath,
        executable: process.execPath,
        prefixArguments: [
          '--eval',
          'setInterval(() => undefined, 60_000)',
          '--',
        ],
        sourcePath: process.execPath,
      },
    },
    environment: { HOME: tmpdir(), PATH: process.env.PATH },
    settingsPath,
    timeoutMs: 100,
    fingerprint: async () => '2'.repeat(64),
  })

  assert.equal(observation.compatibility.state, 'unavailable')
  assert.equal(observation.compatibility.failureCode, 'provider_probe_failed')
})
