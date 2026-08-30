import assert from 'node:assert/strict'
import test from 'node:test'

import { createNativeCapabilities } from '../.tmp/test-dist/runtime/native/native-capabilities.js'

const intent = {
  attentionId: 'attn_123456',
  type: 'completed_review',
  projectId: 'proj_123456',
  conversationId: 'conv_123456',
  turnId: 'turn_123456',
  title: 'CodeTether · 工作已完成',
  body: '中文项目 · 修复自动重连\n智能体已完成本轮工作',
}

test('Browser notifications stay unavailable without loading Tauri modules', async () => {
  let loads = 0
  const capabilities = createNativeCapabilities({
    tauriAvailable: false,
    loadTauriCore: async () => {
      loads += 1
      throw new Error('Browser must not load Tauri core')
    },
    loadTauriEvent: async () => {
      loads += 1
      throw new Error('Browser must not load Tauri events')
    },
    loadTauriNotification: async () => {
      loads += 1
      throw new Error('Browser must not load the notification plugin')
    },
    loadTauriWindow: async () => {
      loads += 1
      throw new Error('Browser must not load the Tauri window API')
    },
  })

  assert.equal(capabilities.notifications.available, false)
  assert.equal(capabilities.backgroundRuntime.available, false)
  assert.equal(
    typeof (await capabilities.backgroundRuntime.subscribeToResume(() => {})),
    'function',
  )
  assert.equal(await capabilities.notifications.ensurePermission(), false)
  assert.deepEqual(capabilities.notifications.getWindowState(), {
    focused: false,
    minimized: false,
    visible: false,
  })
  assert.equal(
    typeof (await capabilities.notifications.subscribeToIntents(() => {})),
    'function',
  )
  await assert.rejects(
    capabilities.notifications.deliver(intent),
    /unavailable/u,
  )
  assert.equal(loads, 0)
})

test('Desktop detects background runtime without invoking native code', () => {
  let coreLoads = 0
  const capabilities = createNativeCapabilities({
    tauriAvailable: true,
    loadTauriCore: async () => {
      coreLoads += 1
      throw new Error('Capability detection must not invoke native code')
    },
  })

  assert.equal(capabilities.backgroundRuntime.available, true)
  assert.equal(coreLoads, 0)
})

test('Desktop background runtime exposes only one bounded resume event', async () => {
  const hostEpoch = '11111111-1111-4111-8111-111111111111'
  let listener
  let unlistenCalls = 0
  const received = []
  const capabilities = createNativeCapabilities({
    tauriAvailable: true,
    loadTauriEvent: async () => ({
      listen: async (event, next) => {
        assert.equal(event, 'codetether://desktop-resumed')
        listener = next
        return () => {
          unlistenCalls += 1
        }
      },
    }),
  })

  const unsubscribe = await capabilities.backgroundRuntime.subscribeToResume(
    (intent) => received.push(intent.hostEpoch),
  )
  listener({ payload: { hostEpoch } })
  assert.deepEqual(received, [hostEpoch])
  unsubscribe()
  assert.equal(unlistenCalls, 1)
})

test('Desktop window state uses native getters instead of stale WebView state', async () => {
  const calls = []
  const capabilities = createNativeCapabilities({
    tauriAvailable: true,
    loadTauriWindow: async () => ({
      getCurrentWindow: () => ({
        isFocused: async () => {
          calls.push('focused')
          return true
        },
        isMinimized: async () => {
          calls.push('minimized')
          return true
        },
        isVisible: async () => {
          calls.push('visible')
          return true
        },
      }),
    }),
  })

  assert.deepEqual(await capabilities.notifications.getWindowState(), {
    focused: true,
    minimized: true,
    visible: true,
  })
  assert.deepEqual(calls.sort(), ['focused', 'minimized', 'visible'])
})

test('Desktop permission is requested lazily and concurrent checks are shared', async () => {
  let pluginLoads = 0
  let permissionChecks = 0
  let permissionRequests = 0
  let resolvePermission
  const permission = new Promise((resolve) => {
    resolvePermission = resolve
  })
  const capabilities = createNativeCapabilities({
    tauriAvailable: true,
    loadTauriNotification: async () => {
      pluginLoads += 1
      return {
        isPermissionGranted: async () => {
          permissionChecks += 1
          return false
        },
        requestPermission: async () => {
          permissionRequests += 1
          return await permission
        },
      }
    },
  })

  assert.equal(pluginLoads, 0)
  const first = capabilities.notifications.ensurePermission()
  const second = capabilities.notifications.ensurePermission()
  assert.strictEqual(second, first)
  resolvePermission('granted')
  assert.equal(await first, true)
  assert.equal(pluginLoads, 1)
  assert.equal(permissionChecks, 1)
  assert.equal(permissionRequests, 1)
  assert.equal(await capabilities.notifications.ensurePermission(), true)
  assert.equal(pluginLoads, 1)
})

test('Desktop delivery invokes only the bounded Attention command', async () => {
  const calls = []
  const capabilities = createNativeCapabilities({
    tauriAvailable: true,
    loadTauriCore: async () => ({
      invoke: async (command, args) => {
        calls.push({ command, args })
      },
    }),
  })

  await capabilities.notifications.deliver(intent)
  assert.deepEqual(calls, [
    {
      command: 'deliver_attention_notification',
      args: { intent },
    },
  ])
})

test('Notification click listener drains queued intents and cleans up once', async () => {
  const queued = [intent, null]
  const received = []
  let eventListener
  let unlistenCalls = 0
  const capabilities = createNativeCapabilities({
    tauriAvailable: true,
    loadTauriCore: async () => ({
      invoke: async (command) => {
        assert.equal(command, 'take_pending_notification_intent')
        return queued.shift() ?? null
      },
    }),
    loadTauriEvent: async () => ({
      listen: async (event, listener) => {
        assert.equal(event, 'codetether://notification-intent')
        eventListener = listener
        return () => {
          unlistenCalls += 1
        }
      },
    }),
  })

  const unsubscribe = await capabilities.notifications.subscribeToIntents(
    (value) => {
      received.push(value)
    },
  )
  assert.deepEqual(received, [intent])

  queued.push({ ...intent, attentionId: 'attn_654321' }, null)
  eventListener({ payload: null })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(
    received.map(({ attentionId }) => attentionId),
    ['attn_123456', 'attn_654321'],
  )

  unsubscribe()
  assert.equal(unlistenCalls, 1)
})

test('Desktop notification subscription holds one background execution lease', async () => {
  let leases = 0
  let releases = 0
  const capabilities = createNativeCapabilities({
    tauriAvailable: true,
    acquireBackgroundExecutionLease: () => {
      leases += 1
      return () => {
        releases += 1
      }
    },
    loadTauriCore: async () => ({
      invoke: async (command) => {
        assert.equal(command, 'take_pending_notification_intent')
        return null
      },
    }),
    loadTauriEvent: async () => ({
      listen: async () => () => undefined,
    }),
  })

  const unsubscribe = await capabilities.notifications.subscribeToIntents(
    () => undefined,
  )
  assert.equal(leases, 1)
  assert.equal(releases, 0)

  unsubscribe()
  unsubscribe()
  assert.equal(releases, 1)
})

test('Notification click wake-up cannot be lost while an empty drain settles', async () => {
  const firstTake = deferred()
  const queued = []
  const received = []
  let eventListener
  let takeCalls = 0
  const capabilities = createNativeCapabilities({
    tauriAvailable: true,
    loadTauriCore: async () => ({
      invoke: async (command) => {
        assert.equal(command, 'take_pending_notification_intent')
        takeCalls += 1
        if (takeCalls === 1) return await firstTake.promise
        return queued.shift() ?? null
      },
    }),
    loadTauriEvent: async () => ({
      listen: async (_event, listener) => {
        eventListener = listener
        return () => undefined
      },
    }),
  })

  const subscription = capabilities.notifications.subscribeToIntents(
    (value) => {
      received.push(value)
    },
  )
  await waitFor(() => eventListener !== undefined && takeCalls === 1)

  queued.push({ ...intent, attentionId: 'attn_race_click01' })
  firstTake.resolve(null)
  eventListener({ payload: null })

  const unsubscribe = await subscription
  await waitFor(() => received.length === 1)
  assert.equal(received[0].attentionId, 'attn_race_click01')
  unsubscribe()
})

test('Typed click event and native queue fallback deliver one intent', async () => {
  const queued = [null]
  const received = []
  let eventListener
  const capabilities = createNativeCapabilities({
    tauriAvailable: true,
    loadTauriCore: async () => ({
      invoke: async (command) => {
        assert.equal(command, 'take_pending_notification_intent')
        return queued.shift() ?? null
      },
    }),
    loadTauriEvent: async () => ({
      listen: async (_event, listener) => {
        eventListener = listener
        return () => undefined
      },
    }),
  })

  const unsubscribe = await capabilities.notifications.subscribeToIntents(
    (value) => {
      received.push(value)
    },
  )
  queued.push(intent, null)
  eventListener({ payload: intent })

  await waitFor(() => received.length === 1)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(received, [intent])
  unsubscribe()
})

test('Window wake drains a click whose Tauri event was missed while minimized', async () => {
  const queued = [null]
  const received = []
  let wakeListener
  let wakeUnsubscribeCalls = 0
  const capabilities = createNativeCapabilities({
    tauriAvailable: true,
    loadTauriCore: async () => ({
      invoke: async (command) => {
        assert.equal(command, 'take_pending_notification_intent')
        return queued.shift() ?? null
      },
    }),
    loadTauriEvent: async () => ({
      listen: async () => () => undefined,
    }),
    subscribeToWakeEvents: (listener) => {
      wakeListener = listener
      return () => {
        wakeUnsubscribeCalls += 1
      }
    },
  })

  const unsubscribe = await capabilities.notifications.subscribeToIntents(
    (value) => {
      received.push(value)
    },
  )
  queued.push(intent, null)

  // No Tauri event is emitted: native focus is the recovery signal.
  wakeListener()
  await waitFor(() => received.length === 1)
  assert.deepEqual(received, [intent])

  unsubscribe()
  unsubscribe()
  assert.equal(wakeUnsubscribeCalls, 1)
})

test('Desktop adapter rejects malformed notification intent before native delivery', async () => {
  let coreLoads = 0
  const capabilities = createNativeCapabilities({
    tauriAvailable: true,
    loadTauriCore: async () => {
      coreLoads += 1
      return { invoke: async () => undefined }
    },
  })

  await assert.rejects(
    capabilities.notifications.deliver({ ...intent, title: '' }),
    /invalid/u,
  )
  await assert.rejects(
    capabilities.notifications.deliver({
      ...intent,
      turnId: 'provider_turn_private01',
    }),
    /invalid/u,
  )
  assert.equal(coreLoads, 0)
})

test('Notification click rejects a malformed optional Turn identity', async () => {
  const received = []
  let eventListener
  const originalWarn = console.warn
  const warnings = []
  console.warn = (...values) => warnings.push(values)

  try {
    const capabilities = createNativeCapabilities({
      tauriAvailable: true,
      loadTauriCore: async () => ({
        invoke: async () => null,
      }),
      loadTauriEvent: async () => ({
        listen: async (_event, listener) => {
          eventListener = listener
          return () => undefined
        },
      }),
    })
    const unsubscribe = await capabilities.notifications.subscribeToIntents(
      (value) => received.push(value),
    )

    eventListener({
      payload: { ...intent, turnId: 'provider_turn_private01' },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.deepEqual(received, [])
    assert.equal(warnings.length, 1)
    unsubscribe()
  } finally {
    console.warn = originalWarn
  }
})

function deferred() {
  let resolve
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

async function waitFor(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail('Timed out waiting for native notification state')
}
