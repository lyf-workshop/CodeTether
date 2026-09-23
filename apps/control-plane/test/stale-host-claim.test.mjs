import assert from 'node:assert/strict'
import { CompactSign, exportJWK, generateKeyPair } from 'jose'
import { after, before, test } from 'node:test'

import {
  AccountFoundationService,
  AuthenticatedAccountService,
  HOST_CLAIM_PROOF_TYPE,
  HOST_REGISTRATION_PROOF_TYPE,
  HostIdentityFailure,
  HostIdentityService,
  PRODUCT_DEVICE_AUDIENCE,
  PRODUCT_DEVICE_PROOF_TYPE,
  PRODUCT_DEVICE_REGISTRATION_PROOF_TYPE,
  ProductDeviceAuthenticationService,
  canonicalizeDeviceRequestResource,
  encodeDeviceRequestProofPayload,
  encodeHostClaimConfirmationPayload,
  encodeHostRegistrationChallengePayload,
  encodeRegistrationChallengePayload,
  runMigrations,
  sha256Digest,
  startControlPlaneServer,
} from '../dist/index.js'
import { accountInput, deviceInput, id } from './fixtures.mjs'
import { PGliteControlPlaneDatabase } from './pglite-database.mjs'

const fixtureTime = new Date('2026-09-22T12:00:00.000Z')
const localPast = new Date('2000-01-01T00:00:00.000Z')
const localFuture = new Date('2099-01-01T00:00:00.000Z')
const ownerAccount = accountInput('staleclaimowner', fixtureTime)
const ownerDevice = deviceInput(ownerAccount, 'staleclaimowner', fixtureTime)
const otherAccount = accountInput('staleclaimother', fixtureTime)
const otherDevice = deviceInput(otherAccount, 'staleclaimother', fixtureTime)
const ownerHuman = {
  userId: ownerAccount.userId,
  status: 'active',
  personalSpaceId: ownerAccount.spaceId,
  authTokenHash: sha256Digest('stale-claim-owner-token'),
}
const ownerDeviceContext = {
  userId: ownerAccount.userId,
  deviceId: ownerDevice.deviceId,
  deviceType: ownerDevice.deviceType,
  keyGeneration: ownerDevice.keyGeneration,
}
const otherHuman = {
  userId: otherAccount.userId,
  status: 'active',
  personalSpaceId: otherAccount.spaceId,
  authTokenHash: sha256Digest('stale-claim-other-token'),
}
const otherDeviceContext = {
  userId: otherAccount.userId,
  deviceId: otherDevice.deviceId,
  deviceType: otherDevice.deviceType,
  keyGeneration: otherDevice.keyGeneration,
}

let database
let hostService
let fixtureCounter = 0

async function sign(payload, privateKey, type) {
  return new CompactSign(Buffer.from(payload))
    .setProtectedHeader({ alg: 'ES256', typ: type })
    .sign(privateKey)
}

async function registerHost(label) {
  fixtureCounter += 1
  const keyPair = await generateKeyPair('ES256')
  const registration = await hostService.createRegistrationChallenge({
    hostId: id('host', `staleclaim${label}${fixtureCounter}`),
    publicKey: await exportJWK(keyPair.publicKey),
    keyAlgorithm: 'ES256',
    safeLabel: `Stale claim ${label}`,
    coarsePlatform: 'windows',
    protocolVersionMin: 1,
    protocolVersionMax: 1,
  })
  const host = await hostService.registerHost({
    challenge: registration.challenge,
    proof: await sign(
      encodeHostRegistrationChallengePayload(registration.challenge),
      keyPair.privateKey,
      HOST_REGISTRATION_PROOF_TYPE,
    ),
  })
  return { host, keyPair }
}

async function createClaim(
  label,
  human = ownerHuman,
  device = ownerDeviceContext,
) {
  const registered = await registerHost(label)
  const claim = await hostService.requestClaim(human, device, {
    hostId: registered.host.hostId,
    hostFingerprint: registered.host.fingerprint,
    spaceId: human.personalSpaceId,
  })
  return { ...registered, claim, human, device }
}

async function setClaimExpiration(claim, expired) {
  const observed = await database.query(
    'SELECT clock_timestamp() AS server_time',
  )
  const serverTime = new Date(observed.rows[0].server_time)
  const requestedAt = expired
    ? new Date(serverTime.getTime() - 10 * 60 * 1_000)
    : serverTime
  const expiresAt = new Date(
    serverTime.getTime() + (expired ? -5 : 5) * 60 * 1_000,
  )
  await database.query(
    `UPDATE control_plane.enrollment_challenges
        SET created_at=$2, expires_at=$3
      WHERE challenge_id=$1`,
    [claim.challengeId, requestedAt, expiresAt],
  )
  await database.query(
    `UPDATE control_plane.host_claims
        SET requested_at=$2, expires_at=$3
      WHERE claim_id=$1`,
    [claim.claimId, requestedAt, expiresAt],
  )
}

function expirationInput(fixture, overrides = {}) {
  return {
    spaceId: fixture.claim.spaceId,
    hostFingerprint: fixture.claim.hostFingerprint,
    claimGeneration: fixture.claim.claimGeneration,
    ...overrides,
  }
}

async function expectHostFailure(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error instanceof HostIdentityFailure, true)
    assert.equal(error.code, code)
    return true
  })
}

before(async () => {
  database = await PGliteControlPlaneDatabase.create()
  await runMigrations(database)
  const foundation = new AccountFoundationService(database)
  await foundation.createUserWithPersonalSpace(ownerAccount)
  await foundation.registerProductDevice(ownerDevice)
  await foundation.createUserWithPersonalSpace(otherAccount)
  await foundation.registerProductDevice(otherDevice)
  hostService = new HostIdentityService(database, () => fixtureTime)
})

after(async () => {
  await database.close()
})

test('exact expired requested claim releases only its pending Host reservation', async () => {
  const fixture = await createClaim('success')
  await setClaimExpiration(fixture.claim, true)
  const serviceWithUntrustedPastClock = new HostIdentityService(
    database,
    () => localPast,
  )

  const expired = await serviceWithUntrustedPastClock.expireExactHostClaim(
    ownerHuman,
    ownerDeviceContext,
    fixture.claim.hostId,
    fixture.claim.claimId,
    expirationInput(fixture),
  )
  assert.equal(expired.result, 'expired')
  assert.equal(expired.ownerSpaceId, null)

  const host = await hostService.readHost(fixture.claim.hostId)
  const claim = await hostService.readClaim(fixture.claim.claimId)
  assert.equal(host?.claimState, 'unclaimed')
  assert.equal(host?.owningSpaceId, null)
  assert.equal(claim?.state, 'expired')
  assert.equal(claim?.challengeConsumedAt, null)

  const boundary = await database.query(
    `SELECT
       (SELECT count(*)::int
          FROM control_plane.host_device_authorizations
         WHERE host_id=$1) AS authorizations,
       (SELECT count(*)::int
          FROM control_plane.security_events
         WHERE correlation_id=$2
           AND event_type='host_claim_expired') AS expiration_events`,
    [fixture.claim.hostId, fixture.claim.claimId],
  )
  assert.deepEqual(boundary.rows[0], {
    authorizations: 0,
    expiration_events: 1,
  })

  const repeated = await serviceWithUntrustedPastClock.expireExactHostClaim(
    ownerHuman,
    ownerDeviceContext,
    fixture.claim.hostId,
    fixture.claim.claimId,
    expirationInput(fixture),
  )
  assert.equal(repeated.result, 'already_expired')
  const repeatedEvents = await database.query(
    `SELECT count(*)::int AS count
       FROM control_plane.security_events
      WHERE correlation_id=$1 AND event_type='host_claim_expired'`,
    [fixture.claim.claimId],
  )
  assert.equal(repeatedEvents.rows[0].count, 1)

  const replacement = await hostService.requestClaim(
    ownerHuman,
    ownerDeviceContext,
    {
      hostId: fixture.claim.hostId,
      hostFingerprint: fixture.claim.hostFingerprint,
      spaceId: ownerHuman.personalSpaceId,
    },
  )
  assert.notEqual(replacement.claimId, fixture.claim.claimId)
  await expectHostFailure(
    serviceWithUntrustedPastClock.expireExactHostClaim(
      ownerHuman,
      ownerDeviceContext,
      fixture.claim.hostId,
      fixture.claim.claimId,
      expirationInput(fixture),
    ),
    'host_claim_state_conflict',
  )

  const oldConfirmation = {
    v: 1,
    aud: 'codetether-control-plane-host',
    purpose: 'host_claim_confirmation',
    claimId: fixture.claim.claimId,
    challengeId: fixture.claim.challengeId,
    hostId: fixture.claim.hostId,
    hostFingerprint: fixture.claim.hostFingerprint,
    claimGeneration: fixture.claim.claimGeneration,
    spaceId: fixture.claim.spaceId,
    userId: fixture.claim.userId,
    deviceId: fixture.claim.deviceId,
    nonce: fixture.claim.nonce,
    iat: fixture.claim.issuedAt,
    exp: fixture.claim.expiresAt,
  }
  await expectHostFailure(
    hostService.confirmClaim(
      ownerHuman,
      ownerDeviceContext,
      fixture.claim.hostId,
      {
        payload: oldConfirmation,
        proof: await sign(
          encodeHostClaimConfirmationPayload(oldConfirmation),
          fixture.keyPair.privateKey,
          HOST_CLAIM_PROOF_TYPE,
        ),
      },
    ),
    'host_claim_consumed',
  )
})

test('PostgreSQL server time is authoritative in both expiration directions', async () => {
  const futureFixture = await createClaim('servertimefuture')
  await setClaimExpiration(futureFixture.claim, false)
  const serviceWithFutureLocalClock = new HostIdentityService(
    database,
    () => localFuture,
  )
  await expectHostFailure(
    serviceWithFutureLocalClock.expireExactHostClaim(
      ownerHuman,
      ownerDeviceContext,
      futureFixture.claim.hostId,
      futureFixture.claim.claimId,
      expirationInput(futureFixture),
    ),
    'host_claim_not_expired',
  )

  const pastFixture = await createClaim('servertimepast')
  await setClaimExpiration(pastFixture.claim, true)
  const serviceWithPastLocalClock = new HostIdentityService(
    database,
    () => localPast,
  )
  assert.equal(
    (
      await serviceWithPastLocalClock.expireExactHostClaim(
        ownerHuman,
        ownerDeviceContext,
        pastFixture.claim.hostId,
        pastFixture.claim.claimId,
        expirationInput(pastFixture),
      )
    ).result,
    'expired',
  )
})

test('requesting User, ProductDevice, Space, Host fingerprint, and generation are exact', async () => {
  const fixture = await createClaim('identity')
  await setClaimExpiration(fixture.claim, true)
  const secondOwnerDevice = deviceInput(
    ownerAccount,
    'staleclaimsecondownerdevice',
    fixtureTime,
  )
  await new AccountFoundationService(database).registerProductDevice(
    secondOwnerDevice,
  )
  const secondOwnerDeviceContext = {
    userId: ownerAccount.userId,
    deviceId: secondOwnerDevice.deviceId,
    deviceType: secondOwnerDevice.deviceType,
    keyGeneration: secondOwnerDevice.keyGeneration,
  }
  const unrelatedHost = await registerHost('unrelated')

  await expectHostFailure(
    hostService.expireExactHostClaim(
      otherHuman,
      otherDeviceContext,
      fixture.claim.hostId,
      fixture.claim.claimId,
      {
        ...expirationInput(fixture),
        spaceId: otherHuman.personalSpaceId,
      },
    ),
    'host_claim_requester_mismatch',
  )
  await expectHostFailure(
    hostService.expireExactHostClaim(
      ownerHuman,
      secondOwnerDeviceContext,
      fixture.claim.hostId,
      fixture.claim.claimId,
      expirationInput(fixture),
    ),
    'host_claim_requester_mismatch',
  )
  await expectHostFailure(
    hostService.expireExactHostClaim(
      ownerHuman,
      ownerDeviceContext,
      unrelatedHost.host.hostId,
      fixture.claim.claimId,
      expirationInput(fixture),
    ),
    'host_claim_identity_mismatch',
  )
  await expectHostFailure(
    hostService.expireExactHostClaim(
      ownerHuman,
      ownerDeviceContext,
      fixture.claim.hostId,
      fixture.claim.claimId,
      {
        ...expirationInput(fixture),
        spaceId: otherAccount.spaceId,
      },
    ),
    'host_space_not_permitted',
  )
  await expectHostFailure(
    hostService.expireExactHostClaim(
      ownerHuman,
      ownerDeviceContext,
      fixture.claim.hostId,
      fixture.claim.claimId,
      {
        ...expirationInput(fixture),
        hostFingerprint: `sha256:${'z'.repeat(43)}`,
      },
    ),
    'host_claim_identity_mismatch',
  )
  await expectHostFailure(
    hostService.expireExactHostClaim(
      ownerHuman,
      ownerDeviceContext,
      fixture.claim.hostId,
      fixture.claim.claimId,
      { ...expirationInput(fixture), claimGeneration: 2 },
    ),
    'host_claim_identity_mismatch',
  )
})

test('a revoked requesting ProductDevice cannot release a Host reservation', async () => {
  const revokedDevice = deviceInput(
    ownerAccount,
    'staleclaimrevokeddevice',
    fixtureTime,
  )
  await new AccountFoundationService(database).registerProductDevice(
    revokedDevice,
  )
  const revokedContext = {
    userId: ownerAccount.userId,
    deviceId: revokedDevice.deviceId,
    deviceType: revokedDevice.deviceType,
    keyGeneration: revokedDevice.keyGeneration,
  }
  const fixture = await createClaim('revokeddevice', ownerHuman, revokedContext)
  await setClaimExpiration(fixture.claim, true)
  await database.query(
    'UPDATE control_plane.product_devices SET revoked_at=clock_timestamp() WHERE device_id=$1',
    [revokedDevice.deviceId],
  )
  await expectHostFailure(
    hostService.expireExactHostClaim(
      ownerHuman,
      revokedContext,
      fixture.claim.hostId,
      fixture.claim.claimId,
      expirationInput(fixture),
    ),
    'host_claim_device_unavailable',
  )
  assert.equal(
    (await hostService.readHost(fixture.claim.hostId))?.claimState,
    'pending',
  )
})

test('confirmed, completed, and owned states fail closed', async () => {
  const confirmedFixture = await createClaim('confirmed')
  await setClaimExpiration(confirmedFixture.claim, true)
  await database.query(
    `UPDATE control_plane.host_claims
        SET state='confirmed', confirmed_at=clock_timestamp() - interval '1 minute'
      WHERE claim_id=$1`,
    [confirmedFixture.claim.claimId],
  )
  await expectHostFailure(
    hostService.expireExactHostClaim(
      ownerHuman,
      ownerDeviceContext,
      confirmedFixture.claim.hostId,
      confirmedFixture.claim.claimId,
      expirationInput(confirmedFixture),
    ),
    'host_claim_confirmation_recovery_required',
  )

  const completedFixture = await createClaim('completed')
  const confirmation = {
    v: 1,
    aud: 'codetether-control-plane-host',
    purpose: 'host_claim_confirmation',
    claimId: completedFixture.claim.claimId,
    challengeId: completedFixture.claim.challengeId,
    hostId: completedFixture.claim.hostId,
    hostFingerprint: completedFixture.claim.hostFingerprint,
    claimGeneration: completedFixture.claim.claimGeneration,
    spaceId: completedFixture.claim.spaceId,
    userId: completedFixture.claim.userId,
    deviceId: completedFixture.claim.deviceId,
    nonce: completedFixture.claim.nonce,
    iat: completedFixture.claim.issuedAt,
    exp: completedFixture.claim.expiresAt,
  }
  await hostService.confirmClaim(
    ownerHuman,
    ownerDeviceContext,
    completedFixture.claim.hostId,
    {
      payload: confirmation,
      proof: await sign(
        encodeHostClaimConfirmationPayload(confirmation),
        completedFixture.keyPair.privateKey,
        HOST_CLAIM_PROOF_TYPE,
      ),
    },
  )
  await expectHostFailure(
    hostService.expireExactHostClaim(
      ownerHuman,
      ownerDeviceContext,
      completedFixture.claim.hostId,
      completedFixture.claim.claimId,
      expirationInput(completedFixture),
    ),
    'host_claim_state_conflict',
  )
  assert.equal(
    (await hostService.readHost(completedFixture.claim.hostId))?.owningSpaceId,
    ownerAccount.spaceId,
  )
})

test('concurrent exact expiration has one transition and one semantic event', async () => {
  const fixture = await createClaim('concurrent')
  await setClaimExpiration(fixture.claim, true)
  const first = new HostIdentityService(database, () => localPast)
  const second = new HostIdentityService(database, () => localFuture)
  const results = await Promise.all([
    first.expireExactHostClaim(
      ownerHuman,
      ownerDeviceContext,
      fixture.claim.hostId,
      fixture.claim.claimId,
      expirationInput(fixture),
    ),
    second.expireExactHostClaim(
      ownerHuman,
      ownerDeviceContext,
      fixture.claim.hostId,
      fixture.claim.claimId,
      expirationInput(fixture),
    ),
  ])
  assert.deepEqual(
    new Set(results.map((result) => result.result)),
    new Set(['expired', 'already_expired']),
  )
  const events = await database.query(
    `SELECT event_type, actor_id, target_id, reason_code, count(*)::int AS count
       FROM control_plane.security_events
      WHERE correlation_id=$1
      GROUP BY event_type, actor_id, target_id, reason_code`,
    [fixture.claim.claimId],
  )
  const expiration = events.rows.find(
    (row) => row.event_type === 'host_claim_expired',
  )
  assert.deepEqual(expiration, {
    event_type: 'host_claim_expired',
    actor_id: ownerDevice.deviceId,
    target_id: fixture.claim.hostId,
    reason_code: null,
    count: 1,
  })
  const serialized = JSON.stringify(events.rows)
  assert.equal(serialized.includes(fixture.claim.nonce), false)
})

test('security-event failure rolls back both claim expiration and Host release', async () => {
  const fixture = await createClaim('rollback')
  await setClaimExpiration(fixture.claim, true)
  const failingDatabase = {
    query: (...arguments_) => database.query(...arguments_),
    exec: (...arguments_) => database.exec(...arguments_),
    close: async () => {},
    transaction: (operation) =>
      database.transaction((transaction) =>
        operation({
          query(sql, parameters) {
            if (
              sql.includes('INSERT INTO control_plane.security_events') &&
              parameters?.[1] === 'host_claim_expired'
            ) {
              throw new Error('simulated security event persistence failure')
            }
            return transaction.query(sql, parameters)
          },
          exec: (sql) => transaction.exec(sql),
        }),
      ),
  }
  const failingService = new HostIdentityService(
    failingDatabase,
    () => localPast,
  )
  await assert.rejects(
    failingService.expireExactHostClaim(
      ownerHuman,
      ownerDeviceContext,
      fixture.claim.hostId,
      fixture.claim.claimId,
      expirationInput(fixture),
    ),
  )
  assert.equal(
    (await hostService.readClaim(fixture.claim.claimId))?.state,
    'requested',
  )
  const host = await hostService.readHost(fixture.claim.hostId)
  assert.equal(host?.claimState, 'pending')
  assert.equal(host?.owningSpaceId, null)
})

test('HTTP expiration route remains human-and-ProductDevice bound', async () => {
  const routeDatabase = await PGliteControlPlaneDatabase.create()
  try {
    await runMigrations(routeDatabase)
    const accessToken = 'stale-host-claim-route-token'
    const authTokenHash = sha256Digest(accessToken)
    const verifiedHuman = {
      issuer: 'https://stale-claim.supabase.test/auth/v1',
      subject: 'stale-claim-route-owner',
      externalSessionIdHash: sha256Digest('stale-claim-route-session'),
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      verifiedNormalizedEmail: 'owner@example.test',
    }
    const accountService = new AuthenticatedAccountService(
      routeDatabase,
      () => fixtureTime,
    )
    const account = await accountService.resolveVerifiedHuman(verifiedHuman)
    const human = { ...account, authTokenHash }
    const deviceService = new ProductDeviceAuthenticationService(
      routeDatabase,
      () => fixtureTime,
    )
    const deviceKey = await generateKeyPair('ES256', { extractable: true })
    const registration = await deviceService.createRegistrationChallenge(
      human,
      {
        publicKey: await exportJWK(deviceKey.publicKey),
        keyAlgorithm: 'ES256',
        deviceType: 'desktop_client',
        label: 'Route expiration device',
        platform: 'windows',
        appVersion: '0.1.0-test',
        protocolVersion: 1,
      },
    )
    const registeredDevice = await deviceService.registerProductDevice(human, {
      challenge: registration.challenge,
      proof: await sign(
        encodeRegistrationChallengePayload(registration.challenge),
        deviceKey.privateKey,
        PRODUCT_DEVICE_REGISTRATION_PROOF_TYPE,
      ),
    })
    const deviceContext = {
      userId: human.userId,
      deviceId: registeredDevice.deviceId,
      deviceType: registeredDevice.deviceType,
      keyGeneration: registeredDevice.keyGeneration,
    }
    const routeHostService = new HostIdentityService(
      routeDatabase,
      () => fixtureTime,
    )
    const hostKey = await generateKeyPair('ES256')
    const hostRegistration = await routeHostService.createRegistrationChallenge(
      {
        hostId: id('host', 'staleclaimroutehost'),
        publicKey: await exportJWK(hostKey.publicKey),
        keyAlgorithm: 'ES256',
        safeLabel: 'Route expiration Host',
        coarsePlatform: 'windows',
        protocolVersionMin: 1,
        protocolVersionMax: 1,
      },
    )
    const host = await routeHostService.registerHost({
      challenge: hostRegistration.challenge,
      proof: await sign(
        encodeHostRegistrationChallengePayload(hostRegistration.challenge),
        hostKey.privateKey,
        HOST_REGISTRATION_PROOF_TYPE,
      ),
    })
    const claim = await routeHostService.requestClaim(human, deviceContext, {
      hostId: host.hostId,
      hostFingerprint: host.fingerprint,
      spaceId: human.personalSpaceId,
    })
    const routeServerTime = new Date(
      (await routeDatabase.query('SELECT clock_timestamp() AS server_time'))
        .rows[0].server_time,
    )
    const routeRequestedAt = new Date(
      routeServerTime.getTime() - 10 * 60 * 1_000,
    )
    const routeExpiresAt = new Date(routeServerTime.getTime() - 5 * 60 * 1_000)
    await routeDatabase.query(
      `UPDATE control_plane.enrollment_challenges
          SET created_at=$2, expires_at=$3
        WHERE challenge_id=$1`,
      [claim.challengeId, routeRequestedAt, routeExpiresAt],
    )
    await routeDatabase.query(
      `UPDATE control_plane.host_claims
          SET requested_at=$2, expires_at=$3
        WHERE claim_id=$1`,
      [claim.claimId, routeRequestedAt, routeExpiresAt],
    )

    const verifier = {
      async verifyAccessToken(value) {
        assert.equal(value, accessToken)
        return verifiedHuman
      },
    }
    const running = await startControlPlaneServer({
      database: routeDatabase,
      humanAuthVerifier: verifier,
      authenticatedAccountService: accountService,
      productDeviceAuthenticationService: deviceService,
      hostIdentityService: routeHostService,
      host: '127.0.0.1',
      port: 0,
    })
    try {
      const origin = `http://127.0.0.1:${running.address.port}`
      const resource = `/v1/hosts/${host.hostId}/claims/${claim.claimId}/expire`
      const body = Buffer.from(
        JSON.stringify({
          spaceId: human.personalSpaceId,
          hostFingerprint: host.fingerprint,
          claimGeneration: claim.claimGeneration,
        }),
      )
      const humanOnly = await fetch(`${origin}${resource}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body,
      })
      assert.equal(humanOnly.status, 401)
      assert.equal((await humanOnly.json()).code, 'device_auth_required')

      const proofPayload = {
        v: 1,
        aud: PRODUCT_DEVICE_AUDIENCE,
        authTokenHash,
        deviceId: registeredDevice.deviceId,
        keyGeneration: registeredDevice.keyGeneration,
        method: 'POST',
        resource: canonicalizeDeviceRequestResource(resource),
        bodySha256: sha256Digest(body),
        nonce: 'VVVVVVVVVVVVVVVVVVVVVV',
        iat: Math.floor(fixtureTime.getTime() / 1_000),
        protocolVersion: 1,
      }
      const deviceProof = await sign(
        encodeDeviceRequestProofPayload(proofPayload),
        deviceKey.privateKey,
        PRODUCT_DEVICE_PROOF_TYPE,
      )
      const response = await fetch(`${origin}${resource}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
          'x-codetether-device-proof': deviceProof,
        },
        body,
      })
      assert.equal(response.status, 200)
      const result = await response.json()
      assert.equal(result.result, 'expired')
      assert.equal(result.ownerSpaceId, null)
    } finally {
      await running.close()
    }
  } finally {
    await routeDatabase.close()
  }
})
