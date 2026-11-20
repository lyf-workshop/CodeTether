import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PageHeader } from '../dist/components/page-header.js'

test('a page with only a title has one primary heading and no empty content slots', () => {
  const markup = renderToStaticMarkup(h(PageHeader, { title: '设备' }))
  assert.match(markup, /<h1[^>]*>设备<\/h1>/u)
  assert.doesNotMatch(markup, /<button|aria-hidden|text-text-secondary/u)
})

test('description, decorative icon and actions follow their heading in the same header', () => {
  const markup = renderToStaticMarkup(
    h(PageHeader, {
      title: '状态检查',
      headingId: 'doctor-heading',
      level: 2,
      icon: h('svg'),
      description: '查看工具状态。',
      actions: h('button', { type: 'button' }, '检查状态'),
    }),
  )
  assert.match(
    markup,
    /<header[^>]*>.*aria-hidden="true".*<svg.*<h2 id="doctor-heading"[^>]*>状态检查<\/h2>.*查看工具状态。.*<button type="button">检查状态<\/button>.*<\/header>/u,
  )
})
