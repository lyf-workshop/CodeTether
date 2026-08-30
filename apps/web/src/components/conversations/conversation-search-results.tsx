import { useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { MoreHorizontal, Pin } from 'lucide-react'

import { Button, ConversationItem, IconButton, cn } from '@codetether/ui'
import type { ConversationSearchResult } from '@codetether/protocol'

import {
  ConversationOrganizationMenu,
  ConversationRestoreButton,
} from './conversation-organization-controls'
import {
  formatConversationActivity,
  providerDisplayName,
} from './conversation-list-model'
import {
  conversationSearchMatchDescription,
  conversationSearchTurnIntent,
} from './conversation-search-presentation'
import { conversationSearchFocusCandidates } from './conversation-search-focus'

interface ConversationSearchResultsProps {
  archiveView: 'active' | 'archived'
  fetchNextError?: string
  hasNextPage: boolean
  isFetchingNextPage: boolean
  onLoadMore: () => void
  onRefreshMembership: () => Promise<unknown>
  onResetPagination: () => void
  results: readonly ConversationSearchResult[]
}

export function ConversationSearchResults({
  archiveView,
  fetchNextError,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  onRefreshMembership,
  onResetPagination,
  results,
}: ConversationSearchResultsProps) {
  const sectionRef = useRef<HTMLElement>(null)

  function refreshMembershipAndRestoreFocus(conversationId: string) {
    const candidates = conversationSearchFocusCandidates(
      results.map((result) => result.conversation.conversationId),
      conversationId,
    )

    void onRefreshMembership().finally(() => {
      window.requestAnimationFrame(() => {
        const section = sectionRef.current
        const rows =
          section === null
            ? []
            : Array.from(
                section.querySelectorAll<HTMLElement>(
                  '[data-conversation-search-result]',
                ),
              )

        for (const candidateId of candidates) {
          const row = rows.find(
            (candidate) =>
              candidate.dataset.conversationSearchResult === candidateId,
          )
          if (row === undefined) continue

          const action = row.querySelector<HTMLElement>(
            candidateId === conversationId
              ? '[data-conversation-search-organization-trigger]'
              : '[data-conversation-search-primary-action]',
          )
          if (action !== null) {
            action.focus()
            return
          }
        }

        document
          .querySelector<HTMLInputElement>('[data-conversation-search-input]')
          ?.focus()
      })
    })
  }

  return (
    <section
      ref={sectionRef}
      aria-labelledby="conversation-search-results-heading"
    >
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <h2
            id="conversation-search-results-heading"
            className="text-base font-semibold text-text-primary"
          >
            搜索结果
          </h2>
          <p className="mt-0.5 text-xs text-text-muted" aria-live="polite">
            已显示 {results.length} 条结果
          </p>
        </div>
      </div>

      <ol className="mt-3 space-y-2" data-conversation-search-results>
        {results.map((result) => (
          <ConversationSearchResultRow
            key={result.conversation.conversationId}
            archiveView={archiveView}
            result={result}
            onMembershipChanged={refreshMembershipAndRestoreFocus}
          />
        ))}
      </ol>

      {fetchNextError === undefined ? null : (
        <div
          role="alert"
          className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-sm border border-danger/30 bg-danger-muted px-3 py-2 text-sm text-danger"
        >
          <span>{fetchNextError}</span>
          <Button size="sm" variant="secondary" onClick={onResetPagination}>
            重新搜索
          </Button>
        </div>
      )}

      {hasNextPage ? (
        <div className="mt-4 flex justify-center">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={isFetchingNextPage}
            onClick={onLoadMore}
          >
            {isFetchingNextPage ? '正在加载…' : '加载更多'}
          </Button>
        </div>
      ) : null}
    </section>
  )
}

interface ConversationSearchResultRowProps {
  archiveView: 'active' | 'archived'
  onMembershipChanged: (conversationId: string) => void
  result: ConversationSearchResult
}

function ConversationSearchResultRow({
  archiveView,
  onMembershipChanged,
  result,
}: ConversationSearchResultRowProps) {
  const [restoreError, setRestoreError] = useState<string>()
  const conversation = result.conversation
  const archived = archiveView === 'archived'
  const matchDescription = `${providerDisplayName(conversation.provider)} · ${conversationSearchMatchDescription(result)}`

  const menu = (
    <ConversationOrganizationMenu
      conversation={conversation}
      showRestoreAction={!archived}
      onArchived={() => onMembershipChanged(conversation.conversationId)}
      onRenamed={() => onMembershipChanged(conversation.conversationId)}
      onUnarchived={() => onMembershipChanged(conversation.conversationId)}
      trigger={
        <IconButton
          label={`更多会话操作：${conversation.title}`}
          size="sm"
          variant="ghost"
          data-conversation-search-organization-trigger
        >
          <MoreHorizontal aria-hidden="true" />
        </IconButton>
      }
    />
  )

  return (
    <li
      data-conversation-search-result={conversation.conversationId}
      className="min-w-0"
    >
      <ConversationItem
        appearance="row"
        title={conversation.title}
        description={matchDescription}
        status={conversation.status}
        model={conversation.model}
        activity={formatConversationActivity(conversation.lastActivityAt)}
        activityDetail={archived ? '已归档' : undefined}
        className={cn('h-[4.5rem] pr-12', archived && 'pr-36')}
        primaryAction={
          <Link
            to="/conversations/$conversationId"
            params={{ conversationId: conversation.conversationId }}
            search={conversationSearchTurnIntent(result)}
            data-conversation-search-primary-action
            aria-label={`打开搜索结果：${conversation.title}`}
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
                onRestored={() =>
                  onMembershipChanged(conversation.conversationId)
                }
                showInlineError={false}
              />
              {menu}
            </div>
          ) : (
            <div className="absolute right-0 flex w-max items-center gap-1">
              {conversation.pinnedAt === undefined ? null : (
                <Pin aria-label="已置顶" className="size-3.5 text-text-muted" />
              )}
              {menu}
            </div>
          )
        }
      />
      <span className="sr-only">
        {result.matchedField === 'title' ? '匹配标题' : '匹配历史提问'}
        {archived ? '，已归档' : ''}
      </span>
      {restoreError === undefined ? null : (
        <p
          role="alert"
          className="mt-1 rounded-sm border border-danger/30 bg-danger-muted px-3 py-2 text-sm text-danger"
        >
          {restoreError}
        </p>
      )}
    </li>
  )
}

export type { ConversationSearchResultsProps }
