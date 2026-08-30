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
    supportsInterrupt: false,
    supportsApprovals: false,
    supportsDiff: false,
    supportsReasoningControl: false,
  })
  assert.equal(viewModel.pendingApprovals[0]?.id, 'approval_live01')
  assert.equal(
    viewModel.pendingApprovals[0]?.context,
    'E:\\spikes\\live-workspace',
  )
})

test('maps every pending Approval and enables only advertised live controls', () => {
  const viewModel = createLiveConversationViewModel(
    conversation({
      status: 'waiting',
      pendingApprovals: [
        approval(),
        { ...approval(), id: 'approval_live02', summary: 'Write file' },
      ],
    }),
    bootstrap('codex'),
    'connected',
  )

  assert.deepEqual(
    viewModel.pendingApprovals.map((approval) => approval.id),
    ['approval_live01', 'approval_live02'],
  )
  assert.deepEqual(viewModel.capabilities, {
    canCompose: false,
    canInterrupt: true,
    canStop: false,
    canResolveApproval: true,
    supportsInterrupt: true,
    supportsApprovals: true,
    supportsDiff: true,
    supportsReasoningControl: true,
  })
  assert.deepEqual(
    viewModel.timeline.blocks.flatMap((block) =>
      block.kind === 'agent-run'
        ? block.executions.flatMap((execution) =>
            execution.kind === 'approval' ? [execution.approvalId] : [],
          )
        : [],
    ),
    ['approval_live01', 'approval_live02'],
  )
})

test('presents a Provider-owned Claude effort label without changing durable identity', () => {
  const claudeBootstrap = bootstrap('claude-code')
  claudeBootstrap.providers[0].reasoningLabel = '思考强度'
  claudeBootstrap.providers[0].reasoningOptions = [
    { id: 'low', label: '低' },
    { id: 'high', label: '高' },
  ]

  const viewModel = createLiveConversationViewModel(
    conversation({ provider: 'claude-code', reasoning: 'low' }),
    claudeBootstrap,
    'connected',
  )

  assert.equal(viewModel.agent, 'claude')
  assert.equal(viewModel.provider, 'claude-code')
  assert.equal(viewModel.reasoning, '低')
})

test('uses one projected file change for Timeline Diff and Inspector Changes', () => {
  const viewModel = createLiveConversationViewModel(
    conversation({
      changes: [
        {
          id: 'src/example.ts',
          turnId: 'turn_live01',
          itemId: 'item_change01',
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

test('presents workspace file changes without leaking an absolute local path', () => {
  const viewModel = createLiveConversationViewModel(
    conversation({
      changes: [
        {
          id: 'absolute-change',
          turnId: 'turn_live01',
          itemId: 'item_change_absolute',
          path: 'E:\\spikes\\live-workspace\\src\\example.ts',
          kind: 'modified',
          additions: 1,
          deletions: 0,
          diffLines: [],
          timestamp,
          order: 4,
        },
      ],
    }),
  )

  assert.equal(viewModel.changes.files[0]?.path, 'src/example.ts')
  assert.equal(viewModel.context[0]?.label, 'src/example.ts')
})

test('uses the queried Project root to present cold durable file paths', () => {
  const viewModel = createLiveConversationViewModel(
    conversation({
      cwd: undefined,
      changes: [
        {
          id: 'cold-absolute-change',
          turnId: 'turn_live01',
          itemId: 'item_change_cold',
          path: 'E:\\spikes\\live-workspace\\src\\cold.ts',
          kind: 'modified',
          additions: 1,
          deletions: 0,
          diffLines: [],
          timestamp,
          order: 4,
        },
      ],
    }),
    undefined,
    'connected',
    'E:\\spikes\\live-workspace',
  )

  assert.equal(viewModel.changes.files[0]?.path, 'src/cold.ts')
  assert.equal(viewModel.context[0]?.label, 'src/cold.ts')
})

test('keeps two retained Turns in user/agent order', () => {
  const secondTurn = {
    id: 'turn_live02',
    status: 'running',
    startedAt: '2026-08-26T12:05:00.000Z',
    order: 1,
  }
  const viewModel = createLiveConversationViewModel(
    conversation({
      turns: [
        {
          id: 'turn_live01',
          status: 'completed',
          startedAt: timestamp,
          completedAt: '2026-08-26T12:04:00.000Z',
          order: 0,
        },
        secondTurn,
      ],
      currentTurn: secondTurn,
      messages: [
        message('turn_live01', 'input', 'user', 'First prompt', -1),
        message('turn_live01', 'answer', 'agent', 'First answer', 2),
        message('turn_live02', 'input', 'user', 'Second prompt', -1),
        message('turn_live02', 'answer', 'agent', 'Streaming answer', 7),
      ],
    }),
  )

  assert.deepEqual(
    viewModel.timeline.blocks
      .filter((block) => block.kind === 'message')
      .map((block) => [block.turnId, block.message.author, block.message.body]),
    [
      ['turn_live01', 'user', 'First prompt'],
      ['turn_live01', 'agent', 'First answer'],
      ['turn_live02', 'user', 'Second prompt'],
      ['turn_live02', 'agent', 'Streaming answer'],
    ],
  )
})

test('uses semantic Tool titles and keeps failure output out of the row title', () => {
  const command =
    'powershell -NoProfile -Command "Get-Content -LiteralPath \'missing.ts\'"'
  const fullFailure =
    "Get-Content: Cannot find path 'C:\\workspace\\missing.ts' because it does not exist. At line:1 char:1"
  const viewModel = createLiveConversationViewModel(
    conversation({
      tools: [
        tool('item_tool01', 'command', 'failed', {
          command,
          outputSummary: fullFailure,
        }),
        tool('item_tool02', 'command', 'completed', {
          command: 'powershell -NoProfile -Command "Write-Output safe"',
          order: 4,
        }),
      ],
      terminal: {
        turnId: 'turn_live01',
        itemId: 'item_tool01',
        toolId: 'turn_live01:item_tool01',
        command,
        text: fullFailure,
        truncated: false,
      },
    }),
  )
  const tools = viewModel.timeline.blocks.flatMap((block) =>
    block.kind === 'agent-run'
      ? block.executions.flatMap((execution) =>
          execution.kind === 'tool' ? [execution.tool] : [],
        )
      : [],
  )

  assert.deepEqual(
    tools.map((entry) => [entry.title, entry.description, entry.outputSummary]),
    [
      ['读取文件', undefined, 'Path not found'],
      ['执行命令', undefined, undefined],
    ],
  )
  assert.equal(tools[1].title.includes('powershell'), false)
  assert.equal(tools[0].title.includes('Cannot find path'), false)
  assert.equal(JSON.stringify(tools).includes('Write-Output safe'), false)
  assert.equal(viewModel.terminal.lines.join('\n'), fullFailure)
})

test('builds the live rail from durable Host summaries without fake metadata', () => {
  const selected = conversation({ updatedAt: '2026-08-26T12:10:00.000Z' })
  const summaries = [
    summary({
      conversationId: 'conv_live01',
      title: 'Host-owned title',
      lastActivityAt: '2026-08-26T12:10:00.000Z',
    }),
    summary({
      conversationId: 'conv_live02',
      title: 'Older durable Conversation',
      status: 'completed',
    }),
  ]

  const source = createLiveConversationDetailSource(
    { ...selected, title: 'Host-owned title' },
    summaries,
    'reconnecting',
  )

  assert.deepEqual(
    source.rail.groups[0]?.conversations.map((item) => item.id),
    ['conv_live01', 'conv_live02'],
  )
  assert.deepEqual(
    source.rail.groups[0]?.conversations.map((item) => [
      item.title,
      item.status,
      item.machine,
    ]),
    [
      ['Host-owned title', 'running', undefined],
      ['Older durable Conversation', 'completed', undefined],
    ],
  )
  assert.equal(source.rail.archivedCount, undefined)
  assert.equal(source.rail.currentArchivedConversation, undefined)
  assert.equal(source.conversation.title, 'Host-owned title')
  assert.deepEqual(source.connectionIndicator, {
    state: 'reconnecting',
    label: '正在重新连接',
  })
})

test('passes the queried Machine display name through Detail and Rail', () => {
  const source = createLiveConversationDetailSource(
    conversation(),
    [summary()],
    'connected',
    undefined,
    'available',
    'E:\\spikes\\live-workspace',
    '本地电脑',
  )

  assert.equal(source.conversation.machine, '本地电脑')
  assert.equal(source.rail.groups[0].conversations[0].machine, '本地电脑')
})

test('keeps Codex and Claude Code as distinct durable Rail groups', () => {
  const selected = conversation({
    provider: 'claude-code',
    title: 'Claude conversation',
  })
  const source = createLiveConversationDetailSource(
    selected,
    [
      summary({ conversationId: 'conv_codex01', title: 'Codex conversation' }),
      summary({
        conversationId: 'conv_live01',
        title: 'Claude conversation',
        provider: 'claude-code',
      }),
    ],
    'connected',
    bootstrap('claude-code', {
      interrupt: false,
      approvals: false,
      diff: false,
      reasoningControl: false,
    }),
  )

  assert.deepEqual(
    source.rail.groups.map((group) => [
      group.agent,
      group.conversations.map((item) => [item.id, item.provider]),
    ]),
    [
      ['codex', [['conv_codex01', 'codex']]],
      ['claude', [['conv_live01', 'claude-code']]],
    ],
  )
  assert.equal(source.conversation.provider, 'claude-code')
  assert.equal(source.conversation.agent, 'claude')
  assert.equal(source.conversation.capabilities.supportsInterrupt, false)
  assert.equal(source.conversation.capabilities.supportsApprovals, false)
  assert.equal(source.conversation.capabilities.supportsDiff, false)
  assert.equal(source.conversation.capabilities.supportsReasoningControl, false)
})

test('projects durable organization metadata into Detail and active Rail without reordering', () => {
  const source = createLiveConversationDetailSource(
    conversation({
      title: 'Pinned manual title',
      titleSource: 'manual',
      pinnedAt: '2026-08-26T12:09:00.000Z',
    }),
    [
      summary({
        title: 'Pinned manual title',
        titleSource: 'manual',
        pinnedAt: '2026-08-26T12:09:00.000Z',
      }),
      summary({
        conversationId: 'conv_live02',
        title: 'Host second',
      }),
    ],
    'connected',
  )

  assert.equal(source.conversation.titleSource, 'manual')
  assert.equal(source.conversation.pinnedAt, '2026-08-26T12:09:00.000Z')
  assert.deepEqual(
    source.rail.groups[0].conversations.map((item) => [item.id, item.pinnedAt]),
    [
      ['conv_live01', '2026-08-26T12:09:00.000Z'],
      ['conv_live02', undefined],
    ],
  )
})

test('isolates only the current archived Conversation above the active Rail', () => {
  const archivedAt = '2026-08-26T12:20:00.000Z'
  const source = createLiveConversationDetailSource(
    conversation({
      title: 'Archived history',
      titleSource: 'manual',
      archivedAt,
      status: 'completed',
      currentTurn: undefined,
      turns: [],
    }),
    [
      // A stale active-index copy must not duplicate the current archived item.
      summary({ title: 'Stale active title' }),
      summary({
        conversationId: 'conv_live02',
        title: 'Active history',
        status: 'completed',
      }),
      summary({
        conversationId: 'conv_live03',
        title: 'Unexpected archived result',
        status: 'completed',
        archivedAt,
      }),
    ],
    'connected',
  )

  assert.deepEqual(
    {
      ...source.rail.currentArchivedConversation,
      lastActivity: undefined,
    },
    {
      id: 'conv_live01',
      title: 'Archived history',
      titleSource: 'manual',
      archivedAt,
      status: 'completed',
      lastActivity: undefined,
      provider: 'codex',
    },
  )
  assert.match(
    source.rail.currentArchivedConversation.lastActivity,
    /^\d{2}:\d{2}$/u,
  )
  assert.deepEqual(
    source.rail.groups[0].conversations.map((item) => item.id),
    ['conv_live02'],
  )
  assert.equal(source.conversation.archivedAt, archivedAt)
})

test('keeps unavailable Project history visible while disabling controls', () => {
  const source = createLiveConversationDetailSource(
    conversation({ turns: [], currentTurn: undefined }),
    [summary()],
    'connected',
    bootstrap('codex'),
    'unavailable',
  )

  assert.deepEqual(source.conversation.capabilities, {
    canCompose: false,
    canInterrupt: false,
    canStop: false,
    canResolveApproval: false,
    supportsInterrupt: true,
    supportsApprovals: true,
    supportsDiff: true,
    supportsReasoningControl: true,
  })
  assert.deepEqual(source.connectionIndicator, {
    state: 'unavailable',
    label: '项目不可用',
  })
  assert.deepEqual(source.conversation.timeline.blocks, [])
})

function conversation(fields = {}) {
  const currentTurn = fields.currentTurn ?? {
    id: 'turn_live01',
    status: 'running',
    startedAt: timestamp,
    order: 0,
  }
  return {
    id: 'conv_live01',
    cwd: 'E:\\spikes\\live-workspace',
    title: 'live-workspace',
    titleSource: 'generated',
    status: 'running',
    provider: 'codex',
    model: 'gpt-5.3-codex',
    reasoning: 'high',
    createdAt: timestamp,
    updatedAt: timestamp,
    lastActivityAt: timestamp,
    turns: fields.turns ?? [currentTurn],
    currentTurn,
    messages: [],
    tools: [],
    changes: [],
    terminal: { text: '', truncated: false },
    pendingApprovals: [],
    ...fields,
  }
}

function bootstrap(provider, capabilityOverrides = {}) {
  const capabilities = {
    streaming: true,
    resume: true,
    interrupt: true,
    approvals: true,
    fileRead: true,
    fileEdit: true,
    shell: true,
    search: true,
    diff: true,
    toolEvents: true,
    modelSelection: true,
    reasoningControl: true,
    ...capabilityOverrides,
  }
  return {
    protocolVersion: 1,
    hostVersion: 'test',
    epoch: 'epoch_provider_test',
    capabilities: {
      codex: true,
      approvals: true,
      interrupt: true,
      resume: true,
      diff: true,
      streaming: true,
    },
    providers: [
      {
        provider,
        displayName: provider === 'codex' ? 'Codex' : 'Claude Code',
        availability: 'available',
        capabilities,
      },
    ],
  }
}

function summary(fields = {}) {
  return {
    conversationId: 'conv_live01',
    projectId: 'proj_live01',
    title: 'live-workspace',
    titleSource: 'generated',
    provider: 'codex',
    model: 'gpt-5.3-codex',
    reasoning: 'high',
    status: 'running',
    createdAt: timestamp,
    updatedAt: timestamp,
    lastActivityAt: timestamp,
    ...fields,
  }
}

function approval() {
  return {
    id: 'approval_live01',
    turnId: 'turn_live01',
    kind: 'command',
    summary: 'echo safe',
    requestedAt: timestamp,
  }
}

function message(turnId, suffix, author, body, order) {
  return {
    id: `${turnId}:${suffix}`,
    turnId,
    ...(author === 'agent' ? { itemId: `item_${suffix}` } : {}),
    author,
    body,
    status: author === 'agent' ? 'running' : 'completed',
    timestamp,
    order,
  }
}

function tool(itemId, name, status, fields = {}) {
  return {
    id: `turn_live01:${itemId}`,
    turnId: 'turn_live01',
    itemId,
    name,
    status,
    timestamp,
    order: 3,
    ...fields,
  }
}
