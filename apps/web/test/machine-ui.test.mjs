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
    'const providerPresentations = providerPresentationsForMachine(providers)',
    'function RemoteMachineDetail',
  )

  assert.match(
    localDetail,
    /安装、运行时兼容性、推理后端与最近执行健康彼此独立/u,
  )
  assert.match(localDetail, /providerExecutionHealthPresentation\(/u)
  assert.match(localDetail, /provider\.executionHealth/u)
  assert.match(localDetail, /provider\.availabilityLabel/u)
  assert.match(localDetail, /providerLifecycleForMachine\(/u)
  assert.match(localDetail, /providerLifecyclePresentation\(/u)
  assert.match(localDetail, /安装状态/u)
  assert.match(localDetail, /运行时/u)
  assert.match(localDetail, /后端/u)
  assert.match(localDetail, /执行状态/u)
  assert.match(localDetail, /health\.stateLabel/u)
  assert.match(localDetail, /health\.freshnessLabel/u)
  assert.match(localDetail, /health=\{health\}/u)
  assert.match(detail, /health\.description/u)
  assert.match(detail, /health\.observedAt/u)
})

test('Machine Provider lifecycle UI stays safe, status-readable, and refreshes through one bounded action', async () => {
  const [detail, actions] = await Promise.all([
    source('components/machines/machine-detail-page.tsx'),
    source('runtime/host/machine-actions.ts'),
  ])

  assert.match(detail, /providerLifecycles/u)
  assert.match(detail, /providerLifecycleForMachine/u)
  assert.match(detail, /providerLifecyclePresentation/u)
  assert.match(detail, /label="安装状态"/u)
  assert.match(detail, /label="运行时"/u)
  assert.match(detail, /label="后端"/u)
  assert.match(detail, /label="执行状态"/u)
  assert.match(detail, /另发现 .* 个安装；不会自动切换/u)
  assert.match(detail, /aria-label=.*运行时 .*后端 .*执行状态/u)
  assert.match(detail, /role="status"/u)
  assert.match(detail, /aria-busy=\{refreshPending\}/u)
  assert.match(detail, /disabled=\{!canRefresh \|\| refreshPending\}/u)
  assert.match(detail, /aria-labelledby="local-machine-providers-heading"/u)
  assert.match(detail, /local-provider-refresh-unavailable/u)
  assert.match(detail, /motion-reduce:animate-none/u)
  assert.match(actions, /`providers:\$\{machine\}`/u)
  assert.match(actions, /response\.data\.providerLifecycles/u)
  assert.doesNotMatch(
    detail,
    /selectedInstallationId|installationId|sanitizedOrigin|configurationRevision|hasAuthToken/u,
  )
  assert.doesNotMatch(
    detail,
    /installationSelector|setSelectedInstallation|Update Provider|更新 Provider/u,
  )
})

test('remote Machine Detail separates direct reachability from the Host-selected execution transport', async () => {
  const detail = await source('components/machines/machine-detail-page.tsx')
  const remoteDetail = sourceSection(
    detail,
    'function RemoteMachineDetail',
    'function MachineNotFound',
  )

  assert.match(remoteDetail, /connection\.directState \?\? connection\.state/u)
  assert.match(remoteDetail, /label="当前执行路径"/u)
  assert.match(
    remoteDetail,
    /value=\{executionTransportLabel\(connection\.executionTransport\)\}/u,
  )
  assert.match(remoteDetail, /label="局域网直连"/u)
  assert.match(remoteDetail, /machineConnectionStateLabel\(directState\)/u)
  assert.match(remoteDetail, /label="直连地址"/u)
  assert.match(detail, /case 'direct':[\s\S]*return '局域网直连'/u)
  assert.match(detail, /case 'relay':[\s\S]*return 'Internet Relay'/u)
  assert.match(detail, /case 'unavailable':[\s\S]*return '当前不可用'/u)
  assert.doesNotMatch(
    remoteDetail,
    /transport(?:Mode)?Select|setExecutionTransport|onTransportChange/u,
  )
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
  assert.match(conversationRoute, /detail\.providerLifecycle/u)
  assert.match(
    conversationRoute,
    /providerLifecycleSupportsConversationExecution/u,
  )
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
