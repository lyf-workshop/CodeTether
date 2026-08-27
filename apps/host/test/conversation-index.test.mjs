import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { performance } from 'node:perf_hooks'
import test from 'node:test'

import {
  DEFAULT_CONVERSATION_TITLE,
  generateConversationTitle,
} from '../dist/conversation-title.js'
import {
  ConversationStore,
  currentSchemaVersion,
} from '../dist/persistence/index.js'
import { normalizeTrustedProjectRoot } from '../dist/project-path.js'
import { createV2Database } from './fixtures/persistence-v2.mjs'

const projectId = 'proj_index_primary'
const otherProjectId = 'proj_index_other'
const timestamp = '2026-08-26T12:00:00.000Z'

test('migration 003 backfills the first durable input and preserves v2 history', () => {
  withDatabase((databasePath) => {
    const workspaceRoot = resolve(databasePath, '..', 'workspace')
    const root = normalizeTrustedProjectRoot(workspaceRoot)
    createV2Database(databasePath, {
      projects: [projectRecord(projectId, root)],
      conversations: [
        legacyConversation('conv_title_migrated', projectId, workspaceRoot, {
          providerThreadId: 'provider-thread-preserved',
        }),
        legacyConversation('conv_title_empty', projectId, workspaceRoot),
      ],
      turns: [
        legacyTurn(
          'turn_title_second',
          'conv_title_migrated',
          '2026-08-26T12:02:00.000Z',
          '不应该使用第二个 Turn',
        ),
        legacyTurn(
          'turn_title_first',
          'conv_title_migrated',
          '2026-08-26T12:01:00.000Z',
          '请帮我实现 WebSocket 自动重连，并处理网络恢复',
        ),
      ],
    })

    const store = ConversationStore.open({ databasePath })
    assert.equal(store.schemaVersion, currentSchemaVersion)
    assert.equal(
      store.getConversation('conv_title_migrated').title,
      '实现 WebSocket 自动重连',
    )
    assert.equal(
      store.getConversation('conv_title_migrated').providerThreadId,
      'provider-thread-preserved',
    )
    assert.equal(
      store.getConversation('conv_title_migrated').lastActivityAt,
      timestamp,
    )
    assert.equal(
      store.getConversation('conv_title_empty').title,
      DEFAULT_CONVERSATION_TITLE,
    )
    assert.equal(store.countTurns('conv_title_migrated'), 2)
    store.close()

    const reopened = ConversationStore.open({ databasePath })
    assert.equal(
      reopened.getConversation('conv_title_migrated').title,
      '实现 WebSocket 自动重连',
    )
    reopened.close()
  })
})

test('migration 003 is transactional when legacy input is corrupt', () => {
  withDatabase((databasePath) => {
    const workspaceRoot = resolve(databasePath, '..', 'workspace')
    const root = normalizeTrustedProjectRoot(workspaceRoot)
    createV2Database(databasePath, {
      projects: [projectRecord(projectId, root)],
      conversations: [
        legacyConversation('conv_title_corrupt', projectId, workspaceRoot),
      ],
      turns: [
        legacyTurn(
          'turn_title_corrupt',
          'conv_title_corrupt',
          timestamp,
          'valid before corruption',
        ),
      ],
    })
    const raw = new DatabaseSync(databasePath)
    raw
      .prepare("UPDATE turns SET input = '{' WHERE turn_id = ?")
      .run('turn_title_corrupt')
    raw.close()

    assert.throws(
      () => ConversationStore.open({ databasePath }),
      /invalid Turn input JSON/,
    )
    const inspect = new DatabaseSync(databasePath)
    assert.equal(
      inspect
        .prepare('SELECT MAX(version) AS version FROM schema_migrations')
        .get().version,
      2,
    )
    assert.equal(
      inspect
        .prepare(
          "SELECT COUNT(*) AS count FROM pragma_table_info('conversations') WHERE name = 'title'",
        )
        .get().count,
      0,
    )
    inspect.close()
  })
})

test('persists a default title and does not overwrite an initialized title', () => {
  withDatabase((databasePath) => {
    const store = ConversationStore.open({ databasePath })
    const workspaceRoot = resolve(databasePath, '..', 'workspace')
    createProjects(store, workspaceRoot)
    const created = conversation(0, projectId, workspaceRoot)
    store.createConversation(created)
    assert.equal(store.getConversation(created.conversationId).title, '新会话')

    const firstTitle =
      generateConversationTitle('请帮我实现持久化会话索引，并添加排序')
    store.updateConversation({ ...created, title: firstTitle })
    store.updateConversation({
      ...store.getConversation(created.conversationId),
      updatedAt: '2026-08-26T12:05:00.000Z',
    })
    assert.equal(
      store.getConversation(created.conversationId).title,
      firstTitle,
    )

    store.close()
    const reopened = ConversationStore.open({ databasePath })
    assert.equal(
      reopened.getConversation(created.conversationId).title,
      firstTitle,
    )
    reopened.close()
  })
})

test('lists bounded Project-scoped summaries in last-activity order', (context) => {
  withDatabase((databasePath) => {
    const store = ConversationStore.open({ databasePath })
    const workspaceRoot = resolve(databasePath, '..', 'workspace')
    createProjects(store, workspaceRoot)

    for (let index = 0; index < 105; index += 1) {
      store.createConversation(
        conversation(index, projectId, workspaceRoot, {
          status:
            index === 104 ? 'creating' : index % 2 === 0 ? 'completed' : 'idle',
        }),
      )
    }
    const isolated = conversation(200, otherProjectId, workspaceRoot)
    store.createConversation(isolated)

    const startedAt = performance.now()
    const maximum = store.listProjectConversations(projectId, { limit: 100 })
    const elapsedMs = performance.now() - startedAt
    context.diagnostic(
      `100 Conversation summary rows: ${elapsedMs.toFixed(3)} ms`,
    )

    assert.equal(maximum.length, 100)
    assert.equal(maximum[0].conversationId, conversationId(103))
    assert.equal(maximum.at(-1).conversationId, conversationId(4))
    assert.ok(maximum.every((summary) => summary.projectId === projectId))
    assert.ok(maximum.every((summary) => !('providerThreadId' in summary)))
    assert.ok(maximum.every((summary) => !('cwd' in summary)))
    assert.ok(
      maximum.every((summary) => summary.lastActivityAt === summary.updatedAt),
    )

    const metadataOnly = store.getConversation(conversationId(0))
    store.updateConversation({
      ...metadataOnly,
      model: 'updated-without-activity',
      updatedAt: '2030-01-01T00:00:00.000Z',
    })
    assert.equal(
      store.listProjectConversations(projectId, { limit: 100 })[0]
        .conversationId,
      conversationId(103),
    )
    assert.equal(
      store.listConversations()[0].conversationId,
      conversationId(200),
    )

    const newlyActive = store.getConversation(conversationId(50))
    store.updateConversation({
      ...newlyActive,
      updatedAt: '2030-01-02T00:00:00.000Z',
      lastActivityAt: '2030-01-02T00:00:00.000Z',
    })
    assert.equal(
      store.listProjectConversations(projectId, { limit: 100 })[0]
        .conversationId,
      conversationId(50),
    )
    assert.equal(
      store.listConversations()[0].conversationId,
      conversationId(50),
    )

    const defaults = store.listProjectConversations(projectId)
    assert.equal(defaults.length, 50)
    assert.deepEqual(store.listProjectConversations(otherProjectId), [
      {
        conversationId: isolated.conversationId,
        projectId: otherProjectId,
        title: isolated.title,
        provider: 'codex',
        model: isolated.model,
        reasoning: isolated.reasoning,
        status: isolated.status,
        createdAt: isolated.createdAt,
        updatedAt: isolated.updatedAt,
        lastActivityAt: isolated.lastActivityAt,
      },
    ])
    assert.ok(
      store
        .listProjectConversations(projectId, {
          status: 'completed',
          limit: 100,
        })
        .every((summary) => summary.status === 'completed'),
    )
    assert.equal(
      store.listProjectConversations(projectId, { provider: 'codex' }).length,
      50,
    )
    assert.throws(
      () => store.listProjectConversations(projectId, { limit: 0 }),
      /between 1 and 100/,
    )
    assert.throws(
      () => store.listProjectConversations(projectId, { limit: 101 }),
      /between 1 and 100/,
    )
    assert.throws(
      () => store.listProjectConversations(projectId, { limit: 1.5 }),
      /between 1 and 100/,
    )
    store.close()
  })
})

test('Conversation index never parses durable Turn snapshot JSON', () => {
  withDatabase((databasePath) => {
    const store = ConversationStore.open({ databasePath })
    const workspaceRoot = resolve(databasePath, '..', 'workspace')
    createProjects(store, workspaceRoot)
    const created = conversation(1, projectId, workspaceRoot)
    store.createConversation(created)
    store.createTurn({
      turnId: 'turn_index_corrupt_snapshot',
      conversationId: created.conversationId,
      providerTurnId: 'provider-turn-index',
      input: { type: 'text', text: 'Inspect index', timestamp },
      status: 'completed',
      startedAt: timestamp,
      completedAt: timestamp,
      snapshotVersion: 1,
      snapshot: { valid: true },
    })
    store.close()

    const raw = new DatabaseSync(databasePath)
    raw
      .prepare('UPDATE turns SET snapshot_json = ? WHERE turn_id = ?')
      .run('{invalid', 'turn_index_corrupt_snapshot')
    raw.close()

    const reopened = ConversationStore.open({ databasePath })
    const [summary] = reopened.listProjectConversations(projectId)
    assert.equal(summary.conversationId, created.conversationId)
    assert.equal(summary.title, created.title)
    assert.throws(
      () => reopened.getTurn('turn_index_corrupt_snapshot'),
      /invalid JSON/,
    )
    reopened.close()
  })
})

function createProjects(store, workspaceRoot) {
  const root = normalizeTrustedProjectRoot(workspaceRoot)
  const otherRoot = normalizeTrustedProjectRoot(`${workspaceRoot}-other`)
  store.createProject(projectRecord(projectId, root))
  store.createProject(projectRecord(otherProjectId, otherRoot))
}

function projectRecord(id, root) {
  return {
    projectId: id,
    name: id,
    rootPath: root.rootPath,
    rootPathKey: root.rootPathKey,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function legacyConversation(id, idProject, cwd, overrides = {}) {
  return {
    conversationId: id,
    projectId: idProject,
    providerThreadId: `provider-${id}`,
    cwd,
    model: 'gpt-5.6-sol',
    reasoning: 'medium',
    status: 'completed',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  }
}

function legacyTurn(id, idConversation, startedAt, text) {
  return {
    turnId: id,
    conversationId: idConversation,
    providerTurnId: `provider-${id}`,
    input: { type: 'text', text, timestamp: startedAt },
    status: 'completed',
    startedAt,
    completedAt: startedAt,
    snapshotVersion: 1,
    snapshot: { turnId: id },
  }
}

function conversation(index, idProject, cwd, overrides = {}) {
  const activity = new Date(
    Date.parse('2026-08-26T12:00:00.000Z') + index * 1_000,
  ).toISOString()
  return {
    conversationId: conversationId(index),
    projectId: idProject,
    title:
      index === 0
        ? DEFAULT_CONVERSATION_TITLE
        : `Conversation ${String(index)}`,
    provider: 'codex',
    providerThreadId: `provider-thread-${String(index)}`,
    cwd,
    model: 'gpt-5.6-sol',
    reasoning: 'medium',
    status: 'completed',
    createdAt: timestamp,
    updatedAt: activity,
    lastActivityAt: activity,
    ...overrides,
  }
}

function conversationId(index) {
  return `conv_index_${String(index).padStart(4, '0')}`
}

function withDatabase(run) {
  const directory = mkdtempSync(join(tmpdir(), 'codetether-index-'))
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
