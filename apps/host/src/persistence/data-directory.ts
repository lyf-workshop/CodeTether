import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'

const APPLICATION_DIRECTORY = 'CodeTether'

export interface DataDirectoryOptions {
  readonly env?: NodeJS.ProcessEnv
  readonly homeDirectory?: string
  readonly platform?: NodeJS.Platform
}

/** Resolve the durable Host data directory without consulting the repository. */
export function resolveCodeTetherDataDirectory(
  options: DataDirectoryOptions = {},
): string {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const path = platform === 'win32' ? win32 : posix
  const home = path.resolve(options.homeDirectory ?? homedir())
  const configured = env.CODETETHER_DATA_DIR?.trim()

  if (configured !== undefined && configured.length > 0) {
    if (!path.isAbsolute(configured)) {
      throw new Error('CODETETHER_DATA_DIR must be an absolute path')
    }
    return path.resolve(configured)
  }

  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA?.trim()
    return localAppData
      ? path.join(path.resolve(localAppData), APPLICATION_DIRECTORY)
      : path.join(home, 'AppData', 'Local', APPLICATION_DIRECTORY)
  }

  if (platform === 'darwin') {
    return path.join(
      home,
      'Library',
      'Application Support',
      APPLICATION_DIRECTORY,
    )
  }

  const xdgDataHome = env.XDG_DATA_HOME?.trim()
  return xdgDataHome
    ? path.join(path.resolve(xdgDataHome), 'codetether')
    : path.join(home, '.local', 'share', 'codetether')
}

export function resolveCodeTetherDatabasePath(
  options: DataDirectoryOptions = {},
): string {
  const path =
    (options.platform ?? process.platform) === 'win32' ? win32 : posix
  return path.join(
    resolveCodeTetherDataDirectory(options),
    'codetether.sqlite3',
  )
}
