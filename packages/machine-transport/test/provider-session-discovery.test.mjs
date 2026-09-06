import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AuthenticatedRemoteMachineConnection,
  MachineWireMessageSchema,
  PrivateProviderSessionCandidateSchema,
  ProviderSessionsDiscoveredMessageSchema,
  ProviderSessionValidatedMessageSchema,
  encodeMachineFrame,
  machineTransportLimits,
} from '../dist/index.js'

const machine = {
  machineId: 'machine_sessions01',
  nodeId: 'node_sessions01',
  displayName: 'Session discovery fixture',
  platform: 'Linux',
  architecture: 'x64',
}
const projectId = 'proj_sessions01'
const rootPath = '/srv/codetether-session-project'

function privateCandidate(provider, suffix = 'a') {
  return {
    nativeSessionId: `${provider}-private-native-${suffix}`,
    revision: `revision_${suffix}`,
    title: `${provider} previous conversation ${suffix}`,
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

test('Provider session Machine messages are narrow, bounded, and private', () => {
  const request = {
    type: 'provider_sessions.discover',
    protocolVersion: 1,
    requestId: 'D'.repeat(43),
    expectedMachineId: machine.machineId,
    expectedNodeId: machine.nodeId,
    provider: 'codex',
    projectId,
    rootPath,
    limit: machineTransportLimits.providerSessionDiscoveryPageSize,
  }
  assert.equal(MachineWireMessageSchema.safeParse(request).success, true)
  assert.equal(
    MachineWireMessageSchema.safeParse({
      ...request,
      directory: '/arbitrary/provider/store',
    }).success,
    false,
  )
  assert.equal(
    MachineWireMessageSchema.safeParse({
      ...request,
      limit: machineTransportLimits.providerSessionDiscoveryPageSize + 1,
    }).success,
    false,
  )
  assert.equal(
    MachineWireMessageSchema.safeParse({
      ...request,
      cursor: 'x'.repeat(
        machineTransportLimits.maximumProviderSessionDiscoveryCursorBytes + 1,
      ),
    }).success,
    false,
  )

  const candidate = privateCandidate('codex')
  assert.equal(
    PrivateProviderSessionCandidateSchema.safeParse(candidate).success,
    true,
  )
  for (const unsafeCandidate of [
    { ...candidate, nativeSessionId: `${candidate.nativeSessionId}\0tail` },
    {
      ...candidate,
      nativeSessionId: 'n'.repeat(
        machineTransportLimits.maximumRemoteCodexProviderIdentityBytes + 1,
      ),
    },
    { ...candidate, workingDirectory: rootPath },
    { ...candidate, transcript: 'Provider history must not cross this API' },
  ]) {
    assert.equal(
      PrivateProviderSessionCandidateSchema.safeParse(unsafeCandidate).success,
      false,
    )
  }

  const response = {
    type: 'provider_sessions.discovered',
    protocolVersion: 1,
    requestId: request.requestId,
    machineId: machine.machineId,
    nodeId: machine.nodeId,
    provider: 'codex',
    status: 'supported',
    resumeStatus: 'supported',
    providerVersion: '0.149.1',
    candidates: [candidate],
    metrics: metrics(),
  }
  assert.equal(
    ProviderSessionsDiscoveredMessageSchema.safeParse(response).success,
    true,
  )
  assert.ok(encodeMachineFrame(response).length > 4)
  assert.equal(
    ProviderSessionsDiscoveredMessageSchema.safeParse({
      ...response,
      candidates: Array.from(
        {
          length: machineTransportLimits.providerSessionDiscoveryPageSize + 1,
        },
        (_, index) => privateCandidate('codex', String(index)),
      ),
    }).success,
    false,
  )
  assert.equal(
    ProviderSessionsDiscoveredMessageSchema.safeParse({
      ...response,
      status: 'unavailable',
      candidates: [],
      failureReason: 'provider_session_format_unsupported',
      metrics: metrics({
        candidatesMatched: 0,
        corruptEntriesSkipped: 1,
      }),
    }).success,
    true,
  )
  assert.equal(
    ProviderSessionsDiscoveredMessageSchema.safeParse({
      ...response,
      status: 'unavailable',
      candidates: [],
    }).success,
    false,
  )
  assert.throws(
    () =>
      encodeMachineFrame({
        ...response,
        opaque: 'x'.repeat(machineTransportLimits.maximumFrameBytes),
      }),
    /frame bound/,
  )
})

test('authenticated client discovers and revalidates both Providers exactly', async () => {
  const sent = []
  const receiveOptions = []
  const framed = {
    closed: false,
    async send(message) {
      sent.push(message)
    },
    async receive(_schema, options) {
      receiveOptions.push(options)
      const request = sent.at(-1)
      if (request.type === 'provider_sessions.discover') {
        return {
          type: 'provider_sessions.discovered',
          protocolVersion: 1,
          requestId: request.requestId,
          machineId: machine.machineId,
          nodeId: machine.nodeId,
          provider: request.provider,
          status: 'supported',
          resumeStatus: 'supported',
          providerVersion: request.provider === 'codex' ? '0.149.1' : '2.1.251',
          candidates: [privateCandidate(request.provider)],
          metrics: metrics(),
        }
      }
      const valid = request.revision === 'revision_a'
      return {
        type: 'provider_session.validated',
        protocolVersion: 1,
        requestId: request.requestId,
        machineId: machine.machineId,
        nodeId: machine.nodeId,
        provider: request.provider,
        valid,
        ...(valid ? { candidate: privateCandidate(request.provider) } : {}),
      }
    },
    end() {
      this.closed = true
    },
    destroy() {
      this.closed = true
    },
  }
  const connection = new AuthenticatedRemoteMachineConnection(
    framed,
    'controller_sessions01',
    machine,
  )

  for (const provider of ['codex', 'claude-code']) {
    const page = await connection.discoverProviderSessions({
      provider,
      projectId,
      rootPath,
      cursor: 'page_a',
      limit: 1,
    })
    assert.equal(page.provider, provider)
    assert.equal(page.candidates.length, 1)
    assert.equal(
      page.candidates[0].nativeSessionId,
      `${provider}-private-native-a`,
    )
    const request = sent.at(-1)
    assert.deepEqual(
      {
        type: request.type,
        expectedMachineId: request.expectedMachineId,
        expectedNodeId: request.expectedNodeId,
        provider: request.provider,
        projectId: request.projectId,
        rootPath: request.rootPath,
        cursor: request.cursor,
        limit: request.limit,
      },
      {
        type: 'provider_sessions.discover',
        expectedMachineId: machine.machineId,
        expectedNodeId: machine.nodeId,
        provider,
        projectId,
        rootPath,
        cursor: 'page_a',
        limit: 1,
      },
    )

    assert.deepEqual(
      await connection.validateProviderSession({
        provider,
        projectId,
        rootPath,
        nativeSessionId: page.candidates[0].nativeSessionId,
        revision: page.candidates[0].revision,
      }),
      page.candidates[0],
    )
    assert.equal(
      await connection.validateProviderSession({
        provider,
        projectId,
        rootPath,
        nativeSessionId: page.candidates[0].nativeSessionId,
        revision: 'expired_revision',
      }),
      undefined,
    )
  }
  assert.equal(
    receiveOptions.every(
      ({ timeoutMs }) =>
        timeoutMs === machineTransportLimits.providerSessionDiscoveryTimeoutMs,
    ),
    true,
  )
  connection.close()
})

test('authenticated client rejects stale Provider-session peer responses', async () => {
  let request
  const framed = {
    closed: false,
    async send(message) {
      request = message
    },
    async receive() {
      return {
        type: 'provider_session.validated',
        protocolVersion: 1,
        requestId: request.requestId,
        machineId: machine.machineId,
        nodeId: 'node_stale_session_peer',
        provider: request.provider,
        valid: true,
        candidate: privateCandidate(request.provider),
      }
    },
    end() {
      this.closed = true
    },
    destroy() {
      this.closed = true
    },
  }
  const connection = new AuthenticatedRemoteMachineConnection(
    framed,
    'controller_sessions01',
    machine,
  )
  await assert.rejects(
    connection.validateProviderSession({
      provider: 'codex',
      projectId,
      rootPath,
      nativeSessionId: 'codex-private-native-a',
      revision: 'revision_a',
    }),
    (error) =>
      error.code === 'identity_mismatch' && error.peerAuthenticated === true,
  )
  assert.equal(framed.closed, true)
})

test('validated Provider-session responses bind validity to private metadata', () => {
  const response = {
    type: 'provider_session.validated',
    protocolVersion: 1,
    requestId: 'V'.repeat(43),
    machineId: machine.machineId,
    nodeId: machine.nodeId,
    provider: 'claude-code',
    valid: true,
    candidate: privateCandidate('claude-code'),
  }
  assert.equal(
    ProviderSessionValidatedMessageSchema.safeParse(response).success,
    true,
  )
  assert.equal(
    ProviderSessionValidatedMessageSchema.safeParse({
      ...response,
      valid: false,
    }).success,
    false,
  )
  assert.equal(
    ProviderSessionValidatedMessageSchema.safeParse({
      ...response,
      candidate: undefined,
    }).success,
    false,
  )
})
