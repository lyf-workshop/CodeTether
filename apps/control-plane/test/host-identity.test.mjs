import assert from 'node:assert/strict'
import { generateKeyPair, exportJWK, CompactSign } from 'jose'
import { after, before, test } from 'node:test'

import {
  AccountFoundationService,
  HOST_CLAIM_PROOF_TYPE,
  HOST_REGISTRATION_PROOF_TYPE,
  HostIdentityFailure,
  HostIdentityService,
  encodeHostClaimConfirmationPayload,
  encodeHostRegistrationChallengePayload,
  runMigrations,
} from '../dist/index.js'
import { accountInput, deviceInput } from './fixtures.mjs'
import { PGliteControlPlaneDatabase } from './pglite-database.mjs'

const now = new Date('2026-09-22T12:00:00.000Z')
const account = accountInput('host-identity', now)
const device = deviceInput(account, 'host-identity', now)

let database
let service
let hostKeyPair

async function sign(payload, key, type) {
  return new CompactSign(Buffer.from(payload))
    .setProtectedHeader({ alg: 'ES256', typ: type })
    .sign(key)
}

before(async () => {
  database = await PGliteControlPlaneDatabase.create()
  await runMigrations(database)
  const foundation = new AccountFoundationService(database)
  await foundation.createUserWithPersonalSpace(account)
  await foundation.registerProductDevice(device)
  service = new HostIdentityService(database, () => now)
  hostKeyPair = await generateKeyPair('ES256')
})

after(async () => {
  await database.close()
})

test('registers an unclaimed Host with proof of its public-key possession', async () => {
  const publicKey = await exportJWK(hostKeyPair.publicKey)
  const challenge = await service.createRegistrationChallenge({
    publicKey,
    keyAlgorithm: 'ES256',
    safeLabel: 'Development Host',
    coarsePlatform: 'windows',
    protocolVersionMin: 1,
    protocolVersionMax: 1,
  })
  const proof = await sign(
    encodeHostRegistrationChallengePayload(challenge.challenge),
    hostKeyPair.privateKey,
    HOST_REGISTRATION_PROOF_TYPE,
  )
  const registered = await service.registerHost({
    challenge: challenge.challenge,
    proof,
  })
  assert.equal(registered.claimState, 'unclaimed')
  const host = await service.readHost(registered.hostId)
  assert.equal(host?.owningSpaceId, null)
  assert.equal(host?.claimState, 'unclaimed')
  assert.equal(host?.fingerprint, challenge.publicKeyFingerprint)
})

test('requires a local Host signature and completes one claim atomically', async () => {
  const secondHostKeyPair = await generateKeyPair('ES256')
  const publicKey = await exportJWK(secondHostKeyPair.publicKey)
  const registration = await service.createRegistrationChallenge({
    publicKey,
    keyAlgorithm: 'ES256',
    safeLabel: 'Claimable Host',
    coarsePlatform: 'windows',
    protocolVersionMin: 1,
    protocolVersionMax: 1,
  })
  const registrationProof = await sign(
    encodeHostRegistrationChallengePayload(registration.challenge),
    secondHostKeyPair.privateKey,
    HOST_REGISTRATION_PROOF_TYPE,
  )
  const registered = await service.registerHost({
    challenge: registration.challenge,
    proof: registrationProof,
  })
  const human = {
    userId: account.userId,
    status: 'active',
    personalSpaceId: account.spaceId,
    authTokenHash: 'sha256:hostidentityauthhashhostidentityauthhashhostident',
  }
  const deviceContext = {
    userId: account.userId,
    deviceId: device.deviceId,
    deviceType: device.deviceType,
    keyGeneration: device.keyGeneration,
  }
  const claim = await service.requestClaim(human, deviceContext, {
    hostId: registered.hostId,
    hostFingerprint: registered.fingerprint,
    spaceId: account.spaceId,
  })
  const confirmation = {
    v: 1,
    aud: 'codetether-control-plane-host',
    purpose: 'host_claim_confirmation',
    claimId: claim.claimId,
    challengeId: claim.challengeId,
    hostId: claim.hostId,
    hostFingerprint: claim.hostFingerprint,
    claimGeneration: claim.claimGeneration,
    spaceId: claim.spaceId,
    userId: claim.userId,
    deviceId: claim.deviceId,
    nonce: claim.nonce,
    iat: claim.issuedAt,
    exp: claim.expiresAt,
  }
  const proof = await sign(
    encodeHostClaimConfirmationPayload(confirmation),
    secondHostKeyPair.privateKey,
    HOST_CLAIM_PROOF_TYPE,
  )
  const completed = await service.confirmClaim(
    human,
    deviceContext,
    claim.hostId,
    {
      payload: confirmation,
      proof,
    },
  )
  assert.equal(completed.state, 'completed')
  const host = await service.readHost(claim.hostId)
  assert.equal(host?.owningSpaceId, account.spaceId)
  assert.equal(host?.claimState, 'claimed')
  await assert.rejects(
    service.confirmClaim(human, deviceContext, claim.hostId, {
      payload: confirmation,
      proof,
    }),
    HostIdentityFailure,
  )
  await assert.rejects(
    service.requestClaim(human, deviceContext, {
      hostId: claim.hostId,
      hostFingerprint: claim.hostFingerprint,
      spaceId: account.spaceId,
    }),
    (error) =>
      error instanceof HostIdentityFailure &&
      error.code === 'host_already_claimed',
  )
})

test('rejects substituted Host signatures and never grants Supervisor authority', async () => {
  const hostPair = await generateKeyPair('ES256')
  const wrongPair = await generateKeyPair('ES256')
  const registration = await service.createRegistrationChallenge({
    publicKey: await exportJWK(hostPair.publicKey),
    keyAlgorithm: 'ES256',
    safeLabel: 'Negative Host',
    coarsePlatform: 'windows',
    protocolVersionMin: 1,
    protocolVersionMax: 1,
  })
  const registered = await service.registerHost({
    challenge: registration.challenge,
    proof: await sign(
      encodeHostRegistrationChallengePayload(registration.challenge),
      hostPair.privateKey,
      HOST_REGISTRATION_PROOF_TYPE,
    ),
  })
  const human = {
    userId: account.userId,
    status: 'active',
    personalSpaceId: account.spaceId,
    authTokenHash: 'sha256:hostidentitynegativeauthhashhostidentitynegative',
  }
  const deviceContext = {
    userId: account.userId,
    deviceId: device.deviceId,
    deviceType: device.deviceType,
    keyGeneration: device.keyGeneration,
  }
  const claim = await service.requestClaim(human, deviceContext, {
    hostId: registered.hostId,
    hostFingerprint: registered.fingerprint,
    spaceId: account.spaceId,
  })
  const payload = {
    v: 1,
    aud: 'codetether-control-plane-host',
    purpose: 'host_claim_confirmation',
    claimId: claim.claimId,
    challengeId: claim.challengeId,
    hostId: claim.hostId,
    hostFingerprint: claim.hostFingerprint,
    claimGeneration: claim.claimGeneration,
    spaceId: claim.spaceId,
    userId: claim.userId,
    deviceId: claim.deviceId,
    nonce: claim.nonce,
    iat: claim.issuedAt,
    exp: claim.expiresAt,
  }
  await assert.rejects(
    service.confirmClaim(human, deviceContext, claim.hostId, {
      payload,
      proof: await sign(
        encodeHostClaimConfirmationPayload(payload),
        wrongPair.privateKey,
        HOST_CLAIM_PROOF_TYPE,
      ),
    }),
    (error) => error instanceof HostIdentityFailure && error.code === 'host_signature_invalid',
  )
  const authorization = await database.query(
    'SELECT COUNT(*)::int AS count FROM control_plane.host_device_authorizations WHERE host_id = $1',
    [registered.hostId],
  )
  assert.equal(authorization.rows[0].count, 0)
})

test('serializes concurrent claim attempts for one Host', async () => {
  const hostPair = await generateKeyPair('ES256')
  const registration = await service.createRegistrationChallenge({
    publicKey: await exportJWK(hostPair.publicKey),
    keyAlgorithm: 'ES256',
    safeLabel: 'Concurrent Host',
    coarsePlatform: 'windows',
    protocolVersionMin: 1,
    protocolVersionMax: 1,
  })
  const registered = await service.registerHost({
    challenge: registration.challenge,
    proof: await sign(
      encodeHostRegistrationChallengePayload(registration.challenge),
      hostPair.privateKey,
      HOST_REGISTRATION_PROOF_TYPE,
    ),
  })
  const human = {
    userId: account.userId,
    status: 'active',
    personalSpaceId: account.spaceId,
    authTokenHash: 'sha256:hostidentityconcurrentauthhashhostidentityconcurrent',
  }
  const deviceContext = {
    userId: account.userId,
    deviceId: device.deviceId,
    deviceType: device.deviceType,
    keyGeneration: device.keyGeneration,
  }
  const results = await Promise.allSettled([
    service.requestClaim(human, deviceContext, {
      hostId: registered.hostId,
      hostFingerprint: registered.fingerprint,
      spaceId: account.spaceId,
    }),
    service.requestClaim(human, deviceContext, {
      hostId: registered.hostId,
      hostFingerprint: registered.fingerprint,
      spaceId: account.spaceId,
    }),
  ])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1)
  const host = await service.readHost(registered.hostId)
  assert.equal(host?.claimState, 'pending')
})
