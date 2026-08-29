import { useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Pin } from 'lucide-react'

import {
  AgentIdentityMark,
  Badge,
  ConversationItem,
  agentDefinitions,
  cn,
} from '@codetether/ui'
import type { ConversationSummary } from '@codetether/protocol'

import {
  ConversationOrganizationMenu,
  ConversationRestoreButton,
} from './conversation-organization-controls'
import {
  formatConversationActivity,
  formatConversationArchivedAt,
} from './conversation-list-model'

interface ConversationGroupProps {
  archiveView?: 'active' | 'archived'
  provider: ConversationSummary['provider']
  conversations: readonly ConversationSummary[]
  selectedConversationId?: string
}

export function ConversationGroup({
  archiveView = 'active',
  provider,
  conversations,
  selectedConversationId,
}: ConversationGroupProps) {
  const definition = agentDefinitions[provider]
  const headingId = `conversations-agent-${provider}`
  const firstUnpinnedIndex = conversations.findIndex(
    (conversation) => conversation.pinnedAt === undefined,
  )
  const hasPinned = archiveView === 'active' && firstUnpinnedIndex !== 0

  return (
    <section aria-labelledby={headingId}>
      <div className="flex h-[var(--layout-conversations-group-height)] min-w-0 items-center gap-3 rounded-md border border-border bg-surface/65 px-3.5">
        <AgentIdentityMark
          agent={provider}
          className="size-8 rounded-sm text-sm"
        />
        <h2
          id={headingId}
          className="min-w-0 truncate text-base font-semibold text-text-primary"
        >
          {definition.name}
        </h2>
        <Badge
          variant="secondary"
          aria-label={`${conversations.length} 个会话`}
          className="ml-auto h-6 min-w-7 border-transparent bg-surface-elevated px-2 text-xs font-regular tabular-nums"
        >
          {conversations.length}
        </Badge>
      </div>

      {hasPinned ? (
        <p className="mt-3 flex items-center gap-1.5 px-4 text-xs font-medium text-text-muted">
          <Pin aria-hidden="true" className="size-3.5" />
          已置顶
        </p>
      ) : null}

      <ul className="mt-2 space-y-2 px-4">
        {conversations.map((conversation, index) => {
          const selected =
            conversation.conversationId === selectedConversationId
          const startsUnpinned =
            hasPinned && firstUnpinnedIndex >= 0 && index === firstUnpinnedIndex

          return (
            <ConversationRow
              key={conversation.conversationId}
              archiveView={archiveView}
              conversation={conversation}
              selected={selected}
              showUnpinnedDivider={startsUnpinned}
            />
          )
        })}
      </ul>
    </section>
  )
}

interface ConversationRowProps {
  archiveView: 'active' | 'archived'
  conversation: ConversationSummary
  selected: boolean
  showUnpinnedDivider: boolean
}

function ConversationRow({
  archiveView,
  conversation,
  selected,
  showUnpinnedDivider,
}: ConversationRowProps) {
  const rowRef = useRef<HTMLLIElement>(null)
  const [restoreError, setRestoreError] = useState<string>()
  const archived = archiveView === 'archived'

  function focusAdjacentRow() {
    const row = rowRef.current
    if (row === null) return
    const next = findAdjacentConversationAction(row, 'nextElementSibling')
    const previous = findAdjacentConversationAction(
      row,
      'previousElementSibling',
    )
    const fallback = document.querySelector<HTMLElement>(
      '[data-conversation-view-control]',
    )
    ;(next ?? previous ?? fallback)?.focus()
  }

  const menu = (
    <ConversationOrganizationMenu
      conversation={conversation}
      showRestoreAction={!archived}
      onArchived={focusAdjacentRow}
      onUnarchived={focusAdjacentRow}
    />
  )

  return (
    <>
      {showUnpinnedDivider ? (
        <li
          role="presentation"
          className="flex items-center gap-3 pt-1 text-xs text-text-muted"
        >
          <span className="h-px flex-1 bg-border" />
          其他会话
          <span className="h-px flex-1 bg-border" />
        </li>
      ) : null}
      <li ref={rowRef} data-conversation-row={conversation.conversationId}>
        <ConversationItem
          appearance="row"
          title={conversation.title}
          description={
            archived && conversation.archivedAt !== undefined
              ? `归档于 ${formatConversationArchivedAt(conversation.archivedAt)}`
              : undefined
          }
          status={conversation.status}
          model={conversation.model}
          activity={formatConversationActivity(conversation.lastActivityAt)}
          activityDetail={
            archived
              ? '最近活动'
              : conversation.pinnedAt === undefined
                ? undefined
                : '已置顶'
          }
          selected={selected}
          className={cn(archived ? 'pr-36' : conversation.pinnedAt && 'pr-12')}
          primaryAction={
            <Link
              to="/conversations/$conversationId"
              params={{
                conversationId: conversation.conversationId,
              }}
              data-conversation-primary-action
              aria-label={`打开会话：${conversation.title}`}
              title={conversation.title}
              className="absolute inset-0 z-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            />
          }
          action={
            archived ? (
              <div className="absolute right-0 flex w-max items-center gap-1">
                <ConversationRestoreButton
                  conversation={conversation}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onRestoreError={setRestoreError}
                  onRestored={focusAdjacentRow}
                  showInlineError={false}
                />
                {menu}
              </div>
            ) : (
              <div className="absolute right-0 flex w-max items-center gap-1">
                {conversation.pinnedAt === undefined ? null : (
                  <Pin
                    aria-label="已置顶"
                    className="size-3.5 text-text-muted"
                  />
                )}
                {menu}
              </div>
            )
          }
        />
        {restoreError === undefined ? null : (
          <p
            role="alert"
            className="mt-1 rounded-sm border border-danger/30 bg-danger-muted px-3 py-2 text-sm text-danger"
          >
            {restoreError}
          </p>
        )}
      </li>
    </>
  )
}

function findAdjacentConversationAction(
  row: Element,
  direction: 'nextElementSibling' | 'previousElementSibling',
): HTMLElement | undefined {
  let candidate = row[direction]
  while (candidate !== null) {
    const action = candidate.querySelector<HTMLElement>(
      '[data-conversation-primary-action]',
    )
    if (action !== null) return action
    candidate = candidate[direction]
  }
  return undefined
}

export type { ConversationGroupProps }
