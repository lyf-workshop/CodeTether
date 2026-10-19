import assert from 'node:assert/strict'
import test from 'node:test'

import {
  composerGatePresentation,
  createConversationDisplayContext,
  conversationPresentationForDetail,
} from '../.tmp/test-dist/components/conversation/conversation-gate-presentation.js'
import { deriveLiveControlAvailability } from '../.tmp/test-dist/components/conversation/conversation-controls.js'

const available = {
  canCompose: true,
  canInterrupt: false,
  supportsInterrupt: false,
  supportsApprovals: false,
  supportsDiff: false,
  supportsShell: false,
  supportsToolOutput: false,
  supportsReasoningControl: false,
  canStop: false,
  canResolveApproval: false,
}

test('a ready canonical Composer remains editable without a manufactured gate', () => {
  assert.equal(
    composerGatePresentation({
      capabilities: available,
      state: 'idle',
      providerName: 'Codex',
    }),
    undefined,
  )
  assert.equal(
    composerGatePresentation({
      capabilities: available,
      state: 'interrupted',
      providerName: 'Codex',
    }),
    undefined,
  )
})

test('a running local descriptor-supported session can expose exactly one stop action', () => {
  const result = composerGatePresentation({
    capabilities: {
      ...available,
      canCompose: false,
      canInterrupt: true,
      supportsInterrupt: true,
    },
    state: 'running',
    providerName: 'Codex',
    machineKind: 'local',
  })
  assert.equal(result.kind, 'running')
  assert.equal(result.canInterrupt, true)
  assert.match(result.description, /这一轮完成后/u)
})

test('a paired session cannot expose stopping even if a stale capability claims otherwise', () => {
  const result = composerGatePresentation({
    capabilities: {
      ...available,
      canCompose: false,
      canInterrupt: true,
      supportsInterrupt: true,
    },
    state: 'running',
    providerName: 'Codex',
    machineKind: 'remote',
  })
  assert.equal(result.canInterrupt, false)
  assert.match(result.description, /配对设备.+这里不能停止/u)
})

test('unsupported local interrupt follows the descriptor rather than the Provider name', () => {
  const result = composerGatePresentation({
    capabilities: { ...available, canCompose: false },
    state: 'running',
    providerName: '任意 AI 工具',
    machineKind: 'local',
  })
  assert.equal(result.canInterrupt, false)
  assert.match(result.description, /任意 AI 工具/u)
})

test('unknown Machine kind fails closed for stop without pretending it is local', () => {
  const result = composerGatePresentation({
    capabilities: {
      ...available,
      canCompose: false,
      canInterrupt: true,
      supportsInterrupt: true,
    },
    state: 'running',
    providerName: 'Codex',
  })
  assert.equal(result.canInterrupt, false)
})

test('machine/project/backend eligibility retains precedence over busy presentation', () => {
  for (const reason of [
    'machine_offline',
    'project_location_invalid',
    'login_required',
    'provider_service_unavailable',
  ]) {
    const result = composerGatePresentation({
      capabilities: {
        ...available,
        canCompose: false,
        composerDisabled: {
          reason,
          message: '真实后端说明',
          navigation: 'machine',
        },
      },
      state: 'running',
      providerName: 'Codex',
      machineKind: 'local',
    })
    assert.equal(result.kind, 'unavailable')
    assert.equal(result.description, '真实后端说明')
    assert.equal(result.navigation, 'machine')
    assert.equal(result.canInterrupt, false)
  }
})

test('an Approval gate describes actual canonical waiting state and preserves descriptor gate', () => {
  const result = composerGatePresentation({
    capabilities: {
      ...available,
      canCompose: false,
      canInterrupt: true,
      supportsInterrupt: true,
      supportsApprovals: true,
    },
    state: 'waiting',
    providerName: 'Codex',
    machineKind: 'local',
  })
  assert.equal(result.kind, 'waiting')
  assert.match(result.title, /批准/u)
  assert.equal(result.canInterrupt, true)
})

test('archive always blocks editing and offers restoration rather than a new execution', () => {
  const result = composerGatePresentation({
    capabilities: available,
    state: 'idle',
    providerName: 'Codex',
    archived: true,
    machineKind: 'local',
  })
  assert.equal(result.kind, 'archived')
  assert.equal(result.canInterrupt, false)
})

test('a paired or unsupported waiting state does not invent actionable Approval support', () => {
  const result = composerGatePresentation({
    capabilities: { ...available, canCompose: false },
    state: 'waiting',
    providerName: 'Claude Code',
    machineKind: 'remote',
  })
  assert.equal(result.kind, 'waiting')
  assert.doesNotMatch(result.title, /批准/u)
  assert.equal(result.canInterrupt, false)
})

test('submitting and disconnected states never imply a second send or automatic retry', () => {
  const pending = composerGatePresentation({
    capabilities: available,
    state: 'submitting',
    providerName: 'Codex',
  })
  const unavailable = composerGatePresentation({
    capabilities: available,
    state: 'unavailable',
    providerName: 'Codex',
  })
  assert.equal(pending.kind, 'submitting')
  assert.equal(unavailable.kind, 'unavailable')
  assert.equal(pending.canInterrupt, false)
  assert.equal(unavailable.canInterrupt, false)
})

test('context derives identity from durable Conversation arguments, not a globally selected device', () => {
  const result = context({
    machine: {
      machineId: 'machine_other',
      kind: 'local',
      displayName: '另一台设备',
    },
    project: { projectId: 'proj_other', name: '其他项目', locations: [] },
  })
  assert.equal(result.machineId, 'machine_owner')
  assert.equal(result.projectId, 'proj_owner')
  assert.equal(result.machineName, '设备')
  assert.equal(result.projectName, '项目')
  assert.equal(result.machineKind, undefined)
})

test('legacy multi-location projects show the exact owning Machine path', () => {
  const result = context({
    project: {
      projectId: 'proj_owner',
      name: '支付项目',
      locations: [
        { machineId: 'machine_other', rootPath: '/wrong' },
        { machineId: 'machine_owner', rootPath: '/srv/中文 有空格' },
      ],
    },
  })
  assert.equal(result.projectName, '支付项目')
  assert.equal(result.projectPath, '/srv/中文 有空格')
})

test('read/search limitation follows complete descriptor facts rather than tool-name hardcoding', () => {
  const descriptor = {
    displayName: '测试工具',
    capabilities: {
      fileRead: true,
      search: true,
      fileEdit: false,
      shell: false,
    },
  }
  assert.equal(context({ provider: descriptor }).readSearchOnly, true)
  assert.equal(
    context({
      provider: {
        ...descriptor,
        capabilities: { ...descriptor.capabilities, fileEdit: true },
      },
    }).readSearchOnly,
    false,
  )
  assert.equal(context().readSearchOnly, false)
})

test('reasoning appears only when explicitly set and described; imported origin remains explicit', () => {
  const provider = {
    displayName: 'Claude Code',
    capabilities: {
      fileRead: true,
      search: true,
      fileEdit: false,
      shell: false,
    },
    reasoningOptions: [{ id: 'high', label: '高' }],
  }
  assert.equal(context({ provider }).reasoning, undefined)
  assert.equal(context({ provider, reasoning: 'high' }).reasoning, '高')
  assert.equal(context({ provider, adopted: true }).importedFrom, 'Claude Code')
  assert.equal(context({ provider, adopted: false }).importedFrom, undefined)
  assert.equal(
    context({ adopted: true, providerName: 'Codex' }).importedFrom,
    'Codex',
  )
})

function context(overrides = {}) {
  return createConversationDisplayContext({
    machineId: 'machine_owner',
    projectId: 'proj_owner',
    adopted: false,
    ...overrides,
  })
}

function durableDetail() {
  const at = '2026-10-18T12:00:00.000Z'
  return {
    protocolVersion: 1,
    conversation: {
      conversationId: 'conv_snapshot01',
      projectId: 'proj_snapshot01',
      machineId: 'machine_snapshot01',
      title: '真实持久会话',
      titleSource: 'manual',
      origin: 'codetether',
      provider: 'codex',
      status: 'completed',
      createdAt: at,
      updatedAt: at,
      lastActivityAt: at,
    },
    runtime: {
      conversationId: 'conv_snapshot01',
      turns: [],
      messages: [],
      tools: [],
      changes: [],
      terminal: { text: '', truncated: false },
      history: {
        evictedTurns: 0,
        evictedMessages: 0,
        evictedTools: 0,
        evictedChanges: 0,
        truncated: false,
      },
    },
    history: {
      hasOlderHistory: false,
      retainedTurnCount: 0,
      totalTurnCount: 0,
    },
    pendingApprovals: [],
    approvalHistory: [],
  }
}

test('cold snapshot keeps exact durable detail available without writing the projection', () => {
  const projection = Object.freeze({
    cursor: { epoch: '11111111-1111-4111-8111-111111111111', seq: 8 },
    conversations: Object.freeze({}),
  })
  const before = JSON.stringify(projection)
  const result = conversationPresentationForDetail(
    projection,
    durableDetail(),
    'connected',
  )
  assert.equal(result.conversation.id, 'conv_snapshot01')
  assert.equal(result.conversation.title, '真实持久会话')
  assert.equal(result.connectionState, 'reconnecting')
  assert.equal(JSON.stringify(projection), before)
  assert.equal(Object.keys(projection.conversations).length, 0)
})

test('missing projection is renderable but never marks execution connected', () => {
  const result = conversationPresentationForDetail(
    undefined,
    durableDetail(),
    'connected',
  )
  assert.equal(result.conversation.id, 'conv_snapshot01')
  assert.equal(result.connectionState, 'reconnecting')
})

test('matching live projection remains the exact presentation authority', () => {
  const known = { id: 'conv_snapshot01', title: '实时权威记录' }
  const projection = { conversations: { conv_snapshot01: known } }
  const result = conversationPresentationForDetail(
    projection,
    durableDetail(),
    'connected',
  )
  assert.equal(result.conversation, known)
  assert.equal(result.connectionState, 'connected')
})

test('unrelated or mismatched projected conversation cannot replace owning durable detail', () => {
  const projection = {
    conversations: {
      conv_snapshot01: { id: 'conv_unrelated01', title: '另一会话' },
    },
  }
  const result = conversationPresentationForDetail(
    projection,
    durableDetail(),
    'connected',
  )
  assert.equal(result.conversation.id, 'conv_snapshot01')
  assert.equal(result.connectionState, 'reconnecting')
})

test('a real unavailable connection is never promoted by cached detail or live projection', () => {
  for (const connectionState of [
    'unavailable',
    'reconnecting',
    'incompatible',
    'connecting',
  ]) {
    const result = conversationPresentationForDetail(
      undefined,
      durableDetail(),
      connectionState,
    )
    assert.equal(result.connectionState, connectionState)
  }
})

test('fallback synchronization truth disables send, interrupt and approval through unchanged canonical controls', () => {
  const result = conversationPresentationForDetail(
    undefined,
    durableDetail(),
    'connected',
  )
  const controls = deriveLiveControlAvailability(
    result.connectionState,
    {
      streaming: true,
      resume: true,
      interrupt: true,
      approvals: true,
      diff: true,
      fileRead: true,
      fileEdit: true,
      shell: true,
      search: true,
      toolEvents: true,
      modelSelection: false,
      reasoningControl: false,
    },
    'running',
  )
  assert.equal(controls.canCompose, false)
  assert.equal(controls.canInterrupt, false)
  assert.equal(controls.canResolveApproval, false)
})
