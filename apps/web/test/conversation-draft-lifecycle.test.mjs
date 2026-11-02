import assert from 'node:assert/strict'
import test from 'node:test'
import { QueryClient } from '@tanstack/react-query'
import { CodeTetherResponseError } from '@codetether/client'
import { loadWebComponent } from './fixtures/render-ui.mjs'

const { conversationDrafts } = loadWebComponent(
  'components/conversation/conversation-drafts.ts',
)
const { ConversationOrganizationActions } = loadWebComponent(
  'runtime/host/conversation-organization-actions.ts',
)
const { invalidateConversationProductQueries } = loadWebComponent(
  'runtime/host/conversation-index-sync.ts',
)
const conversationId = 'conv_draft_lifecycle01'
const otherId = 'conv_draft_lifecycle02'
const timestamp = '2026-10-19T12:00:00.000Z'

test('only an accepted archive summary clears its exact draft after the response, including an unmounted editor', async () => {
  let finish
  const pending = new Promise((resolve) => {
    finish = resolve
  })
  let calls = 0
  const actions = new ConversationOrganizationActions(
    {
      archiveConversation() {
        calls += 1
        return pending
      },
    },
    new QueryClient(),
    () => 'act_draft_archive01',
  )
  conversationDrafts.write(conversationId, '尚未发送')
  conversationDrafts.write(otherId, '其他会话')
  try {
    const accepted = actions.archiveConversation(conversationId)
    assert.equal(calls, 1)
    assert.equal(conversationDrafts.read(conversationId), '尚未发送')
    finish({ data: { conversation: summary({ archivedAt: timestamp }) } })
    await accepted
    assert.equal(conversationDrafts.read(conversationId), '')
    assert.equal(conversationDrafts.read(otherId), '其他会话')
  } finally {
    conversationDrafts.clear(conversationId)
    conversationDrafts.clear(otherId)
  }
})

test('a rejected busy archive leaves the draft intact and does not automatically retry', async () => {
  let calls = 0
  const actions = new ConversationOrganizationActions(
    {
      async archiveConversation() {
        calls += 1
        throw new CodeTetherResponseError(409, {
          protocolVersion: 1,
          actionId: 'act_draft_archive01',
          code: 'conflict',
          message: 'Busy',
        })
      },
    },
    new QueryClient(),
    () => 'act_draft_archive01',
  )
  conversationDrafts.write(conversationId, '失败时仍保留')
  try {
    await assert.rejects(
      actions.archiveConversation(conversationId),
      CodeTetherResponseError,
    )
    await Promise.resolve()
    assert.equal(calls, 1)
    assert.equal(conversationDrafts.read(conversationId), '失败时仍保留')
  } finally {
    conversationDrafts.clear(conversationId)
  }
})

test('an accepted canonical conversation.updated archive clears the exact draft even when another client archived it', () => {
  conversationDrafts.write(conversationId, '其他端归档前的草稿')
  conversationDrafts.write(otherId, '其他会话')
  const queryClient = new QueryClient()
  try {
    invalidateConversationProductQueries(queryClient, {
      type: 'conversation.updated',
      conversationId,
      payload: { conversation: summary() },
    })
    assert.equal(conversationDrafts.read(conversationId), '其他端归档前的草稿')
    invalidateConversationProductQueries(queryClient, {
      type: 'conversation.updated',
      conversationId,
      payload: { conversation: summary({ archivedAt: timestamp }) },
    })
    assert.equal(conversationDrafts.read(conversationId), '')
    assert.equal(conversationDrafts.read(otherId), '其他会话')
  } finally {
    conversationDrafts.clear(conversationId)
    conversationDrafts.clear(otherId)
  }
})

function summary(overrides = {}) {
  return {
    conversationId,
    projectId: 'proj_draft_lifecycle01',
    machineId: 'machine_draft01',
    title: '新会话',
    titleSource: 'generated',
    provider: 'codex',
    status: 'completed',
    createdAt: timestamp,
    updatedAt: timestamp,
    lastActivityAt: timestamp,
    ...overrides,
  }
}
