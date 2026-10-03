import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  RelayClientMessageSchema,
  RelaySupervisorAuthenticateMessageSchema,
  relayPublicKeySpkiFromCertificate,
  relayProtocolVersion,
} from '@codetether/relay-protocol'
import {
  SupervisorClientError,
  SupervisorServer,
  canonicalJsonBytes,
  connectSupervisorRelayDevice,
  connectSupervisorRelayHost,
  connectSupervisorRelayOverStream,
  generateSupervisorTlsIdentity,
  supervisorClientAuthenticateSchema,
  supervisorDescriptorProofType,
  supervisorGrantDigest,
  supervisorGrantProofType,
  supervisorRequestSchema,
} from '@codetether/supervisor-transport'

import {
  RelayService,
  RelayStateStore,
  generateRelayPinnedTlsIdentity,
} from '../dist/index.js'

const ids = {
  authorizationId: `hauth_${'a'.repeat(32)}`,
  deviceId: `dev_${'d'.repeat(32)}`,
  hostId: `host_${'h'.repeat(32)}`,
  userId: `usr_${'u'.repeat(32)}`,
  spaceId: `space_${'s'.repeat(32)}`,
}

test('opaque Relay carries the same authenticated read-only Supervisor protocol', async () => {
  const fixture = await createFixture()
  try {
    const session = await connectThroughRelay(fixture, 'one-use-proof')
    assert.equal(session.transport, 'relay')
    assert.deepEqual(await session.readHostBootstrap(), {
      hostId: ids.hostId,
      transportAuthority: 'host',
    })
    assert.deepEqual(await session.listMachines(), {
      machines: [{ machineId: `machine_${'m'.repeat(32)}` }],
    })
    assert.deepEqual(await session.getMachine(`machine_${'m'.repeat(32)}`), {
      providers: ['codex', 'claude-code'],
    })
    assert.deepEqual(
      await session.readConversationHistory(
        `machine_${'m'.repeat(32)}`,
        `proj_${'p'.repeat(32)}`,
        `conv_${'c'.repeat(32)}`,
        { limit: 20 },
      ),
      { entries: 20, historyComplete: false },
    )
    const live = await session.readConversationLive(
      `machine_${'m'.repeat(32)}`,
      `proj_${'p'.repeat(32)}`,
      `conv_${'c'.repeat(32)}`,
      {
        cursor: '123e4567-e89b-42d3-a456-426614174000:0',
        limit: 64,
        waitMs: 0,
      },
    )
    assert.deepEqual(
      live.events.map(({ type }) => type),
      ['message.completed', 'turn.completed'],
    )
    assert.equal(live.active, false)
    assert.equal(
      fixture.logs.some((entry) =>
        JSON.stringify(entry).includes('machine.list'),
      ),
      false,
    )
    assert.equal(
      supervisorRequestSchema.safeParse({
        type: 'supervisor.request',
        protocolVersion: 1,
        requestId: `sreq_${'r'.repeat(32)}`,
        operation: 'conversation.start',
      }).success,
      false,
    )
    assert.equal(
      supervisorClientAuthenticateSchema.safeParse({
        type: 'supervisor.authenticate',
        protocolVersion: 1,
        accessToken: 'token',
        deviceProof: 'proof',
        controllerCredential: 'not-a-product-device',
      }).success,
      false,
    )
    session.close()
  } finally {
    await fixture.close()
  }
})

test('Supervisor Relay identities cannot substitute for Controller Relay identities', async () => {
  const identity = await generateSupervisorTlsIdentity(
    'CodeTether Supervisor Device',
  )
  const supervisor = {
    type: 'supervisor.device.connect',
    protocolVersion: relayProtocolVersion,
    role: 'device',
    requestId: `relay_request_${'r'.repeat(32)}`,
    rendezvousId: `srv_${'s'.repeat(32)}`,
    rendezvousCapability: 'C'.repeat(43),
    hostTransportFingerprint: 'H'.repeat(43),
    transportPublicKeySpki: relayPublicKeySpkiFromCertificate(
      identity.certificatePem,
    ),
    transportFingerprint: 'D'.repeat(43),
    clientBuildIdentity: 'test-build',
    signature: 'S'.repeat(86),
  }
  assert.equal(
    RelaySupervisorAuthenticateMessageSchema.safeParse(supervisor).success,
    true,
  )
  assert.equal(RelayClientMessageSchema.safeParse(supervisor).success, false)
})

test('Relay does not weaken Host identity or ProductDevice replay checks', async () => {
  const fixture = await createFixture()
  try {
    await assert.rejects(
      connectThroughRelay(fixture, 'identity-proof', {
        hostFingerprint: `sha256:${'Z'.repeat(43)}`,
      }),
      (error) =>
        error instanceof SupervisorClientError &&
        error.code === 'host_identity_mismatch',
    )
    const first = await connectThroughRelay(fixture, 'replayed-proof')
    first.close()
    await new Promise((resolve) => setTimeout(resolve, 50))
    await assert.rejects(
      connectThroughRelay(fixture, 'replayed-proof'),
      (error) =>
        error instanceof SupervisorClientError &&
        error.code === 'proof_replayed',
    )
    for (const [proof, code] of [
      ['revoked-device-proof', 'authorization_revoked'],
      ['revoked-authorization-proof', 'authorization_revoked'],
      ['expired-proof', 'proof_expired'],
    ]) {
      await assert.rejects(
        connectThroughRelay(fixture, proof),
        (error) =>
          error instanceof SupervisorClientError && error.code === code,
      )
    }
  } finally {
    await fixture.close()
  }
})

test('Relay disconnect terminates the owned session and a fresh connection can authenticate', async () => {
  const fixture = await createFixture()
  try {
    const interrupted = await connectThroughRelay(
      fixture,
      'disconnect-session-proof',
    )
    fixture.disconnectHost()
    await assert.rejects(interrupted.listMachines())
    await fixture.reconnectHost()
    const reconnected = await connectThroughRelay(
      fixture,
      'fresh-reconnect-proof',
    )
    assert.deepEqual(await reconnected.listMachines(), {
      machines: [{ machineId: `machine_${'m'.repeat(32)}` }],
    })
    reconnected.close()
  } finally {
    await fixture.close()
  }
})

test('one Host Relay registration carries two independent ProductDevice sessions', async () => {
  const fixture = await createFixture()
  try {
    const secondGrantPayload = {
      ...fixture.grant.payload,
      authorizationId: `hauth_${'b'.repeat(32)}`,
      deviceId: `dev_${'e'.repeat(32)}`,
      deviceFingerprint: `sha256:${'E'.repeat(43)}`,
      authorizationSerial: '2',
    }
    const secondGrant = {
      payload: secondGrantPayload,
      proof: compactSign(
        fixture.hostPrivateKey,
        supervisorGrantProofType,
        secondGrantPayload,
      ),
    }
    const transport = fixture.descriptor.payload
    const hostPresencePayload = {
      v: transport.v,
      aud: transport.aud,
      purpose: 'host_supervisor_presence',
      hostId: transport.hostId,
      hostFingerprint: transport.hostFingerprint,
      hostIdentityGeneration: transport.hostIdentityGeneration,
      spaceId: ids.spaceId,
      transportTlsFingerprint: transport.transportTlsFingerprint,
      controlPlaneOrigin: transport.controlPlaneOrigin,
      directEndpoints: transport.directEndpoints,
      relay: transport.relay,
      iat: transport.iat,
      exp: transport.exp,
      protocolVersion: 2,
    }
    const hostPresence = {
      payload: hostPresencePayload,
      proof: compactSign(
        fixture.hostPrivateKey,
        supervisorDescriptorProofType,
        hostPresencePayload,
      ),
    }
    await fixture.supervisor.activate({
      hostPublicJwk: fixture.publicJwk,
      grant: fixture.grant,
      descriptor: hostPresence,
    })
    await fixture.supervisor.activate({
      hostPublicJwk: fixture.publicJwk,
      grant: secondGrant,
      descriptor: hostPresence,
    })
    assert.equal(fixture.supervisor.activationCount, 2)
    const active = await connectThroughRelay(fixture, 'active-session-proof', {
      descriptor: hostPresence,
    })
    const second = await connectThroughRelay(
      fixture,
      'overlapping-session-proof',
      {
        deviceId: secondGrantPayload.deviceId,
        grant: secondGrant,
        descriptor: hostPresence,
      },
    )
    assert.deepEqual(await active.readHostBootstrap(), {
      hostId: ids.hostId,
      transportAuthority: 'host',
    })
    assert.deepEqual(await second.readHostBootstrap(), {
      hostId: ids.hostId,
      transportAuthority: 'host',
    })
    second.close()
    assert.deepEqual(await active.listMachines(), {
      machines: [{ machineId: `machine_${'m'.repeat(32)}` }],
    })
    assert.equal(
      fixture.logs.some((entry) => entry.event === 'host.control.failed'),
      false,
    )

    fixture.supervisor.deactivate(secondGrantPayload.authorizationId)
    assert.equal(fixture.supervisor.activationCount, 1)
    assert.deepEqual(await active.getMachine(`machine_${'m'.repeat(32)}`), {
      providers: ['codex', 'claude-code'],
    })
    active.close()
  } finally {
    await fixture.close()
  }
})

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'codetether-supervisor-relay-'))
  const store = new RelayStateStore(join(root, 'state'))
  const relayTls = await generateRelayPinnedTlsIdentity(store.identity)
  const logs = []
  const relay = new RelayService({
    stateStore: store,
    tls: relayTls,
    host: '127.0.0.1',
    port: 0,
    managementHost: '127.0.0.1',
    managementPort: 0,
    heartbeatIntervalMs: 500,
    heartbeatTimeoutMs: 2_000,
    logger: { log: (event, fields = {}) => logs.push({ event, ...fields }) },
  })
  await relay.start()

  const usedProofs = new Set()
  const supervisor = await SupervisorServer.create({
    host: '127.0.0.1',
    port: 0,
    authorize: async ({ challenge, deviceProof }) => {
      if (
        deviceProof === 'revoked-device-proof' ||
        deviceProof === 'revoked-authorization-proof'
      ) {
        throw new Error('authorization_revoked')
      }
      if (deviceProof === 'expired-proof') throw new Error('proof_expired')
      if (usedProofs.has(deviceProof)) throw new Error('proof_replayed')
      usedProofs.add(deviceProof)
      return {
        hostId: challenge.hostId,
        hostIdentityGeneration: challenge.hostIdentityGeneration,
        deviceId: challenge.deviceId,
        deviceKeyGeneration: challenge.deviceKeyGeneration,
        authorizationId: challenge.authorizationId,
        authorizationExpiresAt: new Date(
          Date.now() + 60 * 60_000,
        ).toISOString(),
      }
    },
    reads: {
      readHostBootstrap: () => ({
        hostId: ids.hostId,
        transportAuthority: 'host',
      }),
      listMachines: () => ({
        machines: [{ machineId: `machine_${'m'.repeat(32)}` }],
      }),
      getMachine: () => ({ providers: ['codex', 'claude-code'] }),
      readConversationHistory: () => ({
        entries: 20,
        historyComplete: false,
      }),
      readConversationLive: () => terminalLivePage(),
    },
  })
  await supervisor.start()

  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  })
  const publicJwk = publicKey.export({ format: 'jwk' })
  const now = Math.floor(Date.now() / 1_000)
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
    issuedAt: now,
    expiresAt: now + 3_600,
  }
  const grant = {
    payload: grantPayload,
    proof: compactSign(privateKey, supervisorGrantProofType, grantPayload),
  }
  const rendezvousId = `srv_${'s'.repeat(32)}`
  const rendezvousCapability = 'C'.repeat(43)
  const relayEndpoint = {
    endpoint: { host: '127.0.0.1', port: relay.listeningAddress.port },
    tls: {
      mode: 'pinned_certificate',
      certificatePublicKeyFingerprint: relay.relayFingerprint,
    },
    expectedRelayId: relay.relayId,
    expectedRelayFingerprint: relay.relayFingerprint,
    rendezvousId,
    rendezvousCapability,
    hostTransportFingerprint: supervisor.tlsIdentity.publicKeyFingerprint,
    clientBuildIdentity: 'test-build',
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
    transportTlsFingerprint: supervisor.tlsIdentity.publicKeyFingerprint,
    controlPlaneOrigin: 'https://control-plane.example.test',
    directEndpoints: [],
    relay: {
      endpoint: `tls+pinned://127.0.0.1:${String(relay.listeningAddress.port)}`,
      relayId: relay.relayId,
      relayFingerprint: relay.relayFingerprint,
      rendezvousId,
      rendezvousCapability,
      hostTransportFingerprint: supervisor.tlsIdentity.publicKeyFingerprint,
    },
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
  await supervisor.activate({ hostPublicJwk: publicJwk, grant, descriptor })
  let host
  const connectHost = async () => {
    host = await connectSupervisorRelayHost({
      ...relayEndpoint,
      identity: supervisor.tlsIdentity,
    })
    void host.completion.catch((error) => {
      logs.push({
        event: 'host.control.failed',
        code:
          error instanceof Error && 'code' in error ? error.code : 'unknown',
      })
    })
    host.setChannelHandler(async (offer) => {
      const stream = await offer.accept()
      void supervisor.acceptRelayStream(stream).catch(() => stream.destroy())
    })
  }
  await connectHost()
  return {
    root,
    relay,
    supervisor,
    host,
    logs,
    publicJwk,
    hostPrivateKey: privateKey,
    grant,
    descriptor,
    relayEndpoint,
    disconnectHost() {
      host.close()
    },
    async reconnectHost() {
      await connectHost()
    },
    async close() {
      host.close()
      await supervisor.close()
      await relay.close()
      await rm(root, { recursive: true, force: true })
    },
  }
}

async function connectThroughRelay(fixture, deviceProof, overrides = {}) {
  const identity = await generateSupervisorTlsIdentity(
    'CodeTether Supervisor Device',
  )
  const device = await connectSupervisorRelayDevice({
    ...fixture.relayEndpoint,
    identity,
  })
  const stream = await device.openDeviceChannel(AbortSignal.timeout(2_000))
  const pending = await connectSupervisorRelayOverStream({
    stream,
    tlsIdentity: identity,
    expectedHost: {
      hostId: ids.hostId,
      fingerprint:
        overrides.hostFingerprint ?? fixture.grant.payload.hostFingerprint,
      identityGeneration: 1,
      publicJwk: fixture.publicJwk,
    },
    expectedDevice: {
      deviceId: overrides.deviceId ?? ids.deviceId,
      keyGeneration: 1,
    },
    grant: overrides.grant ?? fixture.grant,
    descriptor: overrides.descriptor ?? fixture.descriptor,
    onClose: () => device.close(),
  })
  try {
    return await pending.authenticate({
      accessToken: 'test-access-token',
      deviceProof,
    })
  } catch (error) {
    pending.close()
    throw error
  }
}

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
