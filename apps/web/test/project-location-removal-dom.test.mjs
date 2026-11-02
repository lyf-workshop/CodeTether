import assert from 'node:assert/strict'
import test from 'node:test'
import * as reactQuery from '@tanstack/react-query'
import { createDom, h } from './fixtures/dom.mjs'
import { loadWebComponent } from './fixtures/render-ui.mjs'

const timestamp = '2026-10-20T00:00:00.000Z'
const remoteId = 'machine_r2remote01'
const localId = 'machine_r2local01'
const projectId = 'proj_r2shared01'
const { QueryClient, QueryClientProvider } = reactQuery

test('real device DOM removes an exact remote location through confirmation, then rechecks Host truth before allowing unpair', async () => {
  const dom = await createDom()
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  })
  const originalFrame = Object.getOwnPropertyDescriptor(
    globalThis,
    'requestAnimationFrame',
  )
  globalThis.requestAnimationFrame = (callback) => {
    callback()
    return 0
  }
  const project = {
    projectId,
    name: '测试旧项目',
    createdAt: timestamp,
    updatedAt: timestamp,
    locations: [
      {
        projectId,
        machineId: localId,
        rootPath: 'D:\\fixture-only\\local',
        availability: 'available',
      },
      {
        projectId,
        machineId: remoteId,
        rootPath: '/fixture-only/remote',
        availability: 'available',
      },
    ],
  }
  const remote = {
    machineId: remoteId,
    displayName: '配对测试设备',
    kind: 'remote',
    isLocal: false,
    platform: 'linux',
    architecture: 'arm64',
    availability: 'available',
    connectionState: 'online',
    capabilities: { projectAccess: true, providerExecution: true },
  }
  const originalDetail = {
    machine: remote,
    projects: [project],
    conversations: [],
    providers: [],
    connection: {
      state: 'online',
      directState: 'online',
      executionTransport: 'direct',
    },
  }
  const updatedProject = { ...project, locations: [project.locations[0]] }
  const updatedDetail = { ...originalDetail, projects: [] }
  const removalResponse = Promise.withResolvers()
  const machineResponse = Promise.withResolvers()
  const reads = [],
    removals = [],
    unpairs = [],
    navigations = []
  let waitingForMachine = false
  const client = {
    removeProjectLocation: async (...args) => {
      removals.push(args)
      return await removalResponse.promise
    },
  }
  const { ProjectActions } = loadWebComponent('runtime/host/project-actions.ts')
  const actions = new ProjectActions(
    client,
    () => 'action_r2remove01',
    queryClient,
  )
  const runtime = {
    getConnectionState: () => 'connected',
    getMachine: async (id) => {
      reads.push(['machine', id])
      return waitingForMachine ? await machineResponse.promise : originalDetail
    },
    listProjectConversations: async (id, options) => {
      reads.push(['conversations', id, options])
      return {
        conversations: [
          {
            projectId,
            machineId: localId,
            conversationId: 'conv_r2archived01',
            provider: 'codex',
            status: 'idle',
            archivedAt: timestamp,
            title: '本机已归档会话',
            createdAt: timestamp,
            updatedAt: timestamp,
            lastActivityAt: timestamp,
          },
        ],
      }
    },
    removeProjectLocation: (id, machineId) =>
      actions.removeProjectLocation(id, machineId),
    unpairMachine: async (id) => {
      unpairs.push(id)
      return {}
    },
  }
  const dependencies = new Map([
    ['@tanstack/react-query', reactQuery],
    [
      '../../runtime/host/host-runtime-hooks',
      {
        useHostRuntime: () => runtime,
        useHostConnectionState: () => 'connected',
      },
    ],
    [
      '@tanstack/react-router',
      {
        useParams: () => ({ machineId: remoteId }),
        useNavigate: () => async (target) => {
          navigations.push(target)
        },
        Link: ({ to, params, search, children, ...props }) => {
          const query = new URLSearchParams(search ?? {}).toString()
          return h(
            'a',
            {
              ...props,
              href:
                Object.entries(params ?? {}).reduce(
                  (path, [key, value]) => path.replace('$' + key, value),
                  to,
                ) + (query ? '?' + query : ''),
            },
            children,
          )
        },
      },
    ],
    ['../projects/add-project-dialog', { AddProjectDialog: () => null }],
    ['./machine-providers-section', { MachineProvidersSection: () => null }],
    [
      './machine-conversations-section',
      { MachineConversationsSection: () => null },
    ],
    ['./machine-relay-section', { MachineRelaySection: () => null }],
    [
      './update-machine-address-dialog',
      { UpdateMachineAddressDialog: () => null },
    ],
  ])
  const { MachineDetailRoute } = loadWebComponent(
    'components/machines/machine-detail-page.tsx',
    dependencies,
  )
  const buttons = (scope, label) =>
    [...scope.querySelectorAll('button')].filter(
      (button) => button.textContent.trim() === label,
    )
  const dialog = (title) =>
    [...document.querySelectorAll('[role="dialog"]')].find(
      (element) => element.querySelector('h2')?.textContent === title,
    )
  try {
    await dom.render(
      h(QueryClientProvider, { client: queryClient }, h(MachineDetailRoute)),
    )
    await dom.until(() => buttons(dom.container, '取消配对').length === 1)
    await dom.perform(() => buttons(dom.container, '取消配对')[0].click())
    await dom.until(() => dialog('暂时不能取消配对') !== undefined)
    const blocked = dialog('暂时不能取消配对')
    await dom.until(() => buttons(blocked, '从这台设备移除').length === 1)
    assert.equal(buttons(blocked, '取消配对').length, 0)
    assert.equal(unpairs.length, 0)
    await dom.perform(() => buttons(blocked, '从这台设备移除')[0].click())
    await dom.until(() => dialog('从这台设备移除项目') !== undefined)
    const confirmation = dialog('从这台设备移除项目')
    assert.match(confirmation.textContent, /文件不会被删除/u)
    assert.match(confirmation.textContent, /不会自动取消.*配对/u)
    assert.equal(
      removals.length,
      0,
      'opening confirmation must not remove anything',
    )
    await dom.perform(() => buttons(confirmation, '从这台设备移除')[0].click())
    await dom.until(() => removals.length === 1)
    assert.deepEqual(removals, [
      [projectId, remoteId, { actionId: 'action_r2remove01' }],
    ])
    await dom.until(() => buttons(confirmation, '正在移除…').length === 1)
    assert.equal(buttons(confirmation, '正在移除…')[0].disabled, true)
    assert.equal(unpairs.length, 0)
    const machineReadsBefore = reads.filter(
      ([kind]) => kind === 'machine',
    ).length
    waitingForMachine = true
    await dom.perform(() =>
      removalResponse.resolve({ data: { project: updatedProject } }),
    )
    await dom.until(
      () =>
        reads.filter(([kind]) => kind === 'machine').length >
        machineReadsBefore,
    )
    await dom.until(() => dialog('从这台设备移除项目') === undefined)
    assert.ok(
      dialog('暂时不能取消配对'),
      'a successful removal alone is not new Machine-detail truth',
    )
    assert.equal(buttons(dialog('暂时不能取消配对'), '取消配对').length, 0)
    assert.equal(unpairs.length, 0)
    await dom.perform(() => machineResponse.resolve(updatedDetail))
    await dom.until(() => dialog('取消设备配对') !== undefined)
    const ready = dialog('取消设备配对')
    assert.equal(buttons(ready, '取消配对').length, 1)
    assert.equal(buttons(ready, '取消配对')[0].disabled, false)
    assert.equal(buttons(ready, '从这台设备移除').length, 0)
    assert.deepEqual(
      queryClient.getQueryData(['host', 'projects', 'detail', projectId]),
      updatedProject,
    )
    assert.deepEqual(
      queryClient.getQueryData(['host', 'machines', 'detail', remoteId]),
      updatedDetail,
    )
    const conversationRead = reads.find(([kind]) => kind === 'conversations')
    assert.equal(conversationRead[2].archived, 'all')
    assert.equal(conversationRead[2].limit, 100)
    assert.ok(
      reads
        .filter(([kind]) => kind === 'machine')
        .every(([, id]) => id === remoteId),
    )
    await dom.perform(() => buttons(ready, '取消配对')[0].click())
    await dom.until(() => navigations.length === 1)
    assert.deepEqual(unpairs, [remoteId])
    assert.deepEqual(navigations, [{ to: '/devices' }])
    assert.equal(
      removals.length,
      1,
      'location removal must not replay while Machine metadata refreshes',
    )
  } finally {
    await dom.render(null)
    await dom.perform(() => new Promise((resolve) => setTimeout(resolve, 0)))
    await dom.close()
    queryClient.clear()
    if (originalFrame)
      Object.defineProperty(globalThis, 'requestAnimationFrame', originalFrame)
    else delete globalThis.requestAnimationFrame
  }
})
