import { randomUUID } from 'node:crypto'
import { posix, win32 } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

import { ProjectIdSchema } from '@codetether/protocol'

import {
  DEFAULT_CONVERSATION_TITLE,
  generateConversationTitle,
} from '../conversation-title.js'
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
  {
    version: 3,
    name: 'conversation_title',
    up: migrateConversationTitle,
  },
  {
    version: 4,
    name: 'attention',
    up: migrateAttention,
  },
  {
    version: 5,
    name: 'conversation_organization',
    up: migrateConversationOrganization,
  },
  {
    version: 6,
    name: 'conversation_search',
    up: migrateConversationSearch,
  },
  {
    version: 7,
    name: 'provider_foundation',
    up: migrateProviderFoundation,
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

interface LegacyConversationInputRow {
  readonly conversation_id: string
  readonly input: string | null
}

function migrateConversationTitle(database: DatabaseSync): void {
  database.exec(`
    ALTER TABLE conversations ADD COLUMN title TEXT NOT NULL
      DEFAULT '${DEFAULT_CONVERSATION_TITLE}'
      CHECK (length(title) BETWEEN 1 AND 240 AND title = trim(title));

    ALTER TABLE conversations ADD COLUMN last_activity_at TEXT NOT NULL
      DEFAULT '1970-01-01T00:00:00.000Z';

    UPDATE conversations SET last_activity_at = updated_at;

    DROP INDEX idx_conversations_project_updated_at;
    CREATE INDEX idx_conversations_project_last_activity
      ON conversations(project_id, last_activity_at DESC, conversation_id ASC);
  `)

  const conversations = database
    .prepare(
      `SELECT
         conversations.conversation_id,
         first_turn.input
       FROM conversations
       LEFT JOIN turns AS first_turn
         ON first_turn.rowid = (
           SELECT turns.rowid
           FROM turns
           WHERE turns.conversation_id = conversations.conversation_id
           ORDER BY turns.started_at ASC, turns.rowid ASC
           LIMIT 1
         )
       ORDER BY conversations.rowid ASC`,
    )
    .all() as unknown as LegacyConversationInputRow[]
  const updateTitle = database.prepare(
    'UPDATE conversations SET title = ? WHERE conversation_id = ?',
  )

  for (const conversation of conversations) {
    if (conversation.input === null) continue
    const input = parseLegacyTextInput(
      conversation.input,
      conversation.conversation_id,
    )
    updateTitle.run(
      generateConversationTitle(input),
      conversation.conversation_id,
    )
  }
}

function migrateAttention(database: DatabaseSync): void {
  database.exec(`
    CREATE UNIQUE INDEX idx_conversations_attention_identity
      ON conversations(conversation_id, project_id);

    CREATE UNIQUE INDEX idx_turns_attention_identity
      ON turns(turn_id, conversation_id);

    CREATE TABLE attention_items (
      attention_id TEXT PRIMARY KEY
        CHECK (
          length(attention_id) BETWEEN 11 AND 128 AND
          substr(attention_id, 1, 5) = 'attn_' AND
          attention_id = trim(attention_id)
        ),
      source_key TEXT NOT NULL UNIQUE
        CHECK (
          length(source_key) BETWEEN 1 AND 512 AND
          source_key = trim(source_key)
        ),
      project_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      turn_id TEXT,
      type TEXT NOT NULL
        CHECK (type IN ('approval', 'completed_review', 'failed')),
      status TEXT NOT NULL
        CHECK (status IN ('open', 'resolved', 'expired')),
      payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT,
      CHECK (
        (status = 'open' AND resolved_at IS NULL) OR
        (status IN ('resolved', 'expired') AND resolved_at IS NOT NULL)
      ),
      CHECK (status <> 'expired' OR type = 'approval'),
      FOREIGN KEY (project_id)
        REFERENCES projects(project_id)
        ON DELETE RESTRICT,
      FOREIGN KEY (conversation_id, project_id)
        REFERENCES conversations(conversation_id, project_id)
        ON DELETE RESTRICT,
      FOREIGN KEY (turn_id, conversation_id)
        REFERENCES turns(turn_id, conversation_id)
        ON DELETE RESTRICT
    ) STRICT;

    CREATE INDEX idx_attention_status_priority
      ON attention_items(status, type, created_at DESC, attention_id ASC);

    CREATE INDEX idx_attention_project_status_priority
      ON attention_items(
        project_id, status, type, created_at DESC, attention_id ASC
      );

    CREATE INDEX idx_attention_conversation_order
      ON attention_items(conversation_id, created_at DESC, attention_id ASC);
  `)
}

function migrateConversationOrganization(database: DatabaseSync): void {
  database.exec(`
    ALTER TABLE conversations ADD COLUMN title_source TEXT NOT NULL
      DEFAULT 'generated'
      CHECK (title_source IN ('generated', 'manual'));

    ALTER TABLE conversations ADD COLUMN pinned_at TEXT;

    ALTER TABLE conversations ADD COLUMN archived_at TEXT
      CHECK (archived_at IS NULL OR pinned_at IS NULL);

    DROP INDEX idx_conversations_project_last_activity;

    CREATE INDEX idx_conversations_project_active_order
      ON conversations(
        project_id,
        (pinned_at IS NULL),
        pinned_at DESC,
        last_activity_at DESC,
        conversation_id ASC
      )
      WHERE archived_at IS NULL AND status <> 'creating';

    CREATE INDEX idx_conversations_project_archived_order
      ON conversations(project_id, archived_at DESC, conversation_id ASC)
      WHERE archived_at IS NOT NULL AND status <> 'creating';

    CREATE INDEX idx_conversations_project_title
      ON conversations(project_id, title, conversation_id ASC);
  `)
}

/**
 * Search intentionally uses a small normalized projection instead of FTS5.
 * The production Node SEA includes FTS5, but its unicode61 token boundaries do
 * not provide predictable substring matching for short CJK queries. Keeping
 * one title document and one canonical-input document per Turn gives SQLite a
 * bounded, Project-scoped source that never inspects snapshot_json.
 *
 * `codetether_search_normalize` is a deterministic function registered by the
 * ConversationStore before migrations run. Triggers keep the projection in
 * the same transaction as every durable source mutation.
 */
function migrateConversationSearch(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE conversation_search_documents (
      document_key TEXT PRIMARY KEY
        CHECK (
          length(document_key) BETWEEN 1 AND 300 AND
          document_key = trim(document_key)
        ),
      conversation_id TEXT NOT NULL,
      turn_id TEXT,
      field TEXT NOT NULL CHECK (field IN ('title', 'user_input')),
      normalized_text TEXT NOT NULL,
      CHECK (
        (field = 'title' AND turn_id IS NULL) OR
        (field = 'user_input' AND turn_id IS NOT NULL)
      ),
      FOREIGN KEY (conversation_id)
        REFERENCES conversations(conversation_id)
        ON DELETE CASCADE,
      FOREIGN KEY (turn_id, conversation_id)
        REFERENCES turns(turn_id, conversation_id)
        ON DELETE CASCADE
    ) STRICT;

    CREATE INDEX idx_conversation_search_documents_owner
      ON conversation_search_documents(conversation_id, field, turn_id);

    INSERT INTO conversation_search_documents (
      document_key, conversation_id, turn_id, field, normalized_text
    )
    SELECT
      'conversation:' || conversation_id,
      conversation_id,
      NULL,
      'title',
      codetether_search_normalize(title)
    FROM conversations;

    INSERT INTO conversation_search_documents (
      document_key, conversation_id, turn_id, field, normalized_text
    )
    SELECT
      'turn:' || turn_id,
      conversation_id,
      turn_id,
      'user_input',
      codetether_search_normalize(json_extract(input, '$.text'))
    FROM turns;

    CREATE TRIGGER trg_conversation_search_title_insert
    AFTER INSERT ON conversations
    BEGIN
      INSERT INTO conversation_search_documents (
        document_key, conversation_id, turn_id, field, normalized_text
      ) VALUES (
        'conversation:' || NEW.conversation_id,
        NEW.conversation_id,
        NULL,
        'title',
        codetether_search_normalize(NEW.title)
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

    CREATE TRIGGER trg_conversation_search_input_insert
    AFTER INSERT ON turns
    BEGIN
      INSERT INTO conversation_search_documents (
        document_key, conversation_id, turn_id, field, normalized_text
      ) VALUES (
        'turn:' || NEW.turn_id,
        NEW.conversation_id,
        NEW.turn_id,
        'user_input',
        codetether_search_normalize(json_extract(NEW.input, '$.text'))
      );
    END;

    CREATE TRIGGER trg_conversation_search_input_update
    AFTER UPDATE OF input, conversation_id ON turns
    WHEN OLD.input IS NOT NEW.input OR OLD.conversation_id IS NOT NEW.conversation_id
    BEGIN
      UPDATE conversation_search_documents
      SET
        conversation_id = NEW.conversation_id,
        turn_id = NEW.turn_id,
        normalized_text = codetether_search_normalize(
          json_extract(NEW.input, '$.text')
        )
      WHERE document_key = 'turn:' || OLD.turn_id;
    END;
  `)
}

/**
 * SQLite cannot alter the Provider CHECK constraint in place. Rebuild the
 * complete Conversation dependency graph so every foreign key continues to
 * target the canonical table names and every durable projection is preserved.
 */
function migrateProviderFoundation(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE conversations_v7 (
      conversation_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      provider TEXT NOT NULL
        CHECK (provider IN ('codex', 'claude-code')),
      provider_thread_id TEXT,
      cwd TEXT NOT NULL,
      model TEXT,
      reasoning TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      title TEXT NOT NULL
        DEFAULT '${DEFAULT_CONVERSATION_TITLE}'
        CHECK (length(title) BETWEEN 1 AND 240 AND title = trim(title)),
      last_activity_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
      title_source TEXT NOT NULL DEFAULT 'generated'
        CHECK (title_source IN ('generated', 'manual')),
      pinned_at TEXT,
      archived_at TEXT CHECK (archived_at IS NULL OR pinned_at IS NULL),
      FOREIGN KEY (project_id)
        REFERENCES projects(project_id)
        ON DELETE RESTRICT
    ) STRICT;

    CREATE TABLE turns_v7 (
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
        REFERENCES conversations_v7(conversation_id)
        ON DELETE CASCADE
    ) STRICT;

    -- Composite identities are required by the dependent Attention/Search
    -- foreign keys while both old and replacement graphs coexist.
    CREATE UNIQUE INDEX idx_conversations_v7_attention_identity
      ON conversations_v7(conversation_id, project_id);
    CREATE UNIQUE INDEX idx_turns_v7_attention_identity
      ON turns_v7(turn_id, conversation_id);

    CREATE TABLE attention_items_v7 (
      attention_id TEXT PRIMARY KEY
        CHECK (
          length(attention_id) BETWEEN 11 AND 128 AND
          substr(attention_id, 1, 5) = 'attn_' AND
          attention_id = trim(attention_id)
        ),
      source_key TEXT NOT NULL UNIQUE
        CHECK (
          length(source_key) BETWEEN 1 AND 512 AND
          source_key = trim(source_key)
        ),
      project_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      turn_id TEXT,
      type TEXT NOT NULL
        CHECK (type IN ('approval', 'completed_review', 'failed')),
      status TEXT NOT NULL
        CHECK (status IN ('open', 'resolved', 'expired')),
      payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT,
      CHECK (
        (status = 'open' AND resolved_at IS NULL) OR
        (status IN ('resolved', 'expired') AND resolved_at IS NOT NULL)
      ),
      CHECK (status <> 'expired' OR type = 'approval'),
      FOREIGN KEY (project_id)
        REFERENCES projects(project_id)
        ON DELETE RESTRICT,
      FOREIGN KEY (conversation_id, project_id)
        REFERENCES conversations_v7(conversation_id, project_id)
        ON DELETE RESTRICT,
      FOREIGN KEY (turn_id, conversation_id)
        REFERENCES turns_v7(turn_id, conversation_id)
        ON DELETE RESTRICT
    ) STRICT;

    CREATE TABLE conversation_search_documents_v7 (
      document_key TEXT PRIMARY KEY
        CHECK (
          length(document_key) BETWEEN 1 AND 300 AND
          document_key = trim(document_key)
        ),
      conversation_id TEXT NOT NULL,
      turn_id TEXT,
      field TEXT NOT NULL CHECK (field IN ('title', 'user_input')),
      normalized_text TEXT NOT NULL,
      CHECK (
        (field = 'title' AND turn_id IS NULL) OR
        (field = 'user_input' AND turn_id IS NOT NULL)
      ),
      FOREIGN KEY (conversation_id)
        REFERENCES conversations_v7(conversation_id)
        ON DELETE CASCADE,
      FOREIGN KEY (turn_id, conversation_id)
        REFERENCES turns_v7(turn_id, conversation_id)
        ON DELETE CASCADE
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
    ORDER BY rowid ASC;

    INSERT INTO turns_v7 (
      turn_id, conversation_id, provider_turn_id, input, status, started_at,
      completed_at, snapshot_version, snapshot_json
    )
    SELECT
      turn_id, conversation_id, provider_turn_id, input, status, started_at,
      completed_at, snapshot_version, snapshot_json
    FROM turns
    ORDER BY rowid ASC;

    INSERT INTO attention_items_v7 (
      attention_id, source_key, project_id, conversation_id, turn_id, type,
      status, payload_json, created_at, updated_at, resolved_at
    )
    SELECT
      attention_id, source_key, project_id, conversation_id, turn_id, type,
      status, payload_json, created_at, updated_at, resolved_at
    FROM attention_items
    ORDER BY rowid ASC;

    INSERT INTO conversation_search_documents_v7 (
      document_key, conversation_id, turn_id, field, normalized_text
    )
    SELECT document_key, conversation_id, turn_id, field, normalized_text
    FROM conversation_search_documents
    ORDER BY rowid ASC;

    DROP TABLE conversation_search_documents;
    DROP TABLE attention_items;
    DROP TABLE turns;
    DROP TABLE conversations;

    CREATE UNIQUE INDEX idx_conversations_attention_identity
      ON conversations_v7(conversation_id, project_id);
    CREATE UNIQUE INDEX idx_turns_attention_identity
      ON turns_v7(turn_id, conversation_id);
    DROP INDEX idx_conversations_v7_attention_identity;
    DROP INDEX idx_turns_v7_attention_identity;

    ALTER TABLE conversations_v7 RENAME TO conversations;
    ALTER TABLE turns_v7 RENAME TO turns;
    ALTER TABLE attention_items_v7 RENAME TO attention_items;
    ALTER TABLE conversation_search_documents_v7
      RENAME TO conversation_search_documents;

    CREATE INDEX idx_conversations_updated_at
      ON conversations(updated_at DESC);

    CREATE INDEX idx_conversations_project_active_order
      ON conversations(
        project_id,
        (pinned_at IS NULL),
        pinned_at DESC,
        last_activity_at DESC,
        conversation_id ASC
      )
      WHERE archived_at IS NULL AND status <> 'creating';

    CREATE INDEX idx_conversations_project_archived_order
      ON conversations(project_id, archived_at DESC, conversation_id ASC)
      WHERE archived_at IS NOT NULL AND status <> 'creating';

    CREATE INDEX idx_conversations_project_title
      ON conversations(project_id, title, conversation_id ASC);

    CREATE INDEX idx_turns_conversation_chronology
      ON turns(conversation_id, started_at, turn_id);

    CREATE INDEX idx_attention_status_priority
      ON attention_items(status, type, created_at DESC, attention_id ASC);

    CREATE INDEX idx_attention_project_status_priority
      ON attention_items(
        project_id, status, type, created_at DESC, attention_id ASC
      );

    CREATE INDEX idx_attention_conversation_order
      ON attention_items(conversation_id, created_at DESC, attention_id ASC);

    CREATE INDEX idx_conversation_search_documents_owner
      ON conversation_search_documents(conversation_id, field, turn_id);

    CREATE TRIGGER trg_conversation_search_title_insert
    AFTER INSERT ON conversations
    BEGIN
      INSERT INTO conversation_search_documents (
        document_key, conversation_id, turn_id, field, normalized_text
      ) VALUES (
        'conversation:' || NEW.conversation_id,
        NEW.conversation_id,
        NULL,
        'title',
        codetether_search_normalize(NEW.title)
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

    CREATE TRIGGER trg_conversation_search_input_insert
    AFTER INSERT ON turns
    BEGIN
      INSERT INTO conversation_search_documents (
        document_key, conversation_id, turn_id, field, normalized_text
      ) VALUES (
        'turn:' || NEW.turn_id,
        NEW.conversation_id,
        NEW.turn_id,
        'user_input',
        codetether_search_normalize(json_extract(NEW.input, '$.text'))
      );
    END;

    CREATE TRIGGER trg_conversation_search_input_update
    AFTER UPDATE OF input, conversation_id ON turns
    WHEN OLD.input IS NOT NEW.input OR OLD.conversation_id IS NOT NEW.conversation_id
    BEGIN
      UPDATE conversation_search_documents
      SET
        conversation_id = NEW.conversation_id,
        turn_id = NEW.turn_id,
        normalized_text = codetether_search_normalize(
          json_extract(NEW.input, '$.text')
        )
      WHERE document_key = 'turn:' || OLD.turn_id;
    END;
  `)
}

function parseLegacyTextInput(value: string, conversationId: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch (error) {
    throw new Error(
      `Legacy Conversation ${conversationId} has invalid Turn input JSON`,
      { cause: error },
    )
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('type' in parsed) ||
    parsed.type !== 'text' ||
    !('text' in parsed) ||
    typeof parsed.text !== 'string'
  ) {
    throw new Error(
      `Legacy Conversation ${conversationId} has unsupported Turn input`,
    )
  }
  return parsed.text
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
