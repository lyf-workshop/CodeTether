import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  HumanAuthNotConfiguredError,
  UnconfiguredHumanAuthVerifier,
  createHostId,
  createLoginIdentityId,
  createProductDeviceId,
  createSpaceId,
  createUserId,
  hostIdSchema,
  loginIdentityIdSchema,
  productDeviceIdSchema,
  readControlPlaneDatabaseConfiguration,
  readControlPlaneConfiguration,
  spaceIdSchema,
  startControlPlaneServer,
  userIdSchema,
} from '../dist/index.js'

test('account IDs are opaque, strongly namespaced, and mutually distinct', () => {
  const userId = createUserId()
  const loginIdentityId = createLoginIdentityId()
  const spaceId = createSpaceId()
  const deviceId = createProductDeviceId()
  const hostId = createHostId()

  assert.equal(userIdSchema.parse(userId), userId)
  assert.equal(loginIdentityIdSchema.parse(loginIdentityId), loginIdentityId)
  assert.equal(spaceIdSchema.parse(spaceId), spaceId)
  assert.equal(productDeviceIdSchema.parse(deviceId), deviceId)
  assert.equal(hostIdSchema.parse(hostId), hostId)
  assert.throws(() => hostIdSchema.parse('machine_0123456789abcdef'))
  assert.throws(() => userIdSchema.parse(spaceId))
  assert.equal(
    new Set([userId, loginIdentityId, spaceId, deviceId, hostId]).size,
    5,
  )
})

test('configuration requires PostgreSQL and defaults to loopback only', () => {
  const configuration = readControlPlaneDatabaseConfiguration({
    CODETETHER_CONTROL_PLANE_DATABASE_URL:
      'postgresql://control-plane.invalid/codetether',
  })
  assert.equal(configuration.listenHost, '127.0.0.1')
  assert.equal(configuration.listenPort, 4320)
  assert.equal(configuration.databaseTls, 'verify-full')
  assert.throws(() =>
    readControlPlaneDatabaseConfiguration({
      CODETETHER_CONTROL_PLANE_DATABASE_URL: 'sqlite:///unsafe.db',
    }),
  )
  assert.throws(() =>
    readControlPlaneDatabaseConfiguration({
      CODETETHER_CONTROL_PLANE_DATABASE_URL:
        'postgresql://control-plane.invalid/codetether',
      CODETETHER_CONTROL_PLANE_LISTEN_HOST: '0.0.0.0',
    }),
  )
  const authenticated = readControlPlaneConfiguration({
    CODETETHER_CONTROL_PLANE_DATABASE_URL:
      'postgresql://control-plane.invalid/codetether',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'a'.repeat(32)}`,
  })
  assert.equal(authenticated.supabaseUrl, 'https://example.supabase.co')
  assert.throws(() =>
    readControlPlaneConfiguration({
      CODETETHER_CONTROL_PLANE_DATABASE_URL:
        'postgresql://control-plane.invalid/codetether',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: `eyJ${'a'.repeat(40)}`,
    }),
  )
})

test('human Auth boundary is present but deliberately unconfigured', async () => {
  const verifier = new UnconfiguredHumanAuthVerifier()
  await assert.rejects(
    verifier.verifyAccessToken('not-a-real-token'),
    HumanAuthNotConfiguredError,
  )
})

test('server exposes only bounded health and readiness endpoints', async () => {
  const database = {
    async query() {
      return { rows: [{ ready: 1 }], rowCount: 1 }
    },
    async exec() {},
    async transaction(operation) {
      return operation(this)
    },
    async close() {},
  }
  const running = await startControlPlaneServer({
    database,
    host: '127.0.0.1',
    port: 0,
  })
  try {
    const origin = `http://127.0.0.1:${running.address.port}`
    const health = await fetch(`${origin}/healthz`)
    assert.equal(health.status, 200)
    assert.deepEqual(await health.json(), { status: 'ok' })

    const readiness = await fetch(`${origin}/readyz`)
    assert.equal(readiness.status, 200)
    assert.deepEqual(await readiness.json(), { status: 'ready' })

    const absentMutation = await fetch(`${origin}/users`, { method: 'POST' })
    assert.equal(absentMutation.status, 405)
  } finally {
    await running.close()
  }
})

test('readiness fails closed without disclosing database errors', async () => {
  const database = {
    async query() {
      throw new Error(
        'postgresql://secret-user:secret-password@example.invalid',
      )
    },
    async exec() {},
    async transaction(operation) {
      return operation(this)
    },
    async close() {},
  }
  const running = await startControlPlaneServer({
    database,
    host: '127.0.0.1',
    port: 0,
  })
  try {
    const response = await fetch(
      `http://127.0.0.1:${running.address.port}/readyz`,
    )
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { status: 'unavailable' })
  } finally {
    await running.close()
  }
})
