import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import {
  assertManagedDevelopmentSmokeSafety,
  classifyManagedPostgresConnection,
  MigrationRunError,
  nativePostgresSmokeFailureDiagnostic,
  NativePostgresSmokeCliError,
  NativePostgresSmokeError,
  postgresTlsConfiguration,
  runMigrations,
  runNativePostgresSmoke,
} from '../dist/index.js'
import { PGliteControlPlaneDatabase } from './pglite-database.mjs'

function configuration(overrides = {}) {
  return {
    databaseUrl: 'postgresql://redacted.invalid/postgres',
    environment: 'development',
    listenHost: '127.0.0.1',
    listenPort: 4320,
    databasePoolMax: 10,
    databaseConnectTimeoutMilliseconds: 5_000,
    databaseIdleTimeoutMilliseconds: 30_000,
    databaseStatementTimeoutMilliseconds: 15_000,
    databaseTls: 'verify-full',
    ...overrides,
  }
}

const verifiedClientTls = {
  verificationMode: 'verified_ca',
  encrypted: true,
  authorized: true,
  authorizationErrorPresent: false,
}

async function createManagedSmokeDatabase(backendTls) {
  const inner = await PGliteControlPlaneDatabase.create()
  return {
    async query(sql, parameters = []) {
      if (sql.includes('pg_stat_ssl')) {
        if (backendTls === 'unavailable') {
          throw new Error('backend metadata is unavailable')
        }
        return { rows: [{ ssl: backendTls }], rowCount: 1 }
      }
      if (sql === 'SHOW statement_timeout') {
        return { rows: [{ statement_timeout: '15s' }], rowCount: 1 }
      }
      return inner.query(sql, parameters)
    },
    async exec(sql) {
      return inner.exec(sql)
    },
    async transaction(operation) {
      return inner.transaction(operation)
    },
    async close() {
      return inner.close()
    },
  }
}

test('managed development smoke accepts the Supabase postgres database name', () => {
  assert.doesNotThrow(() =>
    assertManagedDevelopmentSmokeSafety(configuration()),
  )
})

test('managed development smoke remains bounded to development with verified TLS', () => {
  assert.throws(
    () =>
      assertManagedDevelopmentSmokeSafety(
        configuration({ environment: 'production' }),
      ),
    (error) => {
      assert.equal(error.stage, 'safety_guard')
      assert.equal(
        error.reason,
        'managed_smoke_requires_development_environment',
      )
      return true
    },
  )
  assert.throws(
    () =>
      assertManagedDevelopmentSmokeSafety(
        configuration({ databaseTls: 'disable' }),
      ),
    (error) => {
      assert.equal(error.stage, 'safety_guard')
      assert.equal(error.reason, 'managed_smoke_requires_verified_tls')
      return true
    },
  )
  assert.throws(
    () =>
      assertManagedDevelopmentSmokeSafety(
        configuration({
          databaseUrl: 'postgresql://redacted.invalid/postgres?sslmode=require',
        }),
      ),
    (error) => {
      assert.equal(error.stage, 'safety_guard')
      assert.equal(error.reason, 'database_url_tls_parameters_not_allowed')
      return true
    },
  )
})

test('node-postgres verified TLS configuration never disables certificate checks', () => {
  assert.deepEqual(postgresTlsConfiguration('verify-full'), {
    rejectUnauthorized: true,
  })
  assert.equal(postgresTlsConfiguration('disable'), false)
})

test('connection classification uses only bounded hostname categories', () => {
  assert.equal(
    classifyManagedPostgresConnection(
      'postgresql://redacted@aws-0-region.pooler.supabase.com:5432/postgres',
    ),
    'supabase_pooler',
  )
  assert.equal(
    classifyManagedPostgresConnection(
      'postgresql://redacted@db.project-ref.supabase.co:5432/postgres',
    ),
    'direct_postgres',
  )
  assert.equal(
    classifyManagedPostgresConnection(
      'postgresql://redacted@postgres.example.invalid:5432/postgres',
    ),
    'other_managed_postgres',
  )
})

test('diagnostics retain safe stage, migration, and SQLSTATE without error text', () => {
  const postgresError = Object.assign(
    new Error(
      'password=do-not-print postgresql://user:secret@example.invalid/postgres',
    ),
    { code: '42501' },
  )
  const error = new NativePostgresSmokeError('migration', {
    cause: new MigrationRunError('migration_execution', {
      cause: postgresError,
      migrationName: '0002_human_auth_identity.sql',
    }),
    migration: '0002_human_auth_identity.sql',
  })

  const diagnostic = nativePostgresSmokeFailureDiagnostic(error)
  assert.deepEqual(diagnostic, {
    component: 'control-plane',
    event: 'native_postgres_smoke_failed',
    stage: 'migration',
    errorClass: 'Error',
    code: '42501',
    migration: '0002_human_auth_identity.sql',
  })
  const serialized = JSON.stringify(diagnostic)
  assert.doesNotMatch(serialized, /do-not-print|secret|example\.invalid/)
})

test('invalid environment diagnostics expose only a bounded guard reason', () => {
  const error = new NativePostgresSmokeCliError('environment', {
    cause: new Error(
      'DATABASE_URL=postgresql://user:secret@example.invalid/db',
    ),
    reason: 'invalid_database_configuration',
  })
  const serialized = JSON.stringify(nativePostgresSmokeFailureDiagnostic(error))
  assert.match(serialized, /invalid_database_configuration/)
  assert.doesNotMatch(serialized, /secret|example\.invalid|DATABASE_URL/)
})

test('the first database query failure is reported as schema inspection', async () => {
  const database = {
    async query() {
      throw Object.assign(new Error('private connection detail'), {
        code: '42501',
      })
    },
    async exec() {},
    async transaction() {
      throw new Error('transaction must not be reached')
    },
    async close() {},
  }

  await assert.rejects(
    runNativePostgresSmoke(database, {
      clientTls: verifiedClientTls,
      connectionKind: 'supabase_pooler',
    }),
    (error) => {
      const diagnostic = nativePostgresSmokeFailureDiagnostic(error)
      assert.equal(diagnostic.stage, 'schema_inspection')
      assert.equal(diagnostic.code, '42501')
      assert.equal('message' in diagnostic, false)
      return true
    },
  )
})

test('verified client TLS passes when Supavisor backend does not report SSL', async () => {
  const database = await createManagedSmokeDatabase(false)
  try {
    const result = await runNativePostgresSmoke(database, {
      clientTls: verifiedClientTls,
      connectionKind: 'supabase_pooler',
    })
    assert.equal(result.clientTlsVerified, true)
    assert.equal(result.backendTlsObservation, 'not_reported_through_pooler')
    assert.equal(result.repeatedMigration.applied.length, 0)
    assert.equal(result.fixtureRolledBack, true)
  } finally {
    await database.close()
  }
})

test('verified client TLS and a direct backend SSL observation both pass', async () => {
  const database = await createManagedSmokeDatabase(true)
  try {
    const result = await runNativePostgresSmoke(database, {
      clientTls: verifiedClientTls,
      connectionKind: 'direct_postgres',
    })
    assert.equal(result.clientTlsVerified, true)
    assert.equal(result.backendTlsObservation, 'reported_tls')
  } finally {
    await database.close()
  }
})

test('pg_stat_ssl unavailable through a pooler remains informational', async () => {
  const database = await createManagedSmokeDatabase('unavailable')
  try {
    const result = await runNativePostgresSmoke(database, {
      clientTls: verifiedClientTls,
      connectionKind: 'supabase_pooler',
    })
    assert.equal(result.clientTlsVerified, true)
    assert.equal(result.backendTlsObservation, 'unavailable_through_pooler')
  } finally {
    await database.close()
  }
})

test('certificate verification failure fails before database smoke queries', async () => {
  let queryCount = 0
  const database = {
    async query() {
      queryCount += 1
      return { rows: [{ ssl: true }], rowCount: 1 }
    },
    async exec() {},
    async transaction() {
      throw new Error('transaction must not be reached')
    },
    async close() {},
  }

  await assert.rejects(
    runNativePostgresSmoke(database, {
      clientTls: {
        verificationMode: 'verified_ca',
        encrypted: true,
        authorized: false,
        authorizationErrorPresent: true,
      },
      connectionKind: 'direct_postgres',
    }),
    (error) => {
      const diagnostic = nativePostgresSmokeFailureDiagnostic(error)
      assert.equal(diagnostic.stage, 'client_tls_verification')
      assert.equal(diagnostic.reason, 'client_certificate_not_authorized')
      assert.equal(queryCount, 0)
      return true
    },
  )
})

test('plaintext client connection fails before backend metadata can upgrade it', async () => {
  let queryCount = 0
  const database = {
    async query() {
      queryCount += 1
      return { rows: [{ ssl: true }], rowCount: 1 }
    },
    async exec() {},
    async transaction() {
      throw new Error('transaction must not be reached')
    },
    async close() {},
  }

  await assert.rejects(
    runNativePostgresSmoke(database, {
      clientTls: {
        verificationMode: 'verified_ca',
        encrypted: false,
        authorized: false,
        authorizationErrorPresent: false,
      },
      connectionKind: 'direct_postgres',
    }),
    (error) => {
      const diagnostic = nativePostgresSmokeFailureDiagnostic(error)
      assert.equal(diagnostic.stage, 'client_tls_verification')
      assert.equal(diagnostic.reason, 'client_transport_not_tls')
      assert.equal(queryCount, 0)
      return true
    },
  )
})

test('migration execution failure identifies the exact migration file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-migration-'))
  const database = await PGliteControlPlaneDatabase.create()
  try {
    await writeFile(
      join(directory, '0001_invalid_sql.sql'),
      'THIS IS NOT VALID SQL;',
      'utf8',
    )
    await assert.rejects(
      runMigrations(database, pathToFileURL(`${directory}/`)),
      (error) => {
        assert.equal(error.stage, 'migration_execution')
        assert.equal(error.migrationName, '0001_invalid_sql.sql')
        return true
      },
    )
  } finally {
    await database.close()
    await rm(directory, { force: true, recursive: true })
  }
})

test('migration checksum drift identifies the exact history entry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-checksum-'))
  const database = await PGliteControlPlaneDatabase.create()
  const migrationPath = join(directory, '0001_checksum_probe.sql')
  try {
    await writeFile(
      migrationPath,
      'CREATE TABLE control_plane.checksum_probe (id integer PRIMARY KEY);',
      'utf8',
    )
    await runMigrations(database, pathToFileURL(`${directory}/`))
    await writeFile(
      migrationPath,
      'CREATE TABLE control_plane.checksum_probe (id bigint PRIMARY KEY);',
      'utf8',
    )
    await assert.rejects(
      runMigrations(database, pathToFileURL(`${directory}/`)),
      (error) => {
        assert.equal(error.stage, 'migration_checksum')
        assert.equal(error.migrationName, '0001_checksum_probe.sql')
        return true
      },
    )
  } finally {
    await database.close()
    await rm(directory, { force: true, recursive: true })
  }
})
