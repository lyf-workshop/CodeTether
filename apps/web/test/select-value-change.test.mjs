import assert from 'node:assert/strict'
import test from 'node:test'
import { StrictMode, createElement } from 'react'

import { createDom } from './fixtures/dom.mjs'
import { loadUiComponent, loadWebComponent } from './fixtures/render-ui.mjs'

test('shared Select ignores an empty Radix value change', async () => {
  let primitiveValueChange
  const { Select } = loadWebComponent(
    '../../../packages/ui/src/components/select.tsx',
    new Map([
      [
        'radix-ui',
        {
          Select: {
            Root({ children, onValueChange }) {
              primitiveValueChange = onValueChange
              return createElement('div', null, children)
            },
          },
        },
      ],
    ]),
  )
  const changes = []
  const view = await createDom()
  try {
    await view.render(
      createElement(
        Select,
        { onValueChange: (value) => changes.push(value) },
        'Model',
      ),
    )
    await view.perform(() => primitiveValueChange(''))
    assert.deepEqual(changes, [])
    await view.perform(() => primitiveValueChange('gpt-6.2-sol'))
    assert.deepEqual(changes, ['gpt-6.2-sol'])
  } finally {
    await view.close()
  }
})

test('Composer ignores empty and unchanged model or reasoning selections', async () => {
  const selectionHandlers = new Map()
  const ui = loadUiComponent('index.ts')
  const fallbackNotice = {
    configuredModel: 'gpt-6.2-astra',
    selectedModel: 'gpt-6.1-terra',
  }
  let queuedNotice = fallbackNotice
  const dependencies = new Map([
    [
      '@codetether/ui',
      {
        ...ui,
        Select({ children, onOpenChange, onValueChange }) {
          selectionHandlers.set(
            onOpenChange === undefined ? 'reasoning' : 'model',
            onValueChange,
          )
          return createElement('div', null, children)
        },
        SelectTrigger({ children, ...props }) {
          return createElement('button', { type: 'button', ...props }, children)
        },
        SelectValue() {
          return null
        },
        SelectContent({ children }) {
          return createElement('div', null, children)
        },
        SelectItem({ children }) {
          return createElement('span', null, children)
        },
      },
    ],
    [
      './conversation-model-fallback-notices',
      {
        conversationModelFallbackNotices: {
          take() {
            const notice = queuedNotice
            queuedNotice = undefined
            return notice
          },
        },
      },
    ],
  ])
  const { Composer } = loadWebComponent(
    'components/conversation/composer.tsx',
    dependencies,
  )
  const updates = []
  const modelSwitchController = {
    pending: false,
    async refreshModels() {},
    async update(value) {
      updates.push(value)
      this.error = 'CodeTether 暂时无法连接，请重试。'
    },
  }
  const view = await createDom()
  const composer = createElement(
    StrictMode,
    null,
    createElement(Composer, {
      conversationId: 'conv_selection01',
      capabilities: { canCompose: true },
      controller: {
        state: 'idle',
        async submit() {
          return false
        },
      },
      modelSettings: {
        currentModel: 'gpt-6.1-terra',
        availableModels: [
          { id: 'gpt-6.1-terra', name: 'Terra' },
          { id: 'gpt-6.2-sol', name: 'Sol' },
        ],
        currentReasoning: 'medium',
        reasoningOptions: [
          { id: 'low', label: 'Low' },
          { id: 'medium', label: 'Medium' },
        ],
        canSelectModel: true,
        canSelectReasoning: true,
      },
      modelSwitchController,
    }),
  )
  try {
    await view.render(composer)
    const notice = () =>
      view.container.querySelector('[data-model-fallback-notice]')
    assert.ok(notice())
    assert.match(
      notice().textContent,
      /gpt-6\.2-astra 不在 CodeTether 当前读取的模型列表中。此会话已改用列表的默认模型 gpt-6\.1-terra/u,
    )
    assert.equal(selectionHandlers.size, 2)
    for (const [control, value] of [
      ['model', ''],
      ['model', 'gpt-6.1-terra'],
      ['reasoning', ''],
      ['reasoning', 'medium'],
    ]) {
      await view.perform(() => selectionHandlers.get(control)(value))
      await view.render(composer)
      assert.ok(notice(), `${control} ${JSON.stringify(value)} kept the notice`)
      assert.deepEqual(updates, [])
      assert.equal(view.container.querySelector('[role="alert"]'), null)
    }

    await view.perform(() => selectionHandlers.get('reasoning')('low'))
    assert.deepEqual(updates, [{ reasoning: 'low' }])
    modelSwitchController.error = undefined
    await view.render(composer)
    await view.perform(() => selectionHandlers.get('model')('gpt-6.2-sol'))
    assert.deepEqual(updates, [{ reasoning: 'low' }, { model: 'gpt-6.2-sol' }])
    assert.equal(notice(), null)
  } finally {
    await view.close()
  }
})
