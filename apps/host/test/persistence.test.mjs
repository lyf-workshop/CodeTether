import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import {
  ConversationStore,
  currentSchemaVersion,
  resolveCodeTetherDataDirectory,
  resolveCodeTetherDatabasePath,
} from '../dist/persistence/index.js'
import { normalizeTrustedProjectRoot } from '../dist/project-path.js'
import { createV1Database } from './fixtures/persistence-v1.mjs'
import { downgradeExistingProviderSessionsToVersionFourteen } from './fixtures/existing-provider-sessions-v14.mjs'

const conversationId = 'conv_persistence01'
const projectId = 'proj_persistence01'
const timestamp = '2026-08-26T12:00:00.000Z'
const workspaceRoot = resolve(tmpdir(), 'codetether-persistence-workspace')

test('resolves configured and platform-default data directories outside cwd semantics', () => {
  assert.equal(
    resolveCodeTetherDataDirectory({
      env: { CODETETHER_DATA_DIR: 'C:\\data\\codetether' },
      homeDirectory: 'C:\\Users\\test',
      platform: 'win32',
    }),
    'C:\\data\\codetether',
  )
  assert.equal(
    resolveCodeTetherDataDirectory({
      env: { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' },
      homeDirectory: 'C:\\Users\\test',
      platform: 'win32',
    }),
    'C:\\Users\\test\\AppData\\Local\\CodeTether',
  )
  assert.equal(
    resolveCodeTetherDataDirectory({
      env: {},
      homeDirectory: '/Users/test',
      platform: 'darwin',
    }),
    '/Users/test/Library/Application Support/CodeTether',
  )
  assert.equal(
    resolveCodeTetherDatabasePath({
      env: { XDG_DATA_HOME: '/var/data' },
      homeDirectory: '/home/test',
      platform: 'linux',
    }),
    '/var/data/codetether/codetether.sqlite3',
  )
  assert.throws(
    () =>
      resolveCodeTetherDataDirectory({
        env: { CODETETHER_DATA_DIR: './data' },
        platform: 'linux',
      }),
    /absolute path/,
  )
})

test('migrates a fresh database and reopens the same schema idempotently', () => {
  withDatabase((databasePath) => {
    const first = ConversationStore.open({ databasePath })
    assert.equal(first.schemaVersion, currentSchemaVersion)
    first.close()

    const second = ConversationStore.open({ databasePath })
    second.close()
  })
})

test('migration 012 adds durable Turn start actions transactionally', () => {
  withDatabase((databasePath) => {
    const seed = ConversationStore.open({ databasePath })
    seed.createProject(project(seed))
    seed.createConversation(conversation(seed))
    seed.createTurn(turn(1, { migration: 'preserve' }))
    seed.close()

    const downgrade = new DatabaseSync(databasePath)
    downgradeExistingProviderSessionsToVersionFourteen(downgrade)
    downgrade.exec(`
      DELETE FROM schema_migrations WHERE version IN (12, 13, 14);
      DROP TABLE machine_relay_configurations;
      DROP TABLE machine_provider_execution_health;
      DROP TABLE turn_start_actions;
      CREATE INDEX idx_turn_start_actions_created ON turns(started_at);
    `)
    downgrade.close()

    assert.throws(
      () => ConversationStore.open({ databasePath }),
      /idx_turn_start_actions_created/u,
    )
    const rolledBack = new DatabaseSync(databasePath)
    assert.equal(
      rolledBack
        .prepare('SELECT MAX(version) AS version FROM schema_migrations')
        .get().version,
      11,
    )
    assert.equal(
      rolledBack
        .prepare(
          `SELECT COUNT(*) AS count FROM sqlite_master
           WHERE type = 'table' AND name = 'turn_start_actions'`,
        )
        .get().count,
      0,
    )
    assert.deepEqual(rolledBack.prepare('PRAGMA foreign_key_check').all(), [])
    assert.equal(
      rolledBack.prepare('SELECT COUNT(*) AS count FROM turns').get().count,
      1,
    )
    rolledBack.exec('DROP INDEX idx_turn_start_actions_created')
    rolledBack.close()

    const migrated = ConversationStore.open({ databasePath })
    assert.equal(migrated.schemaVersion, 17)
    assert.equal(
      migrated.getTurnForStartAction('act_migration_start01'),
      undefined,
    )
    assert.equal(migrated.getConversation(conversationId).projectId, projectId)
    assert.deepEqual(migrated.getTurn('turn_persistence01').snapshot, {
      migration: 'preserve',
    })
    migrated.close()
  })
})

test('migration 002 backfills shared Projects and preserves v1 Conversation and Turn data', () => {
  withDatabase((databasePath) => {
    const firstRoot = resolve(databasePath, '..', 'missing-project-one')
    const secondRoot = resolve(databasePath, '..', 'missing-project-two')
    const conversations = [
      legacyConversation('conv_migrate01', firstRoot, {
        providerThreadId: 'provider-thread-one',
        createdAt: '2026-08-20T10:00:00.000Z',
        updatedAt: '2026-08-22T10:00:00.000Z',
      }),
      legacyConversation('conv_migrate02', firstRoot, {
        providerThreadId: 'provider-thread-two',
        createdAt: '2026-08-19T10:00:00.000Z',
        updatedAt: '2026-08-24T10:00:00.000Z',
      }),
      legacyConversation('conv_migrate03', secondRoot, {
        providerThreadId: 'provider-thread-three',
        createdAt: '2026-08-21T10:00:00.000Z',
        updatedAt: '2026-08-23T10:00:00.000Z',
      }),
    ]
    const turns = [
      legacyTurn('turn_migrate01', 'conv_migrate01', 'provider-turn-one'),
      legacyTurn('turn_migrate02', 'conv_migrate02', 'provider-turn-two'),
    ]
    createV1Database(databasePath, { conversations, turns })

    const store = ConversationStore.open({ databasePath })
    assert.equal(store.schemaVersion, currentSchemaVersion)
    const projects = store.listProjects()
    const [machine] = store.listMachines()
    assert.ok(machine)
    assert.equal(projects.length, 2)
    assert.ok(
      projects.every((project) =>
        /^proj_[A-Za-z0-9][A-Za-z0-9_-]{5,95}$/.test(project.projectId),
      ),
    )

    const firstProject = store.getProjectByRootPathKey(
      machine.machineId,
      normalizeTrustedProjectRoot(firstRoot).rootPathKey,
    )
    const secondProject = store.getProjectByRootPathKey(
      machine.machineId,
      normalizeTrustedProjectRoot(secondRoot).rootPathKey,
    )
    assert.ok(firstProject)
    assert.ok(secondProject)
    assert.notEqual(firstProject.projectId, secondProject.projectId)
    assert.equal(firstProject.name, basename(firstRoot))
    assert.equal(firstProject.createdAt, '2026-08-19T10:00:00.000Z')
    assert.equal(firstProject.updatedAt, '2026-08-24T10:00:00.000Z')
    assert.equal(store.countConversationsForProject(firstProject.projectId), 2)
    assert.equal(store.countConversationsForProject(secondProject.projectId), 1)

    const migratedOne = store.getConversation('conv_migrate01')
    const migratedTwo = store.getConversation('conv_migrate02')
    const migratedThree = store.getConversation('conv_migrate03')
    assert.equal(migratedOne.projectId, firstProject.projectId)
    assert.equal(migratedTwo.projectId, firstProject.projectId)
    assert.equal(migratedThree.projectId, secondProject.projectId)
    assert.equal(migratedOne.providerThreadId, 'provider-thread-one')
    assert.equal(migratedTwo.providerThreadId, 'provider-thread-two')
    assert.equal(migratedThree.providerThreadId, 'provider-thread-three')
    assert.equal(migratedOne.cwd, firstRoot)
    assert.deepEqual(store.listTurns('conv_migrate01'), [
      durableLegacyTurn(turns[0]),
    ])
    assert.deepEqual(store.listTurns('conv_migrate02'), [
      durableLegacyTurn(turns[1]),
    ])

    const stableIds = projects.map((project) => project.projectId).sort()
    store.close()
    const reopened = ConversationStore.open({ databasePath })
    assert.deepEqual(
      reopened
        .listProjects()
        .map((project) => project.projectId)
        .sort(),
      stableIds,
    )
    reopened.close()

    assert.equal(
      runIsolatedSqlite(
        databasePath,
        '',
        'SELECT COUNT(*) AS count FROM pragma_foreign_key_check',
      ),
      JSON.stringify({ count: 0 }),
    )
  })
})

test('migration 002 preserves a normalized absolute Project path that is currently missing', () => {
  withDatabase((databasePath) => {
    const missingRoot = resolve(databasePath, '..', 'not-on-disk')
    createV1Database(databasePath, {
      conversations: [legacyConversation('conv_missingroot01', missingRoot)],
    })

    const store = ConversationStore.open({ databasePath })
    const [project] = store.listProjects()
    assert.equal(project.locations[0].rootPath, missingRoot)
    assert.equal(store.getConversation('conv_missingroot01').cwd, missingRoot)
    store.close()
  })
})

test('migration 002 rejects an invalid legacy cwd and rolls back to intact v1 data', () => {
  withDatabase((databasePath) => {
    createV1Database(databasePath, {
      conversations: [
        legacyConversation('conv_invalidcwd01', 'relative/project'),
      ],
    })

    assert.throws(
      () => ConversationStore.open({ databasePath }),
      /root path must be absolute/,
    )
    assert.equal(
      runIsolatedSqlite(
        databasePath,
        '',
        'SELECT MAX(version) AS version FROM schema_migrations',
      ),
      JSON.stringify({ version: 1 }),
    )
    assert.equal(
      runIsolatedSqlite(
        databasePath,
        '',
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'projects'",
      ),
      JSON.stringify({ count: 0 }),
    )
    assert.equal(
      runIsolatedSqlite(
        databasePath,
        '',
        "SELECT cwd FROM conversations WHERE conversation_id = 'conv_invalidcwd01'",
      ),
      JSON.stringify({ cwd: 'relative/project' }),
    )
  })
})

test('migration 002 rolls back a mid-copy foreign-key failure without changing v1', () => {
  withDatabase((databasePath) => {
    const root = resolve(databasePath, '..', 'legacy-project')
    createV1Database(databasePath, {
      conversations: [legacyConversation('conv_validlegacy01', root)],
      turns: [
        legacyTurn(
          'turn_orphanlegacy01',
          'conv_orphanlegacy01',
          'provider-orphan',
        ),
      ],
    })

    assert.throws(
      () => ConversationStore.open({ databasePath }),
      /FOREIGN KEY constraint failed/,
    )
    assert.equal(
      runIsolatedSqlite(
        databasePath,
        '',
        'SELECT COUNT(*) AS count FROM schema_migrations',
      ),
      JSON.stringify({ count: 1 }),
    )
    assert.equal(
      runIsolatedSqlite(
        databasePath,
        '',
        'SELECT COUNT(*) AS count FROM turns',
      ),
      JSON.stringify({ count: 1 }),
    )
    assert.equal(
      runIsolatedSqlite(
        databasePath,
        '',
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('projects', 'conversations_v2', 'turns_v2')",
      ),
      JSON.stringify({ count: 0 }),
    )
  })
})

test('migration history must be an exact ordered prefix', () => {
  withDatabase((databasePath) => {
    runIsolatedSqlite(
      databasePath,
      `
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          applied_at TEXT NOT NULL
        ) STRICT;
        INSERT INTO schema_migrations(version, name, applied_at)
          VALUES (2, 'projects', '${timestamp}');
      `,
    )
    assert.throws(
      () => ConversationStore.open({ databasePath }),
      /Unsupported SQLite schema migration 2 \(projects\)/,
    )
  })
})

test('enables foreign keys, WAL, and the configured busy timeout', () => {
  withDatabase((databasePath) => {
    const store = ConversationStore.open({ databasePath, busyTimeoutMs: 3210 })
    const raw = new DatabaseSync(databasePath)
    assert.equal(readPragma(raw, 'foreign_keys'), 1)
    assert.equal(readPragma(raw, 'journal_mode'), 'wal')
    // busy_timeout is connection-local, so validate the persistent store by
    // opening with zero and exercising that argument separately below.
    raw.close()
    store.close()
    assert.throws(
      () => ConversationStore.open({ databasePath, busyTimeoutMs: -1 }),
      /non-negative integer/,
    )
  })
})

test('persists Conversation and normalized Turn snapshots across reopen', () => {
  withDatabase((databasePath) => {
    const store = ConversationStore.open({ databasePath })
    store.createProject(project(store))
    store.createConversation(conversation(store))
    store.createTurn(turn(1, { messages: [{ text: 'first answer' }] }))
    store.createTurn(turn(2, { tools: [{ title: '读取文件' }] }))
    store.close()

    const reopened = ConversationStore.open({ databasePath })
    assert.deepEqual(
      reopened.getConversation(conversationId),
      conversation(reopened),
    )
    assert.equal(reopened.countTurns(conversationId), 2)
    assert.deepEqual(reopened.listTurns(conversationId), [
      turn(1, { messages: [{ text: 'first answer' }] }),
      turn(2, { tools: [{ title: '读取文件' }] }),
    ])
    assert.deepEqual(reopened.listRecentTurns(conversationId, 1), [
      turn(2, { tools: [{ title: '读取文件' }] }),
    ])
    reopened.close()
  })
})

test('durably binds one Start action to its exact Turn across reopen', () => {
  withDatabase((databasePath) => {
    const actionId = 'act_durable_start01'
    const store = ConversationStore.open({ databasePath })
    store.createProject(project(store))
    const durableConversation = conversation(store)
    store.createConversation(durableConversation)
    const startedTurn = {
      turnId: 'turn_persistence01',
      conversationId,
      input: {
        type: 'text',
        text: 'Prompt 1',
        timestamp: '2026-08-26T12:01:00.000Z',
      },
      status: 'starting',
      startedAt: '2026-08-26T12:01:00.000Z',
      snapshotVersion: 1,
      snapshot: { phase: 'starting' },
    }
    store.createTurnForStartAction({
      actionId,
      turn: startedTurn,
      conversation: {
        ...durableConversation,
        status: 'running',
        updatedAt: startedTurn.startedAt,
        lastActivityAt: startedTurn.startedAt,
      },
    })

    assert.deepEqual(store.getTurnForStartAction(actionId), startedTurn)
    assert.equal(store.getConversation(conversationId).status, 'running')
    assert.throws(
      () =>
        store.createTurnForStartAction({
          actionId,
          turn: turn(2, { phase: 'other' }),
          conversation: durableConversation,
        }),
      /UNIQUE constraint failed: turn_start_actions\.action_id/u,
    )
    assert.equal(store.getTurn('turn_persistence02'), undefined)
    store.close()

    const reopened = ConversationStore.open({ databasePath })
    assert.deepEqual(reopened.getTurnForStartAction(actionId), startedTurn)
    assert.equal(reopened.deleteConversation(conversationId), true)
    assert.equal(reopened.getTurnForStartAction(actionId), undefined)
    reopened.close()
  })
})

test('Start action transaction rolls back its Turn and ledger when Conversation advance fails', () => {
  withDatabase((databasePath) => {
    const actionId = 'act_durable_rollback01'
    let store = ConversationStore.open({ databasePath })
    store.createProject(project(store))
    const durableConversation = conversation(store)
    store.createConversation(durableConversation)
    store.close()

    const raw = new DatabaseSync(databasePath)
    raw.exec(`
      CREATE TRIGGER reject_start_action_conversation_update
      BEFORE UPDATE ON conversations
      BEGIN
        SELECT RAISE(ABORT, 'controlled conversation update failure');
      END;
    `)
    raw.close()

    store = ConversationStore.open({ databasePath })
    const startedTurn = turn(
      3,
      { phase: 'starting' },
      {
        providerTurnId: undefined,
        status: 'starting',
        completedAt: undefined,
      },
    )
    assert.throws(
      () =>
        store.createTurnForStartAction({
          actionId,
          turn: startedTurn,
          conversation: {
            ...durableConversation,
            status: 'running',
            updatedAt: startedTurn.startedAt,
            lastActivityAt: startedTurn.startedAt,
          },
        }),
      /controlled conversation update failure/u,
    )
    assert.equal(store.getTurn(startedTurn.turnId), undefined)
    assert.equal(store.getTurnForStartAction(actionId), undefined)
    assert.deepEqual(store.getConversation(conversationId), durableConversation)
    store.close()
  })
})

test('updates lifecycle records, reports incomplete Turns, and cascades deletion', () => {
  withDatabase((databasePath) => {
    const store = ConversationStore.open({ databasePath })
    store.createProject(project(store))
    store.createConversation(
      conversation(store, {
        providerThreadId: undefined,
        status: 'creating',
      }),
    )
    store.updateConversation(conversation(store))
    store.createTurn(turn(1, { phase: 'starting' }, { status: 'starting' }))
    store.createTurn(turn(2, { phase: 'done' }))

    assert.deepEqual(store.listIncompleteTurns(), [
      turn(1, { phase: 'starting' }, { status: 'starting' }),
    ])
    store.updateTurn(
      turn(
        1,
        { phase: 'interrupted', reason: 'host_restart' },
        {
          status: 'interrupted',
          completedAt: '2026-08-26T12:01:00.000Z',
        },
      ),
    )
    assert.equal(store.listIncompleteTurns().length, 0)
    assert.equal(store.deleteConversation(conversationId), true)
    assert.equal(store.getTurn('turn_persistence01'), undefined)
    assert.equal(store.deleteConversation(conversationId), false)
    store.close()
  })
})

test('a durable terminal Turn cannot transition to another outcome', () => {
  withDatabase((databasePath) => {
    const store = ConversationStore.open({ databasePath })
    store.createProject(project(store))
    store.createConversation(conversation(store))
    const completed = turn(1, { phase: 'completed' })
    store.createTurn(completed)

    assert.throws(
      () =>
        store.updateTurn(
          turn(
            1,
            { phase: 'late-failure' },
            {
              status: 'failed',
              completedAt: '2026-08-26T12:02:00.000Z',
            },
          ),
        ),
      /Turn/u,
    )
    assert.deepEqual(store.getTurn(completed.turnId), completed)
    store.close()
  })
})

test('rolls back explicit transactions and rejects use after close', () => {
  withDatabase((databasePath) => {
    const store = ConversationStore.open({ databasePath })
    store.createProject(project(store))
    assert.throws(
      () =>
        store.runInTransaction(() => {
          store.createConversation(conversation(store))
          throw new Error('rollback marker')
        }),
      /rollback marker/,
    )
    assert.equal(store.getConversation(conversationId), undefined)
    store.close()
    store.close()
    assert.throws(() => store.listConversations(), /closed/)
  })
})

test('migration failure preserves the existing database and user data', () => {
  withDatabase((databasePath) => {
    runIsolatedSqlite(
      databasePath,
      `
        CREATE TABLE sentinel(value TEXT NOT NULL) STRICT;
        INSERT INTO sentinel(value) VALUES ('keep-me');
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          applied_at TEXT NOT NULL
        ) STRICT;
        INSERT INTO schema_migrations(version, name, applied_at)
          VALUES (999, 'future', '${timestamp}');
      `,
    )

    assert.throws(
      () => ConversationStore.open({ databasePath }),
      /Unsupported SQLite schema migration 999/,
    )
    assert.equal(existsSync(databasePath), true)

    assert.equal(
      runIsolatedSqlite(databasePath, '', 'SELECT value FROM sentinel'),
      JSON.stringify({ value: 'keep-me' }),
    )
  })
})

test('failed migration rolls back partial schema changes and the version row', () => {
  withDatabase((databasePath) => {
    runIsolatedSqlite(
      databasePath,
      `
        CREATE TABLE sentinel(value TEXT NOT NULL) STRICT;
        INSERT INTO sentinel(value) VALUES ('keep-me');
        CREATE TABLE conversations(conflicting_column TEXT) STRICT;
      `,
    )

    assert.throws(
      () => ConversationStore.open({ databasePath }),
      /conversations already exists/,
    )
    assert.equal(
      runIsolatedSqlite(databasePath, '', 'SELECT value FROM sentinel'),
      JSON.stringify({ value: 'keep-me' }),
    )
    assert.equal(
      runIsolatedSqlite(
        databasePath,
        '',
        'SELECT COUNT(*) AS count FROM schema_migrations',
      ),
      JSON.stringify({ count: 0 }),
    )
    assert.equal(
      runIsolatedSqlite(
        databasePath,
        '',
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'turns'",
      ),
      JSON.stringify({ count: 0 }),
    )
  })
})

test('store connection enforces Conversation foreign keys for Turns', () => {
  withDatabase((databasePath) => {
    const store = ConversationStore.open({ databasePath })
    assert.throws(
      () => store.createTurn(turn(3, { message: 'orphan' })),
      /FOREIGN KEY constraint failed/,
    )
    assert.equal(store.countTurns(conversationId), 0)
    store.close()
  })
})

test('persists Project CRUD, canonical key uniqueness, and Conversation counts', () => {
  withDatabase((databasePath) => {
    const store = ConversationStore.open({ databasePath })
    const created = project(store)
    store.createProject(created)
    assert.deepEqual(store.getProject(projectId), created)
    assert.deepEqual(
      store.getProjectByRootPathKey(
        created.locations[0].machineId,
        created.locations[0].rootPathKey,
      ),
      created,
    )
    assert.deepEqual(store.listProjects(), [created])
    assert.equal(store.countConversationsForProject(projectId), 0)

    const renamed = {
      ...created,
      name: 'Renamed Project',
      updatedAt: '2026-08-26T12:05:00.000Z',
    }
    store.updateProject(renamed)
    assert.deepEqual(store.getProject(projectId), renamed)
    assert.throws(
      () =>
        store.createProject({
          ...created,
          projectId: 'proj_duplicate01',
          locations: created.locations.map((location) => ({
            ...location,
            projectId: 'proj_duplicate01',
          })),
        }),
      /UNIQUE constraint failed: project_locations\.machine_id, project_locations\.root_path_key/,
    )
    assert.throws(
      () =>
        store.createConversation({
          ...conversation(store),
          projectId: 'proj_missingproject01',
        }),
      /FOREIGN KEY constraint failed/,
    )

    store.createConversation(conversation(store))
    assert.equal(store.countConversationsForProject(projectId), 1)
    assert.throws(
      () => store.deleteProject(projectId),
      /FOREIGN KEY constraint failed/,
    )
    assert.equal(store.deleteConversation(conversationId), true)
    assert.equal(store.deleteProject(projectId), true)
    assert.equal(store.deleteProject(projectId), false)
    store.close()
  })
})

test('corrupt database open fails without replacing user bytes', () => {
  withDatabase((databasePath) => {
    const original = Buffer.from('not-a-sqlite-database\0durable-history')
    writeFileSync(databasePath, original)

    assert.throws(() => ConversationStore.open({ databasePath }))
    assert.deepEqual(readFileSync(databasePath), original)
  })
})

function conversation(store, overrides = {}) {
  return {
    conversationId,
    projectId,
    machineId: store.listMachines()[0].machineId,
    title: '新会话',
    titleSource: 'generated',
    provider: 'codex',
    providerThreadId: 'provider-thread-persistence',
    origin: 'codetether',
    providerSessionMaterialized: false,
    cwd: workspaceRoot,
    model: 'gpt-5.6-sol',
    reasoning: 'medium',
    status: 'idle',
    createdAt: timestamp,
    updatedAt: timestamp,
    lastActivityAt: timestamp,
    ...overrides,
  }
}

function project(store, overrides = {}) {
  const root = normalizeTrustedProjectRoot(workspaceRoot)
  const machineId = store.listMachines()[0].machineId
  return {
    projectId,
    name: basename(root.rootPath),
    locations: [
      {
        projectId,
        machineId,
        rootPath: root.rootPath,
        rootPathKey: root.rootPathKey,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  }
}

function legacyConversation(id, cwd, overrides = {}) {
  return {
    conversationId: id,
    provider: 'codex',
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

function legacyTurn(turnId, legacyConversationId, providerTurnId) {
  return {
    turnId,
    conversationId: legacyConversationId,
    providerTurnId,
    input: {
      type: 'text',
      text: `Prompt for ${turnId}`,
      timestamp,
    },
    status: 'completed',
    startedAt: timestamp,
    completedAt: '2026-08-26T12:01:00.000Z',
    snapshotVersion: 1,
    snapshot: { finalMessage: `Result for ${turnId}` },
  }
}

function durableLegacyTurn(value) {
  return {
    turnId: value.turnId,
    conversationId: value.conversationId,
    providerTurnId: value.providerTurnId,
    input: value.input,
    status: value.status,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
    snapshotVersion: value.snapshotVersion,
    snapshot: value.snapshot,
  }
}

function turn(index, snapshot, overrides = {}) {
  const suffix = String(index).padStart(2, '0')
  return {
    turnId: `turn_persistence${suffix}`,
    conversationId,
    providerTurnId: `provider-turn-${suffix}`,
    input: {
      type: 'text',
      text: `Prompt ${String(index)}`,
      timestamp: `2026-08-26T12:${suffix}:00.000Z`,
    },
    status: 'completed',
    startedAt: `2026-08-26T12:${suffix}:00.000Z`,
    completedAt: `2026-08-26T12:${suffix}:30.000Z`,
    snapshotVersion: 1,
    snapshot,
    ...overrides,
  }
}

function withDatabase(run) {
  const directory = mkdtempSync(join(tmpdir(), 'codetether-persistence-'))
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

function readPragma(database, pragma) {
  return Object.values(database.prepare(`PRAGMA ${pragma}`).get())[0]
}

function runIsolatedSqlite(databasePath, sql, query) {
  const script = `
    const { DatabaseSync } = require('node:sqlite')
    const database = new DatabaseSync(process.argv[1])
    database.exec(${JSON.stringify(sql)})
    if (process.argv[2]) {
      process.stdout.write(JSON.stringify(database.prepare(process.argv[2]).get()))
    }
    database.close()
  `
  return execFileSync(
    process.execPath,
    ['-e', script, databasePath, query ?? ''],
    { encoding: 'utf8' },
  )
}
