import { createSpaceId, createUserId } from './domain/ids.js'
import type { ControlPlaneDatabase } from './persistence/database.js'
import { ControlPlaneRepository } from './persistence/control-plane-repository.js'
import {
  runMigrations,
  type MigrationResult,
} from './persistence/migrations.js'

const expectedTables = new Set([
  'device_session_bindings',
  'enrollment_challenges',
  'host_claims',
  'host_device_authorizations',
  'hosts',
  'login_identities',
  'product_devices',
  'relay_rendezvous_bindings',
  'schema_migrations',
  'security_events',
  'space_memberships',
  'spaces',
  'users',
])

const fixtureRollback = Symbol('fixture-rollback')

interface TableRow extends Record<string, unknown> {
  readonly table_name: string
}

export interface NativePostgresSmokeResult {
  readonly tls: boolean
  readonly firstMigration: MigrationResult
  readonly repeatedMigration: MigrationResult
  readonly fixtureRolledBack: boolean
  readonly constraintCount: number
  readonly triggerCount: number
}

async function inspectSchemaBeforeMigration(
  database: ControlPlaneDatabase,
): Promise<void> {
  const privateTables = await database.query<TableRow>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'control_plane'
        AND table_type = 'BASE TABLE'`,
  )
  const names = new Set(privateTables.rows.map((row) => row.table_name))
  for (const name of names) {
    if (!expectedTables.has(name)) {
      throw new Error('Control Plane schema contains an unexpected table')
    }
  }
  if (names.size > 0 && !names.has('schema_migrations')) {
    throw new Error('Control Plane tables exist without the migration registry')
  }

  const publicConflicts = await database.query<TableRow>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])`,
    [[...expectedTables]],
  )
  if (publicConflicts.rowCount > 0) {
    throw new Error(
      'CodeTether Control Plane table name exists in public schema',
    )
  }
}

export async function runNativePostgresSmoke(
  database: ControlPlaneDatabase,
): Promise<NativePostgresSmokeResult> {
  await inspectSchemaBeforeMigration(database)
  const tlsResult = await database.query<{ readonly ssl: boolean }>(
    `SELECT ssl
       FROM pg_stat_ssl
      WHERE pid = pg_backend_pid()`,
  )
  if (tlsResult.rows[0]?.ssl !== true) {
    throw new Error('Managed PostgreSQL smoke requires verified TLS')
  }
  const statementTimeout = await database.query<{
    readonly statement_timeout: string
  }>('SHOW statement_timeout')
  if (
    !statementTimeout.rows[0]?.statement_timeout ||
    statementTimeout.rows[0].statement_timeout === '0'
  ) {
    throw new Error('Managed PostgreSQL statement timeout is not active')
  }
  const firstMigration = await runMigrations(database)
  const repeatedMigration = await runMigrations(database)

  const constraints = await database.query<{ readonly count: string }>(
    `SELECT count(*)::text AS count
       FROM information_schema.table_constraints
      WHERE table_schema = 'control_plane'`,
  )
  const triggers = await database.query<{ readonly count: string }>(
    `SELECT count(*)::text AS count
       FROM information_schema.triggers
      WHERE trigger_schema = 'control_plane'`,
  )

  const fixtureUserId = createUserId()
  const fixtureSpaceId = createSpaceId()
  try {
    await database.transaction(async (transaction) => {
      const repository = new ControlPlaneRepository(transaction)
      await repository.createUserWithPersonalSpaceRecords({
        userId: fixtureUserId,
        status: 'active',
        displayName: null,
        spaceId: fixtureSpaceId,
        spaceName: 'Native smoke fixture',
        now: new Date(),
      })
      const readBack = await transaction.query(
        `SELECT user_id
           FROM control_plane.users
          WHERE user_id = $1`,
        [fixtureUserId],
      )
      if (readBack.rowCount !== 1) {
        throw new Error('Native PostgreSQL fixture read-back failed')
      }
      throw fixtureRollback
    })
  } catch (error) {
    if (error !== fixtureRollback) throw error
  }
  const afterRollback = await database.query(
    `SELECT user_id
       FROM control_plane.users
      WHERE user_id = $1`,
    [fixtureUserId],
  )
  if (afterRollback.rowCount !== 0) {
    throw new Error('Native PostgreSQL fixture cleanup failed')
  }

  return {
    tls: tlsResult.rows[0]?.ssl === true,
    firstMigration,
    repeatedMigration,
    fixtureRolledBack: true,
    constraintCount: Number(constraints.rows[0]?.count ?? 0),
    triggerCount: Number(triggers.rows[0]?.count ?? 0),
  }
}
