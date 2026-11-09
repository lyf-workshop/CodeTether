import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'

const PRODUCT_VERSION_FILE = 'host-product-version'
const PENDING_VERSION_FILE = 'host-product-version-pending'
const MAX_BACKUPS = 3
const PRODUCT_VERSION_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u
const BACKUP_NAME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-(?:\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?|unversioned)$/u

export interface PendingProductVersionBackup {
  /** Called only after SQLite migrations and integrity verification succeed. */
  complete(): void
  /** Discard only this attempt's copy when the schema is from a newer Host. */
  discard(): void
}

export interface ProductVersionBackupHooksForTests {
  readonly beforePendingMarkerWrite?: () => void
  readonly beforeFinalMarkerWrite?: () => void
}

interface PendingMarker {
  readonly previousVersion: string | null
  readonly backupName: string
  readonly databaseName: string
}

/**
 * The owned Host is stopped before an update. Copy the closed SQLite file set
 * before DatabaseSync can open it or change its WAL state. No other files in
 * the data directory are inspected or copied.
 */
export function prepareProductVersionBackup(
  databasePath: string,
  productVersion: string,
  hooksForTests: ProductVersionBackupHooksForTests = {},
): PendingProductVersionBackup {
  if (!PRODUCT_VERSION_PATTERN.test(productVersion)) {
    throw new Error('Host product version must be a semantic version')
  }

  const dataDirectory = dirname(databasePath)
  const markerPath = join(dataDirectory, PRODUCT_VERSION_FILE)
  const pendingPath = join(dataDirectory, PENDING_VERSION_FILE)
  const backupsRoot = join(dataDirectory, 'backups')
  const previousVersion = readPreviousVersion(markerPath)
  const changed = previousVersion !== productVersion
  const databaseExists = isRegularFileIfPresent(databasePath)
  const pending = readPendingMarker(pendingPath)
  let backupDirectory: string | undefined
  let createdThisAttempt = false

  if (pending !== undefined) {
    if (pending.databaseName !== basename(databasePath)) {
      throw new Error('Pending database backup belongs to a different database')
    }
    if (pending.previousVersion === (previousVersion ?? null)) {
      const pendingBackup = join(backupsRoot, pending.backupName)
      if (
        !isDirectoryIfPresent(pendingBackup) ||
        !isRegularFileIfPresent(join(pendingBackup, pending.databaseName))
      ) {
        throw new Error(
          'Pending database backup is missing; Host cannot migrate safely',
        )
      }
      // A previous launch may have migrated SQLite, then failed to commit the
      // final version marker. Never copy that already-migrated database again.
      backupDirectory = pendingBackup
    } else {
      // The final marker was committed before a crash removed pending state.
      // Its backup is now ordinary history, subject to the retention limit.
      removePendingMarker(pendingPath)
      if (isDirectoryIfPresent(backupsRoot)) {
        pruneOldBackups(backupsRoot, pending.backupName)
      }
    }
  }

  if (changed && databaseExists && backupDirectory === undefined) {
    try {
      backupDirectory = copyDatabaseFileSet(
        databasePath,
        previousVersion ?? 'unversioned',
      )
      createdThisAttempt = true
      hooksForTests.beforePendingMarkerWrite?.()
      writePendingMarker(pendingPath, {
        previousVersion: previousVersion ?? null,
        backupName: basename(backupDirectory),
        databaseName: basename(databasePath),
      })
    } catch (error) {
      if (createdThisAttempt && backupDirectory !== undefined) {
        try {
          removePendingMarker(pendingPath)
          rmSync(backupDirectory, { recursive: true })
          syncDirectoryIfSupported(backupsRoot)
        } catch {
          // Keep the first failure; a surviving pending record protects the
          // completed copy on the next launch.
        }
      }
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(
        `Could not back up local database before update: ${reason}`,
        {
          cause: error,
        },
      )
    }
  }

  return {
    complete(): void {
      if (changed) {
        hooksForTests.beforeFinalMarkerWrite?.()
        writeVersionMarker(markerPath, productVersion)
      }
      if (backupDirectory !== undefined) {
        removePendingMarker(pendingPath)
        pruneOldBackups(backupsRoot, basename(backupDirectory))
      }
    },
    discard(): void {
      if (!createdThisAttempt || backupDirectory === undefined) return
      removePendingMarker(pendingPath)
      rmSync(backupDirectory, { recursive: true })
      syncDirectoryIfSupported(backupsRoot)
    },
  }
}

function readPreviousVersion(markerPath: string): string | undefined {
  if (!isRegularFileIfPresent(markerPath)) return undefined
  const value = readFileSync(markerPath, 'utf8').trim()
  return PRODUCT_VERSION_PATTERN.test(value) ? value : undefined
}

function readPendingMarker(path: string): PendingMarker | undefined {
  if (!isRegularFileIfPresent(path)) return undefined
  if (lstatSync(path).size > 1_024) {
    throw new Error('Pending database backup marker is invalid')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch (error) {
    throw new Error('Pending database backup marker is invalid', {
      cause: error,
    })
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('previousVersion' in parsed) ||
    !('backupName' in parsed) ||
    !('databaseName' in parsed) ||
    !(
      parsed.previousVersion === null ||
      (typeof parsed.previousVersion === 'string' &&
        PRODUCT_VERSION_PATTERN.test(parsed.previousVersion))
    ) ||
    typeof parsed.backupName !== 'string' ||
    !BACKUP_NAME_PATTERN.test(parsed.backupName) ||
    typeof parsed.databaseName !== 'string'
  ) {
    throw new Error('Pending database backup marker is invalid')
  }
  return parsed as PendingMarker
}

function isRegularFileIfPresent(path: string): boolean {
  try {
    const stat = lstatSync(path)
    if (!stat.isFile()) {
      throw new Error(`Expected a regular file: ${path}`)
    }
    return true
  } catch (error) {
    if (isFileNotFound(error)) return false
    throw error
  }
}

function isDirectoryIfPresent(path: string): boolean {
  try {
    return lstatSync(path).isDirectory()
  } catch (error) {
    if (isFileNotFound(error)) return false
    throw error
  }
}

function copyDatabaseFileSet(
  databasePath: string,
  previousVersion: string,
): string {
  const backupsRoot = join(dirname(databasePath), 'backups')
  if (existsSync(backupsRoot) && !lstatSync(backupsRoot).isDirectory()) {
    throw new Error(`Expected a backup directory: ${backupsRoot}`)
  }
  mkdirSync(backupsRoot, { recursive: true })

  let backupDirectory: string | undefined
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const timestamp = new Date(Date.now() + attempt)
      .toISOString()
      .replaceAll(':', '-')
      .replace('.', '-')
    const candidate = join(backupsRoot, `${timestamp}-${previousVersion}`)
    try {
      mkdirSync(candidate)
      backupDirectory = candidate
      break
    } catch (error) {
      if (!isFileAlreadyExists(error)) throw error
    }
  }
  if (backupDirectory === undefined) {
    throw new Error('Could not create a unique database backup directory')
  }

  try {
    for (const suffix of ['', '-wal', '-shm']) {
      const source = `${databasePath}${suffix}`
      if (!isRegularFileIfPresent(source)) continue
      const destination = join(
        backupDirectory,
        `${basename(databasePath)}${suffix}`,
      )
      copyFileSync(source, destination)
      syncFile(destination)
    }
    syncDirectoryIfSupported(backupDirectory)
    syncDirectoryIfSupported(backupsRoot)
    return backupDirectory
  } catch (error) {
    try {
      rmSync(backupDirectory, { recursive: true, force: true })
    } catch {
      // Preserve the copy or sync failure; the original database is untouched.
    }
    throw error
  }
}

function writeVersionMarker(markerPath: string, productVersion: string): void {
  writeAtomicMarker(markerPath, `${productVersion}\n`)
}

function writePendingMarker(path: string, pending: PendingMarker): void {
  writeAtomicMarker(path, `${JSON.stringify(pending)}\n`)
}

function writeAtomicMarker(markerPath: string, content: string): void {
  const temporaryPath = join(
    dirname(markerPath),
    `.${basename(markerPath)}-${randomUUID()}.tmp`,
  )
  try {
    writeFileSync(temporaryPath, content, { flag: 'wx' })
    syncFile(temporaryPath)
    renameSync(temporaryPath, markerPath)
    syncDirectoryIfSupported(dirname(markerPath))
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}

function removePendingMarker(path: string): void {
  rmSync(path, { force: true })
  syncDirectoryIfSupported(dirname(path))
}

function pruneOldBackups(
  backupsRoot: string,
  protectedBackupName?: string,
): void {
  const backups = readdirSync(backupsRoot, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && BACKUP_NAME_PATTERN.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort()
    .reverse()
  const retained = backups.slice(0, MAX_BACKUPS)
  if (
    protectedBackupName !== undefined &&
    backups.includes(protectedBackupName) &&
    !retained.includes(protectedBackupName)
  ) {
    retained.pop()
    retained.push(protectedBackupName)
  }
  for (const name of backups.filter(
    (candidate) => !retained.includes(candidate),
  )) {
    rmSync(join(backupsRoot, name), { recursive: true })
  }
  syncDirectoryIfSupported(backupsRoot)
}

function syncFile(path: string, flags: 'r' | 'r+' = 'r+'): void {
  const descriptor = openSync(path, flags)
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function syncDirectoryIfSupported(path: string): void {
  // Windows cannot open a directory using node:fs. Every copied file and the
  // marker are individually flushed there; Unix can also flush directory
  // entries before SQLite is opened.
  if (process.platform === 'win32') return
  syncFile(path, 'r')
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function isFileAlreadyExists(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}
