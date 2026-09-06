import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import test from 'node:test'

import {
  beginRemoteMachinePairing,
  connectTrustedRemoteMachine,
  generateMachineTlsIdentity,
  machineTransportLimits,
  newControllerId,
  PrivateProviderSessionCandidateSchema,
} from '@codetether/machine-transport'
import { ClaudeSessionDiscovery } from '@codetether/adapter-claude'

import { CodeTetherNodeService } from '../dist/node-service.js'
import { RemoteProviderSessionDiscoveryRegistry } from '../dist/provider-session-discovery.js'
import { NodeStateStore } from '../dist/state-store.js'

const projectId = 'proj_sessiondiscovery'

test('real Claude discovery metadata fits the private Machine wire schema', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'codetether-node-claude-wire-'),
  )
  t.after(async () => {
    await rm(directory, { recursive: true, force: true })
  })
  const configurationDirectory = join(directory, 'claude-state')
  const projectDirectory = join(directory, 'project')
  const nativeSessionId = '00000000-0000-4000-8000-000000000008'
  const sessionDirectory = join(configurationDirectory, 'projects', 'fixture')
  await Promise.all([
    mkdir(projectDirectory, { recursive: true }),
    mkdir(sessionDirectory, { recursive: true }),
  ])
  const projectRoot = await realpath(projectDirectory)
  const longAstralTitle = '🚀'.repeat(120)
  await writeFile(
    join(sessionDirectory, `${nativeSessionId}.jsonl`),
    `${JSON.stringify({
      type: 'ai-title',
      sessionId: nativeSessionId,
      cwd: projectRoot,
      timestamp: '2026-09-05T12:00:00.000Z',
      version: '2.1.251',
      aiTitle: longAstralTitle,
    })}\n`,
    { mode: 0o600 },
  )

  const discovery = new ClaudeSessionDiscovery({
    environment: { CLAUDE_CONFIG_DIR: configurationDirectory },
    providerVersion: '2.1.251',
  })
  const page = await discovery.discover({ projectRoot, limit: 1 })
  assert.equal(page.candidates.length, 1)
  const native = page.candidates[0]
  assert.equal(native.revision.length, 64)
  assert.equal(native.title, longAstralTitle)
  assert.doesNotThrow(() =>
    PrivateProviderSessionCandidateSchema.parse({
      nativeSessionId: native.nativeSessionId,
      revision: native.revision,
      title: native.title,
      createdAt: native.createdAt,
      lastActiveAt: native.lastActiveAt,
      providerVersion: native.providerVersion,
      resumeStatus: native.resumeStatus,
      historicalTranscript: native.historicalTranscript,
    }),
  )
})

test('default Claude discovery uses the Node lifecycle configuration root only', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'codetether-node-claude-config-selection-'),
  )
  t.after(async () => {
    await rm(directory, { recursive: true, force: true })
  })
  const selectedConfiguration = join(directory, 'selected-claude-state')
  const decoyConfiguration = join(directory, 'decoy-claude-state')
  const selectedBucket = join(selectedConfiguration, 'projects', 'fixture')
  const decoyBucket = join(decoyConfiguration, 'projects', 'fixture')
  const projectDirectory = join(directory, 'project')
  await Promise.all([
    mkdir(selectedBucket, { recursive: true }),
    mkdir(decoyBucket, { recursive: true }),
    mkdir(projectDirectory),
  ])
  const projectRoot = await realpath(projectDirectory)
  const selectedId = '10000000-0000-4000-8000-000000000001'
  const decoyId = '20000000-0000-4000-8000-000000000002'
  const record = (sessionId, title) =>
    `${JSON.stringify({
      type: 'ai-title',
      sessionId,
      cwd: projectRoot,
      timestamp: '2026-09-06T12:00:00.000Z',
      version: '2.1.263',
      aiTitle: title,
    })}\n`
  const selectedFile = join(selectedBucket, `${selectedId}.jsonl`)
  const decoyFile = join(decoyBucket, `${decoyId}.jsonl`)
  await Promise.all([
    writeFile(
      selectedFile,
      record(selectedId, 'Selected installation history'),
    ),
    writeFile(decoyFile, record(decoyId, 'Decoy installation history')),
  ])
  const before = await Promise.all([
    readFile(selectedFile),
    readFile(decoyFile),
  ])
  const registry = new RemoteProviderSessionDiscoveryRegistry({
    environment: {
      ...process.env,
      CLAUDE_CONFIG_DIR: selectedConfiguration,
    },
  })

  const page = await registry.discover({
    provider: 'claude-code',
    projectRoot,
    limit: 10,
  })
  assert.equal(page.status, 'supported')
  assert.equal(page.candidates.length, 1)
  assert.equal(page.candidates[0].nativeSessionId, selectedId)
  const validated = await registry.validateCandidate({
    provider: 'claude-code',
    projectRoot,
    nativeSessionId: selectedId,
    revision: page.candidates[0].revision,
  })
  assert.equal(validated?.nativeSessionId, selectedId)
  assert.equal(validated?.workingDirectory, page.candidates[0].workingDirectory)
  assert.deepEqual(
    await Promise.all([readFile(selectedFile), readFile(decoyFile)]),
    before,
  )
})

async function controller() {
  return {
    controllerId: newControllerId(),
    tls: await generateMachineTlsIdentity('CodeTether Controller'),
  }
}

function candidate(provider, projectRoot) {
  const suffix = provider === 'codex' ? 'codex' : 'claude_code'
  return {
    provider,
    nativeSessionId: `private-native-session-${suffix}`,
    revision: `revision_${suffix}`,
    workingDirectory: projectRoot,
    title:
      provider === 'codex'
        ? 'Previous Codex conversation'
        : 'Previous Claude conversation',
    createdAt: '2026-09-05T10:00:00.000Z',
    lastActiveAt: '2026-09-05T11:00:00.000Z',
    providerVersion: provider === 'codex' ? '0.149.1' : '2.1.251',
    resumeStatus: 'supported',
    historicalTranscript: 'unavailable',
  }
}

function metrics(overrides = {}) {
  return {
    filesInspected: 1,
    candidatesParsed: 1,
    candidatesMatched: 1,
    corruptEntriesSkipped: 0,
    elapsedMs: 2,
    truncated: false,
    ...overrides,
  }
}

function discoveryAdapter(provider, calls) {
  return {
    provider,
    async discover(request) {
      calls.discover.push(request)
      assert.ok(request.signal instanceof AbortSignal)
      assert.equal(request.signal.aborted, false)
      if (request.cursor === 'format_unavailable') {
        return {
          provider,
          status: 'unavailable',
          resumeStatus: 'unavailable',
          candidates: [],
          failureReason: 'provider_session_format_unsupported',
          metrics: metrics({
            candidatesParsed: 0,
            candidatesMatched: 0,
            corruptEntriesSkipped: 1,
          }),
        }
      }
      return {
        provider,
        status: 'supported',
        resumeStatus: 'supported',
        providerVersion: provider === 'codex' ? '0.149.1' : '2.1.251',
        candidates: [candidate(provider, request.projectRoot)],
        metrics: metrics(),
      }
    },
    async validateCandidate(request) {
      calls.validate.push(request)
      assert.ok(request.signal instanceof AbortSignal)
      assert.equal(request.signal.aborted, false)
      const expected = candidate(provider, request.projectRoot)
      return request.nativeSessionId === expected.nativeSessionId &&
        request.revision === expected.revision
        ? expected
        : undefined
    },
  }
}

function executionGuard() {
  const counts = {
    detectorDiscoveries: 0,
    codexOpens: 0,
    claudeOpens: 0,
  }
  return {
    counts,
    providerDetector: {
      async discover() {
        counts.detectorDiscoveries += 1
        throw new Error('Provider installation discovery was not expected')
      },
      async close() {},
    },
    codexRunners: {
      async open() {
        counts.codexOpens += 1
        throw new Error('Codex execution was not expected')
      },
      async close() {},
    },
    claudeRunners: {
      async open() {
        counts.claudeOpens += 1
        throw new Error('Claude execution was not expected')
      },
      async close() {},
    },
  }
}

async function startNode(options) {
  const state = await NodeStateStore.open({
    dataDirectory: options.dataDirectory,
    displayName: 'Provider Session Discovery Node',
    platform: 'Linux',
    architecture: 'x64',
  })
  const service = new CodeTetherNodeService({
    state,
    bindAddress: '127.0.0.1',
    port: 0,
    providerDetector: options.providerDetector,
    providerSessionDiscoveries: options.providerSessionDiscoveries,
    remoteCodexRunners: options.codexRunners,
    remoteClaudeRunners: options.claudeRunners,
  })
  const address = await service.listen()
  return {
    service,
    endpoint: { host: '127.0.0.1', port: address.port },
  }
}

async function pairAndConnect(running, localController) {
  const mode = await running.service.enablePairing()
  const pending = await beginRemoteMachinePairing({
    endpoint: running.endpoint,
    pairingCode: mode.code,
    controller: localController,
  })
  const trusted = await pending.confirm()
  return {
    trusted,
    connected: await connectTrustedRemoteMachine({
      peer: trusted,
      controller: localController,
    }),
  }
}

test(
  'authenticated Node discovery is exact, bounded, revalidated, and non-executable',
  { timeout: 15_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codetether-node-sessions-'))
    const projectDirectory = join(directory, 'project')
    await mkdir(projectDirectory)
    const projectRoot = await realpath(projectDirectory)
    const localController = await controller()
    const calls = {
      codex: { discover: [], validate: [] },
      claude: { discover: [], validate: [] },
    }
    const guard = executionGuard()
    const providerSessionDiscoveries =
      new RemoteProviderSessionDiscoveryRegistry({
        discoveries: [
          discoveryAdapter('codex', calls.codex),
          discoveryAdapter('claude-code', calls.claude),
        ],
      })
    let running
    let connected
    let wrongNodeConnection
    let wrongMachineConnection
    try {
      running = await startNode({
        dataDirectory: join(directory, 'state'),
        providerSessionDiscoveries,
        providerDetector: guard.providerDetector,
        codexRunners: guard.codexRunners,
        claudeRunners: guard.claudeRunners,
      })
      const paired = await pairAndConnect(running, localController)
      connected = paired.connected

      for (const [provider, providerCalls] of [
        ['codex', calls.codex],
        ['claude-code', calls.claude],
      ]) {
        const page = await connected.discoverProviderSessions({
          provider,
          projectId,
          rootPath: projectRoot,
          limit: machineTransportLimits.providerSessionDiscoveryPageSize,
        })
        assert.equal(page.status, 'supported')
        assert.equal(page.candidates.length, 1)
        assert.equal(
          page.candidates[0].nativeSessionId,
          candidate(provider, projectRoot).nativeSessionId,
        )
        assert.deepEqual(
          {
            projectRoot: providerCalls.discover[0].projectRoot,
            cursor: providerCalls.discover[0].cursor,
            limit: providerCalls.discover[0].limit,
          },
          {
            projectRoot,
            cursor: undefined,
            limit: machineTransportLimits.providerSessionDiscoveryPageSize,
          },
        )

        const valid = await connected.validateProviderSession({
          provider,
          projectId,
          rootPath: projectRoot,
          nativeSessionId: page.candidates[0].nativeSessionId,
          revision: page.candidates[0].revision,
        })
        assert.deepEqual(valid, page.candidates[0])
        assert.equal(
          await connected.validateProviderSession({
            provider,
            projectId,
            rootPath: projectRoot,
            nativeSessionId: page.candidates[0].nativeSessionId,
            revision: 'expired_revision',
          }),
          undefined,
        )
        assert.equal(providerCalls.validate.length, 2)
        assert.equal(providerCalls.validate[0].projectRoot, projectRoot)
      }

      const unavailable = await connected.discoverProviderSessions({
        provider: 'codex',
        projectId,
        rootPath: projectRoot,
        cursor: 'format_unavailable',
        limit: 1,
      })
      assert.deepEqual(
        {
          status: unavailable.status,
          candidates: unavailable.candidates.length,
          failureReason: unavailable.failureReason,
          corruptEntriesSkipped: unavailable.metrics.corruptEntriesSkipped,
        },
        {
          status: 'unavailable',
          candidates: 0,
          failureReason: 'provider_session_format_unsupported',
          corruptEntriesSkipped: 1,
        },
      )
      assert.deepEqual(guard.counts, {
        detectorDiscoveries: 0,
        codexOpens: 0,
        claudeOpens: 0,
      })

      wrongNodeConnection = await connectTrustedRemoteMachine({
        peer: paired.trusted,
        controller: localController,
      })
      wrongMachineConnection = await connectTrustedRemoteMachine({
        peer: paired.trusted,
        controller: localController,
      })
      const callsBeforeIdentityFailures = calls.codex.discover.length
      wrongNodeConnection.machine.nodeId = 'node_wrong_session_identity'
      await assert.rejects(
        wrongNodeConnection.discoverProviderSessions({
          provider: 'codex',
          projectId,
          rootPath: projectRoot,
          limit: 1,
        }),
        (error) =>
          error.code === 'identity_mismatch' &&
          error.peerAuthenticated === true,
      )
      wrongMachineConnection.machine.machineId =
        'machine_wrong_session_identity'
      await assert.rejects(
        wrongMachineConnection.discoverProviderSessions({
          provider: 'codex',
          projectId,
          rootPath: projectRoot,
          limit: 1,
        }),
        (error) =>
          error.code === 'identity_mismatch' &&
          error.peerAuthenticated === true,
      )
      assert.equal(calls.codex.discover.length, callsBeforeIdentityFailures)

      const callsBeforeAlias = calls.codex.discover.length
      await assert.rejects(
        connected.discoverProviderSessions({
          provider: 'codex',
          projectId,
          rootPath: `${projectRoot}${sep}.`,
          limit: 1,
        }),
        (error) =>
          error.code === 'project_location_path_invalid' &&
          error.peerAuthenticated === true,
      )
      assert.equal(calls.codex.discover.length, callsBeforeAlias)
      assert.deepEqual(guard.counts, {
        detectorDiscoveries: 0,
        codexOpens: 0,
        claudeOpens: 0,
      })
    } finally {
      connected?.close()
      wrongNodeConnection?.close()
      wrongMachineConnection?.close()
      await running?.service.close().catch(() => undefined)
      await rm(directory, { recursive: true, force: true })
    }
  },
)

test(
  'trusted socket teardown cancels the exact in-flight discovery request',
  { timeout: 10_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codetether-node-sessions-'))
    const projectDirectory = join(directory, 'project')
    await mkdir(projectDirectory)
    const projectRoot = await realpath(projectDirectory)
    const localController = await controller()
    const guard = executionGuard()
    let startedResolve
    const started = new Promise((resolve) => {
      startedResolve = resolve
    })
    let activeRequests = 0
    let abortedRequests = 0
    const hangingDiscovery = {
      provider: 'codex',
      async discover(request) {
        assert.ok(request.signal instanceof AbortSignal)
        activeRequests += 1
        startedResolve()
        return await new Promise((resolve, reject) => {
          const abort = () => {
            request.signal.removeEventListener('abort', abort)
            activeRequests -= 1
            abortedRequests += 1
            const error = new Error('Provider session discovery cancelled')
            error.name = 'AbortError'
            reject(error)
          }
          if (request.signal.aborted) abort()
          else request.signal.addEventListener('abort', abort, { once: true })
        })
      },
      async validateCandidate() {
        throw new Error('Candidate validation was not expected')
      },
    }
    let running
    let connected
    try {
      running = await startNode({
        dataDirectory: join(directory, 'state'),
        providerSessionDiscoveries: new RemoteProviderSessionDiscoveryRegistry({
          discoveries: [hangingDiscovery],
        }),
        providerDetector: guard.providerDetector,
        codexRunners: guard.codexRunners,
        claudeRunners: guard.claudeRunners,
      })
      ;({ connected } = await pairAndConnect(running, localController))
      const pending = connected.discoverProviderSessions({
        provider: 'codex',
        projectId,
        rootPath: projectRoot,
        limit: 1,
      })
      const rejected = assert.rejects(
        pending,
        (error) => error.code === 'connection_failed',
      )
      await started
      connected.close()
      await rejected
      await eventually(() => activeRequests === 0 && abortedRequests === 1)
      assert.deepEqual(guard.counts, {
        detectorDiscoveries: 0,
        codexOpens: 0,
        claudeOpens: 0,
      })
    } finally {
      connected?.close()
      await running?.service.close().catch(() => undefined)
      await rm(directory, { recursive: true, force: true })
    }
  },
)

async function eventually(predicate, timeoutMs = 1_000) {
  const deadline = performance.now() + timeoutMs
  while (!predicate()) {
    if (performance.now() >= deadline) {
      assert.fail('Timed out waiting for bounded discovery cleanup')
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
