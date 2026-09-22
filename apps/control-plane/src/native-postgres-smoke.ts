import { createSpaceId, createUserId } from './domain/ids.js'
import type { ControlPlaneDatabase } from './persistence/database.js'
import { ControlPlaneRepository } from './persistence/control-plane-repository.js'
import type { PostgresClientTlsEvidence } from './persistence/postgres-database.js'
import {
  MigrationRunError,
  runMigrations,
  type MigrationResult,
} from './persistence/migrations.js'

const expectedTables = new Set([
  'device_registration_challenges',
  'device_request_nonces',
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

export type NativePostgresSmokeStage =
  | 'client_tls_verification'
  | 'schema_inspection'
  | 'backend_tls_observation'
  | 'statement_timeout'
  | 'advisory_lock'
  | 'migration_discovery'
  | 'migration_registry'
  | 'migration_checksum'
  | 'migration'
  | 'migration_history'
  | 'migration_transaction'
  | 'migration_repeat'
  | 'migration_repeat_noop'
  | 'schema_verification'
  | 'fixture_write_read'
  | 'fixture_rollback_cleanup'

export class NativePostgresSmokeError extends Error {
  public readonly stage: NativePostgresSmokeStage
  public readonly migration?: string
  public readonly reason?: string

  public constructor(
    stage: NativePostgresSmokeStage,
    options: {
      readonly cause: unknown
      readonly migration?: string
      readonly reason?: string
    },
  ) {
    super('Native PostgreSQL smoke stage failed', { cause: options.cause })
    this.name = 'NativePostgresSmokeError'
    this.stage = stage
    this.migration = options.migration
    this.reason = options.reason
  }
}

interface TableRow extends Record<string, unknown> {
  readonly table_name: string
}

export interface NativePostgresSmokeResult {
  readonly tls: boolean
  readonly clientTlsVerified: boolean
  readonly backendTlsObservation: BackendTlsObservation
  readonly connectionKind: ManagedPostgresConnectionKind
  readonly firstMigration: MigrationResult
  readonly repeatedMigration: MigrationResult
  readonly fixtureRolledBack: boolean
  readonly constraintCount: number
  readonly triggerCount: number
}

export type ManagedPostgresConnectionKind =
  'supabase_pooler' | 'direct_postgres' | 'other_managed_postgres'

export type BackendTlsObservation =
  | 'reported_tls'
  | 'not_reported_through_pooler'
  | 'unavailable_through_pooler'
  | 'not_reported'
  | 'unavailable'

export interface NativePostgresSmokeOptions {
  readonly clientTls: PostgresClientTlsEvidence
  readonly connectionKind: ManagedPostgresConnectionKind
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

async function atSmokeStage<Result>(
  stage: NativePostgresSmokeStage,
  operation: () => Promise<Result>,
  reason?: string,
): Promise<Result> {
  try {
    return await operation()
  } catch (cause) {
    if (cause instanceof NativePostgresSmokeError) throw cause
    throw new NativePostgresSmokeError(stage, { cause, reason })
  }
}

export function classifyManagedPostgresConnection(
  connectionString: string,
): ManagedPostgresConnectionKind {
  const hostname = new URL(connectionString).hostname.toLowerCase()
  if (
    hostname === 'pooler.supabase.com' ||
    hostname.endsWith('.pooler.supabase.com')
  ) {
    return 'supabase_pooler'
  }
  if (/^db\.[a-z0-9-]+\.supabase\.co$/.test(hostname)) {
    return 'direct_postgres'
  }
  return 'other_managed_postgres'
}

function assertVerifiedClientTls(evidence: PostgresClientTlsEvidence): void {
  if (evidence.verificationMode !== 'verified_ca') {
    throw new NativePostgresSmokeError('client_tls_verification', {
      cause: new Error('Verified CA mode is required'),
      reason: 'client_tls_not_configured_for_verified_ca',
    })
  }
  if (!evidence.encrypted) {
    throw new NativePostgresSmokeError('client_tls_verification', {
      cause: new Error('Client transport is not encrypted'),
      reason: 'client_transport_not_tls',
    })
  }
  if (!evidence.authorized || evidence.authorizationErrorPresent) {
    throw new NativePostgresSmokeError('client_tls_verification', {
      cause: new Error('Client TLS peer is not authorized'),
      reason: 'client_certificate_not_authorized',
    })
  }
}

async function observeBackendTls(
  database: ControlPlaneDatabase,
  connectionKind: ManagedPostgresConnectionKind,
): Promise<BackendTlsObservation> {
  let reported: boolean
  try {
    const result = await database.query<{ readonly ssl: boolean }>(
      `SELECT ssl
         FROM pg_stat_ssl
        WHERE pid = pg_backend_pid()`,
    )
    reported = result.rows[0]?.ssl === true
  } catch (cause) {
    if (connectionKind === 'direct_postgres') {
      throw new NativePostgresSmokeError('backend_tls_observation', {
        cause,
        reason: 'direct_backend_tls_observation_unavailable',
      })
    }
    return connectionKind === 'supabase_pooler'
      ? 'unavailable_through_pooler'
      : 'unavailable'
  }

  if (reported) return 'reported_tls'
  if (connectionKind === 'direct_postgres') {
    throw new NativePostgresSmokeError('backend_tls_observation', {
      cause: new Error('Direct PostgreSQL backend did not report TLS'),
      reason: 'direct_backend_did_not_report_tls',
    })
  }
  return connectionKind === 'supabase_pooler'
    ? 'not_reported_through_pooler'
    : 'not_reported'
}

function migrationSmokeError(
  cause: unknown,
  repeated: boolean,
): NativePostgresSmokeError {
  if (!(cause instanceof MigrationRunError)) {
    return new NativePostgresSmokeError(
      repeated ? 'migration_repeat' : 'migration_transaction',
      { cause },
    )
  }

  const stage: NativePostgresSmokeStage =
    cause.stage === 'migration_execution'
      ? 'migration'
      : cause.stage === 'migration_transaction'
        ? repeated
          ? 'migration_repeat'
          : 'migration_transaction'
        : cause.stage
  return new NativePostgresSmokeError(stage, {
    cause,
    migration: cause.migrationName,
    reason: repeated ? 'repeat_migration_failed' : undefined,
  })
}

export async function runNativePostgresSmoke(
  database: ControlPlaneDatabase,
  options: NativePostgresSmokeOptions,
): Promise<NativePostgresSmokeResult> {
  assertVerifiedClientTls(options.clientTls)
  await atSmokeStage('schema_inspection', () =>
    inspectSchemaBeforeMigration(database),
  )
  const backendTlsObservation = await observeBackendTls(
    database,
    options.connectionKind,
  )
  const statementTimeout = await atSmokeStage('statement_timeout', () =>
    database.query<{
      readonly statement_timeout: string
    }>('SHOW statement_timeout'),
  )
  if (
    !statementTimeout.rows[0]?.statement_timeout ||
    statementTimeout.rows[0].statement_timeout === '0'
  ) {
    throw new NativePostgresSmokeError('statement_timeout', {
      cause: new Error('Statement timeout is not active'),
      reason: 'statement_timeout_inactive',
    })
  }
  let firstMigration: MigrationResult
  try {
    firstMigration = await runMigrations(database)
  } catch (cause) {
    throw migrationSmokeError(cause, false)
  }
  let repeatedMigration: MigrationResult
  try {
    repeatedMigration = await runMigrations(database)
  } catch (cause) {
    throw migrationSmokeError(cause, true)
  }
  if (repeatedMigration.applied.length !== 0) {
    throw new NativePostgresSmokeError('migration_repeat_noop', {
      cause: new Error('Repeated migration applied new files'),
      reason: 'repeat_migration_not_noop',
    })
  }

  const constraints = await atSmokeStage('schema_verification', () =>
    database.query<{ readonly count: string }>(
      `SELECT count(*)::text AS count
         FROM information_schema.table_constraints
        WHERE table_schema = 'control_plane'`,
    ),
  )
  const triggers = await atSmokeStage('schema_verification', () =>
    database.query<{ readonly count: string }>(
      `SELECT count(*)::text AS count
         FROM information_schema.triggers
        WHERE trigger_schema = 'control_plane'`,
    ),
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
    if (error !== fixtureRollback) {
      throw new NativePostgresSmokeError('fixture_write_read', {
        cause: error,
      })
    }
  }
  const afterRollback = await atSmokeStage('fixture_rollback_cleanup', () =>
    database.query(
      `SELECT user_id
           FROM control_plane.users
          WHERE user_id = $1`,
      [fixtureUserId],
    ),
  )
  if (afterRollback.rowCount !== 0) {
    throw new NativePostgresSmokeError('fixture_rollback_cleanup', {
      cause: new Error('Native PostgreSQL fixture cleanup failed'),
      reason: 'fixture_row_remained_after_rollback',
    })
  }

  return {
    tls: true,
    clientTlsVerified: true,
    backendTlsObservation,
    connectionKind: options.connectionKind,
    firstMigration,
    repeatedMigration,
    fixtureRolledBack: true,
    constraintCount: Number(constraints.rows[0]?.count ?? 0),
    triggerCount: Number(triggers.rows[0]?.count ?? 0),
  }
}
