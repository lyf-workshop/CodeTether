import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

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
import { LocalHttpServer } from '../dist/api/local-http-server.js'

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
    ['127.0.0.1', '192.168.1.20'],
  )
})

test('forced-remote manager reads Host state without using local HTTP product data', async () => {
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
        providerLifecycles: [],
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
      assert.deepEqual(page, { limit: 25 })
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
  }
  let storedGrant
  const persistence = {
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
    assert.deepEqual(reads, {
      machines: 1,
      detail: 1,
      projects: 1,
      project: 1,
      conversations: 1,
      conversation: 1,
    })
  } finally {
    globalThis.fetch = originalFetch
    await manager.close()
  }
})

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
  const reads = { machines: 0, detail: 0 }
  const service = {
    publisher: { subscribe: () => () => undefined },
    close: async () => undefined,
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
  }
  const persistence = { storeHostSupervisorGrant: (grant) => grant }
  const manager = await SupervisorTransportManager.create({
    service,
    persistence,
    bindHost: '127.0.0.1',
    advertiseHost: '127.0.0.1',
    port: 0,
    clientBuildIdentity: 'test-host',
    relay: {
      endpoint: `tls+pinned://127.0.0.1:${String(relay.listeningAddress.port)}/`,
      relayId: relay.relayId,
      relayFingerprint: relay.relayFingerprint,
    },
  })
  let localHttp
  await waitFor(() =>
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
          forceRelay: true,
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
    const machineId = (await machineListResponse.json()).machines[0].machineId
    const machineDetailResponse = await originalFetch(
      `${localBaseUrl}/api/v1/remote-supervisor/sessions/${authenticated.sessionId}/machines/${machineId}`,
    )
    assert.equal(machineDetailResponse.status, 200)
    assert.equal(
      (await machineDetailResponse.json()).machine.machineId,
      machineId,
    )
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
    assert.equal(reads.machines, 1)
    assert.equal(reads.detail, 1)
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
