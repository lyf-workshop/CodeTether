import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import {
  ConversationOrganizationConflictError,
  ConversationStore,
  currentSchemaVersion,
  normalizeManualConversationTitle,
} from '../dist/persistence/index.js'
import { normalizeTrustedProjectRoot } from '../dist/project-path.js'

const projectId = 'proj_organization01'
const baseTime = '2026-08-28T12:00:00.000Z'

test('migration 005 backfills generated organization metadata and preserves the durable graph', () => {
  withFixture(({ databasePath, store, workspace }) => {
    const created = seedConversation(store, workspace, 1, {
      title: 'Preserved title',
      providerThreadId: 'provider-thread-preserved',
    })
    store.createTurn(turn(created.conversationId))
    store.createAttentionItem(
      attention(created.conversationId, 'completed_review', 1),
    )
    store.close()
    downgradeToV4(databasePath)

    const migrated = ConversationStore.open({ databasePath })
    assert.equal(currentSchemaVersion, 5)
    assert.equal(migrated.schemaVersion, 5)
    assert.deepEqual(migrated.getConversation(created.conversationId), {
      ...created,
      titleSource: 'generated',
    })
    assert.equal(migrated.countTurns(created.conversationId), 1)
    assert.equal(
      migrated.getTurn(`turn_${created.conversationId}`).providerTurnId,
      'provider-turn-preserved',
    )
    assert.equal(migrated.listAttentionItems().length, 1)
    assert.equal(migrated.listProjects().length, 1)
    migrated.close()
  })
})

test('migration 005 rolls back columns, indexes, and version when index creation fails', () => {
  withFixture(({ databasePath, store, workspace }) => {
    const created = seedConversation(store, workspace, 1, {
      title: 'Rollback sentinel',
    })
    store.close()
    downgradeToV4(databasePath)

    const raw = new DatabaseSync(databasePath)
    raw.exec(`
      CREATE INDEX idx_conversations_project_active_order
        ON projects(project_id);
    `)
    raw.close()

    assert.throws(
      () => ConversationStore.open({ databasePath }),
      /index idx_conversations_project_active_order already exists/u,
    )

    const inspect = new DatabaseSync(databasePath)
    try {
      assert.equal(
        inspect
          .prepare('SELECT MAX(version) AS version FROM schema_migrations')
          .get().version,
        4,
      )
      const retained = inspect
        .prepare(
          `SELECT title, last_activity_at
           FROM conversations WHERE conversation_id = ?`,
        )
        .get(created.conversationId)
      assert.equal(retained.title, 'Rollback sentinel')
      assert.equal(retained.last_activity_at, created.lastActivityAt)
      assert.equal(columnExists(inspect, 'title_source'), false)
      assert.equal(columnExists(inspect, 'pinned_at'), false)
      assert.equal(columnExists(inspect, 'archived_at'), false)
      assert.equal(
        indexExists(inspect, 'idx_conversations_project_last_activity'),
        true,
      )
    } finally {
      inspect.close()
    }
  })
})

test('manual rename normalizes NFC and whitespace without changing activity or provider identity', () => {
  withFixture(({ store, workspace }) => {
    const created = seedConversation(store, workspace, 1)
    const renamedAt = timeAt(50)
    const result = store.renameConversation(
      created.conversationId,
      '  Cafe\u0301\n\t登录   🔐  ',
      renamedAt,
    )

    assert.equal(result.changed, true)
    assert.equal(result.conversation.title, 'Café 登录 🔐')
    assert.equal(result.conversation.titleSource, 'manual')
    assert.equal(result.conversation.updatedAt, renamedAt)
    assert.equal(result.conversation.lastActivityAt, created.lastActivityAt)
    assert.equal(result.conversation.providerThreadId, created.providerThreadId)
    assert.equal(
      store.renameConversation(
        created.conversationId,
        'Café 登录 🔐',
        timeAt(60),
      ).changed,
      false,
    )
    assert.throws(
      () => store.renameConversation(created.conversationId, '   ', timeAt(1)),
      /too_small/u,
    )
    assert.throws(
      () =>
        store.renameConversation(
          created.conversationId,
          'a'.repeat(161),
          timeAt(1),
        ),
      /160 graphemes/u,
    )
    assert.throws(
      () => normalizeManualConversationTitle('😀'.repeat(121)),
      /too_big/u,
    )
  })
})

test('pin, archive, and all-list ordering are stable and never advance activity', () => {
  withFixture(({ store, workspace }) => {
    const conversations = Array.from({ length: 8 }, (_, index) =>
      seedConversation(store, workspace, index),
    )
    const pinnedOlder = store.pinConversation(
      conversations[1].conversationId,
      timeAt(20),
    )
    const pinnedNewer = store.pinConversation(
      conversations[2].conversationId,
      timeAt(30),
    )
    assert.equal(pinnedOlder.changed, true)
    assert.equal(pinnedNewer.changed, true)
    assert.equal(
      store.pinConversation(conversations[2].conversationId, timeAt(40))
        .changed,
      false,
    )
    assert.deepEqual(
      store
        .listProjectConversations(projectId, { limit: 100 })
        .slice(0, 3)
        .map((conversation) => conversation.conversationId),
      [
        conversations[2].conversationId,
        conversations[1].conversationId,
        conversations[7].conversationId,
      ],
    )

    const archivedOlder = store.archiveConversation(
      conversations[2].conversationId,
      timeAt(40),
    )
    const archivedNewer = store.archiveConversation(
      conversations[3].conversationId,
      timeAt(50),
    )
    assert.equal(archivedOlder.conversation.pinnedAt, undefined)
    assert.equal(
      archivedOlder.conversation.lastActivityAt,
      conversations[2].lastActivityAt,
    )
    assert.equal(archivedNewer.changed, true)
    assert.equal(
      store.archiveConversation(conversations[3].conversationId, timeAt(60))
        .changed,
      false,
    )
    assert.deepEqual(
      store
        .listProjectConversations(projectId, {
          archived: 'archived',
          limit: 100,
        })
        .map((conversation) => conversation.conversationId),
      [conversations[3].conversationId, conversations[2].conversationId],
    )
    const all = store.listProjectConversations(projectId, {
      archived: 'all',
      limit: 100,
    })
    assert.deepEqual(
      all.slice(-2).map((conversation) => conversation.conversationId),
      [conversations[3].conversationId, conversations[2].conversationId],
    )
    assert.ok(
      all.slice(0, -2).every((conversation) => !conversation.archivedAt),
    )
    assert.throws(
      () => store.pinConversation(conversations[2].conversationId, timeAt(70)),
      (error) =>
        error instanceof ConversationOrganizationConflictError &&
        error.reason === 'archived',
    )

    const unarchived = store.unarchiveConversation(
      conversations[2].conversationId,
      timeAt(80),
    )
    assert.equal(unarchived.changed, true)
    assert.equal(unarchived.conversation.archivedAt, undefined)
    assert.equal(unarchived.conversation.pinnedAt, undefined)
    assert.equal(
      store.unarchiveConversation(conversations[2].conversationId, timeAt(90))
        .changed,
      false,
    )
    assert.equal(
      store.unpinConversation(conversations[1].conversationId, timeAt(90))
        .changed,
      true,
    )
    assert.equal(
      store.unpinConversation(conversations[1].conversationId, timeAt(100))
        .changed,
      false,
    )
  })
})

test('archive rejects durable work and open Approval while preserving review Attention', () => {
  withFixture(({ store, workspace }) => {
    const running = seedConversation(store, workspace, 1, { status: 'running' })
    const waiting = seedConversation(store, workspace, 2, { status: 'waiting' })
    for (const conversation of [running, waiting]) {
      assert.throws(
        () =>
          store.archiveConversation(conversation.conversationId, timeAt(20)),
        (error) =>
          error instanceof ConversationOrganizationConflictError &&
          error.reason === 'active',
      )
      assert.equal(
        store.getConversation(conversation.conversationId).archivedAt,
        undefined,
      )
    }

    const approvalOwner = seedConversation(store, workspace, 3)
    const approval = store.createAttentionItem(
      attention(approvalOwner.conversationId, 'approval', 1),
    )
    assert.equal(
      store.hasOpenApprovalAttention(approvalOwner.conversationId),
      true,
    )
    assert.throws(
      () => store.archiveConversation(approvalOwner.conversationId, timeAt(30)),
      (error) =>
        error instanceof ConversationOrganizationConflictError &&
        error.reason === 'open_approval',
    )
    assert.equal(store.getAttentionItem(approval.attentionId).status, 'open')

    const reviewOwner = seedConversation(store, workspace, 4)
    const completed = store.createAttentionItem(
      attention(reviewOwner.conversationId, 'completed_review', 2),
    )
    const failed = store.createAttentionItem(
      attention(reviewOwner.conversationId, 'failed', 3),
    )
    assert.equal(
      store.archiveConversation(reviewOwner.conversationId, timeAt(40)).changed,
      true,
    )
    assert.deepEqual(
      store
        .listAttentionItems({ conversationId: reviewOwner.conversationId })
        .map((item) => item.attentionId),
      [failed.attentionId, completed.attentionId],
    )
    assert.equal(store.countConversationsForProject(projectId), 4)
  })
})

test('500 Conversation organization queries and cold mutations remain metadata-only', (context) => {
  withFixture(({ databasePath, store, workspace }) => {
    const conversations = []
    store.runInTransaction(() => {
      for (let index = 0; index < 500; index += 1) {
        conversations.push(seedConversation(store, workspace, index))
      }
    })
    for (let index = 0; index < 10; index += 1) {
      store.pinConversation(
        conversations[index].conversationId,
        timeAt(index + 1),
      )
    }
    for (let index = 10; index < 20; index += 1) {
      store.archiveConversation(
        conversations[index].conversationId,
        timeAt(index + 1),
      )
    }

    const activeStartedAt = performance.now()
    const active = store.listProjectConversations(projectId, { limit: 100 })
    const activeElapsed = performance.now() - activeStartedAt
    const archivedStartedAt = performance.now()
    const archived = store.listProjectConversations(projectId, {
      archived: 'archived',
      limit: 100,
    })
    const archivedElapsed = performance.now() - archivedStartedAt
    const renameStartedAt = performance.now()
    const renamed = store.renameConversation(
      conversations[250].conversationId,
      'Cold durable rename',
      timeAt(600),
    )
    const renameElapsed = performance.now() - renameStartedAt
    const pinStartedAt = performance.now()
    const pinned = store.pinConversation(
      conversations[300].conversationId,
      timeAt(601),
    )
    const pinElapsed = performance.now() - pinStartedAt
    const archiveStartedAt = performance.now()
    const newlyArchived = store.archiveConversation(
      conversations[301].conversationId,
      timeAt(602),
    )
    const archiveElapsed = performance.now() - archiveStartedAt
    context.diagnostic(
      `500 rows: active=${activeElapsed.toFixed(3)}ms archived=${archivedElapsed.toFixed(3)}ms rename=${renameElapsed.toFixed(3)}ms pin=${pinElapsed.toFixed(3)}ms archive=${archiveElapsed.toFixed(3)}ms`,
    )

    assert.equal(active.length, 100)
    assert.equal(archived.length, 10)
    assert.ok(
      active.slice(0, 10).every((conversation) => conversation.pinnedAt),
    )
    assert.equal(
      renamed.conversation.providerThreadId,
      conversations[250].providerThreadId,
    )
    assert.equal(
      renamed.conversation.lastActivityAt,
      conversations[250].lastActivityAt,
    )
    assert.equal(pinned.conversation.pinnedAt, timeAt(601))
    assert.equal(
      pinned.conversation.lastActivityAt,
      conversations[300].lastActivityAt,
    )
    assert.equal(newlyArchived.conversation.archivedAt, timeAt(602))
    assert.equal(newlyArchived.conversation.pinnedAt, undefined)
    assert.equal(
      newlyArchived.conversation.lastActivityAt,
      conversations[301].lastActivityAt,
    )
    assert.ok(activeElapsed < 1_000)
    assert.ok(archivedElapsed < 1_000)
    assert.ok(renameElapsed < 1_000)
    assert.ok(pinElapsed < 1_000)
    assert.ok(archiveElapsed < 1_000)

    store.close()
    const reopened = ConversationStore.open({ databasePath })
    assert.equal(
      reopened.getConversation(conversations[250].conversationId).title,
      'Cold durable rename',
    )
    assert.equal(
      reopened.getConversation(conversations[300].conversationId).pinnedAt,
      timeAt(601),
    )
    assert.equal(
      reopened.listProjectConversations(projectId, {
        archived: 'archived',
        limit: 100,
      }).length,
      11,
    )
    reopened.close()
  })
})

function withFixture(operation) {
  const directory = mkdtempSync(join(tmpdir(), 'codetether-organization-'))
  const workspace = join(directory, 'workspace')
  const databasePath = join(directory, 'data', 'codetether.sqlite3')
  mkdirSync(workspace, { recursive: true })
  const store = ConversationStore.open({ databasePath })
  try {
    createProject(store, workspace)
    operation({ databasePath, directory, store, workspace })
  } finally {
    try {
      store.close()
    } catch {
      // A test may close the fixture before reopening the same database.
    }
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    })
  }
}

function createProject(store, workspace) {
  const root = normalizeTrustedProjectRoot(workspace)
  store.createProject({
    projectId,
    name: 'Organization fixture',
    rootPath: root.rootPath,
    rootPathKey: root.rootPathKey,
    createdAt: baseTime,
    updatedAt: baseTime,
  })
}

function seedConversation(store, workspace, index, overrides = {}) {
  const timestamp = timeAt(index)
  const conversation = {
    conversationId: `conv_organization_${String(index).padStart(4, '0')}`,
    projectId,
    title: `Conversation ${String(index)}`,
    titleSource: 'generated',
    provider: 'codex',
    providerThreadId: `provider-thread-${String(index)}`,
    cwd: workspace,
    model: 'gpt-5.6-sol',
    reasoning: 'medium',
    status: 'completed',
    createdAt: baseTime,
    updatedAt: timestamp,
    lastActivityAt: timestamp,
    ...overrides,
  }
  store.createConversation(conversation)
  return conversation
}

function turn(conversationId) {
  return {
    turnId: `turn_${conversationId}`,
    conversationId,
    providerTurnId: 'provider-turn-preserved',
    input: { type: 'text', text: 'Preserved input', timestamp: baseTime },
    status: 'completed',
    startedAt: baseTime,
    completedAt: baseTime,
    snapshotVersion: 1,
    snapshot: { preserved: true },
  }
}

function attention(conversationId, type, index) {
  const suffix = String(index).padStart(6, '0')
  return {
    attentionId: `attn_org_${suffix}`,
    sourceKey: `organization:${type}:${conversationId}:${suffix}`,
    projectId,
    conversationId,
    type,
    payload: { summary: `${type} fixture` },
    createdAt: timeAt(index),
    updatedAt: timeAt(index),
  }
}

function downgradeToV4(databasePath) {
  const database = new DatabaseSync(databasePath)
  database.exec(`
    DROP INDEX idx_conversations_project_title;
    DROP INDEX idx_conversations_project_archived_order;
    DROP INDEX idx_conversations_project_active_order;
    CREATE INDEX idx_conversations_project_last_activity
      ON conversations(project_id, last_activity_at DESC, conversation_id ASC);
    ALTER TABLE conversations DROP COLUMN archived_at;
    ALTER TABLE conversations DROP COLUMN pinned_at;
    ALTER TABLE conversations DROP COLUMN title_source;
    DELETE FROM schema_migrations WHERE version = 5;
  `)
  database.close()
}

function columnExists(database, name) {
  return (
    database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM pragma_table_info('conversations') WHERE name = ?`,
      )
      .get(name).count === 1
  )
}

function indexExists(database, name) {
  return (
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM sqlite_master
         WHERE type = 'index' AND name = ?`,
      )
      .get(name).count === 1
  )
}

function timeAt(offsetMinutes) {
  return new Date(Date.parse(baseTime) + offsetMinutes * 60_000).toISOString()
}
