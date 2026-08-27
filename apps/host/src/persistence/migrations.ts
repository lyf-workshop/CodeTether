import type { DatabaseSync } from 'node:sqlite'

interface Migration {
  readonly version: number
  readonly name: string
  readonly sql: string
}

const migrations: readonly Migration[] = [
  {
    version: 1,
    name: 'initial',
    sql: `
      CREATE TABLE conversations (
        conversation_id TEXT PRIMARY KEY,
        provider TEXT NOT NULL CHECK (provider = 'codex'),
        provider_thread_id TEXT,
        cwd TEXT NOT NULL,
        model TEXT,
        reasoning TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE turns (
        turn_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        provider_turn_id TEXT,
        input TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        snapshot_version INTEGER NOT NULL CHECK (snapshot_version > 0),
        snapshot_json TEXT NOT NULL,
        FOREIGN KEY (conversation_id)
          REFERENCES conversations(conversation_id)
          ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX idx_conversations_updated_at
        ON conversations(updated_at DESC);

      CREATE INDEX idx_turns_conversation_chronology
        ON turns(conversation_id, started_at, turn_id);
    `,
  },
]

export const currentSchemaVersion = migrations.at(-1)?.version ?? 0

export function migrateDatabase(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    ) STRICT;
  `)

  const applied = database
    .prepare('SELECT version, name FROM schema_migrations ORDER BY version ASC')
    .all() as Array<{ readonly version: number; readonly name: string }>

  for (const row of applied) {
    const expected = migrations.find(
      (migration) => migration.version === row.version,
    )
    if (expected === undefined || expected.name !== row.name) {
      throw new Error(
        `Unsupported SQLite schema migration ${String(row.version)} (${row.name})`,
      )
    }
  }

  const appliedVersions = new Set(applied.map((row) => row.version))
  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue
    applyMigration(database, migration)
  }
}

function applyMigration(database: DatabaseSync, migration: Migration): void {
  database.exec('BEGIN IMMEDIATE')
  try {
    database.exec(migration.sql)
    database
      .prepare(
        'INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)',
      )
      .run(migration.version, migration.name, new Date().toISOString())
    database.exec('COMMIT')
  } catch (error) {
    try {
      database.exec('ROLLBACK')
    } catch {
      // Preserve the original migration failure; SQLite may have rolled back.
    }
    throw error
  }
}
