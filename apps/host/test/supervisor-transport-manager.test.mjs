import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import test from 'node:test'

import { MachineProviderLifecycleSchema } from '@codetether/protocol'
import {
  RelayService,
  RelayStateStore,
  generateRelayPinnedTlsIdentity,
} from '@codetether/relay'

import {
  canonicalJsonBytes,
  supervisorDescriptorProofType,
  supervisorGrantDigest,
  supervisorGrantProofType,
} from '@codetether/supervisor-transport'

import {
  SupervisorTransportManager,
  discoverSupervisorDirectHosts,
} from '../dist/api/supervisor-transport-manager.js'
import { isLoopbackSupervisorHost } from '@codetether/supervisor-transport'
import { LocalHttpServer } from '../dist/api/local-http-server.js'
import { executeSupervisorB1Operation } from '../dist/api/supervisor-operations.js'
import { HostService } from '../dist/api/host-service.js'
import { HostEventPublisher } from '../dist/api/host-event-publisher.js'
import { WorkspacePolicy } from '../dist/api/workspace-policy.js'
import { ConversationStore } from '../dist/persistence/index.js'

const hostId = `host_${'h'.repeat(32)}`
const deviceId = `dev_${'d'.repeat(32)}`
const authorizationId = `hauth_${'a'.repeat(32)}`

test('direct endpoint discovery is bounded and uses concrete IPv4 addresses', () => {
  assert.deepEqual(
    discoverSupervisorDirectHosts({
      Ethernet: [
        {
          address: '192.168.1.20',
          netmask: '255.255.255.0',
          family: 'IPv4',
          mac: '00:00:00:00:00:01',
          internal: false,
          cidr: '192.168.1.20/24',
        },
        {
          address: 'fe80::1',
          netmask: 'ffff:ffff:ffff:ffff::',
          family: 'IPv6',
          mac: '00:00:00:00:00:01',
          internal: false,
          cidr: 'fe80::1/64',
          scopeid: 4,
        },
      ],
      Loopback: [
        {
          address: '127.0.0.1',
          netmask: '255.0.0.0',
          family: 'IPv4',
          mac: '00:00:00:00:00:00',
          internal: true,
          cidr: '127.0.0.1/8',
        },
      ],
      Duplicate: [
        {
          address: '192.168.1.20',
          netmask: '255.255.255.0',
          family: 'IPv4',
          mac: '00:00:00:00:00:02',
          internal: false,
          cidr: '192.168.1.20/24',
        },
      ],
    }),
    ['192.168.1.20'],
  )
})

test('loopback-only Supervisor listeners publish no Direct endpoint', () => {
  assert.deepEqual(
    discoverSupervisorDirectHosts({
      Loopback: [
        {
          address: '127.0.0.1',
          netmask: '255.0.0.0',
          family: 'IPv4',
          mac: '00:00:00:00:00:00',
          internal: true,
          cidr: '127.0.0.1/8',
        },
      ],
    }),
    [],
  )
})

test('Host-owned recovery replaces Direct endpoints after repeated network changes', async () => {
  const ipv4 = (address) => ({
    address,
    netmask: '255.255.255.0',
    family: 'IPv4',
    mac: '00:00:00:00:00:01',
    internal: false,
    cidr: `${address}/24`,
  })
  let interfaces = { Ethernet: [ipv4('192.0.2.7')] }
  let discoveries = 0
  const manager = await SupervisorTransportManager.create({
    service: { getHostIdentity: () => undefined },
    persistence: { getHostPresenceConfiguration: () => undefined },
    port: 0,
    bindHost: '127.0.0.1',
    clientBuildIdentity: 'test-host',
    discoverNetworkInterfaces: () => {
      discoveries++
      return interfaces
    },
  })
  try {
    const port = manager.presence().directEndpoints[0].port
    assert.deepEqual(manager.presence().directEndpoints, [
      { host: '192.0.2.7', port },
    ])
    interfaces = {}
    manager.requestTransportRecovery()
    assert.deepEqual(manager.presence().directEndpoints, [])
    interfaces = { Ethernet: [ipv4('192.0.2.8'), ipv4('192.0.2.8')] }
    manager.requestTransportRecovery()
    manager.requestTransportRecovery()
    assert.deepEqual(manager.presence().directEndpoints, [
      { host: '192.0.2.8', port },
    ])
    assert.equal(discoveries, 4)
  } finally {
    await manager.close()
  }
  manager.requestTransportRecovery()
  assert.equal(discoveries, 4)
})

test('an initial interface enumeration error leaves Host alive for later recovery', async () => {
  let available = false
  const manager = await SupervisorTransportManager.create({
    service: { getHostIdentity: () => undefined },
    persistence: { getHostPresenceConfiguration: () => undefined },
    port: 0,
    bindHost: '127.0.0.1',
    clientBuildIdentity: 'test-host',
    discoverNetworkInterfaces: () => {
      if (!available) throw new Error('synthetic network failure')
      return {
        Ethernet: [
          {
            address: '192.0.2.10',
            netmask: '255.255.255.0',
            family: 'IPv4',
            mac: '00:00:00:00:00:01',
            internal: false,
            cidr: '192.0.2.10/24',
          },
        ],
      }
    },
  })
  try {
    assert.deepEqual(manager.presence().directEndpoints, [])
    available = true
    manager.requestTransportRecovery()
    assert.equal(manager.presence().directEndpoints[0].host, '192.0.2.10')
  } finally {
    await manager.close()
  }
})

test('remote Supervisor loopback endpoints are recognized before Relay fallback', () => {
  assert.equal(isLoopbackSupervisorHost('127.0.0.1'), true)
  assert.equal(isLoopbackSupervisorHost('127.42.9.7'), true)
  assert.equal(isLoopbackSupervisorHost('localhost.'), true)
  assert.equal(isLoopbackSupervisorHost('::1'), true)
  assert.equal(isLoopbackSupervisorHost('192.168.1.20'), false)
})

test('forced-remote manager reads Host state without using local HTTP product data', async () => {
  const observedAt = '2026-11-06T00:00:00.000Z'
  const providerLifecycles = ['codex', 'claude-code'].map((provider) =>
    MachineProviderLifecycleSchema.parse({
      provider,
      installations: Array.from({ length: 8 }, (_, index) => ({
        installationId: `pinst_supervisor_regression_${index}`,
        provider,
        selected: false,
        version: '版'.repeat(120),
        launcherKind: 'native',
        installMethod: 'manual',
        availability: 'available',
        revision: `prev_supervisor_regression_${index}`,
        firstObservedAt: observedAt,
        lastObservedAt: observedAt,
        backend: {
          mode: 'custom_gateway',
          readiness: 'ready',
          freshness: 'current',
          configuration: {
            source: 'unknown',
            hasBaseUrl: true,
            hasApiKey: false,
            hasAuthToken: false,
            hasOAuthToken: false,
            bedrockConfigured: false,
            vertexConfigured: false,
          },
          sanitizedOrigin: `https://${'gateway.'.repeat(25)}example.test`,
          observedAt,
        },
      })),
    }),
  )
  assert.ok(Buffer.byteLength(JSON.stringify(providerLifecycles)) > 16 * 1024)
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  })
  const publicJwk = publicKey.export({ format: 'jwk' })
  const hostFingerprint = `sha256:${'H'.repeat(43)}`
  const identity = {
    hostId,
    publicJwk: JSON.stringify({
      crv: publicJwk.crv,
      kty: publicJwk.kty,
      x: publicJwk.x,
      y: publicJwk.y,
    }),
    fingerprint: hostFingerprint,
    identityGeneration: 1,
  }
  const reads = {
    machines: 0,
    detail: 0,
    projects: 0,
    project: 0,
    conversations: 0,
    conversation: 0,
    search: 0,
    history: 0,
    live: 0,
  }
  const service = {
    getHostIdentity: () => identity,
    listMachines: () => {
      reads.machines += 1
      return {
        protocolVersion: 1,
        machines: [{ machineId: `machine_${'m'.repeat(32)}` }],
      }
    },
    getMachine: async () => {
      reads.detail += 1
      return {
        protocolVersion: 1,
        machine: { machineId: `machine_${'m'.repeat(32)}` },
        providers: [{ provider: 'codex', availability: 'available' }],
        providerLifecycles,
        projects: [{ path: 'must-not-cross-remote-boundary' }],
        conversations: [{ title: 'must-not-cross-remote-boundary' }],
      }
    },
    listSupervisorProjects: (_machineId, page) => {
      reads.projects += 1
      assert.deepEqual(page, { limit: 25 })
      return {
        protocolVersion: 1,
        projects: [{ projectId: `proj_${'p'.repeat(32)}` }],
        hasMore: false,
      }
    },
    getSupervisorProject: () => {
      reads.project += 1
      return {
        protocolVersion: 1,
        project: { projectId: `proj_${'p'.repeat(32)}` },
      }
    },
    listSupervisorConversations: (_machineId, _projectId, page) => {
      reads.conversations += 1
      assert.deepEqual(page, { limit: 25, archived: 'active' })
      return {
        protocolVersion: 1,
        conversations: [{ conversationId: `conv_${'c'.repeat(32)}` }],
        hasMore: false,
      }
    },
    getSupervisorConversation: () => {
      reads.conversation += 1
      return {
        protocolVersion: 1,
        conversation: { conversationId: `conv_${'c'.repeat(32)}` },
      }
    },
    searchProjectConversations: async () => {
      reads.search += 1
      return { protocolVersion: 1, results: [], hasMore: false }
    },
    readSupervisorConversationHistory: (
      _machineId,
      _projectId,
      _conversationId,
      page,
    ) => {
      reads.history += 1
      assert.deepEqual(page, { limit: 20 })
      return {
        marker: 'direct-history',
        historyComplete: true,
        liveCursor: '123e4567-e89b-42d3-a456-426614174000:0',
      }
    },
    readSupervisorConversationLive: (
      _machineId,
      _projectId,
      _conversationId,
      query,
    ) => {
      reads.live += 1
      assert.deepEqual(query, {
        cursor: '123e4567-e89b-42d3-a456-426614174000:0',
        limit: 64,
        waitMs: 0,
      })
      return { marker: 'direct-live', events: [], active: false }
    },
  }
  let storedGrant
  const persistence = {
    getHostPresenceConfiguration: () => undefined,
    enableHostSupervisorGrant() {},
    pruneHostSupervisorGrants() {},
    storeHostSupervisorGrant(grant) {
      storedGrant = grant
      return grant
    },
  }
  const manager = await SupervisorTransportManager.create({
    service,
    persistence,
    bindHost: '127.0.0.1',
    advertiseHost: '127.0.0.1',
    allowLoopbackForTests: true,
    port: 0,
    clientBuildIdentity: 'test-host',
  })
  const originalFetch = globalThis.fetch
  try {
    const now = Math.floor(Date.now() / 1_000)
    const grantPayload = {
      v: 1,
      aud: 'codetether-host-supervisor',
      purpose: 'host_supervisor_grant',
      authorizationId,
      hostId,
      hostFingerprint,
      hostIdentityGeneration: 1,
      deviceId,
      deviceFingerprint: `sha256:${'D'.repeat(43)}`,
      deviceKeyGeneration: 1,
      userId: `usr_${'u'.repeat(32)}`,
      spaceId: `space_${'s'.repeat(32)}`,
      scope: 'supervisor_read',
      authorizationSerial: '1',
      authorizationGeneration: 1,
      issuedAt: now,
      expiresAt: now + 3_600,
    }
    const grant = {
      payload: grantPayload,
      proof: compactSign(privateKey, supervisorGrantProofType, grantPayload),
    }
    const presence = manager.presence()
    const descriptorPayload = {
      v: 1,
      aud: 'codetether-host-supervisor',
      purpose: 'host_supervisor_transport',
      authorizationId,
      grantDigest: supervisorGrantDigest(grant),
      hostId,
      hostFingerprint,
      hostIdentityGeneration: 1,
      deviceId,
      deviceKeyGeneration: 1,
      transportTlsFingerprint: presence.transportTlsFingerprint,
      controlPlaneOrigin: 'https://control-plane.example.test',
      directEndpoints: presence.directEndpoints,
      relay: null,
      iat: now,
      exp: now + 600,
      protocolVersion: 1,
    }
    const descriptor = {
      payload: descriptorPayload,
      proof: compactSign(
        privateKey,
        supervisorDescriptorProofType,
        descriptorPayload,
      ),
    }
    await manager.activate({ hostPublicJwk: publicJwk, grant, descriptor })
    assert.deepEqual(storedGrant, grant)
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          admitted: true,
          hostId,
          hostIdentityGeneration: 1,
          deviceId,
          deviceKeyGeneration: 1,
          authorizationId,
          scope: 'supervisor_read',
          authorizationExpiresAt: new Date((now + 3_600) * 1_000).toISOString(),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    const pending = await manager.beginRemote({
      hostId,
      hostFingerprint,
      hostIdentityGeneration: 1,
      hostPublicJwk: publicJwk,
      deviceId,
      deviceKeyGeneration: 1,
      grant,
      descriptor,
    })
    const authenticated = await manager.authenticateRemote(
      pending.connectionId,
      { accessToken: 'access-token', deviceProof: 'device-proof' },
    )
    const bootstrap = await manager.readRemote(
      authenticated.sessionId,
      'host.bootstrap',
    )
    assert.equal(bootstrap.identity.hostId, hostId)
    await manager.readRemote(authenticated.sessionId, 'machine.list')
    const detail = await manager.readRemote(
      authenticated.sessionId,
      'machine.get',
      `machine_${'m'.repeat(32)}`,
    )
    assert.equal(reads.machines, 1)
    assert.equal(reads.detail, 1)
    assert.deepEqual(detail.providers, [
      { provider: 'codex', availability: 'available' },
    ])
    assert.equal('providerLifecycles' in detail, false)
    assert.equal('projects' in detail, false)
    assert.equal('conversations' in detail, false)
    const machineId = `machine_${'m'.repeat(32)}`
    const projectId = `proj_${'p'.repeat(32)}`
    const conversationId = `conv_${'c'.repeat(32)}`
    assert.equal(
      (
        await manager.listRemoteProjects(authenticated.sessionId, machineId, {
          limit: 25,
        })
      ).projects[0].projectId,
      projectId,
    )
    assert.equal(
      (
        await manager.getRemoteProject(
          authenticated.sessionId,
          machineId,
          projectId,
        )
      ).project.projectId,
      projectId,
    )
    assert.equal(
      (
        await manager.listRemoteConversations(
          authenticated.sessionId,
          machineId,
          projectId,
          { limit: 25 },
        )
      ).conversations[0].conversationId,
      conversationId,
    )
    assert.equal(
      (
        await manager.getRemoteConversation(
          authenticated.sessionId,
          machineId,
          projectId,
          conversationId,
        )
      ).conversation.conversationId,
      conversationId,
    )
    assert.deepEqual(
      await manager.executeRemoteB1Operation(authenticated.sessionId, {
        operation: 'conversation.search',
        projectId,
        query: '搜索词',
        archive: 'active',
        limit: 25,
      }),
      { protocolVersion: 1, results: [], hasMore: false },
    )
    const deniedActionId = 'act_supervisor_read_only_0001'
    for (const request of [
      {
        operation: 'project.create',
        machineId,
        actionId: deniedActionId,
        path: 'C:\\fixture',
      },
      { operation: 'project.remove', projectId, actionId: deniedActionId },
      {
        operation: 'conversation.pin',
        machineId,
        projectId,
        conversationId,
        actionId: deniedActionId,
        pinned: true,
      },
      {
        operation: 'conversation.rename',
        machineId,
        projectId,
        conversationId,
        actionId: deniedActionId,
        title: '标题',
      },
      {
        operation: 'conversation.restore',
        machineId,
        projectId,
        conversationId,
        actionId: deniedActionId,
      },
    ]) {
      await assert.rejects(
        manager.executeRemoteB1Operation(authenticated.sessionId, request),
        { code: 'operation_not_allowed' },
      )
    }
    await assert.rejects(
      manager.updateRemoteConversationModel(authenticated.sessionId, {
        machineId,
        projectId,
        conversationId,
        actionId: deniedActionId,
        model: 'gpt-5',
      }),
      { code: 'operation_not_allowed' },
    )
    await assert.rejects(
      manager.refreshRemoteConversationModels(authenticated.sessionId, {
        machineId,
        projectId,
        conversationId,
      }),
      { code: 'operation_not_allowed' },
    )
    assert.equal(
      (
        await manager.readRemoteConversationHistory(
          authenticated.sessionId,
          machineId,
          projectId,
          conversationId,
          { limit: 20 },
        )
      ).marker,
      'direct-history',
    )
    assert.equal(
      (
        await manager.readRemoteConversationLive(
          authenticated.sessionId,
          machineId,
          projectId,
          conversationId,
          {
            cursor: '123e4567-e89b-42d3-a456-426614174000:0',
            limit: 64,
            waitMs: 0,
          },
        )
      ).marker,
      'direct-live',
    )
    assert.deepEqual(reads, {
      machines: 1,
      detail: 1,
      projects: 1,
      project: 1,
      conversations: 1,
      conversation: 1,
      search: 1,
      history: 1,
      live: 1,
    })
  } finally {
    globalThis.fetch = originalFetch
    await manager.close()
  }
})

test('control activation rejects missing, mismatched, and revoked local evidence', async () => {
  const fixture = await controlActivationFixture()
  const activation = fixture.activation(authorizationId)
  try {
    await assert.rejects(fixture.manager.activate(activation))
    fixture.addEvidence(activation, authorizationId, {
      deviceFingerprint: `sha256:${'X'.repeat(43)}`,
    })
    await assert.rejects(fixture.manager.activate(activation))
    fixture.addEvidence(activation, authorizationId, {
      authorizationExpiresAt: activation.grant.payload.expiresAt + 1,
    })
    await assert.rejects(fixture.manager.activate(activation))
    fixture.addEvidence(activation, authorizationId, {
      iat: activation.grant.payload.issuedAt + 1,
    })
    await assert.rejects(fixture.manager.activate(activation))
    fixture.addEvidence(activation, authorizationId)
    fixture.revoked.add(authorizationId)
    await assert.rejects(fixture.manager.activate(activation))
    assert.deepEqual(fixture.enabled, [])
  } finally {
    await fixture.close()
  }
})

test('control activation cannot complete after a revocation during signature verification', async () => {
  const fixture = await controlActivationFixture()
  const activation = fixture.activation(authorizationId)
  fixture.addEvidence(activation, authorizationId)
  try {
    const activating = fixture.manager.activate(activation)
    fixture.revoked.add(authorizationId)
    await assert.rejects(activating)
    assert.deepEqual(fixture.enabled, [])
  } finally {
    await fixture.close()
  }
})

test('control admission rejects a pairing lineage different from local evidence', async () => {
  const fixture = await controlActivationFixture()
  const activation = fixture.activation(authorizationId)
  fixture.addEvidence(activation, authorizationId)
  try {
    await fixture.manager.activate(activation)
    fixture.setAdmissionRoot(`hauth_${'f'.repeat(32)}`)
    await assert.rejects(fixture.connect(activation), {
      code: 'authentication_failed',
    })
  } finally {
    await fixture.close()
  }
})

test('Direct control session routes B4a mutations and preserves a specific Host failure reason', async () => {
  const machineId = `machine_${'m'.repeat(32)}`
  const projectId = `proj_${'p'.repeat(32)}`
  const conversationId = `conv_${'c'.repeat(32)}`
  const calls = []
  const fixture = await controlActivationFixture({
    listMachines: () => ({ machines: [{ machineId, kind: 'local' }] }),
    createProject: async (request) => {
      calls.push(['createProject', request.actionId])
      return { data: { project: { projectId }, created: true } }
    },
    deleteProject: async (_projectId, request) => {
      calls.push(['deleteProject', request.actionId])
      if (request.actionId === 'act_supervisor_conflict_0001') {
        throw Object.assign(new Error('Project has Conversations'), {
          code: 'project_has_conversations',
        })
      }
      return { data: { projectId } }
    },
    getSupervisorConversation: () => ({ conversation: { conversationId } }),
    pinConversation: async () => ({
      data: {
        conversation: { conversationId, pinnedAt: '2026-11-09T12:00:00.000Z' },
      },
    }),
    unpinConversation: async () => ({
      data: { conversation: { conversationId } },
    }),
    renameConversation: async (_id, request) => ({
      data: { conversation: { conversationId, title: request.title } },
    }),
    unarchiveConversation: async () => ({
      data: { conversation: { conversationId } },
    }),
    updateConversationModel: async (id, request) => {
      calls.push(['updateConversationModel', request.actionId])
      return {
        data: {
          conversation: {
            conversationId: id,
            provider: 'codex',
            currentModel: request.model,
            currentReasoning: request.reasoning,
          },
        },
      }
    },
    refreshConversationModels: async (id) => {
      calls.push(['refreshConversationModels', id])
      return {
        protocolVersion: 1,
        provider: {
          provider: 'codex',
          availableModels: [{ id: 'gpt-5', name: 'GPT-5' }],
        },
      }
    },
    searchProjectConversations: async () => ({
      protocolVersion: 1,
      results: [],
      hasMore: false,
    }),
  })
  const activation = fixture.activation(authorizationId)
  fixture.addEvidence(activation, authorizationId)
  try {
    await fixture.manager.activate(activation)
    const session = await fixture.connect(activation)
    const send = (request) =>
      fixture.manager.executeRemoteB1Operation(session.sessionId, request)
    const actionId = 'act_supervisor_control_0001'
    const scope = { machineId, projectId, conversationId, actionId }
    assert.deepEqual(
      await send({
        operation: 'project.create',
        machineId,
        actionId,
        path: 'C:\\fixture',
      }),
      { project: { projectId }, created: true },
    )
    assert.deepEqual(
      await send({ operation: 'project.remove', projectId, actionId }),
      { projectId },
    )
    assert.equal(
      (await send({ operation: 'conversation.pin', ...scope, pinned: true }))
        .conversation.pinnedAt,
      '2026-11-09T12:00:00.000Z',
    )
    assert.deepEqual(
      await send({ operation: 'conversation.pin', ...scope, pinned: false }),
      { conversation: { conversationId } },
    )
    assert.deepEqual(
      await send({
        operation: 'conversation.rename',
        ...scope,
        title: '远程标题',
      }),
      { conversation: { conversationId, title: '远程标题' } },
    )
    assert.deepEqual(
      await send({ operation: 'conversation.restore', ...scope }),
      { conversation: { conversationId } },
    )
    assert.deepEqual(
      await fixture.manager.updateRemoteConversationModel(session.sessionId, {
        ...scope,
        model: 'gpt-5',
        reasoning: 'high',
      }),
      {
        conversationId,
        provider: 'codex',
        currentModel: 'gpt-5',
        currentReasoning: 'high',
      },
    )
    assert.deepEqual(
      await fixture.manager.refreshRemoteConversationModels(session.sessionId, {
        machineId,
        projectId,
        conversationId,
      }),
      {
        protocolVersion: 1,
        provider: {
          provider: 'codex',
          availableModels: [{ id: 'gpt-5', name: 'GPT-5' }],
        },
      },
    )
    assert.deepEqual(
      await send({
        operation: 'conversation.search',
        projectId,
        query: '远程',
        archive: 'active',
        limit: 25,
      }),
      { protocolVersion: 1, results: [], hasMore: false },
    )
    await assert.rejects(
      send({
        operation: 'project.remove',
        projectId,
        actionId: 'act_supervisor_conflict_0001',
      }),
      (error) =>
        error.code === 'conflict' &&
        error.reason === 'project_has_conversations',
    )
    assert.deepEqual(calls, [
      ['createProject', actionId],
      ['deleteProject', actionId],
      ['updateConversationModel', actionId],
      ['refreshConversationModels', conversationId],
      ['deleteProject', 'act_supervisor_conflict_0001'],
    ])
  } finally {
    await fixture.close()
  }
})

test('Relay control session routes every B4a operation through an isolated Relay', async () => {
  const machineId = `machine_${'m'.repeat(32)}`
  const projectId = `proj_${'p'.repeat(32)}`
  const conversationId = `conv_${'c'.repeat(32)}`
  const calls = []
  const fixture = await controlActivationFixture(
    {
      listMachines: () => ({ machines: [{ machineId, kind: 'local' }] }),
      createProject: async () => {
        calls.push('project.create')
        return { data: { project: { projectId }, created: true } }
      },
      deleteProject: async () => {
        calls.push('project.remove')
        return { data: { projectId } }
      },
      getSupervisorConversation: () => ({ conversation: { conversationId } }),
      pinConversation: async () => {
        calls.push('conversation.pin')
        return { data: { conversation: { conversationId } } }
      },
      renameConversation: async () => {
        calls.push('conversation.rename')
        return { data: { conversation: { conversationId } } }
      },
      unarchiveConversation: async () => {
        calls.push('conversation.restore')
        return { data: { conversation: { conversationId } } }
      },
      searchProjectConversations: async () => {
        calls.push('conversation.search')
        return { protocolVersion: 1, results: [], hasMore: false }
      },
    },
    { withRelay: true },
  )
  const activation = fixture.activation(authorizationId)
  fixture.addEvidence(activation, authorizationId)
  try {
    await fixture.manager.activate(activation)
    const session = await fixture.connect(activation, { forceRelay: true })
    const send = (request) =>
      fixture.manager.executeRemoteB1Operation(session.sessionId, request)
    const actionId = 'act_supervisor_relay_control_0001'
    const scope = { machineId, projectId, conversationId, actionId }
    for (const request of [
      { operation: 'project.create', machineId, actionId, path: 'C:\\fixture' },
      { operation: 'project.remove', projectId, actionId },
      { operation: 'conversation.pin', ...scope, pinned: true },
      { operation: 'conversation.rename', ...scope, title: 'Relay 标题' },
      { operation: 'conversation.restore', ...scope },
      {
        operation: 'conversation.search',
        projectId,
        query: 'Relay',
        archive: 'active',
        limit: 25,
      },
    ]) {
      const result = await send(request)
      assert.ok(result)
    }
    assert.deepEqual(calls, [
      'project.create',
      'project.remove',
      'conversation.pin',
      'conversation.rename',
      'conversation.restore',
      'conversation.search',
    ])
  } finally {
    await fixture.close()
  }
})

test('isolated HostService and SQLite preserve B4a writes across Direct, Relay, and restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-b4a-host-'))
  const workspace = join(directory, 'workspace')
  const databasePath = join(directory, 'data', 'codetether.sqlite3')
  const activePath = join(workspace, 'active-project')
  const emptyPath = join(workspace, 'empty-project')
  const latePath = join(workspace, 'late-project')
  await mkdir(activePath, { recursive: true })
  await mkdir(emptyPath, { recursive: true })
  let first
  let second
  let fixture
  try {
    first = await createDurableB4aHost(
      databasePath,
      workspace,
      '11111111-1111-4111-8111-111111111111',
    )
    fixture = await controlActivationFixture(
      {},
      {
        withRelay: true,
        serviceFactory: (identity) =>
          new Proxy(first.service, {
            get(target, property) {
              if (property === 'getHostIdentity') return () => identity
              const value = Reflect.get(target, property, target)
              return typeof value === 'function' ? value.bind(target) : value
            },
          }),
      },
    )
    const activation = fixture.activation(authorizationId)
    fixture.addEvidence(activation, authorizationId)
    await fixture.manager.activate(activation)
    const direct = await fixture.connect(activation)
    const relay = await fixture.connect(activation, { forceRelay: true })
    const send = (session, request) =>
      fixture.manager.executeRemoteB1Operation(session.sessionId, request)
    const machineId = first.service.listMachines().machines[0].machineId
    const createActive = {
      operation: 'project.create',
      machineId,
      actionId: 'act_b4a_active_create_0001',
      path: activePath,
    }
    const active = await send(direct, createActive)
    assert.equal(active.created, true)
    assert.equal(
      (await send(direct, createActive)).project.projectId,
      active.project.projectId,
    )
    const projectId = active.project.projectId
    const empty = await send(relay, {
      operation: 'project.create',
      machineId,
      actionId: 'act_b4a_empty_create_0001',
      path: emptyPath,
    })
    assert.equal(empty.created, true)
    const emptyProjectId = empty.project.projectId

    const conversationId = 'conv_b4a_isolated_0001'
    const at = '2026-11-09T12:00:00.000Z'
    const location = active.project.locations.find(
      (candidate) => candidate.machineId === machineId,
    )
    assert.ok(location)
    first.store.createConversation({
      conversationId,
      projectId,
      machineId,
      title: '初始标题',
      titleSource: 'manual',
      provider: 'codex',
      cwd: location.rootPath,
      status: 'completed',
      createdAt: at,
      updatedAt: at,
      lastActivityAt: at,
    })
    const scope = { machineId, projectId, conversationId }
    const pin = {
      operation: 'conversation.pin',
      ...scope,
      actionId: 'act_b4a_pin_0001',
      pinned: true,
    }
    const pinned = await send(direct, pin)
    assert.ok(pinned.conversation.pinnedAt)
    assert.equal(
      (await send(direct, pin)).conversation.pinnedAt,
      pinned.conversation.pinnedAt,
    )
    const rename = {
      operation: 'conversation.rename',
      ...scope,
      actionId: 'act_b4a_rename_0001',
      title: '远程整理标题',
    }
    assert.equal((await send(relay, rename)).conversation.title, rename.title)
    assert.equal((await send(relay, rename)).conversation.title, rename.title)
    await first.service.archiveConversation(conversationId, {
      actionId: 'act_b4a_archive_0001',
    })
    const restore = {
      operation: 'conversation.restore',
      ...scope,
      actionId: 'act_b4a_restore_0001',
    }
    assert.equal(
      (await send(relay, restore)).conversation.archivedAt,
      undefined,
    )
    assert.equal(
      (await send(relay, restore)).conversation.archivedAt,
      undefined,
    )
    const search = await send(relay, {
      operation: 'conversation.search',
      projectId,
      query: '整理标题',
      archive: 'active',
      limit: 25,
    })
    assert.deepEqual(
      search.results.map((result) => result.conversation.conversationId),
      [conversationId],
    )

    const failedRemove = {
      operation: 'project.remove',
      projectId,
      actionId: 'act_b4a_remove_conflict_0001',
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await assert.rejects(
        send(relay, failedRemove),
        (error) =>
          error.code === 'conflict' &&
          error.reason === 'project_has_conversations',
      )
    }
    const removeEmpty = {
      operation: 'project.remove',
      projectId: emptyProjectId,
      actionId: 'act_b4a_remove_empty_0001',
    }
    assert.equal((await send(direct, removeEmpty)).projectId, emptyProjectId)
    assert.equal((await send(direct, removeEmpty)).projectId, emptyProjectId)

    const lateCreate = {
      operation: 'project.create',
      machineId,
      actionId: 'act_b4a_late_create_0001',
      path: latePath,
    }
    const firstFailure = await send(direct, lateCreate).then(
      () => undefined,
      (error) => error,
    )
    assert.ok(firstFailure)
    await mkdir(latePath)
    await assert.rejects(send(direct, lateCreate), {
      code: firstFailure.code,
    })
    assert.equal(
      (
        await send(relay, {
          ...lateCreate,
          actionId: 'act_b4a_late_create_0002',
        })
      ).created,
      true,
    )

    // Let the Host finish its send callback before closing the Relay tunnel.
    await new Promise((resolve) => setTimeout(resolve, 50))

    await fixture.close()
    fixture = undefined
    await first.service.close()
    first.store.close()
    first = undefined
    second = await createDurableB4aHost(
      databasePath,
      workspace,
      '22222222-2222-4222-8222-222222222222',
    )
    assert.equal(
      (await executeSupervisorB1Operation(second.service, createActive))
        .created,
      false,
    )
    assert.ok(
      (await executeSupervisorB1Operation(second.service, pin)).conversation
        .pinnedAt,
    )
    assert.equal(
      (await executeSupervisorB1Operation(second.service, rename)).conversation
        .title,
      rename.title,
    )
    assert.equal(
      (await executeSupervisorB1Operation(second.service, restore)).conversation
        .archivedAt,
      undefined,
    )
    await assert.rejects(
      executeSupervisorB1Operation(second.service, removeEmpty),
      { code: 'not_found' },
    )
  } finally {
    if (fixture !== undefined) await fixture.close()
    if (first !== undefined) {
      await first.service.close().catch(() => undefined)
      first.store.close()
    }
    if (second !== undefined) {
      await second.service.close().catch(() => undefined)
      second.store.close()
    }
    const resolved = await realpath(directory)
    assert.equal(dirname(resolved), await realpath(tmpdir()))
    assert.match(basename(resolved), /^codetether-b4a-host-/u)
    await rm(resolved, { recursive: true, force: true })
  }
})

async function createDurableB4aHost(databasePath, workspace, epoch) {
  const store = ConversationStore.open({ databasePath })
  const runtime = {
    provider: 'codex',
    subscribeEvents: () => () => undefined,
    subscribeFailures: () => () => undefined,
    subscribeApprovals: () => () => undefined,
    close: async () => undefined,
  }
  const service = new HostService({
    runtime,
    workspacePolicy: await WorkspacePolicy.create([workspace]),
    publisher: new HostEventPublisher({ epoch }),
    persistence: store,
    hostVersion: '0.0.0-b4a-test',
    now: () => new Date('2026-11-09T12:00:00.000Z'),
  })
  return { service, store }
}

test('an activated renewal permanently blocks predecessor activation and admission', async () => {
  const fixture = await controlActivationFixture()
  const predecessor = fixture.activation(authorizationId)
  fixture.addEvidence(predecessor, authorizationId)
  try {
    await fixture.manager.activate(predecessor)
    fixture.durableSuccessors.add(authorizationId)
    await assert.rejects(fixture.manager.activate(predecessor), {
      code: 'operation_not_allowed',
    })
    await assert.rejects(fixture.connect(predecessor), {
      code: 'authorization_revoked',
    })
  } finally {
    await fixture.close()
  }
})

test('revoking an old control pairing disconnects its lineage and preserves a new pairing of the same device', async () => {
  const fixture = await controlActivationFixture()
  const old = fixture.activation(authorizationId)
  const renewed = fixture.activation(`hauth_${'b'.repeat(32)}`)
  const newRoot = `hauth_${'c'.repeat(32)}`
  const fresh = fixture.activation(newRoot)
  fixture.addEvidence(old, authorizationId)
  fixture.addEvidence(renewed, authorizationId, {
    previousAuthorizationId: authorizationId,
  })
  fixture.addEvidence(fresh, newRoot)
  try {
    await fixture.manager.activate(old)
    const oldSession = await fixture.connect(old)
    await fixture.manager.activate(renewed)
    await assert.rejects(
      fixture.manager.readRemote(oldSession.sessionId, 'host.bootstrap'),
    )
    const renewedSession = await fixture.connect(renewed)
    await fixture.manager.activate(fresh)
    const freshSession = await fixture.connect(fresh)
    const removal = fixture.revocation(renewed, authorizationId)
    for (let attempt = 0; attempt < 2; attempt++) {
      await fixture.manager.disableDevice(removal)
      assert.equal(
        (
          await fixture.manager.readRemote(
            freshSession.sessionId,
            'host.bootstrap',
          )
        ).identity.hostId,
        hostId,
      )
    }
    await assert.rejects(
      fixture.manager.readRemote(oldSession.sessionId, 'host.bootstrap'),
    )
    await assert.rejects(
      fixture.manager.readRemote(renewedSession.sessionId, 'host.bootstrap'),
    )
    assert.deepEqual(fixture.revocations, [authorizationId, authorizationId])
  } finally {
    await fixture.close()
  }
})

async function controlActivationFixture(
  serviceOverrides = {},
  { withRelay = false, serviceFactory } = {},
) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  })
  const hostPublicJwk = publicKey.export({ format: 'jwk' })
  const hostFingerprint = `sha256:${'H'.repeat(43)}`
  const identity = {
    hostId,
    fingerprint: hostFingerprint,
    identityGeneration: 1,
    publicJwk: JSON.stringify(hostPublicJwk),
  }
  const controlPlaneOrigin = 'https://control-plane.example.test'
  const now = Math.floor(Date.now() / 1_000)
  const evidence = new Map()
  const revoked = new Set()
  const durableSuccessors = new Set()
  const enabled = []
  const revocations = []
  let admissionRoot
  let relay
  let relayRoot
  if (withRelay) {
    relayRoot = await mkdtemp(
      join(tmpdir(), 'codetether-host-b4a-control-relay-'),
    )
    const relayStore = new RelayStateStore(join(relayRoot, 'relay-state'))
    const relayTls = await generateRelayPinnedTlsIdentity(relayStore.identity)
    relay = new RelayService({
      stateStore: relayStore,
      tls: relayTls,
      host: '127.0.0.1',
      port: 0,
      managementHost: '127.0.0.1',
      managementPort: 0,
      heartbeatIntervalMs: 500,
      heartbeatTimeoutMs: 2_000,
      logger: { log() {} },
    })
    await relay.start()
  }
  const manager = await SupervisorTransportManager.create({
    service: serviceFactory?.(identity) ?? {
      getHostIdentity: () => identity,
      ...serviceOverrides,
    },
    persistence: {
      getHostPresenceConfiguration: () => undefined,
      getHostSupervisorAuthorizationEvidence: (id) => evidence.get(id),
      hasDurableHostSupervisorAuthorizationSuccessor: (id) =>
        durableSuccessors.has(id),
      isHostSupervisorPairingRevoked: (_device, root) => revoked.has(root),
      storeHostSupervisorGrant: (grant) => grant,
      enableHostSupervisorGrant: (id) => {
        enabled.push(id)
        const previous = evidence.get(id)?.previousAuthorizationId
        if (previous != null) durableSuccessors.add(previous)
      },
      recordHostSupervisorAuthorizationUse() {},
      revokeHostSupervisorPairing: (target, root) => {
        revocations.push(root)
        revoked.add(root)
        return [...evidence.values()]
          .filter(
            (entry) =>
              entry.pairingRootAuthorizationId === root &&
              entry.payload.deviceId === target,
          )
          .map((entry) => entry.payload.authorizationId)
      },
    },
    bindHost: '127.0.0.1',
    advertiseHost: '127.0.0.1',
    allowLoopbackForTests: true,
    port: 0,
    clientBuildIdentity: 'test-host',
    controlPlaneOrigin,
    ...(relay === undefined
      ? {}
      : {
          relay: {
            endpoint: `tls+pinned://127.0.0.1:${String(relay.listeningAddress.port)}/`,
            relayId: relay.relayId,
            relayFingerprint: relay.relayFingerprint,
          },
        }),
  })
  if (withRelay) await waitFor(() => manager.presence().relay !== null)
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    const challenge = JSON.parse(Buffer.from(init.body).toString('utf8'))
    const entry = evidence.get(challenge.authorizationId)
    return Response.json({
      admitted: true,
      hostId,
      hostIdentityGeneration: 1,
      deviceId,
      deviceKeyGeneration: 1,
      authorizationId: challenge.authorizationId,
      scope: 'supervisor_control',
      pairingRootAuthorizationId:
        admissionRoot ?? entry.pairingRootAuthorizationId,
      authorizationExpiresAt: new Date(
        entry.payload.authorizationExpiresAt * 1_000,
      ).toISOString(),
    })
  }
  return {
    manager,
    enabled,
    revoked,
    durableSuccessors,
    revocations,
    setAdmissionRoot: (root) => {
      admissionRoot = root
    },
    activation(id) {
      const payload = {
        v: 1,
        aud: 'codetether-host-supervisor',
        purpose: 'host_supervisor_grant',
        authorizationId: id,
        hostId,
        hostFingerprint,
        hostIdentityGeneration: 1,
        deviceId,
        deviceFingerprint: `sha256:${'D'.repeat(43)}`,
        deviceKeyGeneration: 1,
        userId: `usr_${'u'.repeat(32)}`,
        spaceId: `space_${'s'.repeat(32)}`,
        scope: 'supervisor_control',
        authorizationSerial: '1',
        authorizationGeneration: 1,
        issuedAt: now,
        expiresAt: now + 3_600,
      }
      const grant = {
        payload,
        proof: compactSign(privateKey, supervisorGrantProofType, payload),
      }
      const presence = manager.presence()
      const descriptorPayload = {
        v: 1,
        aud: 'codetether-host-supervisor',
        purpose: 'host_supervisor_presence',
        hostId,
        hostFingerprint,
        hostIdentityGeneration: 1,
        spaceId: payload.spaceId,
        transportTlsFingerprint: presence.transportTlsFingerprint,
        controlPlaneOrigin,
        directEndpoints: presence.directEndpoints,
        relay: presence.relay,
        iat: now,
        exp: now + 300,
        protocolVersion: 2,
      }
      return {
        hostPublicJwk,
        grant,
        descriptor: {
          payload: descriptorPayload,
          proof: compactSign(
            privateKey,
            supervisorDescriptorProofType,
            descriptorPayload,
          ),
        },
      }
    },
    addEvidence(
      activation,
      pairingRootAuthorizationId,
      { previousAuthorizationId = null, ...changes } = {},
    ) {
      const grant = activation.grant.payload
      evidence.set(grant.authorizationId, {
        pairingRootAuthorizationId,
        previousAuthorizationId,
        payload: {
          v: 1,
          aud: 'codetether-control-plane-host',
          purpose: 'host_device_authorization',
          authorizationId: grant.authorizationId,
          challengeId: `enroll_${'e'.repeat(32)}`,
          hostId: grant.hostId,
          hostFingerprint: grant.hostFingerprint,
          hostIdentityGeneration: grant.hostIdentityGeneration,
          userId: grant.userId,
          spaceId: grant.spaceId,
          deviceId: grant.deviceId,
          deviceFingerprint: grant.deviceFingerprint,
          deviceKeyGeneration: grant.deviceKeyGeneration,
          scope: grant.scope,
          nonce: 'A'.repeat(43),
          iat: now,
          exp: now + 300,
          authorizationExpiresAt: grant.expiresAt,
          ...changes,
        },
      })
    },
    revocation(activation, pairingRootAuthorizationId) {
      const grant = activation.grant.payload
      const payload = {
        v: 1,
        aud: 'codetether-control-plane-host',
        purpose: 'host_pairing_revoke',
        hostId,
        hostFingerprint,
        hostIdentityGeneration: 1,
        deviceId,
        userId: grant.userId,
        spaceId: grant.spaceId,
        subjectId: grant.authorizationId,
        targetDeviceId: deviceId,
        pairingRootAuthorizationId,
        nonce: 'A'.repeat(43),
        iat: now,
        exp: now + 60,
      }
      return {
        payload,
        proof: compactSign(
          privateKey,
          'codetether-host-pairing-management+jws',
          payload,
        ),
      }
    },
    async connect(activation, { forceRelay = false } = {}) {
      const pending = await manager.beginRemote({
        ...activation,
        hostId,
        hostFingerprint,
        hostIdentityGeneration: 1,
        deviceId,
        deviceKeyGeneration: 1,
        forceRelay,
      })
      if (forceRelay) assert.equal(pending.transport, 'relay')
      return await manager.authenticateRemote(pending.connectionId, {
        accessToken: 'test-token',
        deviceProof: 'test-proof',
      })
    },
    async close() {
      globalThis.fetch = originalFetch
      await manager.close()
      if (relay !== undefined) await relay.close()
      if (relayRoot !== undefined)
        await rm(relayRoot, { recursive: true, force: true })
    },
  }
}

test('forced Relay HTTP admission stays single-session while Direct fallback remains security-bounded', async () => {
  const root = await mkdtemp(
    join(tmpdir(), 'codetether-host-supervisor-relay-'),
  )
  const relayStore = new RelayStateStore(join(root, 'relay-state'))
  const relayTls = await generateRelayPinnedTlsIdentity(relayStore.identity)
  const relayLogs = []
  const relay = new RelayService({
    stateStore: relayStore,
    tls: relayTls,
    host: '127.0.0.1',
    port: 0,
    managementHost: '127.0.0.1',
    managementPort: 0,
    heartbeatIntervalMs: 500,
    heartbeatTimeoutMs: 2_000,
    logger: {
      log(event, fields = {}) {
        relayLogs.push({ event, ...fields })
      },
    },
  })
  await relay.start()
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  })
  const publicJwk = publicKey.export({ format: 'jwk' })
  const hostFingerprint = `sha256:${'H'.repeat(43)}`
  const identity = {
    hostId,
    publicJwk: JSON.stringify({
      crv: publicJwk.crv,
      kty: publicJwk.kty,
      x: publicJwk.x,
      y: publicJwk.y,
    }),
    fingerprint: hostFingerprint,
    identityGeneration: 1,
  }
  const reads = { machines: 0, detail: 0, search: 0, history: 0, live: 0 }
  const machineRows = Array.from({ length: 48 }, (_, index) => ({
    machineId: `machine_${'m'.repeat(32)}${index || ''}`,
    displayName: '设备'.repeat(120),
  }))
  const service = {
    publisher: { subscribe: () => () => undefined },
    close: async () => undefined,
    getHostIdentity: () => identity,
    listMachines: () => {
      reads.machines += 1
      return {
        protocolVersion: 1,
        machines: machineRows,
      }
    },
    getMachine: async () => {
      reads.detail += 1
      return {
        protocolVersion: 1,
        machine: { machineId: `machine_${'m'.repeat(32)}` },
        providers: [
          {
            provider: 'codex',
            availability: 'available',
            models: Array.from({ length: 64 }, (_, index) => ({
              id: `model-${index}`,
              label: '模型'.repeat(120),
            })),
          },
        ],
        providerLifecycles: [],
      }
    },
    listSupervisorProjects: () => ({
      protocolVersion: 1,
      projects: [{ projectId: `proj_${'p'.repeat(32)}` }],
      hasMore: false,
    }),
    getSupervisorProject: () => ({
      protocolVersion: 1,
      project: { projectId: `proj_${'p'.repeat(32)}` },
    }),
    listSupervisorConversations: () => ({
      protocolVersion: 1,
      conversations: [{ conversationId: `conv_${'c'.repeat(32)}` }],
      hasMore: false,
    }),
    getSupervisorConversation: () => ({
      protocolVersion: 1,
      conversation: { conversationId: `conv_${'c'.repeat(32)}` },
    }),
    searchProjectConversations: async () => {
      reads.search += 1
      return { protocolVersion: 1, results: [], hasMore: false }
    },
    readSupervisorConversationHistory: () => {
      reads.history += 1
      return {
        marker: 'relay-history',
        historyComplete: true,
        liveCursor: '123e4567-e89b-42d3-a456-426614174000:0',
      }
    },
    readSupervisorConversationLive: () => {
      reads.live += 1
      return { marker: 'relay-live', events: [], active: false }
    },
  }
  const persistence = {
    getHostPresenceConfiguration: () => undefined,
    storeHostSupervisorGrant: (grant) => grant,
    enableHostSupervisorGrant() {},
    pruneHostSupervisorGrants() {},
  }
  const manager = await SupervisorTransportManager.create({
    service,
    persistence,
    bindHost: '127.0.0.1',
    advertiseHost: '127.0.0.1',
    allowLoopbackForTests: true,
    port: 0,
    clientBuildIdentity: 'test-host',
    relay: {
      endpoint: `tls+pinned://127.0.0.1:${String(relay.listeningAddress.port)}/`,
      relayId: relay.relayId,
      relayFingerprint: relay.relayFingerprint,
    },
  })
  let localHttp
  await waitFor(
    () =>
      manager.presence().relay !== null &&
      relayLogs.some(
        (entry) =>
          entry.event === 'supervisor.connection.authenticated' &&
          entry.role === 'host',
      ),
  )
  const originalFetch = globalThis.fetch
  try {
    const now = Math.floor(Date.now() / 1_000)
    const grantPayload = {
      v: 1,
      aud: 'codetether-host-supervisor',
      purpose: 'host_supervisor_grant',
      authorizationId,
      hostId,
      hostFingerprint,
      hostIdentityGeneration: 1,
      deviceId,
      deviceFingerprint: `sha256:${'D'.repeat(43)}`,
      deviceKeyGeneration: 1,
      userId: `usr_${'u'.repeat(32)}`,
      spaceId: `space_${'s'.repeat(32)}`,
      scope: 'supervisor_read',
      authorizationSerial: '1',
      authorizationGeneration: 1,
      issuedAt: now,
      expiresAt: now + 3_600,
    }
    const grant = {
      payload: grantPayload,
      proof: compactSign(privateKey, supervisorGrantProofType, grantPayload),
    }
    const presence = manager.presence()
    assert.notEqual(presence.relay, null)
    const descriptorPayload = {
      v: 1,
      aud: 'codetether-host-supervisor',
      purpose: 'host_supervisor_transport',
      authorizationId,
      grantDigest: supervisorGrantDigest(grant),
      hostId,
      hostFingerprint,
      hostIdentityGeneration: 1,
      deviceId,
      deviceKeyGeneration: 1,
      transportTlsFingerprint: presence.transportTlsFingerprint,
      controlPlaneOrigin: 'https://control-plane.example.test',
      directEndpoints: [{ host: '127.0.0.1', port: 1 }],
      relay: presence.relay,
      iat: now,
      exp: now + 600,
      protocolVersion: 1,
    }
    const descriptor = {
      payload: descriptorPayload,
      proof: compactSign(
        privateKey,
        supervisorDescriptorProofType,
        descriptorPayload,
      ),
    }
    await manager.activate({ hostPublicJwk: publicJwk, grant, descriptor })
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          admitted: true,
          hostId,
          hostIdentityGeneration: 1,
          deviceId,
          deviceKeyGeneration: 1,
          authorizationId,
          scope: 'supervisor_read',
          authorizationExpiresAt: new Date((now + 3_600) * 1_000).toISOString(),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    localHttp = new LocalHttpServer({
      service,
      allowedOrigins: [],
      heartbeatMs: 60_000,
      supervisorTransport: manager,
    })
    const localBaseUrl = await localHttp.start(0)
    const pendingResponse = await originalFetch(
      `${localBaseUrl}/api/v1/remote-supervisor/connections`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          hostId,
          hostFingerprint,
          hostIdentityGeneration: 1,
          hostPublicJwk: publicJwk,
          deviceId,
          deviceKeyGeneration: 1,
          grant,
          descriptor,
        }),
      },
    )
    assert.equal(pendingResponse.status, 201)
    const pending = await pendingResponse.json()
    assert.equal(pending.transport, 'relay')
    const authenticationResponse = await originalFetch(
      `${localBaseUrl}/api/v1/remote-supervisor/connections/${pending.connectionId}/authenticate`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          accessToken: 'access-token',
          deviceProof: 'relay-device-proof',
        }),
      },
    )
    assert.equal(authenticationResponse.status, 200)
    const authenticated = await authenticationResponse.json()
    const bootstrapResponse = await originalFetch(
      `${localBaseUrl}/api/v1/remote-supervisor/sessions/${authenticated.sessionId}/bootstrap`,
    )
    assert.equal(bootstrapResponse.status, 200)
    assert.equal((await bootstrapResponse.json()).identity.hostId, hostId)
    const machineListResponse = await originalFetch(
      `${localBaseUrl}/api/v1/remote-supervisor/sessions/${authenticated.sessionId}/machines`,
    )
    assert.equal(machineListResponse.status, 200)
    const machineList = await machineListResponse.json()
    assert.equal('truncated' in machineList, false)
    assert.ok(machineList.machines.length < machineRows.length)
    const machineId = machineList.machines[0].machineId
    const machineDetailResponse = await originalFetch(
      `${localBaseUrl}/api/v1/remote-supervisor/sessions/${authenticated.sessionId}/machines/${machineId}`,
    )
    assert.equal(machineDetailResponse.status, 200)
    const machineDetail = await machineDetailResponse.json()
    assert.equal(machineDetail.machine.machineId, machineId)
    assert.equal('truncated' in machineDetail, false)
    assert.equal(machineDetail.providers[0].provider, 'codex')
    const projectListResponse = await originalFetch(
      `${localBaseUrl}/api/v1/remote-supervisor/sessions/${authenticated.sessionId}/machines/${machineId}/projects?limit=25`,
    )
    const projectListBody = await projectListResponse.json()
    assert.equal(
      projectListResponse.status,
      200,
      JSON.stringify(projectListBody),
    )
    const projectId = projectListBody.projects[0].projectId
    const projectDetailResponse = await originalFetch(
      `${localBaseUrl}/api/v1/remote-supervisor/sessions/${authenticated.sessionId}/machines/${machineId}/projects/${projectId}`,
    )
    assert.equal(projectDetailResponse.status, 200)
    const conversationListResponse = await originalFetch(
      `${localBaseUrl}/api/v1/remote-supervisor/sessions/${authenticated.sessionId}/machines/${machineId}/projects/${projectId}/conversations?limit=25`,
    )
    assert.equal(conversationListResponse.status, 200)
    const conversationId = (await conversationListResponse.json())
      .conversations[0].conversationId
    const conversationDetailResponse = await originalFetch(
      `${localBaseUrl}/api/v1/remote-supervisor/sessions/${authenticated.sessionId}/machines/${machineId}/projects/${projectId}/conversations/${conversationId}`,
    )
    assert.equal(conversationDetailResponse.status, 200)
    assert.equal(
      (await conversationDetailResponse.json()).conversation.conversationId,
      conversationId,
    )
    assert.deepEqual(
      await manager.executeRemoteB1Operation(authenticated.sessionId, {
        operation: 'conversation.search',
        projectId,
        query: '搜索词',
        archive: 'active',
        limit: 25,
      }),
      { protocolVersion: 1, results: [], hasMore: false },
    )
    const relayDeniedActionId = 'act_supervisor_relay_read_0001'
    for (const request of [
      {
        operation: 'project.create',
        machineId,
        actionId: relayDeniedActionId,
        path: 'C:\\fixture',
      },
      { operation: 'project.remove', projectId, actionId: relayDeniedActionId },
      {
        operation: 'conversation.pin',
        machineId,
        projectId,
        conversationId,
        actionId: relayDeniedActionId,
        pinned: true,
      },
      {
        operation: 'conversation.rename',
        machineId,
        projectId,
        conversationId,
        actionId: relayDeniedActionId,
        title: '标题',
      },
      {
        operation: 'conversation.restore',
        machineId,
        projectId,
        conversationId,
        actionId: relayDeniedActionId,
      },
    ]) {
      await assert.rejects(
        manager.executeRemoteB1Operation(authenticated.sessionId, request),
        { code: 'operation_not_allowed' },
      )
    }
    const historyResponse = await originalFetch(
      `${localBaseUrl}/api/v1/remote-supervisor/sessions/${authenticated.sessionId}/machines/${machineId}/projects/${projectId}/conversations/${conversationId}/history?limit=20`,
    )
    const historyBody = await historyResponse.json()
    assert.equal(historyResponse.status, 200, JSON.stringify(historyBody))
    assert.equal(historyBody.marker, 'relay-history')
    const liveResponse = await originalFetch(
      `${localBaseUrl}/api/v1/remote-supervisor/sessions/${authenticated.sessionId}/machines/${machineId}/projects/${projectId}/conversations/${conversationId}/live?cursor=123e4567-e89b-42d3-a456-426614174000%3A0&limit=64&waitMs=0`,
    )
    const liveBody = await liveResponse.json()
    assert.equal(liveResponse.status, 200, JSON.stringify(liveBody))
    assert.equal(liveBody.marker, 'relay-live')
    assert.equal(reads.machines, 1)
    assert.equal(reads.detail, 1)
    assert.equal(reads.search, 1)
    assert.equal(reads.history, 1)
    assert.equal(reads.live, 1)
    manager.closeRemote(authenticated.sessionId)
    await new Promise((resolve) => setTimeout(resolve, 30))
    const deviceConnections = relayLogs.filter(
      (entry) =>
        entry.event === 'supervisor.connection.authenticated' &&
        entry.role === 'device',
    ).length
    assert.equal(deviceConnections, 1)

    const replacementPending = await manager.beginRemote({
      hostId,
      hostFingerprint,
      hostIdentityGeneration: 1,
      hostPublicJwk: publicJwk,
      deviceId,
      deviceKeyGeneration: 1,
      grant,
      descriptor,
      forceRelay: true,
    })
    const replacementSession = await manager.authenticateRemote(
      replacementPending.connectionId,
      {
        accessToken: 'access-token',
        deviceProof: 'replacement-relay-device-proof',
      },
    )
    assert.equal(
      (await manager.readRemote(replacementSession.sessionId, 'host.bootstrap'))
        .identity.hostId,
      hostId,
    )
    manager.closeRemote(replacementSession.sessionId)
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(
      relayLogs.filter(
        (entry) =>
          entry.event === 'supervisor.connection.authenticated' &&
          entry.role === 'device',
      ).length,
      deviceConnections + 1,
    )

    await assert.rejects(
      manager.beginRemote({
        hostId,
        hostFingerprint: `sha256:${'Z'.repeat(43)}`,
        hostIdentityGeneration: 1,
        hostPublicJwk: publicJwk,
        deviceId,
        deviceKeyGeneration: 1,
        grant,
        descriptor,
      }),
      (error) => error?.code === 'host_identity_mismatch',
    )
    assert.equal(
      relayLogs.filter(
        (entry) =>
          entry.event === 'supervisor.connection.authenticated' &&
          entry.role === 'device',
      ).length,
      deviceConnections + 1,
    )
    const directDescriptorPayload = {
      ...descriptorPayload,
      directEndpoints: presence.directEndpoints,
    }
    const directDescriptor = {
      payload: directDescriptorPayload,
      proof: compactSign(
        privateKey,
        supervisorDescriptorProofType,
        directDescriptorPayload,
      ),
    }
    await manager.activate({
      hostPublicJwk: publicJwk,
      grant,
      descriptor: directDescriptor,
    })
    const directPending = await manager.beginRemote({
      hostId,
      hostFingerprint,
      hostIdentityGeneration: 1,
      hostPublicJwk: publicJwk,
      deviceId,
      deviceKeyGeneration: 1,
      grant,
      descriptor: directDescriptor,
    })
    assert.equal(directPending.transport, 'direct')
    const directSession = await manager.authenticateRemote(
      directPending.connectionId,
      { accessToken: 'access-token', deviceProof: 'direct-device-proof' },
    )
    await relay.close()
    assert.equal(
      (await manager.readRemote(directSession.sessionId, 'host.bootstrap'))
        .identity.hostId,
      hostId,
    )
  } finally {
    globalThis.fetch = originalFetch
    await localHttp?.close()
    await manager.close()
    await relay.close()
    await rm(root, { recursive: true, force: true })
  }
})

function compactSign(privateKey, type, payload) {
  const header = Buffer.from(
    JSON.stringify({ alg: 'ES256', typ: type }),
  ).toString('base64url')
  const encodedPayload = Buffer.from(canonicalJsonBytes(payload)).toString(
    'base64url',
  )
  const signingInput = `${header}.${encodedPayload}`
  const signature = sign('sha256', Buffer.from(signingInput, 'ascii'), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url')
  return `${signingInput}.${signature}`
}

async function waitFor(predicate, timeoutMs = 2_000) {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error('Timed out waiting for Supervisor Relay presence')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
