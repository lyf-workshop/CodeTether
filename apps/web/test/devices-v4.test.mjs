import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  deviceProjectState,
  machineCanAddProject,
  projectConversationMetrics,
  unpairMachinePreflight,
} from '../.tmp/test-dist/components/machines/device-project-model.js'

const localId = 'machine_v4_local'
const remoteId = 'machine_v4_remote'
const timestamp = '2026-10-18T08:00:00.000Z'

test('device cards hide unknown counts and bind every conversation to its immutable location', () => {
  assert.equal(projectConversationMetrics(undefined, localId), undefined)
  const conversations = [
    conversation('one', localId),
    conversation('two', remoteId, 'running'),
  ]
  assert.deepEqual(projectConversationMetrics(conversations, localId), {
    countLabel: '1 个会话',
    runningCount: 0,
    lastActivityAt: timestamp,
    capped: false,
  })
  assert.equal(
    projectConversationMetrics(conversations, remoteId).runningCount,
    1,
  )
})

test('bounded project indexes never claim an exact total after 100 records', () => {
  const single = Array.from({ length: 100 }, (_, index) =>
    conversation(String(index), localId),
  )
  assert.equal(
    projectConversationMetrics(single, localId).countLabel,
    '100+ 个会话',
  )
  const multiple = single.map((entry, index) => ({
    ...entry,
    machineId: index < 30 ? localId : remoteId,
  }))
  assert.equal(
    projectConversationMetrics(multiple, localId, true).countLabel,
    '已加载 30 个会话',
  )
  assert.equal(
    projectConversationMetrics(multiple, remoteId, true).countLabel,
    '已加载 70 个会话',
  )
})

test('connection, execution and folder access remain independent project gates', () => {
  const machine = {
    kind: 'remote',
    connectionState: 'online',
    availability: 'available',
    capabilities: { projectAccess: true, providerExecution: true },
  }
  const location = { availability: 'available' }
  assert.equal(machineCanAddProject(machine), true)
  assert.equal(deviceProjectState(machine, location).label, undefined)
  assert.equal(
    deviceProjectState({ ...machine, connectionState: 'offline' }, location)
      .label,
    '设备离线',
  )
  assert.equal(
    deviceProjectState(
      { ...machine, connectionState: 'authentication_failed' },
      location,
    ).label,
    '身份验证失败',
  )
  assert.equal(
    deviceProjectState(
      { ...machine, connectionState: 'recovery_required' },
      location,
    ).label,
    '需要更新地址',
  )
  assert.equal(
    deviceProjectState(
      {
        ...machine,
        capabilities: { ...machine.capabilities, providerExecution: false },
      },
      location,
    ).label,
    '不能运行',
  )
  assert.equal(
    deviceProjectState(machine, { availability: 'unavailable' }).label,
    '无法访问',
  )
  assert.equal(
    machineCanAddProject({
      ...machine,
      capabilities: { ...machine.capabilities, providerExecution: false },
    }),
    false,
  )
})

test('unpair preflight reports registered projects and never grants authority locally', () => {
  const projects = [
    {
      projectId: 'proj_one',
      name: '界面',
      locations: [{ machineId: remoteId, rootPath: '/work/ui' }],
    },
  ]
  assert.deepEqual(unpairMachinePreflight(projects, remoteId), {
    blocked: true,
    projects: [{ projectId: 'proj_one', name: '界面', rootPath: '/work/ui' }],
  })
  assert.deepEqual(unpairMachinePreflight(projects, localId), {
    blocked: false,
    projects: [],
  })
})

test('device pages preserve machine queries, bounded indexes, provider controls and Relay actions', async () => {
  const source = async (path) =>
    (
      await readFile(new URL(`../src/${path}`, import.meta.url), 'utf8')
    ).replaceAll('\r\n', '\n')
  const [list, detail, projects, providers, unpair] = await Promise.all([
    source('components/machines/machines-page.tsx'),
    source('components/machines/machine-detail-page.tsx'),
    source('components/machines/machine-projects-section.tsx'),
    source('components/machines/machine-providers-section.tsx'),
    source('components/machines/unpair-machine-dialog.tsx'),
  ])
  assert.match(list, /machineListQueryOptions/u)
  assert.match(list, /machineDetailQueryOptions/u)
  assert.match(projects, /allProjectConversationsQueryOptions/u)
  assert.match(projects, /projectLocationForMachine/u)
  assert.doesNotMatch(
    list + detail + projects,
    /AddProjectLocationDialog|RemoveProjectLocationDialog|getSnapshot/u,
  )
  assert.doesNotMatch(list + projects, /refreshMachineProviders/u)
  assert.match(detail, /conversations=\{conversations\}/u)
  assert.match(detail, /MachineRelaySection/u)
  assert.match(providers, /ProviderInstallationSelector/u)
  assert.match(providers, /label="安装状态"/u)
  assert.match(providers, /label="运行时"/u)
  assert.match(providers, /label="后端"/u)
  assert.match(providers, /label="执行状态"/u)
  assert.match(unpair, /unpairMachinePreflight/u)
  assert.match(unpair, /知道了/u)
  assert.match(unpair, /machineErrorMessage\(unpairMutation.error, 'unpair'\)/u)
})

test('project metrics fetch only after interest in that exact card, preventing page-load fanout', async () => {
  const source = await readFile(
    new URL(
      '../src/components/machines/machine-projects-section.tsx',
      import.meta.url,
    ),
    'utf8',
  )
  assert.match(
    source,
    /metricsRequested, setMetricsRequested\] = useState\(false\)/u,
  )
  assert.match(
    source,
    /enabled: connectionState === 'connected' && metricsRequested/u,
  )
  assert.match(
    source,
    /onPointerEnter=\{\(\) => setMetricsRequested\(true\)\}/u,
  )
  assert.match(
    source,
    /onFocusCapture=\{\(\) => setMetricsRequested\(true\)\}/u,
  )
})

test('provider cards wrap identities and diagnostic values in narrow layouts', async () => {
  const source = await readFile(
    new URL(
      '../src/components/machines/machine-providers-section.tsx',
      import.meta.url,
    ),
    'utf8',
  )
  assert.match(source, /flex min-w-0 flex-wrap items-start gap-3/u)
  assert.match(source, /min-w-0 flex-1 basis-32/u)
  assert.match(source, /flex min-w-0 flex-wrap items-baseline/u)
  assert.match(source, /min-w-0 break-words text-right font-medium/u)
})

test('project card grid uses an ordered token breakpoint for the approved wide layout', async () => {
  const [source, tokens] = await Promise.all([
    readFile(
      new URL(
        '../src/components/machines/machine-projects-section.tsx',
        import.meta.url,
      ),
      'utf8',
    ),
    readFile(
      new URL('../../../packages/ui/src/styles/globals.css', import.meta.url),
      'utf8',
    ),
  ])
  assert.match(source, /sm:grid-cols-2 desktop:grid-cols-3/u)
  assert.match(tokens, /--breakpoint-desktop: 73\.75rem/u)
})

function conversation(id, machineId, status = 'idle') {
  return {
    conversationId: `conv_${id}`,
    projectId: 'proj_one',
    machineId,
    provider: 'codex',
    title: '界面',
    status,
    lastActivityAt: timestamp,
  }
}
