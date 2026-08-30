import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const sourceRoot = new URL('../src/', import.meta.url)

test('Machines routes and navigation expose only real Host-backed Machine pages', async () => {
  const [router, sidebar, list, detail] = await Promise.all([
    source('router.tsx'),
    source('components/app-shell/primary-sidebar.tsx'),
    source('components/machines/machines-page.tsx'),
    source('components/machines/machine-detail-page.tsx'),
  ])

  assert.match(router, /path: '\/machines'/u)
  assert.match(router, /path: '\/machines\/\$machineId'/u)
  assert.match(sidebar, /to: '\/machines'/u)
  assert.match(list, /machineListQueryOptions/u)
  assert.match(list, /machineDetailQueryOptions/u)
  assert.match(detail, /machineDetailQueryOptions/u)
  assert.match(detail, /providerPresentationsForMachine/u)
  assert.match(detail, /projectLocationForMachine/u)
  assert.match(detail, /conversations\.map/u)
  assert.doesNotMatch(detail, /SSH|remote terminal|CPU chart|GPU chart/u)
})

test('New Conversation binds Machine identity and machine-scoped Provider truth', async () => {
  const [dialog, actions] = await Promise.all([
    source('components/conversations/new-conversation-dialog.tsx'),
    source('runtime/host/new-conversation-actions.ts'),
  ])

  assert.match(dialog, /machineListQueryOptions/u)
  assert.match(dialog, /machineDetailQueryOptions/u)
  assert.match(dialog, /providerPresentationsForMachine/u)
  assert.match(dialog, /machineId: selection\.machineId/u)
  assert.match(dialog, /aria-label="选择机器"/u)
  assert.match(actions, /current\.machineId === machine/u)
  assert.match(actions, /response\.data\.conversation\.machineId !== machine/u)
})

test('Project and Conversation surfaces resolve Machine display without a switch', async () => {
  const [projectDetail, conversationRoute, adapter, header, inspector] =
    await Promise.all([
      source('components/projects/project-detail-page.tsx'),
      source('components/conversation/conversation-detail-route.tsx'),
      source('components/conversation/live-conversation-adapter.ts'),
      source('components/conversation/conversation-header.tsx'),
      source('components/conversation/inspector-panel.tsx'),
    ])

  assert.match(projectDetail, /label="运行位置"/u)
  assert.match(projectDetail, /soleProjectLocation\(project\)/u)
  assert.match(
    conversationRoute,
    /machineDetailQueryOptions\(runtime, machineId\)/u,
  )
  assert.match(
    conversationRoute,
    /machineName=\{machineQuery\.data\?\.machine\.displayName/u,
  )
  assert.doesNotMatch(adapter, /machine: '本地电脑'/u)
  assert.match(adapter, /machine: machineName/u)
  assert.match(header, /name=\{conversation\.machine\}/u)
  assert.match(inspector, /conversation\.machine/u)
  assert.doesNotMatch(header, /switchMachine|onMachineChange/u)
})

async function source(path) {
  return await readFile(new URL(path, sourceRoot), 'utf8')
}
