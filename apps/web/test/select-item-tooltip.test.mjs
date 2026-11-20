import assert from 'node:assert/strict'
import test from 'node:test'

import { createDom, h } from './fixtures/dom.mjs'
import { loadUiComponent } from './fixtures/render-ui.mjs'

test('Select shows a repeated label tooltip only after truncation', async (t) => {
  const dom = await createDom()
  t.after(async () => {
    // Radix's hidden native select can dispatch a change after the menu
    // unmounts. Let that work finish before createDom restores global Event.
    await dom.render(null)
    await dom.perform(() => new Promise((resolve) => setImmediate(resolve)))
    await dom.close()
  })
  dom.window.HTMLElement.prototype.scrollIntoView = () => {}
  const { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } =
    loadUiComponent('components/select.tsx')
  await dom.render(
    h(
      Select,
      { open: true, value: 'short', onValueChange() {} },
      h(SelectTrigger, null, h(SelectValue)),
      h(
        SelectContent,
        null,
        h(SelectItem, { value: 'short' }, 'Short label'),
        h(SelectItem, { value: 'long' }, 'A very long label'),
        h(
          SelectItem,
          { value: 'described', title: 'Additional description' },
          'Described',
        ),
        h(SelectItem, { value: 'keyboard' }, 'Keyboard label'),
      ),
    ),
  )

  const items = [
    ...dom.window.document.querySelectorAll('[data-slot="select-item"]'),
  ]
  assert.equal(items.length, 4)
  const [short, long, described, keyboard] = items
  assert.equal(short.getAttribute('title'), null)
  assert.equal(long.getAttribute('title'), null)
  assert.equal(
    described.getAttribute('title'),
    'Described · Additional description',
  )

  for (const [item, scrollWidth, clientWidth] of [
    [short, 90, 130],
    [long, 230, 120],
  ]) {
    const label = item.querySelector('[data-slot="select-item-text"]')
    assert.ok(label)
    Object.defineProperty(label, 'scrollWidth', {
      configurable: true,
      value: scrollWidth,
    })
    Object.defineProperty(label, 'clientWidth', {
      configurable: true,
      value: clientWidth,
    })
    await dom.perform(() => {
      item.dispatchEvent(
        new dom.window.MouseEvent('pointerover', { bubbles: true }),
      )
    })
  }
  assert.equal(short.getAttribute('title'), null)
  assert.equal(long.getAttribute('title'), 'A very long label')

  const keyboardLabel = keyboard.querySelector('[data-slot="select-item-text"]')
  assert.ok(keyboardLabel)
  Object.defineProperties(keyboardLabel, {
    scrollWidth: { configurable: true, value: 180 },
    clientWidth: { configurable: true, value: 90 },
  })
  await dom.perform(() => keyboard.focus())
  assert.equal(keyboard.getAttribute('title'), 'Keyboard label')
})
