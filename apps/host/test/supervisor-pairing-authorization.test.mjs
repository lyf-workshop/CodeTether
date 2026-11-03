import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { canonicalJsonBytes } from '@codetether/supervisor-transport'

import { SupervisorTransportManager } from '../dist/api/supervisor-transport-manager.js'
import { ConversationStore } from '../dist/persistence/index.js'

const day = 86_400
const id = (prefix, letter) => `${prefix}_${letter.repeat(32)}`
const fingerprint = (letter) => `sha256:${letter.repeat(43)}`
const host = {
  hostId: id('host', 'h'),
  fingerprint: fingerprint('h'),
  identityGeneration: 1,
}
const now = Math.floor(Date.now() / 1_000)

function authorization(letter, expiresAt, deviceId = id('dev', 'd')) {
  const issuedAt = Math.min(now, expiresAt - 300)
  return {
    v: 1,
    aud: 'codetether-control-plane-host',
    purpose: 'host_device_authorization',
    authorizationId: id('hauth', letter),
    challengeId: id('enroll', letter),
    hostId: host.hostId,
    hostFingerprint: host.fingerprint,
    hostIdentityGeneration: 1,
    spaceId: id('space', 's'),
    userId: id('usr', 'u'),
    deviceId,
    deviceKeyGeneration: 1,
    deviceFingerprint: fingerprint('d'),
    scope: 'supervisor_control',
    nonce: 'a'.repeat(32),
    iat: issuedAt,
    exp: issuedAt + 60,
    authorizationExpiresAt: expiresAt,
  }
}

function grantFor(authorization) {
  const {
    authorizationId,
    hostId,
    hostFingerprint,
    hostIdentityGeneration,
    deviceId,
    deviceFingerprint,
    deviceKeyGeneration,
    userId,
    spaceId,
    scope,
  } = authorization
  return {
    payload: {
      v: 1,
      aud: 'codetether-host-supervisor',
      purpose: 'host_supervisor_grant',
      authorizationId,
      hostId,
      hostFingerprint,
      hostIdentityGeneration,
      deviceId,
      deviceFingerprint,
      deviceKeyGeneration,
      userId,
      spaceId,
      scope,
      authorizationSerial: '1',
      authorizationGeneration: 1,
      issuedAt: authorization.iat,
      expiresAt: authorization.authorizationExpiresAt,
    },
    proof: 'S'.repeat(80),
  }
}

function renewalCheck(current, proposal) {
  return {
    previousAuthorizationId: current.authorizationId,
    pairingRootAuthorizationId: current.authorizationId,
    deviceId: current.deviceId,
    proposal,
  }
}

async function fixture(t) {
  const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const directory = await mkdtemp(
    join(tmpdir(), 'codetether-pairing-evidence-'),
  )
  const store = ConversationStore.open({
    databasePath: join(directory, 'host.sqlite3'),
  })
  const manager = await SupervisorTransportManager.create({
    service: {
      getHostIdentity: () => ({
        ...host,
        publicJwk: JSON.stringify(keys.publicKey.export({ format: 'jwk' })),
      }),
    },
    persistence: store,
    bindHost: '127.0.0.1',
    port: 0,
    clientBuildIdentity: 'fixture-host',
  })
  t.after(async () => {
    await manager.close()
    store.close()
    await rm(directory, { recursive: true, force: true })
  })
  return { store, manager, privateKey: keys.privateKey }
}

function evidence(privateKey, authorization, previousAuthorizationId = null) {
  const payload = { authorization, previousAuthorizationId }
  const header = canonicalJsonBytes({
    alg: 'ES256',
    typ: 'codetether-local-pairing-authorization+jws',
  }).toString('base64url')
  const input = `${header}.${canonicalJsonBytes(payload).toString('base64url')}`
  const proof = sign('sha256', Buffer.from(input), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url')
  return { payload, proof: `${input}.${proof}` }
}

test('Host decides renewal from an enabled locally evidenced grant and recent local use', async (t) => {
  const { store, manager } = await fixture(t)
  const current = authorization('a', now + 14 * day)
  const candidate = authorization('b', now + 30 * day)
  const grant = grantFor(current)
  const check = renewalCheck(current, candidate)
  store.storeHostSupervisorGrant(grant, new Date().toISOString())
  assert.equal(
    manager.isPairingRenewalAllowed(check),
    false,
    'missing evidence',
  )
  assert.ok(
    store.storeHostSupervisorAuthorizationEvidence(
      current,
      current.authorizationId,
    ),
  )
  assert.equal(
    manager.isPairingRenewalAllowed(check),
    false,
    'missing actual use',
  )
  store.recordHostSupervisorAuthorizationUse(
    current.authorizationId,
    (now - 60) * 1_000,
  )
  assert.equal(manager.isPairingRenewalAllowed(check), true)
  assert.equal(
    manager.isPairingRenewalAllowed({
      ...check,
      pairingRootAuthorizationId: candidate.authorizationId,
    }),
    false,
  )
  for (const proposal of [
    { ...candidate, deviceFingerprint: fingerprint('x') },
    { ...candidate, deviceKeyGeneration: 2 },
    { ...candidate, deviceId: id('dev', 'z') },
  ]) {
    assert.equal(manager.isPairingRenewalAllowed({ ...check, proposal }), false)
  }
  const far = authorization('f', now + 16 * day, id('dev', 'f'))
  store.storeHostSupervisorAuthorizationEvidence(far, far.authorizationId)
  store.storeHostSupervisorGrant(grantFor(far), new Date().toISOString())
  store.recordHostSupervisorAuthorizationUse(
    far.authorizationId,
    (now - 60) * 1_000,
  )
  assert.equal(manager.isPairingRenewalAllowed(renewalCheck(far)), false)
  assert.deepEqual(
    store.revokeHostSupervisorPairing(
      current.deviceId,
      current.authorizationId,
    ),
    [current.authorizationId],
  )
  assert.equal(manager.isPairingRenewalAllowed(check), false)
  assert.deepEqual(
    store
      .listEnabledHostSupervisorGrants()
      .map((value) => value.payload.authorizationId),
    [far.authorizationId],
  )
})

test('backfill requires real use in the 30 days before expiry and retains the same signed lineage', async (t) => {
  const { store, manager, privateKey } = await fixture(t)
  const expired = authorization('x', now - day)
  const next = authorization('n', now + 30 * day)
  store.storeHostSupervisorAuthorizationEvidence(
    expired,
    expired.authorizationId,
  )
  store.storeHostSupervisorGrant(grantFor(expired), new Date().toISOString())
  store.recordHostSupervisorAuthorizationUse(
    expired.authorizationId,
    (now - 32 * day) * 1_000,
  )
  assert.equal(
    manager.isPairingRenewalAllowed(renewalCheck(expired, next)),
    false,
  )
  store.recordHostSupervisorAuthorizationUse(
    expired.authorizationId,
    (now - 2 * day) * 1_000,
  )
  assert.equal(
    manager.isPairingRenewalAllowed(renewalCheck(expired, next)),
    true,
  )

  const signed = evidence(privateKey, next, expired.authorizationId)
  await assert.rejects(
    manager.recordPairingAuthorization({
      ...signed,
      payload: { ...signed.payload, previousAuthorizationId: null },
    }),
    { code: 'operation_not_allowed' },
  )
  await manager.recordPairingAuthorization(signed)
  await manager.recordPairingAuthorization(signed)
  assert.deepEqual(
    store.getHostSupervisorAuthorizationEvidence(next.authorizationId),
    {
      payload: next,
      pairingRootAuthorizationId: expired.authorizationId,
      previousAuthorizationId: expired.authorizationId,
    },
  )
  assert.equal(manager.isLocalControlGrantAllowed(grantFor(next).payload), true)
  assert.equal(
    manager.isLocalControlGrantAllowed({
      ...grantFor(next).payload,
      expiresAt: next.authorizationExpiresAt + 1,
    }),
    false,
  )
  await assert.rejects(
    manager.recordPairingAuthorization(evidence(privateKey, next)),
    { code: 'operation_not_allowed' },
  )
  store.revokeHostSupervisorPairing(expired.deviceId, expired.authorizationId)
  assert.equal(
    manager.isLocalControlGrantAllowed(grantFor(next).payload),
    false,
  )
  await assert.rejects(manager.recordPairingAuthorization(signed), {
    code: 'operation_not_allowed',
  })
})

test('a renewal reserves its predecessor until it is durably superseded or the unactivated challenge expires', async (t) => {
  const { store, manager, privateKey } = await fixture(t)
  t.mock.timers.enable({ apis: ['Date'], now: now * 1_000 })
  const expired = authorization('x', now - day)
  const first = authorization('a', now + 30 * day)
  const sign = (proposal) =>
    evidence(privateKey, proposal, expired.authorizationId)
  store.storeHostSupervisorAuthorizationEvidence(
    expired,
    expired.authorizationId,
  )
  store.storeHostSupervisorGrant(grantFor(expired), new Date().toISOString())
  store.recordHostSupervisorAuthorizationUse(
    expired.authorizationId,
    (now - 2 * day) * 1_000,
  )

  await manager.recordPairingAuthorization(sign(first))
  await manager.recordPairingAuthorization(sign(first))
  const missing = authorization('m', now + 14 * day, id('dev', 'm'))
  store.storeHostSupervisorAuthorizationEvidence(
    missing,
    missing.authorizationId,
  )
  store.storeHostSupervisorGrant(grantFor(missing), new Date().toISOString())
  store.recordHostSupervisorAuthorizationUse(
    missing.authorizationId,
    (now - 60) * 1_000,
  )
  assert.equal(manager.isPairingRenewalAllowed(renewalCheck(missing)), true)
  manager.pruneActivations([])
  assert.deepEqual(store.listEnabledHostSupervisorGrants(), [])
  assert.equal(manager.isPairingRenewalAllowed(renewalCheck(missing)), false)
  assert.equal(manager.isPairingRenewalAllowed(renewalCheck(expired)), true)
  const competing = authorization('b', now + 30 * day)
  assert.equal(
    manager.isPairingRenewalAllowed(renewalCheck(expired, competing)),
    false,
  )
  await assert.rejects(manager.recordPairingAuthorization(sign(competing)), {
    code: 'operation_not_allowed',
  })

  t.mock.timers.tick(61_000)
  const replacement = { ...competing, iat: now + 61, exp: now + 121 }
  assert.equal(
    manager.isPairingRenewalAllowed(renewalCheck(expired, replacement)),
    true,
  )
  const rival = { ...replacement, authorizationId: id('hauth', 'r') }
  const outcomes = await Promise.allSettled(
    [replacement, rival].map((proposal) =>
      manager.recordPairingAuthorization(sign(proposal)),
    ),
  )
  assert.equal(
    outcomes.filter((result) => result.status === 'fulfilled').length,
    1,
  )
  const winner = outcomes[0].status === 'fulfilled' ? replacement : rival
  assert.equal(
    manager.isLocalControlGrantAllowed(grantFor(first).payload),
    false,
  )
  store.storeHostSupervisorGrant(grantFor(winner), new Date().toISOString())
  await manager.recordPairingAuthorization(sign(winner))
  assert.equal(
    manager.isLocalControlGrantAllowed(grantFor(expired).payload),
    false,
  )

  t.mock.timers.tick(61_000)
  const later = {
    ...authorization('c', now + 30 * day),
    iat: now + 122,
    exp: now + 182,
  }
  assert.equal(
    manager.isPairingRenewalAllowed(renewalCheck(expired, later)),
    false,
  )
  await assert.rejects(manager.recordPairingAuthorization(sign(later)), {
    code: 'operation_not_allowed',
  })
})
