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
    assert.deepEqual(
      await connected.readConversationHistory(
        `machine_${'m'.repeat(32)}`,
        `proj_${'p'.repeat(32)}`,
        `conv_${'c'.repeat(32)}`,
        { limit: 20 },
      ),
      { entries: 20, historyComplete: false },
    )
    assert.deepEqual(
      await connected.readConversationLive(
        `machine_${'m'.repeat(32)}`,
        `proj_${'p'.repeat(32)}`,
        `conv_${'c'.repeat(32)}`,
        {
          cursor: '123e4567-e89b-42d3-a456-426614174000:0',
          limit: 64,
          waitMs: 0,
        },
      ),
      terminalLivePage(),
    )
    assert.deepEqual(await connected.getAction(`act_${'a'.repeat(32)}`), {
      protocolVersion: 1,
      actionId: `act_${'a'.repeat(32)}`,
      status: 'not_found',
    })
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
      'conversation.send',
      'conversation.resume',
      'conversation.create',
      'turn.cancel',
      'provider.start',
      'tool.approve',
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

test('read-only Supervisor sessions cannot control Conversations', async () => {
  const fixture = await createFixture()
  try {
    const pending = await connectSupervisorDirect(fixture.clientOptions)
    const session = await pending.authenticate({
      accessToken: 'test-access-token',
      deviceProof: 'control-denied-proof',
    })
    await assert.rejects(
      session.startConversationTurn({
        actionId: `act_${'a'.repeat(32)}`,
        machineId: `machine_${'m'.repeat(32)}`,
        projectId: `proj_${'p'.repeat(32)}`,
        conversationId: `conv_${'c'.repeat(32)}`,
        input: { type: 'text', text: 'safe' },
      }),
      (error) =>
        error instanceof SupervisorClientError &&
        error.code === 'operation_not_allowed',
    )
    await assert.rejects(
      session.createConversation({
        actionId: `act_${'c'.repeat(32)}`,
        machineId: `machine_${'m'.repeat(32)}`,
        projectId: `proj_${'p'.repeat(32)}`,
        provider: 'codex',
        input: { type: 'text', text: 'safe' },
      }),
      (error) =>
        error instanceof SupervisorClientError &&
        error.code === 'operation_not_allowed',
    )
    session.close()
  } finally {
    await fixture.server.close()
  }
})

test('Host-local control approval admits only the fixed Conversation control union', async () => {
  const fixture = await createFixture({ controlEnabled: true })
  try {
    const pending = await connectSupervisorDirect(fixture.clientOptions)
    const session = await pending.authenticate({
      accessToken: 'test-access-token',
      deviceProof: 'control-allowed-proof',
    })
    assert.deepEqual(
      await session.startConversationTurn({
        actionId: `act_${'b'.repeat(32)}`,
        machineId: `machine_${'m'.repeat(32)}`,
        projectId: `proj_${'p'.repeat(32)}`,
        conversationId: `conv_${'c'.repeat(32)}`,
        input: { type: 'text', text: 'safe' },
      }),
      { accepted: true, operation: 'conversation.turn.start' },
    )
    assert.deepEqual(
      await session.createConversation({
        actionId: `act_${'d'.repeat(32)}`,
        machineId: `machine_${'m'.repeat(32)}`,
        projectId: `proj_${'p'.repeat(32)}`,
        provider: 'codex',
        input: { type: 'text', text: 'safe' },
      }),
      { accepted: true, operation: 'conversation.create' },
    )
    session.close()
  } finally {
    await fixture.server.close()
  }
})

test('one Host presence serves two independently scoped ProductDevices', async () => {
  const fixture = await createFixture({
    controlAuthorizationId: ids.authorizationId,
  })
  const macAuthorizationId = `hauth_${'b'.repeat(32)}`
  const macDeviceId = `dev_${'e'.repeat(32)}`
  const hostPresencePayload = {
    v: 1,
    aud: 'codetether-host-supervisor',
    purpose: 'host_supervisor_presence',
    hostId: ids.hostId,
    hostFingerprint: fixture.clientOptions.expectedHost.fingerprint,
    hostIdentityGeneration: 1,
    spaceId: ids.spaceId,
    transportTlsFingerprint: fixture.server.tlsIdentity.publicKeyFingerprint,
    controlPlaneOrigin: 'https://control-plane.example.test',
    directEndpoints: [fixture.clientOptions.endpoint],
    relay: null,
    iat: Math.floor(fixture.now.getTime() / 1_000),
    exp: Math.floor((fixture.now.getTime() + 10 * 60_000) / 1_000),
    protocolVersion: 2,
  }
  const presence = {
    payload: hostPresencePayload,
    proof: await sign(
      fixture.privateKey,
      supervisorDescriptorProofType,
      hostPresencePayload,
    ),
  }
  const macGrantPayload = {
    ...fixture.clientOptions.grant.payload,
    authorizationId: macAuthorizationId,
    deviceId: macDeviceId,
    deviceFingerprint: `sha256:${'E'.repeat(43)}`,
    authorizationSerial: '2',
  }
  const macGrant = {
    payload: macGrantPayload,
    proof: await sign(
      fixture.privateKey,
      supervisorGrantProofType,
      macGrantPayload,
    ),
  }
  try {
    await fixture.server.activate({
      hostPublicJwk: fixture.publicJwk,
      grant: fixture.clientOptions.grant,
      descriptor: presence,
    })
    await fixture.server.activate({
      hostPublicJwk: fixture.publicJwk,
      grant: macGrant,
      descriptor: presence,
    })
    assert.equal(fixture.server.activationCount, 2)
    const [windowsPending, macPending] = await Promise.all([
      connectSupervisorDirect({
        ...fixture.clientOptions,
        descriptor: presence,
      }),
      connectSupervisorDirect({
        ...fixture.clientOptions,
        expectedDevice: { deviceId: macDeviceId, keyGeneration: 1 },
        grant: macGrant,
        descriptor: presence,
      }),
    ])
    const [windows, mac] = await Promise.all([
      windowsPending.authenticate({
        accessToken: 'windows-token',
        deviceProof: 'windows-proof',
      }),
      macPending.authenticate({
        accessToken: 'mac-token',
        deviceProof: 'mac-proof',
      }),
    ])
    assert.equal(windows.control, 'control')
    assert.equal(mac.control, 'read')
    assert.deepEqual(await windows.readHostBootstrap(), { hostId: ids.hostId })
    assert.deepEqual(await mac.readHostBootstrap(), { hostId: ids.hostId })
    await assert.rejects(
      mac.startConversationTurn({
        actionId: `act_${'q'.repeat(32)}`,
        machineId: `machine_${'m'.repeat(32)}`,
        projectId: `proj_${'p'.repeat(32)}`,
        conversationId: `conv_${'c'.repeat(32)}`,
        input: { type: 'text', text: 'safe' },
      }),
      (error) =>
        error instanceof SupervisorClientError &&
        error.code === 'operation_not_allowed',
    )
    fixture.server.deactivate(macAuthorizationId)
    assert.equal(fixture.server.activationCount, 1)
    assert.deepEqual(await windows.readHostBootstrap(), { hostId: ids.hostId })
    windows.close()
    mac.close()
    await assert.rejects(
      connectSupervisorDirect({
        ...fixture.clientOptions,
        expectedDevice: { deviceId: macDeviceId, keyGeneration: 1 },
        grant: macGrant,
        descriptor: presence,
      }),
    )
  } finally {
    await fixture.server.close()
  }
})

test('a restarted Supervisor restores both exact grants under one renewed Host presence', async () => {
  const fixture = await createFixture()
  const secondGrantPayload = {
    ...fixture.clientOptions.grant.payload,
    authorizationId: `hauth_${'b'.repeat(32)}`,
    deviceId: `dev_${'e'.repeat(32)}`,
    deviceFingerprint: `sha256:${'E'.repeat(43)}`,
    authorizationSerial: '2',
  }
  const secondGrant = {
    payload: secondGrantPayload,
    proof: await sign(
      fixture.privateKey,
      supervisorGrantProofType,
      secondGrantPayload,
    ),
  }
  await fixture.server.close()
  const restarted = await SupervisorServer.create({
    host: '127.0.0.1',
    port: 0,
    now: () => fixture.now,
    authorize: async ({ challenge }) => ({
      hostId: challenge.hostId,
      hostIdentityGeneration: challenge.hostIdentityGeneration,
      deviceId: challenge.deviceId,
      deviceKeyGeneration: challenge.deviceKeyGeneration,
      authorizationId: challenge.authorizationId,
      authorizationExpiresAt: new Date(
        fixture.now.getTime() + 60 * 60_000,
      ).toISOString(),
    }),
    reads: { readHostBootstrap: () => ({ hostId: ids.hostId }) },
  })
  try {
    const address = await restarted.start()
    const payload = {
      v: 1,
      aud: 'codetether-host-supervisor',
      purpose: 'host_supervisor_presence',
      hostId: ids.hostId,
      hostFingerprint: fixture.clientOptions.expectedHost.fingerprint,
      hostIdentityGeneration: 1,
      spaceId: ids.spaceId,
      transportTlsFingerprint: restarted.tlsIdentity.publicKeyFingerprint,
      controlPlaneOrigin: 'https://control-plane.example.test',
      directEndpoints: [{ host: '127.0.0.1', port: address.port }],
      relay: null,
      iat: Math.floor(fixture.now.getTime() / 1_000),
      exp: Math.floor((fixture.now.getTime() + 10 * 60_000) / 1_000),
      protocolVersion: 2,
    }
    const presence = {
      payload,
      proof: await sign(
        fixture.privateKey,
        supervisorDescriptorProofType,
        payload,
      ),
    }
    for (const grant of [fixture.clientOptions.grant, secondGrant]) {
      await restarted.activate({
        hostPublicJwk: fixture.publicJwk,
        grant,
        descriptor: presence,
      })
    }
    assert.equal(restarted.activationCount, 2)
    for (const [grant, deviceId] of [
      [fixture.clientOptions.grant, ids.deviceId],
      [secondGrant, secondGrantPayload.deviceId],
    ]) {
      const pending = await connectSupervisorDirect({
        ...fixture.clientOptions,
        endpoint: payload.directEndpoints[0],
        expectedDevice: { deviceId, keyGeneration: 1 },
        grant,
        descriptor: presence,
      })
      const session = await pending.authenticate({
        accessToken: 'token',
        deviceProof: `proof-${deviceId}`,
      })
      assert.deepEqual(await session.readHostBootstrap(), {
        hostId: ids.hostId,
      })
      session.close()
    }
  } finally {
    await restarted.close()
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
      readConversationHistory: () => ({
        entries: 20,
        historyComplete: false,
      }),
      readConversationLive: () => terminalLivePage(),
      getAction: (actionId) => ({
        protocolVersion: 1,
        actionId,
        status: 'not_found',
      }),
    },
    control: {
      startConversationTurn: () => ({
        accepted: true,
        operation: 'conversation.turn.start',
      }),
      createConversation: () => ({
        accepted: true,
        operation: 'conversation.create',
      }),
    },
    authorizeControl: async (authorizationId) =>
      options.controlEnabled === true ||
      options.controlAuthorizationId === authorizationId,
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
    privateKey,
    publicJwk,
    now,
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

function terminalLivePage() {
  const epoch = '123e4567-e89b-42d3-a456-426614174000'
  const conversationId = `conv_${'c'.repeat(32)}`
  const turnId = `turn_${'t'.repeat(32)}`
  return {
    protocolVersion: 1,
    conversationId,
    cursor: `${epoch}:2`,
    events: [
      {
        protocolVersion: 1,
        epoch,
        seq: 1,
        eventId: `${epoch}:1`,
        conversationId,
        turnId,
        itemId: `item_${'i'.repeat(32)}`,
        timestamp: '2026-09-24T12:00:00.000Z',
        type: 'message.completed',
        payload: { message: 'complete' },
      },
      {
        protocolVersion: 1,
        epoch,
        seq: 2,
        eventId: `${epoch}:2`,
        conversationId,
        turnId,
        timestamp: '2026-09-24T12:00:00.000Z',
        type: 'turn.completed',
        payload: { finalMessage: 'complete' },
      },
    ],
    resetRequired: false,
    active: false,
    timedOut: false,
  }
}

async function sign(privateKey, type, payload) {
  return await new CompactSign(canonicalJsonBytes(payload))
    .setProtectedHeader({ alg: 'ES256', typ: type })
    .sign(privateKey)
}
