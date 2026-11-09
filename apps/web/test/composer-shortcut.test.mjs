import assert from 'node:assert/strict'
import test from 'node:test'
import { loadWebComponent } from './fixtures/render-ui.mjs'

const {
  COMPOSER_SEND_SHORTCUT_KEY,
  readComposerSendShortcut,
  writeComposerSendShortcut,
} = loadWebComponent('components/conversation/composer-shortcut.ts')

test('send shortcut defaults to Enter and persists the chosen mode', () => {
  const previousWindow = globalThis.window
  const data = new Map()
  const events = []
  globalThis.window = {
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

test('inaccessible storage falls back for reads and reports failed writes', () => {
  const previousWindow = globalThis.window
  globalThis.window = {
    get localStorage() {
      throw new Error('storage unavailable')
    },
  }
  try {
    assert.equal(readComposerSendShortcut(), 'enter')
    assert.throws(() => writeComposerSendShortcut('ctrl-enter'))
  } finally {
    globalThis.window = previousWindow
  }
})
