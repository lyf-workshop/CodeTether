import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'

import {
  CodexInstallationIoTimeoutError,
  consumeCodexInstallationStream,
  createCodexInstallationIoDeadline,
} from '../dist/bounded-io.js'

test('bounds a filesystem operation that never settles', async () => {
  const deadline = createCodexInstallationIoDeadline(20)
  const startedAt = Date.now()
  try {
    await assert.rejects(
      deadline.run(() => new Promise(() => {})),
      CodexInstallationIoTimeoutError,
    )
    assert.ok(Date.now() - startedAt < 1_000)
  } finally {
    deadline.dispose()
  }
})

test('propagates authoritative cancellation without waiting for slow I/O', async () => {
  const controller = new AbortController()
  const reason = new Error('test cancellation')
  const deadline = createCodexInstallationIoDeadline(1_000, controller.signal)
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
  const deadline = createCodexInstallationIoDeadline(20)
  try {
    await assert.rejects(
      consumeCodexInstallationStream(stream, deadline, () => {}),
      CodexInstallationIoTimeoutError,
    )
    assert.equal(stream.destroyed, true)
    assert.equal(destroyCount, 1)
  } finally {
    deadline.dispose()
  }
})
