import { readFile } from 'node:fs/promises'

/** Preserve the existing organization safety assertions across direct modules. */
export async function conversationOrganizationSource() {
  const names = [
    'conversation-organization-controls.tsx',
    'conversation-settings-dialog.tsx',
    'archive-conversation-dialog.tsx',
    'conversation-organization-shared.ts',
  ]
  return (
    await Promise.all(
      names.map((name) =>
        readFile(
          new URL(
            '../../src/components/conversations/' + name,
            import.meta.url,
          ),
          'utf8',
        ),
      ),
    )
  ).join('\n')
}
