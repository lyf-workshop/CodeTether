import assert from 'node:assert/strict'
import test from 'node:test'
import { StrictMode, act, createElement } from 'react'
import { JSDOM } from 'jsdom'
import { createDom } from './fixtures/dom.mjs'
import { loadWebComponent } from './fixtures/render-ui.mjs'

test('Composer shows a create-time model fallback explanation once', async () => {
  const { Composer } = loadWebComponent('components/conversation/composer.tsx')
  const { conversationModelFallbackNotices } = loadWebComponent(
    'components/conversation/conversation-model-fallback-notices.ts',
  )
  const conversationId = 'conv_model_fallback01'
  conversationModelFallbackNotices.queue(conversationId, {
    configuredModel: 'gpt-6.2-astra',
    selectedModel: 'gpt-6.1-terra',
  })
  const view = await createDom()
  const render = async (
    currentModel = 'gpt-6.1-terra',
    state = 'idle',
    id = conversationId,
  ) =>
    view.render(
      createElement(
        StrictMode,
        null,
        createElement(Composer, {
          conversationId: id,
          capabilities: { canCompose: true },
          controller: {
            state,
            async submit() {
              return false
            },
          },
          modelSettings: {
            currentModel,
            availableModels: [{ id: currentModel, name: currentModel }],
            reasoningOptions: [],
            canSelectModel: false,
            canSelectReasoning: false,
          },
        }),
      ),
    )
  try {
    await render()
    assert.match(
      view.container.querySelector('[data-model-fallback-notice]')
        ?.textContent ?? '',
      /gpt-6\.2-astra.*gpt-6\.1-terra/u,
    )
    await render('gpt-6.1-terra', 'running')
    assert.ok(view.container.querySelector('[data-model-fallback-notice]'))
    await render('gpt-6.1-terra', 'idle', 'conv_model_fallback02')
    assert.equal(
      view.container.querySelector('[data-model-fallback-notice]'),
      null,
    )
    conversationModelFallbackNotices.queue('conv_model_fallback03', {
      configuredModel: 'gpt-6.2-astra',
      selectedModel: 'gpt-6.1-terra',
    })
    await render('gpt-6.1-terra', 'idle', 'conv_model_fallback03')
    assert.ok(view.container.querySelector('[data-model-fallback-notice]'))
    await render('gpt-6.1-sol', 'idle', 'conv_model_fallback03')
    assert.equal(
      view.container.querySelector('[data-model-fallback-notice]'),
      null,
    )
  } finally {
    await view.close()
  }
  const revisit = await createDom()
  try {
    await revisit.render(
      createElement(Composer, {
        conversationId,
        capabilities: { canCompose: true },
        controller: {
          state: 'idle',
          async submit() {
            return false
          },
        },
      }),
    )
    assert.equal(
      revisit.container.querySelector('[data-model-fallback-notice]'),
      null,
    )
  } finally {
    await revisit.close()
  }
})

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

    const renderActive = async (state, canCompose) => {
      await act(async () => {
        root.render(
          createElement(Composer, {
            conversationId,
            capabilities: { canCompose },
            controller: {
              state,
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
    }
    await renderActive('running', false)
    assert.equal(editor.readOnly, false)
    const setEditor = async (text) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          dom.window.HTMLTextAreaElement.prototype,
          'value',
        ).set.call(editor, text)
        editor.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      })
    }
    await setEditor('next draft')
    assert.equal(editor.value, 'next draft')
    assert.equal(conversationDrafts.read(conversationId), 'next draft')
    assert.equal(
      dom.window.document.querySelector('button[aria-label="发送消息"]')
        .disabled,
      true,
    )
    await key('Enter')
    assert.deepEqual(submitted, ['initial'])

    await renderActive('waiting', false)
    assert.equal(editor.readOnly, false)
    await setEditor('draft during approval')
    assert.equal(
      conversationDrafts.read(conversationId),
      'draft during approval',
    )
    await key('Enter')
    assert.deepEqual(submitted, ['initial'])

    await renderActive('idle', true)
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

test('Composer clears a sent multiline draft without retaining its old height', async () => {
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
  const conversationId = 'conv_height01'
  const root = createRoot(dom.window.document.getElementById('root'))
  let finishSubmit
  const submitted = new Promise((resolve) => {
    finishSubmit = resolve
  })
  const draft = 'one\ntwo\nthree\nfour\nfive\nsix'
  const controller = (state, optimisticState) => ({
    state,
    ...(optimisticState === undefined
      ? {}
      : {
          optimisticSend: {
            state: optimisticState,
            actionId: 'action_height01',
            text: draft,
          },
        }),
    async submit() {
      return submitted
    },
  })
  const render = async (state, canCompose, optimisticState) => {
    await act(async () => {
      root.render(
        createElement(Composer, {
          conversationId,
          capabilities: { canCompose },
          controller: controller(state, optimisticState),
        }),
      )
    })
  }
  conversationDrafts.write(conversationId, draft)
  try {
    await render('idle', true)
    const editor = dom.window.document.getElementById('conversation-composer')
    assert.equal(editor.value, draft)
    assert.equal(editor.rows, 2)
    act(() => editor.form.requestSubmit())
    await render('submitting', true, 'sending')
    assert.equal(editor.value, '')
    assert.equal(editor.style.minHeight, '')

    await act(async () => {
      finishSubmit(true)
      await submitted
    })
    assert.equal(editor.value, '')
    assert.equal(editor.style.minHeight, '')
    await render('running', false)
    assert.equal(editor.style.minHeight, '')
    await render('waiting', false)
    assert.equal(editor.style.minHeight, '')
    await render('idle', true)
    assert.equal(editor.style.minHeight, '')

    await act(async () => {
      Object.getOwnPropertyDescriptor(
        dom.window.HTMLTextAreaElement.prototype,
        'value',
      ).set.call(editor, 'next draft')
      editor.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    assert.equal(editor.style.minHeight, '')
    assert.equal(editor.value, 'next draft')
  } finally {
    await act(async () => root.unmount())
    conversationDrafts.clear(conversationId)
    dom.window.close()
    Object.assign(globalThis, previous)
  }
})
