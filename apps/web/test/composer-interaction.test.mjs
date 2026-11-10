import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement } from 'react'
import { JSDOM } from 'jsdom'
import { loadWebComponent } from './fixtures/render-ui.mjs'

test('Composer keyboard sends, copies the prior input, clears, and follows the saved shortcut', async () => {
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    HTMLElement: globalThis.HTMLElement,
    HTMLTextAreaElement: globalThis.HTMLTextAreaElement,
    Event: globalThis.Event,
    IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT,
  }
  const dom = new JSDOM('<div id="root"></div>', {
    url: 'http://localhost/',
  })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.HTMLElement = dom.window.HTMLElement
  globalThis.HTMLTextAreaElement = dom.window.HTMLTextAreaElement
  globalThis.Event = dom.window.Event
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  const { Composer } = loadWebComponent('components/conversation/composer.tsx')
  const { conversationDrafts } = loadWebComponent(
    'components/conversation/conversation-drafts.ts',
  )
  const { writeComposerSendShortcut } = loadWebComponent(
    'components/conversation/composer-shortcut.ts',
  )
  const conversationId = 'conv_keyboard01'
  const submitted = []
  const root = createRoot(dom.window.document.getElementById('root'))
  conversationDrafts.write(conversationId, 'initial')
  try {
    await act(async () => {
      root.render(
        createElement(Composer, {
          conversationId,
          capabilities: { canCompose: true },
          controller: {
            state: 'idle',
            async submit(value) {
              submitted.push(value)
              return false
            },
          },
          previousUserInput: 'previous prompt',
          agent: 'codex',
        }),
      )
    })
    const editor = dom.window.document.getElementById('conversation-composer')
    const key = async (keyName, options = {}) => {
      await act(async () => {
        editor.dispatchEvent(
          new dom.window.KeyboardEvent('keydown', {
            key: keyName,
            bubbles: true,
            cancelable: true,
            ...options,
          }),
        )
      })
    }
    assert.equal(editor.value, 'initial')
    await key('Enter', { shiftKey: true })
    assert.deepEqual(submitted, [])
    await key('Enter')
    assert.deepEqual(submitted, ['initial'])
    await key('ArrowUp', { ctrlKey: true })
    assert.equal(editor.value, 'previous prompt')
    await key('Escape')
    assert.equal(editor.value, '')
    assert.equal(conversationDrafts.read(conversationId), '')

    await act(async () => writeComposerSendShortcut('ctrl-enter'))
    assert.equal(editor.getAttribute('aria-keyshortcuts'), 'Control+Enter')
    await key('ArrowUp', { ctrlKey: true })
    await key('Enter')
    assert.deepEqual(submitted, ['initial'])
    await key('Enter', { ctrlKey: true })
    assert.deepEqual(submitted, ['initial', 'previous prompt'])

    await act(async () => {
      root.render(
        createElement(Composer, {
          key: 'conv_keyboard02',
          conversationId: 'conv_keyboard02',
          capabilities: { canCompose: true },
          controller: {
            state: 'idle',
            async submit() {
              return false
            },
          },
          agent: 'claude',
        }),
      )
    })
    assert.equal(
      dom.window.document.getElementById('conversation-composer').value,
      '',
    )
    await act(async () => {
      root.render(
        createElement(Composer, {
          key: conversationId,
          conversationId,
          capabilities: { canCompose: true },
          controller: {
            state: 'idle',
            async submit() {
              return false
            },
          },
          agent: 'codex',
        }),
      )
    })
    assert.equal(
      dom.window.document.getElementById('conversation-composer').value,
      'previous prompt',
    )
  } finally {
    await act(async () => root.unmount())
    conversationDrafts.clear(conversationId)
    conversationDrafts.clear('conv_keyboard02')
    dom.window.close()
    Object.assign(globalThis, previous)
  }
})
