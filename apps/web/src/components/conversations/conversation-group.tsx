import { useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Pin } from 'lucide-react'

import {
  AgentIdentityMark,
  Badge,
  ConversationItem,
  SessionItem,
  StatusBadge,
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
  providerDisplayName,
} from './conversation-list-model'
import { providerAgentId } from '../../provider/provider-presentation'

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
  const agent = providerAgentId(provider)
  const definition = agentDefinitions[agent]
  const headingId = `conversations-agent-${provider}`
  const firstUnpinnedIndex = conversations.findIndex(
    (conversation) => conversation.pinnedAt === undefined,
  )
  const hasPinned = archiveView === 'active' && firstUnpinnedIndex !== 0

  return (
    <section aria-labelledby={headingId}>
      <div className="flex h-[var(--layout-conversations-group-height)] min-w-0 items-center gap-3 rounded-md border border-border bg-surface/65 px-3.5">
        <AgentIdentityMark
          agent={agent}
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
  showProvider?: boolean
}

function ConversationRow({
  archiveView,
  conversation,
  selected,
  showUnpinnedDivider,
  showProvider = false,
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
      quickActions={!archived}
      onArchived={focusAdjacentRow}
      onUnarchived={focusAdjacentRow}
    />
  )

  const organizationActions = archived ? (
    <div className="flex w-max items-center gap-1">
      <ConversationRestoreButton
        conversation={conversation}
        size="sm"
        onRestoreError={setRestoreError}
        onRestored={focusAdjacentRow}
        showInlineError={false}
      />
      {menu}
    </div>
  ) : (
    <div className="flex w-max items-center gap-1 min-[601px]:opacity-0 min-[601px]:group-hover/conversation-row:opacity-100 min-[601px]:group-focus-within/conversation-row:opacity-100">
      {conversation.pinnedAt === undefined ? null : (
        <Pin aria-label="已置顶" className="size-3.5 text-text-muted" />
      )}
      {menu}
    </div>
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
      <li
        ref={rowRef}
        className="group/conversation-row"
        data-conversation-row={conversation.conversationId}
      >
        {showProvider ? (
          <SessionItem
            title={conversation.title}
            leading={
              <AgentIdentityMark
                agent={providerAgentId(conversation.provider)}
                className="size-7 rounded-sm"
              />
            }
            metadata={
              <span className="truncate">
                {providerDisplayName(conversation.provider)}
                {archived && conversation.archivedAt !== undefined
                  ? ` · 归档于 ${formatConversationArchivedAt(conversation.archivedAt)}`
                  : ''}
              </span>
            }
            status={<StatusBadge status={conversation.status} />}
            activity={
              <time dateTime={conversation.lastActivityAt}>
                {formatConversationActivity(conversation.lastActivityAt)}
              </time>
            }
            primaryAction={
              <Link
                to="/c/$conversationId"
                params={{ conversationId: conversation.conversationId }}
                data-conversation-primary-action
                aria-label={`打开会话：${conversation.title}`}
                title={conversation.title}
                className="absolute inset-0 z-0 rounded-xs outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              />
            }
            actions={organizationActions}
          />
        ) : (
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
            className={cn(
              archived ? 'pr-36' : conversation.pinnedAt && 'pr-12',
            )}
            primaryAction={
              <Link
                to="/c/$conversationId"
                params={{
                  conversationId: conversation.conversationId,
                }}
                data-conversation-primary-action
                aria-label={`打开会话：${conversation.title}`}
                title={conversation.title}
                className="absolute inset-0 z-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              />
            }
            action={organizationActions}
          />
        )}{' '}
        {restoreError === undefined ? null : (
          <p
            role="alert"
            className="mt-1 rounded-sm border border-danger/30 bg-danger-muted px-3 py-2 text-sm text-danger-text"
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

export function ConversationRows({
  archiveView = 'active',
  conversations,
}: {
  archiveView?: 'active' | 'archived'
  conversations: readonly ConversationSummary[]
}) {
  return (
    <ul className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface [&>li:first-child_article]:border-t-0">
      {conversations.map((conversation) => (
        <ConversationRow
          key={conversation.conversationId}
          archiveView={archiveView}
          conversation={conversation}
          selected={false}
          showUnpinnedDivider={false}
          showProvider
        />
      ))}
    </ul>
  )
}
