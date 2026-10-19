import assert from 'node:assert/strict'
import test from 'node:test'

import {
  chooseInitialProjectMachineId,
  createProjectForMachine,
  nextProjectCreationStep,
  projectCreationMachines,
} from '../.tmp/test-dist/components/projects/add-project-model.js'
import {
  fixedProjectCreationMachineExplanation,
  selectFixedProjectCreationMachine,
} from '../.tmp/test-dist/components/projects/project-creation-machine.js'

const local = machine('machine_local01', 'local')
const remote = machine('machine_remote01', 'remote')

test('device choices show this computer first without removing unavailable devices', () => {
  const offline = { ...remote, connectionState: 'offline' }
  const original = [offline, local]
  const result = projectCreationMachines(original)
  assert.deepEqual(
    result.map((item) => item.machineId),
    [local.machineId, remote.machineId],
  )
  assert.equal(result[1].connectionState, 'offline')
  assert.equal(original[0], offline)
})

test('initial selection prefers the eligible local device and then an eligible paired device', () => {
  assert.equal(chooseInitialProjectMachineId([remote, local]), local.machineId)
  const unavailableLocal = {
    ...local,
    capabilities: { ...local.capabilities, providerExecution: false },
  }
  assert.equal(
    chooseInitialProjectMachineId([unavailableLocal, remote]),
    remote.machineId,
  )
  assert.equal(chooseInitialProjectMachineId([]), undefined)
})

test('an explicit missing, offline or incompatible device never falls back to another device', () => {
  assert.equal(
    selectFixedProjectCreationMachine([local], remote.machineId).state,
    'missing',
  )
  for (const connectionState of [
    'offline',
    'connecting',
    'recovery_required',
    'authentication_failed',
    'incompatible',
  ]) {
    const result = selectFixedProjectCreationMachine(
      [local, { ...remote, connectionState }],
      remote.machineId,
    )
    assert.equal(result.state, 'offline')
    assert.equal(result.machine.machineId, remote.machineId)
  }
})

test('adding a project requires real project access and execution capabilities separately', () => {
  const noAccess = {
    ...remote,
    capabilities: { ...remote.capabilities, projectAccess: false },
  }
  const noExecution = {
    ...remote,
    capabilities: { ...remote.capabilities, providerExecution: false },
  }
  assert.equal(
    selectFixedProjectCreationMachine([noAccess], remote.machineId).state,
    'project_access_unavailable',
  )
  assert.equal(
    selectFixedProjectCreationMachine([noExecution], remote.machineId).state,
    'execution_unavailable',
  )
  assert.match(
    fixedProjectCreationMachineExplanation('execution_unavailable'),
    /不能运行 AI 工具/u,
  )
})

test('unknown device facts are not treated as ready', () => {
  assert.equal(
    selectFixedProjectCreationMachine(undefined, local.machineId).state,
    'loading',
  )
  assert.equal(
    selectFixedProjectCreationMachine([], undefined).state,
    'unselected',
  )
  assert.equal(chooseInitialProjectMachineId(undefined), undefined)
})

test('a local project uses only the canonical local creation action', async () => {
  const calls = []
  const runtime = actions(calls)
  const response = await createProjectForMachine(runtime, local, {
    path: 'C:\\工作区\\有 空格',
    name: '我的项目',
  })
  assert.deepEqual(calls, [['local', 'C:\\工作区\\有 空格', '我的项目']])
  assert.equal(response.data.created, true)
})

test('a paired project uses only the exact remote creation action and complete input path', async () => {
  const calls = []
  await createProjectForMachine(actions(calls), remote, {
    path: '/home/test/有 空格',
  })
  assert.deepEqual(calls, [
    ['remote', remote.machineId, { rootPath: '/home/test/有 空格' }],
  ])
})

test('machine readiness is checked immediately before submission without any alternative action', async () => {
  const calls = []
  const offline = {
    ...remote,
    availability: 'unavailable',
    connectionState: 'offline',
  }
  await assert.rejects(
    createProjectForMachine(actions(calls), offline, { path: '/srv/test' }),
    /not available/u,
  )
  assert.deepEqual(calls, [])
})

test('a failed remote registration does not fall back to local registration', async () => {
  const calls = []
  const failure = new Error('fixture failure')
  const runtime = actions(calls)
  runtime.createRemoteProject = async (id) => {
    calls.push(['failed-remote', id])
    throw failure
  }
  await assert.rejects(
    createProjectForMachine(runtime, remote, { path: '/srv/test' }),
    (error) => error === failure,
  )
  assert.deepEqual(calls, [['failed-remote', remote.machineId]])
})

test('duplicate canonical folder responses open the original project without a discovery step', () => {
  assert.equal(nextProjectCreationStep(false, false), 'finished')
  assert.equal(nextProjectCreationStep(false, true), 'finished')
})

test('fresh projects show discovery while onboarding may defer it to its existing durable step', () => {
  assert.equal(nextProjectCreationStep(true, false), 'previous_conversations')
  assert.equal(nextProjectCreationStep(true, true), 'finished')
})

function actions(calls) {
  return {
    async createProject(path, name) {
      calls.push(['local', path, name])
      return { data: { created: true } }
    },
    async createRemoteProject(machineId, input) {
      calls.push(['remote', machineId, input])
      return { data: { created: true } }
    },
  }
}

function machine(machineId, kind) {
  return {
    machineId,
    kind,
    displayName: kind === 'local' ? '这台电脑' : '配对设备',
    platform: kind === 'local' ? 'windows' : 'linux',
    architecture: 'x64',
    availability: 'available',
    connectionState: kind === 'local' ? 'local' : 'online',
    trustState: kind === 'local' ? 'local' : 'trusted',
    isLocal: kind === 'local',
    createdAt: '2026-10-18T00:00:00.000Z',
    capabilities: {
      projectAccess: true,
      providerExecution: true,
      backgroundRuntime: true,
      nativeFolderPicker: kind === 'local',
      notifications: false,
    },
  }
}
