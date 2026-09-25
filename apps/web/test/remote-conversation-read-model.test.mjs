import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyRemoteConversationLiveEvents,
  flattenRemoteConversationHistory,
  mergeRemoteTranscriptEntries,
} from '../.tmp/test-dist/runtime/account/remote-conversation-read-model.js'

const conversationId = 'conv_remote_read_model'
const epoch = '123e4567-e89b-42d3-a456-426614174000'

test('flattens seven remote pages into the exact 260-entry long transcript', () => {
  const pages = []
  for (let page = 6; page >= 0; page -= 1) {
    const start = page * 20
    const end = Math.min(130, start + 20)
    pages.push(durablePage(start, end, page !== 0))
  }
  const entries = flattenRemoteConversationHistory(pages)
  assert.equal(entries.length, 260)
  assert.equal(new Set(entries.map((entry) => entry.id)).size, 260)
  assert.equal(entries[0].id, 'turn_remote_000:user')
  assert.equal(entries[1].id, 'item_remote_000')
  assert.equal(entries[128].id, 'turn_remote_064:user')
  assert.equal(entries[129].id, 'item_remote_064')
  assert.equal(entries[258].id, 'turn_remote_129:user')
  assert.equal(entries[259].id, 'item_remote_129')
})

test('deduplicates replayed live events and lets durable gap recovery replace live state', () => {
  const delta = event(1, 'message.delta', { delta: 'hel' })
  const completed = event(2, 'message.completed', { message: 'hello' })
  const first = applyRemoteConversationLiveEvents(
    { entries: [], eventIds: new Set() },
    [delta, completed],
  )
  const replayed = applyRemoteConversationLiveEvents(first, [delta, completed])
  assert.equal(replayed.entries.length, 1)
  assert.equal(replayed.entries[0].content, 'hello')
  assert.equal(replayed.eventIds.size, 2)

  const durable = flattenRemoteConversationHistory([durablePage(0, 1, false)])
  const merged = mergeRemoteTranscriptEntries(durable, replayed.entries)
  assert.equal(merged.length, 2)
  assert.equal(merged[1].id, 'item_remote_000')
  assert.equal(merged[1].content, 'Answer 0')
})

test('fresh-session gap recovery fills durable output before later live events', () => {
  const beforeDisconnect = applyRemoteConversationLiveEvents(
    { entries: [], eventIds: new Set() },
    [
      event(
        10,
        'message.completed',
        { message: 'Answer 1' },
        'turn_remote_001',
        'item_remote_001',
      ),
    ],
  )
  const recoveredHistory = flattenRemoteConversationHistory([
    durablePage(0, 2, false),
  ])
  const afterReconnect = applyRemoteConversationLiveEvents(beforeDisconnect, [
    event(
      11,
      'message.completed',
      { message: 'Answer 2' },
      'turn_remote_002',
      'item_remote_002',
    ),
  ])
  const merged = mergeRemoteTranscriptEntries(
    recoveredHistory,
    afterReconnect.entries,
  )
  assert.deepEqual(
    merged.map(({ id }) => id),
    [
      'turn_remote_000:user',
      'item_remote_000',
      'turn_remote_001:user',
      'item_remote_001',
      'item_remote_002',
    ],
  )
  assert.equal(new Set(merged.map(({ id }) => id)).size, merged.length)
  assert.equal(merged[3].historical, true)
  assert.equal(merged[4].historical, false)
})

function durablePage(start, end, hasMoreBefore) {
  const turns = []
  const messages = []
  for (let index = start; index < end; index += 1) {
    const suffix = String(index).padStart(3, '0')
    const timestamp = new Date(
      Date.parse('2026-09-24T20:00:00.000Z') + index * 1_000,
    ).toISOString()
    turns.push({
      turnId: `turn_remote_${suffix}`,
      conversationId,
      status: 'completed',
      input: { type: 'text', text: `Prompt ${String(index)}`, timestamp },
      startedAt: timestamp,
      completedAt: timestamp,
    })
    messages.push({
      turnId: `turn_remote_${suffix}`,
      itemId: `item_remote_${suffix}`,
      text: `Answer ${String(index)}`,
      status: 'completed',
      timestamp,
      order: index + 1,
    })
  }
  return {
    protocolVersion: 1,
    conversationId,
    source: 'durable',
    runtime: {
      conversationId,
      turns,
      messages,
      tools: [],
      changes: [],
      terminal: { text: '', truncated: false },
      history: {
        evictedTurns: hasMoreBefore ? start : 0,
        evictedMessages: 0,
        evictedTools: 0,
        evictedChanges: 0,
        truncated: hasMoreBefore,
      },
    },
    ...(hasMoreBefore
      ? { beforeCursor: `history_${String(start).padStart(16, '0')}` }
      : {}),
    hasMoreBefore,
    historyComplete: !hasMoreBefore,
    liveCursor: `${epoch}:0`,
  }
}

function event(
  seq,
  type,
  payload,
  turnId = 'turn_remote_000',
  itemId = 'item_remote_000',
) {
  return {
    protocolVersion: 1,
    epoch,
    seq,
    eventId: `${epoch}:${String(seq)}`,
    conversationId,
    turnId,
    itemId,
    timestamp: '2026-09-24T20:00:00.000Z',
    type,
    payload,
  }
}
