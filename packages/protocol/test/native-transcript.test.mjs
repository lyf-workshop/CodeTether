import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ReadNativeTranscriptQuerySchema,
  ReadNativeTranscriptResponseSchema,
  nativeTranscriptWireLimits,
} from '../dist/index.js'

const conversationId = 'conv_native_transcript_protocol'
const timestamp = '2026-09-05T12:00:00.000Z'

test('native transcript query accepts only bounded opaque Host cursors', () => {
  assert.deepEqual(ReadNativeTranscriptQuerySchema.parse({}), {
    limit: nativeTranscriptWireLimits.defaultPageSize,
  })
  assert.equal(
    ReadNativeTranscriptQuerySchema.parse({
      limit: nativeTranscriptWireLimits.maximumPageSize,
      cursor: 'transcript_1234567890abcdef',
    }).limit,
    nativeTranscriptWireLimits.maximumPageSize,
  )
  for (const cursor of [
    '/Users/owner/.codex/session.jsonl',
    '../other-session',
    '128',
    'provider-private-session-id',
  ]) {
    assert.equal(
      ReadNativeTranscriptQuerySchema.safeParse({ cursor }).success,
      false,
      cursor,
    )
  }
  assert.equal(
    ReadNativeTranscriptQuerySchema.safeParse({
      limit: nativeTranscriptWireLimits.maximumPageSize + 1,
    }).success,
    false,
  )
})

test('native history remains a distinct read-only projection with identity-safe duplicates', () => {
  const page = ReadNativeTranscriptResponseSchema.parse(
    response([
      entry('native_11111111111111111111', 'yes', 'user'),
      entry('native_22222222222222222222', 'yes', 'user'),
      entry('native_33333333333333333333', 'visible answer', 'assistant'),
    ]),
  )
  assert.equal(page.entries.length, 3)
  assert.notEqual(page.entries[0].id, page.entries[1].id)
  assert.equal(page.entries[0].content, page.entries[1].content)
  for (const historical of page.entries) {
    assert.equal(historical.source, 'native_provider')
    assert.equal(historical.historical, true)
    assert.equal(historical.readOnly, true)
    assert.equal('turnId' in historical, false)
    assert.equal('actionId' in historical, false)
  }
})

test('native transcript response fails closed on scope, status, and private-field violations', () => {
  const validEntry = entry(
    'native_44444444444444444444',
    '<script>alert(1)</script> [link](javascript:bad)',
    'assistant',
  )
  assert.equal(
    ReadNativeTranscriptResponseSchema.safeParse(
      response([{ ...validEntry, conversationId: 'conv_other_scope' }]),
    ).success,
    false,
  )
  assert.equal(
    ReadNativeTranscriptResponseSchema.safeParse(
      response([{ ...validEntry, provider: 'claude-code' }]),
    ).success,
    false,
  )
  assert.equal(
    ReadNativeTranscriptResponseSchema.safeParse(
      response([{ ...validEntry, actionId: 'act_fake_history' }]),
    ).success,
    false,
  )
  assert.equal(
    ReadNativeTranscriptResponseSchema.safeParse({
      ...response([]),
      nativeSessionId: 'private-session',
    }).success,
    false,
  )
  assert.equal(
    ReadNativeTranscriptResponseSchema.safeParse({
      ...response([]),
      status: 'empty',
      complete: false,
      nextCursor: 'transcript_1234567890abcdef',
    }).success,
    false,
  )
  assert.equal(
    ReadNativeTranscriptResponseSchema.safeParse({
      ...response([]),
      status: 'available',
    }).success,
    false,
  )
})

function entry(id, content, role) {
  return {
    id,
    conversationId,
    source: 'native_provider',
    provider: 'codex',
    role,
    kind: 'message',
    content,
    occurredAt: timestamp,
    nativeSequence: 1,
    historical: true,
    readOnly: true,
  }
}

function response(entries) {
  return {
    protocolVersion: 1,
    conversationId,
    provider: 'codex',
    status: entries.length === 0 ? 'empty' : 'available',
    entries,
    complete: true,
    metrics: {
      bytesRead: 0,
      recordsScanned: entries.length,
      entriesReturned: entries.length,
      elapsedMs: 0,
      truncated: false,
    },
  }
}
