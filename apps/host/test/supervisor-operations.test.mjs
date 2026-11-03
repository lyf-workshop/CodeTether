import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AttentionListResponseSchema,
  ConversationFileChangeRecordSchema,
} from '@codetether/protocol'

import { executeSupervisorB1Operation } from '../dist/api/supervisor-operations.js'

const projectId = 'proj_supervisor_test'
const conversationId = 'conv_supervisor_test'
const turnId = 'turn_supervisor_test'
const timestamp = '2026-11-03T12:00:00.000Z'

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

  const fits = executeSupervisorB1Operation(
    {
      listAttention: () => ({ ...response, items: response.items.slice(0, 1) }),
    },
    request,
  )
  assert.equal(fits.items.length, 1)
  assert.equal(fits.truncated, false)
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
  assert.deepEqual(page.changes, [changes[2]])
  assert.equal(page.omittedChanges, 1)
  assert.equal(page.omittedDiffs, 0)
  assert.equal(page.nextOffset, 3)
  const next = read(page.nextOffset)
  assert.deepEqual(next.changes, changes.slice(3))
  assert.equal(next.omittedChanges, 0)
  assert.equal(next.nextOffset, undefined)
})
