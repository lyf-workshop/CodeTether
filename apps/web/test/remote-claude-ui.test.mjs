import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const sourceRoot = new URL('../src/', import.meta.url)

test('Remote Claude creation is executable-gated and exposes only Provider effort controls', async () => {
  const [dialog, selection] = await Promise.all([
    source('components/conversations/new-conversation-dialog.tsx'),
    source('components/conversations/new-conversation-provider-selection.ts'),
  ])

  assert.match(
    selection,
    /provider\.available[\s\S]*provider\.capabilities\.streaming[\s\S]*provider\.capabilities\.resume/u,
  )
  assert.match(dialog, /effectiveConversationProvider/u)
  assert.match(dialog, /provider: effectiveSelectedProvider/u)
  assert.match(dialog, /effectiveSelectedProvider === undefined/u)
  assert.match(dialog, /启动可恢复流式会话的智能体/u)
  assert.match(dialog, /capabilities\.modelSelection/u)
  assert.match(dialog, /capabilities\.reasoningControl/u)
  assert.match(dialog, /selectedProviderPresentation\.reasoningOptions\.map/u)
  assert.match(
    dialog,
    /aria-label=\{`选择\$\{selectedProviderPresentation\.reasoningLabel\}`\}/u,
  )
  assert.doesNotMatch(
    dialog,
    /approvalMode|shellPermission|interruptMode|diffMode/u,
  )
})

test('Remote Claude Detail keeps execution and Inspector controls capability-driven', async () => {
  const [route, inspector, header] = await Promise.all([
    source('components/conversation/conversation-detail-route.tsx'),
    source('components/conversation/inspector-panel.tsx'),
    source('components/conversation/conversation-header.tsx'),
  ])

  assert.match(route, /provider\.provider === conversation\.provider/u)
  assert.match(route, /machine\.capabilities\.providerExecution/u)
  assert.match(route, /machineProvider\.capabilities\.streaming/u)
  assert.match(route, /machineProvider\.capabilities\.resume/u)
  assert.match(inspector, /conversation\.capabilities\.supportsDiff/u)
  assert.match(inspector, /conversation\.capabilities\.supportsShell/u)
  assert.match(inspector, /requestedTab === 'changes'/u)
  assert.match(inspector, /requestedTab === 'terminal'/u)
  assert.doesNotMatch(inspector, /provider === 'claude-code'/u)
  assert.match(header, /capabilities\.supportsInterrupt/u)
  assert.match(header, /capabilities\.supportsDiff/u)
  assert.doesNotMatch(header, /switchProvider|switchMachine/u)
})

test('Remote Claude offline and archived history remain responsive and accessible', async () => {
  const [dialog, detail, workspace, inspector, controls] = await Promise.all([
    source('components/conversations/new-conversation-dialog.tsx'),
    source('components/conversation/conversation-detail-page.tsx'),
    source('components/conversation/conversation-workspace.tsx'),
    source('components/conversation/inspector-panel.tsx'),
    source('components/conversation/conversation-controls.ts'),
  ])

  assert.match(dialog, /max-w-lg overflow-x-hidden/u)
  assert.match(dialog, /aria-label="选择智能体"/u)
  assert.match(dialog, /aria-label="选择机器"/u)
  assert.match(dialog, /onCloseAutoFocus/u)
  assert.match(
    detail,
    /grid-cols-\[var\(--layout-conversation-rail-compact-width\)_minmax\(0,1fr\)\]/u,
  )
  assert.match(detail, /window\.matchMedia\('\(max-width: 1439px\)'\)/u)
  assert.match(
    detail,
    /max-w-\[calc\(100vw-var\(--layout-sidebar-current-width\)\)\]/u,
  )
  assert.match(workspace, /grid-rows-\[auto_minmax\(0,1fr\)_auto_auto\]/u)
  assert.match(workspace, /role="status"/u)
  assert.match(controls, /远程执行机器当前离线/u)
  assert.match(controls, /历史记录仍可查看/u)
  assert.match(workspace, /executionBoundary\.machineName/u)
  assert.match(workspace, /的机器详情/u)
  assert.match(workspace, /aria-label="已归档会话"/u)
  assert.match(workspace, /<ArchivedComposer/u)
  assert.match(inspector, /aria-label="会话检查器"/u)
})

async function source(relativePath) {
  return await readFile(new URL(relativePath, sourceRoot), 'utf8')
}
