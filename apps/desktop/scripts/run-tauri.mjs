import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cargoBin = join(process.env.USERPROFILE ?? homedir(), '.cargo', 'bin')
const tauriCli = join(
  desktopDirectory,
  'node_modules',
  '@tauri-apps',
  'cli',
  'tauri.js',
)

const arguments_ = process.argv.slice(2)
if (arguments_[0] === 'build' && process.platform !== 'win32') {
  arguments_.push(
    '--config',
    `src-tauri/tauri.${process.platform === 'darwin' ? 'macos' : 'linux'}.conf.json`,
  )
}
execFileSync(process.execPath, [tauriCli, ...arguments_], {
  cwd: desktopDirectory,
  env: {
    ...process.env,
    PATH: `${cargoBin}${delimiter}${process.env.PATH ?? ''}`,
  },
  stdio: 'inherit',
})
