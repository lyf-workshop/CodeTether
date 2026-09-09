import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import test from 'node:test'

import {
  boundUtf8,
  ClaudeCodeProtocolError,
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
    claude_code_version: '2.1.251',
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

test('accepts the exact revalidated Claude Code versions', () => {
  for (const version of ['2.1.250', '2.1.251', '2.1.263', '2.1.266']) {
    const normalizer = createNormalizer()
    assert.deepEqual(
      normalizer
        .consume(init({ claude_code_version: version }))
        .map((event) => event.type),
      ['conversation.started', 'turn.started'],
    )
  }
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
  assert.equal(normalizeClaudeTool('Bash').kind, 'generic')
  assert.equal(normalizeClaudeTool('PowerShell').kind, 'generic')
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

test('delays tool start until structured input can produce a safe command clue', () => {
  const normalizer = createNormalizer()
  normalizer.consume(init())
  const partial = normalizer.consume({
    type: 'stream_event',
    session_id: sessionId,
    event: {
      type: 'content_block_start',
      content_block: {
        type: 'tool_use',
        id: 'provider-read-private',
        name: 'Read',
        input: {},
      },
    },
  })
  const started = normalizer.consume({
    type: 'assistant',
    session_id: sessionId,
    message: {
      id: 'message-read',
      content: [
        {
          type: 'tool_use',
          id: 'provider-read-private',
          name: 'Read',
          input: { file_path: join(cwd, 'src', 'hello world.ts') },
        },
      ],
    },
  })

  assert.deepEqual(partial, [])
  assert.equal(started.length, 1)
  assert.equal(started[0].type, 'tool.started')
  assert.equal(started[0].kind, 'read')
  assert.equal(started[0].command, 'Read src/hello world.ts')
  assert.doesNotMatch(started[0].command, /fixture-workspace/u)
})

test('normalizes edit and search inputs while failing shell closed', () => {
  assert.deepEqual(
    normalizeClaudeTool(
      'Write',
      { file_path: join(cwd, 'nested', '你好 file.ts') },
      cwd,
    ),
    {
      name: 'Edit',
      kind: 'edit',
      summary: 'Write nested/你好 file.ts',
      command: 'Write nested/你好 file.ts',
    },
  )
  assert.deepEqual(
    normalizeClaudeTool(
      'Bash',
      { command: 'pnpm test', description: 'Run the focused tests' },
      cwd,
    ),
    {
      name: 'Generic Tool',
      kind: 'generic',
      summary: 'Run unavailable tool',
    },
  )
  assert.deepEqual(
    normalizeClaudeTool(
      'Grep',
      { pattern: 'reconnect', path: join(cwd, 'src') },
      cwd,
    ),
    {
      name: 'Search',
      kind: 'search',
      summary: 'Search workspace',
      command: 'Grep reconnect in src',
    },
  )

  const outside = normalizeClaudeTool(
    'Edit',
    { file_path: resolve(cwd, '..', 'private', 'secret.txt') },
    cwd,
  )
  assert.deepEqual(outside, {
    name: 'Edit',
    kind: 'edit',
    summary: 'Edit file',
  })
  assert.doesNotMatch(JSON.stringify(outside), /private|secret/u)

  assert.doesNotMatch(
    JSON.stringify(
      normalizeClaudeTool('Bash', { command: 'secret command' }, cwd),
    ),
    /secret command/u,
  )
})

test('rejects foreign-platform absolute paths from safe Tool clues', () => {
  const privatePaths = [
    'C:\\private\\windows-secret.txt',
    '\\\\private-server\\private-share\\unc-secret.txt',
    '/private/posix-secret.txt',
  ]

  for (const privatePath of privatePaths) {
    const normalized = normalizeClaudeTool(
      'Read',
      { file_path: privatePath },
      cwd,
    )
    assert.deepEqual(normalized, {
      name: 'Read',
      kind: 'read',
      summary: 'Read file',
    })
    assert.doesNotMatch(
      JSON.stringify(normalized),
      /private|secret|windows|posix|server|share/u,
    )
  }
})

test('keeps one stable generic identity for an unavailable shell tool', () => {
  const normalizer = createNormalizer()
  normalizer.consume(init())
  const started = normalizer.consume({
    type: 'assistant',
    session_id: sessionId,
    message: {
      id: 'message-shell',
      content: [
        {
          type: 'tool_use',
          id: 'provider-shell-private',
          name: 'Bash',
          input: { command: 'git status --short' },
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
          tool_use_id: 'provider-shell-private',
          content: 'secret shell output must not cross',
          is_error: false,
        },
      ],
    },
  })

  assert.equal(started[0].type, 'tool.started')
  assert.equal(started[0].kind, 'generic')
  assert.equal(started[0].command, undefined)
  assert.deepEqual(
    completed.map((event) => event.type),
    ['tool.completed'],
  )
  assert.equal(completed[0].itemId, started[0].itemId)
  assert.equal(completed[0].command, undefined)
  assert.doesNotMatch(JSON.stringify([...started, ...completed]), /git status/u)
  assert.doesNotMatch(
    JSON.stringify([...started, ...completed]),
    /secret shell output/u,
  )
  assert.doesNotMatch(
    JSON.stringify([...started, ...completed]),
    /provider-shell-private/u,
  )
})

test('rejects a Provider tool identity reused with a different tool name', () => {
  const normalizer = createNormalizer()
  normalizer.consume(init())
  normalizer.consume({
    type: 'stream_event',
    session_id: sessionId,
    event: {
      type: 'content_block_start',
      content_block: {
        type: 'tool_use',
        id: 'provider-tool-private',
        name: 'Read',
        input: {},
      },
    },
  })

  assert.throws(
    () =>
      normalizer.consume({
        type: 'assistant',
        session_id: sessionId,
        message: {
          id: 'message-mismatch',
          content: [
            {
              type: 'tool_use',
              id: 'provider-tool-private',
              name: 'Bash',
              input: { command: 'whoami' },
            },
          ],
        },
      }),
    ClaudeCodeProtocolError,
  )
})

test('emits a bounded start before a result when the full tool snapshot is absent', () => {
  const normalizer = createNormalizer()
  normalizer.consume(init())
  normalizer.consume({
    type: 'stream_event',
    session_id: sessionId,
    event: {
      type: 'content_block_start',
      content_block: {
        type: 'tool_use',
        id: 'provider-read-without-snapshot',
        name: 'Read',
        input: {},
      },
    },
  })

  const events = normalizer.consume({
    type: 'user',
    session_id: sessionId,
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'provider-read-without-snapshot',
          content: 'fixture output',
          is_error: false,
        },
      ],
    },
  })

  assert.deepEqual(
    events.map((event) => event.type),
    ['tool.started', 'tool.output', 'tool.completed'],
  )
  assert.ok(events.every((event) => event.itemId === events[0].itemId))
  assert.equal(events[0].kind, 'read')
  assert.doesNotMatch(JSON.stringify(events), /provider-read-without-snapshot/u)
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

test('maps exact service and output-limit assistant errors to canonical failures', () => {
  for (const [assistantError, expectedReason] of [
    ['server_error', 'provider_service_unavailable'],
    ['max_output_tokens', 'output_limit_exceeded'],
  ]) {
    const normalizer = createNormalizer()
    normalizer.consume(init())
    const diagnostic = normalizer.consume({
      type: 'assistant',
      session_id: sessionId,
      uuid: `assistant-${assistantError}`,
      error: assistantError,
      message: {
        id: `message-${assistantError}`,
        content: [
          {
            type: 'text',
            text: 'private Provider diagnostic must not be published',
          },
        ],
      },
    })
    const failed = normalizer.consume({
      type: 'result',
      subtype: 'error_during_execution',
      session_id: sessionId,
      is_error: true,
      errors: ['private raw failure detail'],
    })

    assert.deepEqual(diagnostic, [])
    assert.deepEqual(
      failed.map((event) => event.type),
      ['turn.failed'],
    )
    assert.equal(failed[0].error.failure.reason, expectedReason)
    assert.doesNotMatch(
      JSON.stringify(failed),
      /private Provider diagnostic|private raw failure detail/u,
    )
  }
})

test('fails closed when an assistant error is followed by a false success result', () => {
  const normalizer = createNormalizer()
  normalizer.consume(init())
  normalizer.consume({
    type: 'assistant',
    session_id: sessionId,
    uuid: 'assistant-error-before-success',
    error: 'authentication_failed',
  })

  const terminal = normalizer.consume({
    type: 'result',
    subtype: 'success',
    session_id: sessionId,
    is_error: false,
    result: 'malformed success after failure',
  })

  assert.deepEqual(
    terminal.map((event) => event.type),
    ['turn.failed'],
  )
  assert.equal(terminal[0].error.failure.reason, 'authentication_invalid')
  assert.equal(normalizer.result, undefined)
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

test('does not retain or publish an oversized adversarial assistant error', () => {
  const normalizer = createNormalizer()
  normalizer.consume(init())
  const privateDiagnostic = `<script>${'private-token '.repeat(32_768)}</script>`
  const diagnostic = normalizer.consume({
    type: 'assistant',
    session_id: sessionId,
    uuid: 'assistant-adversarial-error',
    error: privateDiagnostic,
    message: {
      id: 'message-adversarial-error',
      content: [
        {
          type: 'text',
          text: '[Authenticate](https://malicious.invalid)',
        },
      ],
    },
  })
  const failed = normalizer.consume({
    type: 'result',
    subtype: 'error_during_execution',
    session_id: sessionId,
    is_error: true,
  })

  assert.deepEqual(diagnostic, [])
  assert.equal(failed[0].type, 'turn.failed')
  assert.equal(failed[0].error.failure.reason, 'provider_error')
  assert.doesNotMatch(
    JSON.stringify(failed),
    /script|private-token|malicious\.invalid|Authenticate/u,
  )
})
