import assert from 'node:assert/strict'
import { CompactSign, exportJWK, generateKeyPair } from 'jose'
import { after, before, test } from 'node:test'

import {
  AccountFoundationService,
  ControlPlaneRepository,
  HOST_DEVICE_AUTHORIZATION_PROOF_TYPE,
  PRODUCT_DEVICE_AUDIENCE,
  PRODUCT_DEVICE_PROOF_TYPE,
  ProductDeviceAuthenticationService,
  HostIdentityService,
  admitHostPublicJwk,
  admitProductDevicePublicJwk,
  canonicalizeDeviceRequestResource,
  encodeDeviceRequestProofPayload,
  encodeHostDeviceAuthorizationPayload,
  runMigrations,
  sha256Digest,
  startControlPlaneServer,
} from '../dist/index.js'
import { accountInput, id } from './fixtures.mjs'
import { PGliteControlPlaneDatabase } from './pglite-database.mjs'

const now = new Date('2026-10-01T12:00:00.000Z')
let clock = now
let database
let fixture

before(async () => {
  database = await PGliteControlPlaneDatabase.create()
  await runMigrations(database)
  const account = accountInput('phase10a', now)
  await new AccountFoundationService(database).createUserWithPersonalSpace(
    account,
  )
  const createDevice = async (suffix, label, platform) => {
    const keys = await generateKeyPair('ES256')
    const admitted = await admitProductDevicePublicJwk(
      await exportJWK(keys.publicKey),
    )
    const device = {
      deviceId: id('dev', `phase10a-${suffix}`),
      ownerUserId: account.userId,
      deviceType: suffix === 'windows' ? 'desktop_host' : 'desktop_client',
      publicKey: admitted.canonicalPublicJwk,
      keyAlgorithm: 'ES256',
      fingerprint: admitted.fingerprint,
      label,
      platform,
      appVersion: '10.0.0-test',
      protocolVersion: 1,
      keyGeneration: 1,
      createdAt: now,
    }
    await new ControlPlaneRepository(database).createProductDevice(device)
    return { device, keys }
  }
  const mac = await createDevice('mac', 'Mac', 'macOS-arm64')
  const windows = await createDevice('windows', 'Windows', 'windows-x64')
  const hostKeys = await generateKeyPair('ES256')
  const admittedHost = await admitHostPublicJwk(
    await exportJWK(hostKeys.publicKey),
  )
  const host = {
    hostId: id('host', 'phase10a-host'),
    owningSpaceId: account.spaceId,
    publicKey: admittedHost.canonicalPublicJwk,
    keyAlgorithm: 'ES256',
    fingerprint: admittedHost.fingerprint,
    safeLabel: 'Windows-PC',
    coarsePlatform: 'windows',
    protocolVersionMin: 1,
    protocolVersionMax: 1,
    claimGeneration: 1,
    claimState: 'claimed',
    createdAt: now,
  }
  await new ControlPlaneRepository(database).createHost(host)
  fixture = {
    account,
    mac,
    windows,
    host,
    hostKeys,
    macContext: {
      userId: account.userId,
      deviceId: mac.device.deviceId,
      deviceType: mac.device.deviceType,
      keyGeneration: 1,
    },
    windowsContext: {
      userId: account.userId,
      deviceId: windows.device.deviceId,
      deviceType: windows.device.deviceType,
      keyGeneration: 1,
    },
    human: {
      userId: account.userId,
      status: 'active',
      personalSpaceId: account.spaceId,
      authTokenHash: 'sha256:phase10a-token',
    },
  }
})

after(async () => database.close())

async function request() {
  return new HostIdentityService(database, () => clock).requestHostAccess(
    fixture.human,
    fixture.macContext,
    fixture.host.hostId,
    {
      spaceId: fixture.account.spaceId,
      hostFingerprint: fixture.host.fingerprint,
      hostIdentityGeneration: fixture.host.claimGeneration,
      scope: 'supervisor_read',
    },
  )
}

async function createAdditionalHost(suffix, label = suffix) {
  const keys = await generateKeyPair('ES256')
  const admitted = await admitHostPublicJwk(await exportJWK(keys.publicKey))
  const host = {
    ...fixture.host,
    hostId: id('host', `phase10a-${suffix}`),
    publicKey: admitted.canonicalPublicJwk,
    fingerprint: admitted.fingerprint,
    safeLabel: label,
  }
  await new ControlPlaneRepository(database).createHost(host)
  return { host, keys }
}

test('owned Host is visible as requestable but not in authorized directory', async () => {
  const service = new HostIdentityService(database, () => now)
  const owned = await service.listOwnedHostAccess(
    fixture.human,
    fixture.macContext,
  )
  assert.equal(owned.hosts.length, 1)
  assert.equal(owned.hosts[0].access.state, 'none')
  const directory = await service.listAuthorizedHostDirectory(
    fixture.human,
    fixture.macContext,
  )
  assert.equal(directory.hosts.length, 0)
})

test('duplicate Mac requests are idempotent and Windows sees the pending request', async () => {
  const first = await request()
  const second = await request()
  assert.equal(first.status, 'pending')
  assert.equal(second.status, 'pending')
  assert.equal(first.request.requestId, second.request.requestId)
  const pending = await new HostIdentityService(
    database,
    () => now,
  ).listPendingHostAccessRequests(fixture.human, fixture.windowsContext)
  assert.equal(pending.requests.length, 1)
  assert.equal(pending.requests[0].requestId, first.request.requestId)
  assert.deepEqual(pending.requests[0].requestingDevice, {
    deviceId: fixture.mac.device.deviceId,
    label: fixture.mac.device.label,
    platform: fixture.mac.device.platform,
    fingerprint: fixture.mac.device.fingerprint,
    keyGeneration: fixture.mac.device.keyGeneration,
  })
  assert.notEqual(
    pending.requests[0].requestingDevice.fingerprint,
    fixture.windows.device.fingerprint,
  )
})

test('Windows Host signature approval creates one normal authorization and replay is idempotent', async () => {
  const service = new HostIdentityService(database, () => now)
  const requested = await request()
  const payload = requested.request.payload
  const proof = await new CompactSign(
    Buffer.from(encodeHostDeviceAuthorizationPayload(payload)),
  )
    .setProtectedHeader({
      alg: 'ES256',
      typ: HOST_DEVICE_AUTHORIZATION_PROOF_TYPE,
    })
    .sign(fixture.hostKeys.privateKey)
  const approved = await service.approveHostAccessRequest(
    fixture.human,
    fixture.windowsContext,
    requested.request.requestId,
    { payload, proof },
  )
  assert.equal(approved.result, 'authorized')
  const replay = await service.approveHostAccessRequest(
    fixture.human,
    fixture.windowsContext,
    requested.request.requestId,
    { payload, proof },
  )
  assert.equal(replay.result, 'already_authorized')
  const directory = await service.listAuthorizedHostDirectory(
    fixture.human,
    fixture.macContext,
  )
  assert.equal(directory.hosts.length, 1)
  assert.equal(
    directory.hosts[0].authorization.authorizationId,
    approved.authorization.authorizationId,
  )
  const counts = await database.query(
    `SELECT count(*)::int AS count FROM control_plane.host_device_authorizations WHERE host_id=$1 AND device_id=$2`,
    [fixture.host.hostId, fixture.mac.device.deviceId],
  )
  assert.equal(counts.rows[0].count, 1)
})

test('Mac can cancel a pending request and cancelled requests cannot be approved', async () => {
  const { host: secondHost, keys: secondHostKeys } = await createAdditionalHost(
    'cancel',
    'Cancel Host',
  )
  const service = new HostIdentityService(database, () => now)
  const requested = await service.requestHostAccess(
    fixture.human,
    fixture.macContext,
    secondHost.hostId,
    {
      spaceId: fixture.account.spaceId,
      hostFingerprint: secondHost.fingerprint,
      hostIdentityGeneration: secondHost.claimGeneration,
      scope: 'supervisor_read',
    },
  )
  const cancelled = await service.cancelHostAccessRequest(
    fixture.human,
    fixture.macContext,
    requested.request.requestId,
  )
  assert.equal(cancelled.status, 'cancelled')
  const proof = await new CompactSign(
    Buffer.from(
      encodeHostDeviceAuthorizationPayload(requested.request.payload),
    ),
  )
    .setProtectedHeader({
      alg: 'ES256',
      typ: HOST_DEVICE_AUTHORIZATION_PROOF_TYPE,
    })
    .sign(secondHostKeys.privateKey)
  await assert.rejects(
    service.approveHostAccessRequest(
      fixture.human,
      fixture.windowsContext,
      requested.request.requestId,
      { payload: requested.request.payload, proof },
    ),
    (error) => error.code === 'host_access_request_not_pending',
  )
})

test('requested scope is fixed to supervisor_read', async () => {
  await assert.rejects(
    new HostIdentityService(database, () => clock).requestHostAccess(
      fixture.human,
      fixture.macContext,
      fixture.host.hostId,
      {
        spaceId: fixture.account.spaceId,
        hostFingerprint: fixture.host.fingerprint,
        hostIdentityGeneration: fixture.host.claimGeneration,
        scope: 'supervisor_control',
      },
    ),
  )
})

test('bad Host signature never creates authorization', async () => {
  const { host, keys } = await createAdditionalHost(
    'bad-signature',
    'Bad Signature Host',
  )
  const requested = await new HostIdentityService(
    database,
    () => clock,
  ).requestHostAccess(fixture.human, fixture.macContext, host.hostId, {
    spaceId: fixture.account.spaceId,
    hostFingerprint: host.fingerprint,
    hostIdentityGeneration: host.claimGeneration,
    scope: 'supervisor_read',
  })
  const otherKeys = await generateKeyPair('ES256')
  const proof = await new CompactSign(
    Buffer.from(
      encodeHostDeviceAuthorizationPayload(requested.request.payload),
    ),
  )
    .setProtectedHeader({
      alg: 'ES256',
      typ: HOST_DEVICE_AUTHORIZATION_PROOF_TYPE,
    })
    .sign(otherKeys.privateKey)
  await assert.rejects(
    new HostIdentityService(database, () => clock).approveHostAccessRequest(
      fixture.human,
      fixture.windowsContext,
      requested.request.requestId,
      { payload: requested.request.payload, proof },
    ),
    (error) => error.code === 'host_access_request_signature_invalid',
  )
  const count = await database.query(
    `SELECT count(*)::int AS count FROM control_plane.host_device_authorizations WHERE host_id=$1`,
    [host.hostId],
  )
  assert.equal(count.rows[0].count, 0)
  void keys
})

test('denied and expired requests cannot be approved', async () => {
  const deniedHost = await createAdditionalHost('denied', 'Denied Host')
  const denied = await new HostIdentityService(
    database,
    () => clock,
  ).requestHostAccess(
    fixture.human,
    fixture.macContext,
    deniedHost.host.hostId,
    {
      spaceId: fixture.account.spaceId,
      hostFingerprint: deniedHost.host.fingerprint,
      hostIdentityGeneration: deniedHost.host.claimGeneration,
      scope: 'supervisor_read',
    },
  )
  await new HostIdentityService(database, () => clock).denyHostAccessRequest(
    fixture.human,
    fixture.windowsContext,
    denied.request.requestId,
  )
  const deniedProof = await new CompactSign(
    Buffer.from(encodeHostDeviceAuthorizationPayload(denied.request.payload)),
  )
    .setProtectedHeader({
      alg: 'ES256',
      typ: HOST_DEVICE_AUTHORIZATION_PROOF_TYPE,
    })
    .sign(deniedHost.keys.privateKey)
  await assert.rejects(
    new HostIdentityService(database, () => clock).approveHostAccessRequest(
      fixture.human,
      fixture.windowsContext,
      denied.request.requestId,
      { payload: denied.request.payload, proof: deniedProof },
    ),
    (error) => error.code === 'host_access_request_not_pending',
  )

  const expiredHost = await createAdditionalHost('expired', 'Expired Host')
  const expired = await new HostIdentityService(
    database,
    () => clock,
  ).requestHostAccess(
    fixture.human,
    fixture.macContext,
    expiredHost.host.hostId,
    {
      spaceId: fixture.account.spaceId,
      hostFingerprint: expiredHost.host.fingerprint,
      hostIdentityGeneration: expiredHost.host.claimGeneration,
      scope: 'supervisor_read',
    },
  )
  clock = new Date(now.getTime() + 31 * 60 * 1000)
  const expiredProof = await new CompactSign(
    Buffer.from(encodeHostDeviceAuthorizationPayload(expired.request.payload)),
  )
    .setProtectedHeader({
      alg: 'ES256',
      typ: HOST_DEVICE_AUTHORIZATION_PROOF_TYPE,
    })
    .sign(expiredHost.keys.privateKey)
  await assert.rejects(
    new HostIdentityService(database, () => clock).approveHostAccessRequest(
      fixture.human,
      fixture.windowsContext,
      expired.request.requestId,
      { payload: expired.request.payload, proof: expiredProof },
    ),
    (error) => error.code === 'host_access_request_expired',
  )
  clock = now
})

test('HTTP access-request routes require both human and ProductDevice proofs', async () => {
  const accessToken = 'phase10a-http-token'
  const authTokenHash = sha256Digest(accessToken)
  let nonce = 0
  const deviceService = new ProductDeviceAuthenticationService(
    database,
    () => clock,
  )
  const accountService = {
    async verifyAndResolveRequestContext(_verifier, token) {
      assert.equal(token, accessToken)
      return { ...fixture.human, authTokenHash }
    },
  }
  const running = await startControlPlaneServer({
    database,
    humanAuthVerifier: {},
    authenticatedAccountService: accountService,
    productDeviceAuthenticationService: deviceService,
    hostIdentityService: new HostIdentityService(database, () => clock),
    host: '127.0.0.1',
    port: 0,
  })
  const origin = `http://127.0.0.1:${running.address.port}`
  const resource = `/v1/hosts/${fixture.host.hostId}/access-request`
  const body = {
    spaceId: fixture.account.spaceId,
    hostFingerprint: fixture.host.fingerprint,
    hostIdentityGeneration: fixture.host.claimGeneration,
    scope: 'supervisor_read',
  }
  async function signedCall(method, path, value = undefined) {
    const bodyBytes =
      value === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(value))
    nonce += 1
    const proofPayload = {
      v: 1,
      aud: PRODUCT_DEVICE_AUDIENCE,
      authTokenHash,
      deviceId: fixture.mac.device.deviceId,
      keyGeneration: fixture.mac.device.keyGeneration,
      method,
      resource: canonicalizeDeviceRequestResource(path),
      bodySha256: sha256Digest(bodyBytes),
      nonce: Buffer.alloc(16, nonce).toString('base64url'),
      iat: Math.floor(clock.getTime() / 1_000),
      protocolVersion: 1,
    }
    const proof = await new CompactSign(
      encodeDeviceRequestProofPayload(proofPayload),
    )
      .setProtectedHeader({ alg: 'ES256', typ: PRODUCT_DEVICE_PROOF_TYPE })
      .sign(fixture.mac.keys.privateKey)
    return fetch(`${origin}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        'x-codetether-device-proof': proof,
      },
      body: method === 'GET' ? undefined : bodyBytes,
    })
  }
  try {
    const unauthenticated = await fetch(`${origin}${resource}`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    assert.equal(unauthenticated.status, 401)

    const missingProof = await fetch(`${origin}${resource}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    assert.equal(missingProof.status, 401)

    const invalidScope = await signedCall('POST', resource, {
      ...body,
      scope: 'supervisor_control',
    })
    assert.equal(invalidScope.status, 400)
    assert.deepEqual(await invalidScope.json(), { status: 'invalid_request' })

    const presentationHost = await createAdditionalHost('http-presentation')
    const presentationResource = `/v1/hosts/${presentationHost.host.hostId}/access-request`
    const created = await signedCall('POST', presentationResource, {
      ...body,
      hostFingerprint: presentationHost.host.fingerprint,
    })
    assert.equal(created.ok, true)
    const createdBody = await created.json()
    const pendingResponse = await signedCall(
      'GET',
      '/v1/hosts/access-requests/pending',
    )
    assert.equal(pendingResponse.status, 200)
    const pendingBody = await pendingResponse.json()
    const exactRequest = pendingBody.requests.find(
      (request) => request.requestId === createdBody.request.requestId,
    )
    assert.equal(exactRequest.deviceId, fixture.mac.device.deviceId)
    assert.equal(exactRequest.scope, 'supervisor_read')
    assert.deepEqual(exactRequest.requestingDevice, {
      deviceId: fixture.mac.device.deviceId,
      label: fixture.mac.device.label,
      platform: fixture.mac.device.platform,
      fingerprint: fixture.mac.device.fingerprint,
      keyGeneration: fixture.mac.device.keyGeneration,
    })
  } finally {
    await running.close()
  }
})
