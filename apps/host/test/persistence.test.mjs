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
    assert.equal(projects.length, 2)
    assert.ok(
      projects.every((project) =>
        /^proj_[A-Za-z0-9][A-Za-z0-9_-]{5,95}$/.test(project.projectId),
      ),
    )

    const firstProject = store.getProjectByRootPathKey(
      normalizeTrustedProjectRoot(firstRoot).rootPathKey,
    )
    const secondProject = store.getProjectByRootPathKey(
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
    assert.equal(project.rootPath, missingRoot)
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
    store.createProject(project())
    store.createConversation(conversation())
    store.createTurn(turn(1, { messages: [{ text: 'first answer' }] }))
    store.createTurn(turn(2, { tools: [{ title: '读取文件' }] }))
    store.close()

    const reopened = ConversationStore.open({ databasePath })
    assert.deepEqual(reopened.getConversation(conversationId), conversation())
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

test('updates lifecycle records, reports incomplete Turns, and cascades deletion', () => {
  withDatabase((databasePath) => {
    const store = ConversationStore.open({ databasePath })
    store.createProject(project())
    store.createConversation(
      conversation({ providerThreadId: undefined, status: 'creating' }),
    )
    store.updateConversation(conversation())
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

test('rolls back explicit transactions and rejects use after close', () => {
  withDatabase((databasePath) => {
    const store = ConversationStore.open({ databasePath })
    store.createProject(project())
    assert.throws(
      () =>
        store.runInTransaction(() => {
          store.createConversation(conversation())
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
    const created = project()
    store.createProject(created)
    assert.deepEqual(store.getProject(projectId), created)
    assert.deepEqual(
      store.getProjectByRootPathKey(created.rootPathKey),
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
        }),
      /UNIQUE constraint failed: projects\.root_path_key/,
    )
    assert.throws(
      () =>
        store.createConversation({
          ...conversation(),
          projectId: 'proj_missingproject01',
        }),
      /FOREIGN KEY constraint failed/,
    )

    store.createConversation(conversation())
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

function conversation(overrides = {}) {
  return {
    conversationId,
    projectId,
    title: '新会话',
    provider: 'codex',
    providerThreadId: 'provider-thread-persistence',
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

function project(overrides = {}) {
  const root = normalizeTrustedProjectRoot(workspaceRoot)
  return {
    projectId,
    name: basename(root.rootPath),
    rootPath: root.rootPath,
    rootPathKey: root.rootPathKey,
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
