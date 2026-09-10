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
import { downgradeMachineFoundationToVersionSeven } from './fixtures/machine-foundation-v7.mjs'

const timestamp = '2026-08-29T10:00:00.000Z'
const later = '2026-08-29T10:01:00.000Z'

test('migration 007 preserves Codex organization, Turns, Attention, and Search before admitting Claude Code', () => {
  withDatabase((databasePath) => {
    const seed = ConversationStore.open({ databasePath })
    const machineId = seed.listMachines()[0].machineId
    const root = resolve(databasePath, '..', 'provider-project')
    const project = durableProject('proj_providerfoundation01', machineId, root)
    const codex = durableConversation({
      conversationId: 'conv_providercodex01',
      projectId: project.projectId,
      machineId,
      provider: 'codex',
      providerThreadId: 'codex-session-private',
      cwd: root,
      title: 'Initial provider title',
    })
    const codexTurn = durableTurn({
      turnId: 'turn_providercodex01',
      conversationId: codex.conversationId,
      providerTurnId: 'codex-turn-private',
      text: 'Durable migration marker',
    })
    const archivedCodex = durableConversation({
      conversationId: 'conv_providercodex02',
      projectId: project.projectId,
      machineId,
      provider: 'codex',
      providerThreadId: 'codex-archived-session-private',
      cwd: root,
      title: 'Generated archived provider marker',
    })
    const archivedTurns = [
      durableTurn({
        turnId: 'turn_providercodex02',
        conversationId: archivedCodex.conversationId,
        providerTurnId: 'codex-archived-turn-private-1',
        text: 'First archived migration marker',
      }),
      durableTurn({
        turnId: 'turn_providercodex03',
        conversationId: archivedCodex.conversationId,
        providerTurnId: 'codex-archived-turn-private-2',
        text: 'Second archived migration marker',
      }),
    ]

    seed.createProject(project)
    seed.createConversation(codex)
    seed.createTurn(codexTurn)
    seed.createConversation(archivedCodex)
    for (const turn of archivedTurns) seed.createTurn(turn)
    seed.renameConversation(
      codex.conversationId,
      'Manual provider marker',
      later,
    )
    seed.pinConversation(codex.conversationId, later)
    seed.createAttentionItem({
      attentionId: 'attn_providerfoundation01',
      sourceKey: 'turn:turn_providercodex01:completed_review',
      projectId: project.projectId,
      conversationId: codex.conversationId,
      turnId: codexTurn.turnId,
      type: 'completed_review',
      payload: { conversationTitle: 'Manual provider marker' },
      createdAt: later,
      updatedAt: later,
    })
    seed.createAttentionItem({
      attentionId: 'attn_providerfoundation02',
      sourceKey: 'turn:turn_providercodex02:failed',
      projectId: project.projectId,
      conversationId: archivedCodex.conversationId,
      turnId: archivedTurns[0].turnId,
      type: 'failed',
      payload: { conversationTitle: archivedCodex.title },
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    seed.resolveAttentionItem('attn_providerfoundation02', later, {
      acknowledged: true,
    })
    seed.createAttentionItem({
      attentionId: 'attn_providerfoundation03',
      sourceKey: 'approval:providerfoundation03',
      projectId: project.projectId,
      conversationId: archivedCodex.conversationId,
      turnId: archivedTurns[1].turnId,
      type: 'approval',
      payload: { approvalId: 'approval_providerfoundation03' },
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    assert.equal(seed.expireOpenApprovalAttentionItems(later), 1)
    seed.archiveConversation(archivedCodex.conversationId, later)
    seed.close()

    downgradeProviderFoundationToVersionSix(databasePath)
    assertVersionSixRejectsClaude(databasePath)

    const migrated = ConversationStore.open({ databasePath })
    assert.equal(migrated.schemaVersion, 18)
    assert.equal(currentSchemaVersion, 18)
    const migratedMachineId = migrated.listMachines()[0].machineId

    const preserved = migrated.getConversation(codex.conversationId)
    assert.equal(preserved.provider, 'codex')
    assert.equal(preserved.providerThreadId, 'codex-session-private')
    assert.equal(preserved.title, 'Manual provider marker')
    assert.equal(preserved.titleSource, 'manual')
    assert.equal(preserved.pinnedAt, later)
    assert.deepEqual(migrated.getTurn(codexTurn.turnId), codexTurn)
    assert.equal(
      migrated.getAttentionItem('attn_providerfoundation01').status,
      'open',
    )
    const preservedArchived = migrated.getConversation(
      archivedCodex.conversationId,
    )
    assert.equal(preservedArchived.provider, 'codex')
    assert.equal(
      preservedArchived.providerThreadId,
      'codex-archived-session-private',
    )
    assert.equal(preservedArchived.titleSource, 'generated')
    assert.equal(preservedArchived.pinnedAt, undefined)
    assert.equal(preservedArchived.archivedAt, later)
    assert.deepEqual(
      archivedTurns.map((turn) => migrated.getTurn(turn.turnId)),
      archivedTurns,
    )
    const preservedResolved = migrated.getAttentionItem(
      'attn_providerfoundation02',
    )
    assert.equal(preservedResolved.status, 'resolved')
    assert.equal(preservedResolved.resolvedAt, later)
    assert.equal(preservedResolved.payload.acknowledged, true)
    const preservedExpired = migrated.getAttentionItem(
      'attn_providerfoundation03',
    )
    assert.equal(preservedExpired.status, 'expired')
    assert.equal(preservedExpired.resolvedAt, later)
    assert.equal(preservedExpired.payload.expirationReason, 'host_restart')
    assert.deepEqual(
      migrated
        .searchProjectConversations(project.projectId, {
          query: 'durable migration marker',
          provider: 'codex',
        })
        .results.map((result) => result.conversation.conversationId),
      [codex.conversationId],
    )

    const claude = durableConversation({
      conversationId: 'conv_providerclaude01',
      projectId: project.projectId,
      machineId: migratedMachineId,
      provider: 'claude-code',
      providerThreadId: 'claude-session-private',
      cwd: root,
      title: 'Claude shared marker',
    })
    migrated.createConversation(claude)
    migrated.createTurn(
      durableTurn({
        turnId: 'turn_providerclaude01',
        conversationId: claude.conversationId,
        providerTurnId: 'claude-turn-private',
        text: 'Claude durable input marker',
      }),
    )

    const mixed = migrated.listProjectConversations(project.projectId, {
      archived: 'all',
    })
    assert.deepEqual(
      new Set(mixed.map((conversation) => conversation.provider)),
      new Set(['codex', 'claude-code']),
    )
    assert.equal(
      mixed.some((conversation) => 'providerThreadId' in conversation),
      false,
      'public durable summaries keep Provider session identities private',
    )
    assert.deepEqual(
      migrated
        .listProjectConversations(project.projectId, {
          provider: 'claude-code',
          archived: 'all',
        })
        .map((conversation) => conversation.conversationId),
      [claude.conversationId],
    )

    const otherRoot = resolve(databasePath, '..', 'other-provider-project')
    const otherProject = durableProject(
      'proj_providerfoundation02',
      migratedMachineId,
      otherRoot,
    )
    migrated.createProject(otherProject)
    migrated.createConversation(
      durableConversation({
        conversationId: 'conv_providerclaude02',
        projectId: otherProject.projectId,
        machineId: migratedMachineId,
        provider: 'claude-code',
        providerThreadId: 'claude-session-other-private',
        cwd: otherRoot,
        title: 'Claude shared marker',
      }),
    )
    assert.deepEqual(
      migrated
        .searchProjectConversations(project.projectId, {
          query: 'claude shared marker',
          provider: 'claude-code',
        })
        .results.map((result) => result.conversation.conversationId),
      [claude.conversationId],
      'mixed-provider Search remains Project scoped',
    )

    migrated.renameConversation(
      claude.conversationId,
      'Cold Claude organization marker',
      later,
    )
    assert.equal(
      migrated.searchProjectConversations(project.projectId, {
        query: 'cold claude organization',
        provider: 'claude-code',
      }).results.length,
      1,
    )
    migrated.archiveConversation(claude.conversationId, later)
    assert.equal(
      migrated.searchProjectConversations(project.projectId, {
        query: 'cold claude organization',
        provider: 'claude-code',
        archive: 'active',
      }).results.length,
      0,
    )
    assert.equal(
      migrated.searchProjectConversations(project.projectId, {
        query: 'cold claude organization',
        provider: 'claude-code',
        archive: 'archived',
      }).results.length,
      1,
      'cold organization and Search use durable metadata without a Provider runtime',
    )
    migrated.close()

    const inspect = new DatabaseSync(databasePath)
    assert.deepEqual(inspect.prepare('PRAGMA foreign_key_check').all(), [])
    assert.equal(
      inspect
        .prepare('SELECT name FROM schema_migrations WHERE version = 7')
        .get().name,
      'provider_foundation',
    )
    inspect.close()
  })
})

test('migration 007 rolls back its replacement graph and version on failure', () => {
  withDatabase((databasePath) => {
    const seed = ConversationStore.open({ databasePath })
    const machineId = seed.listMachines()[0].machineId
    const root = resolve(databasePath, '..', 'provider-rollback-project')
    const project = durableProject('proj_providerrollback01', machineId, root)
    const conversation = durableConversation({
      conversationId: 'conv_providerrollback01',
      projectId: project.projectId,
      machineId,
      provider: 'codex',
      providerThreadId: 'codex-rollback-private',
      cwd: root,
      title: 'Rollback provider sentinel',
    })
    seed.createProject(project)
    seed.createConversation(conversation)
    seed.close()
    downgradeProviderFoundationToVersionSix(databasePath)

    const conflict = new DatabaseSync(databasePath)
    conflict.exec(`
      CREATE INDEX idx_conversations_v7_attention_identity
        ON projects(project_id)
    `)
    conflict.close()

    assert.throws(
      () => ConversationStore.open({ databasePath }),
      /index idx_conversations_v7_attention_identity already exists/u,
    )
    const inspect = new DatabaseSync(databasePath)
    assert.equal(
      inspect
        .prepare('SELECT MAX(version) AS version FROM schema_migrations')
        .get().version,
      6,
    )
    assert.equal(
      inspect
        .prepare(`SELECT title FROM conversations WHERE conversation_id = ?`)
        .get(conversation.conversationId).title,
      'Rollback provider sentinel',
    )
    assert.equal(
      inspect
        .prepare(
          `SELECT COUNT(*) AS count FROM sqlite_master
           WHERE type = 'table' AND name IN (
             'conversations_v7', 'turns_v7', 'attention_items_v7',
             'conversation_search_documents_v7'
           )`,
        )
        .get().count,
      0,
    )
    assert.deepEqual(inspect.prepare('PRAGMA foreign_key_check').all(), [])
    inspect.close()
  })
})

function downgradeProviderFoundationToVersionSix(databasePath) {
  downgradeMachineFoundationToVersionSeven(databasePath)
  const database = new DatabaseSync(databasePath)
  database.exec('PRAGMA foreign_keys = OFF')
  database.exec(`
    DELETE FROM schema_migrations WHERE version IN (7, 8, 9, 10, 11, 12, 13, 14);

    CREATE TABLE conversations_v6 (
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
      title TEXT NOT NULL DEFAULT 'New conversation'
        CHECK (length(title) BETWEEN 1 AND 240 AND title = trim(title)),
      last_activity_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
      title_source TEXT NOT NULL DEFAULT 'generated'
        CHECK (title_source IN ('generated', 'manual')),
      pinned_at TEXT,
      archived_at TEXT CHECK (archived_at IS NULL OR pinned_at IS NULL),
      FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE RESTRICT
    ) STRICT;

    INSERT INTO conversations_v6 SELECT * FROM conversations ORDER BY rowid;
    DROP TABLE conversations;
    ALTER TABLE conversations_v6 RENAME TO conversations;

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

function assertVersionSixRejectsClaude(databasePath) {
  const database = new DatabaseSync(databasePath)
  database.function(
    'codetether_search_normalize',
    { deterministic: true },
    (value) => String(value).normalize('NFC').toLocaleLowerCase('und').trim(),
  )
  assert.throws(
    () =>
      database
        .prepare(
          `INSERT INTO conversations (
             conversation_id, project_id, provider, provider_thread_id, cwd,
             status, created_at, updated_at, title, last_activity_at,
             title_source
           )
           SELECT
             'conv_version6claude01', project_id, 'claude-code', NULL, cwd,
             'idle', created_at, updated_at, 'Rejected Claude',
             last_activity_at, 'generated'
           FROM conversations LIMIT 1`,
        )
        .run(),
    /CHECK constraint failed/u,
  )
  database.close()
}

function durableProject(projectId, machineId, rootPath) {
  const normalized = normalizeTrustedProjectRoot(rootPath)
  return {
    projectId,
    name: basename(normalized.rootPath),
    location: {
      projectId,
      machineId,
      rootPath: normalized.rootPath,
      rootPathKey: normalized.rootPathKey,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function durableConversation({
  conversationId,
  projectId,
  machineId,
  provider,
  providerThreadId,
  cwd,
  title,
}) {
  return {
    conversationId,
    projectId,
    machineId,
    title,
    titleSource: 'generated',
    provider,
    providerThreadId,
    cwd,
    status: 'idle',
    createdAt: timestamp,
    updatedAt: timestamp,
    lastActivityAt: timestamp,
  }
}

function durableTurn({ turnId, conversationId, providerTurnId, text }) {
  return {
    turnId,
    conversationId,
    providerTurnId,
    input: { type: 'text', text, timestamp },
    status: 'completed',
    startedAt: timestamp,
    completedAt: later,
    snapshotVersion: 1,
    snapshot: { finalMessage: 'Preserved normalized result' },
  }
}

function withDatabase(run) {
  const directory = mkdtempSync(
    join(tmpdir(), 'codetether-provider-foundation-'),
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
