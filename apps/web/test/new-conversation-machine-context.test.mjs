import assert from 'node:assert/strict'
import test from 'node:test'

import {
  newConversationMachineContextExplanation,
  selectNewConversationMachine,
} from '../.tmp/test-dist/components/conversations/new-conversation-machine-selection.js'

const localId = 'machine_local01'
const remoteId = 'machine_remote01'

test('generic launch preserves initial candidate and explicit user selection', () => {
  const machines = [machine(localId), machine(remoteId)]
  const initial = selectNewConversationMachine({ machines })
  assert.equal(initial.machineId, localId)
  assert.equal(initial.machine, machines[0])
  assert.equal(initial.contextIssue, undefined)

  const selected = selectNewConversationMachine({
    machines,
    selectedMachineId: remoteId,
  })
  assert.equal(selected.machineId, remoteId)
  assert.equal(selected.machine, machines[1])
})

test('exact launch wins over array order and previous user selection', () => {
  const machines = [machine(localId), machine(remoteId)]
  const selection = selectNewConversationMachine({
    machines,
    currentMachineId: remoteId,
    selectedMachineId: localId,
    currentProject: project(localId, remoteId),
  })
  assert.equal(selection.machineId, remoteId)
  assert.equal(selection.machine, machines[1])
  assert.equal(selection.contextIssue, undefined)
})

test('offline exact device remains selected while an eligible fallback exists', () => {
  const offline = machine(remoteId, { availability: 'unavailable' })
  const selection = selectNewConversationMachine({
    machines: [machine(localId), offline],
    currentMachineId: remoteId,
    currentProject: project(localId, remoteId),
  })
  assert.equal(selection.machineId, remoteId)
  assert.equal(selection.machine, offline)
  assert.deepEqual(
    selection.candidateMachines.map((item) => item.machineId),
    [localId],
  )
  assert.equal(selection.contextIssue, 'machine_unavailable')
  assert.match(
    newConversationMachineContextExplanation(selection.contextIssue),
    /所选电脑.*离线/u,
  )
})

test('missing exact device never selects the first eligible machine', () => {
  const selection = selectNewConversationMachine({
    machines: [machine(localId)],
    currentMachineId: remoteId,
    selectedMachineId: localId,
  })
  assert.equal(selection.machineId, remoteId)
  assert.equal(selection.machine, undefined)
  assert.equal(selection.contextIssue, 'machine_missing')
})

test('unloaded machine data retains exact identity without claiming it is missing', () => {
  const selection = selectNewConversationMachine({
    machines: undefined,
    currentMachineId: remoteId,
  })
  assert.equal(selection.machineId, remoteId)
  assert.equal(selection.machine, undefined)
  assert.equal(selection.contextIssue, undefined)
})

test('pinned project requires its exact device location despite another available location', () => {
  const selection = selectNewConversationMachine({
    machines: [machine(localId), machine(remoteId)],
    currentMachineId: remoteId,
    currentProject: project(localId),
  })
  assert.equal(selection.machineId, remoteId)
  assert.equal(selection.contextIssue, 'project_location_missing')
  assert.match(
    newConversationMachineContextExplanation(selection.contextIssue),
    /所选电脑.*没有.*工作区位置/u,
  )
})

test('unavailable exact location cannot borrow another device location availability', () => {
  const currentProject = project(localId, remoteId)
  currentProject.locations[1].availability = 'unavailable'
  const selection = selectNewConversationMachine({
    machines: [machine(localId), machine(remoteId)],
    currentMachineId: remoteId,
    currentProject,
  })
  assert.equal(selection.machineId, remoteId)
  assert.equal(selection.contextIssue, 'project_location_unavailable')
})

test('exact launch reports machine capability gates independently', () => {
  for (const [capability, issue] of [
    ['projectAccess', 'project_access_unavailable'],
    ['providerExecution', 'provider_execution_unavailable'],
  ]) {
    const unavailable = machine(remoteId)
    unavailable.capabilities[capability] = false
    const selection = selectNewConversationMachine({
      machines: [machine(localId), unavailable],
      currentMachineId: remoteId,
      currentProject: project(localId, remoteId),
    })
    assert.equal(selection.machineId, remoteId)
    assert.equal(selection.machine, unavailable)
    assert.equal(selection.contextIssue, issue)
    assert.ok(newConversationMachineContextExplanation(issue))
  }
})

test('exact device removal and recovery follow the supplied list without fallback or mutation', () => {
  const local = Object.freeze(machine(localId))
  const remote = Object.freeze(machine(remoteId))
  const machines = Object.freeze([local, remote])
  const currentProject = Object.freeze({
    locations: Object.freeze(project(localId, remoteId).locations),
  })
  const input = { currentMachineId: remoteId, currentProject }
  assert.equal(
    selectNewConversationMachine({ ...input, machines }).machine,
    remote,
  )
  const removed = selectNewConversationMachine({ ...input, machines: [local] })
  assert.equal(removed.machine, undefined)
  assert.equal(removed.machineId, remoteId)
  assert.equal(removed.contextIssue, 'machine_missing')
  const recovered = selectNewConversationMachine({ ...input, machines })
  assert.equal(recovered.machine, remote)
  assert.equal(recovered.contextIssue, undefined)
  assert.deepEqual(machines, [local, remote])
})

function machine(machineId, overrides = {}) {
  return {
    machineId,
    kind: machineId === localId ? 'local' : 'remote',
    connectionState: machineId === localId ? 'local' : 'online',
    displayName: machineId === localId ? 'Local' : 'Remote',
    availability: 'available',
    capabilities: { projectAccess: true, providerExecution: true },
    ...overrides,
  }
}

test('exact remote connection state blocks creation even beside an available local Device', () => {
  for (const connectionState of [
    'connecting',
    'offline',
    'recovery_required',
    'authentication_failed',
    'incompatible',
  ]) {
    const remote = machine(remoteId, { connectionState })
    const selection = selectNewConversationMachine({
      machines: [machine(localId), remote],
      currentMachineId: remoteId,
    })
    assert.equal(selection.machineId, remoteId)
    assert.equal(selection.machine, remote)
    assert.equal(selection.contextIssue, 'machine_unavailable')
  }
})

function project(...machineIds) {
  return {
    locations: machineIds.map((machineId) => ({
      machineId,
      rootPath: machineId === localId ? 'C:\\work\\project' : '/work/project',
      availability: 'available',
    })),
  }
}
