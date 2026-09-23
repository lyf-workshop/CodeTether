import assert from 'node:assert/strict'
import { CompactSign, exportJWK, generateKeyPair } from 'jose'
import { after, before, test } from 'node:test'

import {
  AccountFoundationService,
  ControlPlaneRepository,
  HOST_DEVICE_AUTHORIZATION_PROOF_TYPE,
  HostIdentityFailure,
  HostIdentityService,
  PRODUCT_DEVICE_AUDIENCE,
  PRODUCT_DEVICE_PROOF_TYPE,
  ProductDeviceAuthenticationService,
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

const now = new Date('2026-09-23T12:00:00.000Z')

let database
let foundation

before(async () => {
  database = await PGliteControlPlaneDatabase.create()
  await runMigrations(database)
  foundation = new AccountFoundationService(database)
})

after(async () => {
  await database.close()
})

async function createFixture(value) {
  const account = accountInput(value, now)
  await foundation.createUserWithPersonalSpace(account)

  const deviceKeys = await generateKeyPair('ES256')
  const admittedDevice = await admitProductDevicePublicJwk(
    await exportJWK(deviceKeys.publicKey),
  )
  const device = {
    deviceId: id('dev', `${value}device`),
    ownerUserId: account.userId,
    deviceType: 'desktop_client',
    publicKey: admittedDevice.canonicalPublicJwk,
    keyAlgorithm: 'ES256',
    fingerprint: admittedDevice.fingerprint,
    label: `Device ${value}`,
    platform: 'windows',
    appVersion: '9.0.0-test',
    protocolVersion: 1,
    keyGeneration: 1,
    createdAt: now,
  }
  await new ControlPlaneRepository(database).createProductDevice(device)

  const hostKeys = await generateKeyPair('ES256')
  const admittedHost = await admitHostPublicJwk(
    await exportJWK(hostKeys.publicKey),
  )
  const host = {
    hostId: id('host', `${value}host`),
    owningSpaceId: account.spaceId,
    publicKey: admittedHost.canonicalPublicJwk,
    keyAlgorithm: 'ES256',
    fingerprint: admittedHost.fingerprint,
    safeLabel: `Host ${value}`,
    coarsePlatform: 'windows',
    protocolVersionMin: 1,
    protocolVersionMax: 1,
    claimGeneration: 1,
    claimState: 'claimed',
    createdAt: now,
  }
  await new ControlPlaneRepository(database).createHost(host)

  return {
    account,
    device,
    deviceKeys,
    host,
    hostKeys,
    human: {
      userId: account.userId,
      status: 'active',
      personalSpaceId: account.spaceId,
      authTokenHash: `sha256:${value.padEnd(48, 'x')}`,
    },
    deviceContext: {
      userId: account.userId,
      deviceId: device.deviceId,
      deviceType: device.deviceType,
      keyGeneration: device.keyGeneration,
    },
  }
}

async function requestAuthorization(service, fixture) {
  return service.requestDeviceAuthorization(
    fixture.human,
    fixture.deviceContext,
    fixture.host.hostId,
    {
      spaceId: fixture.account.spaceId,
      hostFingerprint: fixture.host.fingerprint,
      hostIdentityGeneration: fixture.host.claimGeneration,
    },
  )
}

async function signAuthorization(request, privateKey) {
  assert.equal(request.status, 'confirmation_required')
  return new CompactSign(
    Buffer.from(encodeHostDeviceAuthorizationPayload(request.payload)),
  )
    .setProtectedHeader({
      alg: 'ES256',
      typ: HOST_DEVICE_AUTHORIZATION_PROOF_TYPE,
    })
    .sign(privateKey)
}

async function confirmAuthorization(service, fixture, request) {
  return service.confirmDeviceAuthorization(
    fixture.human,
    fixture.deviceContext,
    fixture.host.hostId,
    {
      payload: request.payload,
      proof: await signAuthorization(request, fixture.hostKeys.privateKey),
    },
  )
}

async function expectHostFailure(promise, code) {
  await assert.rejects(
    promise,
    (error) => error instanceof HostIdentityFailure && error.code === code,
  )
}

test('owned Host requires explicit confirmation and grants one authorization', async () => {
  const fixture = await createFixture('authorization-success')
  const service = new HostIdentityService(database, () => now)

  await expectHostFailure(
    service.authorizeHostRequest(
      fixture.human,
      fixture.deviceContext,
      fixture.host.hostId,
    ),
    'host_device_authorization_required',
  )
  const request = await requestAuthorization(service, fixture)
  assert.equal(request.status, 'confirmation_required')

  const confirmation = await confirmAuthorization(service, fixture, request)
  assert.equal(confirmation.result, 'authorized')
  assert.equal(confirmation.authorization.state, 'authorized')
  assert.equal(confirmation.authorization.hostId, fixture.host.hostId)
  assert.equal(confirmation.authorization.deviceId, fixture.device.deviceId)

  const authorized = await service.authorizeHostRequest(
    fixture.human,
    fixture.deviceContext,
    fixture.host.hostId,
  )
  assert.equal(authorized.authorizationId, request.payload.authorizationId)
  assert.equal(
    (
      await service.readDeviceAuthorization(
        fixture.human,
        fixture.deviceContext,
        fixture.host.hostId,
      )
    ).state,
    'authorized',
  )

  const repeated = await confirmAuthorization(service, fixture, request)
  assert.equal(repeated.result, 'already_authorized')
  assert.equal(
    repeated.authorization.authorizationId,
    confirmation.authorization.authorizationId,
  )
  const duplicateRequest = await requestAuthorization(service, fixture)
  assert.equal(duplicateRequest.status, 'authorized')
  assert.equal(
    duplicateRequest.authorization.authorizationId,
    confirmation.authorization.authorizationId,
  )

  const counts = await database.query(
    `SELECT
       (SELECT count(*)::int FROM control_plane.host_device_authorizations
         WHERE host_id=$1 AND device_id=$2) AS authorizations,
       (SELECT count(*)::int FROM control_plane.security_events
         WHERE event_type='supervisor_authorized' AND target_id=$3) AS events,
       (SELECT count(*)::int FROM control_plane.relay_rendezvous_bindings
         WHERE host_id=$1 OR device_id=$2) AS relay_bindings`,
    [
      fixture.host.hostId,
      fixture.device.deviceId,
      confirmation.authorization.authorizationId,
    ],
  )
  assert.deepEqual(counts.rows[0], {
    authorizations: 1,
    events: 1,
    relay_bindings: 0,
  })
})

test('invalid Host signature cannot create an authorization', async () => {
  const fixture = await createFixture('authorization-signature')
  const wrongKeys = await generateKeyPair('ES256')
  const service = new HostIdentityService(database, () => now)
  const request = await requestAuthorization(service, fixture)

  await expectHostFailure(
    service.confirmDeviceAuthorization(
      fixture.human,
      fixture.deviceContext,
      fixture.host.hostId,
      {
        payload: request.payload,
        proof: await signAuthorization(request, wrongKeys.privateKey),
      },
    ),
    'host_device_authorization_signature_invalid',
  )
  const count = await database.query(
    `SELECT count(*)::int AS count
       FROM control_plane.host_device_authorizations WHERE host_id=$1`,
    [fixture.host.hostId],
  )
  assert.equal(count.rows[0].count, 0)
})

test('wrong User, ProductDevice, Host, and unowned Host fail closed', async () => {
  const owner = await createFixture('authorization-owner')
  const other = await createFixture('authorization-other')
  const service = new HostIdentityService(database, () => now)

  await expectHostFailure(
    service.requestDeviceAuthorization(
      other.human,
      other.deviceContext,
      owner.host.hostId,
      {
        spaceId: other.account.spaceId,
        hostFingerprint: owner.host.fingerprint,
        hostIdentityGeneration: owner.host.claimGeneration,
      },
    ),
    'host_device_authorization_host_mismatch',
  )
  await expectHostFailure(
    service.requestDeviceAuthorization(
      owner.human,
      other.deviceContext,
      owner.host.hostId,
      {
        spaceId: owner.account.spaceId,
        hostFingerprint: owner.host.fingerprint,
        hostIdentityGeneration: owner.host.claimGeneration,
      },
    ),
    'host_device_authorization_owner_mismatch',
  )
  await expectHostFailure(
    service.requestDeviceAuthorization(
      owner.human,
      owner.deviceContext,
      id('host', 'missing-authorization-host'),
      {
        spaceId: owner.account.spaceId,
        hostFingerprint: owner.host.fingerprint,
        hostIdentityGeneration: owner.host.claimGeneration,
      },
    ),
    'host_device_authorization_host_mismatch',
  )

  const unownedKeys = await generateKeyPair('ES256')
  const unownedIdentity = await admitHostPublicJwk(
    await exportJWK(unownedKeys.publicKey),
  )
  const unownedHost = {
    ...owner.host,
    hostId: id('host', 'unowned-authorization-host'),
    owningSpaceId: null,
    publicKey: unownedIdentity.canonicalPublicJwk,
    fingerprint: unownedIdentity.fingerprint,
    claimState: 'unclaimed',
  }
  await new ControlPlaneRepository(database).createHost(unownedHost)
  await expectHostFailure(
    service.requestDeviceAuthorization(
      owner.human,
      owner.deviceContext,
      unownedHost.hostId,
      {
        spaceId: owner.account.spaceId,
        hostFingerprint: unownedHost.fingerprint,
        hostIdentityGeneration: unownedHost.claimGeneration,
      },
    ),
    'host_device_authorization_host_mismatch',
  )
})

test('authorization and ProductDevice revocation independently deny access', async () => {
  const fixture = await createFixture('authorization-revoke')
  const service = new HostIdentityService(database, () => now)
  const request = await requestAuthorization(service, fixture)
  const confirmed = await confirmAuthorization(service, fixture, request)

  const revoked = await service.revokeDeviceAuthorization(
    fixture.human,
    fixture.deviceContext,
    fixture.host.hostId,
    { authorizationId: confirmed.authorization.authorizationId },
  )
  assert.equal(revoked.result, 'revoked')
  await expectHostFailure(
    service.authorizeHostRequest(
      fixture.human,
      fixture.deviceContext,
      fixture.host.hostId,
    ),
    'host_device_authorization_required',
  )
  const repeated = await service.revokeDeviceAuthorization(
    fixture.human,
    fixture.deviceContext,
    fixture.host.hostId,
    { authorizationId: confirmed.authorization.authorizationId },
  )
  assert.equal(repeated.result, 'already_revoked')

  const deviceFixture = await createFixture('authorization-device-revoke')
  const deviceRequest = await requestAuthorization(service, deviceFixture)
  await confirmAuthorization(service, deviceFixture, deviceRequest)
  await foundation.revokeProductDevice(deviceFixture.device.deviceId, now)
  await expectHostFailure(
    service.authorizeHostRequest(
      deviceFixture.human,
      deviceFixture.deviceContext,
      deviceFixture.host.hostId,
    ),
    'host_device_authorization_required',
  )
})

test('HTTP request, confirmation, access check, and revocation stay device-bound', async () => {
  const fixture = await createFixture('authorization-http')
  const accessToken = 'host-authorization-http-access-token'
  const authTokenHash = sha256Digest(accessToken)
  const human = { ...fixture.human, authTokenHash }
  const hostService = new HostIdentityService(database, () => now)
  const deviceService = new ProductDeviceAuthenticationService(
    database,
    () => now,
  )
  const accountService = {
    async verifyAndResolveRequestContext(_verifier, token) {
      assert.equal(token, accessToken)
      return human
    },
  }
  const running = await startControlPlaneServer({
    database,
    humanAuthVerifier: {},
    authenticatedAccountService: accountService,
    productDeviceAuthenticationService: deviceService,
    hostIdentityService: hostService,
    host: '127.0.0.1',
    port: 0,
  })
  let nonceCounter = 0
  const call = async (method, resource, value) => {
    const body = value === undefined ? '' : JSON.stringify(value)
    nonceCounter += 1
    const proofPayload = {
      v: 1,
      aud: PRODUCT_DEVICE_AUDIENCE,
      authTokenHash,
      deviceId: fixture.device.deviceId,
      keyGeneration: fixture.device.keyGeneration,
      method,
      resource: canonicalizeDeviceRequestResource(resource),
      bodySha256: sha256Digest(body),
      nonce: Buffer.alloc(16, nonceCounter).toString('base64url'),
      iat: Math.floor(now.getTime() / 1000),
      protocolVersion: 1,
    }
    const proof = await new CompactSign(
      Buffer.from(encodeDeviceRequestProofPayload(proofPayload)),
    )
      .setProtectedHeader({ alg: 'ES256', typ: PRODUCT_DEVICE_PROOF_TYPE })
      .sign(fixture.deviceKeys.privateKey)
    return fetch(`http://127.0.0.1:${running.address.port}${resource}`, {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
        'x-codetether-device-proof': proof,
      },
      ...(body ? { body } : {}),
    })
  }

  try {
    const requestResource = `/v1/hosts/${fixture.host.hostId}/device-authorization/request`
    const requestBody = {
      spaceId: fixture.account.spaceId,
      hostFingerprint: fixture.host.fingerprint,
      hostIdentityGeneration: fixture.host.claimGeneration,
    }
    const humanOnly = await fetch(
      `http://127.0.0.1:${running.address.port}${requestResource}`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      },
    )
    assert.equal(humanOnly.status, 401)
    assert.equal((await humanOnly.json()).code, 'device_auth_required')

    const requestedResponse = await call('POST', requestResource, requestBody)
    assert.equal(requestedResponse.status, 201)
    const requested = await requestedResponse.json()
    assert.equal(requested.status, 'confirmation_required')

    const hostProof = await new CompactSign(
      Buffer.from(encodeHostDeviceAuthorizationPayload(requested.payload)),
    )
      .setProtectedHeader({
        alg: 'ES256',
        typ: HOST_DEVICE_AUTHORIZATION_PROOF_TYPE,
      })
      .sign(fixture.hostKeys.privateKey)
    const confirmResource = `/v1/hosts/${fixture.host.hostId}/device-authorization/confirm`
    const confirmedResponse = await call('POST', confirmResource, {
      payload: requested.payload,
      proof: hostProof,
    })
    assert.equal(confirmedResponse.status, 200)
    const confirmed = await confirmedResponse.json()
    assert.equal(confirmed.result, 'authorized')

    const stateResource = `/v1/hosts/${fixture.host.hostId}/device-authorization`
    const stateResponse = await call('GET', stateResource)
    assert.equal(stateResponse.status, 200)
    assert.equal((await stateResponse.json()).state, 'authorized')

    const revokeResource = `/v1/hosts/${fixture.host.hostId}/device-authorization/revoke`
    const revokeResponse = await call('POST', revokeResource, {
      authorizationId: confirmed.authorization.authorizationId,
    })
    assert.equal(revokeResponse.status, 200)
    assert.equal((await revokeResponse.json()).result, 'revoked')

    const finalStateResponse = await call('GET', stateResource)
    assert.equal(finalStateResponse.status, 200)
    assert.equal((await finalStateResponse.json()).state, 'unauthorized')
  } finally {
    await running.close()
  }
})
