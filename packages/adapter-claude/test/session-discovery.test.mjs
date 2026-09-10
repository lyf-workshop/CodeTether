import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import test from 'node:test'

import { ClaudeSessionDiscovery } from '../dist/index.js'

const TEST_PROVIDER_VERSION = '2.1.266'

function sessionId(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
}

async function createFixture(t, name = 'basic') {
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), `codetether-claude-${name}-`),
  )
  const root = await realpath(temporaryRoot)
  t.after(async () => {
    await rm(root, { recursive: true, force: true })
  })
  const configurationDirectory = join(root, 'claude-state')
  const projectsDirectory = join(configurationDirectory, 'projects')
  const projectRoot = join(root, 'project')
  const otherProjectRoot = join(root, 'other-project')
  await Promise.all([
    mkdir(projectsDirectory, { recursive: true }),
    mkdir(join(projectRoot, 'nested'), { recursive: true }),
    mkdir(otherProjectRoot, { recursive: true }),
  ])
  return {
    root,
    configurationDirectory,
    projectsDirectory,
    projectRoot,
    otherProjectRoot,
  }
}

async function writeSession(options) {
  const bucket = join(options.projectsDirectory, options.bucket ?? 'project')
  await mkdir(bucket, { recursive: true })
  const timestamp = options.timestamp ?? '2026-01-01T00:00:00.000Z'
  const version = options.version ?? TEST_PROVIDER_VERSION
  const records = [
    {
      type: 'user',
      uuid: options.userUuid ?? '11111111-1111-4111-8111-111111111111',
      sessionId: options.id,
      cwd: options.cwd,
      timestamp,
      version,
      message: {
        role: 'user',
        content: options.privateContent ?? 'private fixture content',
      },
      ignoredFutureField: { nested: true },
    },
    {
      type: 'assistant',
      uuid: options.assistantUuid ?? '22222222-2222-4222-8222-222222222222',
      sessionId: options.id,
      cwd: options.cwd,
      timestamp: new Date(Date.parse(timestamp) + 1_000).toISOString(),
      version,
      message: {
        role: 'assistant',
        content: options.privateContent ?? 'private fixture response',
      },
    },
    ...(options.title === undefined
      ? []
      : [
          {
            type: 'ai-title',
            sessionId: options.id,
            cwd: options.cwd,
            timestamp: new Date(Date.parse(timestamp) + 2_000).toISOString(),
            version,
            aiTitle: options.title,
          },
        ]),
  ]
  const path = join(bucket, `${options.id}.jsonl`)
  await writeFile(
    path,
    `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
    { mode: 0o600 },
  )
  return path
}

function discoveryFor(fixture, overrides = {}) {
  return new ClaudeSessionDiscovery({
    environment: { CLAUDE_CONFIG_DIR: fixture.configurationDirectory },
    providerVersion: TEST_PROVIDER_VERSION,
    ...overrides,
  })
}

test('production default discovers safely without a constructor CLI version while explicit unsupported versions fail closed', async (t) => {
  const fixture = await createFixture(t, 'production-default-version')
  await writeSession({
    projectsDirectory: fixture.projectsDirectory,
    id: sessionId(99),
    cwd: fixture.projectRoot,
    title: 'Production construction',
  })

  const production = new ClaudeSessionDiscovery({
    environment: { CLAUDE_CONFIG_DIR: fixture.configurationDirectory },
  })
  const discovered = await production.discover({
    projectRoot: fixture.projectRoot,
    limit: 10,
  })
  assert.equal(discovered.status, 'supported')
  assert.equal(Object.hasOwn(discovered, 'providerVersion'), false)
  assert.equal(discovered.candidates.length, 1)
  assert.equal(discovered.candidates[0].providerVersion, TEST_PROVIDER_VERSION)
  assert.equal(discovered.candidates[0].resumeStatus, 'supported')
  const validated = await production.validateCandidate({
    projectRoot: fixture.projectRoot,
    nativeSessionId: discovered.candidates[0].nativeSessionId,
    revision: discovered.candidates[0].revision,
  })
  assert.equal(
    validated?.nativeSessionId,
    discovered.candidates[0].nativeSessionId,
  )
  assert.equal(validated?.resumeStatus, 'supported')

  const unsupported = new ClaudeSessionDiscovery({
    environment: { CLAUDE_CONFIG_DIR: fixture.configurationDirectory },
    providerVersion: '9.0.0',
  })
  const rejected = await unsupported.discover({
    projectRoot: fixture.projectRoot,
    limit: 10,
  })
  assert.equal(rejected.status, 'unsupported')
  assert.equal(rejected.failureReason, 'provider_session_format_unsupported')
  assert.equal(rejected.metrics.filesInspected, 0)
  assert.equal(
    await unsupported.validateCandidate({
      projectRoot: fixture.projectRoot,
      nativeSessionId: discovered.candidates[0].nativeSessionId,
      revision: discovered.candidates[0].revision,
    }),
    undefined,
  )
})

async function snapshotJsonl(root) {
  const result = []
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(path)
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        const [source, info] = await Promise.all([readFile(path), stat(path)])
        result.push({
          path: relative(root, path),
          bytes: info.size,
          modifiedAt: info.mtimeMs,
          digest: createHash('sha256').update(source).digest('hex'),
        })
      }
    }
  }
  await visit(root)
  return result
}

test('discovers exact canonical project sessions without retaining content', async (t) => {
  const fixture = await createFixture(t)
  const targetId = sessionId(1)
  const noTitleId = sessionId(2)
  const privateMarker = 'PRIVATE_TRANSCRIPT_MARKER_MUST_NOT_ESCAPE'
  const alias = join(fixture.projectRoot, 'nested', '..')
  await Promise.all([
    writeSession({
      projectsDirectory: fixture.projectsDirectory,
      bucket: 'target-alias',
      id: targetId,
      cwd: alias,
      title: '  Existing   Claude session  ',
      privateContent: privateMarker,
    }),
    writeSession({
      projectsDirectory: fixture.projectsDirectory,
      bucket: 'target-fallback',
      id: noTitleId,
      cwd: fixture.projectRoot,
      timestamp: '2025-12-31T00:00:00.000Z',
      privateContent: privateMarker,
    }),
    writeSession({
      projectsDirectory: fixture.projectsDirectory,
      bucket: 'wrong-project',
      id: sessionId(3),
      cwd: fixture.otherProjectRoot,
      title: 'Wrong project',
    }),
  ])
  const corruptBucket = join(fixture.projectsDirectory, 'corrupt')
  await mkdir(corruptBucket)
  await writeFile(join(corruptBucket, `${sessionId(4)}.jsonl`), '{broken')

  const discovery = discoveryFor(fixture)
  const page = await discovery.discover({
    projectRoot: fixture.projectRoot,
    limit: 50,
  })

  assert.equal(page.status, 'supported')
  assert.equal(page.candidates.length, 2)
  assert.equal(page.metrics.filesInspected, 4)
  assert.equal(page.metrics.candidatesParsed, 3)
  assert.equal(page.metrics.candidatesMatched, 2)
  assert.equal(page.metrics.corruptEntriesSkipped, 1)
  assert.equal(page.nextCursor, undefined)
  assert.equal(page.candidates[0].title, 'Existing Claude session')
  assert.match(page.candidates[1].title, /^Claude conversation - /u)
  assert.equal(page.candidates[0].workingDirectory, fixture.projectRoot)
  assert.equal(page.candidates[0].historicalTranscript, 'supported')
  assert.equal(page.candidates[0].resumeStatus, 'supported')
  assert.equal(JSON.stringify(page).includes(privateMarker), false)
  assert.equal(
    page.candidates.some((candidate) => candidate.title === 'Wrong project'),
    false,
  )
})

test('deduplicates one native identity observed through canonical aliases', async (t) => {
  const fixture = await createFixture(t, 'aliases')
  const id = sessionId(10)
  await Promise.all([
    writeSession({
      projectsDirectory: fixture.projectsDirectory,
      bucket: 'alias-a',
      id,
      cwd: fixture.projectRoot,
      title: 'Alias A',
    }),
    writeSession({
      projectsDirectory: fixture.projectsDirectory,
      bucket: 'alias-b',
      id,
      cwd: join(fixture.projectRoot, 'nested', '..'),
      title: 'Alias B',
    }),
  ])

  const page = await discoveryFor(fixture).discover({
    projectRoot: fixture.projectRoot,
    limit: 50,
  })
  assert.equal(page.candidates.length, 1)
  assert.equal(page.metrics.candidatesMatched, 2)
})

test('uses a stable bounded snapshot cursor for a 1,000-session store', async (t) => {
  const fixture = await createFixture(t, 'large')
  const bucket = 'large-project'
  const base = Date.parse('2025-01-01T00:00:00.000Z')
  for (let offset = 0; offset < 1_000; offset += 50) {
    await Promise.all(
      Array.from({ length: 50 }, (_, index) => {
        const value = offset + index + 1
        return writeSession({
          projectsDirectory: fixture.projectsDirectory,
          bucket,
          id: sessionId(value),
          cwd: fixture.projectRoot,
          timestamp: new Date(base + value * 10_000).toISOString(),
          title: `Synthetic session ${String(value)}`,
        })
      }),
    )
  }

  const discovery = discoveryFor(fixture, {
    maximumSessionFiles: 1_100,
  })
  const seen = new Set()
  let cursor
  let firstMetrics
  let firstTitle
  let pageIndex = 0
  do {
    const page = await discovery.discover({
      projectRoot: fixture.projectRoot,
      limit: 100,
      ...(cursor === undefined ? {} : { cursor }),
    })
    firstMetrics ??= page.metrics
    firstTitle ??= page.candidates[0]?.title
    if (pageIndex === 0) {
      assert.equal(page.metrics, firstMetrics)
    } else {
      assert.deepEqual(page.metrics, {
        filesInspected: 0,
        candidatesParsed: 0,
        candidatesMatched: 0,
        corruptEntriesSkipped: 0,
        elapsedMs: 0,
        truncated: false,
      })
    }
    for (const candidate of page.candidates) {
      assert.equal(seen.has(candidate.nativeSessionId), false)
      seen.add(candidate.nativeSessionId)
    }
    cursor = page.nextCursor
    pageIndex += 1
  } while (cursor !== undefined)

  assert.equal(seen.size, 1_000)
  assert.equal(firstTitle, 'Synthetic session 1000')
  assert.equal(firstMetrics.filesInspected, 1_000)
  assert.equal(firstMetrics.candidatesMatched, 1_000)
  assert.equal(firstMetrics.truncated, false)
})

test('keeps discovery and validation byte-for-byte read-only', async (t) => {
  const fixture = await createFixture(t, 'readonly')
  const path = await writeSession({
    projectsDirectory: fixture.projectsDirectory,
    id: sessionId(20),
    cwd: fixture.projectRoot,
    title: 'Read only',
  })
  const before = await snapshotJsonl(fixture.projectsDirectory)
  const discovery = discoveryFor(fixture)
  const page = await discovery.discover({
    projectRoot: fixture.projectRoot,
    limit: 10,
  })
  assert.equal(page.candidates.length, 1)
  const candidate = page.candidates[0]
  const validated = await discovery.validateCandidate({
    projectRoot: fixture.projectRoot,
    nativeSessionId: candidate.nativeSessionId,
    revision: candidate.revision,
  })
  const { transcriptBoundary, ...validatedCandidate } = validated
  assert.match(transcriptBoundary, /^claude-v1:/u)
  assert.deepEqual(validatedCandidate, candidate)
  assert.deepEqual(await snapshotJsonl(fixture.projectsDirectory), before)

  await appendFile(
    path,
    `${JSON.stringify({
      type: 'mode',
      sessionId: candidate.nativeSessionId,
      cwd: fixture.projectRoot,
      timestamp: '2026-01-01T00:00:03.000Z',
      version: TEST_PROVIDER_VERSION,
    })}\n`,
  )
  assert.equal(
    await discovery.validateCandidate({
      projectRoot: fixture.projectRoot,
      nativeSessionId: candidate.nativeSessionId,
      revision: candidate.revision,
    }),
    undefined,
  )
  await rm(path)
  assert.equal(
    await discovery.validateCandidate({
      projectRoot: fixture.projectRoot,
      nativeSessionId: candidate.nativeSessionId,
      revision: candidate.revision,
    }),
    undefined,
  )
})

test('large content remains transient metadata-only input', async (t) => {
  const fixture = await createFixture(t, 'large-line')
  const privateMarker = `PRIVATE_${'x'.repeat(512 * 1024)}`
  await writeSession({
    projectsDirectory: fixture.projectsDirectory,
    id: sessionId(30),
    cwd: fixture.projectRoot,
    title: 'Bounded metadata',
    privateContent: privateMarker,
  })

  const page = await discoveryFor(fixture).discover({
    projectRoot: fixture.projectRoot,
    limit: 10,
  })
  assert.equal(page.candidates.length, 1)
  assert.equal(JSON.stringify(page).includes('PRIVATE_'), false)
  assert.equal(Object.hasOwn(page.candidates[0], 'message'), false)
})

test('unknown writer provenance is discoverable but not claimed resumable', async (t) => {
  const fixture = await createFixture(t, 'unknown-writer')
  await writeSession({
    projectsDirectory: fixture.projectsDirectory,
    id: sessionId(40),
    cwd: fixture.projectRoot,
    title: 'Future writer',
    version: '2.1.999',
  })
  const page = await discoveryFor(fixture).discover({
    projectRoot: fixture.projectRoot,
    limit: 10,
  })
  assert.equal(page.status, 'supported')
  assert.equal(page.candidates.length, 1)
  assert.equal(page.candidates[0].providerVersion, '2.1.999')
  assert.equal(page.candidates[0].resumeStatus, 'unavailable')

  const unsupported = discoveryFor(fixture, { providerVersion: '9.0.0' })
  const unavailable = await unsupported.discover({
    projectRoot: fixture.projectRoot,
    limit: 10,
  })
  assert.equal(unavailable.status, 'unsupported')
  assert.equal(unavailable.failureReason, 'provider_session_format_unsupported')
  assert.equal(unavailable.metrics.filesInspected, 0)
})

test('all-corrupt and unreadable stores fail safely while a missing store is empty', async (t) => {
  const fixture = await createFixture(t, 'failures')
  const bucket = join(fixture.projectsDirectory, 'only-corrupt')
  await mkdir(bucket)
  await writeFile(join(bucket, `${sessionId(50)}.jsonl`), 'not-json')
  const corrupt = await discoveryFor(fixture).discover({
    projectRoot: fixture.projectRoot,
    limit: 10,
  })
  assert.equal(corrupt.status, 'unavailable')
  assert.equal(corrupt.failureReason, 'provider_session_format_unsupported')
  assert.equal(corrupt.metrics.corruptEntriesSkipped, 1)

  const absentConfiguration = join(fixture.root, 'absent-state')
  const absent = new ClaudeSessionDiscovery({
    environment: { CLAUDE_CONFIG_DIR: absentConfiguration },
    providerVersion: TEST_PROVIDER_VERSION,
  })
  const empty = await absent.discover({
    projectRoot: fixture.projectRoot,
    limit: 10,
  })
  assert.equal(empty.status, 'supported')
  assert.deepEqual(empty.candidates, [])

  const badConfiguration = join(fixture.root, 'bad-state')
  await mkdir(badConfiguration)
  await writeFile(join(badConfiguration, 'projects'), 'not a directory')
  const unreadable = new ClaudeSessionDiscovery({
    environment: { CLAUDE_CONFIG_DIR: badConfiguration },
    providerVersion: TEST_PROVIDER_VERSION,
  })
  const failed = await unreadable.discover({
    projectRoot: fixture.projectRoot,
    limit: 10,
  })
  assert.equal(failed.status, 'unavailable')
  assert.equal(failed.failureReason, 'provider_session_store_unreadable')
})

test('concurrent scans coalesce and cancellation leaves no observable candidate', async (t) => {
  const fixture = await createFixture(t, 'coalesce')
  await writeSession({
    projectsDirectory: fixture.projectsDirectory,
    id: sessionId(60),
    cwd: fixture.projectRoot,
    title: 'Coalesced',
  })
  const discovery = discoveryFor(fixture)
  const [first, second] = await Promise.all([
    discovery.discover({ projectRoot: fixture.projectRoot, limit: 10 }),
    discovery.discover({ projectRoot: fixture.projectRoot, limit: 10 }),
  ])
  assert.equal(first.metrics, second.metrics)
  assert.deepEqual(first.candidates, second.candidates)

  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    discovery.discover({
      projectRoot: fixture.projectRoot,
      limit: 10,
      signal: controller.signal,
    }),
    { name: 'AbortError' },
  )
})

test('enforces request and filesystem scan bounds', async (t) => {
  const fixture = await createFixture(t, 'bounds')
  await Promise.all([
    writeSession({
      projectsDirectory: fixture.projectsDirectory,
      id: sessionId(80),
      cwd: fixture.projectRoot,
      title: 'Bound one',
    }),
    writeSession({
      projectsDirectory: fixture.projectsDirectory,
      id: sessionId(81),
      cwd: fixture.projectRoot,
      title: 'Bound two',
    }),
  ])
  const discovery = discoveryFor(fixture, { maximumSessionFiles: 1 })
  const page = await discovery.discover({
    projectRoot: fixture.projectRoot,
    limit: 10,
  })
  assert.equal(page.metrics.filesInspected, 1)
  assert.equal(page.metrics.truncated, true)
  assert.equal(page.candidates.length, 1)
  await assert.rejects(
    discovery.discover({ projectRoot: fixture.projectRoot, limit: 101 }),
    RangeError,
  )

  const lineBounded = discoveryFor(fixture, {
    maximumSessionLineBytes: 64,
  })
  const unavailable = await lineBounded.discover({
    projectRoot: fixture.projectRoot,
    limit: 10,
  })
  assert.equal(unavailable.status, 'unavailable')
  assert.equal(unavailable.failureReason, 'provider_session_format_unsupported')
})

test('uses HOME default state root without reading settings or starting Claude', async (t) => {
  const fixture = await createFixture(t, 'home')
  const defaultState = join(fixture.root, 'home', '.claude')
  const defaultProjects = join(defaultState, 'projects')
  await mkdir(defaultProjects, { recursive: true })
  await writeFile(
    join(defaultState, 'settings.json'),
    JSON.stringify({
      env: {
        ANTHROPIC_AUTH_TOKEN: 'test-value-that-must-not-be-needed',
      },
    }),
  )
  await writeSession({
    projectsDirectory: defaultProjects,
    id: sessionId(70),
    cwd: fixture.projectRoot,
    title: 'Default state root',
  })
  const settingsBefore = await readFile(join(defaultState, 'settings.json'))
  const discovery = new ClaudeSessionDiscovery({
    environment: { HOME: join(fixture.root, 'home') },
    providerVersion: TEST_PROVIDER_VERSION,
  })
  const page = await discovery.discover({
    projectRoot: fixture.projectRoot,
    limit: 10,
  })
  assert.equal(page.candidates.length, 1)
  assert.deepEqual(
    await readFile(join(defaultState, 'settings.json')),
    settingsBefore,
  )
})

test('projects identical Claude messages before an immutable adoption boundary', async (t) => {
  const fixture = await createFixture(t, 'transcript-boundary')
  const id = sessionId(90)
  const path = await writeSession({
    projectsDirectory: fixture.projectsDirectory,
    id,
    cwd: fixture.projectRoot,
    privateContent: 'same visible marker',
  })
  const discovery = discoveryFor(fixture)
  const page = await discovery.discover({
    projectRoot: fixture.projectRoot,
    limit: 10,
  })
  const adopted = await discovery.validateCandidate({
    projectRoot: fixture.projectRoot,
    nativeSessionId: id,
    revision: page.candidates[0].revision,
  })
  assert.match(adopted.transcriptBoundary, /^claude-v1:/u)
  const before = createHash('sha256')
    .update(await readFile(path))
    .digest('hex')

  await appendFile(
    path,
    `${JSON.stringify({
      type: 'user',
      uuid: '33333333-3333-4333-8333-333333333333',
      sessionId: id,
      cwd: fixture.projectRoot,
      timestamp: '2026-01-02T00:00:00.000Z',
      version: TEST_PROVIDER_VERSION,
      message: { role: 'user', content: 'CodeTether continuation' },
    })}\n`,
  )
  const afterContinuation = createHash('sha256')
    .update(await readFile(path))
    .digest('hex')
  assert.notEqual(afterContinuation, before)

  const recent = await discovery.readSessionTranscript({
    projectRoot: fixture.projectRoot,
    nativeSessionId: id,
    boundary: adopted.transcriptBoundary,
    adoptedAt: '2026-01-02T00:00:00.000Z',
    limit: 1,
  })
  assert.equal(recent.status, 'available')
  assert.equal(recent.entries.length, 1)
  assert.equal(recent.entries[0].role, 'assistant')
  assert.equal(recent.entries[0].content, 'same visible marker')
  assert.ok(recent.nextCursor)

  const older = await discovery.readSessionTranscript({
    projectRoot: fixture.projectRoot,
    nativeSessionId: id,
    boundary: adopted.transcriptBoundary,
    adoptedAt: '2026-01-02T00:00:00.000Z',
    cursor: recent.nextCursor,
    limit: 1,
  })
  assert.equal(older.entries[0].role, 'user')
  assert.equal(older.entries[0].content, 'same visible marker')
  assert.notEqual(older.entries[0].id, recent.entries[0].id)
  assert.equal(older.complete, true)
  assert.equal(
    createHash('sha256')
      .update(await readFile(path))
      .digest('hex'),
    afterContinuation,
  )
  assert.equal(
    [...recent.entries, ...older.entries].some((entry) =>
      entry.content.includes('CodeTether continuation'),
    ),
    false,
  )
})

test('Claude transcript parsing is bounded and fail-soft for huge and malformed history', async (t) => {
  const fixture = await createFixture(t, 'transcript-bounds')
  const hugeId = sessionId(91)
  await writeSession({
    projectsDirectory: fixture.projectsDirectory,
    id: hugeId,
    cwd: fixture.projectRoot,
    privateContent: '🙂'.repeat(100_000),
  })
  const malformedId = sessionId(92)
  const malformedPath = await writeSession({
    projectsDirectory: fixture.projectsDirectory,
    id: malformedId,
    cwd: fixture.projectRoot,
  })
  await appendFile(malformedPath, '{"type":"assistant"')
  const discovery = discoveryFor(fixture)

  const huge = await discovery.readSessionTranscript({
    projectRoot: fixture.projectRoot,
    nativeSessionId: hugeId,
    adoptedAt: '2026-01-02T00:00:00.000Z',
    limit: 100,
  })
  assert.equal(huge.status, 'partial')
  assert.equal(huge.entries.length, 2)
  assert.ok(
    huge.entries.reduce(
      (total, entry) => total + Buffer.byteLength(entry.content, 'utf8'),
      0,
    ) <=
      512 * 1024,
  )

  const malformed = await discovery.readSessionTranscript({
    projectRoot: fixture.projectRoot,
    nativeSessionId: malformedId,
    adoptedAt: '2026-01-02T00:00:00.000Z',
    limit: 100,
  })
  assert.equal(malformed.status, 'partial')
  assert.equal(malformed.entries.length, 2)
  assert.equal(malformed.metrics.recordsScanned, 3)
})

test('paginates 300 Claude transcript records with bounded stable ordering', async (t) => {
  const fixture = await createFixture(t, 'long-transcript')
  const id = sessionId(94)
  const bucket = join(fixture.projectsDirectory, 'project')
  await mkdir(bucket, { recursive: true })
  const records = Array.from({ length: 300 }, (_, index) => ({
    type: index % 2 === 0 ? 'user' : 'assistant',
    uuid: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    sessionId: id,
    cwd: fixture.projectRoot,
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    version: TEST_PROVIDER_VERSION,
    message: {
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `visible-${String(index).padStart(3, '0')}`,
    },
  }))
  await writeFile(
    join(bucket, `${id}.jsonl`),
    `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
    { mode: 0o600 },
  )
  const discovery = discoveryFor(fixture)
  const found = await discovery.discover({
    projectRoot: fixture.projectRoot,
    limit: 10,
  })
  const adopted = await discovery.validateCandidate({
    projectRoot: fixture.projectRoot,
    nativeSessionId: id,
    revision: found.candidates[0].revision,
  })
  assert.match(adopted.transcriptBoundary, /^claude-v1:/u)

  const pages = []
  let cursor
  do {
    const page = await discovery.readSessionTranscript({
      projectRoot: fixture.projectRoot,
      nativeSessionId: id,
      boundary: adopted.transcriptBoundary,
      adoptedAt: '2026-01-02T00:00:00.000Z',
      ...(cursor === undefined ? {} : { cursor }),
      limit: 100,
    })
    assert.ok(page.entries.length <= 100)
    assert.equal(page.status, 'available')
    pages.push(page)
    cursor = page.nextCursor
  } while (cursor !== undefined)

  const chronological = [...pages].reverse().flatMap((page) => page.entries)
  assert.equal(pages.length, 3)
  assert.equal(chronological.length, 300)
  assert.deepEqual(
    chronological.map(({ content }) => content),
    records.map(({ message }) => message.content),
  )
  assert.equal(new Set(chronological.map(({ id }) => id)).size, 300)
})

test('legacy Claude adoption uses timestamp evidence and remains explicitly partial', async (t) => {
  const fixture = await createFixture(t, 'legacy-transcript')
  const id = sessionId(93)
  await writeSession({
    projectsDirectory: fixture.projectsDirectory,
    id,
    cwd: fixture.projectRoot,
  })
  const page = await discoveryFor(fixture).readSessionTranscript({
    projectRoot: fixture.projectRoot,
    nativeSessionId: id,
    adoptedAt: '2026-01-01T00:00:02.000Z',
    limit: 50,
  })
  assert.equal(page.status, 'partial')
  assert.deepEqual(
    page.entries.map((entry) => entry.role),
    ['user', 'assistant'],
  )
})
