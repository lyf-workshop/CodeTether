import assert from 'node:assert/strict'
import test from 'node:test'

import { QueryClient } from '@tanstack/react-query'
import { CodeTetherResponseError } from '@codetether/client'

import {
  conversationStatusCounts,
  groupProjectConversations,
  uniqueProviders,
  visibleProjectConversations,
} from '../.tmp/test-dist/components/conversations/conversation-list-model.js'
import {
  conversationListQueryKeys,
  conversationListQueryOptions,
} from '../.tmp/test-dist/runtime/host/conversation-list-query.js'
import {
  conversationListErrorMessage,
  conversationListPageViewState,
} from '../.tmp/test-dist/runtime/host/conversation-list-view-state.js'

const projectId = 'proj_conversations_ui'
const timestamp = '2026-08-27T12:00:00.000Z'
const project = {
  projectId,
  name: 'Alpha',
  rootPath: 'C:\\workspaces\\alpha',
  availability: 'available',
  createdAt: timestamp,
  updatedAt: timestamp,
}
const waiting = conversation('conv_waiting_ui', '等待授权', 'waiting', 3)
const running = conversation('conv_running_ui', '实现连接恢复', 'running', 2)
const completed = conversation(
  'conv_completed_ui',
  '整理 WebSocket 测试',
  'completed',
  1,
)

test('Conversation query requests the bounded 100-row Host index and preserves Host order', async () => {
  const client = new FakeConversationListClient([waiting, running, completed])
  const queryClient = createQueryClient()

  const result = await queryClient.fetchQuery(
    conversationListQueryOptions(client, projectId),
  )

  assert.deepEqual(
    result.map((entry) => entry.conversationId),
    [waiting.conversationId, running.conversationId, completed.conversationId],
  )
  assert.equal(client.calls.length, 1)
  assert.equal(client.calls[0].projectId, projectId)
  assert.equal(client.calls[0].options.limit, 100)
  assert.ok(client.calls[0].options.signal instanceof AbortSignal)
})

test('Conversation query cache is isolated by Project identity', () => {
  assert.notDeepEqual(
    conversationListQueryKeys.project(projectId),
    conversationListQueryKeys.project('proj_conversations_other'),
  )
})

test('local search matches only real title/provider fields and keeps Host ordering by default', () => {
  const source = [waiting, running, completed]
  const defaults = controls()

  assert.deepEqual(
    visibleProjectConversations(source, defaults).map(
      (entry) => entry.conversationId,
    ),
    source.map((entry) => entry.conversationId),
  )
  assert.deepEqual(
    visibleProjectConversations(source, {
      ...defaults,
      query: 'codex',
    }).map((entry) => entry.conversationId),
    source.map((entry) => entry.conversationId),
  )
  assert.deepEqual(
    visibleProjectConversations(source, {
      ...defaults,
      query: 'websocket',
    }).map((entry) => entry.conversationId),
    [completed.conversationId],
  )
  assert.deepEqual(
    visibleProjectConversations(source, {
      ...defaults,
      query: 'local-machine-that-is-not-a-wire-field',
    }),
    [],
  )
})

test('status/provider filters and explicit sort do not mutate the Host-owned array', () => {
  const source = [waiting, running, completed]
  const original = [...source]

  assert.deepEqual(
    visibleProjectConversations(source, {
      ...controls(),
      status: 'waiting',
    }),
    [waiting],
  )
  assert.deepEqual(
    visibleProjectConversations(source, {
      ...controls(),
      provider: 'codex',
    }),
    source,
  )
  assert.deepEqual(
    visibleProjectConversations(source, {
      ...controls(),
      sort: 'oldest',
    }),
    [completed, running, waiting],
  )
  assert.deepEqual(source, original)
})

test('real provider groups and summary counts contain no speculative agents or metrics', () => {
  const source = [waiting, running, completed]

  assert.deepEqual(uniqueProviders(source), ['codex'])
  assert.deepEqual(groupProjectConversations(source), [
    { provider: 'codex', conversations: source },
  ])
  assert.deepEqual(conversationStatusCounts(source), {
    total: 3,
    idle: 0,
    running: 1,
    waiting: 1,
    completed: 1,
    failed: 0,
  })
})

test('view state distinguishes loading, empty, ready, unavailable Project, and not found', () => {
  assert.deepEqual(conversationListPageViewState(pending(), pending()), {
    kind: 'loading',
  })
  assert.deepEqual(
    conversationListPageViewState(success(project), success([])),
    { kind: 'empty', project },
  )
  assert.deepEqual(
    conversationListPageViewState(success(project), success([waiting])),
    { kind: 'ready', project, conversations: [waiting] },
  )

  const unavailable = { ...project, availability: 'unavailable' }
  assert.deepEqual(
    conversationListPageViewState(success(unavailable), success([waiting])),
    { kind: 'ready', project: unavailable, conversations: [waiting] },
  )

  const notFound = responseError(404, 'not_found', 'private diagnostics')
  assert.deepEqual(conversationListPageViewState(failed(notFound), pending()), {
    kind: 'not-found',
  })
})

test('Conversation list errors expose stable copy without Host diagnostics', () => {
  const error = responseError(
    500,
    'provider_error',
    'C:\\secret\\workspace and SQLite diagnostics',
  )
  const state = conversationListPageViewState(success(project), failed(error))

  assert.equal(state.kind, 'error')
  assert.equal(state.message, conversationListErrorMessage())
  assert.doesNotMatch(state.message, /secret|SQLite|workspace/u)
})

class FakeConversationListClient {
  calls = []

  constructor(conversations) {
    this.conversations = conversations
  }

  async listProjectConversations(requestedProjectId, options) {
    this.calls.push({ projectId: requestedProjectId, options })
    return { protocolVersion: 1, conversations: this.conversations }
  }
}

function conversation(conversationId, title, status, activityOffset) {
  const lastActivityAt = new Date(
    Date.parse(timestamp) + activityOffset * 60_000,
  ).toISOString()
  return {
    conversationId,
    projectId,
    title,
    provider: 'codex',
    model: 'gpt-5.6-sol',
    reasoning: 'medium',
    status,
    createdAt: timestamp,
    updatedAt: lastActivityAt,
    lastActivityAt,
  }
}

function controls() {
  return { provider: 'all', query: '', sort: 'recent', status: 'all' }
}

function pending() {
  return { status: 'pending' }
}

function success(data) {
  return { status: 'success', data }
}

function failed(error) {
  return { status: 'error', error }
}

function responseError(status, code, message) {
  return new CodeTetherResponseError(status, {
    protocolVersion: 1,
    actionId: 'act_conversation_list_error',
    code,
    message,
  })
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
}
