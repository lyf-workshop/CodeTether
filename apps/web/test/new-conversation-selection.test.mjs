import assert from 'node:assert/strict'
import test from 'node:test'
import {
  conversationCreationProviderOptions,
  conversationProjectChoiceKey,
  conversationProjectGroups,
  eligibleConversationProjectSelection,
  resolveConversationCreationProvider,
  resolveConversationProject,
} from '../.tmp/test-dist/components/conversations/new-conversation-selection.js'

const localId = 'machine_local01'
const remoteId = 'machine_remote01'
const projectId = 'project_shared01'
const preselected = { kind: 'preselected', projectId, machineId: remoteId }
const fixed = { ...preselected, kind: 'fixed-project' }
const pair = (machineId = remoteId, id = projectId) => ({
  projectId: id,
  machineId,
})

test('project choices group exact locations under real devices, local first, with stable input order', () => {
  const remote = machine(remoteId)
  const local = machine(localId)
  const shared = project(projectId, localId, remoteId)
  const machines = Object.freeze([remote, local])
  const projects = Object.freeze([
    shared,
    project('project_second01', remoteId),
  ])
  const groups = conversationProjectGroups(machines, projects)
  assert.deepEqual(
    groups.map((group) => group.machineId),
    [localId, remoteId],
  )
  assert.deepEqual(
    groups[1].choices.map((choice) => choice.projectId),
    [projectId, 'project_second01'],
  )
  assert.equal(groups[0].choices[0].project, shared)
  assert.notEqual(groups[0].choices[0].key, groups[1].choices[0].key)
  assert.deepEqual(machines, [remote, local])
})

test('group choices keep offline, unsupported and missing devices visible with individual reasons', () => {
  const offlineId = 'machine_offline01'
  const missingId = 'machine_missing01'
  const unsupported = machine(remoteId, {
    capabilities: { projectAccess: true, providerExecution: false },
  })
  const groups = conversationProjectGroups(
    [
      machine(localId),
      unsupported,
      machine(offlineId, { connectionState: 'offline' }),
    ],
    [project(projectId, localId, remoteId, offlineId, missingId)],
  )
  const choices = groups.flatMap((group) => group.choices)
  assert.equal(choices[0].unavailableReason, undefined)
  assert.match(choices[1].unavailableReason, /不能运行/u)
  assert.match(choices[2].unavailableReason, /离线/u)
  assert.match(choices[3].unavailableReason, /设备不可用/u)
  assert.equal(choices[3].machine, undefined)
})

test('each location availability is exact and cannot borrow availability from its sibling', () => {
  const shared = project(projectId, localId, remoteId)
  shared.locations[1].availability = 'unavailable'
  const choices = conversationProjectGroups(
    [machine(localId), machine(remoteId)],
    [shared],
  ).flatMap((group) => group.choices)
  assert.equal(choices[0].unavailableReason, undefined)
  assert.match(choices[1].unavailableReason, /无法访问/u)
})

test('generic launch selects the first eligible project in local-first order', () => {
  const groups = conversationProjectGroups(
    [machine(remoteId), machine(localId)],
    [project(projectId, remoteId, localId)],
  )
  assert.equal(resolveConversationProject(groups).choice.machineId, localId)
})

test('global preselection preserves exact context while allowing an explicit user change', () => {
  const groups = fixtureGroups()
  assert.equal(
    resolveConversationProject(groups, preselected).choice.machineId,
    remoteId,
  )
  assert.equal(resolveConversationProject(groups, preselected).fixed, false)
  const intentional = eligibleConversationProjectSelection(
    groups,
    conversationProjectChoiceKey(pair(localId)),
    preselected,
  )
  assert.deepEqual(intentional, pair(localId))
  assert.equal(
    resolveConversationProject(groups, preselected, intentional).choice
      .machineId,
    localId,
  )
})

test('project-row launch fixes exact project and device and rejects a forged different choice', () => {
  const groups = fixtureGroups()
  const result = resolveConversationProject(groups, fixed)
  assert.equal(result.fixed, true)
  assert.equal(result.choice.machineId, remoteId)
  assert.equal(
    eligibleConversationProjectSelection(
      groups,
      conversationProjectChoiceKey(pair(localId)),
      fixed,
    ),
    undefined,
  )
  assert.equal(
    resolveConversationProject(groups, fixed, pair(localId)).choice,
    undefined,
  )
})

test('missing or offline preselection never silently falls back to a healthy local device', () => {
  const missing = resolveConversationProject(
    conversationProjectGroups(
      [machine(localId)],
      [project(projectId, localId)],
    ),
    preselected,
  )
  assert.equal(missing.choice, undefined)
  assert.deepEqual(missing.selection, pair())
  assert.equal(missing.requiresSelection, true)
  const offline = resolveConversationProject(
    fixtureGroups({ connectionState: 'offline' }),
    preselected,
  )
  assert.equal(offline.choice.machineId, remoteId)
  assert.match(offline.choice.unavailableReason, /离线/u)
})

test('unavailable choices cannot be selected even through a forged controlled callback', () => {
  const groups = fixtureGroups({ connectionState: 'offline' })
  assert.equal(
    eligibleConversationProjectSelection(
      groups,
      conversationProjectChoiceKey(pair()),
      preselected,
    ),
    undefined,
  )
  assert.equal(
    eligibleConversationProjectSelection(
      groups,
      'project_forged:machine_forged',
    ),
    undefined,
  )
})

test('device-page preselection chooses its first available project, never another device', () => {
  const otherId = 'project_remote02'
  const shared = project(projectId, localId, remoteId)
  shared.locations[1].availability = 'unavailable'
  const groups = conversationProjectGroups(
    [machine(localId), machine(remoteId)],
    [shared, project(otherId, remoteId)],
  )
  assert.equal(
    resolveConversationProject(groups, {
      kind: 'preselected',
      machineId: remoteId,
    }).choice.projectId,
    otherId,
  )
  const empty = resolveConversationProject(groups, {
    kind: 'preselected',
    machineId: 'machine_unknown01',
  })
  assert.equal(empty.choice, undefined)
  const blocked = resolveConversationProject(
    fixtureGroups({ connectionState: 'offline' }),
    { kind: 'preselected', machineId: remoteId },
  )
  assert.equal(blocked.choice.machineId, remoteId)
  assert.match(blocked.choice.unavailableReason, /离线/u)
})

test('legacy fixed project with several locations requires an explicit device; a sole location is locked', () => {
  const context = { kind: 'fixed-project', projectId }
  const ambiguous = resolveConversationProject(fixtureGroups(), context)
  assert.equal(ambiguous.choice, undefined)
  assert.equal(ambiguous.requiresSelection, true)
  const sole = resolveConversationProject(
    conversationProjectGroups(
      [machine(remoteId)],
      [project(projectId, remoteId)],
    ),
    context,
  )
  assert.equal(sole.choice.machineId, remoteId)
  assert.equal(sole.fixed, true)
})

test('a deliberate selection contains identifiers only and follows refreshed Query records', () => {
  const selection = eligibleConversationProjectSelection(
    fixtureGroups(),
    conversationProjectChoiceKey(pair()),
  )
  assert.deepEqual(Object.keys(selection).sort(), ['machineId', 'projectId'])
  const changed = fixtureGroups({ displayName: 'Renamed Device' })
  assert.equal(
    resolveConversationProject(changed, undefined, selection).choice.machine
      .displayName,
    'Renamed Device',
  )
  assert.equal(
    resolveConversationProject([], undefined, selection).choice,
    undefined,
  )
})

test('initial tool default is eligible Codex then first eligible descriptor, but explicit selection never falls back', () => {
  const options = conversationCreationProviderOptions([
    provider('claude-code'),
    provider('codex'),
  ])
  assert.equal(
    resolveConversationCreationProvider(options).provider.provider,
    'codex',
  )
  assert.equal(
    resolveConversationCreationProvider(options, 'claude-code').provider
      .provider,
    'claude-code',
  )
  const changed = conversationCreationProviderOptions([
    provider('codex'),
    provider('claude-code', { available: false }),
  ])
  assert.equal(
    resolveConversationCreationProvider(changed, 'claude-code').eligibility
      .eligible,
    false,
  )
  assert.equal(
    resolveConversationCreationProvider(
      changed.filter((option) => option.provider.provider === 'codex'),
      'claude-code',
    ),
    undefined,
  )
})

test('provider descriptor must allow streaming and native resume independently of tool name', () => {
  for (const capability of ['streaming', 'resume']) {
    const item = provider('claude-code')
    item.capabilities[capability] = false
    assert.equal(
      conversationCreationProviderOptions([item])[0].eligibility.eligible,
      false,
    )
  }
})

test('canonical selected installation gates creation; a healthy alternate is never auto-selected', () => {
  const selected = installation('installation_selected01', {
    availability: 'unavailable',
  })
  const alternate = installation('installation_alternate01', {
    selected: false,
  })
  const group = {
    provider: 'codex',
    selectedInstallationId: selected.installationId,
    installations: [selected, alternate],
  }
  const option = conversationCreationProviderOptions(
    [provider('codex')],
    [group],
  )[0]
  assert.equal(option.eligibility.eligible, false)
  assert.match(option.eligibility.label, /当前安装/u)
  assert.equal(group.selectedInstallationId, selected.installationId)
})

test('a lifecycle group without its selected identity blocks rather than selecting the first installation', () => {
  for (const selectedInstallationId of [undefined, 'installation_missing01']) {
    const group = {
      provider: 'codex',
      selectedInstallationId,
      installations: [installation('installation_other01')],
    }
    assert.equal(
      conversationCreationProviderOptions([provider('codex')], [group])[0]
        .eligibility.eligible,
      false,
    )
  }
})

test('selected lifecycle compatibility and current backend authentication stay authoritative', () => {
  for (const overrides of [
    { compatibility: { state: 'incompatible' } },
    {
      compatibility: {
        state: 'compatible',
        capabilities: {
          execution: { effective: true },
          streaming: { effective: true },
          nativeResume: { effective: false },
        },
      },
    },
    { backend: { freshness: 'current', readiness: 'authentication_required' } },
  ]) {
    const selected = installation('installation_selected01', overrides)
    const group = {
      provider: 'codex',
      selectedInstallationId: selected.installationId,
      installations: [selected],
    }
    assert.equal(
      conversationCreationProviderOptions([provider('codex')], [group])[0]
        .eligibility.eligible,
      false,
    )
  }
})

test('legacy descriptor eligibility is preserved without Lifecycle, and runtime health stays advisory', () => {
  const item = provider('codex', {
    executionHealth: { state: 'degraded', freshness: 'stale' },
  })
  const option = conversationCreationProviderOptions([item], undefined)[0]
  assert.equal(option.eligibility.eligible, true)
  assert.ok(option.eligibility.executionAdvisory)
})

function fixtureGroups(remoteOverrides = {}) {
  return conversationProjectGroups(
    [machine(remoteId, remoteOverrides), machine(localId)],
    [project(projectId, remoteId, localId)],
  )
}
function machine(machineId, overrides = {}) {
  return {
    machineId,
    kind: machineId === localId ? 'local' : 'remote',
    connectionState: machineId === localId ? 'local' : 'online',
    displayName: machineId === localId ? '本机' : '构建设备',
    availability: 'available',
    capabilities: { projectAccess: true, providerExecution: true },
    ...overrides,
  }
}
function project(id, ...machineIds) {
  return {
    projectId: id,
    name: 'Shared Folder',
    locations: machineIds.map((machineId) => ({
      machineId,
      rootPath: machineId === localId ? 'D:\\work\\project' : '/work/project',
      availability: 'available',
    })),
  }
}
function provider(id, overrides = {}) {
  return {
    provider: id,
    agent: id === 'codex' ? 'codex' : 'claude',
    displayName: id === 'codex' ? 'Codex' : 'Claude Code',
    available: true,
    availabilityLabel: '可用',
    models: [],
    reasoningOptions: [],
    reasoningLabel: '推理强度',
    capabilities: {
      streaming: true,
      resume: true,
      fileRead: true,
      fileEdit: true,
      shell: true,
      reasoningControl: false,
    },
    ...overrides,
  }
}
function installation(installationId, overrides = {}) {
  return {
    installationId,
    selected: true,
    availability: 'available',
    ...overrides,
  }
}
