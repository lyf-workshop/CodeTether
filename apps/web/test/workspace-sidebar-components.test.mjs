import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('workspace sidebar components stay within the approved 400-line boundary', async () => {
  for (const name of [
    'workspace-sidebar.tsx',
    'workspace-device-section.tsx',
    'workspace-project-section.tsx',
  ]) {
    const source = await readFile(
      new URL('../src/components/app-shell/' + name, import.meta.url),
      'utf8',
    )
    assert.ok(source.trimEnd().split(/\r?\n/u).length <= 400, name)
  }
})
