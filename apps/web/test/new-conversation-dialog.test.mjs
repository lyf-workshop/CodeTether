import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = (relative) =>
  readFile(new URL('../src/' + relative, import.meta.url), 'utf8')

test('global entry preserves a known project ID even before project list or detail is available', async () => {
  const [shell, root] = await Promise.all([
    source('components/app-shell/app-shell.tsx'),
    source('components/app-shell/root-layout.tsx'),
  ])
  assert.match(root, /currentProjectId=\{projectId\}/u)
  assert.match(shell, /currentProjectId: requestedProjectId/u)
  assert.match(
    shell,
    /currentConversation\?\.projectId \?\?\s*requestedProjectId \?\?\s*currentProject\?\.projectId/u,
  )
  assert.match(shell, /currentProjectId=\{currentProjectId\}/u)
  assert.match(shell, /project\?\.projectId \?\? currentProjectId/u)
})

test('create uses only exact chosen identifiers and descriptor reasoning, without first input or model', async () => {
  const dialog = await source(
    'components/conversations/new-conversation-dialog.tsx',
  )
  assert.match(dialog, /projectId: project\.projectId/u)
  assert.match(dialog, /machineId: project\.machineId/u)
  assert.match(dialog, /provider: presentation\.provider/u)
  assert.match(dialog, /capabilities\.reasoningControl/u)
  assert.match(dialog, /retry: false/u)
  assert.match(dialog, /to: '\/c\/\$conversationId'/u)
  assert.match(dialog, /search: \{ focus: 'composer' \}/u)
  assert.doesNotMatch(
    dialog,
    /selectedModel|model:|textarea|sendMessage|submitTurn|setQueryData/u,
  )
})

test('synchronous submit guard closes the pre-render double-click window and releases only on settlement', async () => {
  const dialog = await source(
    'components/conversations/new-conversation-dialog.tsx',
  )
  const submit = dialog.slice(
    dialog.indexOf('function handleSubmit'),
    dialog.indexOf('return (', dialog.indexOf('function handleSubmit')),
  )
  assert.match(submit, /if \([\s\S]*submitRef\.current/u)
  assert.ok(
    submit.indexOf('submitRef.current = true') <
      submit.indexOf('createMutation.mutate'),
  )
  assert.match(dialog, /onSettled: \(\) => \{\s*submitRef\.current = false/u)
  assert.match(
    dialog,
    /!nextOpen && \(createMutation\.isPending \|\| submitRef\.current\)/u,
  )
  assert.match(dialog, /不会自动重试/u)
})

test('global and keyboard launches preselect identifiers while project plus fixes the project/device pair', async () => {
  const [shell, sidebar] = await Promise.all([
    source('components/app-shell/app-shell.tsx'),
    source('components/app-shell/workspace-sidebar.tsx'),
  ])
  assert.match(shell, /useState<NewConversationLaunchContext>/u)
  assert.doesNotMatch(shell, /useState<\s*ProjectRecord \| undefined/u)
  assert.match(shell, /event\.key\.toLowerCase\(\) === 'n'/u)
  assert.match(shell, /globalDialog !== null/u)
  assert.match(shell, /role="dialog"/u)
  assert.match(shell, /removeEventListener\('keydown', handleShortcut\)/u)
  assert.match(sidebar, /activeMachineId,\s*'preselected'/u)
  assert.match(sidebar, /machine\.machineId,\s*'fixed'/u)
  assert.match(sidebar, /data-slot="workspace-new-conversation"/u)
})

test('baseline action identity, inflight dedup and response validation remain runtime authorities', async () => {
  const actions = await source('runtime/host/new-conversation-actions.ts')
  assert.match(actions, /actionId: this\.#createActionId\(\)/u)
  assert.match(actions, /current\.promise/u)
  for (const field of ['projectId', 'machineId', 'provider'])
    assert.ok(actions.includes('response.data.conversation.' + field + ' !=='))
  assert.doesNotMatch(actions, /setQueryData|autoRetry|setInterval/u)
})
