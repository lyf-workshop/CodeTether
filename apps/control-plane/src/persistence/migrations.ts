import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import type { ControlPlaneDatabase, SqlExecutor } from './database.js'

const migrationFilePattern = /^\d{4}_[a-z0-9_]+\.sql$/

interface AppliedMigrationRow extends Record<string, unknown> {
  readonly migration_name: string
  readonly migration_sha256: string
}

export interface MigrationResult {
  readonly applied: readonly string[]
  readonly alreadyApplied: readonly string[]
}

export type MigrationFailureStage =
  | 'advisory_lock'
  | 'migration_discovery'
  | 'migration_registry'
  | 'migration_checksum'
  | 'migration_execution'
  | 'migration_history'
  | 'migration_transaction'

export class MigrationRunError extends Error {
  public readonly stage: MigrationFailureStage
  public readonly migrationName?: string

  public constructor(
    stage: MigrationFailureStage,
    options: {
      readonly cause: unknown
      readonly migrationName?: string
    },
  ) {
    super('Control Plane migration failed', { cause: options.cause })
    this.name = 'MigrationRunError'
    this.stage = stage
    this.migrationName = options.migrationName
  }
}

async function ensureMigrationRegistry(
  transaction: SqlExecutor,
): Promise<void> {
  try {
    await transaction.query(
      'SELECT pg_advisory_xact_lock($1, $2)',
      [112_926_829, 117_966_932],
    )
  } catch (cause) {
    throw new MigrationRunError('advisory_lock', { cause })
  }

  try {
    await transaction.exec(`
      CREATE SCHEMA IF NOT EXISTS control_plane;
      CREATE TABLE IF NOT EXISTS control_plane.schema_migrations (
        migration_name text PRIMARY KEY,
        migration_sha256 text NOT NULL CHECK (migration_sha256 ~ '^[a-f0-9]{64}$'),
        applied_at timestamptz NOT NULL
      );
    `)
    await transaction.exec(
      'LOCK TABLE control_plane.schema_migrations IN EXCLUSIVE MODE',
    )
  } catch (cause) {
    throw new MigrationRunError('migration_registry', { cause })
  }
}

export async function runMigrations(
  database: ControlPlaneDatabase,
  migrationsDirectory = new URL('../migrations/', import.meta.url),
): Promise<MigrationResult> {
  let migrationNames: string[]
  try {
    migrationNames = (await readdir(migrationsDirectory))
      .filter((name) => migrationFilePattern.test(name))
      .sort((left, right) => left.localeCompare(right))
  } catch (cause) {
    throw new MigrationRunError('migration_discovery', { cause })
  }

  if (migrationNames.length === 0) {
    throw new MigrationRunError('migration_discovery', {
      cause: new Error('No Control Plane migrations were found'),
    })
  }

  try {
    return await database.transaction(async (transaction) => {
      await ensureMigrationRegistry(transaction)

      const applied: string[] = []
      const alreadyApplied: string[] = []

      for (const migrationName of migrationNames) {
        let sql: string
        try {
          sql = await readFile(
            new URL(migrationName, migrationsDirectory),
            'utf8',
          )
        } catch (cause) {
          throw new MigrationRunError('migration_discovery', {
            cause,
            migrationName,
          })
        }
        const migrationSha256 = createHash('sha256').update(sql).digest('hex')
        let existing
        try {
          existing = await transaction.query<AppliedMigrationRow>(
            `SELECT migration_name, migration_sha256
               FROM control_plane.schema_migrations
              WHERE migration_name = $1`,
            [migrationName],
          )
        } catch (cause) {
          throw new MigrationRunError('migration_history', {
            cause,
            migrationName,
          })
        }

        if (existing.rowCount === 1) {
          if (existing.rows[0]?.migration_sha256 !== migrationSha256) {
            throw new MigrationRunError('migration_checksum', {
              cause: new Error('Applied migration checksum changed'),
              migrationName,
            })
          }
          alreadyApplied.push(migrationName)
          continue
        }

        try {
          await transaction.exec(sql)
        } catch (cause) {
          throw new MigrationRunError('migration_execution', {
            cause,
            migrationName,
          })
        }
        try {
          await transaction.query(
            `INSERT INTO control_plane.schema_migrations
               (migration_name, migration_sha256, applied_at)
             VALUES ($1, $2, $3)`,
            [migrationName, migrationSha256, new Date()],
          )
        } catch (cause) {
          throw new MigrationRunError('migration_history', {
            cause,
            migrationName,
          })
        }
        applied.push(migrationName)
      }

      return { applied, alreadyApplied }
    })
  } catch (cause) {
    if (cause instanceof MigrationRunError) throw cause
    throw new MigrationRunError('migration_transaction', { cause })
  }
}
