import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)))
const manifestPath = join(desktopDirectory, 'src-tauri', 'Cargo.toml')
const cargoDirectory = join(
  process.env.USERPROFILE ?? homedir(),
  '.cargo',
  'bin',
)
const cargo = join(
  cargoDirectory,
  process.platform === 'win32' ? 'cargo.exe' : 'cargo',
)

const checks = [
  ['fmt', '--manifest-path', manifestPath, '--all', '--', '--check'],
  ['check', '--manifest-path', manifestPath, '--all-targets'],
  [
    'clippy',
    '--manifest-path',
    manifestPath,
    '--all-targets',
    '--all-features',
    '--',
    '-D',
    'warnings',
  ],
  ['test', '--manifest-path', manifestPath],
]

for (const arguments_ of checks) {
  const result = spawnSync(cargo, arguments_, {
    cwd: desktopDirectory,
    stdio: 'inherit',
    env: {
      ...process.env,
      PATH: `${cargoDirectory}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`,
    },
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
