import type { ToolReadModel } from '../../runtime/host/conversation-projection.js'

/** Lists explicit completed read targets and file-shaped results of search Tools. */
export function projectViewedFiles(
  tools: readonly ToolReadModel[],
  projectRoot: string | undefined,
): readonly string[] {
  const files = new Set<string>()
  for (const tool of tools) {
    if (tool.status !== 'completed') continue
    if (tool.kind === 'read') {
      const path = /^Read ([^\r\n]+)$/iu.exec(tool.command ?? '')?.[1]
      if (path !== undefined) add(path)
    }
    if (
      tool.kind === 'search' &&
      /^(?:Glob|Grep)(?: |$)/u.test(tool.command ?? '')
    ) {
      for (const line of (tool.output ?? tool.outputSummary ?? '').split(
        /\r?\n/u,
      )) {
        // A result may be a filename alone or an exact path with a line marker.
        const match = /^(.*?):\d+(?::|$)/u.exec(line)
        const result = (match?.[1] ?? line).trim()
        if (match === null && /\s/u.test(result) && !/[/\\]/u.test(result))
          continue
        if (/[^/\\\s]+\.[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(result.trim()))
          add(result)
      }
    }
  }
  return [...files]

  function add(value: string) {
    const path = normalizeViewedPath(value, projectRoot)
    if (path !== undefined) files.add(path)
  }
}

function normalizeViewedPath(
  value: string,
  projectRoot: string | undefined,
): string | undefined {
  let path = value.trim().replace(/\\/gu, '/')
  if (/^(?:[a-z]:|\/)/iu.test(path)) {
    const root = projectRoot?.replace(/\\/gu, '/').replace(/\/+$/u, '')
    if (root === undefined) return undefined
    const windows = /^(?:[a-z]:|\/\/)/iu.test(root)
    const matches = windows
      ? path.toLowerCase().startsWith(root.toLowerCase() + '/')
      : path.startsWith(root + '/')
    if (!matches) return undefined
    path = path.slice(root.length + 1)
  }
  path = path.replace(/^\.\//u, '')
  if (
    path.length === 0 ||
    path.length > 512 ||
    /[:*?"<>|]/u.test(path) ||
    [...path].some((character) => character.charCodeAt(0) < 32) ||
    path.split('/').some((part) => part === '' || part === '.' || part === '..')
  )
    return undefined
  return path
}
