export function formatProjectTime(timestamp: string): string {
  const value = new Date(timestamp)
  if (Number.isNaN(value.getTime())) return '时间未知'

  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value)
}

const POSIX_ROOT_PATTERN = /^\/+$/u
const WINDOWS_DRIVE_ROOT_PATTERN = /^[A-Za-z]:[\\/]+$/u
const UNC_SHARE_ROOT_PATTERN = /^[\\/]{2}[^\\/]+[\\/][^\\/]+[\\/]*$/u

function isProjectRootPath(rootPath: string): boolean {
  return (
    POSIX_ROOT_PATTERN.test(rootPath) ||
    WINDOWS_DRIVE_ROOT_PATTERN.test(rootPath) ||
    UNC_SHARE_ROOT_PATTERN.test(rootPath)
  )
}

/** Compact display only; Host-owned canonical paths are never rewritten. */
export function projectFolderName(rootPath: string): string {
  if (isProjectRootPath(rootPath)) return rootPath

  const normalized = rootPath.replace(/[\\/]+$/u, '')
  return normalized.split(/[\\/]/u).at(-1) || rootPath
}

/** Keeps the volume/root and nearest context without letting long paths dominate. */
export function compactProjectPath(rootPath: string): string {
  if (isProjectRootPath(rootPath)) return rootPath

  const normalized = rootPath.replace(/[\\/]+$/u, '')
  const separator = normalized.includes('\\') ? '\\' : '/'
  const uncRoot = /^([\\/]{2}[^\\/]+[\\/][^\\/]+)[\\/](.+)$/u.exec(normalized)

  if (uncRoot) {
    const root = uncRoot[1]
    const remainder = uncRoot[2]
    if (!root || !remainder) return normalized

    const contentParts = remainder.split(/[\\/]/u).filter(Boolean)

    if (contentParts.length <= 3) return normalized

    const tail = contentParts.slice(-2).join(separator)
    return `${root}${separator}…${separator}${tail}`
  }

  const windowsVolume = /^([A-Za-z]:)[\\/]/u.exec(normalized)?.[1]
  const parts = normalized.split(/[\\/]/u).filter(Boolean)
  const contentParts = windowsVolume ? parts.slice(1) : parts

  if (contentParts.length <= 3) return normalized

  const tail = contentParts.slice(-2).join(separator)
  if (windowsVolume) return `${windowsVolume}${separator}…${separator}${tail}`
  if (normalized.startsWith('/')) return `${separator}…${separator}${tail}`
  return `…${separator}${tail}`
}
