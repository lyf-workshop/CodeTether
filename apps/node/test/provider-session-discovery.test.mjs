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
import { CodexOwnedProcessCleanupError } from '@codetether/adapter-codex'

import { CodeTetherNodeService } from '../dist/node-service.js'
import { RemoteProviderSessionDiscoveryRegistry } from '../dist/provider-session-discovery.js'
import { NodeStateStore } from '../dist/state-store.js'

const projectId = 'proj_sessiondiscovery'
const providerInstallationId = 'pinst_discoveryfixture01'
const installationRevision = 'prev_discoveryfixture01'

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

test('cold exact-installation resolution receives caller cancellation before native-session scanning', async () => {
  let observedSignal
  let activeResolutions = 0
  const providerLifecycle = {
    async resolveSelected(_provider, _installationId, _revision, signal) {
      observedSignal = signal
      activeResolutions += 1
      return await new Promise((_, reject) => {
        const onAbort = () => {
          activeResolutions -= 1
          reject(signal.reason)
        }
        if (signal.aborted) onAbort()
        else signal.addEventListener('abort', onAbort, { once: true })
      })
    },
  }
  const registry = new RemoteProviderSessionDiscoveryRegistry({
    providerLifecycle,
  })
  const abort = new AbortController()
  const pending = registry.discover({
    provider: 'codex',
    providerInstallationId,
    expectedInstallationRevision: installationRevision,
    projectRoot: process.cwd(),
    limit: 1,
    signal: abort.signal,
  })
  await eventually(() => observedSignal instanceof AbortSignal)
  abort.abort(new DOMException('request closed', 'AbortError'))

  await assert.rejects(pending, (error) => error?.name === 'AbortError')
  assert.equal(observedSignal, abort.signal)
  assert.equal(activeResolutions, 0)
})

test('Node-owned metadata deadline waits adapter cleanup before returning optional unavailability', async () => {
  const aborted = deferred()
  const cleanup = deferred()
  const registry = new RemoteProviderSessionDiscoveryRegistry({
    discoveryWorkTimeoutMs: 10,
    discoveries: [
      {
        provider: 'codex',
        async discover(request) {
          return await new Promise((_, reject) => {
            const onAbort = async () => {
              aborted.resolve()
              await cleanup.promise
              const error = new Error('metadata work deadline')
              error.name = 'AbortError'
              reject(error)
            }
            if (request.signal.aborted) void onAbort()
            else
              request.signal.addEventListener('abort', onAbort, { once: true })
          })
        },
        async validateCandidate() {
          return undefined
        },
      },
    ],
  })
  const pending = registry.discover({
    provider: 'codex',
    providerInstallationId,
    expectedInstallationRevision: installationRevision,
    projectRoot: process.cwd(),
    limit: 1,
  })
  await aborted.promise
  let settled = false
  void pending.finally(() => {
    settled = true
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(settled, false)
  cleanup.resolve()
  const page = await pending
  assert.equal(page.status, 'unavailable')
  assert.equal(page.failureReason, 'provider_session_discovery_unavailable')
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
    async readSessionTranscript(request) {
      calls.transcript.push(request)
      assert.ok(request.signal instanceof AbortSignal)
      return {
        provider,
        status: 'available',
        entries: [
          {
            id: `${provider}-history-a`,
            provider,
            role: 'user',
            kind: 'message',
            content: 'same visible marker',
            nativeSequence: 0,
            readOnly: true,
          },
          {
            id: `${provider}-history-b`,
            provider,
            role: 'assistant',
            kind: 'message',
            content: 'x'.repeat(2_000),
            nativeSequence: 1,
            readOnly: true,
          },
        ],
        complete: true,
        metrics: {
          bytesRead: 2_100,
          recordsScanned: 2,
          entriesReturned: 2,
          elapsedMs: 1,
          truncated: false,
        },
      }
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
      codex: { discover: [], validate: [], transcript: [] },
      claude: { discover: [], validate: [], transcript: [] },
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
          providerInstallationId,
          expectedInstallationRevision: installationRevision,
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
          providerInstallationId,
          expectedInstallationRevision: installationRevision,
          projectId,
          rootPath: projectRoot,
          nativeSessionId: page.candidates[0].nativeSessionId,
          revision: page.candidates[0].revision,
        })
        assert.deepEqual(valid, page.candidates[0])
        assert.equal(
          await connected.validateProviderSession({
            provider,
            providerInstallationId,
            expectedInstallationRevision: installationRevision,
            projectId,
            rootPath: projectRoot,
            nativeSessionId: page.candidates[0].nativeSessionId,
            revision: 'expired_revision',
          }),
          undefined,
        )
        assert.equal(providerCalls.validate.length, 2)
        assert.equal(providerCalls.validate[0].projectRoot, projectRoot)

        const transcript = await connected.readProviderSessionTranscript({
          conversationId: 'conv_sessiondiscovery',
          projectId,
          rootPath: projectRoot,
          provider,
          providerInstallationId,
          expectedInstallationRevision: installationRevision,
          nativeSessionId: page.candidates[0].nativeSessionId,
          boundary: `${provider}-boundary`,
          adoptedAt: '2026-09-05T12:00:00.000Z',
          limit: 2,
        })
        assert.equal(transcript.entries.length, 2)
        assert.equal(transcript.entries[0].content, 'same visible marker')
        assert.equal(
          Buffer.byteLength(transcript.entries[1].content, 'utf8'),
          machineTransportLimits.maximumProviderSessionTranscriptEntryContentBytes,
        )
        assert.equal(transcript.status, 'partial')
        assert.equal(transcript.metrics.truncated, true)
        assert.equal(providerCalls.transcript.length, 1)
        assert.deepEqual(
          {
            projectRoot: providerCalls.transcript[0].projectRoot,
            nativeSessionId: providerCalls.transcript[0].nativeSessionId,
            boundary: providerCalls.transcript[0].boundary,
            adoptedAt: providerCalls.transcript[0].adoptedAt,
            limit: providerCalls.transcript[0].limit,
          },
          {
            projectRoot,
            nativeSessionId: page.candidates[0].nativeSessionId,
            boundary: `${provider}-boundary`,
            adoptedAt: '2026-09-05T12:00:00.000Z',
            limit: 2,
          },
        )
      }

      const unavailable = await connected.discoverProviderSessions({
        provider: 'codex',
        providerInstallationId,
        expectedInstallationRevision: installationRevision,
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
          providerInstallationId,
          expectedInstallationRevision: installationRevision,
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
          providerInstallationId,
          expectedInstallationRevision: installationRevision,
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
          providerInstallationId,
          expectedInstallationRevision: installationRevision,
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
        providerInstallationId,
        expectedInstallationRevision: installationRevision,
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

for (const operation of ['discover', 'validate']) {
  test(
    `Node close awaits ${operation} route cleanup and surfaces exact uncertainty`,
    { timeout: 10_000 },
    async () => {
      const directory = await mkdtemp(
        join(tmpdir(), 'codetether-node-route-cleanup-'),
      )
      const projectDirectory = join(directory, 'project')
      await mkdir(projectDirectory)
      const projectRoot = await realpath(projectDirectory)
      const localController = await controller()
      const guard = executionGuard()
      const started = deferred()
      const cleanup = deferred()
      const cleanupFailure = new CodexOwnedProcessCleanupError()
      const adapter = {
        provider: 'codex',
        async discover(request) {
          if (operation !== 'discover') {
            return {
              provider: 'codex',
              status: 'supported',
              resumeStatus: 'supported',
              candidates: [candidate('codex', request.projectRoot)],
              metrics: metrics(),
            }
          }
          return await failCleanupAfterAbort(request.signal)
        },
        async validateCandidate(request) {
          if (operation !== 'validate') return undefined
          return await failCleanupAfterAbort(request.signal)
        },
      }
      async function failCleanupAfterAbort(signal) {
        started.resolve()
        return await new Promise((_, reject) => {
          const onAbort = async () => {
            await cleanup.promise
            reject(cleanupFailure)
          }
          if (signal.aborted) void onAbort()
          else signal.addEventListener('abort', onAbort, { once: true })
        })
      }
      let running
      let connected
      try {
        running = await startNode({
          dataDirectory: join(directory, 'state'),
          providerSessionDiscoveries:
            new RemoteProviderSessionDiscoveryRegistry({
              discoveries: [adapter],
            }),
          providerDetector: guard.providerDetector,
          codexRunners: guard.codexRunners,
          claudeRunners: guard.claudeRunners,
        })
        ;({ connected } = await pairAndConnect(running, localController))
        const pending =
          operation === 'discover'
            ? connected.discoverProviderSessions({
                provider: 'codex',
                providerInstallationId,
                expectedInstallationRevision: installationRevision,
                projectId,
                rootPath: projectRoot,
                limit: 1,
              })
            : connected.validateProviderSession({
                provider: 'codex',
                providerInstallationId,
                expectedInstallationRevision: installationRevision,
                projectId,
                rootPath: projectRoot,
                nativeSessionId: candidate('codex', projectRoot)
                  .nativeSessionId,
                revision: candidate('codex', projectRoot).revision,
              })
        void pending.catch(() => undefined)
        await started.promise
        const closing = running.service.close()
        let closed = false
        void closing
          .finally(() => {
            closed = true
          })
          .catch(() => undefined)
        await new Promise((resolve) => setImmediate(resolve))
        assert.equal(closed, false)
        cleanup.resolve()
        await assert.rejects(
          closing,
          (error) =>
            error instanceof AggregateError &&
            error.errors.includes(cleanupFailure),
        )
        await assert.rejects(pending)
      } finally {
        connected?.close()
        await running?.service.close().catch(() => undefined)
        await rm(directory, { recursive: true, force: true })
      }
    },
  )
}

async function eventually(predicate, timeoutMs = 1_000) {
  const deadline = performance.now() + timeoutMs
  while (!predicate()) {
    if (performance.now() >= deadline) {
      assert.fail('Timed out waiting for bounded discovery cleanup')
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
