import assert from 'node:assert/strict'
import test from 'node:test'

import { TurnLifecycleRegistry } from '../dist/turn-lifecycle.js'

test('releases turn-scoped message and terminal state after consumption', async () => {
  const released = []
  const registry = new TurnLifecycleRegistry((threadId, turnId) =>
    released.push(`${threadId}:${turnId}`),
  )
  registry.activate('thread-a', 'turn-a')
  registry.completeMessage('thread-a', 'turn-a', 'hello')
  registry.settle({
    threadId: 'thread-a',
    turn: { id: 'turn-a', status: 'completed', error: null },
    finalMessage: registry.finalMessage('thread-a', 'turn-a'),
  })
  // turn/started and turn/start response can activate the same turn in either
  // order; a late duplicate activation must not discard the terminal result.
  registry.activate('thread-a', 'turn-a')

  assert.equal(registry.retainedTurnCount, 1)
  assert.equal(
    (await registry.wait('thread-a', 'turn-a', 1_000)).finalMessage,
    'hello',
  )
  assert.equal(registry.retainedTurnCount, 0)
  assert.equal(registry.activeTurnCount, 0)
  assert.deepEqual(released, ['thread-a:turn-a'])
})

test('keeps other threads and a newer active turn isolated', async () => {
  const registry = new TurnLifecycleRegistry()
  registry.activate('thread-a', 'turn-old')
  registry.activate('thread-a', 'turn-new')
  registry.activate('thread-b', 'turn-b')
  const waiterB = registry.wait('thread-b', 'turn-b', 1_000)

  registry.settle({
    threadId: 'thread-a',
    turn: { id: 'turn-old', status: 'completed', error: null },
  })
  assert.equal(registry.activeTurn('thread-a'), 'turn-new')
  assert.equal(registry.activeTurn('thread-b'), 'turn-b')

  registry.settle({
    threadId: 'thread-b',
    turn: { id: 'turn-b', status: 'completed', error: null },
  })
  assert.equal((await waiterB).turn.id, 'turn-b')
  assert.equal(registry.activeTurn('thread-a'), 'turn-new')
})

test('releases timed-out state and ignores a late terminal result', async () => {
  const released = []
  const registry = new TurnLifecycleRegistry((threadId, turnId) =>
    released.push(`${threadId}:${turnId}`),
  )
  registry.activate('thread-timeout', 'turn-timeout')
  registry.completeMessage('thread-timeout', 'turn-timeout', 'partial')

  await assert.rejects(
    registry.wait('thread-timeout', 'turn-timeout', 1),
    /Timed out waiting for turn turn-timeout/,
  )
  assert.equal(registry.retainedTurnCount, 0)
  assert.equal(registry.waiterCount, 0)
  assert.equal(registry.activeTurn('thread-timeout'), 'turn-timeout')
  assert.deepEqual(released, ['thread-timeout:turn-timeout'])

  registry.completeMessage('thread-timeout', 'turn-timeout', 'ignored')
  registry.settle({
    threadId: 'thread-timeout',
    turn: { id: 'turn-timeout', status: 'completed', error: null },
  })

  assert.equal(registry.activeTurn('thread-timeout'), undefined)
  assert.equal(registry.retainedTurnCount, 0)
  assert.deepEqual(released, ['thread-timeout:turn-timeout'])
  await assert.rejects(
    registry.wait('thread-timeout', 'turn-timeout', 1_000),
    /terminal result is no longer available/,
  )
})

test('ignores duplicate terminal results after a waiter consumes the turn', async () => {
  const registry = new TurnLifecycleRegistry()
  registry.activate('thread-duplicate', 'turn-duplicate')
  const waiter = registry.wait('thread-duplicate', 'turn-duplicate', 1_000)
  const result = {
    threadId: 'thread-duplicate',
    turn: { id: 'turn-duplicate', status: 'completed', error: null },
  }

  registry.settle(result)
  assert.equal((await waiter).turn.id, 'turn-duplicate')
  assert.equal(registry.retainedTurnCount, 0)

  registry.settle(result)
  registry.completeMessage('thread-duplicate', 'turn-duplicate', 'ignored')
  assert.equal(registry.retainedTurnCount, 0)
  await assert.rejects(
    registry.wait('thread-duplicate', 'turn-duplicate', 1_000),
    /terminal result is no longer available/,
  )
})

test('bounds unconsumed terminal results while preserving recent results', async () => {
  const registry = new TurnLifecycleRegistry()

  for (let index = 0; index < 65; index += 1) {
    registry.settle({
      threadId: 'thread-cache',
      turn: { id: `turn-${index}`, status: 'completed', error: null },
    })
  }

  assert.equal(registry.retainedTurnCount, 64)
  await assert.rejects(
    registry.wait('thread-cache', 'turn-0', 1_000),
    /terminal result is no longer available/,
  )
  assert.equal(
    (await registry.wait('thread-cache', 'turn-64', 1_000)).turn.id,
    'turn-64',
  )
  assert.equal(registry.retainedTurnCount, 63)
})

test('rejects and clears all waiters and state on runtime failure', async () => {
  const registry = new TurnLifecycleRegistry()
  registry.activate('thread-a', 'turn-a')
  registry.activate('thread-b', 'turn-b')
  const waiterA = registry.wait('thread-a', 'turn-a', 60_000)
  const waiterB = registry.wait('thread-b', 'turn-b', 60_000)
  const failure = new Error('runtime stopped')

  registry.failAll(failure)
  await assert.rejects(waiterA, (error) => error === failure)
  await assert.rejects(waiterB, (error) => error === failure)
  assert.equal(registry.waiterCount, 0)
  assert.equal(registry.retainedTurnCount, 0)
  assert.equal(registry.activeTurnCount, 0)
})
