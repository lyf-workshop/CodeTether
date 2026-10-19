import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const sourceRoot = new URL('../src/', import.meta.url)

test('Remote Claude creation is executable-gated and exposes only Provider effort controls', async () => {
  const [dialog, selection, fields, creationSelection] = await Promise.all([
    source('components/conversations/new-conversation-dialog.tsx'),
    source('components/conversations/new-conversation-provider-selection.ts'),
    source('components/conversations/new-conversation-fields.tsx'),
    source('components/conversations/new-conversation-selection.ts'),
  ])

  assert.match(
    selection,
    /provider\.available[\s\S]*provider\.capabilities\.streaming[\s\S]*provider\.capabilities\.resume/u,
  )
  assert.match(dialog, /resolveConversationCreationProvider/u)
  assert.match(dialog, /provider: presentation\.provider/u)
  assert.match(dialog, /selectedProvider === undefined/u)
  assert.match(dialog, /启动可恢复流式会话的 AI\s*工具/u)
  assert.doesNotMatch(dialog + fields, /modelSelection|选择模型|selectedModel/u)
  assert.match(
    creationSelection,
    /providerLifecycleSupportsConversationExecution/u,
  )
  assert.match(creationSelection, /selectedInstallationId/u)
  assert.match(dialog, /capabilities\.reasoningControl/u)
  assert.match(fields, /presentation\.reasoningOptions\.map/u)
  assert.match(fields, /presentation\.reasoningLabel/u)
  assert.doesNotMatch(
    dialog,
    /approvalMode|shellPermission|interruptMode|diffMode/u,
  )
})

test('Remote Claude Detail keeps execution and Inspector controls capability-driven', async () => {
  const [route, inspector, chromeActions] = await Promise.all([
    source('components/conversation/conversation-detail-route.tsx'),
    source('components/conversation/inspector-panel.tsx'),
    source('components/conversation/conversation-chrome-actions.tsx'),
  ])

  assert.match(route, /provider\.provider === conversation\.provider/u)
  assert.match(route, /machine\.capabilities\.providerExecution/u)
  assert.match(route, /machineProvider\.capabilities\.streaming/u)
  assert.match(route, /machineProvider\.capabilities\.resume/u)
  assert.match(inspector, /conversation\.capabilities\.supportsDiff/u)
  assert.match(inspector, /conversation\.capabilities\.supportsShell/u)
  assert.match(inspector, /conversation\.capabilities\.supportsToolOutput/u)
  assert.match(inspector, /requestedTab === 'changes'/u)
  assert.match(inspector, /requestedTab === 'terminal'/u)
  assert.doesNotMatch(inspector, /provider === 'claude-code'/u)
  assert.match(chromeActions, /capabilities\.supportsInterrupt/u)
  assert.doesNotMatch(chromeActions, /capabilities\.supportsDiff/u)
  assert.doesNotMatch(chromeActions, /switchProvider|switchMachine/u)
})

test('Remote Claude offline and archived history remain responsive and accessible', async () => {
  const [dialog, detail, workspace, inspector, controls, fields] =
    await Promise.all([
      source('components/conversations/new-conversation-dialog.tsx'),
      source('components/conversation/conversation-detail-page.tsx'),
      source('components/conversation/conversation-workspace.tsx'),
      source('components/conversation/inspector-panel.tsx'),
      source('components/conversation/conversation-controls.ts'),
      source('components/conversations/new-conversation-fields.tsx'),
    ])

  assert.match(dialog, /ct-new-conversation-dialog overflow-x-hidden/u)
  assert.match(fields, /<fieldset/u)
  assert.match(fields, /type="radio"/u)
  assert.match(fields, /aria-label="选择项目"/u)
  assert.match(fields, /project\.location\.rootPath/u)
  assert.match(dialog, /onCloseAutoFocus/u)
  assert.match(detail, /grid-cols-\[minmax\(0,1fr\)\]/u)
  assert.doesNotMatch(detail, /ConversationRail|layout-conversation-rail/u)
  assert.match(
    detail,
    /const INSPECTOR_DIALOG_MEDIA_QUERY = '\(max-width: 1439px\)'/u,
  )
  assert.match(detail, /window\.matchMedia\(INSPECTOR_DIALOG_MEDIA_QUERY\)/u)
  assert.match(
    detail,
    /max-w-\[calc\(100vw-var\(--layout-sidebar-current-width\)\)\]/u,
  )
  assert.match(workspace, /grid-rows-\[auto_minmax\(0,1fr\)_auto_auto\]/u)
  assert.match(workspace, /role="status"/u)
  assert.match(controls, /远程执行电脑当前离线/u)
  assert.match(controls, /历史记录仍可查看/u)
  assert.match(workspace, /executionBoundary\.machineName/u)
  assert.match(workspace, /的电脑详情/u)
  assert.match(workspace, /aria-label="已归档会话"/u)
  assert.match(workspace, /<ArchivedComposer/u)
  assert.match(inspector, /aria-label="会话检查器"/u)
})

async function source(relativePath) {
  return await readFile(new URL(relativePath, sourceRoot), 'utf8')
}
