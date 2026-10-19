import assert from 'node:assert/strict'
import test from 'node:test'
import { QueryClient } from '@tanstack/react-query'
import {
  commandPaletteGroups,
  paletteActionEntries,
} from '../.tmp/test-dist/components/app-shell/command-palette-model.js'
import {
  commandPaletteCacheSubscription,
  readCommandPaletteCache,
} from '../.tmp/test-dist/components/app-shell/command-palette-cache.js'

const localId = 'machine_local01',
  remoteId = 'machine_remote01',
  projectId = 'project_shared01'
const stamp = '2026-08-27T12:00:00.000Z'
const snapshot = (records = []) => ({
  machines: [machine(remoteId), machine(localId)],
  projects: [project()],
  conversations: [{ records, observedAt: 10 }],
})
const entries = (groups) => groups.flatMap((group) => group.entries)

test('palette matches only loaded titles, never metadata paths or transcript content', () => {
  const data = snapshot([
    conversation('conversation_one01', {
      title: 'Change Login',
      transcript: 'private phrase',
    }),
  ])
  assert.equal(entries(commandPaletteGroups(data, 'private phrase')).length, 0)
  assert.equal(entries(commandPaletteGroups(data, '/secret/path')).length, 0)
  assert.equal(
    commandPaletteGroups(data, ' LOGIN ')[0].entries[0].label,
    'Change Login',
  )
})

test('legacy project locations remain separate exact navigation targets', () => {
  const projects = commandPaletteGroups(snapshot(), 'Shared')[0].entries
  assert.equal(projects.length, 2)
  assert.notEqual(projects[0].id, projects[1].id)
  assert.deepEqual(
    projects.map((entry) => entry.target.machineId),
    [remoteId, localId],
  )
  assert.ok(projects.every((entry) => entry.target.projectId === projectId))
})

test('cached conversations deduplicate by identity and use the freshest observed index', () => {
  const old = conversation('conversation_one01', { title: 'Old title' })
  const fresh = { ...old, title: 'Accepted new title' }
  const data = {
    ...snapshot(),
    conversations: [
      { records: [fresh], observedAt: 20 },
      { records: [old], observedAt: 10 },
    ],
  }
  const rows = commandPaletteGroups(data, '')[0].entries
  assert.equal(rows.length, 1)
  assert.equal(rows[0].label, 'Accepted new title')
})

test('recent titles are stably ordered, limited to four by default and six for title search', () => {
  const records = Array.from({ length: 8 }, (_, index) =>
    conversation('conversation_' + index, { title: 'Title ' + index }),
  )
  const recent = commandPaletteGroups(snapshot(records.toReversed()), '')[0]
    .entries
  assert.deepEqual(
    recent.map((entry) => entry.label),
    ['Title 0', 'Title 1', 'Title 2', 'Title 3'],
  )
  assert.equal(
    commandPaletteGroups(snapshot(records), 'Title')[0].entries.length,
    6,
  )
})

test('missing cached context is labelled unknown and never substitutes a local device', () => {
  const data = {
    machines: [],
    projects: [],
    conversations: [
      { records: [conversation('conversation_one01')], observedAt: 1 },
    ],
  }
  const row = commandPaletteGroups(data, '')[0].entries[0]
  assert.equal(row.description, '设备未知 · 项目未知')
  assert.deepEqual(row.target, {
    kind: 'conversation',
    conversationId: 'conversation_one01',
  })
})

test('device group is local-first while cached input and records remain untouched', () => {
  const data = snapshot()
  Object.freeze(data.machines)
  const devices = commandPaletteGroups(data, '').find(
    (group) => group.id === 'devices',
  )
  assert.deepEqual(
    devices.entries.map((entry) => entry.target.machineId),
    [localId, remoteId],
  )
  assert.equal(data.machines[0].machineId, remoteId)
})

test('only real available actions appear and theme action reflects actual resolved theme', () => {
  const available = [
    'new-conversation',
    'theme-light',
    'theme-dark',
    'settings',
  ]
  const actions = paletteActionEntries('dark', available)
  assert.deepEqual(
    actions.map((entry) => entry.target.action),
    ['new-conversation', 'theme-light', 'settings'],
  )
  assert.equal(
    paletteActionEntries('light', available)[1].target.action,
    'theme-dark',
  )
  assert.equal(
    commandPaletteGroups(snapshot(), '新建', actions)[0].entries[0].target
      .action,
    'new-conversation',
  )
})

test('cache bridge reads known list/detail metadata without fetching, creating queries or retaining content', () => {
  const client = new QueryClient()
  const summary = conversation('conversation_one01')
  client.setQueryData(['host', 'machines', 'list'], [machine(localId)])
  client.setQueryData(['host', 'projects', 'list'], [project()])
  client.setQueryData(
    ['host', 'project-conversations', projectId, 'active'],
    [summary],
  )
  client.setQueryData(['host', 'conversation-detail', summary.conversationId], {
    conversation: { ...summary, title: 'Detail title' },
    timeline: { blocks: [{ secret: 'private phrase' }] },
  })
  client.setQueryData(['host', 'conversation-search', 'private phrase'], {
    hits: [{ content: 'private phrase' }],
  })
  const before = client.getQueryCache().getAll().length
  const result = readCommandPaletteCache(client)
  assert.equal(client.getQueryCache().getAll().length, before)
  assert.equal(client.isFetching(), 0)
  assert.equal(result.conversations.length, 2)
  assert.equal(commandPaletteGroups(result, 'private phrase').length, 0)
  assert.equal('timeline' in result.conversations[1], false)
  client.clear()
})

test('cache detail records enrich missing lists but do not override a cached list identity', () => {
  const client = new QueryClient()
  client.setQueryData(['host', 'machines', 'list'], [machine(localId)])
  client.setQueryData(['host', 'machines', 'detail', remoteId], {
    machine: machine(remoteId),
  })
  client.setQueryData(['host', 'machines', 'detail', localId], {
    machine: machine(localId, 'Stale detail name'),
  })
  client.setQueryData(['host', 'projects', 'detail', projectId], project())
  const result = readCommandPaletteCache(client)
  assert.equal(result.machines.length, 2)
  assert.equal(result.machines[0].displayName, '本机')
  assert.equal(result.projects.length, 1)
  client.clear()
})

test('cache subscription has stable snapshots, catches pre-subscribe updates, and unsubscribes cleanly', async () => {
  const client = new QueryClient()
  const store = commandPaletteCacheSubscription(client)
  const empty = store.getSnapshot()
  assert.equal(store.getSnapshot(), empty)
  client.setQueryData(['host', 'conversation-search', 'private content'], {
    hits: [],
  })
  assert.equal(store.getSnapshot(), empty)
  client.setQueryData(['host', 'projects', 'list'], [])
  assert.notEqual(store.getSnapshot(), empty)
  let notified = 0
  const unsubscribe = store.subscribe(() => {
    notified += 1
  })
  client.setQueryData(['host', 'projects', 'list'], [project()])
  assert.equal(
    notified,
    0,
    'cache changes during render must not notify React synchronously',
  )
  await Promise.resolve()
  assert.ok(notified > 0)
  const before = notified
  unsubscribe()
  client.setQueryData(['host', 'projects', 'list'], [])
  await Promise.resolve()
  assert.equal(notified, before)
  client.clear()
})

test('cache notifications coalesce and cannot outlive their exact subscription', async () => {
  const client = new QueryClient()
  const store = commandPaletteCacheSubscription(client)
  let calls = 0
  const unsubscribe = store.subscribe(() => {
    calls += 1
  })
  client.setQueryData(['host', 'projects', 'list'], [project()])
  client.setQueryData(['host', 'machines', 'list'], [machine(localId)])
  assert.equal(calls, 0)
  await Promise.resolve()
  assert.equal(
    calls,
    1,
    'one deferred notification for a synchronous cache batch',
  )
  client.setQueryData(['host', 'projects', 'list'], [])
  unsubscribe()
  const stopNew = store.subscribe(() => {
    calls += 10
  })
  await Promise.resolve()
  assert.equal(
    calls,
    1,
    'unsubscribed pending work must not notify either owner',
  )
  client.setQueryData(['host', 'conversation-search', 'private phrase'], {
    hits: [],
  })
  await Promise.resolve()
  assert.equal(calls, 1, 'content search is not palette metadata')
  stopNew()
  client.clear()
})

test('projects already loaded in a device detail remain searchable when the global sidebar was collapsed', () => {
  const client = new QueryClient()
  client.setQueryData(['host', 'machines', 'detail', remoteId], {
    machine: machine(remoteId),
    projects: [project()],
  })
  const result = readCommandPaletteCache(client)
  assert.equal(result.projects.length, 1)
  assert.equal(commandPaletteGroups(result, 'Shared')[0].entries.length, 2)
  assert.equal(client.isFetching(), 0)
  client.clear()
})

function machine(machineId, displayName) {
  return {
    machineId,
    kind: machineId === localId ? 'local' : 'remote',
    connectionState: machineId === localId ? 'local' : 'online',
    displayName: displayName ?? (machineId === localId ? '本机' : '构建节点'),
  }
}
function project() {
  return {
    projectId,
    name: 'Shared Project',
    locations: [remoteId, localId].map((machineId) => ({
      machineId,
      rootPath: '/secret/path',
    })),
  }
}
function conversation(conversationId, overrides = {}) {
  return {
    conversationId,
    projectId,
    machineId: remoteId,
    title: 'Title',
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  }
}
