import { DatabaseSync } from 'node:sqlite'

export function createV2Database(
  databasePath,
  { projects = [], conversations = [], turns = [] } = {},
) {
  const database = new DatabaseSync(databasePath)
  try {
    database.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL
      ) STRICT;

      INSERT INTO schema_migrations(version, name, applied_at) VALUES
        (1, 'initial', '2026-08-26T12:00:00.000Z'),
        (2, 'projects', '2026-08-26T12:01:00.000Z');

      CREATE TABLE projects (
        project_id TEXT PRIMARY KEY,
        name TEXT NOT NULL
          CHECK (length(name) BETWEEN 1 AND 240 AND name = trim(name)),
        root_path TEXT NOT NULL,
        root_path_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE conversations (
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

      CREATE INDEX idx_projects_updated_at
        ON projects(updated_at DESC);
      CREATE INDEX idx_conversations_updated_at
        ON conversations(updated_at DESC);
      CREATE INDEX idx_conversations_project_updated_at
        ON conversations(project_id, updated_at DESC);
      CREATE INDEX idx_turns_conversation_chronology
        ON turns(conversation_id, started_at, turn_id);
    `)

    const insertProject = database.prepare(
      `INSERT INTO projects (
        project_id, name, root_path, root_path_key, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    for (const project of projects) {
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
      `INSERT INTO conversations (
        conversation_id, project_id, provider, provider_thread_id, cwd, model,
        reasoning, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const conversation of conversations) {
      insertConversation.run(
        conversation.conversationId,
        conversation.projectId,
        conversation.provider ?? 'codex',
        conversation.providerThreadId ?? null,
        conversation.cwd,
        conversation.model ?? null,
        conversation.reasoning ?? null,
        conversation.status ?? 'completed',
        conversation.createdAt,
        conversation.updatedAt,
      )
    }

    const insertTurn = database.prepare(
      `INSERT INTO turns (
        turn_id, conversation_id, provider_turn_id, input, status, started_at,
        completed_at, snapshot_version, snapshot_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const turn of turns) {
      insertTurn.run(
        turn.turnId,
        turn.conversationId,
        turn.providerTurnId ?? null,
        JSON.stringify(turn.input),
        turn.status ?? 'completed',
        turn.startedAt,
        turn.completedAt ?? null,
        turn.snapshotVersion ?? 1,
        JSON.stringify(turn.snapshot ?? {}),
      )
    }
  } finally {
    database.close()
  }
}
