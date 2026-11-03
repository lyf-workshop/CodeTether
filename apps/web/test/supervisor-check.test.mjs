import assert from 'node:assert/strict'
import test from 'node:test'

import {
  runSupervisorCheck,
  supervisorCheckOperations,
} from '../.tmp/test-dist/dev/supervisor-check-model.js'

function fixture(overrides = {}) {
  const calls = []
  const connection = {
    transport: 'relay',
    bootstrap: async () => {
      calls.push('host.bootstrap')
    },
    machines: async () => {
      calls.push('machine.list')
      return ['machine_one']
    },
    machine: async (machineId) => {
      calls.push('machine.get')
      assert.equal(machineId, 'machine_one')
    },
    projects: async (machineId) => {
      calls.push('project.list')
      assert.equal(machineId, 'machine_one')
      return ['proj_one']
    },
    conversations: async (machineId, projectId) => {
      calls.push('conversation.list')
      assert.equal(machineId, 'machine_one')
      assert.equal(projectId, 'proj_one')
      return ['conv_one']
    },
    conversation: async (...ids) => {
      calls.push('conversation.get')
      assert.deepEqual(ids.slice(0, 3), ['machine_one', 'proj_one', 'conv_one'])
    },
    history: async (...ids) => {
      calls.push('conversation.history')
      assert.deepEqual(ids.slice(0, 3), ['machine_one', 'proj_one', 'conv_one'])
    },
    close: async () => {
      calls.push('close')
    },
    ...overrides,
  }
  return {
    calls,
    connection,
    connect: async () => {
      calls.push('connect')
      return connection
    },
  }
}

test('Supervisor check runs exactly seven ordered reads and releases its connection', async () => {
  const { calls, connect } = fixture()
  let clock = 0
  const snapshots = []
  const result = await runSupervisorCheck({
    connect,
    forceRelay: true,
    signal: new AbortController().signal,
    now: () => (clock += 2),
    onProgress: (value) => snapshots.push(value),
  })
  assert.deepEqual(calls, ['connect', ...supervisorCheckOperations, 'close'])
  assert.equal(result.connection.status, 'success')
  assert.equal(result.cleanup.status, 'success')
  assert.equal(result.steps.length, 7)
  assert.ok(
    result.steps.every(
      (step) =>
        step.status === 'success' &&
        step.transport === 'relay' &&
        step.elapsedMs === 2,
    ),
  )
  assert.equal(snapshots[0].connection.status, 'running')
  assert.equal(
    snapshots[0].steps[0].status,
    'pending',
    'progress snapshots stay immutable',
  )
})

test('automatic mode reports Direct while forced Relay rejects a Direct result and closes it', async () => {
  for (const forceRelay of [false, true]) {
    const { calls, connect } = fixture({ transport: 'direct' })
    const result = await runSupervisorCheck({
      connect,
      forceRelay,
      signal: new AbortController().signal,
    })
    assert.equal(result.connection.status, forceRelay ? 'failed' : 'success')
    assert.equal(
      result.connection.error,
      forceRelay ? 'unexpected_transport' : null,
    )
    assert.deepEqual(
      calls,
      forceRelay
        ? ['connect', 'close']
        : ['connect', ...supervisorCheckOperations, 'close'],
    )
  }
})

test('empty Machine, Project and Conversation directories never manufacture downstream success', async () => {
  for (const [method, operation, lastIndex, reason] of [
    ['machines', 'machine.list', 1, 'no_machine'],
    ['projects', 'project.list', 3, 'no_project'],
    ['conversations', 'conversation.list', 4, 'no_conversation'],
  ]) {
    const { calls, connect } = fixture({
      [method]: async () => {
        calls.push(operation)
        return []
      },
    })
    const result = await runSupervisorCheck({
      connect,
      forceRelay: true,
      signal: new AbortController().signal,
    })
    assert.deepEqual(calls, [
      'connect',
      ...supervisorCheckOperations.slice(0, lastIndex + 1),
      'close',
    ])
    assert.equal(result.steps[lastIndex].status, 'success')
    assert.ok(
      result.steps
        .slice(lastIndex + 1)
        .every(
          (step) =>
            step.status === 'skipped' &&
            step.error === reason &&
            step.elapsedMs === null,
        ),
    )
  }
})

test('raw errors and read payloads never enter published or returned diagnostic results', async () => {
  const forbidden =
    'private conversation title; prompt; D:/private/project; bearer-secret'
  const { calls, connect } = fixture({
    bootstrap: async () => {
      calls.push('host.bootstrap')
      return { title: forbidden, input: forbidden, path: forbidden }
    },
    machine: async () => {
      calls.push('machine.get')
      throw new Error(forbidden)
    },
  })
  const snapshots = []
  const result = await runSupervisorCheck({
    connect,
    forceRelay: false,
    signal: new AbortController().signal,
    onProgress: (value) => snapshots.push(value),
  })
  assert.equal(result.steps[2].error, 'request_failed')
  assert.ok(
    result.steps
      .slice(3)
      .every(
        (step) =>
          step.status === 'skipped' && step.error === 'previous_step_failed',
      ),
  )
  assert.ok(!JSON.stringify({ snapshots, result }).includes(forbidden))
  assert.deepEqual(calls, [
    'connect',
    'host.bootstrap',
    'machine.list',
    'machine.get',
    'close',
  ])
})

test('pre-cancelled checks create no connection', async () => {
  const controller = new AbortController()
  controller.abort()
  const { calls, connect } = fixture()
  const result = await runSupervisorCheck({
    connect,
    forceRelay: true,
    signal: controller.signal,
  })
  assert.deepEqual(calls, [])
  assert.equal(result.connection.error, 'cancelled')
  assert.ok(
    result.steps.every(
      (step) => step.status === 'skipped' && step.error === 'cancelled',
    ),
  )
})

test('cancelling during a late connect or read still releases exactly its own connection', async () => {
  for (const duringConnect of [true, false]) {
    const controller = new AbortController()
    let finish
    const pending = new Promise((resolve) => {
      finish = resolve
    })
    const { calls, connection, connect } = fixture({
      machines: async () => {
        calls.push('machine.list')
        await pending
        return ['machine_one']
      },
    })
    const checking = runSupervisorCheck({
      connect: duringConnect
        ? async () => {
            calls.push('connect')
            await pending
            return connection
          }
        : connect,
      forceRelay: true,
      signal: controller.signal,
    })
    await new Promise((resolve) => setImmediate(resolve))
    controller.abort()
    finish()
    const result = await checking
    assert.deepEqual(
      calls,
      duringConnect
        ? ['connect', 'close']
        : ['connect', 'host.bootstrap', 'machine.list', 'close'],
    )
    assert.equal(result.cleanup.status, 'success')
    assert.equal(
      duringConnect ? result.connection.error : result.steps[1].error,
      'cancelled',
    )
  }
})

test('cleanup failure is visible as a bounded failure instead of a successful release', async () => {
  const { connect } = fixture({
    close: async () => {
      throw new Error('private cleanup error')
    },
  })
  const result = await runSupervisorCheck({
    connect,
    forceRelay: true,
    signal: new AbortController().signal,
  })
  assert.equal(result.cleanup.status, 'failed')
  assert.equal(result.cleanup.error, 'request_failed')
  assert.ok(!JSON.stringify(result).includes('private cleanup error'))
})
