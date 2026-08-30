import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import test from 'node:test'

import {
  boundUtf8,
  ClaudeCodeSessionLostError,
  ClaudeStreamNormalizer,
  normalizeClaudeTool,
} from '../dist/index.js'

const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const cwd = resolve('fixture-workspace')

function createNormalizer() {
  return new ClaudeStreamNormalizer({
    sessionId,
    turnId: 'turn_fixture',
    cwd,
    now: () => '2026-08-29T00:00:00.000Z',
  })
}

function init(overrides = {}) {
  return {
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    claude_code_version: '2.1.250',
    cwd,
    ...overrides,
  }
}

test('bounds UTF-8 text with an unambiguous ASCII suffix', () => {
  assert.equal(boundUtf8('alpha beta', 8), 'alpha...')
  assert.equal(Buffer.byteLength(boundUtf8('你好世界', 8), 'utf8'), 6)
})

test('validates init identity and emits canonical lifecycle events', () => {
  const normalizer = createNormalizer()
  assert.deepEqual(
    normalizer.consume(init()).map((event) => event.type),
    ['conversation.started', 'turn.started'],
  )
  assert.equal(normalizer.initialized, true)

  assert.throws(
    () => createNormalizer().consume(init({ session_id: 'wrong' })),
    ClaudeCodeSessionLostError,
  )
  assert.throws(
    () => createNormalizer().consume(init({ cwd: resolve('other') })),
    /unsupported response/,
  )
})

test('streams deltas and completes from the full message without duplicating text', () => {
  const normalizer = createNormalizer()
  normalizer.consume(init())
  normalizer.consume({
    type: 'stream_event',
    session_id: sessionId,
    event: { type: 'message_start', message: { id: 'provider-message' } },
  })
  const delta = normalizer.consume({
    type: 'stream_event',
    session_id: sessionId,
    event: {
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'hello' },
    },
  })
  const completed = normalizer.consume({
    type: 'assistant',
    session_id: sessionId,
    uuid: 'assistant-uuid',
    message: {
      id: 'provider-message',
      content: [{ type: 'text', text: 'hello' }],
    },
  })
  const duplicate = normalizer.consume({
    type: 'assistant',
    session_id: sessionId,
    uuid: 'assistant-uuid',
    message: {
      id: 'provider-message',
      content: [{ type: 'text', text: 'hello' }],
    },
  })

  assert.deepEqual(
    delta.map((event) => event.type),
    ['message.delta'],
  )
  assert.equal(delta[0].delta, 'hello')
  assert.deepEqual(
    completed.map((event) => event.type),
    ['message.completed'],
  )
  assert.equal(completed[0].message, 'hello')
  assert.deepEqual(duplicate, [])
})

test('does not let a thinking-only snapshot hide later public text', () => {
  const normalizer = createNormalizer()
  normalizer.consume(init())
  normalizer.consume({
    type: 'stream_event',
    session_id: sessionId,
    event: { type: 'message_start', message: { id: 'provider-message' } },
  })
  const thinking = normalizer.consume({
    type: 'assistant',
    session_id: sessionId,
    message: {
      id: 'provider-message',
      content: [{ type: 'thinking', thinking: 'private reasoning' }],
    },
  })
  const completed = normalizer.consume({
    type: 'assistant',
    session_id: sessionId,
    message: {
      id: 'provider-message',
      content: [{ type: 'text', text: 'public answer' }],
    },
  })

  assert.deepEqual(thinking, [])
  assert.deepEqual(
    completed.map((event) => event.type),
    ['message.completed'],
  )
  assert.equal(completed[0].message, 'public answer')
  assert.doesNotMatch(JSON.stringify(completed), /private reasoning/)
})

test('maps only exact high-confidence tool names and pairs tool results', () => {
  assert.deepEqual(normalizeClaudeTool('Read'), {
    name: 'Read',
    kind: 'read',
    summary: 'Read file',
  })
  assert.equal(normalizeClaudeTool('Write').kind, 'edit')
  assert.equal(normalizeClaudeTool('Edit').kind, 'edit')
  assert.equal(normalizeClaudeTool('Bash').kind, 'shell')
  assert.equal(normalizeClaudeTool('PowerShell').kind, 'shell')
  assert.equal(normalizeClaudeTool('Glob').kind, 'search')
  assert.equal(normalizeClaudeTool('Grep').kind, 'search')
  assert.equal(normalizeClaudeTool('ReadFile').kind, 'generic')

  const normalizer = createNormalizer()
  normalizer.consume(init())
  const started = normalizer.consume({
    type: 'assistant',
    session_id: sessionId,
    uuid: 'assistant-tools',
    message: {
      id: 'message-tools',
      content: [
        {
          type: 'tool_use',
          id: 'provider-tool-private',
          name: 'Read',
          input: { file_path: 'C:\\private\\file.txt' },
        },
      ],
    },
  })
  const completed = normalizer.consume({
    type: 'user',
    session_id: sessionId,
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'provider-tool-private',
          content: [{ type: 'text', text: 'bounded result' }],
          is_error: false,
        },
      ],
    },
  })

  assert.deepEqual(
    started.map((event) => event.type),
    ['tool.started'],
  )
  assert.equal(started[0].kind, 'read')
  assert.equal(started[0].name, 'Read')
  assert.doesNotMatch(started[0].summary, /private|file\.txt/)
  assert.doesNotMatch(started[0].itemId, /provider-tool-private/)
  assert.deepEqual(
    completed.map((event) => event.type),
    ['tool.output', 'tool.completed'],
  )
  assert.equal(completed[1].success, true)
  assert.equal(completed[1].itemId, started[0].itemId)
})

test('maps authentication and terminal errors to bounded safe failures', () => {
  const normalizer = createNormalizer()
  normalizer.consume(init())
  const diagnostic = normalizer.consume({
    type: 'assistant',
    session_id: sessionId,
    uuid: 'assistant-auth',
    error: 'authentication_failed',
    message: {
      id: 'message-auth',
      content: [
        {
          type: 'text',
          text: 'OAuth token expired: private provider diagnostic',
        },
      ],
    },
  })
  const failed = normalizer.consume({
    type: 'result',
    subtype: 'error_during_execution',
    session_id: sessionId,
    is_error: true,
    errors: ['private stderr and credential detail'],
  })

  assert.deepEqual(diagnostic, [])
  assert.deepEqual(
    failed.map((event) => event.type),
    ['turn.failed'],
  )
  assert.equal(failed[0].error.code, 'provider_unavailable')
  assert.match(failed[0].error.message, /authentication/i)
  assert.doesNotMatch(failed[0].error.message, /private|credential|stderr/)
  assert.doesNotMatch(
    JSON.stringify([...diagnostic, ...failed]),
    /OAuth|token expired|private provider diagnostic/,
  )
  assert.equal(normalizer.failure?.code, 'provider_unavailable')
})

test('maps a provider terminal failure without raw diagnostics', () => {
  const normalizer = createNormalizer()
  normalizer.consume(init())
  const failed = normalizer.consume({
    type: 'result',
    subtype: 'error_during_execution',
    session_id: sessionId,
    is_error: true,
    errors: ['OAuth token expired: private provider detail'],
  })

  assert.equal(failed[0].type, 'turn.failed')
  assert.equal(failed[0].error.code, 'provider_unavailable')
  assert.doesNotMatch(failed[0].error.message, /OAuth|token|private/)
})
