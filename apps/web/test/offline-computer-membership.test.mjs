import assert from 'node:assert/strict'
import test from 'node:test'
import { OfflineComputerMembership } from '../.tmp/test-dist/components/machines/offline-computer-membership.js'

const remote = { machineId: 'machine_remote', kind: 'remote' }

test('an offline computer stays grouped through reconnect attempts', () => {
  const membership = new OfflineComputerMembership()
  for (const connectionState of [
    'offline',
    'connecting',
    'offline',
    'connecting',
  ]) {
    assert.equal(membership.isGrouped({ ...remote, connectionState }), true)
  }
  assert.equal(
    membership.isGrouped({ ...remote, connectionState: 'online' }),
    false,
  )
  assert.equal(
    membership.isGrouped({ ...remote, connectionState: 'connecting' }),
    false,
  )
})

test('a newly connecting computer and the local computer stay outside the group', () => {
  const membership = new OfflineComputerMembership()
  assert.equal(
    membership.isGrouped({ ...remote, connectionState: 'connecting' }),
    false,
  )
  assert.equal(
    membership.isGrouped({
      machineId: 'machine_local',
      kind: 'local',
      connectionState: 'offline',
    }),
    false,
  )
})

test('a computer needing action leaves the offline group until it is offline again', () => {
  for (const connectionState of [
    'authentication_failed',
    'recovery_required',
    'incompatible',
  ]) {
    const membership = new OfflineComputerMembership()
    assert.equal(
      membership.isGrouped({ ...remote, connectionState: 'offline' }),
      true,
    )
    assert.equal(membership.isGrouped({ ...remote, connectionState }), false)
    assert.equal(
      membership.isGrouped({ ...remote, connectionState: 'connecting' }),
      false,
    )
    assert.equal(
      membership.isGrouped({ ...remote, connectionState: 'offline' }),
      true,
    )
  }
})
