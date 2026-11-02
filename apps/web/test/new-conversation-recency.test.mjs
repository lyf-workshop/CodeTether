import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient } from '@tanstack/react-query'
import { loadUiComponent, loadWebComponent } from './fixtures/render-ui.mjs'

const selection = loadWebComponent(
  'components/conversations/new-conversation-selection.ts',
)
const { readCommandPaletteCache } = loadWebComponent(
  'components/app-shell/command-palette-cache.ts',
)
const localId = 'machine_recentlocal01'
const remoteId = 'machine_recentremote01'
const at = (day) => `2026-10-${String(day).padStart(2, '0')}T12:00:00.000Z`
const machine = (machineId, extra = {}) => ({
  machineId,
  displayName: machineId === localId ? '这台电脑' : '配对设备',
  kind: machineId === localId ? 'local' : 'remote',
  connectionState: machineId === localId ? 'local' : 'online',
  availability: 'available',
  capabilities: { projectAccess: true, providerExecution: true },
  ...extra,
})
const project = (projectId, ...machines) => ({
  projectId,
  name: projectId,
  locations: machines.map((machineId) => ({
    machineId,
    rootPath: '/' + projectId + '/' + machineId,
    availability: 'available',
  })),
})
const record = (
  projectId,
  machineId,
  day,
  conversationId = 'conv_' + projectId + machineId,
) => ({ conversationId, projectId, machineId, lastActivityAt: at(day) })
const source = (records, observedAt = 1) => ({ records, observedAt })
const choices = (groups) => groups.flatMap((group) => group.choices)
const key = (projectId, machineId) => projectId + ':' + machineId
const groups = () =>
  selection.conversationProjectGroups(
    [machine(remoteId), machine(localId)],
    [
      project('proj_shared01', localId, remoteId),
      ...Array.from({ length: 6 }, (_, i) =>
        project('proj_recent0' + i, remoteId),
      ),
    ],
  )

test('cold project menu keeps local-first device grouping with no invented recent activity', () => {
  const canonical = groups()
  const menu = selection.conversationProjectMenuGroups(canonical, [])
  assert.deepEqual(
    menu.map((group) => group.label),
    ['这台电脑', '配对设备'],
  )
  assert.deepEqual(choices(menu), choices(canonical))
  assert.equal(
    menu.some((group) => group.kind === 'recent'),
    false,
  )
})

test('recent project menu contains at most five exact project-device pairs and the remainder stays device grouped', () => {
  const canonical = groups()
  const records = [
    record('proj_shared01', remoteId, 18),
    ...Array.from({ length: 6 }, (_, i) =>
      record('proj_recent0' + i, remoteId, 10 + i),
    ),
    record('proj_unknown01', localId, 19),
  ]
  const menu = selection.conversationProjectMenuGroups(canonical, [
    source(records),
  ])
  assert.equal(menu[0].label, '最近使用')
  assert.equal(menu[0].kind, 'recent')
  assert.deepEqual(
    menu[0].choices.map((choice) => choice.key),
    [
      key('proj_shared01', remoteId),
      ...[5, 4, 3, 2].map((i) => key('proj_recent0' + i, remoteId)),
    ],
  )
  assert.equal(menu[0].choices.length, 5)
  assert.deepEqual(
    menu.slice(1).map((group) => group.label),
    ['这台电脑', '配对设备'],
  )
  assert.equal(menu[1].choices[0].key, key('proj_shared01', localId))
  assert.equal(
    new Set(choices(menu).map((choice) => choice.key)).size,
    choices(canonical).length,
  )
  assert.equal(choices(menu).length, choices(canonical).length)
  assert.deepEqual(
    canonical.map((group) => group.machineId),
    [localId, remoteId],
  )
})

test('recency deduplicates newer cached Conversation truth before taking pair activity and uses stable ties', () => {
  const canonical = groups()
  const old = record('proj_recent00', remoteId, 19, 'conv_duplicate01')
  const fresh = { ...old, lastActivityAt: at(10) }
  const menu = selection.conversationProjectMenuGroups(canonical, [
    source([old], 1),
    source([fresh], 2),
    source([
      record('proj_recent01', remoteId, 11),
      record('proj_recent02', remoteId, 11),
    ]),
  ])
  assert.deepEqual(
    menu[0].choices.map((choice) => choice.projectId),
    ['proj_recent01', 'proj_recent02', 'proj_recent00'],
  )
})

test('missing lastActivityAt and metadata-only updatedAt cannot invent recency or borrow a sibling location', () => {
  const canonical = groups()
  const absent = {
    conversationId: 'conv_missing01',
    projectId: 'proj_shared01',
    machineId: localId,
    updatedAt: at(19),
    createdAt: at(19),
  }
  const menu = selection.conversationProjectMenuGroups(canonical, [
    source([absent, record('proj_shared01', remoteId, 10)]),
  ])
  assert.deepEqual(
    menu[0].choices.map((choice) => choice.key),
    [key('proj_shared01', remoteId)],
  )
  assert.equal(menu[1].choices[0].key, key('proj_shared01', localId))
})

test('recent display ordering leaves unavailable reasons, fixed context and global selection authorities unchanged', () => {
  const canonical = selection.conversationProjectGroups(
    [machine(localId), machine(remoteId, { connectionState: 'offline' })],
    [project('proj_shared01', localId, remoteId)],
  )
  const menu = selection.conversationProjectMenuGroups(canonical, [
    source([record('proj_shared01', remoteId, 19)]),
  ])
  assert.match(menu[0].choices[0].unavailableReason, /离线/u)
  assert.equal(
    selection.resolveConversationProject(canonical).choice.machineId,
    localId,
  )
  assert.equal(
    selection.resolveConversationProject(canonical, {
      kind: 'fixed-project',
      projectId: 'proj_shared01',
      machineId: remoteId,
    }).choice.machineId,
    remoteId,
  )
  assert.equal(
    selection.eligibleConversationProjectSelection(
      canonical,
      key('proj_shared01', remoteId),
    ),
    undefined,
  )
})

test('recency reads only already-loaded list, project metric and detail Query metadata without fetching', () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(
    ['host', 'project-conversations', 'proj_shared01', 'all'],
    [record('proj_shared01', remoteId, 10)],
  )
  client.setQueryData(['host', 'conversation-detail', 'conv_detail01'], {
    conversation: record('proj_shared01', localId, 11, 'conv_detail01'),
  })
  client.setQueryData(['host', 'conversation-search', 'proj_shared01'], {
    results: [{ conversation: record('proj_recent00', remoteId, 19) }],
  })
  const before = client.getQueryCache().getAll().length
  const menu = selection.conversationProjectMenuGroups(
    groups(),
    readCommandPaletteCache(client).conversations,
  )
  assert.deepEqual(
    menu[0].choices.map((choice) => choice.key),
    [key('proj_shared01', localId), key('proj_shared01', remoteId)],
  )
  assert.equal(client.getQueryCache().getAll().length, before)
  assert.equal(client.isFetching(), 0)
  client.clear()
})

test('actual project fields render the recent group with real device/path labels and disabled reasons', () => {
  const ui = { ...loadUiComponent('index.ts') }
  for (const name of ['Select', 'SelectContent', 'SelectGroup', 'SelectValue'])
    ui[name] = ({ children }) => h('div', {}, children)
  ui.SelectLabel = ({ children }) => h('h4', {}, children)
  ui.SelectTrigger = ({ children }) => h('button', {}, children)
  ui.SelectItem = ({ children, value, disabled, textValue }) =>
    h(
      'div',
      {
        role: 'option',
        'data-value': value,
        'data-text': textValue,
        'aria-disabled': disabled,
      },
      children,
    )
  const { NewConversationFields } = loadWebComponent(
    'components/conversations/new-conversation-fields.tsx',
    new Map([['@codetether/ui', ui]]),
  )
  const canonical = selection.conversationProjectGroups(
    [machine(localId), machine(remoteId, { connectionState: 'offline' })],
    [project('proj_shared01', localId, remoteId)],
  )
  const menuGroups = selection.conversationProjectMenuGroups(canonical, [
    source([record('proj_shared01', remoteId, 19)]),
  ])
  const html = renderToStaticMarkup(
    h(NewConversationFields, {
      groups: canonical,
      menuGroups,
      fixed: false,
      loading: false,
      busy: false,
      providerOptions: [],
      defaultReasoning: '__provider_default__',
      formId: 'recent',
      onProjectChange() {},
      onProviderChange() {},
      onReasoningChange() {},
    }),
  )
  assert.ok(html.indexOf('最近使用') < html.indexOf('这台电脑'))
  assert.match(html, /配对设备/u)
  assert.match(html, /proj_shared01\/machine_recentremote01/u)
  assert.match(html, /aria-disabled="true"/u)
  assert.match(html, /设备离线或连接尚未恢复/u)
  assert.equal((html.match(/role="option"/gu) ?? []).length, 2)
})
