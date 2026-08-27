import { posix, win32 } from 'node:path'

export interface NormalizedProjectRoot {
  readonly rootPath: string
  readonly rootPathKey: string
}

/**
 * Validates a path that has already crossed the WorkspacePolicy realpath
 * boundary. This deliberately performs no filesystem access: durable history
 * must remain readable when a previously authorized Project is unavailable.
 */
export function normalizeTrustedProjectRoot(
  value: string,
  platform: NodeJS.Platform = process.platform,
): NormalizedProjectRoot {
  if (value.length === 0 || value.length > 4096 || value.trim() !== value) {
    throw new Error(
      'Trusted Project root path must contain 1-4096 unpadded characters',
    )
  }
  if (value.includes('\0')) {
    throw new Error('Trusted Project root path must not contain NUL')
  }

  const path = platform === 'win32' ? win32 : posix
  if (!path.isAbsolute(value)) {
    throw new Error('Trusted Project root path must be absolute')
  }
  const normalized = path.normalize(value)
  if (normalized !== value) {
    throw new Error('Trusted Project root path must already be normalized')
  }

  return {
    rootPath: normalized,
    rootPathKey: platform === 'win32' ? normalized.toLowerCase() : normalized,
  }
}
