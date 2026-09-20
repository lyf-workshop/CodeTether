import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PostgresDatabase, runMigrations } from '../dist/index.js'

const connectionString = process.env.CODETETHER_CONTROL_PLANE_TEST_DATABASE_URL

test(
  'migrations bootstrap and repeat on an explicitly isolated native PostgreSQL database',
  {
    skip: connectionString
      ? false
      : 'No isolated native PostgreSQL test URL configured',
  },
  async () => {
    const databaseName = new URL(connectionString).pathname.slice(1)
    assert.match(
      databaseName,
      /(?:_test|_ci)$/,
      'Native PostgreSQL test database name must end in _test or _ci',
    )
    const database = new PostgresDatabase({ connectionString })
    try {
      await database.exec('DROP SCHEMA IF EXISTS control_plane CASCADE')
      const first = await runMigrations(database)
      const second = await runMigrations(database)
      assert.deepEqual(first.applied, ['0001_account_foundation.sql'])
      assert.deepEqual(second.alreadyApplied, ['0001_account_foundation.sql'])
    } finally {
      await database.close()
    }
  },
)
