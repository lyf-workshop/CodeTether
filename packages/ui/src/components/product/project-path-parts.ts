/** Keep the final folder visible while the leading directories give way. */
export function projectPathParts(
  path: string,
  maxTailCharacters = 28,
): { prefix: string; tail: string } {
  const separatorIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (separatorIndex <= 0 || separatorIndex === path.length - 1)
    return { prefix: '', tail: path }

  const prefix = path.slice(0, separatorIndex)
  const tail = path.slice(separatorIndex)
  const characters = Array.from(tail)
  const limit = Math.max(4, Math.floor(maxTailCharacters))
  if (characters.length <= limit) return { prefix, tail }
  return {
    prefix,
    tail: `${tail[0]}…${characters.slice(-(limit - 2)).join('')}`,
  }
}

/** Fit visible path text without leaving a partial glyph cell before its tail. */
export function fitProjectPathToWidth(
  path: string,
  availableWidth: number,
  measureText: (value: string) => number,
): string {
  const { prefix, tail } = projectPathParts(path)
  const compactPath = prefix + tail
  if (
    !Number.isFinite(availableWidth) ||
    availableWidth <= 0 ||
    measureText(compactPath) <= availableWidth
  )
    return compactPath

  const separatorAndTail = `…${tail}`
  if (prefix && measureText(separatorAndTail) <= availableWidth) {
    const characters = Array.from(prefix)
    let low = 0
    let high = characters.length
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (
        measureText(characters.slice(0, middle).join('') + separatorAndTail) <=
        availableWidth
      )
        low = middle
      else high = middle - 1
    }
    return characters.slice(0, low).join('') + separatorAndTail
  }

  const rawTail = path.slice(prefix.length)
  const separator = rawTail.startsWith('/')
    ? '/'
    : rawTail.startsWith('\\')
      ? '\\'
      : ''
  const marker =
    separator && measureText(separator + '…') <= availableWidth
      ? separator + '…'
      : '…'
  const characters = Array.from(rawTail.slice(separator.length))
  let low = 0
  let high = characters.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (
      measureText(marker + characters.slice(-middle).join('')) <= availableWidth
    )
      low = middle
    else high = middle - 1
  }
  return marker + (low === 0 ? '' : characters.slice(-low).join(''))
}
