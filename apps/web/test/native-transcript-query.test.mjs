import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  flattenNativeTranscriptPages,
  nativeTranscriptInfiniteQueryOptions,
  nativeTranscriptStatus,
  shouldReadNativeTranscript,
} from '../.tmp/test-dist/runtime/host/native-transcript-query.js'

const conversationId = 'conv_native_transcript_web'
const timestamp = '2026-09-05T12:00:00.000Z'
const cursor = 'transcript_1234567890abcdef'

test('native transcript query forwards cancellation and advances only opaque Host cursors', async () => {
  const calls = []
  const client = {
    async readNativeTranscript(id, options) {
      calls.push({ id, options })
      return response(
        [entry('native_12345678901234567890', 'message')],
        calls.length === 1 ? cursor : undefined,
      )
    },
  }
  const options = nativeTranscriptInfiniteQueryOptions(client, conversationId)
  const signal = new AbortController().signal
  const first = await options.queryFn({
    queryKey: options.queryKey,
    pageParam: null,
    direction: 'forward',
    signal,
    meta: undefined,
  })
  const next = options.getNextPageParam(first, [first], null, [null])
  assert.equal(next, cursor)
  assert.equal(
    options.getNextPageParam(first, [first], cursor, [null, cursor]),
    null,
  )
  await options.queryFn({
    queryKey: options.queryKey,
    pageParam: next,
    direction: 'forward',
    signal,
    meta: undefined,
  })

  assert.deepEqual(options.queryKey, [
    'host',
    'native-transcript',
    conversationId,
  ])
  assert.deepEqual(calls[0], {
    id: conversationId,
    options: { limit: 50, signal },
  })
  assert.equal(calls[1].options.cursor, cursor)
  assert.strictEqual(calls[1].options.signal, signal)
})

test('native transcript pages flatten oldest first and deduplicate only opaque identity', () => {
  const sameText = 'Repeated visible text'
  const overlapping = entry('native_33333333333333333333', 'overlap')
  const pages = [
    response([overlapping, entry('native_44444444444444444444', sameText)]),
    response([
      entry('native_11111111111111111111', sameText),
      entry('native_22222222222222222222', sameText),
      overlapping,
    ]),
  ]

  const flattened = flattenNativeTranscriptPages(pages)
  assert.deepEqual(
    flattened.map(({ id }) => id),
    [
      'native_11111111111111111111',
      'native_22222222222222222222',
      'native_33333333333333333333',
      'native_44444444444444444444',
    ],
  )
  assert.equal(
    flattened.filter(({ content }) => content === sameText).length,
    3,
  )
})

test('native transcript status preserves every truthful history state', () => {
  for (const status of [
    'available',
    'empty',
    'unsupported',
    'unavailable',
    'machine_offline',
    'malformed',
  ]) {
    assert.equal(
      nativeTranscriptStatus([response([], undefined, status)]),
      status,
    )
  }
  assert.equal(
    nativeTranscriptStatus([
      response([], undefined, 'available'),
      response([], undefined, 'partial'),
    ]),
    'partial',
  )
  assert.equal(
    nativeTranscriptStatus([
      response([entry('native_55555555555555555555', 'readable')]),
      response([], undefined, 'malformed'),
    ]),
    'partial',
  )
  assert.equal(nativeTranscriptStatus(undefined), undefined)
})

test('automatic history reads are restricted to explicitly adopted native Conversations', () => {
  assert.equal(shouldReadNativeTranscript('adopted_native'), true)
  assert.equal(shouldReadNativeTranscript('codetether'), false)
  assert.equal(shouldReadNativeTranscript(undefined), false)
})

test('timeline exposes controlled state copy and routes history through the safe message renderer', async () => {
  const source = await readFile(
    new URL(
      '../src/components/conversation/conversation-timeline.tsx',
      import.meta.url,
    ),
    'utf8',
  )
  const historicalSource = source.slice(
    source.indexOf('function NativeConversationHistory'),
    source.indexOf('export function ConversationTimeline'),
  )
  for (const copy of [
    '没有更早的消息。',
    '原生继续仍可正常使用。',
    '暂时无法读取更早的消息。',
    '电脑重新连接后即可加载。',
    '更早的消息格式无法安全读取。',
    '仅显示了能够安全读取的部分更早消息。',
  ]) {
    assert.equal(historicalSource.includes(copy), true, copy)
  }
  assert.equal(source.includes('在 CodeTether 中继续'), true)
  assert.match(historicalSource, /history\.entries\.map/u)
  assert.match(historicalSource, /<AgentMessage/u)
  assert.doesNotMatch(historicalSource, /dangerouslySetInnerHTML/u)
  assert.doesNotMatch(historicalSource, /Retry|Rerun|Replay|Approval/u)
  assert.match(source, /\[timeline\.blocks, timeline\.nativeHistory\]/u)
})

function entry(id, content) {
  return {
    id,
    conversationId,
    source: 'native_provider',
    provider: 'codex',
    role: 'assistant',
    kind: 'message',
    content,
    occurredAt: timestamp,
    nativeSequence: 1,
    historical: true,
    readOnly: true,
  }
}

function response(entries, nextCursor, status = 'available') {
  return {
    protocolVersion: 1,
    conversationId,
    provider: 'codex',
    status,
    entries,
    ...(nextCursor === undefined ? {} : { nextCursor }),
    complete: nextCursor === undefined,
    metrics: {
      bytesRead: 0,
      recordsScanned: entries.length,
      entriesReturned: entries.length,
      elapsedMs: 0,
      truncated: status === 'partial' || nextCursor !== undefined,
    },
  }
}
