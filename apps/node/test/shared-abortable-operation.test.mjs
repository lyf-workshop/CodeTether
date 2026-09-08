import assert from 'node:assert/strict'
import test from 'node:test'

import {
  armAbortDeadline,
  consumeSharedAbortableOperation,
} from '../dist/shared-abortable-operation.js'

test('a pre-aborted sole consumer aborts and awaits exact cleanup', async () => {
  const owner = new AbortController()
  let cleanupComplete = false
  const task = new Promise((_, reject) => {
    owner.signal.addEventListener(
      'abort',
      () => {
        setTimeout(() => {
          cleanupComplete = true
          reject(owner.signal.reason)
        }, 20)
      },
      { once: true },
    )
  })
  const operation = {
    abort: owner,
    task,
    consumers: 0,
    persistentConsumer: false,
    settled: false,
  }
  const caller = new AbortController()
  caller.abort(new DOMException('caller closed', 'AbortError'))

  const joined = consumeSharedAbortableOperation(operation, caller.signal)
  assert.equal(owner.signal.aborted, true)
  assert.equal(cleanupComplete, false)
  await assert.rejects(joined, (error) => error?.name === 'AbortError')
  assert.equal(cleanupComplete, true)
})

test('a pre-aborted sole consumer preserves exact cleanup failure', async () => {
  const owner = new AbortController()
  const cleanupFailure = new Error('test-owned exact cleanup failure')
  const task = new Promise((_, reject) => {
    owner.signal.addEventListener(
      'abort',
      () => setTimeout(() => reject(cleanupFailure), 10),
      { once: true },
    )
  })
  const operation = {
    abort: owner,
    task,
    consumers: 0,
    persistentConsumer: false,
    settled: false,
  }
  const caller = new AbortController()
  caller.abort(new DOMException('caller closed', 'AbortError'))

  await assert.rejects(
    consumeSharedAbortableOperation(operation, caller.signal),
    (error) => error === cleanupFailure,
  )
  assert.equal(owner.signal.aborted, true)
})

test('one cancelled consumer does not cancel another authenticated consumer', async () => {
  const owner = new AbortController()
  let complete
  const task = new Promise((resolve) => {
    complete = resolve
  })
  const operation = {
    abort: owner,
    task,
    consumers: 0,
    persistentConsumer: false,
    settled: false,
  }
  const firstAbort = new AbortController()
  const secondAbort = new AbortController()
  const first = consumeSharedAbortableOperation(operation, firstAbort.signal)
  const second = consumeSharedAbortableOperation(operation, secondAbort.signal)

  firstAbort.abort()
  await assert.rejects(first, (error) => error?.name === 'AbortError')
  assert.equal(owner.signal.aborted, false)
  assert.equal(operation.consumers, 1)
  operation.settled = true
  complete('ready')
  assert.equal(await second, 'ready')
  assert.equal(operation.consumers, 0)
})

test('the final cancelled consumer preserves exact cleanup failure', async () => {
  const owner = new AbortController()
  const cleanupFailure = new Error('test-owned exact cleanup failure')
  const task = new Promise((_, reject) => {
    owner.signal.addEventListener(
      'abort',
      () => setTimeout(() => reject(cleanupFailure), 10),
      { once: true },
    )
  })
  const operation = {
    abort: owner,
    task,
    consumers: 0,
    persistentConsumer: false,
    settled: false,
  }
  const caller = new AbortController()
  const joined = consumeSharedAbortableOperation(operation, caller.signal)
  caller.abort(new DOMException('caller closed', 'AbortError'))

  await assert.rejects(joined, (error) => error === cleanupFailure)
  assert.equal(owner.signal.aborted, true)
  assert.equal(operation.consumers, 0)
})

test('creation deadline is cleared on another cancellation and cannot steal classification', async () => {
  const owner = new AbortController()
  const deadline = armAbortDeadline(owner, 20)
  owner.abort(new DOMException('connection closed', 'AbortError'))
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.equal(deadline.expired(), false)
  deadline.clear()
})
