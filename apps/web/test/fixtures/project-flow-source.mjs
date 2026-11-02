import { readFile } from 'node:fs/promises'

const directory = 'components/projects/'
const modules = {
  [directory + 'add-project-dialog.tsx']: [
    'add-project-dialog.tsx',
    'use-add-project-dialog.ts',
    'created-project-step.tsx',
  ],
  [directory + 'previous-conversations-step.tsx']: [
    'previous-conversations-step.tsx',
    'use-previous-conversations.ts',
    'use-previous-conversations-selection.ts',
    'previous-conversations-view.tsx',
    'previous-conversations-presentation.ts',
  ],
}

/** Follow only the real same-directory split modules for existing contracts. */
export async function readProjectFlowSource(relativePath) {
  const paths = modules[relativePath]?.map((name) => directory + name) ?? [
    relativePath,
  ]
  return (
    await Promise.all(
      paths.map((path) =>
        readFile(new URL('../../src/' + path, import.meta.url), 'utf8'),
      ),
    )
  ).join('\n')
}
