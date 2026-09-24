import assert from 'node:assert/strict'
import test from 'node:test'

import { CompactSign, exportJWK, generateKeyPair } from 'jose'

import {
  SupervisorClientError,
  SupervisorServer,
  canonicalJsonBytes,
  connectSupervisorDirect,
  supervisorDescriptorProofType,
  supervisorClientAuthenticateSchema,
  supervisorGrantDigest,
  supervisorGrantProofType,
  supervisorRequestSchema,
} from '../dist/index.js'

const ids = {
  authorizationId: `hauth_${'a'.repeat(32)}`,
  deviceId: `dev_${'d'.repeat(32)}`,
  hostId: `host_${'h'.repeat(32)}`,
  userId: `usr_${'u'.repeat(32)}`,
  spaceId: `space_${'s'.repeat(32)}`,
}

test('direct Supervisor transport verifies exact identities and exposes only reads', async () => {
  const fixture = await createFixture()
  try {
    const pending = await connectSupervisorDirect(fixture.clientOptions)
    assert.equal(pending.challenge.hostId, ids.hostId)
    const connected = await pending.authenticate({
      accessToken: 'test-access-token',
      deviceProof: 'test-device-proof',
    })
    assert.deepEqual(await connected.readHostBootstrap(), {
      hostId: ids.hostId,
    })
    assert.deepEqual(await connected.listMachines(), {
      machines: [{ machineId: `machine_${'m'.repeat(32)}` }],
    })
    assert.deepEqual(await connected.getMachine(`machine_${'m'.repeat(32)}`), {
      providers: ['codex', 'claude-code'],
    })
    assert.deepEqual(
      await connected.listProjects(`machine_${'m'.repeat(32)}`, { limit: 25 }),
      { projects: [{ projectId: `proj_${'p'.repeat(32)}` }], hasMore: false },
    )
    assert.deepEqual(
      await connected.getProject(
        `machine_${'m'.repeat(32)}`,
        `proj_${'p'.repeat(32)}`,
      ),
      { projectId: `proj_${'p'.repeat(32)}` },
    )
    assert.deepEqual(
      await connected.listConversations(
        `machine_${'m'.repeat(32)}`,
        `proj_${'p'.repeat(32)}`,
        { limit: 25 },
      ),
      {
        conversations: [{ conversationId: `conv_${'c'.repeat(32)}` }],
        hasMore: false,
      },
    )
    assert.deepEqual(
      await connected.getConversation(
        `machine_${'m'.repeat(32)}`,
        `proj_${'p'.repeat(32)}`,
        `conv_${'c'.repeat(32)}`,
      ),
      { conversationId: `conv_${'c'.repeat(32)}` },
    )
    connected.close()
    assert.equal(
      supervisorRequestSchema.safeParse({
        type: 'supervisor.request',
        protocolVersion: 1,
        requestId: `sreq_${'r'.repeat(32)}`,
        operation: 'conversation.start',
      }).success,
      false,
    )
    for (const operation of [
      'conversation.history',
      'conversation.send',
      'conversation.resume',
      'conversation.create',
      'provider.start',
      'shell.execute',
      'filesystem.write',
    ]) {
      assert.equal(
        supervisorRequestSchema.safeParse({
          type: 'supervisor.request',
          protocolVersion: 1,
          requestId: `sreq_${'r'.repeat(32)}`,
          operation,
        }).success,
        false,
      )
    }
    assert.equal(
      supervisorClientAuthenticateSchema.safeParse({
        type: 'supervisor.authenticate',
        protocolVersion: 1,
        accessToken: 'human-token',
        deviceProof: 'product-device-proof',
        controllerCredential: 'controller-identity-is-not-admitted',
      }).success,
      false,
    )
  } finally {
    await fixture.server.close()
  }
})

test('Host identity mismatch and replayed ProductDevice proof fail closed', async () => {
  const usedProofs = new Set()
  const fixture = await createFixture({ usedProofs })
  try {
    await assert.rejects(
      connectSupervisorDirect({
        ...fixture.clientOptions,
        expectedHost: {
          ...fixture.clientOptions.expectedHost,
          fingerprint: `sha256:${'Z'.repeat(43)}`,
        },
      }),
      (error) =>
        error instanceof SupervisorClientError &&
        error.code === 'host_identity_mismatch',
    )
    const first = await connectSupervisorDirect(fixture.clientOptions)
    const session = await first.authenticate({
      accessToken: 'test-access-token',
      deviceProof: 'one-use-proof',
    })
    session.close()
    const replay = await connectSupervisorDirect(fixture.clientOptions)
    await assert.rejects(
      replay.authenticate({
        accessToken: 'test-access-token',
        deviceProof: 'one-use-proof',
      }),
      (error) =>
        error instanceof SupervisorClientError &&
        error.code === 'authentication_failed',
    )
  } finally {
    await fixture.server.close()
  }
})

async function createFixture(options = {}) {
  const now = new Date('2026-09-24T12:00:00.000Z')
  const { privateKey, publicKey } = await generateKeyPair('ES256')
  const publicJwk = await exportJWK(publicKey)
  const server = await SupervisorServer.create({
    host: '127.0.0.1',
    port: 0,
    now: () => now,
    authorize: async ({ deviceProof, challenge }) => {
      if (options.usedProofs?.has(deviceProof)) throw new Error('replay')
      options.usedProofs?.add(deviceProof)
      return {
        hostId: challenge.hostId,
        hostIdentityGeneration: challenge.hostIdentityGeneration,
        deviceId: challenge.deviceId,
        deviceKeyGeneration: challenge.deviceKeyGeneration,
        authorizationId: challenge.authorizationId,
        authorizationExpiresAt: new Date(
          now.getTime() + 60 * 60_000,
        ).toISOString(),
      }
    },
    reads: {
      readHostBootstrap: () => ({ hostId: ids.hostId }),
      listMachines: () => ({
        machines: [{ machineId: `machine_${'m'.repeat(32)}` }],
      }),
      getMachine: () => ({ providers: ['codex', 'claude-code'] }),
      listProjects: () => ({
        projects: [{ projectId: `proj_${'p'.repeat(32)}` }],
        hasMore: false,
      }),
      getProject: () => ({ projectId: `proj_${'p'.repeat(32)}` }),
      listConversations: () => ({
        conversations: [{ conversationId: `conv_${'c'.repeat(32)}` }],
        hasMore: false,
      }),
      getConversation: () => ({ conversationId: `conv_${'c'.repeat(32)}` }),
    },
  })
  const address = await server.start()
  const grantPayload = {
    v: 1,
    aud: 'codetether-host-supervisor',
    purpose: 'host_supervisor_grant',
    authorizationId: ids.authorizationId,
    hostId: ids.hostId,
    hostFingerprint: `sha256:${'H'.repeat(43)}`,
    hostIdentityGeneration: 1,
    deviceId: ids.deviceId,
    deviceFingerprint: `sha256:${'D'.repeat(43)}`,
    deviceKeyGeneration: 1,
    userId: ids.userId,
    spaceId: ids.spaceId,
    scope: 'supervisor_read',
    authorizationSerial: '1',
    authorizationGeneration: 1,
    issuedAt: Math.floor(now.getTime() / 1_000),
    expiresAt: Math.floor((now.getTime() + 60 * 60_000) / 1_000),
  }
  const grant = {
    payload: grantPayload,
    proof: await sign(privateKey, supervisorGrantProofType, grantPayload),
  }
  const descriptorPayload = {
    v: 1,
    aud: 'codetether-host-supervisor',
    purpose: 'host_supervisor_transport',
    authorizationId: ids.authorizationId,
    grantDigest: supervisorGrantDigest(grant),
    hostId: ids.hostId,
    hostFingerprint: grantPayload.hostFingerprint,
    hostIdentityGeneration: 1,
    deviceId: ids.deviceId,
    deviceKeyGeneration: 1,
    transportTlsFingerprint: server.tlsIdentity.publicKeyFingerprint,
    controlPlaneOrigin: 'https://control-plane.example.test',
    directEndpoints: [{ host: '127.0.0.1', port: address.port }],
    relay: null,
    iat: Math.floor(now.getTime() / 1_000),
    exp: Math.floor((now.getTime() + 10 * 60_000) / 1_000),
    protocolVersion: 1,
  }
  const descriptor = {
    payload: descriptorPayload,
    proof: await sign(
      privateKey,
      supervisorDescriptorProofType,
      descriptorPayload,
    ),
  }
  await server.activate({ hostPublicJwk: publicJwk, grant, descriptor })
  return {
    server,
    clientOptions: {
      endpoint: descriptorPayload.directEndpoints[0],
      expectedHost: {
        hostId: ids.hostId,
        fingerprint: grantPayload.hostFingerprint,
        identityGeneration: 1,
        publicJwk,
      },
      expectedDevice: { deviceId: ids.deviceId, keyGeneration: 1 },
      grant,
      descriptor,
      now: () => now,
    },
  }
}

async function sign(privateKey, type, payload) {
  return await new CompactSign(canonicalJsonBytes(payload))
    .setProtectedHeader({ alg: 'ES256', typ: type })
    .sign(privateKey)
}
