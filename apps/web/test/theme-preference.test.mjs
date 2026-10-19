import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

import {
  createThemeController,
  parseThemePreference,
  readThemePreference,
  resolveTheme,
  themePreferenceStorageKey,
} from '../.tmp/test-dist/runtime/theme/theme-preference.js'

test('theme preference defaults to light and accepts only the three supported choices', () => {
  assert.equal(themePreferenceStorageKey, 'ct-theme')
  for (const value of [undefined, null, '', 'auto', 'DARK', '{}']) {
    assert.equal(parseThemePreference(value), 'light')
  }
  for (const value of ['light', 'dark', 'system']) {
    assert.equal(parseThemePreference(value), value)
  }
  assert.equal(resolveTheme('system', true), 'dark')
  assert.equal(resolveTheme('system', false), 'light')
  assert.equal(resolveTheme('light', true), 'light')
  assert.equal(resolveTheme('dark', false), 'dark')
  assert.equal(
    readThemePreference({
      getItem() {
        throw new Error('blocked')
      },
    }),
    'light',
  )
})

test('system changes affect only the system choice; changes persist and disposal removes the listener', () => {
  const values = new Map([['ct-theme', 'system']])
  const media = mediaQuery(false)
  const root = { dataset: {} }
  const controller = createThemeController({
    root,
    storage: {
      getItem: (key) => values.get(key),
      setItem: (key, value) => values.set(key, value),
    },
    mediaQuery: media,
  })
  let notifications = 0
  const unsubscribe = controller.subscribe(() => {
    notifications += 1
  })
  assert.equal(root.dataset.theme, 'light')
  assert.equal(controller.getPreference(), 'system')
  media.change(true)
  assert.equal(root.dataset.theme, 'dark')
  assert.equal(controller.getTheme(), 'dark')
  assert.equal(notifications, 1)
  controller.setPreference('light')
  assert.equal(values.get('ct-theme'), 'light')
  assert.equal(root.dataset.theme, 'light')
  media.change(false)
  media.change(true)
  assert.equal(root.dataset.theme, 'light')
  assert.equal(notifications, 2)
  controller.setPreference('light')
  assert.equal(notifications, 2)
  unsubscribe()
  controller.setPreference('dark')
  assert.equal(notifications, 2)
  controller.dispose()
  assert.equal(media.listenerCount(), 0)
})

test('unavailable storage still permits a temporary theme choice', () => {
  const root = { dataset: {} }
  const controller = createThemeController({
    root,
    storage: {
      getItem() {
        throw new Error('blocked')
      },
      setItem() {
        throw new Error('blocked')
      },
    },
  })
  assert.equal(root.dataset.theme, 'light')
  assert.doesNotThrow(() => controller.setPreference('dark'))
  assert.equal(root.dataset.theme, 'dark')
  controller.dispose()
})

test('the early head script uses the same preference rules before application CSS or code', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8')
  assert.match(html, /<html[^>]*lang="zh-CN"/u)
  const script = html.match(/<script id="ct-theme-init">([\s\S]*?)<\/script>/u)
  assert.ok(script, 'theme initialization must be an early inline head script')
  assert.ok(html.indexOf(script[0]) < html.indexOf('</head>'))
  assert.ok(html.indexOf(script[0]) < html.indexOf('type="module"'))
  for (const stored of [null, '', 'invalid', 'light', 'dark', 'system']) {
    for (const systemDark of [false, true]) {
      const document = { documentElement: { dataset: {} } }
      runInNewContext(script[1], {
        document,
        localStorage: { getItem: () => stored },
        matchMedia: () => ({ matches: systemDark }),
      })
      assert.equal(
        document.documentElement.dataset.theme,
        resolveTheme(parseThemePreference(stored), systemDark),
      )
    }
  }
  const document = { documentElement: { dataset: {} } }
  runInNewContext(script[1], {
    document,
    localStorage: {
      getItem() {
        throw new Error('blocked')
      },
    },
  })
  assert.equal(document.documentElement.dataset.theme, 'light')
})

function mediaQuery(matches) {
  const listeners = new Set()
  return {
    matches,
    addEventListener: (_event, listener) => listeners.add(listener),
    removeEventListener: (_event, listener) => listeners.delete(listener),
    listenerCount: () => listeners.size,
    change(next) {
      this.matches = next
      for (const listener of listeners) listener({ matches: next })
    },
  }
}
