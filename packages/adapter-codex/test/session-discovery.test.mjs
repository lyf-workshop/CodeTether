import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import test from 'node:test'

import { CodexSessionDiscovery } from '../dist/index.js'

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

function clientFactory({ threads = [], reads = new Map(), list, tracker }) {
  return async () => ({
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
  })
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
