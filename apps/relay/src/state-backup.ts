import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

import { RelayStateStore } from './state-store.js'

const databaseFilename = 'relay.sqlite3'

export function restoreRelayStateBackup(
  backupDirectory: string,
  targetStateDirectory: string,
): void {
  const source = explicitDirectory(backupDirectory, 'Relay backup')
  const target = explicitPath(targetStateDirectory, 'Relay restore target')
  const sourceDatabase = join(source, databaseFilename)
  if (!statSync(sourceDatabase).isFile()) {
    throw new Error('Relay backup database is missing')
  }
  try {
    const entries = readdirSync(target)
    if (entries.length !== 0)
      throw new Error('Relay restore target is not empty')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    mkdirSync(target, { recursive: false, mode: 0o700 })
  }
  chmodSync(target, 0o700)
  const targetDatabase = join(target, databaseFilename)
  copyFileSync(sourceDatabase, targetDatabase, 1)
  chmodSync(targetDatabase, 0o600)
  const restored = new RelayStateStore(target)
  restored.close()
}

function explicitDirectory(path: string, label: string): string {
  const absolute = explicitPath(path, label)
  if (!statSync(absolute).isDirectory())
    throw new Error(`${label} is not a directory`)
  return absolute
}

function explicitPath(path: string, label: string): string {
  const absolute = resolve(path)
  if (!isAbsolute(path) || absolute !== path || absolute.length < 4) {
    throw new Error(`${label} path must be explicit and absolute`)
  }
  return absolute
}
