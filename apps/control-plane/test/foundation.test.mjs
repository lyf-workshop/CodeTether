import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import {
  AccountFoundationService,
  ControlPlaneInvariantError,
  runMigrations,
} from '../dist/index.js'
import {
  accountInput,
  deviceInput,
  fingerprint,
  hostInput,
  id,
} from './fixtures.mjs'
import { PGliteControlPlaneDatabase } from './pglite-database.mjs'

const now = new Date('2026-09-20T12:00:00.000Z')
const later = new Date('2026-09-20T13:00:00.000Z')
const tomorrow = new Date('2026-09-21T12:00:00.000Z')
const account = accountInput('foundation', now)
const device = deviceInput(account, 'foundation', now)
const host = hostInput(account, 'foundation', now)

let database
let service
let initialMigrationResult

before(async () => {
  database = await PGliteControlPlaneDatabase.create()
  initialMigrationResult = await runMigrations(database)
  service = new AccountFoundationService(database)
  await service.createUserWithPersonalSpace(account)
  await service.registerProductDevice(device)
  await service.registerHost(host)
})

after(async () => {
  await database.close()
})

test('fresh PostgreSQL bootstrap is deterministic and repeatable', async () => {
  assert.deepEqual(initialMigrationResult.applied, [
    '0001_account_foundation.sql',
    '0002_human_auth_identity.sql',
    '0003_product_device_authentication.sql',
    '0004_host_identity_claim.sql',
    '0005_host_device_authorization.sql',
    '0006_host_supervisor_transport.sql',
    '0007_host_access_requests.sql',
  ])
  assert.deepEqual(initialMigrationResult.alreadyApplied, [])

  const repeated = await runMigrations(database)
  assert.deepEqual(repeated.applied, [])
  assert.deepEqual(repeated.alreadyApplied, [
    '0001_account_foundation.sql',
    '0002_human_auth_identity.sql',
    '0003_product_device_authentication.sql',
    '0004_host_identity_claim.sql',
    '0005_host_device_authorization.sql',
    '0006_host_supervisor_transport.sql',
    '0007_host_access_requests.sql',
  ])
})

test('concurrent migration demand serializes to one application', async () => {
  const concurrentDatabase = await PGliteControlPlaneDatabase.create()
  try {
    const results = await Promise.all([
      runMigrations(concurrentDatabase),
      runMigrations(concurrentDatabase),
    ])
    assert.equal(
      results.reduce((count, result) => count + result.applied.length, 0),
      7,
    )
    assert.equal(
      results.reduce(
        (count, result) => count + result.alreadyApplied.length,
        0,
      ),
      7,
    )
  } finally {
    await concurrentDatabase.close()
  }
})

test('createUserWithPersonalSpace is atomic and enforces one personal Space', async () => {
  const rows = await database.query(
    `SELECT u.user_id, s.space_id, m.role
       FROM control_plane.users u
       JOIN control_plane.spaces s ON s.personal_owner_user_id = u.user_id
       JOIN control_plane.space_memberships m
         ON m.space_id = s.space_id AND m.user_id = u.user_id
      WHERE u.user_id = $1`,
    [account.userId],
  )
  assert.equal(rows.rowCount, 1)
  assert.equal(rows.rows[0].role, 'owner')

  const rollbackAccount = accountInput('rollback', now)
  rollbackAccount.spaceId = account.spaceId
  await assert.rejects(service.createUserWithPersonalSpace(rollbackAccount))
  const rolledBack = await database.query(
    'SELECT user_id FROM control_plane.users WHERE user_id = $1',
    [rollbackAccount.userId],
  )
  assert.equal(rolledBack.rowCount, 0)

  await assert.rejects(
    database.query(
      `INSERT INTO control_plane.spaces
         (space_id, kind, name, personal_owner_user_id, created_at, updated_at)
       VALUES ($1, 'personal', 'Duplicate', $2, $3, $3)`,
      [id('space', 'duplicatepersonal'), account.userId, now],
    ),
  )
})

test('ProductDevice persists public metadata and supports explicit revocation', async () => {
  const stored = await database.query(
    `SELECT device_id, owner_user_id, key_generation, revoked_at
       FROM control_plane.product_devices
      WHERE device_id = $1`,
    [device.deviceId],
  )
  assert.equal(stored.rowCount, 1)
  assert.equal(stored.rows[0].owner_user_id, account.userId)
  assert.equal(stored.rows[0].key_generation, 0)
  assert.equal(stored.rows[0].revoked_at, null)

  const revocable = deviceInput(account, 'revocable', now)
  await service.registerProductDevice(revocable)
  assert.equal(
    await service.revokeProductDevice(revocable.deviceId, later),
    true,
  )
  assert.equal(
    await service.revokeProductDevice(revocable.deviceId, later),
    false,
  )
  const revoked = await database.query(
    'SELECT revoked_at FROM control_plane.product_devices WHERE device_id = $1',
    [revocable.deviceId],
  )
  assert.notEqual(revoked.rows[0].revoked_at, null)
  await assert.rejects(
    service.bindDeviceSession({
      bindingId: id('dsb', 'revokeddevicebinding'),
      externalAuthSessionHash: fingerprint('r'),
      userId: account.userId,
      deviceId: revocable.deviceId,
      deviceKeyGeneration: 0,
      bindingGeneration: 0,
      createdAt: now,
      expiresAt: tomorrow,
    }),
    ControlPlaneInvariantError,
  )
})

test('relational foreign keys reject devices without an application User', async () => {
  const invalidDevice = deviceInput(account, 'foreignkey', now)
  invalidDevice.ownerUserId = id('usr', 'absentuser')
  await assert.rejects(service.registerProductDevice(invalidDevice))
})

test('Host is a Space-owned host_* authority and never a Machine identity', async () => {
  const stored = await database.query(
    `SELECT host_id, owning_space_id, claim_state
       FROM control_plane.hosts
      WHERE host_id = $1`,
    [host.hostId],
  )
  assert.equal(stored.rowCount, 1)
  assert.equal(stored.rows[0].owning_space_id, account.spaceId)
  assert.equal(stored.rows[0].claim_state, 'claimed')
  await assert.rejects(
    database.query(
      `UPDATE control_plane.hosts
          SET host_id = 'machine_0123456789abcdef'
        WHERE host_id = $1`,
      [host.hostId],
    ),
  )
})

test('Host claim metadata is exact and constrained by state', async () => {
  const challengeId = id('enroll', 'hostclaim')
  await service.createEnrollmentChallenge({
    challengeId,
    purpose: 'host_claim',
    targetUserId: account.userId,
    targetSpaceId: account.spaceId,
    targetDeviceId: device.deviceId,
    targetHostId: host.hostId,
    nonceHash: fingerprint('c'),
    createdAt: now,
    expiresAt: tomorrow,
  })
  const claimId = id('hclaim', 'foundationclaim')
  await service.recordHostClaim({
    claimId,
    hostId: host.hostId,
    spaceId: account.spaceId,
    requestingUserId: account.userId,
    requestingDeviceId: device.deviceId,
    claimGeneration: 0,
    challengeId,
    state: 'requested',
    requestedAt: now,
    expiresAt: tomorrow,
  })
  const claims = await database.query(
    'SELECT state FROM control_plane.host_claims WHERE claim_id = $1',
    [claimId],
  )
  assert.equal(claims.rows[0].state, 'requested')
  await assert.rejects(
    database.query(
      `UPDATE control_plane.host_claims SET state = 'confirmed'
        WHERE claim_id = $1`,
      [claimId],
    ),
  )
})

test('supervisor_read metadata requires the exact Host and ProductDevice authority', async () => {
  const authorizationId = id('hauth', 'foundationauthorization')
  await service.recordHostDeviceAuthorization({
    authorizationId,
    hostId: host.hostId,
    claimGeneration: 0,
    deviceId: device.deviceId,
    deviceKeyGeneration: 0,
    deviceFingerprint: device.fingerprint,
    userId: account.userId,
    spaceId: account.spaceId,
    scope: 'supervisor_read',
    authorizationSerial: 1n,
    authorizationGeneration: 0,
    issuedAt: now,
    expiresAt: tomorrow,
  })
  const authorizations = await database.query(
    `SELECT scope FROM control_plane.host_device_authorizations
      WHERE authorization_id = $1`,
    [authorizationId],
  )
  assert.equal(authorizations.rows[0].scope, 'supervisor_read')
  await assert.rejects(
    database.query(
      `UPDATE control_plane.host_device_authorizations
          SET device_fingerprint = $2
        WHERE authorization_id = $1`,
      [authorizationId, fingerprint('z')],
    ),
  )

  await assert.rejects(
    service.recordHostDeviceAuthorization({
      authorizationId: id('hauth', 'wrongfingerprint'),
      hostId: host.hostId,
      claimGeneration: 0,
      deviceId: device.deviceId,
      deviceKeyGeneration: 0,
      deviceFingerprint: fingerprint('z'),
      userId: account.userId,
      spaceId: account.spaceId,
      scope: 'supervisor_read',
      authorizationSerial: 2n,
      authorizationGeneration: 0,
      issuedAt: now,
      expiresAt: tomorrow,
    }),
    ControlPlaneInvariantError,
  )
})

test('device session binding stores only an external session hash', async () => {
  const bindingId = id('dsb', 'foundationsession')
  await service.bindDeviceSession({
    bindingId,
    externalAuthSessionHash: fingerprint('s'),
    userId: account.userId,
    deviceId: device.deviceId,
    deviceKeyGeneration: 0,
    bindingGeneration: 0,
    createdAt: now,
    expiresAt: tomorrow,
  })
  const bindings = await database.query(
    `SELECT external_auth_session_hash
       FROM control_plane.device_session_bindings
      WHERE binding_id = $1`,
    [bindingId],
  )
  assert.equal(bindings.rows[0].external_auth_session_hash, fingerprint('s'))

  const columns = await database.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'control_plane'
        AND table_name = 'device_session_bindings'`,
  )
  const names = columns.rows.map(({ column_name }) => column_name)
  assert.equal(names.includes('access_token'), false)
  assert.equal(names.includes('refresh_token'), false)
  assert.equal(names.includes('password'), false)
  assert.equal(names.includes('otp'), false)
})

test('challenge consumption is transaction-safe, one-use, and expiry-aware', async () => {
  const challengeId = id('enroll', 'onetime')
  await service.createEnrollmentChallenge({
    challengeId,
    purpose: 'device_registration',
    targetUserId: account.userId,
    targetSpaceId: null,
    targetDeviceId: device.deviceId,
    targetHostId: null,
    nonceHash: fingerprint('o'),
    createdAt: now,
    expiresAt: tomorrow,
  })
  await service.consumeEnrollmentChallenge(
    challengeId,
    'device_registration',
    later,
  )
  await assert.rejects(
    service.consumeEnrollmentChallenge(
      challengeId,
      'device_registration',
      later,
    ),
    ControlPlaneInvariantError,
  )

  const expiredChallengeId = id('enroll', 'expired')
  await service.createEnrollmentChallenge({
    challengeId: expiredChallengeId,
    purpose: 'device_registration',
    targetUserId: account.userId,
    targetSpaceId: null,
    targetDeviceId: null,
    targetHostId: null,
    nonceHash: fingerprint('e'),
    createdAt: new Date('2026-09-18T12:00:00.000Z'),
    expiresAt: new Date('2026-09-19T12:00:00.000Z'),
  })
  await assert.rejects(
    service.consumeEnrollmentChallenge(
      expiredChallengeId,
      'device_registration',
      now,
    ),
    ControlPlaneInvariantError,
  )
})

test('rendezvous binding contains only opaque account-mediated metadata', async () => {
  const bindingId = id('rvb', 'foundationrelay')
  await service.recordRendezvousBinding({
    bindingId,
    hostId: host.hostId,
    deviceId: device.deviceId,
    opaqueRelayBindingId: 'opaque-relay-binding-foundation',
    bindingRole: 'supervisor_device',
    status: 'active',
    createdAt: now,
    expiresAt: tomorrow,
  })
  const rows = await database.query(
    `SELECT status FROM control_plane.relay_rendezvous_bindings
      WHERE binding_id = $1`,
    [bindingId],
  )
  assert.equal(rows.rows[0].status, 'active')
})

test('security events use a bounded vocabulary and are append-only', async () => {
  const eventId = id('sevt', 'foundationevent')
  await service.appendSecurityEvent({
    eventId,
    eventType: 'device_registered',
    actorKind: 'user',
    actorId: account.userId,
    targetKind: 'device',
    targetId: device.deviceId,
    outcome: 'success',
    reasonCode: null,
    correlationId: 'correlation-foundation',
    occurredAt: now,
  })
  await assert.rejects(
    service.appendSecurityEvent({
      eventId: id('sevt', 'badlongactor'),
      eventType: 'device_registered',
      actorKind: 'user',
      actorId: 'x'.repeat(129),
      targetKind: null,
      targetId: null,
      outcome: 'success',
      reasonCode: null,
      correlationId: null,
      occurredAt: now,
    }),
  )
  await assert.rejects(
    service.appendSecurityEvent({
      eventId: id('sevt', 'invalidvocabulary'),
      eventType: 'unbounded_custom_event',
      actorKind: 'control_plane',
      actorId: 'control-plane',
      targetKind: null,
      targetId: null,
      outcome: 'failure',
      reasonCode: 'rejected',
      correlationId: null,
      occurredAt: now,
    }),
  )
  await assert.rejects(
    database.query(
      `UPDATE control_plane.security_events SET outcome = 'failure'
        WHERE event_id = $1`,
      [eventId],
    ),
  )
  await assert.rejects(
    database.query(
      'DELETE FROM control_plane.security_events WHERE event_id = $1',
      [eventId],
    ),
  )
})

test('Cloud schema contains none of the forbidden product or secret fields', async () => {
  const columns = await database.query(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'control_plane'`,
  )
  const schemaSurface = columns.rows
    .map(({ table_name, column_name }) => `${table_name}.${column_name}`)
    .join('\n')
    .toLowerCase()
  const forbidden = [
    'provider_credential',
    'provider_api_key',
    'prompt',
    'transcript',
    'source_code',
    'filesystem_path',
    'project_path',
    'raw_diff',
    'terminal_output',
    'native_provider_session',
    'controller_private_key',
    'host_private_key',
    'device_private_key',
    'product_device_private_key',
    'access_token',
    'refresh_token',
    'otp_secret',
    'password_hash',
  ]
  for (const prohibitedName of forbidden) {
    assert.equal(schemaSurface.includes(prohibitedName), false, prohibitedName)
  }

  const productTruthTables = [
    'machines',
    'projects',
    'project_locations',
    'conversations',
    'turns',
    'provider_installations',
  ]
  const tables = new Set(columns.rows.map(({ table_name }) => table_name))
  for (const prohibitedTable of productTruthTables) {
    assert.equal(tables.has(prohibitedTable), false, prohibitedTable)
  }
})
