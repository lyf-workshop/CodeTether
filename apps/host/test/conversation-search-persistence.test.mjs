import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import {
  ConversationSearchCursorError,
  ConversationStore,
  currentSchemaVersion,
} from '../dist/persistence/index.js'
import { normalizeTrustedProjectRoot } from '../dist/project-path.js'
import { downgradeMachineFoundationToVersionSeven } from './fixtures/machine-foundation-v7.mjs'

const projectId = 'proj_search_primary'
const otherProjectId = 'proj_search_other'
const baseTime = '2026-08-28T12:00:00.000Z'

test('migration 006 backfills titles and canonical inputs without reading snapshots', () => {
  withFixture(({ databasePath, store, workspace }) => {
    const conversation = seedConversation(store, workspace, 1, {
      title: '登录模块重构',
      titleSource: 'manual',
      pinnedAt: timeAt(20),
      providerThreadId: 'provider-thread-preserved',
    })
    store.createTurn(
      durableTurn(conversation.conversationId, 1, {
        text: '请检查 Windows 登录后自动 reconnect 逻辑。',
      }),
    )
    store.close()
    downgradeToV5(databasePath)

    const raw = new DatabaseSync(databasePath)
    raw
      .prepare('UPDATE turns SET snapshot_json = ? WHERE conversation_id = ?')
      .run('{corrupt snapshot', conversation.conversationId)
    raw.close()

    const migrated = ConversationStore.open({ databasePath })
    assert.equal(currentSchemaVersion, 18)
    assert.equal(migrated.schemaVersion, 18)
    assert.equal(
      migrated.searchProjectConversations(projectId, { query: '登录' })
        .results[0].matchedField,
      'title',
    )
    assert.deepEqual(
      migrated
        .searchProjectConversations(projectId, { query: 'RECONNECT' })
        .results.map((result) => result.conversation.conversationId),
      [conversation.conversationId],
    )
    const restored = migrated.getConversation(conversation.conversationId)
    assert.equal(restored.titleSource, 'manual')
    assert.equal(restored.pinnedAt, timeAt(20))
    assert.equal(restored.providerThreadId, 'provider-thread-preserved')
    assert.equal(migrated.countTurns(conversation.conversationId), 1)

    const inspect = new DatabaseSync(databasePath)
    try {
      assert.equal(
        inspect
          .prepare(
            'SELECT COUNT(*) AS count FROM conversation_search_documents',
          )
          .get().count,
        2,
      )
      const columns = inspect
        .prepare(
          "SELECT name FROM pragma_table_info('conversation_search_documents')",
        )
        .all()
        .map((row) => row.name)
      assert.deepEqual(columns, [
        'document_key',
        'conversation_id',
        'turn_id',
        'field',
        'normalized_text',
      ])
    } finally {
      inspect.close()
      migrated.close()
    }
  })
})

test('migration 006 rolls back the search schema and version together', () => {
  withFixture(({ databasePath, store, workspace }) => {
    const conversation = seedConversation(store, workspace, 1, {
      title: 'Migration rollback sentinel',
    })
    store.close()
    downgradeToV5(databasePath)
    const conflict = new DatabaseSync(databasePath)
    conflict.exec(`
      CREATE INDEX idx_conversation_search_documents_owner
        ON conversations(conversation_id)
    `)
    conflict.close()

    assert.throws(
      () => ConversationStore.open({ databasePath }),
      /index idx_conversation_search_documents_owner already exists/u,
    )
    const inspect = new DatabaseSync(databasePath)
    try {
      assert.equal(
        inspect
          .prepare('SELECT MAX(version) AS version FROM schema_migrations')
          .get().version,
        5,
      )
      assert.equal(
        inspect
          .prepare('SELECT title FROM conversations WHERE conversation_id = ?')
          .get(conversation.conversationId).title,
        'Migration rollback sentinel',
      )
      assert.equal(
        inspect
          .prepare(
            `SELECT COUNT(*) AS count FROM sqlite_master
             WHERE type = 'table' AND name = 'conversation_search_documents'`,
          )
          .get().count,
        0,
      )
      assert.equal(triggerCount(inspect), 0)
    } finally {
      inspect.close()
    }
  })
})

test('migration 006 rejects malformed legacy canonical input without partial backfill', () => {
  withFixture(({ databasePath, store, workspace }) => {
    const conversation = seedConversation(store, workspace, 1)
    store.createTurn(durableTurn(conversation.conversationId, 1))
    store.close()
    downgradeToV5(databasePath)
    const corrupt = new DatabaseSync(databasePath)
    corrupt
      .prepare('UPDATE turns SET input = ? WHERE conversation_id = ?')
      .run('{"type":"text"}', conversation.conversationId)
    corrupt.close()

    assert.throws(() => ConversationStore.open({ databasePath }))
    const inspect = new DatabaseSync(databasePath)
    try {
      assert.equal(
        inspect
          .prepare('SELECT MAX(version) AS version FROM schema_migrations')
          .get().version,
        5,
      )
      assert.equal(
        inspect
          .prepare(
            `SELECT COUNT(*) AS count FROM sqlite_master
             WHERE type = 'table' AND name = 'conversation_search_documents'`,
          )
          .get().count,
        0,
      )
      assert.equal(triggerCount(inspect), 0)
    } finally {
      inspect.close()
    }
  })
})

test('title and canonical input projections update atomically with durable sources', () => {
  withFixture(({ store, workspace }) => {
    const conversation = seedConversation(store, workspace, 1, {
      title: '新会话',
    })
    assert.equal(searchIds(store, '新会话').length, 1)

    const generated = {
      ...conversation,
      title: 'WebSocket reconnect',
      updatedAt: timeAt(2),
    }
    store.updateConversation(generated)
    assert.deepEqual(searchIds(store, 'WEBSOCKET'), [
      conversation.conversationId,
    ])
    assert.equal(searchIds(store, '新会话').length, 0)

    store.renameConversation(
      conversation.conversationId,
      'Windows 登录恢复',
      timeAt(3),
    )
    assert.deepEqual(searchIds(store, '登录恢复'), [
      conversation.conversationId,
    ])
    assert.equal(searchIds(store, 'websocket').length, 0)

    const first = durableTurn(conversation.conversationId, 1, {
      text: '实现指数退避。',
    })
    store.createTurn(first)
    assert.deepEqual(searchIds(store, '指数退避'), [
      conversation.conversationId,
    ])
    store.updateTurn({
      ...first,
      input: { ...first.input, text: '改为抖动退避。' },
    })
    assert.equal(searchIds(store, '指数退避').length, 0)
    assert.deepEqual(searchIds(store, '抖动退避'), [
      conversation.conversationId,
    ])
  })
})

test('canonical inputs remain searchable after failed and interrupted Turns', () => {
  withFixture(({ store, workspace }) => {
    const failed = seedConversation(store, workspace, 1, {
      title: 'Failed execution',
      status: 'failed',
    })
    const interrupted = seedConversation(store, workspace, 2, {
      title: 'Interrupted execution',
      status: 'idle',
    })
    store.createTurn(
      durableTurn(failed.conversationId, 1, {
        text: 'failed-input-marker',
        status: 'failed',
      }),
    )
    store.createTurn(
      durableTurn(interrupted.conversationId, 1, {
        text: 'interrupted-input-marker',
        status: 'interrupted',
      }),
    )

    assert.deepEqual(searchIds(store, 'failed-input-marker'), [
      failed.conversationId,
    ])
    assert.deepEqual(searchIds(store, 'interrupted-input-marker'), [
      interrupted.conversationId,
    ])
    assert.deepEqual(
      searchIds(store, 'failed-input-marker', { status: 'failed' }),
      [failed.conversationId],
    )
  })
})

test('real discovery fixture explains title, input, and archive matches', () => {
  withFixture(({ store, workspace }) => {
    const login = seedConversation(store, workspace, 1, {
      title: '登录模块重构',
      titleSource: 'manual',
    })
    store.createTurn(
      durableTurn(login.conversationId, 1, {
        text: '请检查 Windows 登录后自动重连逻辑。',
      }),
    )
    const reconnect = seedConversation(store, workspace, 2, {
      title: 'WebSocket reconnect',
      titleSource: 'manual',
    })
    store.createTurn(
      durableTurn(reconnect.conversationId, 1, {
        text: '实现指数退避。',
      }),
    )
    const migration = seedConversation(store, workspace, 3, {
      title: '数据库迁移',
      titleSource: 'manual',
    })
    store.createTurn(
      durableTurn(migration.conversationId, 1, {
        text: '不要修改登录模块。',
      }),
    )
    const archived = seedConversation(store, workspace, 4, {
      title: '旧版 reconnect 实验',
      titleSource: 'manual',
      archivedAt: timeAt(40),
    })

    assert.deepEqual(searchIds(store, '登录'), [
      login.conversationId,
      migration.conversationId,
    ])
    assert.deepEqual(searchIds(store, 'reconnect'), [reconnect.conversationId])
    assert.deepEqual(searchIds(store, '指数退避'), [reconnect.conversationId])
    assert.deepEqual(searchIds(store, '数据库迁移'), [migration.conversationId])
    assert.deepEqual(searchIds(store, 'reconnect', { archive: 'archived' }), [
      archived.conversationId,
    ])
  })
})

test('ranking is deterministic and one Conversation selects its newest matching input', () => {
  withFixture(({ store, workspace }) => {
    const exact = seedConversation(store, workspace, 1, {
      title: 'reconnect',
    })
    const prefix = seedConversation(store, workspace, 2, {
      title: 'Reconnect strategy',
      pinnedAt: timeAt(40),
    })
    const contains = seedConversation(store, workspace, 3, {
      title: 'Windows reconnect strategy',
    })
    const inputPinned = seedConversation(store, workspace, 4, {
      title: 'Background task',
      pinnedAt: timeAt(41),
    })
    const inputNormal = seedConversation(store, workspace, 5, {
      title: 'Network task',
    })
    store.createTurn(
      durableTurn(inputPinned.conversationId, 1, {
        text: 'first reconnect marker',
        startedAt: timeAt(10),
      }),
    )
    store.createTurn(
      durableTurn(inputPinned.conversationId, 2, {
        text: 'newest reconnect marker',
        startedAt: timeAt(20),
      }),
    )
    store.createTurn(
      durableTurn(inputNormal.conversationId, 1, {
        text: 'normal reconnect marker',
      }),
    )

    const response = store.searchProjectConversations(projectId, {
      query: 'RECONNECT',
    })
    assert.deepEqual(
      response.results.map((result) => result.conversation.conversationId),
      [
        exact.conversationId,
        prefix.conversationId,
        contains.conversationId,
        inputPinned.conversationId,
        inputNormal.conversationId,
      ],
    )
    assert.deepEqual(
      response.results.map((result) => result.matchedField),
      ['title', 'title', 'title', 'user_input', 'user_input'],
    )
    assert.equal(response.results[3].matchedTurnId, 'turn_search_00004_02')
    assert.match(response.results[3].matchPreview, /newest reconnect/u)
  })
})

test('Project, archive, status, and provider filters stay inside durable SQL scope', () => {
  withFixture(({ store, workspace, otherWorkspace }) => {
    const active = seedConversation(store, workspace, 1, {
      title: 'Shared marker active',
      status: 'completed',
    })
    const archived = seedConversation(store, workspace, 2, {
      title: 'Shared marker archived',
      status: 'failed',
      archivedAt: timeAt(40),
    })
    seedConversation(store, otherWorkspace, 3, {
      projectId: otherProjectId,
      title: 'Shared marker other Project',
    })

    assert.deepEqual(searchIds(store, 'shared marker'), [active.conversationId])
    assert.deepEqual(
      searchIds(store, 'shared marker', { archive: 'archived' }),
      [archived.conversationId],
    )
    assert.deepEqual(searchIds(store, 'shared marker', { archive: 'all' }), [
      active.conversationId,
      archived.conversationId,
    ])
    assert.deepEqual(
      searchIds(store, 'shared marker', {
        archive: 'all',
        status: 'failed',
      }),
      [archived.conversationId],
    )
    assert.deepEqual(searchIds(store, 'shared marker', { provider: 'codex' }), [
      active.conversationId,
    ])
    assert.equal(
      store.searchProjectConversations(otherProjectId, {
        query: 'shared marker',
        archive: 'all',
      }).results.length,
      1,
    )
  })
})

test('normalization is case-aware, NFC-based, whitespace-stable, and literal', () => {
  withFixture(({ store, workspace }) => {
    const unicode = seedConversation(store, workspace, 1, {
      title: 'Café 中文 😀 ＡＢＣ',
    })
    const input = durableTurn(unicode.conversationId, 1, {
      text: 'Windows\n\t登录   自动重连 C++',
    })
    store.createTurn(input)

    for (const query of ['CAFÉ', 'Cafe\u0301', '中文', '😀', 'ａｂｃ']) {
      assert.deepEqual(searchIds(store, query), [unicode.conversationId])
    }
    assert.deepEqual(searchIds(store, '登录 自动重连'), [
      unicode.conversationId,
    ])
    assert.deepEqual(searchIds(store, 'C++'), [unicode.conversationId])
    assert.equal(searchIds(store, 'ABC').length, 0)
    assert.equal(searchIds(store, "' OR 1=1 --").length, 0)
    assert.doesNotThrow(() =>
      store.searchProjectConversations(projectId, {
        query: 'İ'.repeat(160),
      }),
    )
    assert.throws(
      () => store.searchProjectConversations(projectId, { query: ' ' }),
      /search query/u,
    )
    assert.throws(
      () =>
        store.searchProjectConversations(projectId, {
          query: 'x'.repeat(257),
        }),
      /search query/u,
    )
  })
})

test('long User input returns a plain bounded preview around the first match', () => {
  withFixture(({ store, workspace }) => {
    const conversation = seedConversation(store, workspace, 1, {
      title: 'Long prompt',
    })
    store.createTurn(
      durableTurn(conversation.conversationId, 1, {
        text: `${'前'.repeat(300)}UNIQUE-MARKER😀${'后'.repeat(300)}`,
      }),
    )
    const [result] = store.searchProjectConversations(projectId, {
      query: 'unique-marker😀',
    }).results
    assert.equal(result.matchedField, 'user_input')
    assert.match(result.matchPreview, /UNIQUE-MARKER😀/u)
    assert.ok(graphemeCount(result.matchPreview) <= 160)
    assert.ok(result.matchPreview.length <= 1_024)
    assert.equal(result.matchPreview.includes('<mark>'), false)

    const emojiConversation = seedConversation(store, workspace, 2, {
      title: 'Emoji prompt',
    })
    const family = '👨‍👩‍👧‍👦'
    store.createTurn(
      durableTurn(emojiConversation.conversationId, 1, {
        text: `${family.repeat(80)}EMOJI-MARKER${'e\u0301'.repeat(200)}${family.repeat(80)}`,
      }),
    )
    const [emojiResult] = store.searchProjectConversations(projectId, {
      query: 'emoji-marker',
    }).results
    assert.match(emojiResult.matchPreview, /EMOJI-MARKER/u)
    assert.ok(graphemeCount(emojiResult.matchPreview) <= 160)
    assert.ok(emojiResult.matchPreview.length <= 1_024)

    const adversarial = seedConversation(store, workspace, 3, {
      title: 'Adversarial grapheme prompt',
    })
    store.createTurn(
      durableTurn(adversarial.conversationId, 1, {
        text: `A${'\u0301'.repeat(1_500)}`,
      }),
    )
    const [adversarialResult] = store.searchProjectConversations(projectId, {
      query: 'á',
    }).results
    assert.equal(adversarialResult.matchPreview, '…')
    assert.ok(adversarialResult.matchPreview.length <= 1_024)

    const contextualCase = seedConversation(store, workspace, 4, {
      title: 'Contextual Unicode prompt',
    })
    store.createTurn(
      durableTurn(contextualCase.conversationId, 1, {
        text: `${'prefix '.repeat(200)}ΟΣ`,
      }),
    )
    const [contextualResult] = store.searchProjectConversations(projectId, {
      query: 'ος',
    }).results
    assert.match(contextualResult.matchPreview, /ΟΣ/u)
    assert.ok(graphemeCount(contextualResult.matchPreview) <= 160)
  })
})

test('opaque keyset cursors are query-bound, strictly advance, and reject malformed reuse', () => {
  withFixture(({ store, workspace }) => {
    for (let index = 0; index < 9; index += 1) {
      const conversation = seedConversation(store, workspace, index, {
        title: `Cursor match ${String(index)}`,
      })
      if (index === 8) {
        store.archiveConversation(conversation.conversationId, timeAt(100))
      }
    }

    const seen = new Set()
    let cursor
    let pageCount = 0
    do {
      const page = store.searchProjectConversations(projectId, {
        query: 'cursor match',
        limit: 2,
        ...(cursor === undefined ? {} : { cursor }),
      })
      for (const result of page.results) {
        assert.equal(seen.has(result.conversation.conversationId), false)
        seen.add(result.conversation.conversationId)
      }
      if (page.hasMore) {
        assert.match(page.nextCursor, /^csc_[A-Za-z0-9_-]+$/u)
        assert.notEqual(page.nextCursor, cursor)
      }
      cursor = page.nextCursor
      pageCount += 1
      assert.ok(pageCount < 10)
    } while (cursor !== undefined)
    assert.equal(seen.size, 8)

    const first = store.searchProjectConversations(projectId, {
      query: 'cursor match',
      limit: 2,
    })
    assert.throws(
      () =>
        store.searchProjectConversations(projectId, {
          query: 'different query',
          limit: 2,
          cursor: first.nextCursor,
        }),
      ConversationSearchCursorError,
    )
    assert.throws(
      () =>
        store.searchProjectConversations(otherProjectId, {
          query: 'cursor match',
          limit: 2,
          cursor: first.nextCursor,
        }),
      ConversationSearchCursorError,
    )
    const cursorPayload = JSON.parse(
      Buffer.from(first.nextCursor.slice(4), 'base64url').toString('utf8'),
    )
    cursorPayload.primaryTime = 'August 28, 2026'
    const nonCanonicalTimestampCursor = `csc_${Buffer.from(
      JSON.stringify(cursorPayload),
      'utf8',
    ).toString('base64url')}`
    assert.throws(
      () =>
        store.searchProjectConversations(projectId, {
          query: 'cursor match',
          limit: 2,
          cursor: nonCanonicalTimestampCursor,
        }),
      ConversationSearchCursorError,
    )
    assert.throws(
      () =>
        store.searchProjectConversations(projectId, {
          query: 'cursor match',
          archive: 'all',
          limit: 2,
          cursor: first.nextCursor,
        }),
      ConversationSearchCursorError,
    )
    assert.throws(
      () =>
        store.searchProjectConversations(projectId, {
          query: 'cursor match',
          provider: 'codex',
          limit: 2,
          cursor: first.nextCursor,
        }),
      ConversationSearchCursorError,
    )
    assert.throws(
      () =>
        store.searchProjectConversations(projectId, {
          query: 'cursor match',
          status: 'completed',
          limit: 2,
          cursor: first.nextCursor,
        }),
      ConversationSearchCursorError,
    )
    assert.throws(
      () =>
        store.searchProjectConversations(projectId, {
          query: 'cursor match',
          cursor: 'csc_not-json',
        }),
      ConversationSearchCursorError,
    )
  })
})

test('50, 500, and 5,000 Conversation search stays bounded and reports projection size', (context) => {
  withFixture(({ databasePath, store, workspace }) => {
    const storage = {}
    const performanceBySize = {}
    let created = 0
    for (const target of [50, 500, 5_000]) {
      store.runInTransaction(() => {
        for (; created < target; created += 1) {
          const title =
            created % 10 === 0
              ? `Common reconnect ${String(created)}`
              : `Conversation ${String(created)}`
          const conversation = seedConversation(store, workspace, created, {
            title: created % 13 === 0 ? `${title} 中文检索` : title,
            ...(created % 20 === 0 ? { archivedAt: timeAt(created + 10) } : {}),
          })
          store.createTurn(
            durableTurn(conversation.conversationId, 1, {
              text: `Durable input ${String(created)} ${created % 7 === 0 ? 'common keyword' : 'unique value'} ${created % 11 === 0 ? '中文输入' : ''}`,
            }),
          )
        }
      })
      storage[target] = searchStorageBytes(databasePath)
      performanceBySize[target] = {
        archived: measureSearch(() => {
          assert.ok(
            store.searchProjectConversations(projectId, {
              query: 'reconnect',
              archive: 'archived',
            }).results.length > 0,
          )
        }),
        common: measureSearch(() => {
          assert.ok(
            store.searchProjectConversations(projectId, {
              query: 'common',
              archive: 'all',
              limit: 100,
            }).results.length > 0,
          )
        }),
        noMatch: measureSearch(() => {
          assert.equal(
            store.searchProjectConversations(projectId, {
              query: 'definitely absent marker',
              archive: 'all',
            }).results.length,
            0,
          )
        }),
        title: measureSearch(() => {
          assert.ok(
            store
              .searchProjectConversations(projectId, {
                query: 'common reconnect',
                archive: 'all',
              })
              .results.every((result) => result.matchedField === 'title'),
          )
        }),
        unicode: measureSearch(() => {
          assert.ok(
            store.searchProjectConversations(projectId, {
              query: '中文检索',
              archive: 'all',
            }).results.length > 0,
          )
        }),
        userInput: measureSearch(() => {
          assert.ok(
            store
              .searchProjectConversations(projectId, {
                query: 'common keyword',
                archive: 'all',
              })
              .results.every((result) => result.matchedField === 'user_input'),
          )
        }),
      }
    }

    for (const target of [50, 500, 5_000]) {
      const result = performanceBySize[target]
      context.diagnostic(
        `${target.toLocaleString('en-US')} Conversations: title=${formatMeasurement(result.title)} user-input=${formatMeasurement(result.userInput)} common=${formatMeasurement(result.common)} no-match=${formatMeasurement(result.noMatch)} unicode=${formatMeasurement(result.unicode)} archived=${formatMeasurement(result.archived)}`,
      )
    }
    context.diagnostic(
      `search projection bytes: 50=${String(storage[50])} 500=${String(storage[500])} 5000=${String(storage[5000])}`,
    )
    assert.ok(storage[50] > 0)
    assert.ok(storage[500] >= storage[50])
    assert.ok(storage[5000] >= storage[500])
    assert.ok(performanceBySize[5000].common.p95 < 1_000)
  })
})

function measureSearch(operation) {
  const measurements = Array.from({ length: 20 }, () => {
    const startedAt = performance.now()
    operation()
    return performance.now() - startedAt
  }).sort((left, right) => left - right)
  return {
    median: measurements[Math.floor(measurements.length / 2)],
    p95: measurements[Math.ceil(measurements.length * 0.95) - 1],
  }
}

function formatMeasurement(measurement) {
  return `${measurement.median.toFixed(3)}/${measurement.p95.toFixed(3)}ms median/p95`
}

function withFixture(operation) {
  const directory = mkdtempSync(join(tmpdir(), 'codetether-search-'))
  const workspace = join(directory, 'workspace')
  const otherWorkspace = join(directory, 'other-workspace')
  const databasePath = join(directory, 'data', 'codetether.sqlite3')
  mkdirSync(workspace, { recursive: true })
  mkdirSync(otherWorkspace, { recursive: true })
  const store = ConversationStore.open({ databasePath })
  try {
    createProject(store, projectId, workspace)
    createProject(store, otherProjectId, otherWorkspace)
    operation({
      databasePath,
      directory,
      store,
      workspace,
      otherWorkspace,
    })
  } finally {
    try {
      store.close()
    } catch {
      // A migration test may close or fail to reopen its fixture.
    }
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    })
  }
}

function createProject(store, id, workspace) {
  const root = normalizeTrustedProjectRoot(workspace)
  const [machine] = store.listMachines()
  assert.ok(machine)
  store.createProject({
    projectId: id,
    name: id,
    location: {
      projectId: id,
      machineId: machine.machineId,
      rootPath: root.rootPath,
      rootPathKey: root.rootPathKey,
      createdAt: baseTime,
      updatedAt: baseTime,
    },
    createdAt: baseTime,
    updatedAt: baseTime,
  })
}

function seedConversation(store, workspace, index, overrides = {}) {
  const timestamp = timeAt(index)
  const [machine] = store.listMachines()
  assert.ok(machine)
  const conversation = {
    conversationId: `conv_search_${String(index).padStart(5, '0')}`,
    projectId,
    machineId: machine.machineId,
    title: `Conversation ${String(index)}`,
    titleSource: 'generated',
    provider: 'codex',
    providerThreadId: `provider-thread-${String(index)}`,
    cwd: workspace,
    model: 'gpt-5.6-sol',
    reasoning: 'medium',
    status: overrides.status ?? 'completed',
    createdAt: baseTime,
    updatedAt: timestamp,
    lastActivityAt: timestamp,
    ...overrides,
  }
  store.createConversation(conversation)
  return conversation
}

function durableTurn(conversationId, index, overrides = {}) {
  const startedAt = overrides.startedAt ?? timeAt(index)
  return {
    turnId: `${conversationId.replace('conv_', 'turn_')}_${String(index).padStart(2, '0')}`,
    conversationId,
    providerTurnId: `provider-turn-${String(index)}`,
    input: {
      type: 'text',
      text: overrides.text ?? `Input ${String(index)}`,
      timestamp: startedAt,
    },
    status: 'completed',
    startedAt,
    completedAt: startedAt,
    snapshotVersion: 1,
    snapshot: { durable: true },
  }
}

function searchIds(store, query, options = {}) {
  return store
    .searchProjectConversations(projectId, {
      query,
      limit: 100,
      ...options,
    })
    .results.map((result) => result.conversation.conversationId)
}

function downgradeToV5(databasePath) {
  downgradeMachineFoundationToVersionSeven(databasePath)
  const database = new DatabaseSync(databasePath)
  database.exec(`
    DROP TRIGGER trg_conversation_search_input_update;
    DROP TRIGGER trg_conversation_search_input_insert;
    DROP TRIGGER trg_conversation_search_title_update;
    DROP TRIGGER trg_conversation_search_title_insert;
    DROP TABLE conversation_search_documents;
    DELETE FROM schema_migrations WHERE version IN (6, 7, 8, 9, 10, 11, 12, 13, 14);
  `)
  database.close()
}

function triggerCount(database) {
  return database
    .prepare(
      `SELECT COUNT(*) AS count FROM sqlite_master
       WHERE type = 'trigger' AND name LIKE 'trg_conversation_search_%'`,
    )
    .get().count
}

function searchStorageBytes(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true })
  try {
    return (
      database
        .prepare(
          `SELECT COALESCE(SUM(pgsize), 0) AS bytes
           FROM dbstat
           WHERE name = 'conversation_search_documents' OR
                 name = 'idx_conversation_search_documents_owner' OR
                 name = 'sqlite_autoindex_conversation_search_documents_1'`,
        )
        .get().bytes ?? 0
    )
  } finally {
    database.close()
  }
}

function graphemeCount(value) {
  return [
    ...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(value),
  ].length
}

function timeAt(offsetMinutes) {
  return new Date(Date.parse(baseTime) + offsetMinutes * 60_000).toISOString()
}
