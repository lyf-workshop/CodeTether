import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { after, before, test } from 'node:test'
import { CompactSign, exportJWK, generateKeyPair } from 'jose'
import {
  canonicalJsonBytes,
  supervisorGrantProofType,
  supervisorProtocolVersion,
} from '@codetether/supervisor-transport'
import {
  AccountFoundationService,
  ControlPlaneRepository,
  HOST_AUDIENCE,
  HOST_DEVICE_AUTHORIZATION_PROOF_TYPE,
  HOST_PAIRING_MANAGEMENT_PROOF_TYPE,
  HostIdentityService,
  HostPairingService,
  PRODUCT_DEVICE_PROOF_HEADER,
  ProductDeviceAuthFailure,
  admitHostPublicJwk,
  createEnrollmentChallengeId,
  encodeHostDeviceAuthorizationPayload,
  runMigrations,
  startControlPlaneServer,
} from '../dist/index.js'
import { accountInput, deviceInput, id } from './fixtures.mjs'
import { PGliteControlPlaneDatabase } from './pglite-database.mjs'

const initial = Date.parse('2026-11-03T12:00:00.000Z')
const day = 24 * 60 * 60 * 1000
const testKey = Buffer.alloc(32, 37)
let database

before(async () => {
  database = await PGliteControlPlaneDatabase.create()
  await runMigrations(database)
})
after(async () => database.close())

async function fixture(name) {
  let time = initial
  const now = () => new Date(time)
  const account = accountInput(name, now())
  const repository = new ControlPlaneRepository(database)
  await new AccountFoundationService(database).createUserWithPersonalSpace(
    account,
  )
  const human = {
    userId: account.userId,
    status: 'active',
    personalSpaceId: account.spaceId,
    authTokenHash: 'sha256:fixture',
  }
  async function device(suffix) {
    const record = {
      ...deviceInput(account, `${name}${suffix}`, now()),
      keyGeneration: 1,
    }
    await repository.createProductDevice(record)
    return {
      userId: account.userId,
      deviceId: record.deviceId,
      deviceType: record.deviceType,
      keyGeneration: record.keyGeneration,
    }
  }
  async function host(suffix) {
    const keys = await generateKeyPair('ES256')
    const admitted = await admitHostPublicJwk(await exportJWK(keys.publicKey))
    const record = {
      hostId: id('host', `${name}${suffix}`),
      owningSpaceId: account.spaceId,
      publicKey: admitted.canonicalPublicJwk,
      keyAlgorithm: 'ES256',
      fingerprint: admitted.fingerprint,
      safeLabel: `Host ${suffix}`,
      coarsePlatform: 'windows',
      protocolVersionMin: 1,
      protocolVersionMax: 1,
      claimGeneration: 1,
      claimState: 'claimed',
      createdAt: now(),
    }
    await repository.createHost(record)
    return { ...record, privateKey: keys.privateKey }
  }
  const manager = await device('manager')
  const target = await device('target')
  const owner = await host('owner')
  const service = new HostPairingService(database, testKey, now)
  const identity = new HostIdentityService(database, now)
  async function manage(purpose, subjectId, options = {}) {
    const machine = options.host ?? owner
    const signer = options.manager ?? manager
    const iat = Math.floor(time / 1000)
    const payload = {
      v: 1,
      aud: HOST_AUDIENCE,
      purpose: `host_pairing_${purpose}`,
      hostId: machine.hostId,
      hostFingerprint: machine.fingerprint,
      hostIdentityGeneration: machine.claimGeneration,
      spaceId: human.personalSpaceId,
      userId: human.userId,
      deviceId: signer.deviceId,
      subjectId,
      nonce: randomBytes(32).toString('base64url'),
      iat,
      exp: iat + 60,
      ...options.extra,
    }
    const proof = await new CompactSign(canonicalJsonBytes(payload))
      .setProtectedHeader({
        alg: 'ES256',
        typ: HOST_PAIRING_MANAGEMENT_PROOF_TYPE,
      })
      .sign(options.key ?? machine.privateKey)
    return { payload, proof }
  }
  async function open(
    machine = owner,
    sessionId = createEnrollmentChallengeId(),
  ) {
    return service.create(
      human,
      manager,
      machine.hostId,
      await manage('create', sessionId, { host: machine }),
    )
  }
  async function status(sessionId) {
    return service.manageSession(
      human,
      manager,
      owner.hostId,
      sessionId,
      'status',
      await manage('status', sessionId),
    )
  }
  async function signProposal(payload, key = owner.privateKey) {
    const proof = await new CompactSign(
      encodeHostDeviceAuthorizationPayload(payload),
    )
      .setProtectedHeader({
        alg: 'ES256',
        typ: HOST_DEVICE_AUTHORIZATION_PROOF_TYPE,
      })
      .sign(key)
    return { payload, proof }
  }
  async function pair(controller = target) {
    const session = await open()
    const claim = await service.redeem(human, controller, {
      code: session.code,
    })
    assert.equal(claim.status, 'claimed')
    const approval = await signProposal(
      (await status(session.sessionId)).payload,
    )
    const result = await service.finish(
      human,
      manager,
      owner.hostId,
      session.sessionId,
      'pair',
      approval,
    )
    assert.equal(result.status, 'paired')
    return { session, approval, authorization: result.authorization }
  }
  async function admit(record, controller = target) {
    const payload = {
      v: 1,
      aud: 'codetether-host-supervisor',
      purpose: 'host_supervisor_grant',
      authorizationId: record.authorizationId,
      hostId: owner.hostId,
      hostFingerprint: owner.fingerprint,
      hostIdentityGeneration: owner.claimGeneration,
      deviceId: record.deviceId,
      deviceFingerprint: record.deviceFingerprint,
      deviceKeyGeneration: record.deviceKeyGeneration,
      userId: record.userId,
      spaceId: record.spaceId,
      scope: record.scope,
      authorizationSerial: record.serial,
      authorizationGeneration: record.generation,
      issuedAt: Date.parse(record.issuedAt) / 1000,
      expiresAt: Date.parse(record.expiresAt) / 1000,
    }
    const grant = {
      payload,
      proof: await new CompactSign(canonicalJsonBytes(payload))
        .setProtectedHeader({ alg: 'ES256', typ: supervisorGrantProofType })
        .sign(owner.privateKey),
    }
    await identity.materializeSupervisorGrant(
      human,
      manager,
      owner.hostId,
      grant,
    )
    return identity.authorizeSupervisorAdmission(
      human,
      controller,
      owner.hostId,
      {
        type: 'supervisor.challenge',
        protocolVersion: supervisorProtocolVersion,
        audience: 'codetether-host-supervisor',
        sessionId: id('ssn', 'fixture'),
        authorizationId: record.authorizationId,
        hostId: owner.hostId,
        hostIdentityGeneration: owner.claimGeneration,
        deviceId: controller.deviceId,
        deviceKeyGeneration: controller.keyGeneration,
        tlsExporter: 'E'.repeat(43),
        nonce: 'N'.repeat(43),
        issuedAt: now().toISOString(),
        expiresAt: new Date(time + 8_000).toISOString(),
      },
    )
  }
  async function renewal(authorizationId) {
    return service.prepareRenewal(
      human,
      manager,
      owner.hostId,
      authorizationId,
      await manage('renew', authorizationId),
    )
  }
  async function revokeProof(
    record,
    pairingRootAuthorizationId = record.authorizationId,
  ) {
    return manage('revoke', record.authorizationId, {
      extra: { targetDeviceId: record.deviceId, pairingRootAuthorizationId },
    })
  }
  return {
    service,
    identity,
    human,
    owner,
    manager,
    target,
    now,
    device,
    host,
    manage,
    open,
    status,
    signProposal,
    pair,
    admit,
    renewal,
    revokeProof,
    advance: (duration) => {
      time += duration
    },
  }
}

test('pairing requires a signed Host window, binds one device and finishes idempotently', async () => {
  const f = await fixture('pair')
  const other = await fixture('other-account')
  const wrong = await generateKeyPair('ES256')
  const sessionId = createEnrollmentChallengeId()
  await assert.rejects(
    f.service.create(
      f.human,
      f.manager,
      f.owner.hostId,
      await f.manage('create', sessionId, { key: wrong.privateKey }),
    ),
    { code: 'host_pairing_signature_invalid' },
  )
  const session = await f.open(f.owner, sessionId)
  assert.deepEqual(await f.open(f.owner, sessionId), session)
  assert.match(session.code, /^\d{6}$/)
  const stored = (
    await database.query(
      'SELECT code_hash, proposal FROM control_plane.host_pairing_sessions WHERE session_id=$1',
      [sessionId],
    )
  ).rows[0]
  assert.match(stored.code_hash, /^[a-f0-9]{64}$/)
  assert.equal(stored.proposal, null)
  assert.equal(
    (
      await other.service.redeem(other.human, other.target, {
        code: session.code,
      })
    ).status,
    'invalid_code',
  )

  const competing = await f.device('competing')
  const outcomes = await Promise.all(
    [f.target, competing].map((device) =>
      f.service.redeem(f.human, device, { code: session.code }),
    ),
  )
  assert.deepEqual(outcomes.map((value) => value.status).sort(), [
    'claimed',
    'used',
  ])
  const winner = outcomes[0].status === 'claimed' ? f.target : competing
  const loser = winner === f.target ? competing : f.target
  assert.equal(
    (await f.service.redeem(f.human, winner, { code: session.code })).status,
    'claimed',
  )
  await assert.rejects(f.service.readClaim(f.human, loser, sessionId), {
    code: 'host_pairing_session_not_found',
  })
  const claimed = await f.status(sessionId)
  assert.equal(claimed.payload.deviceId, winner.deviceId)
  assert.equal(claimed.payload.scope, 'supervisor_control')
  const foreignPayload = { ...claimed.payload, deviceId: loser.deviceId }
  await assert.rejects(
    f.service.finish(
      f.human,
      f.manager,
      f.owner.hostId,
      sessionId,
      'pair',
      await f.signProposal(foreignPayload),
    ),
    { code: 'host_pairing_session_not_found' },
  )
  const approval = await f.signProposal(claimed.payload)
  const finish = () =>
    f.service.finish(
      f.human,
      f.manager,
      f.owner.hostId,
      sessionId,
      'pair',
      approval,
    )
  const paired = await finish()
  assert.deepEqual(await finish(), paired)
  assert.equal(paired.status, 'paired')
  assert.equal(paired.authorization.deviceId, winner.deviceId)
  assert.equal(
    (await f.service.redeem(f.human, winner, { code: session.code })).status,
    'used',
  )
  assert.equal(
    (await f.service.readClaim(f.human, winner, sessionId)).status,
    'paired',
  )
})

test('five concurrent failures invalidate live codes on every Host in one account', async () => {
  const f = await fixture('limits')
  const other = await fixture('separate-limits')
  const secondHost = await f.host('second')
  const first = await f.open()
  const second = await f.open(secondHost)
  const unaffected = await other.open()
  const wrongCode = ['000000', '000001', '000002'].find(
    (code) => code !== first.code && code !== second.code,
  )
  const alternate = await f.device('alternate')
  const wrong = await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      f.service.redeem(f.human, index % 2 === 0 ? f.target : alternate, {
        code: wrongCode,
      }),
    ),
  )
  assert.deepEqual(
    wrong.map((outcome) => outcome.remainingAttempts).sort(),
    [0, 1, 2, 3, 4],
  )
  assert.equal(
    wrong.filter((outcome) => outcome.status === 'rate_limited').length,
    1,
  )
  for (const session of [first, second]) {
    assert.deepEqual(
      await f.service.redeem(f.human, f.target, { code: session.code }),
      { status: 'rate_limited', remainingAttempts: 0 },
    )
  }
  const restarted = new HostPairingService(database, testKey, f.now)
  assert.equal(
    (await restarted.redeem(f.human, f.target, { code: wrongCode })).status,
    'rate_limited',
  )
  assert.equal(
    (
      await other.service.redeem(other.human, other.target, {
        code: unaffected.code,
      })
    ).status,
    'claimed',
  )
  const replacement = await f.open()
  assert.equal(
    (await restarted.redeem(f.human, f.target, { code: replacement.code }))
      .status,
    'claimed',
  )
})

test('cancel and expiry prevent a previously signed pairing from finishing', async () => {
  const f = await fixture('close-window')
  const cancelled = await f.open()
  await f.service.redeem(f.human, f.target, { code: cancelled.code })
  const proof = await f.signProposal(
    (await f.status(cancelled.sessionId)).payload,
  )
  assert.equal(
    (
      await f.service.manageSession(
        f.human,
        f.manager,
        f.owner.hostId,
        cancelled.sessionId,
        'cancel',
        await f.manage('cancel', cancelled.sessionId),
      )
    ).status,
    'cancelled',
  )
  assert.equal(
    (await f.service.redeem(f.human, f.target, { code: cancelled.code }))
      .status,
    'cancelled',
  )
  await assert.rejects(
    f.service.finish(
      f.human,
      f.manager,
      f.owner.hostId,
      cancelled.sessionId,
      'pair',
      proof,
    ),
    { code: 'host_pairing_session_conflict' },
  )

  const expired = await f.open()
  await f.service.redeem(f.human, f.target, { code: expired.code })
  const staleProof = await f.signProposal(
    (await f.status(expired.sessionId)).payload,
  )
  f.advance(5 * 60_000)
  assert.equal((await f.status(expired.sessionId)).status, 'expired')
  assert.equal(
    (await f.service.redeem(f.human, f.target, { code: expired.code })).status,
    'expired',
  )
  await assert.rejects(
    f.service.finish(
      f.human,
      f.manager,
      f.owner.hostId,
      expired.sessionId,
      'pair',
      staleProof,
    ),
    { code: 'host_pairing_session_expired' },
  )
  assert.deepEqual(
    await f.service.listDevices(f.human, f.manager, f.owner.hostId),
    { devices: [] },
  )
})

test('admission records use, live and expired renewals preserve it, and an idle lease cannot renew forever', async () => {
  const f = await fixture('renew')
  const first = (await f.pair()).authorization
  f.advance(day)
  const admitted = await f.admit(first)
  assert.equal(admitted.scope, 'supervisor_control')
  assert.equal(admitted.pairingRootAuthorizationId, first.authorizationId)
  const lastUsedAt = f.now().toISOString()
  await assert.rejects(f.renewal(first.authorizationId), {
    code: 'host_pairing_renewal_ineligible',
  })
  f.advance(15 * day)
  const proposed = await f.renewal(first.authorizationId)
  assert.deepEqual(await f.renewal(first.authorizationId), proposed)
  const proof = await f.signProposal(proposed.payload)
  const finish = () =>
    f.service.finish(
      f.human,
      f.manager,
      f.owner.hostId,
      first.authorizationId,
      'renew',
      proof,
    )
  const renewed = (await finish()).authorization
  assert.equal(
    (await finish()).authorization.authorizationId,
    renewed.authorizationId,
  )
  assert.ok(renewed.generation > first.generation)
  const old = (
    await database.query(
      `SELECT a.revoked_at, ps.superseded_by_authorization_id
         FROM control_plane.host_device_authorizations a
         JOIN control_plane.host_pairing_sessions ps ON ps.completed_authorization_id=a.authorization_id
        WHERE a.authorization_id=$1`,
      [first.authorizationId],
    )
  ).rows[0]
  assert.ok(old.revoked_at)
  assert.equal(old.superseded_by_authorization_id, renewed.authorizationId)
  const devices = () =>
    f.service
      .listDevices(f.human, f.manager, f.owner.hostId)
      .then((result) => result.devices)
  assert.equal((await devices())[0].lastUsedAt, lastUsedAt)
  f.advance(day)
  await f.admit(renewed)
  const useBeforeSleep = f.now().toISOString()
  f.advance(31 * day)
  const expired = (await devices())[0]
  assert.equal(expired.status, 'expired')
  assert.equal(expired.renewalEligible, true)
  const catchUp = await f.renewal(renewed.authorizationId)
  const restored = (
    await f.service.finish(
      f.human,
      f.manager,
      f.owner.hostId,
      renewed.authorizationId,
      'renew',
      await f.signProposal(catchUp.payload),
    )
  ).authorization
  assert.equal((await devices())[0].lastUsedAt, useBeforeSleep)
  assert.equal(
    (await devices())[0].pairingRootAuthorizationId,
    first.authorizationId,
  )
  f.advance(31 * day)
  assert.equal((await devices())[0].renewalEligible, false)
  await assert.rejects(f.renewal(restored.authorizationId), {
    code: 'host_pairing_renewal_ineligible',
  })
})

test('signed device revocation serializes with renewal and cannot revoke a new pairing lineage', async () => {
  for (const revokeFirst of [true, false]) {
    const f = await fixture(`race${revokeFirst}`)
    const original = (await f.pair()).authorization
    await f.admit(original)
    f.advance(16 * day)
    const renewal = await f.renewal(original.authorizationId)
    const signedRenewal = await f.signProposal(renewal.payload)
    const signedRevoke = await f.revokeProof(original)
    const renew = () =>
      f.service.finish(
        f.human,
        f.manager,
        f.owner.hostId,
        original.authorizationId,
        'renew',
        signedRenewal,
      )
    const revoke = () =>
      f.service.revoke(
        f.human,
        f.manager,
        f.owner.hostId,
        f.target.deviceId,
        signedRevoke,
      )
    const operations = revokeFirst ? [revoke, renew] : [renew, revoke]
    const outcomes = await Promise.allSettled(
      operations.map((operation) => operation()),
    )
    assert.equal(outcomes[revokeFirst ? 0 : 1].status, 'fulfilled')
    assert.deepEqual(
      await f.service.listDevices(f.human, f.manager, f.owner.hostId),
      { devices: [] },
    )
    await assert.rejects(renew())
    const newPair = (await f.pair()).authorization
    await revoke()
    assert.equal(
      (await f.service.listDevices(f.human, f.manager, f.owner.hostId))
        .devices[0].authorizationId,
      newPair.authorizationId,
    )
    assert.notEqual(newPair.authorizationId, original.authorizationId)
  }
})

test('legacy confirmation rejects a control proof and the 0008 runner retains read access with 0009 installed', async () => {
  const f = await fixture('legacy')
  const request = await f.identity.requestDeviceAuthorization(
    f.human,
    f.target,
    f.owner.hostId,
    {
      spaceId: f.human.personalSpaceId,
      hostFingerprint: f.owner.fingerprint,
      hostIdentityGeneration: f.owner.claimGeneration,
    },
  )
  await assert.rejects(
    f.identity.confirmDeviceAuthorization(
      f.human,
      f.target,
      f.owner.hostId,
      await f.signProposal({ ...request.payload, scope: 'supervisor_control' }),
    ),
    { code: 'host_device_authorization_owner_mismatch' },
  )
  const legacy = await f.identity.confirmDeviceAuthorization(
    f.human,
    f.target,
    f.owner.hostId,
    await f.signProposal(request.payload),
  )
  assert.equal(legacy.authorization.scope, 'supervisor_read')
  const directory = await mkdtemp(join(tmpdir(), 'codetether-0008-'))
  const migrations = new URL('../dist/migrations/', import.meta.url)
  try {
    for (const filename of (await readdir(migrations)).filter((name) =>
      /^000[1-8]_/.test(name),
    )) {
      await copyFile(new URL(filename, migrations), join(directory, filename))
    }
    // The 0008 and 0009 binaries share the unchanged runner, but ship different SQL files.
    const result = await runMigrations(database, pathToFileURL(directory + sep))
    assert.deepEqual(result.applied, [])
    assert.equal(result.alreadyApplied.length, 8)
    const record = (
      await database.query(
        `SELECT authorization_id FROM control_plane.host_device_authorizations WHERE scope='supervisor_read' AND authorization_id=$1`,
        [legacy.authorization.authorizationId],
      )
    ).rows[0]
    assert.equal(record.authorization_id, legacy.authorization.authorizationId)
    const legacyColumns = await database.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='control_plane' AND table_name='host_device_authorizations'
          AND column_name IN ('last_used_at', 'pairing_root_authorization_id', 'superseded_by_authorization_id')`,
    )
    assert.equal(legacyColumns.rowCount, 0)

    await database.query(
      `UPDATE control_plane.host_device_authorizations SET scope='supervisor_control'
        WHERE authorization_id=$1`,
      [legacy.authorization.authorizationId],
    )
    await assert.rejects(
      f.identity.authorizeHostRequest(f.human, f.target, f.owner.hostId),
      { code: 'host_device_authorization_required' },
    )
    assert.deepEqual(
      await f.identity.listHostSupervisorAuthorizations(
        f.human,
        f.manager,
        f.owner.hostId,
      ),
      { authorizations: [] },
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('pairing HTTP routes require both account and device authentication and a Host signature', async () => {
  const f = await fixture('route')
  const running = await startControlPlaneServer({
    database,
    host: '127.0.0.1',
    port: 0,
    hostPairingService: f.service,
    humanAuthVerifier: {},
    authenticatedAccountService: {
      async verifyAndResolveRequestContext() {
        return f.human
      },
    },
    productDeviceAuthenticationService: {
      async authenticateProductDeviceRequest(_human, request) {
        if (request.compactProof !== 'fixture')
          throw new ProductDeviceAuthFailure('device_auth_required')
        return f.manager
      },
    },
  })
  try {
    const url = `http://127.0.0.1:${running.address.port}/v1/hosts/${f.owner.hostId}/pairing-sessions`
    const input = await f.manage('create', createEnrollmentChallengeId())
    const call = (headers, body = input) =>
      fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
    assert.equal((await call({})).status, 401)
    assert.equal((await call({ authorization: 'Bearer fixture' })).status, 401)
    const headers = {
      authorization: 'Bearer fixture',
      [PRODUCT_DEVICE_PROOF_HEADER]: 'fixture',
    }
    assert.equal(
      (await call(headers, { ...input, proof: 'invalid' })).status,
      403,
    )
    const response = await call(headers)
    assert.equal(response.status, 200)
    assert.equal((await response.json()).status, 'pending')
    assert.equal(response.headers.get('cache-control'), 'no-store')
  } finally {
    await running.close()
  }
})
