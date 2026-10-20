import { readFile } from 'node:fs/promises'

/** The same sidebar source contract now spans its existing component boundaries. */
export async function readWorkspaceSidebarSource() {
  const sources = await Promise.all(
    [
      'workspace-sidebar',
      'workspace-device-section',
      'workspace-project-section',
    ].map((name) =>
      readFile(
        new URL(
          '../../src/components/app-shell/' + name + '.tsx',
          import.meta.url,
        ),
        'utf8',
      ),
    ),
  )
  return sources.join('\n')
}
