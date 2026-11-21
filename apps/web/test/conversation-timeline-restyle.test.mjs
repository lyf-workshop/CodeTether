import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { loadWebComponent } from './fixtures/render-ui.mjs'
import { projectViewedFiles } from '../.tmp/test-dist/components/conversation/conversation-viewed-files.js'

const { ConversationTimeline } = loadWebComponent(
  'components/conversation/conversation-timeline.tsx',
)

test('a Turn with commentary, tools and final answer has one authoritative Provider header', () => {
  const turnId = 'turn_fixture'
  function message(id, body, author = 'agent') {
    return {
      kind: 'message',
      id,
      turnId,
      message: { id, author, body, time: '08:42', status: 'completed' },
    }
  }
  const blocks = [
    message('input', '检查文件', 'user'),
    message('commentary', '开始检查'),
    {
      kind: 'agent-run',
      id: 'tools',
      turnId,
      time: '08:43',
      status: 'running',
      executions: [
        {
          kind: 'tool',
          id: 'read',
          tool: {
            id: 'read',
            title: 'README.md',
            subject: 'README.md',
            status: 'completed',
            presentationKind: 'read-file',
          },
        },
      ],
    },
    message('answer', '这是检查结果'),
  ]
  const markup = renderToStaticMarkup(
    h(ConversationTimeline, {
      agent: 'codex',
      timeline: {
        dayLabel: '今天',
        blocks,
        turnHeaders: { [turnId]: { time: '08:40', status: 'waiting' } },
      },
      changes: { files: [], totals: { additions: 0, deletions: 0 } },
      pendingApprovals: [],
    }),
  )
  assert.equal((markup.match(/data-turn-header=/gu) ?? []).length, 1)
  assert.equal(
    (markup.match(/data-turn-anchor="turn_fixture"/gu) ?? []).length,
    1,
  )
  assert.match(markup, />Codex<.*等待批准.*08:40/u)
  assert.match(markup, /检查文件.*开始检查.*README\.md.*这是检查结果/u)
  assert.doesNotMatch(markup, />运行中</u)
})

test('a projected file edit shows its path and reported changed line count', () => {
  const file = {
    id: 'file_change',
    path: 'src/demo.ts',
    name: 'demo.ts',
    kind: 'modified',
    additions: 2,
    deletions: 1,
    lines: [{ kind: 'addition', content: '  return true' }],
  }
  const markup = renderToStaticMarkup(
    h(ConversationTimeline, {
      agent: 'codex',
      timeline: {
        dayLabel: '今天',
        blocks: [
          {
            kind: 'agent-run',
            id: 'run',
            turnId: 'turn_fixture',
            time: '08:40',
            status: 'completed',
            executions: [{ kind: 'diff', id: 'diff', changeId: file.id }],
          },
        ],
      },
      changes: { files: [file], totals: { additions: 2, deletions: 1 } },
      pendingApprovals: [],
    }),
  )
  assert.match(markup, /编辑.*改动 3 行/u)
  assert.match(markup, /src\/demo\.ts/u)
})

test('the running placeholder is plain muted text without a status border', () => {
  const markup = renderToStaticMarkup(
    h(ConversationTimeline, {
      agent: 'codex',
      timeline: {
        dayLabel: '今天',
        blocks: [
          {
            kind: 'agent-run',
            id: 'waiting-for-events',
            turnId: 'turn_fixture',
            time: '08:40',
            status: 'running',
            executions: [],
            outcomeText: '实时活动将在这里显示。',
          },
        ],
        turnHeaders: { turn_fixture: { time: '08:40', status: 'running' } },
      },
      changes: { files: [], totals: { additions: 0, deletions: 0 } },
      pendingApprovals: [],
    }),
  )
  const placeholder =
    /<p[^>]*data-turn-running="running"[^>]*>[^<]*实时活动将在这里显示。<\/p>/u.exec(
      markup,
    )?.[0]
  assert.ok(placeholder, markup)
  assert.match(placeholder, /text-text-muted/u)
  assert.doesNotMatch(placeholder, /border-|bg-timeline-system|正在运行/u)
})

test('viewed files retain real Read targets and recognized Search results only', () => {
  const tool = (kind, command, output, status = 'completed') => ({
    kind,
    command,
    output,
    status,
  })
  assert.deepEqual(
    projectViewedFiles(
      [
        tool('read', 'Read README.md'),
        tool('read', 'Read docs/My Document.md'),
        tool('read', 'Read ../private.txt'),
        tool('read', 'Read only-attempted.txt', undefined, 'failed'),
        tool(
          'search',
          'Grep token in .',
          'src/index.ts:5: match\nREADME.md\n搜索项目文件\nC:\\other\\external.txt',
        ),
        tool('search', 'Glob *.js', 'D:\\test\\example\\src\\more.js'),
        tool('search', 'Grep needle in .', 'No files found'),
        tool('command', 'Read pretend.txt'),
      ],
      'D:\\test\\example',
    ),
    ['README.md', 'docs/My Document.md', 'src/index.ts', 'src/more.js'],
  )
})
