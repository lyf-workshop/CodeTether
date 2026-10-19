import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

const webDirectory = resolve(import.meta.dirname, '..')
const sourceDirectory = resolve(webDirectory, 'src')

test('one Add Project dialog owns the real Desktop picker and editable Browser path entry', async () => {
  const source = await readSource('components/projects/add-project-dialog.tsx')
  const fields = await readSource('components/projects/add-project-fields.tsx')
  assert.match(source, /directoryPicker = nativeCapabilities\.directoryPicker/u)
  assert.match(
    source,
    /directoryPicker\.available && target\.machine\?\.kind === 'local'/u,
  )
  assert.match(source, /<AddProjectFields/u)
  assert.match(fields, /<label\s+htmlFor="add-project-path"/u)
  assert.match(fields, /id="add-project-directory-picker"/u)
  assert.match(fields, /id="add-project-path"/u)
  assert.match(fields, /选择文件夹/u)
  assert.match(fields, /使用系统文件夹选择器，或输入这台电脑上的完整路径。/u)
  assert.doesNotMatch(fields, /Windows 文件夹选择器/u)
  assert.match(source, /createSelectedDirectoryPresentation/u)
  assert.match(fields, /title=\{path \|\| undefined\}/u)
})

test('picker and registration have independent synchronous bounded in-flight guards', async () => {
  const source = await readSource('components/projects/add-project-dialog.tsx')
  const model = await readSource('components/projects/add-project-model.ts')
  assert.match(source, /pickerState.*'idle'.*'picking'/u)
  assert.match(source, /pickerInFlightRef/u)
  assert.match(source, /registrationInFlightRef/u)
  assert.match(
    source,
    /pickerState === 'picking' \|\| createMutation\.isPending/u,
  )
  assert.match(
    source,
    /if \(\s*busy \|\| registrationInFlightRef\.current \|\| pickerInFlightRef\.current !== null\s*\)\s*return/u,
  )
  assert.match(
    source,
    /registrationInFlightRef\.current = true[\s\S]*await createMutation\.mutateAsync/u,
  )
  assert.match(source, /retry: false/u)
  assert.match(
    model,
    /return await actions\.createProject\(input\.path, input\.name\)/u,
  )
  assert.match(
    model,
    /return await actions\.createRemoteProject\(machine\.machineId/u,
  )
})

test('picker cancellation and selection restore focus while preserving the dialog and path draft', async () => {
  const source = await readSource('components/projects/add-project-dialog.tsx')
  assert.match(source, /runProjectDirectoryPicker\(directoryPicker/u)
  assert.match(
    source,
    /requestAnimationFrame\(\(\) => pickerButtonRef\.current\?\.focus\(\)\)/u,
  )
  assert.match(
    source,
    /if \(outcome\.kind === 'selected'\) setPath\(outcome\.path\)/u,
  )
  assert.match(source, /if \(outcome\.kind === 'error'\)/u)
  const closeGuard = source.match(
    /function handleOpenChange\(nextOpen: boolean\) \{(.+?)setDialogOpen/u,
  )?.[1]
  assert.ok(closeGuard)
  for (const guard of [
    '!nextOpen',
    'busy',
    'registrationInFlightRef.current',
    'pickerInFlightRef.current !== null',
    'createdProject !== undefined',
  ])
    assert.ok(closeGuard.includes(guard), guard)
  assert.match(closeGuard, /return/u)
  assert.match(source, /无法打开文件夹选择器，请重试或直接输入路径。/u)
})

test('long Windows paths remain in bounded editable controls with full-path affordances', async () => {
  const source = await readSource('components/projects/add-project-dialog.tsx')
  const fields = await readSource('components/projects/add-project-fields.tsx')
  assert.match(
    source,
    /className="ct-add-project-dialog max-w-lg overflow-x-hidden"/u,
  )
  assert.match(source, /<form className="min-w-0"/u)
  assert.match(fields, /className="flex min-w-0 gap-2 max-sm:flex-col"/u)
  assert.match(fields, /className="min-w-0 flex-1 font-mono text-sm"/u)
  assert.match(fields, /title=\{path \|\| undefined\}/u)
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
    /onAddProject=\{\(machineId\) => \{[\s\S]*setReturnToConversation\(true\)[\s\S]*setGlobalDialog\('add-project'\)/u,
  )
  assert.match(shell, /<AddProjectDialog/u)
  assert.match(
    shell,
    /onProjectCreated=\{async \(project, _created, machineId\) => \{[\s\S]*setNewConversationContext\([\s\S]*kind: 'preselected'[\s\S]*projectId: project\.projectId/u,
  )
  assert.match(
    newConversation,
    /onAddProject\?: \(machineId\?: MachineId\) => void/u,
  )
  assert.match(
    newConversation,
    /skipCloseFocusRestore\.current = true[\s\S]*onAddProject\(selectedMachineId \?\? context\?\.machineId\)/u,
  )
  assert.doesNotMatch(shell, /useState<\s*ProjectRecord \| undefined/u)
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

test('the second step is exact-location metadata only and duplicate responses skip it', async () => {
  const source = await readSource('components/projects/add-project-dialog.tsx')
  assert.match(
    source,
    /nextProjectCreationStep\(\s*response\.data\.created, deferPreviousConversations,?\s*\)/u,
  )
  assert.match(
    source,
    /projectId: project\.projectId, created: response\.data\.created, machineId: values\.machineId/u,
  )
  assert.match(source, /projectId=\{context\.projectId\}/u)
  assert.match(source, /machineId=\{context\.machineId\}/u)
  assert.match(source, /upsertProjectCache\(queryClient, project\)/u)
  assert.doesNotMatch(
    source,
    /useState<ProjectRecord|runtime\.listMachines\(|registerProjectLocation\(|startTurn\(|createConversation\(/u,
  )
})

async function readSource(relativePath) {
  return (
    await readFile(resolve(sourceDirectory, relativePath), 'utf8')
  ).replace(/\s+/gu, ' ')
}
