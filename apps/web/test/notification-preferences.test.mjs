import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  defaultDesktopNotificationPreferences,
  desktopNotificationPreferenceStorageKey,
  isDesktopNotificationEnabled,
  persistDesktopNotificationPreferences,
  readDesktopNotificationPreferences,
  resolveNotificationPreferenceStorage,
  updateDesktopNotificationPreference,
} from '../.tmp/test-dist/runtime/native/notification-preferences.js'

test('Desktop notification preferences default all supported Attention types on', () => {
  assert.deepEqual(readDesktopNotificationPreferences(undefined), {
    approval: true,
    completed_review: true,
    failed: true,
  })
  assert.equal(
    isDesktopNotificationEnabled(
      defaultDesktopNotificationPreferences,
      'approval',
    ),
    true,
  )
})

test('partial and malformed preference data falls back safely', () => {
  const partial = memoryStorage({
    [desktopNotificationPreferenceStorageKey]: JSON.stringify({
      version: 1,
      enabled: { approval: false, failed: 'no' },
    }),
  })
  assert.deepEqual(readDesktopNotificationPreferences(partial), {
    approval: false,
    completed_review: true,
    failed: true,
  })

  const malformed = memoryStorage({
    [desktopNotificationPreferenceStorageKey]: '{not-json',
  })
  assert.deepEqual(
    readDesktopNotificationPreferences(malformed),
    defaultDesktopNotificationPreferences,
  )

  const futureVersion = memoryStorage({
    [desktopNotificationPreferenceStorageKey]: JSON.stringify({
      version: 2,
      enabled: { approval: false, completed_review: false, failed: false },
    }),
  })
  assert.deepEqual(
    readDesktopNotificationPreferences(futureVersion),
    defaultDesktopNotificationPreferences,
  )
})

test('a preference change writes the complete record immediately and survives reload', () => {
  const storage = memoryStorage()
  const updated = updateDesktopNotificationPreference(
    defaultDesktopNotificationPreferences,
    'completed_review',
    false,
  )

  assert.equal(persistDesktopNotificationPreferences(storage, updated), true)
  assert.equal(storage.setCalls, 1)
  assert.deepEqual(readDesktopNotificationPreferences(storage), {
    approval: true,
    completed_review: false,
    failed: true,
  })
})

test('inaccessible storage stays non-throwing and does not claim persistence', () => {
  const failedStorage = {
    getItem() {
      throw new Error('private storage details')
    },
    setItem() {
      throw new Error('private storage details')
    },
  }

  assert.deepEqual(
    readDesktopNotificationPreferences(failedStorage),
    defaultDesktopNotificationPreferences,
  )
  assert.equal(
    persistDesktopNotificationPreferences(
      failedStorage,
      defaultDesktopNotificationPreferences,
    ),
    false,
  )
  assert.equal(resolveNotificationPreferenceStorage({}), undefined)
  assert.equal(
    resolveNotificationPreferenceStorage({ localStorage: failedStorage }),
    failedStorage,
  )
})

test('Settings exposes only the three real Desktop types and a truthful Browser fallback', async () => {
  const source = await readFile(
    new URL(
      '../src/components/settings/desktop-notification-settings.tsx',
      import.meta.url,
    ),
    'utf8',
  )

  assert.match(source, /nativeCapabilities\.notifications\.available/u)
  assert.match(source, /nativeCapabilities\.backgroundRuntime\.available/u)
  assert.match(source, /type: 'approval'/u)
  assert.match(source, /type: 'completed_review'/u)
  assert.match(source, /type: 'failed'/u)
  assert.match(source, /桌面通知需要 CodeTether Desktop/u)
  assert.match(source, /浏览器中仍可通过收件箱查看/u)
  assert.doesNotMatch(source, /__TAURI__|isTauri|plugin-notification/u)
})

test('Settings describes fixed Desktop background behavior without a Browser tray control', async () => {
  const source = await readFile(
    new URL(
      '../src/components/settings/desktop-notification-settings.tsx',
      import.meta.url,
    ),
    'utf8',
  )

  assert.match(source, /backgroundRuntimeAvailable \?/u)
  assert.match(source, />后台运行</u)
  assert.match(
    source,
    /关闭窗口后，CodeTether\s*将继续在系统托盘运行，以便任务、审批和通知继续工作。/u,
  )
  assert.doesNotMatch(source, /后台运行[\s\S]{0,300}type="checkbox"/u)
})

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    setCalls: 0,
    getItem(key) {
      return values.get(key) ?? null
    },
    setItem(key, value) {
      this.setCalls += 1
      values.set(key, value)
    },
  }
}
