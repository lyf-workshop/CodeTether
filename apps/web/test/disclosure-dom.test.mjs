import assert from 'node:assert/strict'
import test from 'node:test'
import { createDom, h } from './fixtures/dom.mjs'
import { loadUiComponent } from './fixtures/render-ui.mjs'

test('detail disclosure exposes and toggles its content with a focusable native button', async (t) => {
  const { Disclosure } = loadUiComponent('components/disclosure.tsx')
  const dom = await createDom()
  t.after(() => dom.close())
  await dom.render(h(Disclosure, { label: '技术详情' }, '检查记录'))
  const button = dom.container.querySelector('button')
  const content = dom.window.document.getElementById(
    button.getAttribute('aria-controls'),
  )
  assert.equal(button.textContent, '技术详情')
  assert.equal(button.type, 'button')
  assert.equal(button.tabIndex, 0)
  assert.match(button.className, /focus-visible:ring/u)
  assert.equal(content.textContent, '检查记录')
  for (const expanded of [false, true, false]) {
    assert.equal(button.getAttribute('aria-expanded'), String(expanded))
    assert.equal(content.hidden, !expanded)
    await dom.perform(() => button.click())
  }
})
