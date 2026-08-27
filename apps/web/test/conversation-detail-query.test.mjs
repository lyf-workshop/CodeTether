import assert from 'node:assert/strict'
import test from 'node:test'

import { conversationDetailQueryOptions } from '../.tmp/test-dist/runtime/host/conversation-detail-query.js'

const conversationId = 'conv_cold01'
const timestamp = '2026-08-27T12:00:00.000Z'

test('cold detail query performs one read and no provider control operation', async () => {
  const calls = []
  const detail = emptyConversationDetail()
  const client = {
    async getConversation(id, options) {
      calls.push({ method: 'getConversation', id, signal: options?.signal })
      return detail
    },
    async startTurn() {
      throw new Error('A cold read must not start or resume a provider Turn')
    },
  }
  const options = conversationDetailQueryOptions(client, conversationId)
  const signal = new AbortController().signal

  const result = await options.queryFn({ signal })

  assert.strictEqual(result, detail)
  assert.deepEqual(options.queryKey, [
    'host',
    'conversation-detail',
    conversationId,
  ])
  assert.deepEqual(calls, [
    { method: 'getConversation', id: conversationId, signal },
  ])
})

function emptyConversationDetail() {
  return {
    protocolVersion: 1,
    conversation: {
      conversationId,
      projectId: 'proj_cold01',
      title: '新会话',
      provider: 'codex',
      status: 'idle',
      createdAt: timestamp,
      updatedAt: timestamp,
      lastActivityAt: timestamp,
    },
    runtime: {
      conversationId,
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
