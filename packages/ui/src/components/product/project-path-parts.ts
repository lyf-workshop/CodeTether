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
