import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { ConversationStore } from '../dist/persistence/conversation-store.js'
import { prepareProductVersionBackup } from '../dist/persistence/product-version-backup.js'

const hostRoot = fileURLToPath(new URL('../', import.meta.url))
const serveEntry = join(hostRoot, 'dist', 'serve.js')

test('a new database writes its product version without creating a backup', async (t) => {
  const directory = await temporaryDirectory(t)
  const store = ConversationStore.open({
    databasePath: join(directory, 'codetether.sqlite3'),
    productVersion: '0.1.0-alpha.3',
  })
  store.close()
  assert.equal(
    await readFile(join(directory, 'host-product-version'), 'utf8'),
    '0.1.0-alpha.3\n',
  )
  assert.deepEqual(
    await readdir(join(directory, 'backups')).catch(() => []),
    [],
  )
})

test('version change copies only the SQLite file set, flushes it, and retains three backups', async (t) => {
  const directory = await temporaryDirectory(t)
  const databasePath = join(directory, 'codetether.sqlite3')
  const markerPath = join(directory, 'host-product-version')
  await writeFile(databasePath, 'database-v1')
  await writeFile(`${databasePath}-wal`, 'wal-v1')
  await writeFile(`${databasePath}-shm`, 'shm-v1')
  await writeFile(join(directory, 'machine-credentials'), 'must-not-be-copied')

  prepareProductVersionBackup(databasePath, '0.1.0-alpha.1').complete()
  assert.equal(await readFile(markerPath, 'utf8'), '0.1.0-alpha.1\n')
  assert.ok(
    (await readdir(join(directory, 'backups')))[0].endsWith('-unversioned'),
  )

  for (const version of [2, 3, 4, 5]) {
    prepareProductVersionBackup(
      databasePath,
      `0.1.0-alpha.${version}`,
    ).complete()
    await new Promise((resolve) => setTimeout(resolve, 3))
  }

  const backups = (await readdir(join(directory, 'backups'))).sort()
  assert.equal(backups.length, 3)
  assert.ok(backups[0].endsWith('-0.1.0-alpha.2'))
  assert.ok(backups[1].endsWith('-0.1.0-alpha.3'))
  assert.ok(backups[2].endsWith('-0.1.0-alpha.4'))
  for (const backup of backups) {
    const path = join(directory, 'backups', backup)
    assert.equal(
      await readFile(join(path, 'codetether.sqlite3'), 'utf8'),
      'database-v1',
    )
    assert.equal(
      await readFile(join(path, 'codetether.sqlite3-wal'), 'utf8'),
      'wal-v1',
    )
    assert.equal(
      await readFile(join(path, 'codetether.sqlite3-shm'), 'utf8'),
      'shm-v1',
    )
    assert.ok(!(await readdir(path)).includes('machine-credentials'))
  }
  assert.equal(await readFile(markerPath, 'utf8'), '0.1.0-alpha.5\n')
})

test('backup failure stops before SQLite is opened and preserves the original files', async (t) => {
  const directory = await temporaryDirectory(t)
  const databasePath = join(directory, 'codetether.sqlite3')
  await writeFile(databasePath, 'original-database')
  await writeFile(join(directory, 'host-product-version'), '0.1.0-alpha.2\n')
  await writeFile(join(directory, 'backups'), 'blocks-backup-directory')

  assert.throws(
    () =>
      ConversationStore.open({ databasePath, productVersion: '0.1.0-alpha.3' }),
    /Could not back up local database before update/u,
  )
  assert.equal(await readFile(databasePath, 'utf8'), 'original-database')
  assert.equal(
    await readFile(join(directory, 'host-product-version'), 'utf8'),
    '0.1.0-alpha.2\n',
  )
})

test('a successful SQLite reopen advances the marker only after backing up the old version', async (t) => {
  const directory = await temporaryDirectory(t)
  const databasePath = join(directory, 'codetether.sqlite3')
  ConversationStore.open({
    databasePath,
    productVersion: '0.1.0-alpha.2',
  }).close()
  const before = await readFile(databasePath)

  ConversationStore.open({
    databasePath,
    productVersion: '0.1.0-alpha.3',
  }).close()

  const backups = await readdir(join(directory, 'backups'))
  assert.equal(backups.length, 1)
  assert.ok(backups[0].endsWith('-0.1.0-alpha.2'))
  assert.deepEqual(
    await readFile(
      join(directory, 'backups', backups[0], 'codetether.sqlite3'),
    ),
    before,
  )
  assert.equal(
    await readFile(join(directory, 'host-product-version'), 'utf8'),
    '0.1.0-alpha.3\n',
  )
})

test('a failed pending marker write removes this attempt’s backup before SQLite opens', async (t) => {
  const directory = await temporaryDirectory(t)
  const databasePath = join(directory, 'codetether.sqlite3')
  ConversationStore.open({
    databasePath,
    productVersion: '0.1.0-alpha.1',
  }).close()
  ConversationStore.open({
    databasePath,
    productVersion: '0.1.0-alpha.2',
  }).close()
  const previousBackups = await readdir(join(directory, 'backups'))
  assert.equal(previousBackups.length, 1)
  const before = await readFile(databasePath)

  assert.throws(
    () =>
      ConversationStore.open({
        databasePath,
        productVersion: '0.1.0-alpha.3',
        productVersionBackupHooksForTests: {
          beforePendingMarkerWrite: () => {
            throw new Error('injected pending marker failure')
          },
        },
      }),
    /injected pending marker failure/u,
  )
  assert.deepEqual(await readdir(join(directory, 'backups')), previousBackups)
  assert.deepEqual(await readFile(databasePath), before)
  assert.equal(
    await readFile(join(directory, 'host-product-version'), 'utf8'),
    '0.1.0-alpha.2\n',
  )
  await assert.rejects(
    readFile(join(directory, 'host-product-version-pending'), 'utf8'),
    { code: 'ENOENT' },
  )
})

test('final marker failure reuses one durable pre-migration backup across repeated opens', async (t) => {
  const directory = await temporaryDirectory(t)
  const databasePath = join(directory, 'codetether.sqlite3')
  ConversationStore.open({
    databasePath,
    productVersion: '0.1.0-alpha.1',
  }).close()
  ConversationStore.open({
    databasePath,
    productVersion: '0.1.0-alpha.2',
  }).close()
  const oldBackups = await readdir(join(directory, 'backups'))
  assert.equal(oldBackups.length, 1)

  const failFinalMarker = () => {
    throw new Error('injected final marker failure')
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.throws(
      () =>
        ConversationStore.open({
          databasePath,
          productVersion: '0.1.0-alpha.3',
          productVersionBackupHooksForTests: {
            beforeFinalMarkerWrite: failFinalMarker,
          },
        }),
      /injected final marker failure/u,
    )
    const backups = await readdir(join(directory, 'backups'))
    assert.equal(backups.length, 2)
    assert.ok(backups.includes(oldBackups[0]))
    assert.equal(
      backups.filter((name) => name.endsWith('-0.1.0-alpha.2')).length,
      1,
    )
    assert.equal(
      await readFile(join(directory, 'host-product-version'), 'utf8'),
      '0.1.0-alpha.2\n',
    )
  }

  const pending = JSON.parse(
    await readFile(join(directory, 'host-product-version-pending'), 'utf8'),
  )
  assert.equal(pending.previousVersion, '0.1.0-alpha.2')
  assert.ok(pending.backupName.endsWith('-0.1.0-alpha.2'))
  const trueBackup = await readFile(
    join(directory, 'backups', pending.backupName, 'codetether.sqlite3'),
  )

  ConversationStore.open({
    databasePath,
    productVersion: '0.1.0-alpha.3',
  }).close()
  assert.equal(
    await readFile(join(directory, 'host-product-version'), 'utf8'),
    '0.1.0-alpha.3\n',
  )
  assert.deepEqual(
    await readFile(
      join(directory, 'backups', pending.backupName, 'codetether.sqlite3'),
    ),
    trueBackup,
  )
  assert.equal((await readdir(join(directory, 'backups'))).length, 2)
  await assert.rejects(
    readFile(join(directory, 'host-product-version-pending'), 'utf8'),
    { code: 'ENOENT' },
  )
})

test('a committed final marker clears pending state left by an interrupted cleanup', async (t) => {
  const directory = await temporaryDirectory(t)
  const databasePath = join(directory, 'codetether.sqlite3')
  ConversationStore.open({
    databasePath,
    productVersion: '0.1.0-alpha.2',
  }).close()
  assert.throws(
    () =>
      ConversationStore.open({
        databasePath,
        productVersion: '0.1.0-alpha.3',
        productVersionBackupHooksForTests: {
          beforeFinalMarkerWrite: () => {
            throw new Error('interrupted before final marker')
          },
        },
      }),
    /interrupted before final marker/u,
  )
  const backups = await readdir(join(directory, 'backups'))
  assert.equal(backups.length, 1)

  // Model the crash window after the atomic final marker rename and before
  // pending cleanup; the next launch should finish cleanup without recopying.
  await writeFile(join(directory, 'host-product-version'), '0.1.0-alpha.3\n')
  ConversationStore.open({
    databasePath,
    productVersion: '0.1.0-alpha.3',
  }).close()
  assert.deepEqual(await readdir(join(directory, 'backups')), backups)
  await assert.rejects(
    readFile(join(directory, 'host-product-version-pending'), 'utf8'),
    { code: 'ENOENT' },
  )
})

test('repeated downgrade attempts discard only their own backup and exit with a fixed reason', async (t) => {
  const directory = await temporaryDirectory(t)
  const databasePath = join(directory, 'codetether.sqlite3')
  ConversationStore.open({
    databasePath,
    productVersion: '0.1.0-alpha.1',
  }).close()
  ConversationStore.open({
    databasePath,
    productVersion: '0.1.0-alpha.2',
  }).close()
  const previousBackups = await readdir(join(directory, 'backups'))
  assert.equal(previousBackups.length, 1)
  const previousBackupBytes = await readFile(
    join(directory, 'backups', previousBackups[0], 'codetether.sqlite3'),
  )
  const database = new DatabaseSync(databasePath)
  try {
    database.exec(
      "INSERT INTO schema_migrations(version, name, applied_at) VALUES (999, 'future_schema', '2026-11-09T00:00:00.000Z')",
    )
  } finally {
    database.close()
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.throws(
      () =>
        ConversationStore.open({
          databasePath,
          productVersion: '0.1.0-alpha.3',
        }),
      /Unsupported SQLite schema migration/u,
    )
    assert.deepEqual(await readdir(join(directory, 'backups')), previousBackups)
  }
  assert.equal(
    await readFile(join(directory, 'host-product-version'), 'utf8'),
    '0.1.0-alpha.2\n',
  )
  assert.deepEqual(
    await readFile(
      join(directory, 'backups', previousBackups[0], 'codetether.sqlite3'),
    ),
    previousBackupBytes,
  )

  const result = await spawnServe(directory)
  assert.equal(result.code, 42)
  assert.ok(
    result.stderr
      .split(/\r?\n/u)
      .includes('[codetether:host] UNSUPPORTED_SQLITE_SCHEMA_MIGRATION'),
  )
  assert.ok(!result.stderr.includes('future_schema'))
  assert.deepEqual(await readdir(join(directory, 'backups')), previousBackups)
  const stillNewer = new DatabaseSync(databasePath)
  try {
    assert.equal(
      stillNewer
        .prepare('SELECT MAX(version) AS version FROM schema_migrations')
        .get().version,
      999,
    )
  } finally {
    stillNewer.close()
  }
})

async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), 'codetether-u1-backup-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

async function spawnServe(dataDirectory) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serveEntry, '--port', '0'], {
      cwd: hostRoot,
      env: { ...process.env, CODETETHER_DATA_DIR: dataDirectory },
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('close', (code) => resolve({ code, stderr }))
  })
}
