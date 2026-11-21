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
    groups.map((group) => group.label),
    ['本地电脑 (Windows)', '构建设备 (Linux)'],
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

test('only a local startup Provider placeholder says it is still checking', () => {
  const pending = provider('codex', {
    available: false,
    availability: 'unavailable',
    availabilityLabel: '暂时不可用',
    executionHealth: { state: 'unknown', freshness: 'last_known' },
  })
  const local = conversationCreationProviderOptions(
    [pending],
    [{ provider: 'codex', installations: [] }],
    undefined,
    undefined,
    'local',
  )[0]
  assert.equal(local.eligibility.eligible, false)
  assert.equal(local.eligibility.checking, true)
  assert.equal(local.eligibility.label, 'Codex · 正在检查…')
  assert.deepEqual(local.eligibility.summary.status, {
    label: '正在检查…',
    variant: 'secondary',
  })
  const remote = conversationCreationProviderOptions(
    [pending],
    undefined,
    undefined,
    undefined,
    'remote',
  )[0]
  assert.equal(remote.eligibility.checking, undefined)
  assert.match(remote.eligibility.label, /暂时不可用/u)

  const warmDbPending = conversationCreationProviderOptions(
    [
      {
        ...pending,
        executionHealth: {
          state: 'healthy',
          freshness: 'last_known',
          observedAt: '2026-11-19T12:00:00.000Z',
        },
      },
    ],
    [
      {
        provider: 'codex',
        selectedInstallationId: 'installation_prior01',
        installations: [
          installation('installation_prior01', {
            compatibility: { freshness: 'last_known' },
          }),
        ],
      },
    ],
    undefined,
    undefined,
    'local',
  )[0]
  assert.equal(warmDbPending.eligibility.checking, true)
  assert.equal(warmDbPending.eligibility.label, 'Codex · 正在检查…')

  const checkedCompatibility = conversationCreationProviderOptions(
    [pending],
    [
      {
        provider: 'codex',
        selectedInstallationId: 'installation_checked01',
        installations: [
          installation('installation_checked01', {
            availability: 'unavailable',
            compatibility: { freshness: 'current' },
          }),
        ],
      },
    ],
    undefined,
    undefined,
    'local',
  )[0]
  assert.equal(checkedCompatibility.eligibility.checking, undefined)
  assert.notEqual(checkedCompatibility.eligibility.label, 'Codex · 正在检查…')

  const checked = conversationCreationProviderOptions(
    [
      {
        ...pending,
        executionHealth: { state: 'unavailable', freshness: 'current' },
      },
    ],
    undefined,
    undefined,
    undefined,
    'local',
  )[0]
  assert.equal(checked.eligibility.checking, undefined)
  assert.match(checked.eligibility.label, /暂时不可用/u)
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
  assert.match(option.eligibility.label, /暂时不可用.*重新检查/u)
  assert.equal(group.selectedInstallationId, selected.installationId)
})

test('a lifecycle group without its selected identity blocks rather than selecting the first installation', () => {
  for (const selectedInstallationId of [undefined, 'installation_missing01']) {
    const group = {
      provider: 'codex',
      selectedInstallationId,
      installations: [installation('installation_other01')],
    }
    const [{ eligibility }] = conversationCreationProviderOptions(
      [provider('codex')],
      [group],
    )
    assert.equal(eligibility.eligible, false)
    assert.match(eligibility.label, /尚未选择可用安装/u)
  }
})

test('an empty installation list directs the user to check the installation', () => {
  const [{ eligibility }] = conversationCreationProviderOptions(
    [provider('claude-code')],
    [{ provider: 'claude-code', installations: [] }],
  )
  assert.equal(eligibility.eligible, false)
  assert.match(eligibility.label, /未安装.*安装后重新检查/u)
})

test('blocked tool choices show the selected installation’s observed reason and next step', () => {
  for (const [overrides, expected] of [
    [
      { compatibility: { state: 'incompatible', freshness: 'last_known' } },
      /需要更新 CodeTether.*重新检查/u,
    ],
    [
      {
        compatibility: {
          state: 'incompatible',
          freshness: 'current',
          failure: { reason: 'provider_protocol_error' },
        },
        backend: {
          mode: 'first_party',
          freshness: 'current',
          readiness: 'ready',
        },
      },
      /需要更新 CodeTether.*重新检查/u,
    ],
    [
      { compatibility: { state: 'unavailable', freshness: 'not_observed' } },
      /尚未确认这个工具能否运行.*重新检查/u,
    ],
    [
      {
        compatibility: {
          state: 'limited',
          freshness: 'current',
          capabilities: {
            execution: { effective: true },
            streaming: { effective: true },
            nativeResume: { effective: false },
          },
        },
      },
      /不支持新会话所需的功能.*重新检查/u,
    ],
    [
      {
        backend: {
          mode: 'first_party',
          freshness: 'current',
          readiness: 'authentication_required',
        },
      },
      /未登录.*完成登录/u,
    ],
    [
      {
        backend: {
          mode: 'custom_gateway',
          freshness: 'current',
          readiness: 'authentication_required',
        },
      },
      /暂时不可用.*检查 AI 服务配置/u,
    ],
    [
      { backend: { freshness: 'current', readiness: 'misconfigured' } },
      /暂时不可用.*检查 AI 服务配置/u,
    ],
    [
      { backend: { freshness: 'current', readiness: 'unavailable' } },
      /暂时不可用.*重新检查/u,
    ],
  ]) {
    const selected = installation('installation_selected01', overrides)
    const group = {
      provider: 'claude-code',
      selectedInstallationId: selected.installationId,
      installations: [selected],
    }
    const [{ eligibility }] = conversationCreationProviderOptions(
      [provider('claude-code')],
      [group],
    )
    assert.equal(eligibility.eligible, false)
    assert.match(eligibility.label, expected)
  }
})

test('an older backend login observation does not disable a currently eligible tool', () => {
  const selected = installation('installation_selected01', {
    backend: {
      mode: 'first_party',
      freshness: 'last_known',
      readiness: 'authentication_required',
    },
  })
  const [{ eligibility }] = conversationCreationProviderOptions(
    [provider('claude-code')],
    [
      {
        provider: 'claude-code',
        selectedInstallationId: selected.installationId,
        installations: [selected],
      },
    ],
  )
  assert.equal(eligibility.eligible, true)
  assert.doesNotMatch(eligibility.label, /需要登录/u)
})

test('legacy descriptor eligibility is preserved without Lifecycle, and historical health stays secondary', () => {
  const item = provider('codex', {
    executionHealth: {
      state: 'degraded',
      freshness: 'last_known',
      observedAt: '2026-10-22T12:00:00Z',
      failure: {
        reason: 'provider_service_unavailable',
        userAction: 'retry',
      },
    },
  })
  const option = conversationCreationProviderOptions([item], undefined)[0]
  assert.equal(option.eligibility.eligible, true)
  assert.equal(option.eligibility.summary.status.label, '可用')
  assert.equal(option.eligibility.executionAdvisory, undefined)
  assert.match(
    option.eligibility.summary.executionHistoryLabel,
    /上次运行受限 · 10月22日/u,
  )
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
    platform: machineId === localId ? 'windows' : 'linux',
    architecture: 'x64',
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
    availability: 'available',
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
