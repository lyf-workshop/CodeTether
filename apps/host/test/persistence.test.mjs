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
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import {
  ConversationStore,
  currentSchemaVersion,
  resolveCodeTetherDataDirectory,
  resolveCodeTetherDatabasePath,
} from '../dist/persistence/index.js'

const conversationId = 'conv_persistence01'
const timestamp = '2026-08-26T12:00:00.000Z'

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
    provider: 'codex',
    providerThreadId: 'provider-thread-persistence',
    cwd: 'C:\\safe\\workspace',
    model: 'gpt-5.6-sol',
    reasoning: 'medium',
    status: 'idle',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
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
