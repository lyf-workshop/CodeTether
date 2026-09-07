import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DoctorRefreshCoordinator,
  refreshMachinesBounded,
} from '../.tmp/test-dist/runtime/host/doctor-refresh.js'

test('1,000 duplicate Doctor refresh signals share one owner', async () => {
  const pending = Promise.withResolvers()
  let taskCount = 0
  const coordinator = new DoctorRefreshCoordinator()
  const attempts = Array.from({ length: 1_000 }, () =>
    coordinator.run(async () => {
      taskCount += 1
      await pending.promise
    }),
  )

  assert.equal(taskCount, 1)
  assert.ok(attempts.every((attempt) => attempt === attempts[0]))
  pending.resolve()
  await Promise.all(attempts)

  await coordinator.run(async () => {
    taskCount += 1
  })
  assert.equal(taskCount, 2)
})

test('Doctor Machine refresh is deduplicated, capped, concurrency-bounded, and failure-isolated', async () => {
  const machineIds = [
    ...Array.from({ length: 70 }, (_, index) => `machine_doctor${index}`),
    'machine_doctor1',
    'machine_doctor2',
  ]
  const calls = []
  let active = 0
  let highWater = 0

  const result = await refreshMachinesBounded(machineIds, async (machineId) => {
    calls.push(machineId)
    active += 1
    highWater = Math.max(highWater, active)
    await new Promise((resolve) => setImmediate(resolve))
    active -= 1
    if (machineId === 'machine_doctor3') throw new Error('isolated fixture')
  })

  assert.equal(calls.length, 64)
  assert.equal(result.attempted, 64)
  assert.deepEqual(result.failedMachineIds, ['machine_doctor3'])
  assert.equal(new Set(calls).size, 64)
  assert.ok(highWater <= 2)
  assert.equal(active, 0)
})
