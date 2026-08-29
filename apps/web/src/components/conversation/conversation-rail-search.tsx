import { useMemo, type ReactNode } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'

import type { ProjectId, TurnId } from '@codetether/protocol'
import { Button, cn } from '@codetether/ui'

import { useHostRuntime } from '../../runtime/host/host-runtime-hooks'
import {
  conversationSearchInfiniteQueryOptions,
  flattenConversationSearchPages,
} from '../../runtime/host/conversation-search-query'
import type {
  ConversationRailFilter,
  ConversationRailItemViewModel,
} from './conversation-view-model'
import {
  conversationRailSearchStatus,
  presentConversationRailSearchResult,
} from './conversation-rail-search-model'
import { conversationSearchFocusCandidates } from '../conversations/conversation-search-focus'

export interface ConversationRailSearchRenderItem {
  readonly conversation: ConversationRailItemViewModel
  readonly matchDescription?: string
  readonly onMembershipChanged: (conversationId: string) => void
  readonly selected: boolean
  readonly targetTurnId?: TurnId
}

interface ConversationRailSearchResultsProps {
  readonly currentConversation?: ConversationRailItemViewModel
  readonly currentConversationId: string
  readonly filter: ConversationRailFilter
  readonly headingId: string
  readonly projectId: ProjectId
  readonly query: string
  readonly renderItem: (item: ConversationRailSearchRenderItem) => ReactNode
}

export function ConversationRailSearchResults({
  currentConversation,
  currentConversationId,
  filter,
  headingId,
  projectId,
  query,
  renderItem,
}: ConversationRailSearchResultsProps) {
  const runtime = useHostRuntime()
  const queryClient = useQueryClient()
  const searchOptions = conversationSearchInfiniteQueryOptions(
    runtime,
    projectId,
    {
      query,
      archive: 'active',
      status: conversationRailSearchStatus(filter),
      limit: 25,
    },
  )
  const search = useInfiniteQuery(searchOptions)
  const results = flattenConversationSearchPages(search.data?.pages)
  const items = useMemo(
    () => results.map(presentConversationRailSearchResult),
    [results],
  )
  const currentMatches = items.some(
    (item) => item.conversation.id === currentConversationId,
  )
  const showCurrentAnchor =
    currentConversation !== undefined && !search.isPending && !currentMatches

  function refreshMembershipAndRestoreFocus(conversationId: string) {
    const candidates = conversationSearchFocusCandidates(
      items.map((item) => item.conversation.id),
      conversationId,
    )

    void search.refetch({ cancelRefetch: false }).finally(() => {
      window.requestAnimationFrame(() => {
        const root = document.querySelector<HTMLElement>(
          '[data-conversation-rail-search-root]',
        )
        const rows =
          root === null
            ? []
            : Array.from(
                root.querySelectorAll<HTMLElement>(
                  '[data-conversation-rail-row]',
                ),
              )

        for (const candidateId of candidates) {
          const row = rows.find(
            (candidate) =>
              candidate.dataset.conversationRailRow === candidateId,
          )
          if (row === undefined) continue

          const action = row.querySelector<HTMLElement>(
            candidateId === conversationId
              ? '[data-conversation-rail-organization-trigger]'
              : '[data-conversation-rail-primary-action]',
          )
          if (action !== null) {
            action.focus()
            return
          }
        }

        document
          .querySelector<HTMLInputElement>(
            '[data-conversation-rail-search-input]',
          )
          ?.focus()
      })
    })
  }

  if (search.isPending) {
    return <RailSearchStatus>正在搜索完整会话历史…</RailSearchStatus>
  }

  if (search.data === undefined && search.isError) {
    return (
      <RailSearchStatus tone="error">
        <span>暂时无法搜索会话。</span>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => void search.refetch()}
        >
          重试
        </Button>
      </RailSearchStatus>
    )
  }

  return (
    <div
      data-conversation-rail-search-root
      className="space-y-4"
      aria-busy={search.isFetchingNextPage || undefined}
    >
      {showCurrentAnchor ? (
        <section aria-labelledby={`${headingId}-search-current`}>
          <h3
            id={`${headingId}-search-current`}
            className="flex h-7 items-center px-1 text-xs font-medium text-text-secondary"
          >
            当前会话
          </h3>
          <ul className="mt-2">
            {renderItem({
              conversation: currentConversation,
              onMembershipChanged: refreshMembershipAndRestoreFocus,
              selected: true,
            })}
          </ul>
        </section>
      ) : null}

      {search.isRefetchError && !search.isFetchNextPageError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-danger/30 bg-danger-muted px-3 py-2 text-xs text-danger"
        >
          <span>无法刷新搜索结果；当前仍显示上一次读取的内容。</span>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => void search.refetch()}
          >
            重试
          </Button>
        </div>
      ) : null}

      <section aria-labelledby={`${headingId}-search-results`}>
        <div className="flex h-7 min-w-0 items-center justify-between gap-2 px-1">
          <h3
            id={`${headingId}-search-results`}
            className="truncate text-xs font-medium text-text-secondary"
          >
            搜索结果
          </h3>
          <span
            className="shrink-0 text-xs tabular-nums text-text-muted"
            aria-live="polite"
          >
            已显示 {items.length} 条
          </span>
        </div>

        {items.length === 0 ? (
          <RailSearchStatus>没有找到相关会话。</RailSearchStatus>
        ) : (
          <ul
            className="mt-2 space-y-1.5"
            data-conversation-rail-search-results
          >
            {items.map((item) =>
              renderItem({
                ...item,
                onMembershipChanged: refreshMembershipAndRestoreFocus,
                selected: item.conversation.id === currentConversationId,
              }),
            )}
          </ul>
        )}

        {search.isFetchNextPageError ? (
          <div
            role="alert"
            className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-sm border border-danger/30 bg-danger-muted px-3 py-2 text-xs text-danger"
          >
            <span>无法加载更多结果。</span>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() =>
                void queryClient.resetQueries({
                  queryKey: searchOptions.queryKey,
                  exact: true,
                })
              }
            >
              重新搜索
            </Button>
          </div>
        ) : search.hasNextPage ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="mt-3 w-full"
            disabled={search.isFetchingNextPage}
            onClick={() => void search.fetchNextPage()}
          >
            {search.isFetchingNextPage ? '正在加载…' : '加载更多'}
          </Button>
        ) : null}
      </section>
    </div>
  )
}

export function RailSearchStatus({
  children,
  tone = 'neutral',
}: {
  readonly children: ReactNode
  readonly tone?: 'neutral' | 'error'
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'mt-2 flex min-h-24 flex-col items-center justify-center gap-3 rounded-sm px-3 py-5 text-center text-sm',
        tone === 'error'
          ? 'border border-danger/30 bg-danger-muted text-danger'
          : 'bg-surface-muted/40 text-text-muted',
      )}
    >
      {children}
    </div>
  )
}
