import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'

/** Test-only reverse fixture yielding the exact schema produced by v7. */
export function downgradeMachineFoundationToVersionSeven(databasePath) {
  const database = new DatabaseSync(databasePath)
  database.exec('PRAGMA foreign_keys = OFF')
  database.exec(`
    DELETE FROM schema_migrations WHERE version IN (8, 9);

    CREATE TABLE projects_v7 (
      project_id TEXT PRIMARY KEY,
      name TEXT NOT NULL
        CHECK (length(name) BETWEEN 1 AND 240 AND name = trim(name)),
      root_path TEXT NOT NULL UNIQUE
        CHECK (
          length(root_path) BETWEEN 1 AND 4096 AND root_path = trim(root_path)
          AND instr(root_path, char(0)) = 0
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

    INSERT INTO projects_v7 (
      project_id, name, root_path, root_path_key, created_at, updated_at
    )
    SELECT
      projects.project_id, projects.name, project_locations.root_path,
      project_locations.root_path_key, projects.created_at,
      projects.updated_at
    FROM projects
    INNER JOIN project_locations
      ON project_locations.project_id = projects.project_id
    ORDER BY projects.rowid;

    CREATE TABLE conversations_v7 (
      conversation_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      provider TEXT NOT NULL CHECK (provider IN ('codex', 'claude-code')),
      provider_thread_id TEXT,
      cwd TEXT NOT NULL,
      model TEXT,
      reasoning TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'New conversation'
        CHECK (length(title) BETWEEN 1 AND 240 AND title = trim(title)),
      last_activity_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
      title_source TEXT NOT NULL DEFAULT 'generated'
        CHECK (title_source IN ('generated', 'manual')),
      pinned_at TEXT,
      archived_at TEXT CHECK (archived_at IS NULL OR pinned_at IS NULL),
      FOREIGN KEY (project_id)
        REFERENCES projects_v7(project_id)
        ON DELETE RESTRICT
    ) STRICT;

    INSERT INTO conversations_v7 (
      conversation_id, project_id, provider, provider_thread_id, cwd, model,
      reasoning, status, created_at, updated_at, title, last_activity_at,
      title_source, pinned_at, archived_at
    )
    SELECT
      conversation_id, project_id, provider, provider_thread_id, cwd, model,
      reasoning, status, created_at, updated_at, title, last_activity_at,
      title_source, pinned_at, archived_at
    FROM conversations
    ORDER BY rowid;

    DROP TABLE conversations;
    DROP TABLE project_locations;
    DROP TABLE projects;
    DROP TABLE trusted_machine_peers;
    DROP TABLE machines;
    ALTER TABLE projects_v7 RENAME TO projects;
    ALTER TABLE conversations_v7 RENAME TO conversations;

    CREATE INDEX idx_projects_updated_at ON projects(updated_at DESC);
    CREATE INDEX idx_conversations_updated_at
      ON conversations(updated_at DESC);
    CREATE UNIQUE INDEX idx_conversations_attention_identity
      ON conversations(conversation_id, project_id);
    CREATE INDEX idx_conversations_project_active_order
      ON conversations(
        project_id, (pinned_at IS NULL), pinned_at DESC,
        last_activity_at DESC, conversation_id ASC
      )
      WHERE archived_at IS NULL AND status <> 'creating';
    CREATE INDEX idx_conversations_project_archived_order
      ON conversations(project_id, archived_at DESC, conversation_id ASC)
      WHERE archived_at IS NOT NULL AND status <> 'creating';
    CREATE INDEX idx_conversations_project_title
      ON conversations(project_id, title, conversation_id ASC);

    CREATE TRIGGER trg_conversation_search_title_insert
    AFTER INSERT ON conversations
    BEGIN
      INSERT INTO conversation_search_documents (
        document_key, conversation_id, turn_id, field, normalized_text
      ) VALUES (
        'conversation:' || NEW.conversation_id, NEW.conversation_id, NULL,
        'title', codetether_search_normalize(NEW.title)
      );
    END;

    CREATE TRIGGER trg_conversation_search_title_update
    AFTER UPDATE OF title ON conversations
    WHEN OLD.title IS NOT NEW.title
    BEGIN
      UPDATE conversation_search_documents
      SET normalized_text = codetether_search_normalize(NEW.title)
      WHERE document_key = 'conversation:' || NEW.conversation_id;
    END;
  `)
  database.exec('PRAGMA foreign_keys = ON')
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), [])
  database.close()
}
