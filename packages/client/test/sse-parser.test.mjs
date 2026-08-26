import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ServerSentEventLimitError,
  ServerSentEventParser,
} from '../dist/index.js'

const encoder = new TextEncoder()

test('frames fragmented and multiple SSE messages', () => {
  const parser = new ServerSentEventParser()
  const first = parser.push(
    encoder.encode('id: epoch:1\nevent: host-event\ndata: {"part":'),
  )
  const second = parser.push(
    encoder.encode('1}\n\nid: epoch:2\ndata: line one\ndata: line two\n\n'),
  )

  assert.deepEqual(first, [])
  assert.deepEqual(second, [
    { id: 'epoch:1', event: 'host-event', data: '{"part":1}' },
    { id: 'epoch:2', event: 'message', data: 'line one\nline two' },
  ])
})

test('ignores comments and heartbeat-only blocks while retaining event id', () => {
  const parser = new ServerSentEventParser()

  assert.deepEqual(
    parser.push(
      encoder.encode(': heartbeat\r\nid: epoch:3\r\n\r\ndata: ready\r\n\r\n'),
    ),
    [{ id: 'epoch:3', event: 'message', data: 'ready' }],
  )
})

test('decodes a UTF-8 scalar split across chunks', () => {
  const parser = new ServerSentEventParser()
  const bytes = encoder.encode('data: 运行中 🚀\n\n')
  const rocket = [...bytes].findIndex((byte) => byte === 0xf0)

  assert.deepEqual(parser.push(bytes.slice(0, rocket + 2)), [])
  assert.deepEqual(parser.push(bytes.slice(rocket + 2)), [
    { id: '', event: 'message', data: '运行中 🚀' },
  ])
})

test('discards a truncated final event and ignores an id containing NUL', () => {
  const parser = new ServerSentEventParser()
  const complete = parser.push(
    encoder.encode(
      'id: accepted\nid: ignored\u0000id\ndata: complete\n\ndata: truncated',
    ),
  )

  assert.deepEqual(complete, [
    { id: 'accepted', event: 'message', data: 'complete' },
  ])
  assert.deepEqual(parser.finish(), [])
  assert.deepEqual(parser.finish(), [])
  assert.throws(() => parser.push(encoder.encode('data: late')), /finished/)
})

test('bounds one incomplete frame without limiting aggregate stream bytes', () => {
  const bounded = new ServerSentEventParser({ maxFrameBytes: 32 })
  assert.throws(
    () => bounded.push(encoder.encode(`data: ${'x'.repeat(40)}`)),
    ServerSentEventLimitError,
  )

  const manyFrames = new ServerSentEventParser({ maxFrameBytes: 32 })
  const frames = manyFrames.push(
    encoder.encode(
      Array.from(
        { length: 20 },
        (_, index) => `data: ${String(index)}\n\n`,
      ).join(''),
    ),
  )
  assert.equal(frames.length, 20)
})
