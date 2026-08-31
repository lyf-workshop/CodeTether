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
  projectLocationAvailability,
  projectLocationForMachine,
  projectLocationRootPath,
  soleProjectLocation,
} from '../.tmp/test-dist/runtime/host/project-location.js'
import {
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
