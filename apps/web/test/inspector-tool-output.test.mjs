import assert from 'node:assert/strict'
import test from 'node:test'
import { inspectorToolEntries } from '../.tmp/test-dist/components/conversation/inspector-tool-output.js'

test('Inspector previews commands, not their last output line', () => {
  const entries = inspectorToolEntries({
    dayLabel: '今天',
    blocks: [
      {
        kind: 'agent-run',
        id: 'run',
        turnId: 'turn_one',
        time: '12:00',
        status: 'completed',
        executions: [
          {
            kind: 'tool',
            id: 'tool-one',
            tool: {
              id: 'tool-one',
              title: '执行命令',
              subject: 'node --test',
              displayCommand: 'node --test',
              status: 'completed',
              outputSummary: 'duration_ms 90.7674',
            },
          },
          {
            kind: 'shell',
            id: 'shell-two',
            shell: {
              id: 'shell-two',
              command: 'powershell -Command "git status --short"',
              status: 'completed',
              summary: '-a---- 132 README.md',
            },
          },
        ],
      },
    ],
  })
  assert.deepEqual(entries, [
    { id: 'tool-one', title: 'node --test', status: 'completed' },
    { id: 'shell-two', title: 'git status --short', status: 'completed' },
  ])
})
