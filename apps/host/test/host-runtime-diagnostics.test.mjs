import assert from 'node:assert/strict'
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

import { canonicalFailure } from '@codetether/agent-core'
import { ZodError } from 'zod'

import {
  BoundedLocalJsonl,
  LOCAL_LOG_MAX_FILE_BYTES,
  LOCAL_LOG_MAX_FILES,
} from '../dist/api/bounded-local-jsonl.js'
import { HostPresenceDiagnosticError } from '../dist/api/host-presence-publisher.js'
import {
  HostRuntimeDiagnostics,
  HOST_RUNTIME_DIAGNOSTIC_MAX_FILE_BYTES,
  HOST_RUNTIME_DIAGNOSTIC_MAX_FILES,
} from '../dist/api/host-runtime-diagnostics.js'

const turnId = 'turn_12345678'
const anotherTurnId = 'turn_87654321'

async function withDiagnostics(run) {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-runtime-log-'))
  const databasePath = join(directory, 'state.sqlite3')
  const path = join(directory, 'logs', 'host-diagnostics.jsonl')
  const diagnostics = new HostRuntimeDiagnostics({
    databasePath,
    productVersion: '0.1.0-alpha.5',
    hostVersion: 'git-13fa6b8',
  })
  try {
    await run({ directory, path, diagnostics })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function readRecords(path) {
  return (await readFile(path, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
}

test('runtime diagnostics record every required lifecycle and failure event', async () => {
  await withDiagnostics(async ({ path, diagnostics }) => {
    diagnostics.recordHostStart({ port: 49231 })
    diagnostics.recordCodexStarted({ pid: 12345, version: '0.162.1' })
    diagnostics.recordCodexExited({ code: 1, signal: null, expected: false })
    diagnostics.recordCodexStarted({ pid: 12346, version: '0.162.1' })
    diagnostics.recordFailure({
      event: 'runtime.failure',
      provider: 'codex',
      machineKind: 'local',
      turnIds: [turnId],
      canonical: canonicalFailure('runtime_error', new Date().toISOString()),
      error: new TypeError('never retained'),
      providerEvent: { type: 'tool.completed', itemKind: 'shell' },
    })
    diagnostics.recordFailure({
      event: 'persistence.failure',
      affectedTurns: [
        { turnId, provider: 'codex', machineKind: 'local' },
        {
          turnId: anotherTurnId,
          provider: 'claude-code',
          machineKind: 'remote',
        },
      ],
      canonical: canonicalFailure('runtime_error', new Date().toISOString()),
      error: new Error('never retained'),
    })
    diagnostics.recordHostStartupFailure(new Error('never retained'))
    diagnostics.recordHostUnhandled({
      kind: 'unhandled_rejection',
      error: new Error('never retained'),
    })
    diagnostics.recordHostReady({ port: 49231 })
    diagnostics.recordHostShutdown()

    const records = await readRecords(path)
    assert.deepEqual(
      records.map((record) => record.event),
      [
        'host.start',
        'codex.started',
        'codex.exited',
        'codex.restarted',
        'codex.started',
        'runtime.failure',
        'persistence.failure',
        'host.startup_failure',
        'host.unhandled',
        'host.ready',
        'host.shutdown',
      ],
    )
    for (const record of records) {
      assert.equal(record.component, 'host')
      assert.equal(record.version, '0.1.0-alpha.5')
      assert.equal(record.build, 'git-13fa6b8')
      assert.ok(Number.isFinite(Date.parse(record.observedAt)))
    }
    assert.equal(records[0].port, 49231)
    assert.equal(records.at(-2).port, 49231)
    assert.deepEqual(
      [
        records[1].pid,
        records[1].codexVersion,
        records[2].code,
        records[2].expected,
      ],
      [12345, '0.162.1', 1, false],
    )
    assert.deepEqual(records[5].turnIds, [turnId])
    assert.equal(records[5].providerEvent.type, 'tool.completed')
    assert.equal(records[5].providerEvent.itemKind, 'shell')
    assert.deepEqual(records[6].affectedTurns, [
      { turnId, provider: 'codex', machineKind: 'local' },
      { turnId: anotherTurnId, provider: 'claude-code', machineKind: 'remote' },
    ])
  })
})

test('failure projection excludes message, project path, secret, cause input and unsafe metadata', async () => {
  await withDiagnostics(async ({ path, diagnostics }) => {
    const secret = 'FAKE_SECRET_NEVER_STORE_94af'
    const projectPath = 'C:\\Users\\somebody\\private-project\\app.ts'
    const cause = new Error(`${secret} ${projectPath}`)
    cause.name = `Cause${secret}Error`
    cause.code = secret
    const error = new TypeError(`${secret} ${projectPath}`, { cause })
    error.failureReason = 'runtime_error'
    error.code = 'ENOENT'
    error.exitCode = 2
    error.signal = 'SIGTERM'
    const trustedFile = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      'dist',
      'api',
      'host-service.js',
    )
    error.stack = `TypeError: ${secret}\n    at HostService.#acceptProviderEvent (${pathToFileURL(trustedFile).href}:77:11)\n    at ${secret} (${projectPath}:12:4)`
    diagnostics.recordFailure({
      event: 'runtime.failure',
      provider: 'codex',
      machineKind: 'remote',
      machineId: 'machine_12345678',
      turnIds: [turnId, secret],
      canonical: canonicalFailure('runtime_error', new Date().toISOString()),
      error,
      providerEvent: { type: 'tool.completed', itemKind: secret },
    })

    const zod = new ZodError([
      {
        code: 'invalid_type',
        path: ['payload', secret, 'turnId'],
        expected: 'string',
        input: { secret, projectPath },
        message: `${secret} ${projectPath}`,
      },
    ])
    diagnostics.recordHostUnhandled({ kind: 'uncaught_exception', error: zod })

    const raw = await readFile(path, 'utf8')
    assert.equal(raw.includes(secret), false)
    assert.equal(raw.includes(projectPath), false)
    assert.equal(raw.includes('private-project'), false)
    assert.equal(raw.includes('at HostService'), false)

    const records = await readRecords(path)
    const failure = records[0]
    assert.equal(failure.reason, 'runtime_error')
    assert.equal(failure.source, 'runtime')
    assert.equal(failure.error.name, 'TypeError')
    assert.equal(failure.error.failureReason, 'runtime_error')
    assert.equal(failure.error.code, 'ENOENT')
    assert.equal(failure.error.osCode, 'ENOENT')
    assert.equal(failure.error.exitCode, 2)
    assert.equal(failure.error.signal, 'SIGTERM')
    assert.deepEqual(failure.error.causes, [{ name: 'Error' }])
    assert.deepEqual(failure.error.stack, [
      {
        function: 'HostService.#acceptProviderEvent',
        file: 'host-service.js',
        line: 77,
        column: 11,
      },
    ])
    assert.deepEqual(failure.turnIds, [turnId])
    assert.equal(failure.providerEvent.itemKind, 'unknown')
    assert.deepEqual(records[1].error.zodIssues, [
      { code: 'invalid_type', path: ['payload', '<dynamic>', 'turnId'] },
    ])
  })
})

test('identical records are capped within a minute', async () => {
  await withDiagnostics(async ({ path, diagnostics }) => {
    for (let index = 0; index < 40; index++) {
      diagnostics.recordCodexExited({ code: 1, signal: null, expected: false })
    }
    const records = await readRecords(path)
    assert.equal(records.length, 4)
    assert.ok(records.every((record) => record.event === 'codex.exited'))
  })
})

test('cause chains and stack frames have fixed caps, including packaged frames', async () => {
  await withDiagnostics(async ({ path, diagnostics }) => {
    const secret = 'FAKE_SECRET_PACKAGED_STACK_84dc'
    const error = new Error(secret)
    let current = error
    for (let index = 0; index < 8; index++) {
      current.cause = new Error('private')
      current = current.cause
    }
    error.stack = `Error: ${secret}\n${Array.from(
      { length: 30 },
      (_, index) => `    at ${secret} (codetether-host.mjs:${index + 1}:2)`,
    ).join('\n')}`
    diagnostics.recordHostStartupFailure(error)
    const [record] = await readRecords(path)
    assert.equal(record.error.causes.length, 4)
    assert.equal(record.error.stack.length, 20)
    assert.deepEqual(record.error.stack[0], {
      function: '<bundle>',
      file: 'codetether-host.mjs',
      line: 1,
      column: 2,
    })
    assert.equal((await readFile(path, 'utf8')).includes(secret), false)
  })
})

test('known CodeTether class names survive without accepting private Error names', async () => {
  await withDiagnostics(async ({ path, diagnostics }) => {
    diagnostics.recordHostStartupFailure(
      new HostPresenceDiagnosticError('network_error'),
    )
    const [record] = await readRecords(path)
    assert.equal(record.error.name, 'HostPresenceDiagnosticError')
  })
})

test('production Host log caps match the shared bounded writer', () => {
  assert.equal(HOST_RUNTIME_DIAGNOSTIC_MAX_FILE_BYTES, LOCAL_LOG_MAX_FILE_BYTES)
  assert.equal(HOST_RUNTIME_DIAGNOSTIC_MAX_FILES, LOCAL_LOG_MAX_FILES)
})

test('bounded append rotates across a fixed number of small files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-rotation-'))
  try {
    const path = join(directory, 'logs', 'fixture.jsonl')
    const writer = new BoundedLocalJsonl(path, {
      maxFileBytes: 128,
      maxFiles: 3,
    })
    for (let index = 0; index < 40; index++) {
      writer.append(`${JSON.stringify({ event: 'probe', index })}\n`)
    }
    const files = (await readdir(join(directory, 'logs'))).sort()
    assert.deepEqual(files, [
      'fixture.jsonl',
      'fixture.jsonl.1',
      'fixture.jsonl.2',
    ])
    for (const file of files) {
      assert.ok((await stat(join(directory, 'logs', file))).size <= 128)
    }
    assert.match(await readFile(path, 'utf8'), /"index":39/u)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('unwritable diagnostics never change Host behavior', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-unwritable-'))
  try {
    const blocker = join(directory, 'blocker')
    await writeFile(blocker, 'not a directory')
    const diagnostics = new HostRuntimeDiagnostics({
      databasePath: join(blocker, 'state.sqlite3'),
      productVersion: '0.1.0-alpha.5',
      hostVersion: 'git-13fa6b8',
    })
    assert.doesNotThrow(() => diagnostics.recordHostStart({ port: 49231 }))
    assert.doesNotThrow(() =>
      diagnostics.recordFailure({
        event: 'runtime.failure',
        provider: 'codex',
        machineKind: 'local',
        canonical: canonicalFailure('runtime_error', new Date().toISOString()),
        error: new Error('private'),
      }),
    )
    assert.equal(await readFile(blocker, 'utf8'), 'not a directory')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('oversize lines are dropped before append', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-oversize-'))
  try {
    const path = join(directory, 'fixture.jsonl')
    const writer = new BoundedLocalJsonl(path, {
      maxFileBytes: 128,
      maxFiles: 3,
    })
    writer.append(`${JSON.stringify({ value: 'x'.repeat(256) })}\n`)
    await assert.rejects(readFile(path, 'utf8'), { code: 'ENOENT' })
    assert.ok(HOST_RUNTIME_DIAGNOSTIC_MAX_FILE_BYTES > 128)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
