import { randomUUID } from 'node:crypto'
import { posix, win32 } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

import { ProjectIdSchema } from '@codetether/protocol'

import { normalizeTrustedProjectRoot } from '../project-path.js'

interface Migration {
  readonly version: number
  readonly name: string
  readonly up: (database: DatabaseSync) => void
}

const migrations: readonly Migration[] = [
  {
    version: 1,
    name: 'initial',
    up: (database) => {
      database.exec(`
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
      `)
    },
  },
  {
    version: 2,
    name: 'projects',
    up: migrateProjects,
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

  for (const [index, row] of applied.entries()) {
    const expected = migrations[index]
    if (
      expected === undefined ||
      row.version !== expected.version ||
      row.name !== expected.name
    ) {
      throw new Error(
        `Unsupported SQLite schema migration ${String(row.version)} (${row.name})`,
      )
    }
  }

  for (let index = applied.length; index < migrations.length; index += 1) {
    const migration = migrations[index]
    if (migration !== undefined) applyMigration(database, migration)
  }
}

function applyMigration(database: DatabaseSync, migration: Migration): void {
  database.exec('BEGIN IMMEDIATE')
  try {
    migration.up(database)
    assertForeignKeys(database)
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

interface LegacyConversationRow {
  readonly conversation_id: string
  readonly cwd: string
  readonly created_at: string
  readonly updated_at: string
}

interface BackfilledProject {
  readonly projectId: string
  readonly name: string
  readonly rootPath: string
  readonly rootPathKey: string
  createdAt: string
  updatedAt: string
}

function migrateProjects(database: DatabaseSync): void {
  const conversations = database
    .prepare(
      `SELECT conversation_id, cwd, created_at, updated_at
       FROM conversations
       ORDER BY rowid ASC`,
    )
    .all() as unknown as LegacyConversationRow[]
  const projectsByKey = new Map<string, BackfilledProject>()
  const projectKeyByConversation = new Map<string, string>()

  for (const conversation of conversations) {
    const normalized = normalizeTrustedProjectRoot(conversation.cwd)
    let project = projectsByKey.get(normalized.rootPathKey)
    if (project === undefined) {
      project = {
        projectId: newProjectId(),
        name: defaultProjectName(normalized.rootPath),
        rootPath: normalized.rootPath,
        rootPathKey: normalized.rootPathKey,
        createdAt: conversation.created_at,
        updatedAt: conversation.updated_at,
      }
      projectsByKey.set(project.rootPathKey, project)
    } else {
      if (conversation.created_at < project.createdAt) {
        project.createdAt = conversation.created_at
      }
      if (conversation.updated_at > project.updatedAt) {
        project.updatedAt = conversation.updated_at
      }
    }
    projectKeyByConversation.set(
      conversation.conversation_id,
      normalized.rootPathKey,
    )
  }

  database.exec(`
    CREATE TABLE projects (
      project_id TEXT PRIMARY KEY,
      name TEXT NOT NULL
        CHECK (length(name) BETWEEN 1 AND 240 AND name = trim(name)),
      root_path TEXT NOT NULL
        CHECK (
          length(root_path) BETWEEN 1 AND 4096 AND
          root_path = trim(root_path) AND
          instr(root_path, char(0)) = 0
        ),
      root_path_key TEXT NOT NULL UNIQUE
        CHECK (
          length(root_path_key) BETWEEN 1 AND 4096 AND
          root_path_key = trim(root_path_key) AND
          instr(root_path_key, char(0)) = 0
        ),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE conversations_v2 (
      conversation_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      provider TEXT NOT NULL CHECK (provider = 'codex'),
      provider_thread_id TEXT,
      cwd TEXT NOT NULL,
      model TEXT,
      reasoning TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id)
        REFERENCES projects(project_id)
        ON DELETE RESTRICT
    ) STRICT;

    CREATE TABLE turns_v2 (
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
        REFERENCES conversations_v2(conversation_id)
        ON DELETE CASCADE
    ) STRICT;
  `)

  const insertProject = database.prepare(
    `INSERT INTO projects (
      project_id, name, root_path, root_path_key, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)`,
  )
  for (const project of projectsByKey.values()) {
    insertProject.run(
      project.projectId,
      project.name,
      project.rootPath,
      project.rootPathKey,
      project.createdAt,
      project.updatedAt,
    )
  }

  const insertConversation = database.prepare(
    `INSERT INTO conversations_v2 (
      conversation_id, project_id, provider, provider_thread_id, cwd, model,
      reasoning, status, created_at, updated_at
    )
    SELECT conversation_id, ?, provider, provider_thread_id, cwd, model,
      reasoning, status, created_at, updated_at
    FROM conversations
    WHERE conversation_id = ?`,
  )
  for (const conversation of conversations) {
    const projectKey = projectKeyByConversation.get(
      conversation.conversation_id,
    )
    const project =
      projectKey === undefined ? undefined : projectsByKey.get(projectKey)
    if (project === undefined) {
      throw new Error(
        `Legacy Conversation ${conversation.conversation_id} has no Project mapping`,
      )
    }
    const result = insertConversation.run(
      project.projectId,
      conversation.conversation_id,
    )
    if (result.changes !== 1 && result.changes !== 1n) {
      throw new Error(
        `Legacy Conversation ${conversation.conversation_id} was not copied`,
      )
    }
  }

  database.exec(`
    INSERT INTO turns_v2 (
      turn_id, conversation_id, provider_turn_id, input, status, started_at,
      completed_at, snapshot_version, snapshot_json
    )
    SELECT turn_id, conversation_id, provider_turn_id, input, status,
      started_at, completed_at, snapshot_version, snapshot_json
    FROM turns
    ORDER BY rowid ASC;

    DROP TABLE turns;
    DROP TABLE conversations;

    ALTER TABLE conversations_v2 RENAME TO conversations;
    ALTER TABLE turns_v2 RENAME TO turns;

    CREATE INDEX idx_projects_updated_at
      ON projects(updated_at DESC);

    CREATE INDEX idx_conversations_updated_at
      ON conversations(updated_at DESC);

    CREATE INDEX idx_conversations_project_updated_at
      ON conversations(project_id, updated_at DESC);

    CREATE INDEX idx_turns_conversation_chronology
      ON turns(conversation_id, started_at, turn_id);
  `)
}

function defaultProjectName(rootPath: string): string {
  const path = process.platform === 'win32' ? win32 : posix
  const leaf = path.basename(rootPath) || rootPath
  return [...leaf].slice(0, 240).join('')
}

function newProjectId(): string {
  return ProjectIdSchema.parse(`proj_${randomUUID().replaceAll('-', '')}`)
}

function assertForeignKeys(database: DatabaseSync): void {
  const violations = database.prepare('PRAGMA foreign_key_check').all()
  if (violations.length > 0) {
    throw new Error('SQLite migration produced foreign key violations')
  }
}
