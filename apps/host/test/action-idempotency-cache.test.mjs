import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ActionIdConflictError,
  ActionIdempotencyCache,
  ActionIdempotencyCapacityError,
} from '../dist/api/action-idempotency-cache.js'

test('returns the original Promise and result for an identical action', async () => {
  const cache = new ActionIdempotencyCache()
  let executions = 0
  const run = () => {
    executions += 1
    return { conversationId: 'conversation-a' }
  }

  const first = cache.execute(
    'action-a',
    'conversation.create',
    { projectId: 'project-a', options: { model: 'gpt-5' } },
    run,
  )
  const duplicate = cache.execute(
    'action-a',
    'conversation.create',
    { options: { model: 'gpt-5' }, projectId: 'project-a' },
    run,
  )

  assert.equal(duplicate, first)
  assert.equal(await duplicate, await first)
  assert.equal(executions, 1)
})

test('rejects action id reuse with another operation or input', async () => {
  const cache = new ActionIdempotencyCache()
  await cache.execute('action-a', 'turn.start', { prompt: 'first' }, () => 'ok')

  await assert.rejects(
    cache.execute('action-a', 'turn.start', { prompt: 'second' }, () => 'bad'),
    ActionIdConflictError,
  )
  await assert.rejects(
    cache.execute(
      'action-a',
      'turn.interrupt',
      { prompt: 'first' },
      () => 'bad',
    ),
    ActionIdConflictError,
  )
})

test('replays the original rejected Promise without executing again', async () => {
  const cache = new ActionIdempotencyCache()
  const failure = new Error('provider failed')
  let executions = 0
  const run = () => {
    executions += 1
    throw failure
  }

  const first = cache.execute('action-failed', 'turn.start', {}, run)
  const duplicate = cache.execute('action-failed', 'turn.start', {}, run)

  assert.equal(duplicate, first)
  await assert.rejects(first, (error) => error === failure)
  await assert.rejects(duplicate, (error) => error === failure)
  assert.equal(executions, 1)
})

test('evicts the oldest settled action and keeps the cache bounded', async () => {
  const cache = new ActionIdempotencyCache({ maxActions: 2 })
  await cache.execute('action-a', 'turn.start', { value: 1 }, () => 'a')
  await cache.execute('action-b', 'turn.start', { value: 2 }, () => 'b')
  await cache.execute('action-c', 'turn.start', { value: 3 }, () => 'c')

  assert.equal(cache.size, 2)
  let executions = 0
  assert.equal(
    await cache.execute('action-a', 'turn.start', { value: 1 }, () => {
      executions += 1
      return 'new-a'
    }),
    'new-a',
  )
  assert.equal(executions, 1)
  assert.equal(cache.size, 2)
})

test('fails at capacity rather than evicting an in-flight action', async () => {
  const cache = new ActionIdempotencyCache({ maxActions: 1 })
  let resolvePending
  const pending = cache.execute(
    'action-pending',
    'turn.start',
    {},
    () =>
      new Promise((resolve) => {
        resolvePending = resolve
      }),
  )

  await assert.rejects(
    cache.execute('action-next', 'turn.start', {}, () => 'unsafe'),
    ActionIdempotencyCapacityError,
  )
  assert.equal(cache.size, 1)
  resolvePending('done')
  assert.equal(await pending, 'done')
})
