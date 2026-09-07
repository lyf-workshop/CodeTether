import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'

import {
  ClaudeInstallationIoTimeoutError,
  consumeClaudeInstallationStream,
  createClaudeInstallationIoDeadline,
} from '../dist/bounded-io.js'

test('bounds a filesystem operation that never settles', async () => {
  const deadline = createClaudeInstallationIoDeadline(20)
  const startedAt = Date.now()
  try {
    await assert.rejects(
      deadline.run(() => new Promise(() => {})),
      ClaudeInstallationIoTimeoutError,
    )
    assert.ok(Date.now() - startedAt < 1_000)
  } finally {
    deadline.dispose()
  }
})

test('propagates authoritative cancellation without waiting for slow I/O', async () => {
  const controller = new AbortController()
  const reason = new Error('test cancellation')
  const deadline = createClaudeInstallationIoDeadline(1_000, controller.signal)
  try {
    const operation = deadline.run(() => new Promise(() => {}))
    controller.abort(reason)
    await assert.rejects(operation, (error) => error === reason)
  } finally {
    deadline.dispose()
  }
})

test('destroys a stalled revision stream after its elapsed bound', async () => {
  let destroyCount = 0
  const stream = new Readable({
    read() {},
    destroy(error, callback) {
      destroyCount += 1
      callback(error)
    },
  })
  const deadline = createClaudeInstallationIoDeadline(20)
  try {
    await assert.rejects(
      consumeClaudeInstallationStream(stream, deadline, () => {}),
      ClaudeInstallationIoTimeoutError,
    )
    assert.equal(stream.destroyed, true)
    assert.equal(destroyCount, 1)
  } finally {
    deadline.dispose()
  }
})
