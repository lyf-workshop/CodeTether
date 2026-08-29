import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

import {
  groupRunExecutions,
  isRoutineCompletedTool,
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

test('collapsed Tool groups defer mounting detail rows until explicit expansion', async () => {
  const source = await readFile(
    new URL(
      '../src/components/conversation/conversation-timeline.tsx',
      import.meta.url,
    ),
    'utf8',
  )

  assert.match(source, /aria-expanded=\{expanded\}/u)
  assert.match(
    source,
    /\{expanded \? \(\s*<div\s+data-tool-group-items="mounted"/u,
  )
  assert.match(source, /<ToolExecutionRow\s+key=\{execution\.id\}/u)
  assert.doesNotMatch(source, /<details/u)
})

test('Tool rows apply the same display-only Project path presentation', async () => {
  const source = await readFile(
    new URL(
      '../src/components/conversation/conversation-timeline.tsx',
      import.meta.url,
    ),
    'utf8',
  )

  assert.match(source, /presentProjectPaths\(tool\.title, projectRootPath\)/u)
  assert.match(source, /projectRootPath=\{projectRootPath\}/u)
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
