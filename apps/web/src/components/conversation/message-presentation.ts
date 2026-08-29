const WINDOWS_ROOT = /^[A-Za-z]:[\\/]/u
const TRAILING_PROSE_PUNCTUATION = /[.,;!?，。；！？]+$/u

/**
 * Shortens paths that can be proven to start inside the current Project root.
 * The original durable message is never changed. Ambiguous paths are retained.
 */
export function presentProjectPaths(
  source: string,
  projectRootPath: string | undefined,
): string {
  const root = projectRootPath?.trim().replace(/[\\/]+$/u, '')
  if (!root) return source

  const rootPattern = root
    .split(/[\\/]+/u)
    .map(escapeRegExp)
    .join('[\\\\/]')
  const flags = WINDOWS_ROOT.test(root) ? 'giu' : 'gu'
  const quotedPattern = new RegExp(
    `(["'\x60])${rootPattern}[\\\\/]([^\\r\\n]*?)\\1`,
    flags,
  )
  const quoted = source.replace(
    quotedPattern,
    (match: string, quote: string, relative: string) => {
      const presented = safeRelativePath(relative)
      return presented === undefined ? match : `${quote}${presented}${quote}`
    },
  )
  const unquotedPattern = new RegExp(
    `${rootPattern}[\\\\/]([^\\s<>"'\x60]+)`,
    flags,
  )

  return quoted.replace(
    unquotedPattern,
    (
      match: string,
      relativeWithPunctuation: string,
      offset: number,
      wholeSource: string,
    ) => {
      const followingLine = wholeSource
        .slice(offset + match.length)
        .split(/\r?\n/u, 1)[0]
      if (/^\s+[^\s]*[\\/]/u.test(followingLine ?? '')) return match
      const punctuation =
        TRAILING_PROSE_PUNCTUATION.exec(relativeWithPunctuation)?.[0] ?? ''
      const relative =
        punctuation.length === 0
          ? relativeWithPunctuation
          : relativeWithPunctuation.slice(0, -punctuation.length)
      const presented = safeRelativePath(relative)
      return presented === undefined ? match : `${presented}${punctuation}`
    },
  )
}

function safeRelativePath(value: string): string | undefined {
  const normalized = value.replace(/\\/gu, '/').replace(/^\/+|\/+$/gu, '')
  if (normalized.length === 0) return undefined
  const segments = normalized.split('/')
  if (segments.some((segment) => segment.length === 0 || segment === '..')) {
    return undefined
  }
  return normalized
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
