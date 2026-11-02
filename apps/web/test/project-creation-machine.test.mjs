import assert from 'node:assert/strict'
import test from 'node:test'
import {
  selectFixedProjectCreationMachine,
  fixedProjectCreationMachineExplanation,
} from '../.tmp/test-dist/components/projects/project-creation-machine.js'

const local = {
  machineId: 'machine_local',
  kind: 'local',
  availability: 'available',
  connectionState: 'local',
  capabilities: { projectAccess: true, providerExecution: true },
}
const remote = {
  machineId: 'machine_remote',
  kind: 'remote',
  availability: 'available',
  connectionState: 'online',
  capabilities: { projectAccess: true, providerExecution: true },
}

test('Project registration preserves the requested local or remote Device despite list order', () => {
  assert.equal(
    selectFixedProjectCreationMachine([remote, local], local.machineId).machine,
    local,
  )
  assert.equal(
    selectFixedProjectCreationMachine([local, remote], remote.machineId)
      .machine,
    remote,
  )
  assert.equal(
    selectFixedProjectCreationMachine([local, remote], remote.machineId).state,
    'ready',
  )
})

test('Missing exact Project Device never falls back to another available Device', () => {
  assert.deepEqual(
    selectFixedProjectCreationMachine([local], remote.machineId),
    { state: 'missing' },
  )
  assert.deepEqual(
    selectFixedProjectCreationMachine(undefined, remote.machineId),
    { state: 'loading' },
  )
})

test('Every non-online remote state blocks Project registration', () => {
  for (const connectionState of [
    'connecting',
    'offline',
    'recovery_required',
    'authentication_failed',
    'incompatible',
  ]) {
    const machine = { ...remote, connectionState }
    const result = selectFixedProjectCreationMachine(
      [local, machine],
      remote.machineId,
    )
    assert.equal(result.state, 'offline')
    assert.equal(result.machine, machine)
  }
  assert.equal(
    selectFixedProjectCreationMachine(
      [{ ...remote, availability: 'unavailable' }],
      remote.machineId,
    ).state,
    'offline',
  )
})

test('Project access remains an independent registration gate', () => {
  const machine = { ...remote, capabilities: { projectAccess: false } }
  const result = selectFixedProjectCreationMachine(
    [local, machine],
    remote.machineId,
  )
  assert.equal(result.state, 'project_access_unavailable')
  assert.equal(result.machine, machine)
})

test('Generic Add Project keeps the existing local flow without selecting a remote Device', () => {
  assert.deepEqual(selectFixedProjectCreationMachine([remote]), {
    state: 'unselected',
  })
  assert.deepEqual(selectFixedProjectCreationMachine(undefined), {
    state: 'unselected',
  })
})

test('Unavailable registration has an actionable explanation without private machine details', () => {
  for (const state of [
    'loading',
    'missing',
    'offline',
    'project_access_unavailable',
    'execution_unavailable',
  ])
    assert.equal(typeof fixedProjectCreationMachineExplanation(state), 'string')
  assert.equal(fixedProjectCreationMachineExplanation('ready'), undefined)
  assert.equal(fixedProjectCreationMachineExplanation('unselected'), undefined)
})
