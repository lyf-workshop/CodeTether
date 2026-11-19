import assert from 'node:assert/strict'
import test from 'node:test'
import { createDom } from './fixtures/dom.mjs'
import { loadWebComponent } from './fixtures/render-ui.mjs'

const {
  COMPOSER_SEND_SHORTCUT_EVENT,
  COMPOSER_SEND_SHORTCUT_KEY,
  readComposerSendShortcut,
  writeComposerSendShortcut,
} = loadWebComponent('components/conversation/composer-shortcut.ts')

test('send shortcut defaults to Enter and persists the chosen mode', () => {
  const previousWindow = globalThis.window
  const data = new Map()
  const events = []
  globalThis.window = {
    Event,
    localStorage: {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => data.set(key, value),
    },
    dispatchEvent: (event) => events.push(event.type),
  }
  try {
    assert.equal(COMPOSER_SEND_SHORTCUT_KEY, 'composer-send-shortcut')
    assert.equal(readComposerSendShortcut(), 'enter')
    writeComposerSendShortcut('ctrl-enter')
    assert.equal(data.get(COMPOSER_SEND_SHORTCUT_KEY), 'ctrl-enter')
    assert.equal(readComposerSendShortcut(), 'ctrl-enter')
    assert.deepEqual(events, ['composer-send-shortcut-change'])
    data.set(COMPOSER_SEND_SHORTCUT_KEY, 'invalid')
    assert.equal(readComposerSendShortcut(), 'enter')
  } finally {
    globalThis.window = previousWindow
  }
})

test('shortcut changes remain usable in the current window when storage throws', async (t) => {
  const dom = await createDom()
  t.after(() => dom.close())
  const original = Object.getOwnPropertyDescriptor(dom.window, 'localStorage')
  Object.defineProperty(dom.window, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('storage unavailable')
    },
  })
  const changes = []
  dom.window.addEventListener(COMPOSER_SEND_SHORTCUT_EVENT, () => {
    changes.push(readComposerSendShortcut())
  })
  try {
    assert.equal(readComposerSendShortcut(), 'enter')
    writeComposerSendShortcut('ctrl-enter')
    assert.equal(readComposerSendShortcut(), 'ctrl-enter')
  } finally {
    Object.defineProperty(dom.window, 'localStorage', original)
    writeComposerSendShortcut('enter')
  }
  assert.equal(readComposerSendShortcut(), 'enter')
  assert.deepEqual(changes, ['ctrl-enter', 'enter'])
})
