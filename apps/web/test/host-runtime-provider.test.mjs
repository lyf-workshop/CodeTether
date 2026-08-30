import assert from 'node:assert/strict'
import test from 'node:test'

import { subscribeRuntimeToDesktopResume } from '../.tmp/test-dist/runtime/host/desktop-resume-subscription.js'

test('Desktop resume listener is cleaned if StrictMode releases before async subscribe settles', async () => {
  let resolveSubscription
  const subscription = new Promise((resolve) => {
    resolveSubscription = resolve
  })
  let nativeCleanupCalls = 0
  const runtime = {
    recoverAfterDesktopResume() {
      assert.fail('an already released listener must not recover the runtime')
    },
  }
  const release = subscribeRuntimeToDesktopResume(runtime, {
    available: true,
    subscribeToResume: async () => await subscription,
  })

  release()
  resolveSubscription(() => {
    nativeCleanupCalls += 1
  })
  await subscription
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(nativeCleanupCalls, 1)
})

test('Desktop resume listener recovers only while its provider effect is active', async () => {
  let listener
  let nativeCleanupCalls = 0
  let recoveryCalls = 0
  let recoveredEpoch
  const release = subscribeRuntimeToDesktopResume(
    {
      recoverAfterDesktopResume(intent) {
        recoveryCalls += 1
        recoveredEpoch = intent.hostEpoch
      },
    },
    {
      available: true,
      async subscribeToResume(next) {
        listener = next
        return () => {
          nativeCleanupCalls += 1
        }
      },
    },
  )
  await new Promise((resolve) => setImmediate(resolve))

  listener({ hostEpoch: '11111111-1111-4111-8111-111111111111' })
  assert.equal(recoveryCalls, 1)
  assert.equal(recoveredEpoch, '11111111-1111-4111-8111-111111111111')
  release()
  listener({ hostEpoch: '11111111-1111-4111-8111-111111111111' })
  assert.equal(recoveryCalls, 1)
  assert.equal(nativeCleanupCalls, 1)
})

test('Desktop resume listener retries one transient registration failure', async () => {
  let registrationAttempts = 0
  let listener
  const recovered = []
  const release = subscribeRuntimeToDesktopResume(
    {
      recoverAfterDesktopResume(intent) {
        recovered.push(intent)
      },
    },
    {
      available: true,
      async subscribeToResume(next) {
        registrationAttempts += 1
        if (registrationAttempts === 1) {
          throw new Error('transient Tauri event registration failure')
        }
        listener = next
        return () => {
          listener = undefined
        }
      },
    },
  )

  await new Promise((resolve) => setTimeout(resolve, 300))
  assert.equal(registrationAttempts, 2)
  listener({ hostEpoch: '11111111-1111-4111-8111-111111111111' })
  assert.deepEqual(recovered, [
    { hostEpoch: '11111111-1111-4111-8111-111111111111' },
  ])
  release()
  assert.equal(listener, undefined)
})

test('Desktop resume listener cancellation prevents its bounded retry', async () => {
  let registrationAttempts = 0
  const release = subscribeRuntimeToDesktopResume(
    { recoverAfterDesktopResume() {} },
    {
      available: true,
      async subscribeToResume() {
        registrationAttempts += 1
        throw new Error('transient Tauri event registration failure')
      },
    },
  )

  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(registrationAttempts, 1)
  release()
  await new Promise((resolve) => setTimeout(resolve, 300))
  assert.equal(registrationAttempts, 1)
})
