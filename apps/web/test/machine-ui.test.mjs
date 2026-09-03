import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const sourceRoot = new URL('../src/', import.meta.url)

test('Machines routes and navigation expose only real Host-backed Machine pages', async () => {
  const [router, sidebar, list, detail, machineProjects] = await Promise.all([
    source('router.tsx'),
    source('components/app-shell/primary-sidebar.tsx'),
    source('components/machines/machines-page.tsx'),
    source('components/machines/machine-detail-page.tsx'),
    source('components/machines/machine-projects-section.tsx'),
  ])

  assert.match(router, /path: '\/machines'/u)
  assert.match(router, /path: '\/machines\/\$machineId'/u)
  assert.match(sidebar, /to: '\/machines'/u)
  assert.match(list, /machineListQueryOptions/u)
  assert.match(list, /machineDetailQueryOptions/u)
  assert.match(detail, /machineDetailQueryOptions/u)
  assert.match(detail, /providerPresentationsForMachine/u)
  assert.match(detail, /MachineProjectsSection/u)
  assert.match(machineProjects, /projectLocationForMachine/u)
  assert.match(machineProjects, /projects\.map/u)
  assert.match(detail, /conversations\.map/u)
  assert.doesNotMatch(detail, /SSH|remote terminal|CPU chart|GPU chart/u)
})

test('local Machine Detail separates Provider installation from execution health', async () => {
  const detail = await source('components/machines/machine-detail-page.tsx')
  const localDetail = sourceSection(
    detail,
    'const { providers, projects, conversations }',
    'function RemoteMachineDetail',
  )

  assert.match(localDetail, /安装检测与最近的执行健康结果彼此独立/u)
  assert.match(localDetail, /providerExecutionHealthPresentation\(/u)
  assert.match(localDetail, /provider\.executionHealth/u)
  assert.match(localDetail, /provider\.availabilityLabel/u)
  assert.match(localDetail, /安装状态/u)
  assert.match(localDetail, /执行状态/u)
  assert.match(localDetail, /health\.stateLabel/u)
  assert.match(localDetail, /health\.freshnessLabel/u)
  assert.match(localDetail, /health\.description/u)
  assert.match(localDetail, /health\.observedAt/u)
})

test('New Conversation binds Machine identity and machine-scoped Provider truth', async () => {
  const [dialog, providerSelection, actions] = await Promise.all([
    source('components/conversations/new-conversation-dialog.tsx'),
    source('components/conversations/new-conversation-provider-selection.ts'),
    source('runtime/host/new-conversation-actions.ts'),
  ])

  assert.match(dialog, /machineListQueryOptions/u)
  assert.match(dialog, /machineDetailQueryOptions/u)
  assert.match(dialog, /providerPresentationsForMachine/u)
  assert.match(dialog, /effectiveSelectedProvider/u)
  assert.match(providerSelection, /provider\.capabilities\.streaming/u)
  assert.match(providerSelection, /provider\.capabilities\.resume/u)
  assert.match(dialog, /machineId: selection\.machineId/u)
  assert.match(dialog, /aria-label="选择机器"/u)
  assert.match(actions, /current\.machineId === machine/u)
  assert.match(actions, /response\.data\.conversation\.machineId !== machine/u)
  assert.match(
    actions,
    /response\.data\.conversation\.provider !== options\.provider/u,
  )
})

test('Project and Conversation surfaces resolve Machine display without a switch', async () => {
  const [
    projectDetail,
    projectLocations,
    conversationRoute,
    adapter,
    header,
    inspector,
    workspace,
    controls,
  ] = await Promise.all([
    source('components/projects/project-detail-page.tsx'),
    source('components/projects/project-locations-section.tsx'),
    source('components/conversation/conversation-detail-route.tsx'),
    source('components/conversation/live-conversation-adapter.ts'),
    source('components/conversation/conversation-header.tsx'),
    source('components/conversation/inspector-panel.tsx'),
    source('components/conversation/conversation-workspace.tsx'),
    source('components/conversation/conversation-controls.ts'),
  ])

  assert.match(projectDetail, /<ProjectLocationsSection/u)
  assert.doesNotMatch(projectDetail, /soleProjectLocation\(project\)/u)
  assert.match(projectLocations, /project\.locations\.map/u)
  assert.match(projectLocations, /to="\/machines\/\$machineId"/u)
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
  assert.match(adapter, /providerPresentationForMachine/u)
  assert.match(conversationRoute, /machineProvider\.capabilities\.streaming/u)
  assert.match(conversationRoute, /machineProvider\.capabilities\.resume/u)
  assert.match(conversationRoute, /executionBoundary/u)
  assert.match(controls, /远程执行机器当前离线/u)
  assert.match(workspace, /to="\/machines\/\$machineId"/u)
  assert.match(header, /name=\{conversation\.machine\}/u)
  assert.match(inspector, /conversation\.machine/u)
  assert.match(inspector, /conversation\.capabilities\.supportsDiff/u)
  assert.match(inspector, /conversation\.capabilities\.supportsShell/u)
  assert.match(inspector, /requestedTab === 'terminal'/u)
  assert.doesNotMatch(header, /switchMachine|onMachineChange/u)
})

async function source(path) {
  return await readFile(new URL(path, sourceRoot), 'utf8')
}

function sourceSection(value, startMarker, endMarker) {
  const start = value.indexOf(startMarker)
  const end = value.indexOf(endMarker, start)
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`)
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`)
  return value.slice(start, end)
}
