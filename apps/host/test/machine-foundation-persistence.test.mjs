import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import {
  ConversationStore,
  currentSchemaVersion,
} from '../dist/persistence/index.js'
import { normalizeTrustedProjectRoot } from '../dist/project-path.js'

const timestamp = '2026-08-30T10:00:00.000Z'
const later = '2026-08-30T10:01:00.000Z'

test('migration 008 creates one stable local Machine and preserves the complete v7 graph', () => {
  withDatabase((databasePath) => {
    const seed = ConversationStore.open({ databasePath })
    const [seedMachine] = seed.listMachines()
    assert.ok(seedMachine)
    const root = resolve(databasePath, '..', 'machine-project')
    const project = durableProject(
      'proj_machinefoundation01',
      seedMachine.machineId,
      root,
    )
    const conversation = durableConversation(
      'conv_machinefoundation01',
      project,
      'claude-code',
    )
    const turn = durableTurn(
      'turn_machinefoundation01',
      conversation.conversationId,
    )
    seed.createProject(project)
    seed.createConversation(conversation)
    seed.createTurn(turn)
    seed.renameConversation(
      conversation.conversationId,
      'Manual machine title',
      later,
    )
    seed.pinConversation(conversation.conversationId, later)
    seed.createAttentionItem({
      attentionId: 'attn_machinefoundation01',
      sourceKey: 'turn:turn_machinefoundation01:completed_review',
      projectId: project.projectId,
      conversationId: conversation.conversationId,
      turnId: turn.turnId,
      type: 'completed_review',
      payload: { conversationTitle: 'Manual machine title' },
      createdAt: later,
      updatedAt: later,
    })
    seed.close()

    downgradeMachineFoundationToVersionSeven(databasePath)

    const migrated = ConversationStore.open({ databasePath })
    assert.equal(currentSchemaVersion, 15)
    assert.equal(migrated.schemaVersion, 15)
    const [machine] = migrated.listMachines()
    assert.ok(machine)
    assert.match(machine.machineId, /^machine_/u)
    assert.equal(machine.kind, 'local')
    assert.equal(machine.displayName, '本地电脑')
    assert.equal(migrated.listMachines().length, 1)

    const preservedProject = migrated.getProject(project.projectId)
    assert.equal(preservedProject.locations[0].machineId, machine.machineId)
    assert.equal(
      preservedProject.locations[0].rootPath,
      project.locations[0].rootPath,
    )
    assert.equal(
      preservedProject.locations[0].rootPathKey,
      project.locations[0].rootPathKey,
    )
    const preservedConversation = migrated.getConversation(
      conversation.conversationId,
    )
    assert.equal(preservedConversation.machineId, machine.machineId)
    assert.equal(preservedConversation.provider, 'claude-code')
    assert.equal(preservedConversation.providerThreadId, 'session-private')
    assert.equal(preservedConversation.title, 'Manual machine title')
    assert.equal(preservedConversation.titleSource, 'manual')
    assert.equal(preservedConversation.pinnedAt, later)
    assert.deepEqual(migrated.getTurn(turn.turnId), turn)
    assert.equal(
      migrated.getAttentionItem('attn_machinefoundation01').status,
      'open',
    )
    assert.deepEqual(
      migrated
        .searchProjectConversations(project.projectId, {
          query: 'machine input marker',
        })
        .results.map((result) => result.conversation.machineId),
      [machine.machineId],
    )
    assert.deepEqual(
      migrated
        .listMachineConversations(machine.machineId, 100)
        .map((summary) => summary.conversationId),
      [conversation.conversationId],
    )

    assert.throws(
      () =>
        migrated.updateConversation({
          ...preservedConversation,
          machineId: 'machine_different000001',
        }),
      /execution binding is immutable/u,
    )
    const stableMachineId = machine.machineId
    migrated.close()

    const reopened = ConversationStore.open({ databasePath })
    assert.deepEqual(
      reopened.listMachines().map((value) => value.machineId),
      [stableMachineId],
    )
    assert.equal(
      reopened.getConversation(conversation.conversationId).machineId,
      stableMachineId,
    )
    reopened.close()

    const inspect = new DatabaseSync(databasePath)
    assert.deepEqual(inspect.prepare('PRAGMA foreign_key_check').all(), [])
    assert.equal(
      inspect
        .prepare('SELECT COUNT(*) AS count FROM machines WHERE kind = ?')
        .get('local').count,
      1,
    )
    assert.equal(
      inspect
        .prepare('SELECT name FROM schema_migrations WHERE version = 8')
        .get().name,
      'machine_foundation',
    )
    assert.throws(
      () =>
        inspect
          .prepare(
            'UPDATE conversations SET machine_id = ? WHERE conversation_id = ?',
          )
          .run('machine_different000001', conversation.conversationId),
      /Conversation Machine is immutable/u,
    )
    inspect.close()
  })
})

test('migration 008 rolls back Machine and replacement tables on copy failure', () => {
  withDatabase((databasePath) => {
    const seed = ConversationStore.open({ databasePath })
    const [machine] = seed.listMachines()
    const root = resolve(databasePath, '..', 'machine-rollback-project')
    const project = durableProject(
      'proj_machinerollback01',
      machine.machineId,
      root,
    )
    const conversation = durableConversation(
      'conv_machinerollback01',
      project,
      'codex',
    )
    seed.createProject(project)
    seed.createConversation(conversation)
    seed.close()

    downgradeMachineFoundationToVersionSeven(databasePath)
    const corrupt = new DatabaseSync(databasePath)
    corrupt.exec('PRAGMA foreign_keys = OFF')
    corrupt
      .prepare('DELETE FROM projects WHERE project_id = ?')
      .run(project.projectId)
    corrupt.close()

    assert.throws(
      () => ConversationStore.open({ databasePath }),
      /FOREIGN KEY constraint failed/u,
    )

    const inspect = new DatabaseSync(databasePath)
    assert.equal(
      inspect
        .prepare('SELECT MAX(version) AS version FROM schema_migrations')
        .get().version,
      7,
    )
    assert.equal(tableCount(inspect, 'machines'), 0)
    assert.equal(tableCount(inspect, 'project_locations'), 0)
    assert.equal(tableCount(inspect, 'projects_v8'), 0)
    assert.equal(tableCount(inspect, 'conversations_v8'), 0)
    assert.equal(
      inspect
        .prepare(
          'SELECT provider_thread_id FROM conversations WHERE conversation_id = ?',
        )
        .get(conversation.conversationId).provider_thread_id,
      'session-private',
    )
    inspect.close()
  })
})

test('Machine ID storage bounds align with the public machine_ identity schema', () => {
  withDatabase((databasePath) => {
    const store = ConversationStore.open({ databasePath })
    store.close()

    const database = new DatabaseSync(databasePath)
    database.prepare('DELETE FROM machines').run()
    assert.throws(
      () => insertMachine(database, `machine_${'a'.repeat(5)}`),
      /CHECK constraint failed/u,
    )
    assert.throws(
      () => insertMachine(database, `machine_${'a'.repeat(97)}`),
      /CHECK constraint failed/u,
    )
    const minimum = `machine_${'a'.repeat(6)}`
    insertMachine(database, minimum)
    assert.equal(
      database.prepare('SELECT machine_id FROM machines').get().machine_id,
      minimum,
    )
    database.prepare('DELETE FROM machines').run()
    const maximum = `machine_${'a'.repeat(96)}`
    insertMachine(database, maximum)
    database.close()

    const reopened = ConversationStore.open({ databasePath })
    assert.equal(reopened.listMachines()[0].machineId, maximum)
    reopened.close()
  })
})

function downgradeMachineFoundationToVersionSeven(databasePath) {
  const database = new DatabaseSync(databasePath)
  database.exec('PRAGMA foreign_keys = OFF')
  database.exec(`
    DELETE FROM schema_migrations WHERE version IN (8, 9, 10, 11, 12, 13, 14, 15);
    DROP TABLE machine_relay_configurations;
    DROP TABLE machine_provider_execution_health;
    DROP TABLE turn_start_actions;
    DROP TABLE remote_machine_provider_observations;

    CREATE TABLE projects_v7 (
      project_id TEXT PRIMARY KEY,
      name TEXT NOT NULL
        CHECK (length(name) BETWEEN 1 AND 240 AND name = trim(name)),
      root_path TEXT NOT NULL UNIQUE
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
    DROP TABLE trusted_machine_endpoints;
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

function durableProject(projectId, machineId, rootPath) {
  const normalized = normalizeTrustedProjectRoot(rootPath)
  return {
    projectId,
    name: basename(normalized.rootPath),
    locations: [
      {
        projectId,
        machineId,
        rootPath: normalized.rootPath,
        rootPathKey: normalized.rootPathKey,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function durableConversation(conversationId, project, provider) {
  return {
    conversationId,
    projectId: project.projectId,
    machineId: project.locations[0].machineId,
    title: 'Machine foundation title',
    titleSource: 'generated',
    provider,
    providerThreadId: 'session-private',
    cwd: project.locations[0].rootPath,
    status: 'completed',
    createdAt: timestamp,
    updatedAt: timestamp,
    lastActivityAt: timestamp,
  }
}

function durableTurn(turnId, conversationId) {
  return {
    turnId,
    conversationId,
    providerTurnId: 'provider-turn-private',
    input: { type: 'text', text: 'Machine input marker', timestamp },
    status: 'completed',
    startedAt: timestamp,
    completedAt: later,
    snapshotVersion: 1,
    snapshot: { finalMessage: 'Preserved machine result' },
  }
}

function tableCount(database, tableName) {
  return database
    .prepare(
      `SELECT COUNT(*) AS count FROM sqlite_master
       WHERE type = 'table' AND name = ?`,
    )
    .get(tableName).count
}

function insertMachine(database, machineId) {
  database
    .prepare(
      `INSERT INTO machines (
         machine_id, display_name, kind, platform, architecture,
         created_at, updated_at, last_seen_at
       ) VALUES (?, '本地电脑', 'local', 'Windows', 'x64', ?, ?, NULL)`,
    )
    .run(machineId, timestamp, timestamp)
}

function withDatabase(run) {
  const directory = mkdtempSync(
    join(tmpdir(), 'codetether-machine-foundation-'),
  )
  const databasePath = join(directory, 'codetether.sqlite3')
  try {
    run(databasePath)
  } finally {
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    })
  }
}
