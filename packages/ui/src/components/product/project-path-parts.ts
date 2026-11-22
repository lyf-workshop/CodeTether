/** Keep the final folder visible while the leading directories give way. */
export function projectPathParts(path: string): {
  prefix: string
  tail: string
} {
  const separatorIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (separatorIndex <= 0 || separatorIndex === path.length - 1)
    return { prefix: '', tail: path }

  return {
    prefix: path.slice(0, separatorIndex),
    tail: path.slice(separatorIndex),
  }
}

/** Give the whole folder name room before spending width on its parent path. */
export function fitProjectPathToWidth(
  path: string,
  availableWidth: number,
  measureText: (value: string) => number,
): string {
  const { prefix, tail } = projectPathParts(path)
  if (
    !Number.isFinite(availableWidth) ||
    availableWidth <= 0 ||
    measureText(path) <= availableWidth
  )
    return path

  const root = pathRoot(path)
  const shortenedParent = `…${tail}`
  const minimumParent = root || (prefix ? '' : undefined)
  if (
    minimumParent !== undefined &&
    measureText(minimumParent + shortenedParent) <= availableWidth
  ) {
    const characters = Array.from(prefix)
    let low = Math.min(characters.length, Array.from(root).length)
    let high = characters.length
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (
        measureText(characters.slice(0, middle).join('') + shortenedParent) <=
        availableWidth
      )
        low = middle
      else high = middle - 1
    }
    const shownParent =
      root.length > prefix.length ? root : characters.slice(0, low).join('')
    return shownParent + shortenedParent
  }

  const folder = prefix ? tail.slice(1) : tail.replace(/^[\\/]/u, '')
  const characters = Array.from(folder)
  let low = 0
  let high = characters.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (measureText(`…${characters.slice(-middle).join('')}`) <= availableWidth)
      low = middle
    else high = middle - 1
  }
  return `…${low === 0 ? '' : characters.slice(-low).join('')}`
}

function pathRoot(path: string): string {
  const drive = /^[A-Za-z]:[\\/]/u.exec(path)
  if (drive) return drive[0]
  const normalized = path.replace(/\\/gu, '/')
  if (normalized.startsWith('//')) {
    const share = /^\/\/[^/]+\/[^/]+\//u.exec(normalized)
    return path.slice(0, share?.[0].length ?? 2)
  }
  return path.startsWith('/') || path.startsWith('\\') ? (path[0] ?? '') : ''
}
