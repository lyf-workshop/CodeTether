import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import {
  ConversationStore,
  currentSchemaVersion,
  reconcileHostRestart,
} from '../dist/persistence/index.js'
import { normalizeTrustedProjectRoot } from '../dist/project-path.js'

const projectId = 'proj_attention01'
const otherProjectId = 'proj_attention02'
const conversationId = 'conv_attention01'
const otherConversationId = 'conv_attention02'
const turnId = 'turn_attention01'
const otherTurnId = 'turn_attention02'
const timestamp = '2026-08-27T12:00:00.000Z'

test('migration 004 creates an empty Attention index without backfilling durable Turns', () => {
  withFixture(({ databasePath, store, workspace }) => {
    seedConversationGraph(store, workspace)
    store.close()

    const v3 = new DatabaseSync(databasePath)
    v3.exec(`
      DROP INDEX idx_conversations_project_title;
      DROP INDEX idx_conversations_project_archived_order;
      DROP INDEX idx_conversations_project_active_order;
      CREATE INDEX idx_conversations_project_last_activity
        ON conversations(project_id, last_activity_at DESC, conversation_id ASC);
      ALTER TABLE conversations DROP COLUMN archived_at;
      ALTER TABLE conversations DROP COLUMN pinned_at;
      ALTER TABLE conversations DROP COLUMN title_source;
      DROP TABLE attention_items;
      DROP INDEX idx_conversations_attention_identity;
      DROP INDEX idx_turns_attention_identity;
      DROP TRIGGER trg_conversation_search_input_update;
      DROP TRIGGER trg_conversation_search_input_insert;
      DROP TRIGGER trg_conversation_search_title_update;
      DROP TRIGGER trg_conversation_search_title_insert;
      DROP TABLE conversation_search_documents;
      DELETE FROM schema_migrations WHERE version IN (4, 5, 6);
    `)
    assert.equal(
      v3.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()
        .version,
      3,
    )
    v3.close()

    const migrated = ConversationStore.open({ databasePath })
    assert.equal(migrated.schemaVersion, currentSchemaVersion)
    assert.equal(currentSchemaVersion, 6)
    assert.equal(migrated.listProjects().length, 1)
    assert.equal(migrated.listConversations().length, 1)
    assert.equal(migrated.countTurns(conversationId), 1)
    const conversation = migrated.getConversation(conversationId)
    assert.equal(conversation.projectId, projectId)
    assert.equal(conversation.title, 'Attention')
    assert.equal(conversation.titleSource, 'generated')
    assert.equal(conversation.providerThreadId, `provider-${conversationId}`)
    const retainedTurn = migrated.getTurn(turnId)
    assert.equal(retainedTurn.providerTurnId, `provider-${turnId}`)
    assert.equal(retainedTurn.snapshot.fixture, true)
    assert.deepEqual(migrated.listAttentionItems(), [])
    assert.deepEqual(migrated.summarizeAttentionItems(), emptySummary())
    migrated.close()
  })
})

test('Attention identity and composite foreign keys bind the exact Project, Conversation, and Turn', () => {
  withFixture(({ databasePath, store, workspace }) => {
    seedConversationGraph(store, workspace, { includeOther: true })
    const created = store.createAttentionItem(
      attention(1, 'approval', {
        payload: { approvalId: 'approval_attention01' },
      }),
    )
    assert.equal(created.status, 'open')
    const failedCreated = store.createAttentionItem(attention(6, 'failed'))

    assert.throws(
      () =>
        store.createAttentionItem({
          ...attention(2, 'failed'),
          projectId: otherProjectId,
        }),
      /FOREIGN KEY constraint failed/u,
    )
    assert.throws(
      () =>
        store.createAttentionItem({
          ...attention(3, 'failed'),
          turnId: otherTurnId,
        }),
      /FOREIGN KEY constraint failed/u,
    )
    assert.throws(
      () => store.createAttentionItem(attention(4, 'unsupported')),
      /Unsupported durable Attention type/u,
    )
    assert.throws(
      () =>
        store.createAttentionItem({
          ...attention(5, 'failed'),
          attentionId: 'invalid-attention-id',
        }),
      /attn_/u,
    )
    assert.throws(
      () => store.deleteConversation(conversationId),
      /FOREIGN KEY constraint failed/u,
    )
    assert.throws(
      () => store.deleteProject(projectId),
      /FOREIGN KEY constraint failed/u,
    )
    store.close()

    const raw = new DatabaseSync(databasePath)
    raw.exec('PRAGMA foreign_keys = ON')
    assert.throws(
      () =>
        raw
          .prepare(
            `UPDATE attention_items
             SET status = 'expired', updated_at = ?, resolved_at = ?
             WHERE attention_id = ?`,
          )
          .run(timeAt(10), timeAt(10), failedCreated.attentionId),
      /CHECK constraint failed/u,
    )
    assert.throws(
      () => raw.prepare('DELETE FROM turns WHERE turn_id = ?').run(turnId),
      /FOREIGN KEY constraint failed/u,
    )
    raw.close()
  })
})

test('source-key upsert is idempotent, binding-safe, and never reopens a resolved item', () => {
  withFixture(({ store, workspace }) => {
    seedConversationGraph(store, workspace)
    const first = store.upsertAttentionItem(
      attention(1, 'approval', { payload: { command: 'git status' } }),
    )
    const replay = store.upsertAttentionItem({
      ...attention(2, 'approval', {
        payload: { command: 'git status --short' },
        updatedAt: timeAt(2),
      }),
      sourceKey: first.item.sourceKey,
    })

    assert.equal(first.created, true)
    assert.equal(replay.created, false)
    assert.equal(replay.item.attentionId, first.item.attentionId)
    assert.equal(replay.item.payload.command, 'git status --short')
    assert.equal(store.listAttentionItems().length, 1)
    assert.throws(
      () =>
        store.upsertAttentionItem({
          ...attention(3, 'failed'),
          sourceKey: first.item.sourceKey,
        }),
      /already bound/u,
    )

    const resolved = store.resolveAttentionItem(
      first.item.attentionId,
      timeAt(3),
      { decision: 'accept' },
    )
    assert.equal(resolved.changed, true)
    assert.equal(resolved.item.status, 'resolved')
    assert.equal(resolved.item.payload.decision, 'accept')
    assert.equal(resolved.item.resolvedAt, timeAt(3))

    const resolvedAgain = store.resolveAttentionItem(
      first.item.attentionId,
      timeAt(4),
      { decision: 'decline' },
    )
    assert.equal(resolvedAgain.changed, false)
    assert.equal(resolvedAgain.item.payload.decision, 'accept')

    const lateReplay = store.upsertAttentionItem({
      ...attention(4, 'approval'),
      sourceKey: first.item.sourceKey,
    })
    assert.equal(lateReplay.item.status, 'resolved')
    assert.equal(lateReplay.item.payload.decision, 'accept')
  })
})

test('lists Attention in product priority order and summarizes all open types', () => {
  withFixture(({ store, workspace }) => {
    seedConversationGraph(store, workspace, { includeOther: true })
    const completed = attention(1, 'completed_review', {
      createdAt: timeAt(30),
      updatedAt: timeAt(30),
    })
    const failed = attention(2, 'failed', {
      createdAt: timeAt(20),
      updatedAt: timeAt(20),
    })
    const approvalOlder = attention(3, 'approval', {
      createdAt: timeAt(10),
      updatedAt: timeAt(10),
    })
    const approvalNewer = attention(4, 'approval', {
      createdAt: timeAt(40),
      updatedAt: timeAt(40),
    })
    const otherProject = {
      ...attention(5, 'failed'),
      projectId: otherProjectId,
      conversationId: otherConversationId,
      turnId: otherTurnId,
    }
    for (const item of [
      completed,
      failed,
      approvalOlder,
      approvalNewer,
      otherProject,
    ]) {
      store.createAttentionItem(item)
    }
    store.resolveAttentionItem(approvalNewer.attentionId, timeAt(50), {
      decision: 'decline',
    })

    assert.deepEqual(
      store.listAttentionItems({ projectId }).map((item) => item.attentionId),
      [
        approvalNewer.attentionId,
        approvalOlder.attentionId,
        failed.attentionId,
        completed.attentionId,
      ],
    )
    assert.deepEqual(
      store
        .listAttentionItems({ projectId, status: 'open', type: 'failed' })
        .map((item) => item.attentionId),
      [failed.attentionId],
    )
    assert.deepEqual(store.summarizeAttentionItems({ projectId }), {
      total: 4,
      open: 3,
      resolved: 1,
      expired: 0,
      openApproval: 1,
      openCompletedReview: 1,
      openFailed: 1,
    })
    const projectSummary = store.summarizeAttentionItems({ projectId })
    assert.equal(
      projectSummary.open,
      projectSummary.openApproval +
        projectSummary.openCompletedReview +
        projectSummary.openFailed,
    )
    assert.deepEqual(
      store.summarizeAttentionItems({ projectId: otherProjectId }),
      {
        total: 1,
        open: 1,
        resolved: 0,
        expired: 0,
        openApproval: 0,
        openCompletedReview: 0,
        openFailed: 1,
      },
    )
    assert.throws(
      () => store.listAttentionItems({ limit: 0 }),
      /between 1 and 500/u,
    )
    assert.throws(
      () => store.listAttentionItems({ limit: 501 }),
      /between 1 and 500/u,
    )
  })
})

test('restart expires only open Approval Attention and records host_restart', () => {
  withFixture(({ store, workspace }) => {
    seedConversationGraph(store, workspace)
    const approval = attention(1, 'approval')
    const failed = attention(2, 'failed')
    store.createAttentionItem(approval)
    store.createAttentionItem(failed)

    reconcileHostRestart(store, timeAt(20))

    const expired = store.getAttentionItem(approval.attentionId)
    assert.equal(expired.status, 'expired')
    assert.equal(expired.resolvedAt, timeAt(20))
    assert.equal(expired.payload.expirationReason, 'host_restart')
    assert.equal(store.getAttentionItem(failed.attentionId).status, 'open')
    assert.equal(store.listAttentionItems({ type: 'failed' }).length, 1)
  })
})

test('Attention survives reopen and remains readable while the Project path is unavailable', () => {
  withFixture(({ databasePath, directory, store, workspace }) => {
    seedConversationGraph(store, workspace)
    const created = store.createAttentionItem(
      attention(1, 'completed_review', {
        payload: { changedFiles: 2, testsPassed: 12 },
      }),
    )
    store.close()
    const unavailablePath = join(directory, 'workspace-unavailable')
    renameSync(workspace, unavailablePath)

    const reopened = ConversationStore.open({ databasePath })
    assert.deepEqual(reopened.getAttentionItem(created.attentionId), created)
    assert.deepEqual(
      reopened
        .listAttentionItems({ projectId })
        .map((item) => item.attentionId),
      [created.attentionId],
    )
    reopened.close()
    renameSync(unavailablePath, workspace)
  })
})

test('existing transaction atomically rolls back a terminal Turn update and invalid Attention create', () => {
  withFixture(({ store, workspace }) => {
    seedConversationGraph(store, workspace, { includeOther: true })
    const before = store.getTurn(turnId)

    assert.throws(
      () =>
        store.runInTransaction(() => {
          store.updateTurn({
            ...before,
            status: 'failed',
            completedAt: timeAt(10),
          })
          store.createAttentionItem({
            ...attention(1, 'failed'),
            projectId: otherProjectId,
          })
        }),
      /FOREIGN KEY constraint failed/u,
    )
    assert.deepEqual(store.getTurn(turnId), before)
    assert.deepEqual(store.listAttentionItems(), [])
  })
})

test('100/500 Attention queries stay summary-only and report fixture timing', (t) => {
  withFixture(({ databasePath, store, workspace }) => {
    seedConversationGraph(store, workspace)
    for (let index = 0; index < 500; index += 1) {
      store.createAttentionItem(
        attention(
          index,
          index % 3 === 0
            ? 'approval'
            : index % 3 === 1
              ? 'failed'
              : 'completed_review',
          {
            turnId: undefined,
            updatedAt: timeAt(index),
          },
        ),
      )
    }
    store.close()

    const raw = new DatabaseSync(databasePath)
    raw
      .prepare('UPDATE turns SET snapshot_json = ? WHERE turn_id = ?')
      .run('{invalid', turnId)
    raw.close()

    const reopened = ConversationStore.open({ databasePath })
    const hundredStartedAt = performance.now()
    const hundred = reopened.listAttentionItems({ limit: 100 })
    const hundredElapsedMs = performance.now() - hundredStartedAt
    const fiveHundredStartedAt = performance.now()
    const fiveHundred = reopened.listAttentionItems({ limit: 500 })
    const fiveHundredElapsedMs = performance.now() - fiveHundredStartedAt
    t.diagnostic(`100 Attention rows: ${hundredElapsedMs.toFixed(3)} ms`)
    t.diagnostic(`500 Attention rows: ${fiveHundredElapsedMs.toFixed(3)} ms`)

    assert.equal(hundred.length, 100)
    assert.equal(fiveHundred.length, 500)
    assert.equal(reopened.summarizeAttentionItems().total, 500)
    assert.throws(() => reopened.getTurn(turnId), /invalid JSON/u)
    reopened.close()
  })
})

function withFixture(operation) {
  const directory = mkdtempSync(join(tmpdir(), 'codetether-attention-'))
  const workspace = join(directory, 'workspace')
  const databasePath = join(directory, 'data', 'codetether.sqlite3')
  mkdirSync(workspace, { recursive: true })
  const store = ConversationStore.open({ databasePath })
  try {
    operation({ databasePath, directory, store, workspace })
  } finally {
    try {
      store.close()
    } catch {
      // A test may close the fixture before reopening the same database.
    }
    rmSync(directory, { recursive: true, force: true })
  }
}

function seedConversationGraph(store, workspace, options = {}) {
  createProject(store, projectId, workspace)
  createConversation(store, conversationId, projectId, workspace)
  store.createTurn(turn(turnId, conversationId))
  if (options.includeOther) {
    const otherWorkspace = join(workspace, 'other')
    mkdirSync(otherWorkspace, { recursive: true })
    createProject(store, otherProjectId, otherWorkspace)
    createConversation(
      store,
      otherConversationId,
      otherProjectId,
      otherWorkspace,
    )
    store.createTurn(turn(otherTurnId, otherConversationId))
  }
}

function createProject(store, id, rootPath) {
  const root = normalizeTrustedProjectRoot(rootPath)
  store.createProject({
    projectId: id,
    name: id,
    rootPath: root.rootPath,
    rootPathKey: root.rootPathKey,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
}

function createConversation(store, id, ownerProjectId, cwd) {
  store.createConversation({
    conversationId: id,
    projectId: ownerProjectId,
    title: 'Attention',
    provider: 'codex',
    providerThreadId: `provider-${id}`,
    cwd,
    status: 'completed',
    createdAt: timestamp,
    updatedAt: timestamp,
    lastActivityAt: timestamp,
  })
}

function turn(id, ownerConversationId) {
  return {
    turnId: id,
    conversationId: ownerConversationId,
    providerTurnId: `provider-${id}`,
    input: { type: 'text', text: 'Attention fixture', timestamp },
    status: 'completed',
    startedAt: timestamp,
    completedAt: timestamp,
    snapshotVersion: 1,
    snapshot: { fixture: true },
  }
}

function attention(index, type, options = {}) {
  const suffix = String(index).padStart(6, '0')
  return {
    attentionId: `attn_${suffix}`,
    sourceKey: `fixture:${type}:${suffix}`,
    projectId,
    conversationId,
    ...(options.turnId === undefined && 'turnId' in options
      ? {}
      : { turnId: options.turnId ?? turnId }),
    type,
    payload: options.payload ?? { summary: `${type} ${suffix}` },
    createdAt: options.createdAt ?? timestamp,
    updatedAt: options.updatedAt ?? timeAt(index),
  }
}

function timeAt(offsetMinutes) {
  return new Date(Date.parse(timestamp) + offsetMinutes * 60_000).toISOString()
}

function emptySummary() {
  return {
    total: 0,
    open: 0,
    resolved: 0,
    expired: 0,
    openApproval: 0,
    openCompletedReview: 0,
    openFailed: 0,
  }
}
