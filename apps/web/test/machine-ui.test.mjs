import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  machineConnectionStatusLabel,
  remoteMachineSummaryDescription,
} from '../.tmp/test-dist/components/machines/machine-presentation.js'

const sourceRoot = new URL('../src/', import.meta.url)

test('Machines routes and navigation expose only real Host-backed Machine pages', async () => {
  const [router, sidebar, list, detail, machineProjects] = await Promise.all([
    source('router.tsx'),
    source('components/app-shell/workspace-sidebar.tsx'),
    source('components/machines/machines-page.tsx'),
    source('components/machines/machine-detail-page.tsx'),
    source('components/machines/machine-projects-section.tsx'),
  ])

  assert.match(router, /path: '\/machines'/u)
  assert.match(router, /path: '\/devices'/u)
  assert.match(router, /path: '\/devices\/\$machineId'/u)
  assert.match(
    router,
    /throw redirect\(\{ to: '\/devices', replace: true \}\)/u,
  )
  assert.match(router, /path: '\/machines\/\$machineId'/u)
  assert.match(sidebar, /to="\/devices"/u)
  assert.match(list, /machineListQueryOptions/u)
  assert.match(list, /machineDetailQueryOptions/u)
  assert.match(detail, /machineDetailQueryOptions/u)
  assert.match(detail, /MachineProvidersSection/u)
  assert.match(detail, /MachineProjectsSection/u)
  assert.match(detail, /machineEnvironmentLabel/u)
  assert.match(machineProjects, /项目/u)
  assert.match(detail, /machineConnectionStateLabel/u)
  assert.match(detail, /MachineConnectionSection/u)
  assert.match(machineProjects, /projectLocationForMachine/u)
  assert.match(machineProjects, /ownProjects\.map/u)
  assert.match(detail, /conversations=\{conversations\}/u)
  assert.doesNotMatch(detail, /SSH|remote terminal|CPU chart|GPU chart/u)
})

test('remote computer summary copy follows current and last-known connection truth', () => {
  const online = remoteMachineSummaryDescription('online')
  const offline = remoteMachineSummaryDescription('offline')
  const lastKnown = remoteMachineSummaryDescription('offline', 'last_known')

  assert.match(online, /已连接/u)
  assert.match(online, /可以查看/u)
  assert.match(offline, /当前离线/u)
  assert.doesNotMatch(offline, /已连接/u)
  assert.doesNotMatch(offline, /当前在线/u)
  assert.match(lastKnown, /上次已知状态/u)
  assert.doesNotMatch(lastKnown, /已连接/u)
  assert.equal(machineConnectionStatusLabel('connecting'), '连接中')
})

test('local Machine Detail separates Provider installation from execution health', async () => {
  const [detail, providers] = await Promise.all([
    source('components/machines/machine-detail-page.tsx'),
    source('components/machines/machine-providers-section.tsx'),
  ])
  assert.match(detail, /<MachineProvidersSection/u)
  assert.match(detail, /lifecycles=\{providerLifecycles\}/u)
  assert.match(providers, /详细状态可按需查看/u)
  assert.match(
    sourceSection(
      providers,
      'function MachineProviderCard',
      'function useProviderRefreshFocusRestoration',
    ),
    /providerExecutionHealthPresentation\(/u,
  )
  assert.match(providers, /provider\.executionHealth/u)
  assert.match(providers, /provider\.availabilityLabel/u)
  assert.match(providers, /providerLifecycleForMachine\(/u)
  assert.match(providers, /providerLifecyclePresentation\(/u)
  assert.match(providers, /provider\.available\s*\? '可用'/u)
  assert.match(providers, /health=\{health\}/u)
  assert.match(providers, /查看详细状态/u)
  assert.match(providers, /<details/u)
  assert.match(providers, /health\.description/u)
  assert.match(providers, /health\.observedAt/u)
})

test('Machine Provider lifecycle UI stays safe, status-readable, and refreshes through one bounded action', async () => {
  const [detail, providers, actions] = await Promise.all([
    source('components/machines/machine-detail-page.tsx'),
    source('components/machines/machine-providers-section.tsx'),
    source('runtime/host/machine-actions.ts'),
  ])
  assert.match(detail, /providerLifecycles/u)
  assert.match(providers, /providerLifecycleForMachine/u)
  assert.match(providers, /providerLifecyclePresentation/u)
  for (const label of ['安装状态', '运行时', '后端', '执行状态'])
    assert.ok(providers.includes(`label="${label}"`))
  assert.match(providers, /另发现 .* 个安装；不会自动切换/u)
  assert.doesNotMatch(providers, /aria-label=.*运行时 .*后端 .*执行状态/u)
  assert.match(providers, /role="status"/u)
  assert.match(providers, /aria-busy=\{refreshPending\}/u)
  assert.match(providers, /disabled=\{!canRefresh \|\| refreshPending\}/u)
  assert.match(providers, /local-machine-providers-heading/u)
  assert.match(providers, /refresh-unavailable/u)
  assert.match(providers, /motion-reduce:animate-none/u)
  assert.match(actions, /`providers:\$\{machine\}`/u)
  assert.match(actions, /response\.data\.providerLifecycles/u)
  assert.doesNotMatch(
    providers,
    /selectedInstallationId|sanitizedOrigin|configurationRevision|hasAuthToken/u,
  )
  assert.doesNotMatch(
    providers,
    /installationSelector|setSelectedInstallation|Update Provider|更新 Provider/u,
  )
})

test('Provider installation selection is explicit, lifecycle-gated, and refreshes durable Machine truth', async () => {
  const [detail, providers, selector, actions] = await Promise.all([
    source('components/machines/machine-detail-page.tsx'),
    source('components/machines/machine-providers-section.tsx'),
    source('components/machines/provider-installation-selector.tsx'),
    source('runtime/host/machine-actions.ts'),
  ])

  assert.match(providers, /<ProviderInstallationSelector/u)
  assert.match(detail, /providerSelectionMutation\.mutate\(/u)
  assert.match(
    detail,
    /onSuccess:\s*\(\) => \{\s*void machineQuery\.refetch\(\)/u,
  )
  assert.match(selector, /lifecycle\.installations\.map/u)
  assert.match(selector, /installation\.selected/u)
  assert.match(selector, /installation\.availability === 'available'/u)
  assert.match(selector, /compatibility\?\.freshness === 'current'/u)
  assert.match(selector, /compatibility\.runtimeReadiness === 'ready'/u)
  assert.match(selector, /compatibility\.runtimeReadiness === 'limited'/u)
  assert.match(
    selector,
    /const actionDisabled = selected \|\| !eligible \|\| disabled \|\| pending/u,
  )
  assert.match(
    selector,
    /onClick=\{\(\) => onSelect\(String\(installation\.installationId\)\)\}/u,
  )
  assert.doesNotMatch(selector, /useEffect|useLayoutEffect|onMouseEnter/u)
  assert.match(actions, /\.selectMachineProviderInstallation\(machine,/u)
  assert.match(actions, /queryKey: machineQueryKeys\.detail\(machine\)/u)
  assert.match(actions, /queryKey: machineQueryKeys\.list/u)
})

test('Provider refresh restores keyboard focus after its bounded pending state settles', async () => {
  const [detail, providers] = await Promise.all([
    source('components/machines/machine-detail-page.tsx'),
    source('components/machines/machine-providers-section.tsx'),
  ])
  assert.match(detail, /refreshPending=\{providerRefreshMutation\.isPending\}/u)
  assert.match(
    providers,
    /useProviderRefreshFocusRestoration\(refreshPending\)/u,
  )
  assert.match(providers, /ref=\{providerRefreshButtonRef\}/u)
  assert.match(providers, /rememberProviderRefreshFocus\(\);?\s*onRefresh\(\)/u)
  assert.match(
    providers,
    /restoreFocusRef\.current = document\.activeElement === buttonRef\.current/u,
  )
  assert.match(providers, /if \(refreshPending && restoreFocusRef\.current\)/u)
  assert.match(
    providers,
    /document\.addEventListener\('pointerdown', disarmFocusRestoration, true\)/u,
  )
  assert.match(
    providers,
    /document\.addEventListener\('keydown', disarmFocusRestoration, true\)/u,
  )
  assert.match(
    providers,
    /document\.removeEventListener\(\s*'pointerdown',\s*disarmFocusRestoration,\s*true,?\s*\)/u,
  )
  assert.match(
    providers,
    /document\.removeEventListener\(\s*'keydown',\s*disarmFocusRestoration,\s*true,?\s*\)/u,
  )
  assert.match(
    providers,
    /if \(!wasPending \|\| !restoreFocusRef\.current\) return/u,
  )
  assert.match(providers, /document\.activeElement === document\.body/u)
  assert.match(providers, /buttonRef\.current\?\.focus\(\)/u)
})

test('remote Machine Detail separates direct reachability from the Host-selected execution transport', async () => {
  const [detail, presentation] = await Promise.all([
    source('components/machines/machine-detail-page.tsx'),
    source('components/machines/machine-presentation.ts'),
  ])
  assert.match(detail, /connection\.directState \?\? connection\.state/u)
  assert.match(detail, /label="连接方式"/u)
  assert.match(
    detail,
    /machineExecutionTransportLabel\(connection\?\.executionTransport\)/u,
  )
  assert.match(detail, /label="局域网直连"/u)
  assert.match(
    detail,
    /machineConnectionStateLabel\(\s*connection\.directState \?\? connection\.state,?\s*\)/u,
  )
  assert.match(detail, /label="直连地址"/u)
  assert.match(presentation, /case 'direct':[\s\S]*return '局域网直连'/u)
  assert.match(presentation, /case 'relay':[\s\S]*return '通过 Relay'/u)
  assert.match(presentation, /case 'unavailable':[\s\S]*return '暂时无法连接'/u)
  assert.doesNotMatch(
    detail,
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
  assert.match(dialog, /resolveConversationCreationProvider/u)
  assert.match(providerSelection, /provider\.capabilities\.streaming/u)
  assert.match(providerSelection, /provider\.capabilities\.resume/u)
  assert.match(dialog, /machineId: selection\.machineId/u)
  const fields = await source(
    'components/conversations/new-conversation-fields.tsx',
  )
  assert.match(fields, /aria-label="选择项目"/u)
  assert.match(fields, /project\.location\.rootPath/u)
  assert.doesNotMatch(fields, /选择运行电脑/u)
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

  assert.match(projectDetail, /resolveProjectWorkspaceContext\(/u)
  assert.doesNotMatch(projectDetail, /soleProjectLocation\(project\)/u)
  assert.match(projectDetail, /currentMachineId=\{location\.machineId\}/u)
  assert.match(projectDetail, /to="\/devices\/\$machineId"/u)
  assert.match(projectLocations, /project\.locations\.map/u)
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
  assert.match(controls, /远程执行电脑当前离线/u)
  assert.match(workspace, /to="\/devices\/\$machineId"/u)
  assert.match(workspace, /params=\{\{ machineId: recoveryMachineId \}\}/u)
  assert.match(header, /to="\/devices\/\$machineId"/u)
  assert.match(header, /params=\{\{ machineId: context\.machineId \}\}/u)
  assert.match(header, /\{context\.machineName\}/u)
  assert.match(header, /\{conversation\.machine\}/u)
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
