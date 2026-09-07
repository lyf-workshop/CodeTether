import assert from 'node:assert/strict'
import test from 'node:test'

import { QueryClient } from '@tanstack/react-query'

import {
  machineDetailQueryOptions,
  invalidateMachineQueries,
  machineListQueryOptions,
  machineQueryKeys,
  removeMachineQueries,
} from '../.tmp/test-dist/runtime/host/machine-query.js'
import {
  availableProjectLocations,
  projectLocationAvailability,
  projectLocationForMachine,
  projectHasAvailableLocation,
  projectLocationRootPath,
  soleProjectLocation,
} from '../.tmp/test-dist/runtime/host/project-location.js'
import {
  providerExecutionHealthPresentation,
  providerLifecycleForMachine,
  providerLifecycleFreshnessLabel,
  providerLifecyclePresentation,
  providerPresentationForMachine,
  providerPresentationsForMachine,
} from '../.tmp/test-dist/provider/provider-presentation.js'

const machineId = 'machine_local01'
const projectId = 'proj_machine01'
const timestamp = '2026-08-30T12:00:00.000Z'

test('Machine queries use distinct Host-owned list/detail identities and cancellation', async () => {
  const calls = { detail: [], list: [] }
  const client = {
    async listMachines(options) {
      calls.list.push(options)
      return { protocolVersion: 1, machines: [machine()] }
    },
    async getMachine(id, options) {
      calls.detail.push({ id, options })
      return machineDetail()
    },
  }
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  assert.deepEqual(
    await queryClient.fetchQuery(machineListQueryOptions(client)),
    [machine()],
  )
  assert.deepEqual(
    await queryClient.fetchQuery(machineDetailQueryOptions(client, machineId)),
    machineDetail(),
  )
  assert.ok(calls.list[0].signal instanceof AbortSignal)
  assert.ok(calls.detail[0].options.signal instanceof AbortSignal)
  assert.equal(calls.detail[0].id, machineId)
  assert.deepEqual(machineQueryKeys.list, ['host', 'machines', 'list'])
  assert.deepEqual(machineQueryKeys.detail(machineId), [
    'host',
    'machines',
    'detail',
    machineId,
  ])
})

test('low-frequency Machine events invalidate only the Machine query family', () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClient.setQueryData(machineQueryKeys.list, [machine()])
  queryClient.setQueryData(machineQueryKeys.detail(machineId), machineDetail())
  queryClient.setQueryData(['host', 'projects', 'list'], ['preserved'])

  invalidateMachineQueries(queryClient)

  assert.equal(
    queryClient.getQueryState(machineQueryKeys.list).isInvalidated,
    true,
  )
  assert.equal(
    queryClient.getQueryState(machineQueryKeys.detail(machineId)).isInvalidated,
    true,
  )
  assert.equal(
    queryClient.getQueryState(['host', 'projects', 'list']).isInvalidated,
    false,
  )
})

test('machine removal evicts only its exact list and detail cache', () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const otherMachineId = 'machine_remote02'
  const otherMachine = { ...machine(), machineId: otherMachineId }
  queryClient.setQueryData(machineQueryKeys.list, [machine(), otherMachine])
  queryClient.setQueryData(machineQueryKeys.detail(machineId), machineDetail())
  queryClient.setQueryData(machineQueryKeys.detail(otherMachineId), {
    ...machineDetail(),
    machine: otherMachine,
  })
  queryClient.setQueryData(['host', 'projects', 'list'], ['preserved'])

  removeMachineQueries(queryClient, machineId)

  assert.deepEqual(queryClient.getQueryData(machineQueryKeys.list), [
    otherMachine,
  ])
  assert.equal(
    queryClient.getQueryData(machineQueryKeys.detail(machineId)),
    undefined,
  )
  assert.ok(queryClient.getQueryData(machineQueryKeys.detail(otherMachineId)))
  assert.deepEqual(queryClient.getQueryData(['host', 'projects', 'list']), [
    'preserved',
  ])
})

test('Project locations select durable Machine identity without path inference', () => {
  const project = machineDetail().projects[0]

  assert.equal(soleProjectLocation(project).machineId, machineId)
  assert.equal(
    projectLocationForMachine(project, machineId).rootPath,
    'C:\\workspaces\\alpha',
  )
  assert.equal(projectLocationAvailability(project), 'available')
  assert.equal(projectLocationRootPath(project), 'C:\\workspaces\\alpha')
  assert.equal(
    projectLocationForMachine(project, 'machine_unknown01'),
    undefined,
  )
})

test('multi-Machine Projects aggregate availability without inventing a primary path', () => {
  const localProject = machineDetail().projects[0]
  const project = {
    ...localProject,
    locations: [
      ...localProject.locations,
      {
        ...localProject.locations[0],
        machineId: 'machine_remote01',
        rootPath: '/srv/alpha',
        availability: 'unavailable',
      },
    ],
  }

  assert.equal(soleProjectLocation(project), undefined)
  assert.equal(projectLocationRootPath(project), undefined)
  assert.equal(
    projectLocationRootPath(project, machineId),
    'C:\\workspaces\\alpha',
  )
  assert.equal(projectLocationAvailability(project), 'available')
  assert.equal(projectHasAvailableLocation(project), true)
  assert.deepEqual(availableProjectLocations(project), [project.locations[0]])
  assert.equal(
    projectLocationAvailability(project, 'machine_remote01'),
    'unavailable',
  )
})

test('Provider presentation is scoped to one Machine descriptor response', () => {
  const descriptors = machineDetail().providers
  const providers = providerPresentationsForMachine(descriptors)

  assert.deepEqual(
    providers.map((provider) => [provider.provider, provider.available]),
    [
      ['codex', true],
      ['claude-code', false],
    ],
  )
  assert.equal(
    providerPresentationForMachine([], 'codex').availability,
    'unavailable',
  )
})

test('Provider installation and execution health remain separate presentation truth', () => {
  const healthy = providerExecutionHealthPresentation({
    state: 'healthy',
    freshness: 'current',
    observedAt: timestamp,
  })
  assert.equal(healthy.stateLabel, '执行正常')
  assert.equal(healthy.freshnessLabel, '当前状态')

  const unavailable = providerExecutionHealthPresentation({
    state: 'unavailable',
    freshness: 'last_known',
    observedAt: timestamp,
    failure: {
      category: 'authentication',
      reason: 'login_required',
      retryability: 'retry_after_user_action',
      userAction: 'login_on_machine',
      source: 'provider',
      occurredAt: timestamp,
      technicalCode: 'login_required',
    },
  })
  assert.equal(unavailable.stateLabel, '执行不可用')
  assert.equal(unavailable.freshnessLabel, '上次已知')
  assert.match(unavailable.description, /登录/u)

  const namedUnavailable = providerExecutionHealthPresentation(
    {
      state: 'unavailable',
      freshness: 'current',
      failure: {
        category: 'authentication',
        reason: 'login_required',
        retryability: 'retry_after_user_action',
        userAction: 'login_on_machine',
        source: 'provider',
        occurredAt: timestamp,
        technicalCode: 'login_required',
      },
    },
    'Claude Code',
  )
  assert.match(namedUnavailable.description, /Claude Code/u)

  const recovered = providerExecutionHealthPresentation(
    { state: 'healthy', freshness: 'current', observedAt: timestamp },
    'Claude Code',
  )
  assert.equal(recovered.stateLabel, '执行正常')
  assert.doesNotMatch(recovered.description, /登录/u)

  const notObserved = providerExecutionHealthPresentation(undefined)
  assert.equal(notObserved.state, 'not_observed')
  assert.match(notObserved.description, /安装状态不代表当前可以执行/u)
})

test('local Machine Provider presentation preserves installed truth beside unavailable execution health', () => {
  const loginFailure = {
    category: 'authentication',
    reason: 'login_required',
    retryability: 'retry_after_user_action',
    userAction: 'login_on_machine',
    source: 'provider',
    occurredAt: timestamp,
    technicalCode: 'login_required',
  }
  const descriptor = {
    ...provider('claude-code', 'available'),
    version: '2.1.251',
    executionHealth: {
      state: 'unavailable',
      freshness: 'current',
      observedAt: timestamp,
      failure: loginFailure,
    },
  }

  const presented = providerPresentationForMachine([descriptor], 'claude-code')
  const health = providerExecutionHealthPresentation(
    presented.executionHealth,
    presented.displayName,
  )

  assert.equal(presented.availability, 'available')
  assert.equal(presented.available, true)
  assert.equal(presented.version, '2.1.251')
  assert.equal(presented.executionHealth?.failure?.reason, 'login_required')
  assert.equal(health.stateLabel, '执行不可用')
  assert.equal(health.freshnessLabel, '当前状态')
  assert.match(health.description, /Claude Code/u)
  assert.match(health.description, /登录/u)
})

test('Provider lifecycle presentation separates selected installation, runtime, backend, and freshness', () => {
  const lifecycle = providerLifecycle('claude-code', {
    compatibility: compatibility('compatible_unverified', 'current'),
    backend: backend('custom_gateway', 'ready', 'current'),
    alternateCount: 2,
  })
  const presentation = providerLifecyclePresentation(lifecycle)

  assert.equal(
    providerLifecycleForMachine([lifecycle], 'claude-code'),
    lifecycle,
  )
  assert.equal(providerLifecycleForMachine([lifecycle], 'codex'), undefined)
  assert.equal(presentation.installation.stateLabel, '已选择')
  assert.equal(presentation.installation.version, '2.1.263')
  assert.match(presentation.installation.detailLabel, /npm/u)
  assert.match(presentation.installation.detailLabel, /符号链接/u)
  assert.equal(presentation.installation.alternateCount, 2)
  assert.equal(presentation.runtime.stateLabel, '兼容 — 新版本')
  assert.equal(presentation.runtime.freshnessLabel, '当前状态')
  assert.equal(presentation.backend.modeLabel, '自定义网关')
  assert.equal(presentation.backend.readinessLabel, '就绪')
  assert.equal(presentation.backend.freshnessLabel, '当前状态')
})

test('Provider lifecycle presentation exhaustively distinguishes degraded and last-known states', () => {
  const expectedRuntimeLabels = {
    verified: '兼容',
    compatible_unverified: '兼容 — 新版本',
    limited: '受限',
    incompatible: '需要更新 CodeTether',
    unavailable: '不可用',
  }
  for (const [state, label] of Object.entries(expectedRuntimeLabels)) {
    const presentation = providerLifecyclePresentation(
      providerLifecycle('codex', {
        compatibility: compatibility(state, 'last_known'),
      }),
    )
    assert.equal(presentation.runtime.stateLabel, label)
    assert.equal(presentation.runtime.freshnessLabel, '上次已知')
  }

  const backendLabels = {
    unknown: '尚未验证',
    ready: '就绪',
    unavailable: '不可用',
    authentication_required: '需要登录',
    misconfigured: '配置不可用',
  }
  for (const [readiness, label] of Object.entries(backendLabels)) {
    const presentation = providerLifecyclePresentation(
      providerLifecycle('claude-code', {
        backend: backend('custom_gateway', readiness, 'last_known'),
      }),
    )
    assert.equal(presentation.backend.readinessLabel, label)
    assert.equal(presentation.backend.freshnessLabel, '上次已知')
  }

  assert.equal(providerLifecycleFreshnessLabel('not_observed'), '尚未观察')
  assert.equal(
    providerLifecyclePresentation(undefined).runtime.state,
    'not_observed',
  )
})

test('Provider lifecycle presentation covers installation absence and every backend mode without path data', () => {
  const empty = providerLifecyclePresentation({
    provider: 'codex',
    installations: [],
  })
  assert.equal(empty.installation.state, 'not_selected')
  assert.equal(empty.installation.stateLabel, '未检测到安装')

  const unselected = providerLifecycle('codex', {})
  delete unselected.selectedInstallationId
  unselected.installations[0].selected = false
  const unselectedPresentation = providerLifecyclePresentation(unselected)
  assert.equal(unselectedPresentation.installation.stateLabel, '尚未选择')
  assert.equal(unselectedPresentation.installation.alternateCount, 1)

  const installationStates = {
    available: '已选择',
    unavailable: '所选安装不可用',
    unresolved: '所选安装未解析',
  }
  for (const [availability, label] of Object.entries(installationStates)) {
    const lifecycle = providerLifecycle('codex', {})
    lifecycle.installations[0].availability = availability
    assert.equal(
      providerLifecyclePresentation(lifecycle).installation.stateLabel,
      label,
    )
  }

  const backendModes = {
    first_party: 'Provider 官方服务',
    custom_gateway: '自定义网关',
    bedrock: 'Amazon Bedrock',
    vertex: 'Google Vertex AI',
    unknown: '后端模式未知',
  }
  for (const [mode, label] of Object.entries(backendModes)) {
    const lifecycle = providerLifecycle('claude-code', {
      backend: backend(mode, 'ready', 'current'),
    })
    assert.equal(
      providerLifecyclePresentation(lifecycle).backend.modeLabel,
      label,
    )
  }
})

test('Provider lifecycle presentation omits private installation and backend identity', () => {
  const lifecycle = providerLifecycle('claude-code', {
    compatibility: compatibility('verified', 'current'),
    backend: backend('custom_gateway', 'ready', 'current'),
  })
  lifecycle.installations[0].installationId = 'provider_installation_private01'
  lifecycle.selectedInstallationId = 'provider_installation_private01'
  lifecycle.installations[0].revision = 'provider_revision_private01'
  lifecycle.installations[0].backend.sanitizedOrigin = 'https://gateway.example'

  const serialized = JSON.stringify(providerLifecyclePresentation(lifecycle))
  assert.doesNotMatch(serialized, /private01/u)
  assert.doesNotMatch(serialized, /gateway\.example/u)
  assert.doesNotMatch(serialized, /installationId|revision|sanitizedOrigin/u)
})

function machine() {
  return {
    machineId,
    displayName: '本地电脑',
    kind: 'local',
    platform: 'windows',
    architecture: 'x86_64',
    availability: 'available',
    connectionState: 'local',
    trustState: 'local',
    isLocal: true,
    createdAt: timestamp,
    lastSeenAt: timestamp,
    capabilities: {
      projectAccess: true,
      providerExecution: true,
      backgroundRuntime: true,
      nativeFolderPicker: true,
      notifications: true,
    },
  }
}

function machineDetail() {
  return {
    protocolVersion: 1,
    machine: machine(),
    providers: [
      provider('codex', 'available'),
      provider('claude-code', 'not_installed'),
    ],
    projects: [
      {
        projectId,
        name: 'Alpha',
        locations: [
          {
            projectId,
            machineId,
            rootPath: 'C:\\workspaces\\alpha',
            availability: 'available',
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    conversations: [],
  }
}

function provider(id, availability) {
  return {
    provider: id,
    displayName: id === 'codex' ? 'Codex' : 'Claude Code',
    availability,
    capabilities: {
      streaming: availability === 'available',
      resume: availability === 'available',
      interrupt: id === 'codex' && availability === 'available',
      approvals: id === 'codex' && availability === 'available',
      fileRead: availability === 'available',
      fileEdit: false,
      shell: false,
      diff: id === 'codex' && availability === 'available',
      toolEvents: availability === 'available',
      modelSelection: false,
      reasoningControl: false,
    },
  }
}

function providerLifecycle(
  providerId,
  {
    compatibility: compatibilityValue,
    backend: backendValue,
    alternateCount = 0,
  },
) {
  const selected = {
    installationId: 'provider_installation_selected01',
    provider: providerId,
    selected: true,
    version: '2.1.263',
    launcherKind: 'symlink',
    installMethod: 'npm',
    availability: 'available',
    revision: 'provider_revision_selected01',
    firstObservedAt: timestamp,
    lastObservedAt: timestamp,
    ...(compatibilityValue === undefined
      ? {}
      : { compatibility: compatibilityValue }),
    ...(backendValue === undefined ? {} : { backend: backendValue }),
  }
  return {
    provider: providerId,
    selectedInstallationId: selected.installationId,
    installations: [
      selected,
      ...Array.from({ length: alternateCount }, (_, index) => ({
        ...selected,
        installationId: `provider_installation_alternate${index}`,
        selected: false,
      })),
    ],
  }
}

function compatibility(state, freshness) {
  const supported = { observed: 'supported', enabled: true, effective: true }
  const unavailable = {
    observed: 'unavailable',
    enabled: true,
    effective: false,
  }
  return {
    state,
    runtimeReadiness:
      state === 'verified' || state === 'compatible_unverified'
        ? 'ready'
        : state === 'limited'
          ? 'limited'
          : state === 'incompatible'
            ? 'blocked'
            : 'unavailable',
    freshness,
    contractVersion: 1,
    observedAt: timestamp,
    capabilities: {
      execution: state === 'incompatible' ? unavailable : supported,
      streaming: state === 'incompatible' ? unavailable : supported,
      nativeResume: state === 'incompatible' ? unavailable : supported,
      nativeSessionDiscovery: state === 'limited' ? unavailable : supported,
      fileRead: supported,
      search: supported,
      toolEvents: supported,
      reasoningControl: supported,
    },
  }
}

function backend(mode, readiness, freshness) {
  return {
    mode,
    readiness,
    freshness,
    configurationRevision: 'provider_backend_revision01',
    configuration: {
      source: 'process_environment',
      hasBaseUrl: mode === 'custom_gateway',
      hasApiKey: false,
      hasAuthToken: mode === 'custom_gateway',
      hasOAuthToken: false,
      bedrockConfigured: mode === 'bedrock',
      vertexConfigured: mode === 'vertex',
    },
    observedAt: timestamp,
  }
}
