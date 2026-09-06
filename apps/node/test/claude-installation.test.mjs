import assert from 'node:assert/strict'
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { ClaudeCodeNotInstalledError } from '@codetether/adapter-claude'

import { NodeClaudeInstallation } from '../dist/claude-installation.js'
import { RemoteProviderDetector } from '../dist/provider-discovery.js'
import { RemoteClaudeRunnerPool } from '../dist/remote-claude-runner.js'

const fakeClaude = fileURLToPath(
  new URL(
    '../../../packages/adapter-claude/test/fixtures/fake-claude.mjs',
    import.meta.url,
  ),
)

function launcher(prefixArguments = [fakeClaude]) {
  return {
    kind: 'native',
    executable: process.execPath,
    prefixArguments,
    sourcePath: fakeClaude,
  }
}

function deferred() {
  let resolve
  const promise = new Promise((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

test('Node Claude launcher resolution coalesces and returns immutable copies', async () => {
  const gate = deferred()
  let resolutions = 0
  const installation = new NodeClaudeInstallation({
    resolveLauncher: async () => {
      resolutions += 1
      await gate.promise
      return launcher()
    },
  })

  const pending = Array.from(
    { length: 100 },
    async () => await installation.launcher(),
  )
  await new Promise((resolveWait) => setImmediate(resolveWait))
  assert.equal(resolutions, 1)
  gate.resolve()

  const selected = await Promise.all(pending)
  assert.equal(resolutions, 1)
  assert.equal(
    selected.every(({ sourcePath }) => sourcePath === fakeClaude),
    true,
  )
  selected[0].prefixArguments.push('mutated-copy')
  assert.deepEqual((await installation.launcher()).prefixArguments, [
    fakeClaude,
  ])
})

test('failed resolution remains refreshable but never falls through inside prepare', async () => {
  let resolutions = 0
  const installation = new NodeClaudeInstallation({
    resolveLauncher: async () => {
      resolutions += 1
      if (resolutions === 1) throw new ClaudeCodeNotInstalledError()
      return launcher()
    },
  })

  await assert.rejects(installation.prepare(), ClaudeCodeNotInstalledError)
  assert.equal(resolutions, 1)
  assert.equal((await installation.launcher()).sourcePath, fakeClaude)
  assert.equal(resolutions, 2)
  assert.equal((await installation.launcher()).sourcePath, fakeClaude)
  assert.equal(resolutions, 2)
})

test('preparation refreshes health while retaining one selected launcher', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-claude-binding-'))
  t.after(async () => {
    await rm(directory, { recursive: true, force: true })
  })
  const counter = join(directory, 'invocations.txt')
  const fixture = join(directory, 'claude-fixture.mjs')
  const configurationDirectory = join(directory, 'claude-config')
  await mkdir(configurationDirectory)
  await writeFile(
    fixture,
    [
      "import { appendFileSync } from 'node:fs'",
      `const counter = ${JSON.stringify(counter)}`,
      "if (process.argv.includes('--version')) {",
      "  appendFileSync(counter, 'version\\n')",
      "  process.stdout.write('2.1.263 (Claude Code)\\n')",
      "} else if (process.argv[2] === 'auth') {",
      "  appendFileSync(counter, 'auth\\n')",
      '  process.stdout.write(\'{"loggedIn":true}\\n\')',
      '} else process.exitCode = 2',
    ].join('\n'),
  )
  let resolutions = 0
  const environment = {
    ...process.env,
    HOME: directory,
    USERPROFILE: directory,
    CLAUDE_CONFIG_DIR: configurationDirectory,
  }
  const installation = new NodeClaudeInstallation({
    environment,
    resolveLauncher: async () => {
      resolutions += 1
      return launcher([fixture])
    },
  })

  const first = await installation.prepare()
  const second = await installation.prepare()
  assert.equal(first.detection.status, 'available')
  assert.equal(second.detection.status, 'available')
  assert.equal(first.detection.version, '2.1.263')
  assert.equal(second.detection.version, '2.1.263')
  assert.equal(resolutions, 1)
  assert.deepEqual((await readFile(counter, 'utf8')).trim().split('\n'), [
    'version',
    'auth',
    'version',
    'auth',
  ])
})

test('bounded Provider refresh can recover before an installation is selected', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-claude-refresh-'))
  t.after(async () => {
    await rm(directory, { recursive: true, force: true })
  })
  const configurationDirectory = join(directory, 'claude-config')
  await mkdir(configurationDirectory)
  const environment = {
    ...process.env,
    HOME: directory,
    USERPROFILE: directory,
    CLAUDE_CONFIG_DIR: configurationDirectory,
  }
  let resolutions = 0
  const installation = new NodeClaudeInstallation({
    environment,
    resolveLauncher: async () => {
      resolutions += 1
      if (resolutions === 1) throw new ClaudeCodeNotInstalledError()
      return launcher()
    },
  })
  const detector = new RemoteProviderDetector({
    environment,
    platform: 'linux',
    claudeInstallation: installation,
    claudeExecutionProbe: async () => {
      const preparation = await installation.prepare()
      return preparation.detection.status === 'available'
        ? { available: true, version: preparation.detection.version }
        : { available: false, failureReason: preparation.failureReason }
    },
  })
  try {
    const first = (await detector.discover()).providers.find(
      ({ provider }) => provider === 'claude-code',
    )
    assert.equal(first.availability, 'not_installed')
    const recovered = (await detector.discover()).providers.find(
      ({ provider }) => provider === 'claude-code',
    )
    assert.equal(recovered.availability, 'available')
    assert.equal(recovered.version, '2.1.251')
    assert.equal(resolutions, 2)
  } finally {
    await detector.close()
  }
})

test('remote observation and runtime preparation share one selected installation', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-claude-shared-'))
  t.after(async () => {
    await rm(directory, { recursive: true, force: true })
  })
  const projectDirectory = join(directory, 'project')
  const configurationDirectory = join(directory, 'claude-config')
  await Promise.all([mkdir(projectDirectory), mkdir(configurationDirectory)])
  const projectRoot = await realpath(projectDirectory)
  let resolutions = 0
  const environment = {
    ...process.env,
    HOME: directory,
    USERPROFILE: directory,
    CLAUDE_CONFIG_DIR: configurationDirectory,
  }
  const installation = new NodeClaudeInstallation({
    environment,
    resolveLauncher: async () => {
      resolutions += 1
      return resolutions === 1
        ? launcher([fakeClaude, '--fixture-version=2.1.263'])
        : launcher(['-e', "throw new Error('Claude B must not run')"])
    },
  })
  const detector = new RemoteProviderDetector({
    environment,
    platform: 'linux',
    claudeInstallation: installation,
    claudeExecutionProbe: async () => {
      const preparation = await installation.prepare()
      return preparation.detection.status === 'available'
        ? {
            available: true,
            version: preparation.detection.version,
          }
        : { available: false, failureReason: preparation.failureReason }
    },
  })
  const runners = new RemoteClaudeRunnerPool({
    claudeInstallation: installation,
    platform: 'linux',
  })
  try {
    const discovery = await detector.discover()
    const claude = discovery.providers.find(
      ({ provider }) => provider === 'claude-code',
    )
    assert.equal(claude.version, '2.1.263')
    assert.equal(claude.availability, 'available')
    assert.equal(claude.executionFailureReason, undefined)
    assert.deepEqual(
      Object.entries(claude.capabilities)
        .filter(([, enabled]) => enabled)
        .map(([name]) => name)
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
    assert.equal('launcher' in claude, false)
    assert.equal('executablePath' in claude, false)

    if (process.platform !== 'win32') {
      const runner = await runners.open({
        type: 'claude.session.open',
        protocolVersion: 1,
        requestId: 'R'.repeat(43),
        expectedMachineId: 'machine_claude_selection',
        expectedNodeId: 'node_claude_selection',
        conversationId: 'conv_claude_selection',
        projectId: 'proj_claude_selection',
        rootPath: projectRoot,
        effort: 'high',
      })
      assert.equal(runner.canonicalRoot, projectRoot)
      assert.equal(runner.resumed, false)
      assert.equal(resolutions, 1)
      const providerSessionId = runner.providerSessionId
      await runners.release(runner)

      const resumed = await runners.open({
        type: 'claude.session.open',
        protocolVersion: 1,
        requestId: 'S'.repeat(43),
        expectedMachineId: 'machine_claude_selection',
        expectedNodeId: 'node_claude_selection',
        conversationId: 'conv_claude_selection',
        projectId: 'proj_claude_selection',
        rootPath: projectRoot,
        providerSessionId,
        providerSessionMaterialized: true,
        effort: 'high',
      })
      assert.equal(resumed.resumed, true)
      await runners.release(resumed)
    }
  } finally {
    await runners.close()
    await detector.close()
  }
  assert.equal(resolutions, 1)
})
