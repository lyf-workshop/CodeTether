import assert from 'node:assert/strict'
import test from 'node:test'
import { createDom, h } from './fixtures/dom.mjs'
import { loadWebComponent } from './fixtures/render-ui.mjs'

import {
  groupRunExecutions,
  isRoutineCompletedTool,
  routineToolGroupLabel,
} from '../.tmp/test-dist/components/conversation/tool-grouping.js'

test('groups three or more adjacent routine completed Tools deterministically', () => {
  const executions = [
    tool('read-1', 'read-file'),
    tool('git-1', 'git-status'),
    tool('read-2', 'read-file'),
    diff('change-1'),
    tool('read-3', 'read-file'),
    tool('read-4', 'read-file'),
  ]

  assert.deepEqual(groupRunExecutions(executions), [
    {
      kind: 'routine-tools',
      id: 'routine-tools:read-1',
      executions: executions.slice(0, 3),
    },
    { kind: 'single', execution: executions[3] },
    { kind: 'single', execution: executions[4] },
    { kind: 'single', execution: executions[5] },
  ])
  assert.deepEqual(
    groupRunExecutions(executions),
    groupRunExecutions(executions),
  )
})

test('keeps a 50-Tool stress run in one bounded collapsed presentation group', () => {
  const executions = Array.from({ length: 50 }, (_, index) =>
    tool(`read-${index + 1}`, 'read-file'),
  )
  const groups = groupRunExecutions(executions)

  assert.equal(groups.length, 1)
  assert.equal(groups[0].kind, 'routine-tools')
  assert.equal(groups[0].executions.length, 50)
  assert.deepEqual(
    groups[0].executions.map((execution) => execution.id),
    executions.map((execution) => execution.id),
  )
})

test('keeps generic commands, tests, failures, active Tools, actions, changes, and approvals independent', () => {
  const important = [
    tool('command', 'command'),
    tool('test', 'test'),
    tool('failed', 'command', { status: 'failed' }),
    tool('running', 'command', { status: 'running' }),
    tool('action', 'command', { actionLabel: '查看' }),
    tool('delta', 'command', { delta: { additions: 1, deletions: 0 } }),
    diff('change'),
    { kind: 'approval', id: 'approval', approvalId: 'appr_1' },
  ]

  assert.equal(
    important.every((execution) => {
      if (execution.kind !== 'tool') return true
      return !isRoutineCompletedTool(execution.tool)
    }),
    true,
  )
  assert.equal(
    groupRunExecutions(important).every((group) => group.kind === 'single'),
    true,
  )
})

test('tool rows keep bounded output out of the collapsed subject and support native button activation', async (t) => {
  const { ToolExecutionRow } = loadWebComponent(
    'components/conversation/conversation-tool-rows.tsx',
  )
  const dom = await createDom()
  t.after(() => dom.close())
  const execution = tool('command', 'command', {
    subject: 'Get-Content "C:\\scratch\\fixtures\\sample.txt" 等 2 条',
    displayCommand:
      'Get-Content "C:\\scratch\\fixtures\\sample.txt"; node --test',
    output: 'first output line\nlast output line',
    durationMs: 1200,
  })

  await dom.render(
    h(ToolExecutionRow, { execution, projectRootPath: 'C:\\scratch' }),
  )
  const button = dom.container.querySelector('button')
  assert.equal(button.type, 'button')
  assert.equal(button.getAttribute('aria-expanded'), 'false')
  assert.match(
    button.textContent,
    /Get-Content "fixtures\/sample.txt" 等 2 条/u,
  )
  assert.match(button.textContent, /1\.2 秒/u)
  assert.doesNotMatch(button.textContent, /last output line/u)
  assert.equal(dom.container.querySelector('pre'), null)

  button.focus()
  assert.equal(dom.window.document.activeElement, button)
  await dom.perform(() => button.click())
  assert.equal(button.getAttribute('aria-expanded'), 'true')
  assert.equal(
    dom.window.document.getElementById(button.getAttribute('aria-controls'))
      .hidden,
    false,
  )
  assert.equal(
    dom.container.querySelector('pre').textContent,
    'Get-Content "fixtures/sample.txt"; node --test',
  )
  assert.equal(
    dom.container.querySelector('[aria-label="工具输出"]').textContent,
    execution.tool.output,
  )
  assert.equal(dom.window.document.activeElement, button)
})

test('a tool row expands by default when it fails during streaming', async (t) => {
  const { ToolExecutionRow } = loadWebComponent(
    'components/conversation/conversation-tool-rows.tsx',
  )
  const dom = await createDom()
  t.after(() => dom.close())
  const render = (status) =>
    dom.render(
      h(ToolExecutionRow, {
        execution: tool('failing', 'command', {
          status,
          subject: 'Get-Content missing.txt',
          displayCommand: 'Get-Content missing.txt',
          failureSummary: '找不到路径',
          output: "Cannot find path 'missing.txt'",
        }),
      }),
    )

  await render('running')
  const button = dom.container.querySelector('button')
  assert.equal(button.getAttribute('aria-expanded'), 'false')
  await render('failed')
  assert.equal(button.getAttribute('aria-expanded'), 'true')
  assert.match(dom.container.textContent, /找不到路径/u)
  assert.match(dom.container.textContent, /Cannot find path/u)
  await dom.perform(() => button.click())
  assert.equal(button.getAttribute('aria-expanded'), 'false')
  assert.equal(dom.container.querySelector('pre'), null)
})

test('homogeneous group labels name the work and expansion reveals each original row', async (t) => {
  const { RoutineToolGroup } = loadWebComponent(
    'components/conversation/conversation-tool-rows.tsx',
  )
  const dom = await createDom()
  t.after(() => dom.close())
  const executions = [
    tool('a.txt', 'read-file'),
    tool('b.txt', 'read-file'),
    tool('c.txt', 'read-file'),
  ]
  await dom.render(h(RoutineToolGroup, { executions }))
  const button = dom.container.querySelector('button')
  assert.match(button.textContent, /读取 3 个文件/u)
  assert.equal(dom.container.querySelector('[data-tool-row]'), null)
  await dom.perform(() => button.click())
  assert.equal(dom.container.querySelectorAll('[data-tool-row]').length, 3)
  assert.deepEqual(
    [...dom.container.querySelectorAll('[data-tool-row] button')].map(
      (row) => row.querySelector('[title]').textContent,
    ),
    executions.map((execution) => execution.tool.title),
  )
  assert.equal(
    routineToolGroupLabel([
      ...executions.slice(0, 2),
      tool('git', 'git-status'),
    ]),
    '已完成 3 个操作',
  )
})

function tool(id, presentationKind, extra = {}) {
  return {
    kind: 'tool',
    id,
    tool: {
      id,
      title: id,
      status: 'completed',
      presentationKind,
      ...extra,
    },
  }
}

function diff(id) {
  return { kind: 'diff', id, changeId: id }
}
