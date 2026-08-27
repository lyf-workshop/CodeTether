import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CodexEventNormalizer,
  MAX_FILE_CHANGES_PER_TURN,
} from '../dist/index.js'

const timestamp = '2026-08-25T12:00:00.000Z'
const threadId = 'thread-1'
const turnId = 'turn-1'

function normalize(normalizer, method, params) {
  return normalizer.normalize({ method, params }, timestamp)
}

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
      error: { message: 'sandbox process failed' },
    },
  ])
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
