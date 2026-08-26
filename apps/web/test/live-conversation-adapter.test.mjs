import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createLiveConversationDetailSource,
  createLiveConversationViewModel,
} from '../.tmp/test-dist/components/conversation/live-conversation-adapter.js'

const timestamp = '2026-08-26T12:00:00.000Z'

test('maps one Host read model to the frozen read-only Conversation ViewModel', () => {
  const viewModel = createLiveConversationViewModel(
    conversation({ status: 'waiting', pendingApprovals: [approval()] }),
  )

  assert.equal(viewModel.id, 'conv_live01')
  assert.equal(viewModel.status, 'waiting')
  assert.equal(viewModel.agent, 'codex')
  assert.equal(viewModel.permission, '等待审批')
  assert.deepEqual(viewModel.capabilities, {
    canCompose: false,
    canInterrupt: false,
    canStop: false,
    canResolveApproval: false,
  })
  assert.equal(viewModel.pendingApproval?.id, 'approval_live01')
})

test('uses one projected file change for Timeline Diff and Inspector Changes', () => {
  const viewModel = createLiveConversationViewModel(
    conversation({
      changes: [
        {
          id: 'src/example.ts',
          path: 'src/example.ts',
          kind: 'modified',
          additions: 1,
          deletions: 1,
          diffLines: [
            {
              kind: 'deletion',
              content: 'export const value = 1',
              oldLineNumber: 1,
            },
            {
              kind: 'addition',
              content: 'export const value = 2',
              newLineNumber: 1,
            },
          ],
          timestamp,
          order: 4,
        },
      ],
    }),
  )

  assert.equal(viewModel.changes.files[0]?.id, 'src/example.ts')
  assert.deepEqual(viewModel.changes.totals, { additions: 1, deletions: 1 })
  const run = viewModel.timeline.blocks.find(
    (block) => block.kind === 'agent-run',
  )
  assert.equal(run?.kind, 'agent-run')
  assert.equal(run?.executions[0]?.kind, 'diff')
  assert.equal(run?.executions[0]?.changeId, viewModel.changes.files[0]?.id)
})

test('builds live rail and connection indicator from the shared projection', () => {
  const selected = conversation({ updatedAt: '2026-08-26T12:10:00.000Z' })
  const older = conversation({
    id: 'conv_live02',
    title: 'another-workspace',
    updatedAt: timestamp,
  })
  const projection = {
    cursor: {
      epoch: '11111111-1111-4111-8111-111111111111',
      seq: 8,
    },
    conversations: { [selected.id]: selected, [older.id]: older },
  }

  const source = createLiveConversationDetailSource(
    selected,
    projection,
    'reconnecting',
  )

  assert.deepEqual(
    source.rail.groups[0]?.conversations.map((item) => item.id),
    ['conv_live01', 'conv_live02'],
  )
  assert.deepEqual(source.connectionIndicator, {
    state: 'reconnecting',
    label: '正在重新连接',
  })
})

function conversation(fields = {}) {
  return {
    id: 'conv_live01',
    cwd: 'E:\\spikes\\live-workspace',
    title: 'live-workspace',
    status: 'running',
    agent: 'codex',
    model: 'gpt-5.3-codex',
    reasoning: 'high',
    createdAt: timestamp,
    updatedAt: timestamp,
    currentTurn: {
      id: 'turn_live01',
      status: 'running',
      startedAt: timestamp,
    },
    messages: [],
    tools: [],
    changes: [],
    terminal: { text: '', truncated: false },
    pendingApprovals: [],
    ...fields,
  }
}

function approval() {
  return {
    id: 'approval_live01',
    kind: 'command',
    summary: 'echo safe',
    requestedAt: timestamp,
  }
}
