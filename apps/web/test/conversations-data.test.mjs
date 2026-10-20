import assert from 'node:assert/strict'
import test from 'node:test'
import { QueryClient } from '@tanstack/react-query'
import {
  providerDisplayName,
  formatConversationActivity,
} from '../.tmp/test-dist/components/conversations/conversation-list-model.js'
import { filterProjectLocationConversations } from '../.tmp/test-dist/components/projects/project-workspace-model.js'
import {
  conversationListQueryKeys,
  conversationListQueryOptions,
} from '../.tmp/test-dist/runtime/host/conversation-list-query.js'
import { renderProjectCollection } from './fixtures/render-project-collection.mjs'

const projectId = 'proj_conversations_ui'
const machineId = 'machine_collection01'
const timestamp = '2026-08-27T12:00:00.000Z'
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
  assert.equal(client.calls[0].options.archived, false)
  assert.equal(client.calls[0].options.limit, 100)
  assert.ok(client.calls[0].options.signal instanceof AbortSignal)
})

test('Conversation query cache is isolated by Project identity and archive view', () => {
  assert.notDeepEqual(
    conversationListQueryKeys.project(projectId),
    conversationListQueryKeys.project('proj_conversations_other'),
  )
  assert.notDeepEqual(
    conversationListQueryKeys.project(projectId, 'active'),
    conversationListQueryKeys.project(projectId, 'archived'),
  )
})

test('Archived Conversation query requests only the Host archived index', async () => {
  const client = new FakeConversationListClient([completed])
  const queryClient = createQueryClient()
  await queryClient.fetchQuery(
    conversationListQueryOptions(client, projectId, 'archived'),
  )
  assert.equal(client.calls.length, 1)
  assert.equal(client.calls[0].options.archived, true)
  assert.deepEqual(conversationListQueryKeys.project(projectId, 'archived'), [
    'host',
    'project-conversations',
    projectId,
    'archived',
  ])
})

test('the live project location filter preserves exact Machine identity and Host order', () => {
  const other = { ...completed, machineId: 'machine_other01' }
  const source = Object.freeze([waiting, other, running, completed])
  assert.deepEqual(
    filterProjectLocationConversations(source, machineId, 'all', 'all'),
    [waiting, running, completed],
  )
  assert.deepEqual(source, [waiting, other, running, completed])
})

test('live location filters retain status and Provider facts without mutating Host records', () => {
  const claude = conversation(
    'conv_claude_ui',
    'Claude 会话',
    'completed',
    4,
    'claude-code',
  )
  const source = Object.freeze([waiting, claude, running, completed])
  assert.deepEqual(
    filterProjectLocationConversations(
      source,
      machineId,
      'completed',
      'claude-code',
    ),
    [claude],
  )
  assert.deepEqual(
    filterProjectLocationConversations(source, machineId, 'running', 'all'),
    [running],
  )
  assert.deepEqual(source, [waiting, claude, running, completed])
})

test('live Provider labels and activity formatting use real product metadata', () => {
  assert.equal(providerDisplayName('codex'), 'Codex')
  assert.equal(providerDisplayName('claude-code'), 'Claude Code')
  assert.match(formatConversationActivity(timestamp), /08|8/u)
})

test('live collection renders both Providers in Host order without invented summary totals', () => {
  const claude = conversation(
    'conv_claude_ui',
    'Claude 历史',
    'completed',
    4,
    'claude-code',
  )
  const { html } = renderProjectCollection({
    conversations: [waiting, claude, running],
  })
  assert.ok(html.indexOf('等待授权') < html.indexOf('Claude 历史'))
  assert.ok(html.indexOf('Claude 历史') < html.indexOf('实现连接恢复'))
  assert.match(html, /Claude Code/u)
  assert.doesNotMatch(html, /共 3|总计|尚未实现/u)
})

test('50 Conversation fixture keeps the complete Host organization order in the live collection', () => {
  const source = Array.from({ length: 50 }, (_, index) =>
    conversation(
      `conv_stress_${String(index).padStart(2, '0')}`,
      `会话 ${index}`,
      'completed',
      50 - index,
    ),
  )
  const { html } = renderProjectCollection({ conversations: source })
  assert.equal((html.match(/data-conversation-row=/gu) ?? []).length, 50)
  let previous = -1
  for (const entry of source) {
    const current = html.indexOf(
      `data-conversation-row="${entry.conversationId}"`,
    )
    assert.ok(current > previous, entry.conversationId)
    previous = current
  }
})

test('live collection distinguishes loading, empty, ready and exact-query failure', () => {
  assert.match(renderProjectCollection({ pending: true }).html, /正在读取会话/u)
  assert.match(renderProjectCollection().html, /还没有会话/u)
  assert.match(
    renderProjectCollection({ search: { view: 'archived' } }).html,
    /没有已归档的会话/u,
  )
  assert.match(
    renderProjectCollection({ conversations: [completed] }).html,
    /整理 WebSocket 测试/u,
  )
  const failure = renderProjectCollection({
    pending: true,
    error: new Error('private SQLite C:\\secret\\workspace'),
  }).html
  assert.match(failure, /暂时无法读取会话/u)
  assert.doesNotMatch(failure, /private|SQLite|secret/u)
})

test('live collection retains stale records with safe failure copy and explains the bounded index', () => {
  const source = Array.from({ length: 100 }, (_, index) =>
    conversation(
      `conv_bounded_${String(index).padStart(3, '0')}`,
      `历史 ${index}`,
      'completed',
      100 - index,
    ),
  )
  const { html } = renderProjectCollection({
    conversations: source,
    error: new Error('private Host diagnostic'),
  })
  assert.match(html, /历史 0/u)
  assert.match(html, /会话列表未能更新/u)
  assert.match(html, /最多最近 100/u)
  assert.match(html, /项目内搜索查找更早的记录/u)
  assert.doesNotMatch(html, /private Host diagnostic/u)
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
function conversation(
  conversationId,
  title,
  status,
  activityOffset,
  provider = 'codex',
) {
  const lastActivityAt = new Date(
    Date.parse(timestamp) + activityOffset * 60_000,
  ).toISOString()
  return {
    conversationId,
    projectId,
    machineId,
    title,
    provider,
    model: 'gpt-5.6-sol',
    reasoning: 'medium',
    status,
    createdAt: timestamp,
    updatedAt: lastActivityAt,
    lastActivityAt,
  }
}
function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}
