import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as query from '@tanstack/react-query'
import { CodeTetherResponseError } from '@codetether/client'
import { loadUiComponent, loadWebComponent } from './fixtures/render-ui.mjs'

const ui = loadUiComponent('index.ts')
const at = '2026-10-19T00:00:00.000Z'
const local = {
  machineId: 'machine_m1local01',
  displayName: '这台电脑',
  kind: 'local',
  availability: 'available',
  connectionState: 'local',
  capabilities: { projectAccess: true, providerExecution: true },
}
const remote = {
  ...local,
  machineId: 'machine_m1remote01',
  displayName: '配对服务器',
  kind: 'remote',
  connectionState: 'online',
}
const project = {
  projectId: 'proj_m1shared01',
  name: '共享旧项目',
  createdAt: at,
  updatedAt: at,
  locations: [
    {
      projectId: 'proj_m1shared01',
      machineId: local.machineId,
      rootPath: 'D:\\M1 测试',
      availability: 'available',
    },
    {
      projectId: 'proj_m1shared01',
      machineId: remote.machineId,
      rootPath: '/home/test/M1 测试',
      availability: 'available',
    },
  ],
}
const conversation = (machine, archived = false) => ({
  conversationId: 'conv_m1' + machine.machineId,
  projectId: project.projectId,
  machineId: machine.machineId,
  status: 'idle',
  lastActivityAt: at,
  ...(archived ? { archivedAt: at } : {}),
})

function fixture({
  conversations = [],
  connection = 'connected',
  error = false,
  fetching = false,
  unknown = false,
  mutationError,
} = {}) {
  const mutationOptions = [],
    requests = [],
    readOptions = []
  const runtime = {
    removeProjectLocation: async (...args) => {
      requests.push(['remove', ...args])
      return {
        data: { project: { ...project, locations: [project.locations[0]] } },
      }
    },
    unpairMachine: async (...args) => {
      requests.push(['unpair', ...args])
      return {}
    },
    listProjectConversations: async (...args) => {
      requests.push(['list', ...args])
      return { conversations }
    },
  }
  const pass =
    (tag) =>
    ({ children, className, ...props }) =>
      h(
        tag,
        {
          className,
          ...(props['aria-label'] ? { 'aria-label': props['aria-label'] } : {}),
        },
        children,
      )
  const mocks = new Map([
    [
      '@tanstack/react-query',
      {
        ...query,
        useQuery: (options) => {
          readOptions.push(options)
          return {
            data: error || unknown ? undefined : conversations,
            isSuccess: !error,
            isError: error,
            isFetching: fetching,
            isPending: unknown,
            refetch: async () => ({}),
          }
        },
        useMutation: (options) => {
          mutationOptions.push(options)
          return {
            isPending: false,
            isError: mutationError !== undefined,
            error: mutationError,
            mutate() {},
            reset() {},
          }
        },
        useQueryClient: () => ({
          removeQueries() {},
          invalidateQueries: async () => {},
        }),
      },
    ],
    [
      '@codetether/ui',
      {
        ...ui,
        Dialog: ({ open, children }) =>
          open ? h(Fragment, null, children) : null,
        DialogContent: pass('section'),
        DialogHeader: pass('header'),
        DialogFooter: pass('footer'),
        DialogTitle: pass('h2'),
        DialogDescription: pass('p'),
        DialogClose: ({ children }) => children,
      },
    ],
    [
      '@tanstack/react-router',
      {
        useNavigate: () => async () => {},
        Link: ({ children, to, params, search, ...props }) => {
          const pathname = Object.entries(params ?? {}).reduce(
            (value, [key, id]) => value.replace('$' + key, id),
            to,
          )
          const queryString = new URLSearchParams(search ?? {}).toString()
          return h(
            'a',
            {
              ...props,
              href: pathname + (queryString ? '?' + queryString : ''),
            },
            children,
          )
        },
      },
    ],
    [
      '../../runtime/host/host-runtime-hooks',
      {
        useHostRuntime: () => runtime,
        useHostConnectionState: () => connection,
      },
    ],
  ])
  return {
    runtime,
    mutationOptions,
    requests,
    readOptions,
    load: (name) => loadWebComponent(name, mocks),
    render: (Component, props) => renderToStaticMarkup(h(Component, props)),
  }
}

test('device-detail remote card offers exact-device removal despite local archived conversations', () => {
  const f = fixture({ conversations: [conversation(local, true)] })
  const { MachineProjectsSection } = f.load(
    'components/machines/machine-projects-section.tsx',
  )
  const html = f.render(MachineProjectsSection, {
    machine: remote,
    projects: [project],
    showAddCard: false,
    showLocationRemoval: true,
  })
  assert.match(html, /从这台设备移除/u)
  assert.ok(
    html.includes(
      `href="/projects/${project.projectId}?machineId=${remote.machineId}"`,
    ),
  )
  assert.match(html, /<button[^>]*aria-label="从这台设备移除：共享旧项目"/u)
  assert.doesNotMatch(html, /这台设备上的项目还有/u)
  assert.equal(
    f.requests.length,
    0,
    'rendering metadata never mutates or executes',
  )
})

test('the local device never offers remote-location removal', () => {
  const f = fixture({ conversations: [conversation(local)] })
  const { MachineProjectsSection } = f.load(
    'components/machines/machine-projects-section.tsx',
  )
  const html = f.render(MachineProjectsSection, {
    machine: local,
    projects: [project],
    showAddCard: false,
    showLocationRemoval: true,
  })
  assert.doesNotMatch(html, /从这台设备移除/u)
})

for (const archived of [false, true]) {
  test(`exact remote conversations prevent removal, including archived=${archived}`, () => {
    const f = fixture({ conversations: [conversation(remote, archived)] })
    const { MachineProjectsSection } = f.load(
      'components/machines/machine-projects-section.tsx',
    )
    const html = f.render(MachineProjectsSection, {
      machine: remote,
      projects: [project],
      showAddCard: false,
      showLocationRemoval: true,
    })
    assert.match(html, /这台设备上的项目还有 1 个会话/u)
    assert.doesNotMatch(html, /<button[^>]*aria-label="从这台设备移除/u)
    if (archived) assert.match(html, /其中 1 个已归档/u)
  })
}

test('unknown, failed, stale-in-flight and capped reads cannot authorize location removal', () => {
  const cases = [
    { connection: 'reconnecting', message: /恢复连接后/u },
    { error: true, message: /暂时无法确认/u },
    { fetching: true, message: /正在检查/u },
    { unknown: true, message: /正在检查/u },
    {
      conversations: Array.from({ length: 100 }, () => conversation(local)),
      message: /最近 100 个/u,
    },
  ]
  for (const { message, ...options } of cases) {
    const f = fixture(options)
    const { MachineProjectsSection } = f.load(
      'components/machines/machine-projects-section.tsx',
    )
    const html = f.render(MachineProjectsSection, {
      machine: remote,
      projects: [project],
      showAddCard: false,
      showLocationRemoval: true,
    })
    assert.match(html, message)
    assert.doesNotMatch(html, /<button[^>]*aria-label="从这台设备移除/u)
    assert.equal(f.requests.length, 0)
  }
})

test('Host refusal remains visible and exact removal cannot auto-retry or claim success', async () => {
  const refusal = new CodeTetherResponseError(409, {
    protocolVersion: 1,
    code: 'project_location_has_conversations',
    message: 'synthetic private diagnostic, never user copy',
  })
  const f = fixture({ mutationError: refusal })
  f.runtime.removeProjectLocation = async (...args) => {
    f.requests.push(['remove', ...args])
    throw refusal
  }
  const { RemoveProjectLocationDialog } = f.load(
    'components/projects/remove-project-location-dialog.tsx',
  )
  let closed = false,
    refreshed = false
  const html = f.render(RemoveProjectLocationDialog, {
    project,
    machine: remote,
    location: project.locations[1],
    open: true,
    onOpenChange: () => {
      closed = true
    },
    onRemoved: () => {
      refreshed = true
    },
    returnFocus: () => null,
  })
  assert.match(html, /role="alert"/u)
  assert.match(html, /仍有会话，当前不能从这台设备移除/u)
  assert.doesNotMatch(html, /synthetic private diagnostic/u)
  const mutation = f.mutationOptions.at(-1)
  assert.equal(mutation.retry, false)
  await assert.rejects(mutation.mutationFn(), (error) => error === refusal)
  assert.deepEqual(f.requests, [
    ['remove', project.projectId, remote.machineId],
  ])
  assert.equal(closed, false)
  assert.equal(refreshed, false)
})

test('unpair lists an actionable remote location, then becomes confirmable only after Host removal truth', async () => {
  const f = fixture({ conversations: [conversation(local, true)] })
  const { UnpairMachineDialog } = f.load(
    'components/machines/unpair-machine-dialog.tsx',
  )
  const before = f.render(UnpairMachineDialog, {
    machine: remote,
    projects: [project],
    open: true,
    onOpenChange() {},
  })
  assert.match(before, /暂时不能取消配对/u)
  assert.match(before, /从这台设备移除/u)
  assert.doesNotMatch(before, />取消配对<\/button>/u)
  await assert.rejects(f.mutationOptions[0].mutationFn())
  assert.equal(f.requests.length, 0, 'blocked unpair remains fail closed')
  const withoutRemote = { ...project, locations: [project.locations[0]] }
  const after = f.render(UnpairMachineDialog, {
    machine: remote,
    projects: [withoutRemote],
    open: true,
    onOpenChange() {},
  })
  assert.match(after, /取消设备配对/u)
  assert.match(after, />取消配对<\/button>/u)
  assert.doesNotMatch(after, /从这台设备移除/u)
  await f.mutationOptions.at(-1).mutationFn()
  assert.deepEqual(f.requests, [['unpair', remote.machineId]])
})

test('location preflight reads all archived states and confirmation preserves exact removal action and errors', async () => {
  const f = fixture({ conversations: [conversation(local)] })
  const { MachineProjectsSection } = f.load(
    'components/machines/machine-projects-section.tsx',
  )
  f.render(MachineProjectsSection, {
    machine: remote,
    projects: [project],
    showAddCard: false,
    showLocationRemoval: true,
  })
  const read = f.readOptions.find(
    (options) => options.enabled && options.queryKey.at(-1) === 'all',
  )
  assert.ok(
    read,
    'exact removal preflight must use the durable all-conversations index',
  )
  await read.queryFn({ signal: undefined })
  assert.deepEqual(f.requests[0], [
    'list',
    project.projectId,
    { archived: 'all', limit: 100, signal: undefined },
  ])
  const { RemoveProjectLocationDialog } = f.load(
    'components/projects/remove-project-location-dialog.tsx',
  )
  let closed = false,
    refreshed = false
  const html = f.render(RemoveProjectLocationDialog, {
    project,
    machine: remote,
    location: project.locations[1],
    open: true,
    onOpenChange: (value) => {
      closed = !value
    },
    onRemoved: () => {
      refreshed = true
    },
    returnFocus: () => null,
  })
  assert.match(html, /从这台设备移除项目/u)
  assert.match(html, /文件不会被删除/u)
  const remove = f.mutationOptions.at(-1)
  await remove.mutationFn()
  assert.deepEqual(f.requests.at(-1), [
    'remove',
    project.projectId,
    remote.machineId,
  ])
  remove.onSuccess()
  assert.equal(closed, true)
  assert.equal(refreshed, true)
})
