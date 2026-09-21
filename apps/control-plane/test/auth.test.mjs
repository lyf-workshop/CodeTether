import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { before, test } from 'node:test'
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose'
import {
  AuthenticatedAccountService,
  HumanAuthFailure,
  SupabaseHumanAuthVerifier,
  createLoginIdentityId,
  runMigrations,
  startControlPlaneServer,
} from '../dist/index.js'
import { PGliteControlPlaneDatabase } from './pglite-database.mjs'

const issuer = 'https://project.supabase.co/auth/v1'
const audience = 'authenticated'
const nowSeconds = Math.floor(Date.now() / 1_000)

async function signingKey(kid) {
  const pair = await generateKeyPair('ES256')
  const publicJwk = await exportJWK(pair.publicKey)
  return {
    ...pair,
    publicJwk: { ...publicJwk, alg: 'ES256', kid, use: 'sig' },
    kid,
  }
}

async function accessToken(key, overrides = {}) {
  const claims = {
    aud: audience,
    email: 'Owner@Example.COM',
    exp: nowSeconds + 3_600,
    iat: nowSeconds,
    iss: issuer,
    role: 'authenticated',
    sub: 'supabase-subject-1',
    ...overrides,
  }
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'ES256', kid: key.kid, typ: 'JWT' })
    .sign(key.privateKey)
}

let primaryKey
let verifier

before(async () => {
  primaryKey = await signingKey('primary-key')
  verifier = new SupabaseHumanAuthVerifier({
    supabaseUrl: 'https://project.supabase.co',
    keyResolver: createLocalJWKSet({ keys: [primaryKey.publicJwk] }),
  })
})

test('valid Supabase JWT verifies with issuer, audience, expiry, and normalized email', async () => {
  const token = await accessToken(primaryKey)
  const context = await verifier.verifyAccessToken(token)
  assert.equal(context.issuer, issuer)
  assert.equal(context.subject, 'supabase-subject-1')
  assert.equal(context.verifiedNormalizedEmail, 'owner@example.com')
  assert.match(context.externalSessionIdHash, /^sha256:[A-Za-z0-9_-]{43}$/)
  assert.ok(context.expiresAt > new Date())
})

test('JWT failures are canonical and never expose token contents', async () => {
  const wrongKey = await signingKey('primary-key')
  const unknownKidKey = await signingKey('unknown-key-id')
  const tokenWithoutKid = await new SignJWT({
    aud: audience,
    exp: nowSeconds + 3_600,
    iss: issuer,
    sub: 'supabase-subject-1',
  })
    .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
    .sign(primaryKey.privateKey)
  const cases = [
    {
      token: await accessToken(wrongKey),
      code: 'invalid_signature',
    },
    {
      token: await accessToken(primaryKey, { exp: nowSeconds - 60 }),
      code: 'expired_token',
    },
    {
      token: await accessToken(primaryKey, {
        iss: 'https://other.supabase.co/auth/v1',
      }),
      code: 'wrong_issuer',
    },
    {
      token: await accessToken(primaryKey, { aud: 'wrong-audience' }),
      code: 'malformed_token',
    },
    {
      token: await accessToken(unknownKidKey),
      code: 'invalid_signature',
    },
    {
      token: tokenWithoutKid,
      code: 'unsupported_signing_mode',
    },
    { token: 'not-a-jwt', code: 'malformed_token' },
  ]
  for (const scenario of cases) {
    await assert.rejects(
      verifier.verifyAccessToken(scenario.token),
      (error) =>
        error instanceof HumanAuthFailure && error.code === scenario.code,
    )
  }
})

test('legacy symmetric signing uses the Supabase Auth user endpoint without a shared secret', async () => {
  const token = await new SignJWT({
    aud: audience,
    exp: nowSeconds + 3_600,
    iss: issuer,
    sub: 'legacy-subject',
  })
    .setProtectedHeader({ alg: 'HS256', kid: 'legacy' })
    .sign(new TextEncoder().encode('not-a-product-secret'))

  await assert.rejects(
    verifier.verifyAccessToken(token),
    (error) =>
      error instanceof HumanAuthFailure &&
      error.code === 'unsupported_signing_mode',
  )

  let observedApiKey
  let observedAuthorization
  const legacyVerifier = new SupabaseHumanAuthVerifier({
    supabaseUrl: 'https://project.supabase.co',
    publishableKey: `sb_publishable_${'p'.repeat(32)}`,
    async fetch(_input, init) {
      observedApiKey = init.headers.apikey
      observedAuthorization = init.headers.authorization
      return Response.json({
        id: 'legacy-subject',
        email: 'Legacy@Example.com',
      })
    },
  })
  const context = await legacyVerifier.verifyAccessToken(token)
  assert.equal(context.subject, 'legacy-subject')
  assert.equal(context.verifiedNormalizedEmail, 'legacy@example.com')
  assert.match(observedApiKey, /^sb_publishable_/)
  assert.equal(observedAuthorization, `Bearer ${token}`)
})

test('remote JWKS cache refreshes for a newly rotated key id', async () => {
  const first = await signingKey('rotation-one')
  const second = await signingKey('rotation-two')
  let keys = [first.publicJwk]
  let requests = 0
  const server = createServer((_request, response) => {
    requests += 1
    response.writeHead(200, {
      'cache-control': 'public, max-age=600',
      'content-type': 'application/json',
    })
    response.end(JSON.stringify({ keys }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert.notEqual(typeof address, 'string')
    const rotatingVerifier = new SupabaseHumanAuthVerifier({
      supabaseUrl: `http://127.0.0.1:${address.port}`,
      jwksCooldownMilliseconds: 0,
    })
    const localIssuer = `http://127.0.0.1:${address.port}/auth/v1`
    const firstToken = await accessToken(first, { iss: localIssuer })
    await rotatingVerifier.verifyAccessToken(firstToken)
    keys = [first.publicJwk, second.publicJwk]
    const secondToken = await accessToken(second, { iss: localIssuer })
    await rotatingVerifier.verifyAccessToken(secondToken)
    assert.ok(requests >= 2)
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})

test('unknown Supabase subject atomically creates one stable User and personal Space', async () => {
  const database = await PGliteControlPlaneDatabase.create()
  try {
    await runMigrations(database)
    const service = new AuthenticatedAccountService(
      database,
      () => new Date('2026-09-20T12:00:00.000Z'),
    )
    const context = {
      issuer,
      subject: 'new-subject',
      externalSessionIdHash: `sha256:${'a'.repeat(43)}`,
      expiresAt: new Date('2026-09-20T13:00:00.000Z'),
      verifiedNormalizedEmail: 'person@example.com',
    }
    const [first, repeated] = await Promise.all([
      service.resolveVerifiedHuman(context),
      service.resolveVerifiedHuman(context),
    ])
    assert.equal(first.userId, repeated.userId)
    assert.equal(first.personalSpaceId, repeated.personalSpaceId)

    const counts = await database.query(
      `SELECT
         (SELECT count(*)::int FROM control_plane.users) AS users,
         (SELECT count(*)::int FROM control_plane.spaces) AS spaces,
         (SELECT count(*)::int FROM control_plane.login_identities) AS identities`,
    )
    assert.deepEqual(counts.rows[0], { users: 1, spaces: 1, identities: 1 })

    await assert.rejects(
      database.query(
        `INSERT INTO control_plane.login_identities (
           login_identity_id, issuer, subject, user_id,
           verified_normalized_email, created_at, last_used_at
         ) VALUES ($1, $2, $3, $4, NULL, $5, $5)`,
        [
          createLoginIdentityId(),
          issuer,
          context.subject,
          first.userId,
          new Date('2026-09-20T12:00:00.000Z'),
        ],
      ),
    )

    await database.query(
      `UPDATE control_plane.users SET status = 'suspended'
        WHERE user_id = $1`,
      [first.userId],
    )
    await assert.rejects(
      service.resolveVerifiedHuman(context),
      (error) =>
        error instanceof HumanAuthFailure && error.code === 'suspended_user',
    )
  } finally {
    await database.close()
  }
})

test('authenticated account route returns only bounded application identity', async () => {
  const database = await PGliteControlPlaneDatabase.create()
  await runMigrations(database)
  const accountService = new AuthenticatedAccountService(
    database,
    () => new Date('2026-09-20T12:00:00.000Z'),
  )
  const fakeVerifier = {
    async verifyAccessToken() {
      return {
        issuer,
        subject: 'route-subject',
        externalSessionIdHash: `sha256:${'b'.repeat(43)}`,
        expiresAt: new Date('2026-09-20T13:00:00.000Z'),
        verifiedNormalizedEmail: null,
      }
    },
  }
  const running = await startControlPlaneServer({
    database,
    host: '127.0.0.1',
    port: 0,
    humanAuthVerifier: fakeVerifier,
    authenticatedAccountService: accountService,
  })
  try {
    const origin = `http://127.0.0.1:${running.address.port}`
    const missing = await fetch(`${origin}/v1/account/me`)
    assert.equal(missing.status, 401)
    assert.deepEqual(await missing.json(), {
      status: 'authentication_failed',
      code: 'missing_authentication',
    })

    const response = await fetch(`${origin}/v1/account/me`, {
      headers: { authorization: 'Bearer opaque-test-access-token' },
    })
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.match(body.userId, /^usr_/)
    assert.match(body.personalSpaceId, /^space_/)
    assert.equal(body.status, 'active')
    assert.equal(body.deviceAuthentication, 'not_implemented_phase9a4')
    assert.equal('accessToken' in body, false)
    assert.equal('refreshToken' in body, false)
  } finally {
    await running.close()
    await database.close()
  }
})

test('Control Plane auth schema has no second human session or token authority', async () => {
  const database = await PGliteControlPlaneDatabase.create()
  try {
    await runMigrations(database)
    const columns = await database.query(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'control_plane'`,
    )
    const surface = columns.rows
      .map((row) => `${row.table_name}.${row.column_name}`)
      .join('\n')
      .toLowerCase()
    for (const forbidden of [
      'access_token',
      'refresh_token',
      'otp',
      'password',
      'auth_secret',
    ]) {
      assert.equal(surface.includes(forbidden), false, forbidden)
    }
    assert.equal(
      columns.rows.some((row) => row.table_name === 'account_sessions'),
      false,
    )
  } finally {
    await database.close()
  }
})
