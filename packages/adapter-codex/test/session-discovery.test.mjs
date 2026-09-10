import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import test from 'node:test'

import {
  CodexOwnedProcessCleanupError,
  CodexSessionDiscovery,
  JsonRpcRemoteError,
} from '../dist/index.js'

function storedThread(overrides = {}) {
  return {
    id: 'thread-a',
    cwd: resolve('project-a'),
    name: 'Existing Codex conversation',
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_100,
    recencyAt: 1_700_000_050,
    cliVersion: '0.149.1',
    modelProvider: 'openai',
    source: 'cli',
    status: 'notLoaded',
    ephemeral: false,
    ...overrides,
  }
}

function clientFactory({
  threads = [],
  reads = new Map(),
  list,
  listTurns,
  listItems,
  tracker,
}) {
  return async () => {
    const client = {
      async listStoredThreads(options) {
        tracker?.methods.push({ method: 'thread/list', options })
        return list === undefined
          ? { threads, invalidEntryCount: 0 }
          : await list(options)
      },
      async readStoredThread(options) {
        tracker?.methods.push({ method: 'thread/read', options })
        const thread = reads.get(options.threadId)
        if (thread === undefined) throw new Error('missing test thread')
        return thread
      },
      async shutdown() {
        if (tracker !== undefined) tracker.shutdownCount += 1
      },
    }
    if (listTurns !== undefined) {
      client.listStoredThreadTurns = async (options) => {
        tracker?.methods.push({ method: 'thread/turns/list', options })
        return await listTurns(options)
      }
    }
    if (listItems !== undefined) {
      client.listStoredThreadItems = async (options) => {
        tracker?.methods.push({ method: 'thread/items/list', options })
        return await listItems(options)
      }
    }
    return client
  }
}

const canonicalizePath = async (path) => resolve(path)

test('local discovery accepts the selected installation environment without changing to the remote profile', () => {
  const discovery = new CodexSessionDiscovery({
    executable: process.execPath,
    environment: {
      PATH: process.env.PATH,
      CODEX_HOME: resolve('selected-codex-store'),
      CODEX_SESSION_ID: 'must-be-stripped-before-child-spawn',
    },
  })
  assert.equal(discovery.provider, 'codex')
})

test('discovers only exact, unloaded, durable Codex sessions with bounded metadata', async () => {
  const projectRoot = resolve('project-a')
  const otherRoot = resolve('project-b')
  const tracker = { methods: [], shutdownCount: 0 }
  const discovery = new CodexSessionDiscovery({
    providerVersion: '0.149.1',
    canonicalizePath,
    clientFactory: clientFactory({
      tracker,
      threads: [
        storedThread(),
        storedThread({ id: 'exec-thread', source: 'exec' }),
        storedThread(),
        storedThread({ id: 'thread-b', name: undefined }),
        storedThread({ id: 'other-project', cwd: otherRoot }),
        storedThread({ id: 'ephemeral', ephemeral: true }),
        storedThread({ id: 'active', status: 'active' }),
      ],
    }),
  })

  const page = await discovery.discover({
    projectRoot,
    cursor: 'opaque-cursor',
    limit: 50,
  })

  assert.equal(page.status, 'supported')
  assert.equal(page.providerVersion, '0.149.1')
  assert.equal(page.candidates.length, 3)
  assert.equal(page.candidates[0].title, 'Existing Codex conversation')
  assert.equal(page.candidates[1].title, 'Existing Codex conversation')
  assert.match(page.candidates[2].title, /^Codex conversation \u2014 /)
  assert.deepEqual(
    page.candidates.map(({ provider, workingDirectory, resumeStatus }) => ({
      provider,
      workingDirectory,
      resumeStatus,
    })),
    [
      {
        provider: 'codex',
        workingDirectory: projectRoot,
        resumeStatus: 'supported',
      },
      {
        provider: 'codex',
        workingDirectory: projectRoot,
        resumeStatus: 'supported',
      },
      {
        provider: 'codex',
        workingDirectory: projectRoot,
        resumeStatus: 'supported',
      },
    ],
  )
  assert.deepEqual(page.metrics, {
    filesInspected: 0,
    candidatesParsed: 7,
    candidatesMatched: 3,
    corruptEntriesSkipped: 0,
    elapsedMs: page.metrics.elapsedMs,
    truncated: false,
  })
  assert.equal(tracker.shutdownCount, 1)
  assert.deepEqual(tracker.methods, [
    {
      method: 'thread/list',
      options: { cwd: projectRoot, cursor: 'opaque-cursor', limit: 50 },
    },
  ])
  assert.equal(
    tracker.methods.some(({ method }) =>
      ['thread/start', 'thread/resume', 'turn/start'].includes(method),
    ),
    false,
  )
})

test('an ineligible duplicate cannot mask the same exact eligible native session', async () => {
  const projectRoot = resolve('project-a')
  const threadId = 'duplicate-thread'
  const page = await new CodexSessionDiscovery({
    canonicalizePath,
    clientFactory: clientFactory({
      threads: [
        storedThread({ id: threadId, cwd: resolve('project-b') }),
        storedThread({ id: threadId, cwd: projectRoot }),
        storedThread({ id: threadId, cwd: projectRoot }),
      ],
    }),
  }).discover({ projectRoot, limit: 10 })

  assert.equal(page.status, 'supported')
  assert.equal(page.candidates.length, 1)
  assert.equal(page.candidates[0].nativeSessionId, threadId)
  assert.equal(page.candidates[0].workingDirectory, projectRoot)
})

test('revalidates native identity, exact project, and metadata revision without resume', async () => {
  const projectRoot = resolve('project-a')
  const thread = storedThread()
  const discoveryPage = await new CodexSessionDiscovery({
    canonicalizePath,
    clientFactory: clientFactory({ threads: [thread] }),
  }).discover({ projectRoot, limit: 1 })
  const candidate = discoveryPage.candidates[0]

  const tracker = { methods: [], shutdownCount: 0 }
  const discovery = new CodexSessionDiscovery({
    canonicalizePath,
    clientFactory: clientFactory({
      tracker,
      reads: new Map([[thread.id, thread]]),
    }),
  })
  assert.deepEqual(
    await discovery.validateCandidate({
      projectRoot,
      nativeSessionId: candidate.nativeSessionId,
      revision: candidate.revision,
    }),
    candidate,
  )
  assert.equal(tracker.shutdownCount, 1)
  assert.deepEqual(tracker.methods, [
    {
      method: 'thread/read',
      options: { threadId: candidate.nativeSessionId },
    },
  ])

  assert.equal(
    await discovery.validateCandidate({
      projectRoot,
      nativeSessionId: candidate.nativeSessionId,
      revision: 'stale-revision',
    }),
    undefined,
  )
  assert.equal(
    await new CodexSessionDiscovery({
      canonicalizePath,
      clientFactory: clientFactory({
        reads: new Map([[thread.id, { ...thread, cwd: resolve('project-b') }]]),
      }),
    }).validateCandidate({
      projectRoot,
      nativeSessionId: candidate.nativeSessionId,
      revision: candidate.revision,
    }),
    undefined,
  )
})

test('revalidates current Codex list/read metadata without treating their updatedAt projections as a session change', async () => {
  const projectRoot = resolve('project-a')
  const listed = storedThread({
    updatedAt: 1_700_000_100,
    recencyAt: 1_700_000_050,
  })
  const discoveryPage = await new CodexSessionDiscovery({
    canonicalizePath,
    clientFactory: clientFactory({ threads: [listed] }),
  }).discover({ projectRoot, limit: 1 })
  const candidate = discoveryPage.candidates[0]

  assert.deepEqual(
    await new CodexSessionDiscovery({
      canonicalizePath,
      clientFactory: clientFactory({
        reads: new Map([
          [listed.id, { ...listed, updatedAt: listed.updatedAt + 25 }],
        ]),
      }),
    }).validateCandidate({
      projectRoot,
      nativeSessionId: candidate.nativeSessionId,
      revision: candidate.revision,
    }),
    candidate,
  )

  assert.equal(
    await new CodexSessionDiscovery({
      canonicalizePath,
      clientFactory: clientFactory({
        reads: new Map([
          [listed.id, { ...listed, recencyAt: listed.recencyAt + 1 }],
        ]),
      }),
    }).validateCandidate({
      projectRoot,
      nativeSessionId: candidate.nativeSessionId,
      revision: candidate.revision,
    }),
    undefined,
  )
})

test('uses Machine-local canonical paths for provider filtering and alias matching', async () => {
  const aliasRoot = resolve('project-a-alias')
  const canonicalRoot = resolve('project-a-canonical')
  const tracker = { methods: [], shutdownCount: 0 }
  const discovery = new CodexSessionDiscovery({
    canonicalizePath: async (path) =>
      path === aliasRoot ? canonicalRoot : resolve(path),
    clientFactory: clientFactory({
      tracker,
      threads: [storedThread({ cwd: aliasRoot })],
    }),
  })

  const page = await discovery.discover({ projectRoot: aliasRoot, limit: 10 })
  assert.equal(page.candidates.length, 1)
  assert.equal(page.candidates[0].workingDirectory, canonicalRoot)
  assert.equal(tracker.methods[0].options.cwd, canonicalRoot)
})

test('maps bounded metadata failures without leaking parser details', async () => {
  const projectRoot = resolve('project-a')
  const unavailable = new CodexSessionDiscovery({
    canonicalizePath,
    clientFactory: clientFactory({
      list: async () => {
        throw new Error('private provider failure')
      },
    }),
  })
  const page = await unavailable.discover({ projectRoot, limit: 10 })
  assert.equal(page.status, 'unavailable')
  assert.equal(page.failureReason, 'provider_session_discovery_unavailable')
  assert.deepEqual(page.candidates, [])

  await assert.rejects(
    unavailable.discover({ projectRoot, limit: 101 }),
    /between 1 and 100/,
  )
  await assert.rejects(
    unavailable.discover({
      projectRoot,
      cursor: 'x'.repeat(513),
      limit: 10,
    }),
    /cursor is invalid/,
  )
})

test('an entirely unknown metadata page fails safely instead of claiming zero sessions', async () => {
  const projectRoot = resolve('project-a')
  const page = await new CodexSessionDiscovery({
    canonicalizePath,
    clientFactory: clientFactory({
      list: async () => ({
        threads: [],
        invalidEntryCount: 3,
        nextCursor: 'untrusted-next-page',
      }),
    }),
  }).discover({ projectRoot, limit: 10 })

  assert.equal(page.status, 'unavailable')
  assert.equal(page.failureReason, 'provider_session_format_unsupported')
  assert.equal(page.metrics.corruptEntriesSkipped, 3)
  assert.equal(page.metrics.truncated, true)
})

test('paginates 1,000 metadata-only sessions with bounded cursors and no private content', async () => {
  const projectRoot = resolve('project-large')
  const privateMarker = 'PRIVATE_LARGE_TRANSCRIPT_MUST_NOT_ESCAPE'
  const threads = Array.from({ length: 1_000 }, (_, index) =>
    storedThread({
      id: `thread-${String(index).padStart(4, '0')}`,
      cwd: projectRoot,
      name:
        index === 0
          ? `${'🙂'.repeat(300)} ${privateMarker}`
          : `Stored session ${String(index)}`,
      updatedAt: 1_700_000_100 + index,
      recencyAt: 1_700_000_100 + index,
      transcript: index === 0 ? privateMarker.repeat(10_000) : undefined,
      turns: index === 0 ? [{ content: privateMarker.repeat(10_000) }] : [],
    }),
  )
  const before = JSON.stringify(threads)
  const tracker = { methods: [], shutdownCount: 0 }
  const discovery = new CodexSessionDiscovery({
    canonicalizePath,
    clientFactory: clientFactory({
      tracker,
      list: async ({ cursor, limit }) => {
        const offset = cursor === undefined ? 0 : Number(cursor.slice(7))
        const page = threads.slice(offset, offset + limit)
        const nextOffset = offset + page.length
        return {
          threads: page,
          invalidEntryCount: 0,
          ...(nextOffset >= threads.length
            ? {}
            : { nextCursor: `offset-${String(nextOffset)}` }),
        }
      },
    }),
  })

  const candidates = []
  let cursor
  do {
    const page = await discovery.discover({
      projectRoot,
      limit: 100,
      ...(cursor === undefined ? {} : { cursor }),
    })
    candidates.push(...page.candidates)
    cursor = page.nextCursor
    if (cursor !== undefined) assert.ok(cursor.length <= 512)
  } while (cursor !== undefined)

  assert.equal(candidates.length, 1_000)
  assert.equal(
    new Set(candidates.map((candidate) => candidate.nativeSessionId)).size,
    1_000,
  )
  assert.equal([...candidates[0].title].length, 120)
  assert.equal(JSON.stringify(candidates).includes(privateMarker), false)
  assert.equal(JSON.stringify(threads), before)
  assert.equal(tracker.shutdownCount, 10)
  assert.equal(
    tracker.methods.every(({ method }) => method === 'thread/list'),
    true,
  )
})

test('cancellation shuts down the purpose-scoped metadata client', async () => {
  const projectRoot = resolve('project-a')
  const tracker = { methods: [], shutdownCount: 0 }
  const controller = new AbortController()
  let markListStarted
  const listStarted = new Promise((resolvePromise) => {
    markListStarted = resolvePromise
  })
  const discovery = new CodexSessionDiscovery({
    canonicalizePath,
    clientFactory: clientFactory({
      tracker,
      list: async () => {
        markListStarted()
        return await new Promise(() => {
          // The abort race owns cancellation; the fake operation never resolves.
        })
      },
    }),
  })

  const pending = discovery.discover({
    projectRoot,
    limit: 10,
    signal: controller.signal,
  })
  await listStarted
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(tracker.shutdownCount, 1)
})

test('cancellation during metadata-client initialization awaits exact late cleanup', async () => {
  const projectRoot = resolve('project-a')
  const controller = new AbortController()
  let resolveClient
  let markFactoryStarted
  const factoryStarted = new Promise((resolvePromise) => {
    markFactoryStarted = resolvePromise
  })
  let shutdownCount = 0
  let listCount = 0
  const discovery = new CodexSessionDiscovery({
    canonicalizePath,
    clientFactory: () => {
      markFactoryStarted()
      return new Promise((resolvePromise) => {
        resolveClient = resolvePromise
      })
    },
  })

  const pending = discovery.discover({
    projectRoot,
    limit: 10,
    signal: controller.signal,
  })
  await factoryStarted
  controller.abort()
  resolveClient({
    async listStoredThreads() {
      listCount += 1
      return { threads: [], invalidEntryCount: 0 }
    },
    async readStoredThread() {
      throw new Error('must not read')
    },
    async shutdown() {
      shutdownCount += 1
    },
  })
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(listCount, 0)
  assert.equal(shutdownCount, 1)
})

test('discovery cleanup uncertainty is typed, latched, and blocks later validation', async () => {
  const projectRoot = resolve('project-a')
  const privateCleanupFailure = new Error('test-owned metadata cleanup failure')
  let factoryCalls = 0
  const discovery = new CodexSessionDiscovery({
    canonicalizePath,
    clientFactory: async () => {
      factoryCalls += 1
      return {
        async listStoredThreads() {
          return { threads: [], invalidEntryCount: 0 }
        },
        async readStoredThread() {
          return storedThread()
        },
        async shutdown() {
          throw privateCleanupFailure
        },
      }
    },
  })

  let cleanupBarrier
  await assert.rejects(
    discovery.discover({ projectRoot, limit: 10 }),
    (error) => {
      cleanupBarrier = error
      return (
        error instanceof CodexOwnedProcessCleanupError &&
        error.failureReason === 'execution_ownership_uncertain' &&
        error.cause === privateCleanupFailure
      )
    },
  )
  await assert.rejects(
    discovery.validateCandidate({
      projectRoot,
      nativeSessionId: 'thread-a',
      revision: 'valid_revision',
    }),
    (error) => error === cleanupBarrier,
  )
  assert.equal(factoryCalls, 1)
})

test('candidate-validation cleanup uncertainty blocks later discovery', async () => {
  const projectRoot = resolve('project-a')
  const cleanupBarrier = new CodexOwnedProcessCleanupError()
  let factoryCalls = 0
  const discovery = new CodexSessionDiscovery({
    canonicalizePath,
    clientFactory: async () => {
      factoryCalls += 1
      return {
        async listStoredThreads() {
          return { threads: [], invalidEntryCount: 0 }
        },
        async readStoredThread() {
          return storedThread()
        },
        async shutdown() {
          throw cleanupBarrier
        },
      }
    },
  })

  await assert.rejects(
    discovery.validateCandidate({
      projectRoot,
      nativeSessionId: 'thread-a',
      revision: 'valid_revision',
    }),
    (error) => error === cleanupBarrier,
  )
  await assert.rejects(
    discovery.discover({ projectRoot, limit: 10 }),
    (error) => error === cleanupBarrier,
  )
  assert.equal(factoryCalls, 1)
})

test('cancellation cannot mask a late metadata-client ownership failure', async () => {
  const projectRoot = resolve('project-a')
  const controller = new AbortController()
  const cleanupBarrier = new CodexOwnedProcessCleanupError()
  let rejectClient
  let markFactoryStarted
  const factoryStarted = new Promise((resolvePromise) => {
    markFactoryStarted = resolvePromise
  })
  const discovery = new CodexSessionDiscovery({
    canonicalizePath,
    clientFactory: () => {
      markFactoryStarted()
      return new Promise((_, rejectPromise) => {
        rejectClient = rejectPromise
      })
    },
  })

  const pending = discovery.discover({
    projectRoot,
    limit: 10,
    signal: controller.signal,
  })
  await factoryStarted
  controller.abort()
  rejectClient(cleanupBarrier)
  await assert.rejects(pending, (error) => error === cleanupBarrier)
  await assert.rejects(
    discovery.discover({ projectRoot, limit: 10 }),
    (error) => error === cleanupBarrier,
  )
})

test('candidate revalidation rejects unbounded or malformed private identity before launch', async () => {
  const projectRoot = resolve('project-a')
  let factoryCalls = 0
  const discovery = new CodexSessionDiscovery({
    canonicalizePath,
    clientFactory: async () => {
      factoryCalls += 1
      throw new Error('must not launch')
    },
  })

  await assert.rejects(
    discovery.validateCandidate({
      projectRoot,
      nativeSessionId: 'x'.repeat(513),
      revision: 'valid_revision',
    }),
    /identity and revision are required/,
  )
  await assert.rejects(
    discovery.validateCandidate({
      projectRoot,
      nativeSessionId: 'thread-a',
      revision: 'invalid:revision',
    }),
    /identity and revision are required/,
  )
  assert.equal(factoryCalls, 0)
})

test('projects current retained-turn history before the captured adoption boundary with pagination', async () => {
  const projectRoot = resolve('project-a')
  const thread = storedThread({ id: 'thread-turn-history', cwd: projectRoot })
  const turns = Array.from({ length: 3 }, (_, index) => ({
    id: `turn-${index + 1}`,
    items: [
      {
        turnId: `turn-${index + 1}`,
        id: `item-${index + 1}-user`,
        type: 'userMessage',
        text: index === 1 ? 'same' : `prompt-${index + 1}`,
      },
      {
        turnId: `turn-${index + 1}`,
        id: `item-${index + 1}-assistant`,
        type: 'agentMessage',
        text: index === 1 ? 'same' : `answer-${index + 1}`,
      },
    ],
    invalidEntryCount: 0,
    recordsScanned: 2,
  }))
  const tracker = { methods: [], shutdownCount: 0 }
  const discovery = new CodexSessionDiscovery({
    canonicalizePath,
    clientFactory: clientFactory({
      tracker,
      reads: new Map([[thread.id, thread]]),
      listTurns: async ({ cursor, limit, sortDirection }) => {
        assert.equal(sortDirection, 'desc')
        if (limit === 1 && cursor === undefined) {
          return {
            turns: [turns[2]],
            invalidEntryCount: 0,
            recordsScanned: 3,
            backwardsCursor: 'boundary-turn-3',
          }
        }
        if (cursor === 'boundary-turn-3') {
          assert.equal(limit, 2)
          return {
            turns: [turns[2], turns[1]],
            invalidEntryCount: 0,
            recordsScanned: 6,
            nextCursor: 'older-than-turn-2',
          }
        }
        if (cursor === 'older-than-turn-2') {
          assert.equal(limit, 2)
          return {
            turns: [turns[0]],
            invalidEntryCount: 0,
            recordsScanned: 3,
          }
        }
        throw new Error('unexpected retained-turn cursor')
      },
    }),
  })
  const discovered = await new CodexSessionDiscovery({
    canonicalizePath,
    clientFactory: clientFactory({ threads: [thread] }),
  }).discover({ projectRoot, limit: 1 })
  const adopted = await discovery.validateCandidate({
    projectRoot,
    nativeSessionId: thread.id,
    revision: discovered.candidates[0].revision,
  })
  assert.match(adopted.transcriptBoundary, /^codex-v2:/u)

  const recent = await discovery.readSessionTranscript({
    projectRoot,
    nativeSessionId: thread.id,
    boundary: adopted.transcriptBoundary,
    adoptedAt: '2026-09-05T12:00:00.000Z',
    limit: 4,
  })
  assert.equal(recent.status, 'available')
  assert.deepEqual(
    recent.entries.map(({ id, role, content }) => [id, role, content]),
    [
      ['item-2-user', 'user', 'same'],
      ['item-2-assistant', 'assistant', 'same'],
      ['item-3-user', 'user', 'prompt-3'],
      ['item-3-assistant', 'assistant', 'answer-3'],
    ],
  )
  assert.match(recent.nextCursor, /^codex-turn-v1:/u)

  const older = await discovery.readSessionTranscript({
    projectRoot,
    nativeSessionId: thread.id,
    boundary: adopted.transcriptBoundary,
    adoptedAt: '2026-09-05T12:00:00.000Z',
    cursor: recent.nextCursor,
    limit: 4,
  })
  assert.equal(older.status, 'available')
  assert.deepEqual(
    older.entries.map(({ id, role }) => [id, role]),
    [
      ['item-1-user', 'user'],
      ['item-1-assistant', 'assistant'],
    ],
  )
  assert.equal(older.complete, true)
  assert.equal(
    new Set([...older.entries, ...recent.entries].map(({ id }) => id)).size,
    6,
  )
  assert.equal(tracker.shutdownCount, 3)
  assert.equal(
    tracker.methods.some(({ method }) =>
      ['thread/start', 'thread/resume', 'turn/start'].includes(method),
    ),
    false,
  )
})

test('rejects a changed retained-turn adoption anchor without exposing post-adoption items', async () => {
  const projectRoot = resolve('project-a')
  const thread = storedThread({ id: 'thread-anchor-change', cwd: projectRoot })
  const originalTurn = {
    id: 'turn-anchor',
    items: [
      {
        turnId: 'turn-anchor',
        id: 'item-anchor',
        type: 'agentMessage',
        text: 'visible',
      },
    ],
    invalidEntryCount: 0,
    recordsScanned: 1,
  }
  let calls = 0
  const discovery = new CodexSessionDiscovery({
    canonicalizePath,
    clientFactory: clientFactory({
      reads: new Map([[thread.id, thread]]),
      listTurns: async ({ cursor }) => {
        calls += 1
        return calls === 1
          ? {
              turns: [originalTurn],
              invalidEntryCount: 0,
              recordsScanned: 2,
              backwardsCursor: 'anchor-cursor',
            }
          : {
              turns: [
                {
                  ...originalTurn,
                  items: [{ ...originalTurn.items[0], id: 'changed-item' }],
                },
              ],
              invalidEntryCount: 0,
              recordsScanned: 2,
              ...(cursor === undefined ? {} : {}),
            }
      },
    }),
  })
  const candidate = (
    await new CodexSessionDiscovery({
      canonicalizePath,
      clientFactory: clientFactory({ threads: [thread] }),
    }).discover({ projectRoot, limit: 1 })
  ).candidates[0]
  const adopted = await discovery.validateCandidate({
    projectRoot,
    nativeSessionId: thread.id,
    revision: candidate.revision,
  })
  const page = await discovery.readSessionTranscript({
    projectRoot,
    nativeSessionId: thread.id,
    boundary: adopted.transcriptBoundary,
    adoptedAt: '2026-09-05T12:00:00.000Z',
    limit: 2,
  })
  assert.equal(page.status, 'malformed')
  assert.deepEqual(page.entries, [])
})

test('paginates within one retained Turn without dropping visible messages', async () => {
  const projectRoot = resolve('project-a')
  const thread = storedThread({ id: 'thread-one-large-turn', cwd: projectRoot })
  const turn = {
    id: 'turn-large',
    items: Array.from({ length: 3 }, (_, index) => ({
      turnId: 'turn-large',
      id: `item-large-${index + 1}`,
      type: index === 0 ? 'userMessage' : 'agentMessage',
      text: `visible-${index + 1}`,
    })),
    invalidEntryCount: 0,
    recordsScanned: 3,
  }
  const discovery = new CodexSessionDiscovery({
    canonicalizePath,
    clientFactory: clientFactory({
      reads: new Map([[thread.id, thread]]),
      listTurns: async () => ({
        turns: [turn],
        invalidEntryCount: 0,
        recordsScanned: 4,
        backwardsCursor: 'large-turn-anchor',
      }),
    }),
  })
  const candidate = (
    await new CodexSessionDiscovery({
      canonicalizePath,
      clientFactory: clientFactory({ threads: [thread] }),
    }).discover({ projectRoot, limit: 1 })
  ).candidates[0]
  const adopted = await discovery.validateCandidate({
    projectRoot,
    nativeSessionId: thread.id,
    revision: candidate.revision,
  })

  const recent = await discovery.readSessionTranscript({
    projectRoot,
    nativeSessionId: thread.id,
    boundary: adopted.transcriptBoundary,
    adoptedAt: '2026-09-05T12:00:00.000Z',
    limit: 2,
  })
  assert.deepEqual(
    recent.entries.map(({ id }) => id),
    ['item-large-2', 'item-large-3'],
  )
  assert.match(recent.nextCursor, /^codex-turn-v1:/u)

  const older = await discovery.readSessionTranscript({
    projectRoot,
    nativeSessionId: thread.id,
    boundary: adopted.transcriptBoundary,
    adoptedAt: '2026-09-05T12:00:00.000Z',
    cursor: recent.nextCursor,
    limit: 2,
  })
  assert.deepEqual(
    older.entries.map(({ id }) => id),
    ['item-large-1'],
  )
  assert.equal(older.complete, true)
})

test('falls back to the older item-history method only when retained-turn listing is unavailable', async () => {
  const projectRoot = resolve('project-a')
  const thread = storedThread({ id: 'thread-items-fallback', cwd: projectRoot })
  const tracker = { methods: [], shutdownCount: 0 }
  const discovery = new CodexSessionDiscovery({
    canonicalizePath,
    clientFactory: clientFactory({
      tracker,
      reads: new Map([[thread.id, thread]]),
      listTurns: async () => {
        throw new JsonRpcRemoteError(
          'thread/turns/list',
          -32601,
          'method unavailable',
        )
      },
      listItems: async () => ({
        items: [
          {
            turnId: 'turn-fallback',
            id: 'item-fallback',
            type: 'agentMessage',
            text: 'visible',
          },
        ],
        invalidEntryCount: 0,
        backwardsCursor: 'fallback-boundary',
      }),
    }),
  })
  const candidate = (
    await new CodexSessionDiscovery({
      canonicalizePath,
      clientFactory: clientFactory({ threads: [thread] }),
    }).discover({ projectRoot, limit: 1 })
  ).candidates[0]
  const adopted = await discovery.validateCandidate({
    projectRoot,
    nativeSessionId: thread.id,
    revision: candidate.revision,
  })
  assert.match(adopted.transcriptBoundary, /^codex-v1:/u)
  assert.deepEqual(
    tracker.methods.map(({ method }) => method),
    ['thread/read', 'thread/turns/list', 'thread/items/list'],
  )
})

test('bounds current retained-turn history with many visible items in one page', async () => {
  const projectRoot = resolve('project-a')
  const thread = storedThread({
    id: 'thread-turn-history-huge',
    cwd: projectRoot,
  })
  const turns = Array.from({ length: 50 }, (_, turnIndex) => ({
    id: `turn-${turnIndex}`,
    items: Array.from({ length: 3 }, (_, itemIndex) => ({
      turnId: `turn-${turnIndex}`,
      id: `item-${turnIndex}-${itemIndex}`,
      type: itemIndex === 0 ? 'userMessage' : 'agentMessage',
      text: '🙂'.repeat(40_000),
    })),
    invalidEntryCount: 0,
    recordsScanned: 3,
  }))
  let calls = 0
  const discovery = new CodexSessionDiscovery({
    canonicalizePath,
    clientFactory: clientFactory({
      reads: new Map([[thread.id, thread]]),
      listTurns: async ({ limit }) => {
        calls += 1
        return calls === 1
          ? {
              turns: [turns[0]],
              invalidEntryCount: 0,
              recordsScanned: 4,
              backwardsCursor: 'huge-turn-boundary',
            }
          : {
              turns: turns.slice(0, limit),
              invalidEntryCount: 0,
              recordsScanned: limit * 4,
              backwardsCursor: 'huge-turn-boundary',
            }
      },
    }),
  })
  const candidate = (
    await new CodexSessionDiscovery({
      canonicalizePath,
      clientFactory: clientFactory({ threads: [thread] }),
    }).discover({ projectRoot, limit: 1 })
  ).candidates[0]
  const adopted = await discovery.validateCandidate({
    projectRoot,
    nativeSessionId: thread.id,
    revision: candidate.revision,
  })
  const page = await discovery.readSessionTranscript({
    projectRoot,
    nativeSessionId: thread.id,
    boundary: adopted.transcriptBoundary,
    adoptedAt: '2026-09-05T12:00:00.000Z',
    limit: 100,
  })
  assert.equal(page.status, 'partial')
  assert.equal(page.entries.length, 100)
  assert.ok(page.metrics.bytesRead <= 512 * 1024)
  assert.equal(page.metrics.recordsScanned, 200)
})

test('projects bounded older item-history compatibility before the captured adoption boundary', async () => {
  const projectRoot = resolve('project-a')
  const thread = storedThread({ id: 'thread-history', cwd: projectRoot })
  const pages = new Map([
    [
      'boundary',
      {
        items: [
          {
            turnId: 'turn-2',
            id: 'item-4',
            type: 'agentMessage',
            text: 'same',
          },
        ],
        invalidEntryCount: 0,
        backwardsCursor: 'history-first',
      },
    ],
    [
      'history-first',
      {
        items: [
          {
            turnId: 'turn-2',
            id: 'item-4',
            type: 'agentMessage',
            text: 'same',
          },
          { turnId: 'turn-2', id: 'item-3', type: 'userMessage', text: 'same' },
        ],
        invalidEntryCount: 0,
        nextCursor: 'history-older',
      },
    ],
    [
      'history-older',
      {
        items: [
          {
            turnId: 'turn-1',
            id: 'item-2',
            type: 'agentMessage',
            text: 'answer',
          },
          {
            turnId: 'turn-1',
            id: 'item-1',
            type: 'userMessage',
            text: 'prompt',
          },
        ],
        invalidEntryCount: 1,
      },
    ],
  ])
  const tracker = { methods: [], shutdownCount: 0 }
  const discovery = new CodexSessionDiscovery({
    canonicalizePath,
    clientFactory: clientFactory({
      tracker,
      reads: new Map([[thread.id, thread]]),
      listItems: async ({ cursor, limit }) => {
        const key = limit === 1 && cursor === undefined ? 'boundary' : cursor
        const page = pages.get(key)
        if (page === undefined) throw new Error('unexpected transcript cursor')
        return page
      },
    }),
  })
  const discovered = await new CodexSessionDiscovery({
    canonicalizePath,
    clientFactory: clientFactory({ threads: [thread] }),
  }).discover({ projectRoot, limit: 1 })
  const adopted = await discovery.validateCandidate({
    projectRoot,
    nativeSessionId: thread.id,
    revision: discovered.candidates[0].revision,
  })
  assert.match(adopted.transcriptBoundary, /^codex-v1:/u)

  const recent = await discovery.readSessionTranscript({
    projectRoot,
    nativeSessionId: thread.id,
    boundary: adopted.transcriptBoundary,
    adoptedAt: '2026-09-05T12:00:00.000Z',
    limit: 2,
  })
  assert.equal(recent.status, 'available')
  assert.deepEqual(
    recent.entries.map(({ id, role, content }) => [id, role, content]),
    [
      ['item-3', 'user', 'same'],
      ['item-4', 'assistant', 'same'],
    ],
  )
  assert.equal(new Set(recent.entries.map((entry) => entry.id)).size, 2)
  assert.equal(recent.nextCursor, 'history-older')

  const older = await discovery.readSessionTranscript({
    projectRoot,
    nativeSessionId: thread.id,
    boundary: adopted.transcriptBoundary,
    adoptedAt: '2026-09-05T12:00:00.000Z',
    cursor: recent.nextCursor,
    limit: 2,
  })
  assert.equal(older.status, 'partial')
  assert.deepEqual(
    older.entries.map((entry) => entry.id),
    ['item-1', 'item-2'],
  )
  assert.equal(older.complete, true)
  assert.equal(tracker.shutdownCount, 3)
  assert.equal(
    tracker.methods.some(({ method }) =>
      ['thread/start', 'thread/resume', 'turn/start'].includes(method),
    ),
    false,
  )
})

test('Codex transcript byte bounds retain every requested identity', async () => {
  const projectRoot = resolve('project-a')
  const thread = storedThread({ id: 'thread-huge', cwd: projectRoot })
  const hugeItems = Array.from({ length: 100 }, (_, index) => ({
    turnId: `turn-${index}`,
    id: `item-${index}`,
    type: index % 2 === 0 ? 'userMessage' : 'agentMessage',
    text: '🙂'.repeat(40_000),
  }))
  const boundary = Buffer.from(
    JSON.stringify({
      version: 1,
      empty: false,
      cursor: 'history-huge',
      anchorItemId: 'item-0',
    }),
  ).toString('base64url')
  const discovery = new CodexSessionDiscovery({
    canonicalizePath,
    clientFactory: clientFactory({
      reads: new Map([[thread.id, thread]]),
      listItems: async () => ({ items: hugeItems, invalidEntryCount: 0 }),
    }),
  })
  const page = await discovery.readSessionTranscript({
    projectRoot,
    nativeSessionId: thread.id,
    boundary: `codex-v1:${boundary}`,
    adoptedAt: '2026-09-05T12:00:00.000Z',
    limit: 100,
  })
  assert.equal(page.status, 'partial')
  assert.equal(page.entries.length, 100)
  assert.equal(new Set(page.entries.map((entry) => entry.id)).size, 100)
  assert.ok(
    page.entries.reduce(
      (total, entry) => total + Buffer.byteLength(entry.content, 'utf8'),
      0,
    ) <=
      512 * 1024,
  )
})

test('paginates 250 Codex transcript items with bounded stable ordering', async () => {
  const projectRoot = resolve('project-a')
  const thread = storedThread({ id: 'thread-long-history', cwd: projectRoot })
  const items = Array.from({ length: 250 }, (_, index) => ({
    turnId: `turn-long-${Math.floor(index / 2)}`,
    id: `item-long-${String(index).padStart(3, '0')}`,
    type: index % 2 === 0 ? 'userMessage' : 'agentMessage',
    text: `visible-${String(index).padStart(3, '0')}`,
  }))
  const boundary = Buffer.from(
    JSON.stringify({
      version: 1,
      empty: false,
      cursor: 'cursor-long-250',
      anchorItemId: items.at(-1).id,
    }),
  ).toString('base64url')
  const tracker = { methods: [], shutdownCount: 0 }
  const discovery = new CodexSessionDiscovery({
    canonicalizePath,
    clientFactory: clientFactory({
      tracker,
      reads: new Map([[thread.id, thread]]),
      listItems: async ({ cursor, limit }) => {
        const before = Number(cursor?.slice('cursor-long-'.length))
        assert.ok(Number.isSafeInteger(before))
        const start = Math.max(0, before - limit)
        return {
          items: items.slice(start, before).reverse(),
          invalidEntryCount: 0,
          ...(start === 0 ? {} : { nextCursor: `cursor-long-${start}` }),
        }
      },
    }),
  })

  const pages = []
  let cursor
  do {
    const page = await discovery.readSessionTranscript({
      projectRoot,
      nativeSessionId: thread.id,
      boundary: `codex-v1:${boundary}`,
      adoptedAt: '2026-09-05T12:00:00.000Z',
      ...(cursor === undefined ? {} : { cursor }),
      limit: 50,
    })
    assert.ok(page.entries.length <= 50)
    assert.equal(page.status, 'available')
    pages.push(page)
    cursor = page.nextCursor
  } while (cursor !== undefined)

  const chronological = [...pages].reverse().flatMap((page) => page.entries)
  assert.equal(pages.length, 5)
  assert.equal(chronological.length, 250)
  assert.deepEqual(
    chronological.map(({ id }) => id),
    items.map(({ id }) => id),
  )
  assert.equal(new Set(chronological.map(({ id }) => id)).size, 250)
  assert.equal(tracker.shutdownCount, 5)
  assert.equal(
    tracker.methods.some(({ method }) =>
      ['thread/start', 'thread/resume', 'turn/start'].includes(method),
    ),
    false,
  )
})

test('legacy Codex adoption fails closed without parsing or replaying history', async () => {
  let clientCalls = 0
  const page = await new CodexSessionDiscovery({
    canonicalizePath,
    clientFactory: async () => {
      clientCalls += 1
      throw new Error('must not launch for an unbounded legacy split')
    },
  }).readSessionTranscript({
    projectRoot: resolve('project-a'),
    nativeSessionId: 'thread-legacy',
    adoptedAt: '2026-09-05T12:00:00.000Z',
    limit: 50,
  })
  assert.equal(page.status, 'partial')
  assert.deepEqual(page.entries, [])
  assert.equal(clientCalls, 0)
})
