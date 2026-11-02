import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadUiComponent } from './fixtures/render-ui.mjs'

const { CommandList } = loadUiComponent('components/command-list.tsx')
const { AttentionRow } = loadUiComponent('components/attention-row.tsx')
const { commandListHighlight } = loadUiComponent(
  'lib/command-list-navigation.ts',
)
const noop = () => {}

test('command highlight wraps and handles removed or absent current identifiers', () => {
  const ids = ['device:a', 'project:b', 'conversation:c']
  assert.equal(commandListHighlight(ids, ids[0], 'ArrowUp'), ids[2])
  assert.equal(commandListHighlight(ids, ids[2], 'ArrowDown'), ids[0])
  assert.equal(commandListHighlight(ids, 'removed', 'ArrowDown'), ids[0])
  assert.equal(commandListHighlight(ids, undefined, 'ArrowUp'), ids[2])
  assert.equal(commandListHighlight(ids, ids[1], 'Home'), ids[0])
  assert.equal(commandListHighlight(ids, ids[1], 'End'), ids[2])
  assert.equal(commandListHighlight([], undefined, 'ArrowDown'), undefined)
})

test('real CommandList SSR binds the labelled combobox to grouped options and one active descendant', () => {
  const html = renderToStaticMarkup(
    h(CommandList, {
      groups: [
        {
          id: 'devices',
          label: '设备',
          items: [
            { id: 'device:remote', label: 'Build Node', description: '离线' },
            { id: 'device:local', label: '本机' },
          ],
        },
      ],
      query: '',
      highlightedId: 'device:remote',
      onQueryChange: noop,
      onHighlightChange: noop,
      onSelect: noop,
    }),
  )
  assert.match(html, /role="combobox"/u)
  assert.match(html, /aria-label="搜索会话、项目、设备或操作"/u)
  const selectedId = /aria-activedescendant="([^"]+)"/u.exec(html)?.[1]
  assert.ok(selectedId)
  assert.ok(html.includes('id="' + selectedId + '" aria-selected="true"'))
  assert.equal((html.match(/aria-selected="true"/gu) ?? []).length, 1)
  assert.match(html, /role="group"/u)
  assert.match(html, /这里只匹配已加载的标题/u)
  assert.doesNotMatch(html, /textarea|dangerouslySetInnerHTML/u)
})

test('empty CommandList has no fabricated result or active descendant', () => {
  const html = renderToStaticMarkup(
    h(CommandList, {
      groups: [],
      query: 'missing',
      onQueryChange: noop,
      onHighlightChange: noop,
      onSelect: noop,
    }),
  )
  assert.match(html, /没有找到匹配的已加载标题或操作/u)
  assert.doesNotMatch(html, /role="option"|aria-activedescendant=/u)
})

test('stale selected identifier derives the first visible option instead of losing keyboard navigation', () => {
  const html = renderToStaticMarkup(
    h(CommandList, {
      groups: [
        {
          id: 'actions',
          label: '操作',
          items: [{ id: 'action:settings', label: '打开设置' }],
        },
      ],
      query: '设置',
      highlightedId: 'removed',
      onQueryChange: noop,
      onHighlightChange: noop,
      onSelect: noop,
    }),
  )
  assert.equal((html.match(/aria-selected="true"/gu) ?? []).length, 1)
  assert.match(html, /打开设置/u)
})

test('real shared AttentionRow SSR preserves semantic title, action slots, busy and error content', () => {
  const html = renderToStaticMarkup(
    h(AttentionRow, {
      mark: h('span', { role: 'img', 'aria-label': '等待批准' }),
      title: h('a', { href: '/c/conversation_123' }, 'Exact Task'),
      description: h('span', { role: 'alert' }, '没有自动重试'),
      context: 'Build Node · Shared Project',
      time: h('time', { dateTime: '2026-01-01' }, '刚刚'),
      actions: h('button', { disabled: true }, '允许一次'),
      'aria-busy': true,
    }),
  )
  assert.match(html, /<article[^>]*aria-busy="true"/u)
  assert.match(html, /<h2[^>]*><a[^>]*>Exact Task/u)
  assert.match(html, /data-slot="attention-actions"/u)
  assert.match(html, /disabled=""/u)
  assert.match(html, /role="alert"/u)
  assert.match(html, /Build Node · Shared Project/u)
})
