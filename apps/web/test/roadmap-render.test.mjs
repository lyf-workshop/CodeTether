import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadWebComponent } from './fixtures/render-ui.mjs'

const { RoadmapPage } = loadWebComponent('components/roadmap/roadmap-page.tsx')
test('real roadmap lists all eleven handoff gaps as plans, never enabled capabilities', () => {
  const html = renderToStaticMarkup(h(RoadmapPage))
  assert.equal((html.match(/data-roadmap-item=/gu) ?? []).length, 11)
  for (const title of [
    '同一账号下的 Mac 和 Windows',
    'Windows 设备配对',
    '远程停止',
    '远程审批',
    '删除会话',
    '运行中排队、补充指令',
    '跨项目按内容搜索',
    '选择模型与 Codex 推理强度',
    '浏览配对设备上的文件夹',
    'Claude Code 编辑、终端与变更',
    '开机启动、托盘快捷入口',
  ])
    assert.ok(html.includes(title), title)
  assert.match(html, /部分实现/u)
  assert.match(html, /尚未实现/u)
  assert.match(html, /目前还不能使用，也没有确定的时间/u)
  assert.doesNotMatch(html, /<button|<input|<select|<form|href=|onClick=/u)
})
