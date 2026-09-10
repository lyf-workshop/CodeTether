import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

const webDirectory = resolve(import.meta.dirname, '..')
const sourceDirectory = resolve(webDirectory, 'src')

test('one Add Project dialog owns Desktop picker and Browser path fallback', async () => {
  const source = await readSource('components/projects/add-project-dialog.tsx')

  assert.match(source, /directoryPicker = nativeCapabilities\.directoryPicker/u)
  assert.match(source, /directoryPicker\.available \? \(/u)
  assert.match(
    source,
    /directoryPicker\.available \? \(\s*<span className="text-sm font-medium text-text-primary">/u,
  )
  assert.match(source, /<label\s+htmlFor="add-project-path"/u)
  assert.doesNotMatch(source, /htmlFor=\{\s*directoryPicker\.available/u)
  assert.match(source, /id="add-project-directory-picker"/u)
  assert.match(source, /id="add-project-path"/u)
  assert.match(source, /\u9009\u62e9\u6587\u4ef6\u5939|选择文件夹/u)
  assert.match(source, /使用系统文件夹选择器选择一个本地工作区。/u)
  assert.doesNotMatch(source, /Windows 文件夹选择器/u)
  assert.match(source, /createSelectedDirectoryPresentation/u)
  assert.match(source, /title=\{selectedDirectory\.path\}/u)
})

test('picker and registration have independent bounded in-flight states', async () => {
  const source = await readSource('components/projects/add-project-dialog.tsx')

  assert.match(source, /pickerState.*'idle'.*'picking'/u)
  assert.match(source, /pickerInFlightRef/u)
  assert.match(
    source,
    /pickerState === 'picking' \|\| createMutation\.isPending/u,
  )
  assert.match(source, /if \(busy\) return/u)
  assert.match(source, /runtime\.createProject\(projectPath, projectName\)/u)
})

test('picker cancel and selection restore focus without closing the Add Project dialog', async () => {
  const source = await readSource('components/projects/add-project-dialog.tsx')

  assert.match(source, /runProjectDirectoryPicker\(directoryPicker/u)
  assert.match(
    source,
    /if \(outcome\.kind === 'selected'\) setPath\(outcome\.path\)/u,
  )
  assert.match(source, /if \(outcome\.kind === 'error'\)/u)
  assert.match(
    source,
    /if \(!nextOpen && \(busy \|\| createdProject !== undefined\)\) return/u,
  )
  assert.match(source, /无法打开文件夹选择器，请重试。/u)
})

test('selected long Windows paths stay bounded inside the Add Project dialog', async () => {
  const source = await readSource('components/projects/add-project-dialog.tsx')

  assert.match(source, /className="max-w-lg overflow-x-hidden"/u)
  assert.match(source, /<form className="min-w-0"/u)
  assert.match(
    source,
    /className="flex w-full min-w-0 max-w-full items-center gap-3 overflow-hidden/u,
  )
  assert.match(source, /title=\{selectedDirectory\.path\}/u)
})

test('Projects empty state adapts its single real Add Project flow', async () => {
  const source = await readSource('components/projects/projects-page.tsx')

  assert.equal((source.match(/<AddProjectDialog/gu) ?? []).length, 2)
  assert.match(source, /projectAddActionLabel\(/u)
  assert.match(source, /nativeCapabilities\.directoryPicker\.available/u)
})

test('TopBar no-project flow swaps sibling dialogs and returns to New Conversation', async () => {
  const shell = await readSource('components/app-shell/app-shell.tsx')
  const newConversation = await readSource(
    'components/conversations/new-conversation-dialog.tsx',
  )

  assert.match(shell, /'add-project' \| 'new-conversation' \| null/u)
  assert.match(
    shell,
    /onAddProject=\{\(\) => setGlobalDialog\('add-project'\)\}/u,
  )
  assert.match(shell, /<AddProjectDialog/u)
  assert.match(
    shell,
    /onProjectCreated=\{\(\) => setGlobalDialog\('new-conversation'\)\}/u,
  )
  assert.match(newConversation, /onAddProject\?: \(\) => void/u)
  assert.match(newConversation, /onClick=\{onAddProject\}/u)
  assert.doesNotMatch(newConversation, /to="\/projects"/u)
})

test('only the isolated native adapter references a Tauri JavaScript package', async () => {
  const files = (
    await readdir(sourceDirectory, { recursive: true, withFileTypes: true })
  ).filter(
    (entry) =>
      entry.isFile() &&
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')),
  )
  const references = []

  for (const entry of files) {
    const path = resolve(entry.parentPath, entry.name)
    const source = await readFile(path, 'utf8')
    if (source.includes('@tauri-apps/')) references.push(path)
  }

  assert.deepEqual(references, [
    resolve(sourceDirectory, 'runtime/native/native-capabilities.ts'),
  ])
})

async function readSource(relativePath) {
  return await readFile(resolve(sourceDirectory, relativePath), 'utf8')
}
