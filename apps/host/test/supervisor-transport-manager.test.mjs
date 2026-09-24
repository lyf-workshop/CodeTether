import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import test from 'node:test'

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
  const reads = { machines: 0, detail: 0 }
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
  } finally {
    globalThis.fetch = originalFetch
    await manager.close()
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
