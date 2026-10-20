import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadUiComponent, loadWebComponent } from './fixtures/render-ui.mjs'

const { Notice } = loadUiComponent('components/notice.tsx')
const { CommandList } = loadUiComponent('components/command-list.tsx')
const { AttentionRow } = loadUiComponent('components/attention-row.tsx')
const noop = () => {}
const groups = [
  {
    id: 'devices',
    label: '设备',
    items: [{ id: 'device:local', label: '这台电脑' }],
  },
  {
    id: 'actions',
    label: '操作',
    items: [{ id: 'action:new', label: '新建会话' }],
  },
]

test('static Notice remains quiet by default while errors and explicit status keep their intended announcement', () => {
  for (const tone of ['info', 'warn', 'ok']) {
    const html = renderToStaticMarkup(
      h(Notice, { tone, title: '静态说明' }, '已有能力说明'),
    )
    assert.doesNotMatch(html, /role="status"|role="alert"|aria-live=/u)
  }
  assert.match(
    renderToStaticMarkup(h(Notice, { tone: 'err' }, '操作失败')),
    /role="alert"/u,
  )
  assert.match(
    renderToStaticMarkup(h(Notice, { role: 'status' }, '操作完成')),
    /role="status"/u,
  )
})

test('dynamic connection, refresh and accepted-project notices explicitly opt into polite announcements', async () => {
  for (const [path, titles] of [
    [
      'components/machines/machines-page.tsx',
      ['正在重新连接', '设备列表未能更新', '项目列表未能更新'],
    ],
    [
      'components/machines/machine-detail-page.tsx',
      ['当前无法连接', '正在重新连接', '设备状态未能更新'],
    ],
    [
      'components/projects/project-conversation-collection.tsx',
      [
        '连接尚未恢复',
        '当前已加载的页面没有匹配项',
        '搜索结果未能更新',
        '会话列表未能更新',
      ],
    ],
    ['components/projects/project-detail-page.tsx', ['title={state.label}']],
    ['components/projects/created-project-step.tsx', ['项目已添加']],
    [
      'components/onboarding/onboarding-project-step.tsx',
      ['设备和项目列表未能更新'],
    ],
  ]) {
    const source = await readFile(
      new URL('../src/' + path, import.meta.url),
      'utf8',
    )
    for (const title of titles) {
      const titleIndex = source.indexOf(title)
      assert.ok(titleIndex >= 0, title)
      const noticeIndex = source.lastIndexOf('<Notice', titleIndex)
      assert.ok(noticeIndex >= 0, title)
      assert.match(
        source.slice(noticeIndex, titleIndex),
        /role="status"/u,
        path + ': ' + title,
      )
    }
  }
})

test('CommandList keeps visible headings outside listbox and owns only labelled groups with option descendants', () => {
  const html = commands()
  const listbox = /<div[^>]*role="listbox"[^>]*><\/div>/u.exec(html)?.[0]
  assert.ok(
    listbox,
    'the semantic listbox must not contain headings or status nodes',
  )
  const controls = /aria-controls="([^"]+)"/u.exec(html)?.[1]
  assert.ok(listbox.includes('id="' + controls + '"'))
  const owned = /aria-owns="([^"]+)"/u.exec(listbox)?.[1].split(' ')
  assert.equal(owned?.length, 2)
  for (const group of owned) {
    assert.ok(html.includes('id="' + group + '" role="group"'))
    const label = /aria-labelledby="([^"]+)"/u.exec(
      html.slice(html.indexOf('id="' + group + '"')),
    )?.[1]
    assert.ok(html.includes('<h3 id="' + label + '"'))
  }
  const active = /aria-activedescendant="([^"]+)"/u.exec(html)?.[1]
  assert.ok(html.includes('role="option" id="' + active + '"'))
  assert.match(html, /aria-expanded="true"/u)
})

test('CommandList expanded reflects actual popup visibility and empty status is outside the hidden listbox', () => {
  const collapsed = commands({ expanded: false })
  assert.match(collapsed, /aria-expanded="false"/u)
  assert.doesNotMatch(collapsed, /aria-activedescendant=/u)
  assert.match(collapsed, /hidden=""/u)
  const empty = commands({ groups: [], query: '不存在' })
  assert.match(empty, /aria-expanded="false"/u)
  assert.doesNotMatch(empty, /role="option"|aria-activedescendant=/u)
  assert.match(empty, /role="listbox"[^>]*><\/div>/u)
  assert.match(empty, /role="status"/u)
  assert.ok(empty.indexOf('role="status"') > empty.indexOf('role="listbox"'))
})

test('notification switches describe the exact row explanation with unique instance-local IDs', () => {
  const { DesktopNotificationSettings } = loadWebComponent(
    'components/settings/desktop-notification-settings.tsx',
  )
  const storage = { getItem: () => null, setItem() {} }
  const html = renderToStaticMarkup(
    h(DesktopNotificationSettings, { notificationAvailable: true, storage }),
  )
  const ids = [...html.matchAll(/aria-describedby="([^"]+)"/gu)].map(
    (match) => match[1],
  )
  assert.equal(ids.length, 3)
  assert.equal(new Set(ids).size, 3)
  for (const id of ids) assert.ok(html.includes('id="' + id + '"'))
  assert.match(html, /Codex 请求批准命令或文件操作时提醒/u)
})

test('background fixed behavior has a normal label without an offline status dot or unused notification prop', async () => {
  const { BackgroundSettings } = loadWebComponent(
    'components/settings/background-settings.tsx',
    new Map([
      [
        '@tanstack/react-router',
        { Link: ({ to, children }) => h('a', { href: to }, children) },
      ],
    ]),
  )
  const html = renderToStaticMarkup(h(BackgroundSettings, { available: true }))
  assert.match(html, /始终开启/u)
  assert.doesNotMatch(html, /data-tone="off"|role="switch"/u)
  const source = await readFile(
    new URL(
      '../src/components/settings/desktop-notification-settings.tsx',
      import.meta.url,
    ),
    'utf8',
  )
  assert.doesNotMatch(source, /backgroundRuntimeAvailable/u)
})

test('Roadmap is a section within product main, never a nested main landmark', () => {
  const { RoadmapPage } = loadWebComponent(
    'components/roadmap/roadmap-page.tsx',
  )
  const html = renderToStaticMarkup(h(RoadmapPage))
  assert.match(html, /^<section/u)
  assert.doesNotMatch(html, /<main/u)
  assert.match(html, /后续规划/u)
})

test('AttentionRow gives narrow-screen actions their own row below the full-width content', () => {
  const html = renderToStaticMarkup(
    h(AttentionRow, {
      mark: '提醒',
      title: '较长的会话标题',
      description: '需要批准',
      context: '设备 · 项目',
      time: '刚刚',
      actions: [
        h('button', { key: 'yes' }, '允许一次'),
        h('button', { key: 'no' }, '拒绝'),
      ],
    }),
  )
  const actions = /data-slot="attention-actions"[^>]*class="([^"]+)"/u.exec(
    html,
  )?.[1]
  assert.ok(actions?.includes('max-[600px]:col-start-2'))
  assert.ok(actions?.includes('max-[600px]:row-start-3'))
  assert.ok(actions?.includes('max-[600px]:justify-start'))
  assert.match(html, /max-\[600px\]:grid-cols-/u)
})

function commands(overrides = {}) {
  return renderToStaticMarkup(
    h(CommandList, {
      groups,
      query: '',
      onQueryChange: noop,
      onHighlightChange: noop,
      onSelect: noop,
      ...overrides,
    }),
  )
}
