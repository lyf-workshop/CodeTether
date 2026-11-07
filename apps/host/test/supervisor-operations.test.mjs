import assert from 'node:assert/strict'
import test from 'node:test'

import { encodeMachineFrame } from '@codetether/machine-transport'
import {
  AttentionListResponseSchema,
  ConversationFileChangeRecordSchema,
  GetMachineResponseSchema,
  ListMachinesResponseSchema,
  SupervisorAttentionListResponseSchema,
} from '@codetether/protocol'
import { supervisorReadTruncated } from '@codetether/supervisor-transport'

import {
  supervisorBootstrap,
  supervisorMachineDetail,
  supervisorMachineList,
} from '../dist/api/supervisor-machine-reads.js'
import { executeSupervisorB1Operation } from '../dist/api/supervisor-operations.js'

const projectId = 'proj_supervisor_test'
const conversationId = 'conv_supervisor_test'
const turnId = 'turn_supervisor_test'
const timestamp = '2026-11-03T12:00:00.000Z'
const machineId = 'machine_supervisor_test'

function assertFitsFrame(data) {
  const frame = encodeMachineFrame({
    type: 'supervisor.response',
    protocolVersion: 1,
    requestId: `sreq_${'r'.repeat(96)}`,
    ok: true,
    data,
  })
  assert.ok(frame.readUInt32BE(0) <= 16 * 1024)
}

test('Supervisor bootstrap keeps the public identity with oversized display metadata', () => {
  const publicJwk = JSON.stringify({
    kty: 'EC',
    crv: 'P-256',
    x: 'x'.repeat(43),
    y: 'y'.repeat(43),
  })
  const identity = {
    hostId: `host_${'h'.repeat(32)}`,
    identityGeneration: 1,
    safeLabel: '测试电脑',
    appVersion: '版本'.repeat(12_000),
    platform: 'win32',
    publicJwk: '\t'.repeat(8192 - publicJwk.length) + publicJwk,
    updatedAt: `2026-11-03T12:00:00.${'1'.repeat(4096)}Z`,
    keyHandle: 'fixture-reference',
  }
  const result = supervisorBootstrap(identity)
  assertFitsFrame(result)
  assert.equal(result.identity.hostId, identity.hostId)
  assert.equal(result.identity.identityGeneration, 1)
  assert.equal(result.identity.platform, 'win32')
  assert.deepEqual(JSON.parse(result.identity.publicJwk), JSON.parse(publicJwk))
  assert.equal(result.identity.updatedAt, '2026-11-03T12:00:00.111Z')
  assert.equal(result.truncated, true)
  assert.ok(result.identity.appVersion.endsWith('…'))
  assert.equal('keyHandle' in result.identity, false)
})

test('Supervisor bounds the machine directory and retains both Providers and connection data', () => {
  const machine = {
    machineId,
    displayName: '设备'.repeat(120),
    kind: 'remote',
    platform: 'windows',
    architecture: 'x64',
    availability: 'unavailable',
    connectionState: 'offline',
    trustState: 'trusted',
    isLocal: false,
    createdAt: timestamp,
    capabilities: {
      projectAccess: false,
      providerExecution: false,
      backgroundRuntime: false,
      nativeFolderPicker: false,
      notifications: false,
    },
  }
  const machines = Array.from({ length: 64 }, (_, index) => ({
    ...machine,
    machineId: `machine_supervisor_${index}`,
  }))
  const list = ListMachinesResponseSchema.parse({
    protocolVersion: 1,
    machines,
  })
  assert.throws(() => assertFitsFrame(list), RangeError)
  const bounded = supervisorMachineList(list)
  assertFitsFrame(bounded)
  assert.equal(bounded[supervisorReadTruncated], true)
  ListMachinesResponseSchema.parse(JSON.parse(JSON.stringify(bounded)))
  assert.ok(bounded.machines.length > 0)
  assert.deepEqual(bounded.machines, machines.slice(0, bounded.machines.length))

  const providers = ['codex', 'claude-code'].map((provider) => ({
    provider,
    displayName: provider,
    availability: 'available',
    capabilities: {
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
    },
    models: Array.from({ length: 64 }, (_, index) => ({
      id: `model-${index}`,
      label: '模型'.repeat(120),
    })),
    reasoningOptions: Array.from({ length: 16 }, (_, index) => ({
      id: `${index}${'选'.repeat(116)}`,
      label: '推理'.repeat(60),
    })),
  }))
  const connection = { state: 'offline', executionTransport: 'unavailable' }
  const detail = GetMachineResponseSchema.parse({
    protocolVersion: 1,
    machine,
    providers,
    connection,
    providerDiscovery: { state: 'last_known', observedAt: timestamp },
    projects: [],
    conversations: [],
  })
  const result = supervisorMachineDetail(detail)
  assertFitsFrame(result)
  assert.equal(result[supervisorReadTruncated], true)
  GetMachineResponseSchema.parse({
    ...JSON.parse(JSON.stringify(result)),
    projects: [],
    conversations: [],
  })
  assert.deepEqual(result.machine, machine)
  assert.deepEqual(result.connection, connection)
  assert.deepEqual(result.providerDiscovery, detail.providerDiscovery)
  assert.deepEqual(
    result.providers.map((row) => row.provider),
    ['codex', 'claude-code'],
  )
  for (const [index, row] of result.providers.entries()) {
    assert.deepEqual(row.capabilities, providers[index].capabilities)
    assert.ok(row.reasoningOptions.length > 0)
    assert.ok(
      row.reasoningOptions.length < providers[index].reasoningOptions.length,
    )
    assert.deepEqual(
      row.reasoningOptions,
      providers[index].reasoningOptions.slice(0, row.reasoningOptions.length),
    )
  }
})

test('Supervisor recent responses keep complete identities and titles in the bounded prefix', () => {
  const recent = Array.from({ length: 30 }, (_, index) => ({
    machineId,
    projectId,
    conversationId: `conv_supervisor_${index}`,
    title: '标题'.repeat(120),
    provider: 'codex',
    status: 'completed',
  }))
  const result = executeSupervisorB1Operation(
    { listRecentSupervisorConversations: () => recent },
    { operation: 'conversation.recent', machineId, limit: 30 },
  )
  assertFitsFrame(result)
  assert.equal(result.truncated, true)
  assert.ok(result.conversations.length > 0)
  assert.deepEqual(
    result.conversations,
    recent.slice(0, result.conversations.length),
  )
})

test('Supervisor reports byte truncation without changing Attention totals', () => {
  const items = Array.from({ length: 60 }, (_, index) => ({
    attentionId: `attn_supervisor_${index}`,
    projectId,
    conversationId,
    turnId,
    type: 'completed_review',
    status: 'open',
    createdAt: timestamp,
    updatedAt: timestamp,
    payload: { conversationTitle: `Review ${index}` },
  }))
  const response = AttentionListResponseSchema.parse({
    protocolVersion: 1,
    items,
    summary: {
      totalOpen: items.length,
      approvalOpen: 0,
      completedReviewOpen: items.length,
      failedOpen: 0,
    },
  })
  const request = { operation: 'attention.list', status: 'open', limit: 100 }
  const clipped = executeSupervisorB1Operation(
    { listAttention: () => response },
    request,
  )
  assert.ok(clipped.items.length < items.length)
  assert.deepEqual(clipped.items, response.items.slice(0, clipped.items.length))
  assert.deepEqual(clipped.summary, response.summary)
  assert.equal(clipped.truncated, true)
  assertFitsFrame(clipped)

  const fits = executeSupervisorB1Operation(
    {
      listAttention: () => ({ ...response, items: response.items.slice(0, 1) }),
    },
    request,
  )
  assert.equal(fits.items.length, 1)
  assert.equal(fits.truncated, false)
})

test('Supervisor retains an approval whose escaped subtitle exceeds the frame', () => {
  const approvalId = 'approval_supervisor_test'
  const item = {
    attentionId: 'attn_supervisor_approval',
    projectId,
    conversationId,
    turnId,
    type: 'approval',
    status: 'open',
    createdAt: timestamp,
    updatedAt: timestamp,
    payload: {
      approvalId,
      kind: 'command',
      actionTitle: 'Approval',
      actionSubtitle: '\u0000'.repeat(4096),
    },
  }
  const attention = AttentionListResponseSchema.parse({
    protocolVersion: 1,
    items: [item],
    summary: {
      totalOpen: 1,
      approvalOpen: 1,
      completedReviewOpen: 0,
      failedOpen: 0,
    },
  })
  const result = SupervisorAttentionListResponseSchema.parse(
    executeSupervisorB1Operation(
      { listAttention: () => attention },
      { operation: 'attention.list', status: 'open', limit: 50 },
    ),
  )
  assertFitsFrame(result)
  assert.equal(result.truncated, true)
  assert.equal(result.items[0].payload.approvalId, approvalId)
  assert.equal(result.items[0].payload.actionTitle, item.payload.actionTitle)
  assert.ok(result.items[0].payload.actionSubtitle.endsWith('…'))
})

test('Supervisor advances past an oversized change and keeps later pages readable', () => {
  const paths = [
    'first.ts',
    '界'.repeat(4096),
    '字'.repeat(3000),
    '文'.repeat(1200),
    'last.ts',
  ]
  const changes = paths.map((path, order) =>
    ConversationFileChangeRecordSchema.parse({
      turnId,
      path,
      kind: 'modified',
      timestamp,
      order,
    }),
  )
  const read = (offset) =>
    executeSupervisorB1Operation(
      {
        getSupervisorConversation() {},
        getConversation: () => ({ runtime: { changes } }),
      },
      {
        operation: 'conversation.changes',
        machineId: 'machine_supervisor_test',
        projectId,
        conversationId,
        offset,
      },
    )
  const page = read(1)
  assertFitsFrame(page)
  assert.deepEqual(page.changes, [changes[2]])
  assert.equal(page.omittedChanges, 1)
  assert.equal(page.omittedDiffs, 0)
  assert.equal(page.nextOffset, 3)
  const next = read(page.nextOffset)
  assertFitsFrame(next)
  assert.deepEqual(next.changes, changes.slice(3))
  assert.equal(next.omittedChanges, 0)
  assert.equal(next.nextOffset, undefined)
})
