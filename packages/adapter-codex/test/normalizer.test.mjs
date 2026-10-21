import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CodexEventNormalizer,
  MAX_FILE_CHANGES_PER_TURN,
  normalizeApprovalRequest,
} from '../dist/index.js'

const timestamp = '2026-08-25T12:00:00.000Z'
const threadId = 'thread-1'
const turnId = 'turn-1'

function normalize(normalizer, method, params) {
  return normalizer.normalize({ method, params }, timestamp)
}

test('uses Chinese approval fallbacks without changing provider detail', () => {
  const commandFallback = normalizeApprovalRequest(
    {
      id: 1,
      method: 'item/commandExecution/requestApproval',
      params: { threadId, turnId },
    },
    undefined,
    timestamp,
  )
  const commandDetail = normalizeApprovalRequest(
    {
      id: 2,
      method: 'item/commandExecution/requestApproval',
      params: { threadId, turnId, command: 'git status --short' },
    },
    undefined,
    timestamp,
  )
  const permissionFallback = normalizeApprovalRequest(
    {
      id: 3,
      method: 'item/permissions/requestApproval',
      params: { threadId, turnId },
    },
    undefined,
    timestamp,
  )
  const permissionDetail = normalizeApprovalRequest(
    {
      id: 4,
      method: 'item/fileChange/requestApproval',
      params: { threadId, turnId, reason: 'Provider supplied reason' },
    },
    undefined,
    timestamp,
  )

  assert.equal(commandFallback.summary, 'Codex 请求运行命令')
  assert.equal(commandDetail.summary, 'git status --short')
  assert.equal(permissionFallback.summary, 'Codex 请求访问文件或权限')
  assert.equal(permissionDetail.summary, 'Provider supplied reason')
})

test('normalizes agent message delta and completion fixtures', () => {
  const normalizer = new CodexEventNormalizer()
  const delta = normalize(normalizer, 'item/agentMessage/delta', {
    threadId,
    turnId,
    itemId: 'message-1',
    delta: '我检查了项目。',
  })
  const completed = normalize(normalizer, 'item/completed', {
    threadId,
    turnId,
    item: {
      id: 'message-1',
      type: 'agentMessage',
      text: '我检查了项目，并更新了注释。',
    },
  })

  assert.equal(delta.recognized, true)
  assert.deepEqual(delta.events.map(stripRaw), [
    {
      type: 'message.delta',
      provider: 'codex',
      timestamp,
      threadId,
      turnId,
      itemId: 'message-1',
      delta: '我检查了项目。',
    },
  ])
  assert.equal(completed.recognized, true)
  assert.deepEqual(completed.events.map(stripRaw), [
    {
      type: 'message.completed',
      provider: 'codex',
      timestamp,
      threadId,
      turnId,
      itemId: 'message-1',
      message: '我检查了项目，并更新了注释。',
    },
  ])
})

test('normalizes command start, output, and completion fixtures', () => {
  const normalizer = new CodexEventNormalizer()
  const started = normalize(normalizer, 'item/started', {
    threadId,
    turnId,
    item: {
      id: 'command-1',
      type: 'commandExecution',
      command: 'pnpm test',
      cwd: 'C:/spike',
      status: 'inProgress',
    },
  })
  const output = normalize(normalizer, 'item/commandExecution/outputDelta', {
    threadId,
    turnId,
    itemId: 'command-1',
    delta: '156 passed\n',
  })
  const completed = normalize(normalizer, 'item/completed', {
    threadId,
    turnId,
    item: {
      id: 'command-1',
      type: 'commandExecution',
      command: 'pnpm test',
      status: 'completed',
      aggregatedOutput: '156 passed\n',
    },
  })

  assert.deepEqual(started.events.map(stripRaw), [
    {
      type: 'tool.started',
      provider: 'codex',
      timestamp,
      threadId,
      turnId,
      itemId: 'command-1',
      kind: 'shell',
      name: 'pnpm test',
      summary: 'C:/spike',
    },
  ])
  assert.deepEqual(output.events.map(stripRaw), [
    {
      type: 'tool.output',
      provider: 'codex',
      timestamp,
      threadId,
      turnId,
      itemId: 'command-1',
      output: '156 passed\n',
      stream: 'combined',
    },
  ])
  assert.deepEqual(completed.events.map(stripRaw), [
    {
      type: 'tool.completed',
      provider: 'codex',
      timestamp,
      threadId,
      turnId,
      itemId: 'command-1',
      kind: 'shell',
      name: 'pnpm test',
      success: true,
      summary: '156 passed\n',
    },
  ])
})

test('normalizes and de-duplicates file patch fixtures', () => {
  const normalizer = new CodexEventNormalizer()
  const params = {
    threadId,
    turnId,
    itemId: 'file-1',
    changes: [
      {
        path: 'src/example.ts',
        kind: { type: 'update', move_path: null },
        diff: '@@ -1 +1 @@\n-export const value = 1\n+// Spike comment\n+export const value = 1',
      },
    ],
  }

  const first = normalize(normalizer, 'item/fileChange/patchUpdated', params)
  const duplicate = normalize(
    normalizer,
    'item/fileChange/patchUpdated',
    params,
  )

  assert.equal(first.recognized, true)
  assert.deepEqual(first.events.map(stripRaw), [
    {
      type: 'file.changed',
      provider: 'codex',
      timestamp,
      threadId,
      turnId,
      itemId: 'file-1',
      path: 'src/example.ts',
      kind: 'modified',
      diff: params.changes[0].diff,
    },
  ])
  assert.deepEqual(duplicate.events, [])
})

for (const fixture of [
  { name: 'multiple lines', content: 'first\nsecond\nthird\n', lines: 3 },
  { name: 'one line', content: 'single\n', lines: 1 },
  { name: 'no final LF', content: 'first\nsecond', lines: 2 },
  { name: 'one line without LF', content: 'single', lines: 1 },
  { name: 'empty file', content: '', lines: 0 },
  { name: 'one blank line', content: '\n', lines: 1 },
  { name: 'leading blank line', content: '\nsecond\n', lines: 2 },
  { name: 'trailing blank lines', content: 'first\n\n\n', lines: 3 },
  { name: 'CRLF', content: 'first\r\nsecond\r\n', lines: 2 },
  { name: 'CRLF without final LF', content: 'first\r\nsecond', lines: 2 },
  { name: 'Chinese and emoji', content: '第一行\n第二行🪁\n', lines: 2 },
  {
    name: 'inline patch-like text',
    content: 'text @@ -1 +1 @@\ntext --- old\ntext +++ new\n',
    lines: 3,
  },
  {
    name: 'Unicode line separators inside content',
    content: 'text\u2028@@ -1 +1 @@\u2029--- old\n',
    lines: 1,
  },
]) {
  for (const [type, kind, prefix] of [
    ['add', 'added', '+'],
    ['delete', 'deleted', '-'],
  ]) {
    test(`converts ${kind} full content with ${fixture.name} to unified diff`, () => {
      const event = normalizeFilePatch({ type }, fixture.content)
      const rows = fixture.content.split('\n')
      if (fixture.content.endsWith('\n') || fixture.content === '') rows.pop()
      const header =
        kind === 'added'
          ? `@@ -0,0 +1,${String(fixture.lines)} @@`
          : `@@ -1,${String(fixture.lines)} +0,0 @@`
      const expected =
        fixture.content === ''
          ? ''
          : `${header}\n${rows.map((row) => `${prefix}${row}`).join('\n')}\n${
              fixture.content.endsWith('\n')
                ? ''
                : '\\ No newline at end of file\n'
            }`

      assert.deepEqual(stripRaw(event), {
        type: 'file.changed',
        provider: 'codex',
        timestamp,
        threadId,
        turnId,
        itemId: 'file-content',
        path: 'src/content.txt',
        kind,
        diff: expected,
      })
      assert.equal(event.raw.payload.changes[0].diff, fixture.content)
    })
  }
}

test('preserves existing unified additions and deletions exactly', () => {
  for (const type of ['add', 'delete']) {
    for (const diff of [
      '@@ -0,0 +1,1 @@\n+added\n',
      '@@ -1 +0,0 @@\n-deleted\n\\ No newline at end of file\n',
      'diff --git a/file b/file\n--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new\n',
      '--- a/file\r\n+++ b/file\r\n',
      '+++ b/file\n',
    ]) {
      assert.equal(normalizeFilePatch({ type }, diff).diff, diff)
    }
  }
})

test('does not transform modified, renamed, unknown or absent file content', () => {
  const diff = 'first\n第二行'
  for (const [kind, expectedKind] of [
    [{ type: 'update', move_path: null }, 'modified'],
    [{ type: 'update', move_path: 'src/moved.txt' }, 'renamed'],
    [{ type: 'future' }, 'unknown'],
  ]) {
    const event = normalizeFilePatch(kind, diff)
    assert.equal(event.kind, expectedKind)
    assert.equal(event.diff, diff)
  }
  for (const type of ['add', 'delete']) {
    const event = normalizeFilePatch({ type }, undefined)
    assert.equal(Object.hasOwn(event, 'diff'), false)
  }
})

test('normalizes full file content from completed fileChange items', () => {
  const normalizer = new CodexEventNormalizer()
  const result = normalize(normalizer, 'item/completed', {
    threadId,
    turnId,
    item: {
      id: 'completed-file',
      type: 'fileChange',
      changes: [
        { path: 'added.txt', kind: { type: 'add' }, diff: 'added\n' },
        { path: 'deleted.txt', kind: { type: 'delete' }, diff: 'deleted\n' },
      ],
    },
  })
  assert.equal(result.events.length, 2)
  assert.equal(result.events[0].diff, '@@ -0,0 +1,1 @@\n+added\n')
  assert.equal(result.events[1].diff, '@@ -1,1 +0,0 @@\n-deleted\n')
  assert.equal(result.events[0].itemId, 'completed-file')
  assert.equal(result.events[1].itemId, 'completed-file')
})

test('keeps original Provider content as the file-change de-duplication identity', () => {
  const normalizer = new CodexEventNormalizer()
  const params = {
    threadId,
    turnId,
    itemId: 'file-content',
    changes: [{ path: 'same.txt', kind: { type: 'add' }, diff: 'content\n' }],
  }
  const first = normalize(normalizer, 'item/fileChange/patchUpdated', params)
  const unified = {
    ...params,
    changes: [{ ...params.changes[0], diff: '@@ -0,0 +1,1 @@\n+content\n' }],
  }
  const second = normalize(normalizer, 'item/fileChange/patchUpdated', unified)
  assert.equal(first.events.length, 1)
  assert.equal(second.events.length, 1)
  assert.equal(first.events[0].diff, second.events[0].diff)
  assert.deepEqual(
    normalize(normalizer, 'item/fileChange/patchUpdated', params).events,
    [],
  )
  assert.deepEqual(
    normalize(normalizer, 'item/fileChange/patchUpdated', unified).events,
    [],
  )
})

test('accepts synthesized diffs exactly at the public UTF-16 size bound', () => {
  const limit = 4 * 1024 * 1024
  for (const type of ['add', 'delete']) {
    const header = type === 'add' ? '@@ -0,0 +1,1 @@\n' : '@@ -1,1 +0,0 @@\n'
    const content = `${'中'.repeat(limit - header.length - 2)}\n`
    const event = normalizeFilePatch({ type }, content)
    assert.equal(event.diff.length, limit)
    assert.equal(event.diff.startsWith(header), true)
    assert.equal(event.diff.endsWith('中\n'), true)
    assert.equal(Buffer.byteLength(event.diff, 'utf8') > limit, true)
  }
})

test('includes the missing-final-LF marker in the synthesized size bound', () => {
  const limit = 4 * 1024 * 1024
  const header = '@@ -0,0 +1,1 @@\n'
  const suffix = '\n\\ No newline at end of file\n'
  const content = 'a'.repeat(limit - header.length - 1 - suffix.length)
  const exact = normalizeFilePatch({ type: 'add' }, content)
  assert.equal(exact.diff.length, limit)
  assert.equal(exact.diff.endsWith(suffix), true)
  const over = normalizeFilePatch({ type: 'add' }, `${content}a`)
  assert.equal(Object.hasOwn(over, 'diff'), false)
  assert.equal(over.type, 'file.changed')
  assert.equal(over.kind, 'added')
})

test('omits only expanded diff content when prefixes exceed the public bound', () => {
  const limit = 4 * 1024 * 1024
  const header = '@@ -0,0 +1,1 @@\n'
  const contents = [
    `${'a'.repeat(limit - header.length - 1)}\n`,
    '\n'.repeat(Math.floor(limit / 2) + 1),
  ]
  for (const content of contents) {
    assert.equal(content.length <= limit, true)
    const event = normalizeFilePatch({ type: 'add' }, content)
    assert.equal(Object.hasOwn(event, 'diff'), false)
    assert.deepEqual(stripRaw(event), {
      type: 'file.changed',
      provider: 'codex',
      timestamp,
      threadId,
      turnId,
      itemId: 'file-content',
      path: 'src/content.txt',
      kind: 'added',
    })
    assert.equal(event.raw.payload.changes[0].diff, content)
  }
})

test('does not apply the synthesis limit to existing unified or modified diffs', () => {
  const diff = `@@ -1 +1 @@\n+${'a'.repeat(4 * 1024 * 1024)}`
  for (const type of ['add', 'delete', 'update']) {
    const event = normalizeFilePatch({ type }, diff)
    assert.equal(event.diff === diff, true)
  }
})

test('retains metadata and original identities for oversized additions and deletions', () => {
  for (const type of ['add', 'delete']) {
    const normalizer = new CodexEventNormalizer()
    const content = 'a'.repeat(4 * 1024 * 1024 + 1)
    const params = {
      threadId,
      turnId,
      itemId: 'large-file',
      changes: [
        { path: 'large.txt', kind: { type }, diff: content },
        { path: 'large.txt', kind: { type }, diff: `${content}b` },
      ],
    }
    const first = normalize(normalizer, 'item/fileChange/patchUpdated', params)
    assert.equal(first.events.length, 2)
    for (const event of first.events) {
      assert.equal(Object.hasOwn(event, 'diff'), false)
      assert.equal(event.type, 'file.changed')
      assert.equal(event.kind, type === 'add' ? 'added' : 'deleted')
      assert.equal(event.path, 'large.txt')
      assert.equal(event.itemId, 'large-file')
    }
    assert.deepEqual(
      normalize(normalizer, 'item/fileChange/patchUpdated', params).events,
      [],
    )
    const completion = normalize(normalizer, 'turn/completed', {
      threadId,
      turn: { id: turnId, status: 'completed', error: null },
    })
    assert.equal(completion.events[0].type, 'turn.completed')
  }
})

test('bounds hashed file-change identities for one active Turn', () => {
  const normalizer = new CodexEventNormalizer()
  for (let index = 0; index < MAX_FILE_CHANGES_PER_TURN; index += 1) {
    const result = normalize(normalizer, 'item/fileChange/patchUpdated', {
      threadId,
      turnId,
      itemId: `file-${String(index)}`,
      changes: [
        {
          path: `src/file-${String(index)}.ts`,
          kind: { type: 'update', move_path: null },
          diff: `change-${String(index)}`,
        },
      ],
    })
    assert.equal(result.events.length, 1)
  }

  assert.throws(
    () =>
      normalize(normalizer, 'item/fileChange/patchUpdated', {
        threadId,
        turnId,
        itemId: 'file-overflow',
        changes: [
          {
            path: 'src/overflow.ts',
            kind: { type: 'update', move_path: null },
            diff: 'overflow',
          },
        ],
      }),
    /File-change identity limit/,
  )
})

test('normalizes successful and failed turn completion fixtures', () => {
  const normalizer = new CodexEventNormalizer()
  const successful = normalize(normalizer, 'turn/completed', {
    threadId,
    turn: { id: turnId, status: 'completed', error: null },
  })
  const failed = normalize(normalizer, 'turn/completed', {
    threadId,
    turn: {
      id: 'turn-2',
      status: 'failed',
      error: { message: 'sandbox process failed' },
    },
  })

  assert.deepEqual(successful.events.map(stripRaw), [
    {
      type: 'turn.completed',
      provider: 'codex',
      timestamp,
      threadId,
      turnId,
    },
  ])
  assert.deepEqual(failed.events.map(stripRaw), [
    {
      type: 'turn.failed',
      provider: 'codex',
      timestamp,
      threadId,
      turnId: 'turn-2',
      error: {
        message: 'Codex could not complete this turn.',
        failure: {
          category: 'generic',
          reason: 'provider_error',
          retryability: 'unknown',
          userAction: 'view_details',
          source: 'provider',
          occurredAt: timestamp,
          technicalCode: 'provider_error',
        },
      },
    },
  ])
})

test('normalizes structured Codex quota failure without Provider prose', () => {
  const normalizer = new CodexEventNormalizer()
  const failed = normalize(normalizer, 'turn/completed', {
    threadId,
    turn: {
      id: 'turn-quota',
      status: 'failed',
      error: {
        message: 'private account and token detail',
        additionalDetails: 'private provider trace',
        codexErrorInfo: 'usageLimitExceeded',
      },
    },
  })

  assert.equal(failed.events[0].error.failure.reason, 'usage_limit_reached')
  assert.equal(failed.events[0].error.failure.occurredAt, timestamp)
  assert.doesNotMatch(
    failed.events[0].error.message,
    /private|account|token|trace/u,
  )
})

test('normalizes interruption separately from failure', () => {
  const normalizer = new CodexEventNormalizer()
  const interrupted = normalize(normalizer, 'turn/completed', {
    threadId,
    turn: { id: turnId, status: 'interrupted', error: null },
  })

  assert.deepEqual(interrupted.events.map(stripRaw), [
    {
      type: 'turn.interrupted',
      provider: 'codex',
      timestamp,
      threadId,
      turnId,
    },
  ])
})

test('releases file de-duplication state at the turn boundary', () => {
  const normalizer = new CodexEventNormalizer()
  const params = {
    threadId,
    turnId,
    itemId: 'file-1',
    changes: [
      {
        path: 'src/example.ts',
        kind: { type: 'update', move_path: null },
        diff: 'same patch',
      },
    ],
  }

  assert.equal(
    normalize(normalizer, 'item/fileChange/patchUpdated', params).events.length,
    1,
  )
  assert.equal(
    normalize(normalizer, 'item/fileChange/patchUpdated', params).events.length,
    0,
  )
  normalizer.releaseTurn(threadId, turnId)
  assert.equal(
    normalize(normalizer, 'item/fileChange/patchUpdated', params).events.length,
    1,
  )
})

test('returns recognized=false for a future notification', () => {
  const normalizer = new CodexEventNormalizer()

  assert.deepEqual(
    normalize(normalizer, 'future/providerEvent', { threadId, value: 1 }),
    { recognized: false, events: [] },
  )
})

test('ignores a future notification without params', () => {
  const normalizer = new CodexEventNormalizer()

  assert.deepEqual(
    normalizer.normalize({ method: 'future/noParams' }, timestamp),
    { recognized: false, events: [] },
  )
})

function stripRaw(event) {
  const normalized = { ...event }
  delete normalized.raw
  return normalized
}

function normalizeFilePatch(kind, diff) {
  const normalizer = new CodexEventNormalizer()
  const result = normalize(normalizer, 'item/fileChange/patchUpdated', {
    threadId,
    turnId,
    itemId: 'file-content',
    changes: [
      {
        path: 'src/content.txt',
        kind,
        ...(diff === undefined ? {} : { diff }),
      },
    ],
  })
  assert.equal(result.recognized, true)
  assert.equal(result.events.length, 1)
  return result.events[0]
}
