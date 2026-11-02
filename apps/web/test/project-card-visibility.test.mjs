import assert from 'node:assert/strict'
import test from 'node:test'
import * as reactQuery from '@tanstack/react-query'
import { createDom, h } from './fixtures/dom.mjs'
import { loadWebComponent } from './fixtures/render-ui.mjs'

const { QueryClient, QueryClientProvider } = reactQuery
const machine = {
  machineId: 'machine_r2visible01',
  displayName: '指标测试设备',
  kind: 'local',
  connectionState: 'local',
  availability: 'available',
  capabilities: { projectAccess: true, providerExecution: true },
}
const project = (suffix) => ({
  projectId: `proj_r2visible${suffix}`,
  name: `指标项目${suffix}`,
  locations: [
    {
      machineId: machine.machineId,
      rootPath: `D:\\fixture-only\\${suffix}`,
      availability: 'available',
    },
  ],
})

async function fixture({
  observer = true,
  connection = 'connected',
  cached = false,
} = {}) {
  const dom = await createDom()
  const original = Object.getOwnPropertyDescriptor(
    globalThis,
    'IntersectionObserver',
  )
  const observers = []
  class Observer {
    disconnected = false
    constructor(callback) {
      this.callback = callback
      observers.push(this)
    }
    observe(target) {
      this.target = target
    }
    disconnect() {
      this.disconnected = true
    }
    emit(isIntersecting) {
      this.callback([{ target: this.target, isIntersecting }], this)
    }
  }
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    configurable: true,
    writable: true,
    value: observer ? Observer : undefined,
  })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })
  const projects = [project('01'), project('02')]
  const reads = []
  const state = { connection }
  const conversations = (projectId) => [
    {
      projectId,
      conversationId: `conv_${projectId}`,
      machineId: machine.machineId,
      status: 'running',
      lastActivityAt: '2026-10-20T00:00:00.000Z',
    },
    {
      projectId,
      conversationId: `conv_foreign_${projectId}`,
      machineId: 'machine_r2other01',
      status: 'running',
      lastActivityAt: '2026-10-19T00:00:00.000Z',
    },
  ]
  const runtime = {
    listProjectConversations: async (projectId, options) => {
      reads.push([projectId, options.archived, options.limit])
      return { conversations: conversations(projectId) }
    },
    getConversation: async () =>
      assert.fail('card metrics must not hydrate detail'),
    refreshMachineProviders: async () =>
      assert.fail('card metrics must not probe Providers'),
    startTurn: async () => assert.fail('card metrics must not run inference'),
  }
  if (cached) {
    for (const { projectId } of projects) {
      queryClient.setQueryData(
        ['host', 'project-conversations', projectId, 'all'],
        conversations(projectId),
      )
    }
  }
  const { MachineProjectsSection } = loadWebComponent(
    'components/machines/machine-projects-section.tsx',
    new Map([
      ['@tanstack/react-query', reactQuery],
      [
        '@tanstack/react-router',
        {
          Link: ({ to, params, search, children, ...props }) =>
            h(
              'a',
              {
                ...props,
                href: `${to.replace('$projectId', params.projectId)}?${new URLSearchParams(search)}`,
              },
              children,
            ),
        },
      ],
      [
        '../../runtime/host/host-runtime-hooks',
        {
          useHostRuntime: () => runtime,
          useHostConnectionState: () => state.connection,
        },
      ],
    ]),
  )
  const render = () =>
    dom.render(
      h(
        QueryClientProvider,
        { client: queryClient },
        h(MachineProjectsSection, { machine, projects, showAddCard: false }),
      ),
    )
  return {
    dom,
    observers,
    reads,
    projects,
    state,
    render,
    async close() {
      await dom.close()
      queryClient.clear()
      if (original)
        Object.defineProperty(globalThis, 'IntersectionObserver', original)
      else delete globalThis.IntersectionObserver
    },
  }
}

test('offscreen cards do not read metrics; intersection loads only that exact bounded index', async () => {
  const f = await fixture()
  try {
    await f.render()
    assert.equal(f.observers.length, 2)
    const cards = f.dom.container.querySelectorAll('[data-slot="project-card"]')
    assert.equal(cards.length, 2)
    assert.notEqual(f.observers[0].target, f.observers[1].target)
    for (const [index, observer] of f.observers.entries()) {
      assert.equal(observer.target.isConnected, true)
      assert.equal(observer.target.contains(cards[index]), true)
      assert.equal(observer.target.contains(cards[1 - index]), false)
    }
    assert.deepEqual(f.reads, [])
    assert.doesNotMatch(f.dom.container.textContent, /0 个会话|1 个会话/u)
    await f.dom.perform(() => f.observers[0].emit(false))
    assert.deepEqual(f.reads, [])
    await f.dom.perform(() => f.observers[0].emit(true))
    await f.dom.until(() => f.dom.container.textContent.includes('1 个会话'))
    assert.deepEqual(f.reads, [[f.projects[0].projectId, 'all', 100]])
    assert.equal(
      f.dom.container.querySelectorAll('[data-slot="project-card"]').length,
      2,
    )
    assert.equal(f.dom.container.textContent.match(/1 个会话/gu).length, 1)
    assert.match(f.dom.container.textContent, /1 个进行中/u)
    assert.equal(f.observers[0].disconnected, true)
    await f.dom.perform(() => {
      f.observers[0].emit(false)
      f.observers[0].emit(true)
    })
    assert.equal(f.reads.length, 1)
    await f.dom.perform(() => f.observers[1].emit(true))
    await f.dom.until(
      () => f.dom.container.textContent.match(/1 个会话/gu)?.length === 2,
    )
    assert.deepEqual(
      f.reads,
      f.projects.map(({ projectId }) => [projectId, 'all', 100]),
    )
  } finally {
    await f.close()
  }
})

test('unsupported IntersectionObserver loads metrics directly without requiring hover', async () => {
  const f = await fixture({ observer: false })
  try {
    await f.render()
    await f.dom.until(
      () => f.dom.container.textContent.match(/1 个会话/gu)?.length === 2,
    )
    assert.deepEqual(
      f.reads,
      f.projects.map(({ projectId }) => [projectId, 'all', 100]),
    )
    assert.equal(f.observers.length, 0)
  } finally {
    await f.close()
  }
})

test('intersection does not bypass the Host connection gate and reconnect uses the same index', async () => {
  const f = await fixture({ connection: 'disconnected' })
  try {
    await f.render()
    assert.equal(f.observers.length, 2)
    await f.dom.perform(() => f.observers[0].emit(true))
    assert.deepEqual(f.reads, [])
    f.state.connection = 'connected'
    await f.render()
    await f.dom.until(() => f.reads.length === 1)
    assert.deepEqual(f.reads, [[f.projects[0].projectId, 'all', 100]])
  } finally {
    await f.close()
  }
})

test('offscreen cards can display known Query metrics without starting a read', async () => {
  const f = await fixture({ cached: true })
  try {
    await f.render()
    assert.equal(f.observers.length, 2)
    assert.equal(f.dom.container.textContent.match(/1 个会话/gu).length, 2)
    assert.deepEqual(f.reads, [])
  } finally {
    await f.close()
  }
})

test('unmount disconnects observers for cards that never entered the viewport', async () => {
  const f = await fixture()
  try {
    await f.render()
    assert.equal(f.observers.length, 2)
  } finally {
    await f.close()
  }
  assert.ok(f.observers.every((observer) => observer.disconnected))
  assert.deepEqual(f.reads, [])
})
