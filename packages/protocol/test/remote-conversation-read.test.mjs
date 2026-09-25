import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ReadRemoteConversationHistoryQuerySchema,
  ReadRemoteConversationLiveQuerySchema,
  RemoteConversationHistoryPageSchema,
  RemoteConversationLivePageSchema,
} from '../dist/index.js'

const conversationId = 'conv_remote_history_test'
const epoch = '123e4567-e89b-42d3-a456-426614174000'

test('validates bounded remote history queries and completeness', () => {
  assert.deepEqual(ReadRemoteConversationHistoryQuerySchema.parse({}), {
    limit: 20,
  })
  const page = RemoteConversationHistoryPageSchema.parse({
    protocolVersion: 1,
    conversationId,
    source: 'durable',
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
    hasMoreBefore: false,
    historyComplete: true,
    liveCursor: `${epoch}:0`,
  })
  assert.equal(page.historyComplete, true)
  assert.equal(
    RemoteConversationHistoryPageSchema.safeParse({
      ...page,
      beforeCursor: 'history_1234567890abcdef',
      hasMoreBefore: false,
    }).success,
    false,
  )
})

test('validates conversation-scoped bounded live replay pages', () => {
  assert.deepEqual(
    ReadRemoteConversationLiveQuerySchema.parse({ cursor: `${epoch}:0` }),
    { cursor: `${epoch}:0`, limit: 64, waitMs: 10_000 },
  )
  const live = RemoteConversationLivePageSchema.parse({
    protocolVersion: 1,
    conversationId,
    cursor: `${epoch}:1`,
    events: [
      {
        protocolVersion: 1,
        epoch,
        seq: 1,
        eventId: `${epoch}:1`,
        conversationId,
        turnId: 'turn_remote_history_test',
        itemId: 'item_remote_history_test',
        timestamp: '2026-09-24T20:00:00.000Z',
        type: 'message.delta',
        payload: { delta: 'one' },
      },
    ],
    resetRequired: false,
    active: true,
    timedOut: false,
  })
  assert.equal(live.events.length, 1)
  assert.equal(
    RemoteConversationLivePageSchema.safeParse({
      ...live,
      conversationId: 'conv_wrong_scope_test',
    }).success,
    false,
  )
})
