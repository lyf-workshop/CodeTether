import assert from 'node:assert/strict'
import test from 'node:test'
import {
  emptyWorkspaceTreeExpansion,
  revealWorkspacePath,
  toggleWorkspaceMachine,
  toggleWorkspaceProject,
  workspaceDeviceGroups,
  workspaceLocationConversations,
  workspaceProjectEntryKey,
} from '../.tmp/test-dist/components/app-shell/workspace-sidebar-model.js'

const timestamp = '2026-09-15T12:00:00.000Z'
const localId = 'machine_local'
const remoteId = 'machine_remote'
const projectId = 'proj_workspace'

test('Device tree uses every exact location and puts the local Device first', () => {
  const machines = [machine(remoteId, 'remote'), machine(localId, 'local')]
  const projects = [
    project(projectId, [localId, remoteId]),
    project('proj_remote', [remoteId]),
  ]
  const groups = workspaceDeviceGroups(machines, projects)
  assert.deepEqual(
    groups.map(({ machine }) => machine.machineId),
    [localId, remoteId],
  )
  assert.deepEqual(
    groups.map(({ projects }) => projects.map(({ key }) => key)),
    [
      [`${projectId}:${localId}`],
      [`${projectId}:${remoteId}`, `proj_remote:${remoteId}`],
    ],
  )
  assert.equal(groups[0].projects[0].project, projects[0])
  assert.equal(groups[1].projects[0].location, projects[0].locations[1])
  assert.deepEqual(
    machines.map(({ machineId }) => machineId),
    [remoteId, localId],
  )
})

test('Unavailable locations remain navigable without inventing missing Devices', () => {
  const remote = machine(remoteId, 'remote')
  remote.connectionState = 'offline'
  remote.availability = 'unavailable'
  const inaccessible = project(projectId, [remoteId, 'machine_missing'])
  inaccessible.locations[0].availability = 'unavailable'
  const groups = workspaceDeviceGroups([remote], [inaccessible])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].projects.length, 1)
  assert.equal(groups[0].machine.connectionState, 'offline')
  assert.equal(groups[0].projects[0].location.availability, 'unavailable')
  assert.deepEqual(workspaceDeviceGroups([], [inaccessible]), [])
})

test('Four total Conversations prioritise pins, activity, and stable identity', () => {
  const rows = [
    conversation('conv_recent', { lastActivityAt: '2026-09-17T12:00:00.000Z' }),
    conversation('conv_b'),
    conversation('conv_a'),
    conversation('conv_pinned_old', { pinnedAt: '2026-09-13T12:00:00.000Z' }),
    conversation('conv_pinned_new', { pinnedAt: '2026-09-14T12:00:00.000Z' }),
  ]
  const result = view(rows)
  assert.deepEqual(ids(result), [
    'conv_pinned_new',
    'conv_pinned_old',
    'conv_recent',
    'conv_a',
  ])
  assert.equal(result.activeCount, 5)
  assert.equal(result.hasMore, true)
  assert.equal(view(rows, true).visible.length, 5)
  assert.deepEqual(
    rows.map(({ conversationId }) => conversationId),
    ['conv_recent', 'conv_b', 'conv_a', 'conv_pinned_old', 'conv_pinned_new'],
  )
})

test('More than four pinned Conversations still use a four-row default', () => {
  const rows = Array.from({ length: 6 }, (_, index) =>
    conversation(`conv_${index}`, { pinnedAt: timestamp }),
  )
  assert.equal(view(rows).visible.length, 4)
  assert.equal(view(rows).activeCount, 6)
})

test('Location rows cannot leak Conversations or current context from another pair', () => {
  const local = conversation('conv_local')
  const remote = conversation('conv_remote', { machineId: remoteId })
  const otherProject = conversation('conv_other', { projectId: 'proj_other' })
  const archived = conversation('conv_archived', { archivedAt: timestamp })
  assert.deepEqual(
    ids(view([remote, local, otherProject, archived], false, remote)),
    ['conv_local'],
  )
  assert.equal(view([remote, otherProject, archived]).activeCount, 0)
  assert.deepEqual(
    ids(
      workspaceLocationConversations(
        [local, remote],
        projectId,
        remoteId,
        false,
      ),
    ),
    ['conv_remote'],
  )
})

test('Current active Conversation remains visible outside four and outside the bounded index', () => {
  const rows = Array.from({ length: 5 }, (_, index) =>
    conversation(`conv_${index}`),
  )
  assert.deepEqual(ids(view(rows, false, rows[4])), [
    'conv_0',
    'conv_1',
    'conv_2',
    'conv_3',
    'conv_4',
  ])
  assert.equal(view(rows, false, rows[0]).visible.length, 4)
  const absent = conversation('conv_absent', {
    lastActivityAt: '2026-09-01T12:00:00.000Z',
  })
  const result = view(rows, false, absent)
  assert.equal(result.visible.at(-1), absent)
  assert.equal(result.activeCount, 6)
  const latest = { ...rows[0], title: 'Updated current title' }
  assert.equal(view(rows, false, latest).visible[0].title, latest.title)
})

test('Only the current archived Conversation is appended, exactly once', () => {
  const archived = conversation('conv_archived', { archivedAt: timestamp })
  const active = conversation('conv_active')
  const result = view([active, archived, archived], false, archived)
  assert.deepEqual(ids(result), ['conv_active', 'conv_archived'])
  assert.equal(result.activeCount, 1)
  assert.equal(result.hasMore, false)
  assert.equal(view([archived]).visible.length, 0)
  assert.deepEqual(ids(view([], false, archived)), ['conv_archived'])
})

test('Multiple devices and project entries expand independently and reveal on navigation', () => {
  const localKey = workspaceProjectEntryKey(projectId, localId)
  const remoteKey = workspaceProjectEntryKey(projectId, remoteId)
  const initial = emptyWorkspaceTreeExpansion()
  const local = revealWorkspacePath(initial, localId, projectId)
  const both = revealWorkspacePath(local, remoteId, projectId)
  assert.deepEqual([...both.expandedProjectKeys], [localKey, remoteKey])
  const collapsed = toggleWorkspaceProject(
    toggleWorkspaceMachine(both, remoteId),
    remoteKey,
  )
  assert.equal(collapsed.expandedProjectKeys.has(localKey), true)
  assert.equal(collapsed.expandedProjectKeys.has(remoteKey), false)
  assert.equal(collapsed.collapsedMachineIds.has(remoteId), true)
  assert.equal(revealWorkspacePath(collapsed, remoteId, projectId), collapsed)
  const changed = revealWorkspacePath(collapsed, localId, projectId)
  const reopened = revealWorkspacePath(changed, remoteId, projectId)
  assert.equal(reopened.collapsedMachineIds.has(remoteId), false)
  assert.equal(reopened.expandedProjectKeys.has(remoteKey), true)
  assert.equal(initial.expandedProjectKeys.size, 0)
})

function view(rows, all = false, current) {
  return workspaceLocationConversations(rows, projectId, localId, all, current)
}

function ids(result) {
  return result.visible.map(({ conversationId }) => conversationId)
}

function conversation(conversationId, overrides = {}) {
  return {
    conversationId,
    projectId,
    machineId: localId,
    title: conversationId,
    titleSource: 'generated',
    provider: 'codex',
    status: 'completed',
    createdAt: timestamp,
    updatedAt: timestamp,
    lastActivityAt: timestamp,
    ...overrides,
  }
}

function project(id, machineIds) {
  return {
    projectId: id,
    name: id,
    createdAt: timestamp,
    updatedAt: timestamp,
    locations: machineIds.map((machineId) => ({
      projectId: id,
      machineId,
      rootPath: `/work/${id}`,
      availability: 'available',
      createdAt: timestamp,
      updatedAt: timestamp,
    })),
  }
}

function machine(machineId, kind) {
  return {
    machineId,
    kind,
    displayName: machineId,
    platform: 'Linux',
    architecture: 'x64',
    availability: 'available',
    connectionState: kind === 'local' ? 'local' : 'online',
    isLocal: kind === 'local',
    trustState: kind === 'local' ? 'local' : 'trusted',
    createdAt: timestamp,
    capabilities: {
      projectAccess: true,
      providerExecution: true,
      backgroundRuntime: false,
      nativeFolderPicker: false,
      notifications: false,
    },
  }
}
