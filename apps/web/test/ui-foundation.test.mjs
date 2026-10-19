import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadUiComponent } from './fixtures/render-ui.mjs'

test('v4 light and dark semantic tokens retain the approved warm-neutral palette', async () => {
  const css = await readFile(
    new URL('../../../packages/ui/src/styles/globals.css', import.meta.url),
    'utf8',
  )
  const expected = {
    light: {
      bg: '#fbfaf8',
      side: '#f3f1ed',
      surface: '#ffffff',
      hover: '#ece9e3',
      'hover-2': '#f5f3ef',
      selected: '#e6e2db',
      inset: '#f4f2ee',
      line: '#e9e5de',
      'line-strong': '#d8d3ca',
      ring: '#1f8ad8',
      text: '#1d1c1a',
      'text-2': '#5c5852',
      'text-3': '#8c877f',
      ink: '#1d1c1a',
      'ink-hover': '#3a3834',
      'on-ink': '#ffffff',
      accent: '#1a7fd0',
      'accent-hover': '#146bb2',
      'accent-soft': '#e7f1fa',
      'accent-text': '#135e9c',
      ok: '#1e9a55',
      'ok-soft': '#e5f3ea',
      'ok-text': '#17703f',
      warn: '#c98512',
      'warn-soft': '#fbf1de',
      'warn-text': '#8a5806',
      err: '#cc3f36',
      'err-soft': '#fbe9e7',
      'err-text': '#a8322a',
      off: '#a29c93',
      'off-soft': '#efece7',
      run: '#1a7fd0',
      'agent-codex': '#1d1c1a',
      'agent-claude': '#d97757',
    },
    dark: {
      bg: '#1b1a19',
      side: '#151413',
      surface: '#232221',
      hover: '#24231f',
      'hover-2': '#22211f',
      selected: '#2d2b28',
      inset: '#161514',
      line: '#2e2c29',
      'line-strong': '#3d3a36',
      ring: '#5ab0ef',
      text: '#ecebe8',
      'text-2': '#aeaaa3',
      'text-3': '#7f7b74',
      ink: '#ecebe8',
      'ink-hover': '#ffffff',
      'on-ink': '#1b1a19',
      accent: '#3c9be3',
      'accent-hover': '#5ab0ef',
      'accent-soft': '#1a2835',
      'accent-text': '#7cc0f2',
      ok: '#3fbf74',
      'ok-soft': '#172a1f',
      'ok-text': '#6fd59a',
      warn: '#e0a341',
      'warn-soft': '#2f2516',
      'warn-text': '#edbd6c',
      err: '#ec6a60',
      'err-soft': '#341c1a',
      'err-text': '#f39087',
      off: '#77736c',
      'off-soft': '#272624',
      run: '#5ab0ef',
      'agent-codex': '#ecebe8',
      'agent-claude': '#e08a6b',
    },
  }
  for (const [theme, tokens] of Object.entries(expected)) {
    const block = css.match(
      new RegExp(`\\[data-theme=['"]${theme}['"]\\]\\s*\\{([^}]+)\\}`, 'u'),
    )?.[1]
    assert.ok(block, `missing ${theme} theme`)
    for (const [name, value] of Object.entries(tokens)) {
      assert.match(
        block,
        new RegExp(`--ct-${name}:\\s*${value};`, 'u'),
        `${theme} ${name}`,
      )
    }
  }
  assert.match(css, /--background:\s*var\(--ct-bg\)/u)
  assert.match(css, /--status-running:\s*var\(--ct-run\)/u)
  assert.match(css, /--success-text:\s*var\(--ct-ok-text\)/u)
  assert.match(css, /prefers-reduced-motion:\s*reduce/u)
  assert.doesNotMatch(css, /!important/u)
})

test('buttons preserve native controls and use ink for the primary action', () => {
  const { Button } = loadUiComponent('components/button.tsx')
  const markup = renderToStaticMarkup(h(Button, { disabled: true }, '新建会话'))
  assert.match(markup, /type="button"/u)
  assert.match(markup, /disabled=""/u)
  assert.match(markup, /bg-ink/u)
  assert.match(markup, /text-on-ink/u)
  assert.match(markup, /新建会话/u)
})

test('status tags retain labels while status dots stay decorative', () => {
  const { StatusTag } = loadUiComponent('components/status-tag.tsx')
  const { StatusBadge } = loadUiComponent('components/status-badge.tsx')
  const running = renderToStaticMarkup(h(StatusTag, { tone: 'run' }, '运行中'))
  const waiting = renderToStaticMarkup(h(StatusBadge, { status: 'waiting' }))
  assert.match(running, /data-tone="run"/u)
  assert.match(running, /aria-hidden="true"/u)
  assert.match(running, /运行中/u)
  assert.match(waiting, /等待批准/u)
  assert.doesNotMatch(waiting, /role="img"/u)
})

test('notice and section states expose actionable Chinese status text', () => {
  const { Notice } = loadUiComponent('components/notice.tsx')
  const { SectionState } = loadUiComponent('components/section-state.tsx')
  const action = h('button', { type: 'button' }, '重新加载')
  const error = renderToStaticMarkup(
    h(
      Notice,
      { tone: 'err', title: '无法加载项目', action },
      '请检查设备连接。',
    ),
  )
  assert.match(error, /role="alert"/u)
  assert.match(error, /无法加载项目/u)
  assert.match(error, /重新加载/u)
  const loading = renderToStaticMarkup(h(SectionState, { state: 'loading' }))
  assert.match(loading, /aria-busy="true"/u)
  assert.match(loading, /正在加载/u)
  const empty = renderToStaticMarkup(
    h(SectionState, { state: 'empty', title: '还没有项目', action }),
  )
  assert.match(empty, /还没有项目/u)
  assert.match(empty, /重新加载/u)
})

test('segmented controls name their exclusive choices and preserve disabled options', () => {
  const { SegmentedControl, SegmentedControlItem } = loadUiComponent(
    'components/segmented-control.tsx',
  )
  const markup = renderToStaticMarkup(
    h(
      SegmentedControl,
      { value: 'active', 'aria-label': '会话范围', onValueChange() {} },
      h(SegmentedControlItem, { value: 'active' }, '会话'),
      h(SegmentedControlItem, { value: 'archived', disabled: true }, '已归档'),
    ),
  )
  assert.match(markup, /aria-label="会话范围"/u)
  assert.match(markup, /aria-checked="true"/u)
  assert.match(markup, /disabled=""/u)
})

test('agent badges keep the complete provider name and support three icon sizes', () => {
  const { AgentBadge } = loadUiComponent('components/product/agent-badge.tsx')
  for (const size of ['sm', 'md', 'lg']) {
    const markup = renderToStaticMarkup(
      h(AgentBadge, { agent: 'claude', size }),
    )
    assert.match(markup, /Claude Code/u)
    assert.match(markup, new RegExp(`data-size="${size}"`, 'u'))
    assert.match(markup, /<svg/u)
    assert.doesNotMatch(markup, /<img/u)
  }
})
