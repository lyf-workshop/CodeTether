import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'

export function resolveNodeDataDirectory(
  options: {
    platform?: NodeJS.Platform
    home?: string
    exists?: (path: string) => boolean
  } = {},
): string {
  const platform = options.platform ?? process.platform
  const path = platform === 'win32' ? win32 : posix
  const home = options.home ?? homedir()
  if (!path.isAbsolute(home)) throw new Error('Node home must be absolute')
  const legacy = path.join(home, '.codetether-node')
  if (platform === 'win32') return legacy // Preserve the accepted CLI path.
  const current =
    platform === 'darwin'
      ? path.join(
          home,
          'Library',
          'Application Support',
          'CodeTether',
          'Node',
          'state',
        )
      : path.join(home, '.local', 'share', 'codetether-node', 'state')
  const exists = options.exists ?? existsSync
  if (exists(legacy)) {
    if (exists(current))
      throw new Error(
        'Multiple Node state directories exist; select the exact state with --data-dir',
      )
    return legacy
  }
  return current
}
