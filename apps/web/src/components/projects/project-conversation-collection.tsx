import { useState } from 'react'
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'

import {
  Button,
  Notice,
  SearchInput,
  SectionState,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@codetether/ui'
import type {
  ConversationStatus,
  MachineId,
  ProjectId,
  ProviderId,
} from '@codetether/protocol'

import {
  conversationListQueryOptions,
  type ConversationListFilters,
} from '../../runtime/host/conversation-list-query'
import {
  conversationSearchInfiniteQueryOptions,
  flattenConversationSearchPages,
} from '../../runtime/host/conversation-search-query'
import {
  useHostConnectionState,
  useHostRuntime,
} from '../../runtime/host/host-runtime-hooks'
import { ConversationRows } from '../conversations/conversation-group'
import { ConversationSearchResults } from '../conversations/conversation-search-results'
import { useDebouncedSearchQuery } from '../conversations/use-debounced-search-query'
import {
  filterProjectLocationConversations,
  filterProjectLocationSearchResults,
  parseProjectWorkspaceSearch,
  projectFilterControlsVisible,
  projectViewIncludesStatus,
  type ProjectWorkspaceSearch,
} from './project-workspace-model'

interface ProjectConversationCollectionProps {
  projectId: ProjectId
  machineId: MachineId
  machineName?: string
  projectName: string
  search: ProjectWorkspaceSearch
  searchPage: boolean
  searchRoute?: boolean
}

const statusOptions: readonly {
  value: ConversationStatus | 'all'
  label: string
}[] = [
  { value: 'all', label: '全部' },
  { value: 'running', label: '运行中' },
  { value: 'waiting', label: '等待批准' },
  { value: 'completed', label: '已完成' },
  { value: 'failed', label: '失败' },
]

export function ProjectConversationCollection({
  projectId,
  machineId,
  machineName,
  projectName,
  search,
  searchPage,
  searchRoute = false,
}: ProjectConversationCollectionProps) {
  const runtime = useHostRuntime()
  const connectionState = useHostConnectionState()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const archiveView = search.view === 'archived' ? 'archived' : 'active'
  const query = search.q ?? ''
  const debouncedQuery = useDebouncedSearchQuery(query)
  const [input, setInput] = useState({ source: query, value: query })
  const draft = input.source === query ? input.value : query
  const provider = search.provider ?? 'all'
  const status = search.status ?? 'all'
  const hasFilters = provider !== 'all' || status !== 'all'
  const ready = connectionState === 'connected'
  const filters: ConversationListFilters = { provider, status }
  const activeQuery = useQuery({
    ...conversationListQueryOptions(runtime, projectId, 'active'),
    enabled: ready && !searchPage,
  })
  const archivedQuery = useQuery({
    ...conversationListQueryOptions(runtime, projectId, 'archived'),
    enabled: ready && !searchPage,
  })
  const baseQuery = archiveView === 'archived' ? archivedQuery : activeQuery
  const filteredQuery = useQuery({
    ...conversationListQueryOptions(runtime, projectId, archiveView, filters),
    enabled: ready && !searchPage && hasFilters,
  })
  const browseQuery = hasFilters ? filteredQuery : baseQuery
  const searchOptions = conversationSearchInfiniteQueryOptions(
    runtime,
    projectId,
    {
      query: debouncedQuery || 'search-disabled',
      archive: archiveView === 'archived' ? 'archived' : 'all',
      ...(provider === 'all' ? {} : { provider }),
      ...(status === 'all' ? {} : { status }),
    },
  )
  const durableSearchQuery = useInfiniteQuery({
    ...searchOptions,
    enabled: ready && searchPage && debouncedQuery.length > 0,
  })
  const results = filterProjectLocationSearchResults(
    flattenConversationSearchPages(durableSearchQuery.data?.pages),
    machineId,
  )
  const conversations = filterProjectLocationConversations(
    browseQuery.data ?? [],
    machineId,
  )
  const baseConversations = filterProjectLocationConversations(
    baseQuery.data ?? [],
    machineId,
  )
  const filterControlsVisible = projectFilterControlsVisible(
    searchPage ? results.length : baseConversations.length,
    hasFilters,
  )
  const pendingSearch =
    query.trim() !== debouncedQuery || durableSearchQuery.isFetching
  const loading = searchPage
    ? query.length > 0 &&
      durableSearchQuery.data === undefined &&
      !durableSearchQuery.isError
    : browseQuery.data === undefined && !browseQuery.isError
  const failed = searchPage
    ? durableSearchQuery.isError && durableSearchQuery.data === undefined
    : browseQuery.isError && browseQuery.data === undefined

  function update(
    next: Partial<ProjectWorkspaceSearch>,
    nextSearchPage = searchRoute,
  ) {
    const value = parseProjectWorkspaceSearch({ ...search, ...next, machineId })
    void navigate({
      to: nextSearchPage
        ? '/projects/$projectId/search'
        : '/projects/$projectId',
      params: { projectId },
      search: value,
      resetScroll: false,
    })
  }

  function retry() {
    runtime.retry()
    if (ready) {
      if (searchPage) void durableSearchQuery.refetch()
      else void browseQuery.refetch()
    }
  }

  return (
    <section
      className="min-w-0 space-y-4"
      aria-label={searchPage ? '项目内搜索' : '项目会话'}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        {!searchPage && filterControlsVisible ? (
          <SegmentedControl
            aria-label="会话范围"
            value={archiveView}
            onValueChange={(value) =>
              update({ view: value === 'archived' ? 'archived' : undefined })
            }
          >
            <SegmentedControlItem value="active" data-conversation-view-control>
              会话
            </SegmentedControlItem>
            <SegmentedControlItem
              value="archived"
              data-conversation-view-control
            >
              已归档
            </SegmentedControlItem>
          </SegmentedControl>
        ) : !searchPage ? (
          <div className="flex min-w-0 items-center gap-3">
            <h2 className="text-base font-semibold text-text-primary">
              {archiveView === 'archived' ? '已归档' : '会话'}
            </h2>
            <Link
              to="/projects/$projectId"
              params={{ projectId }}
              search={{
                ...search,
                view: archiveView === 'archived' ? undefined : 'archived',
              }}
              data-conversation-view-control
              className="rounded-xs text-sm text-text-secondary underline-offset-2 outline-none hover:text-text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              {archiveView === 'archived' ? '查看会话' : '查看已归档会话'}
            </Link>
          </div>
        ) : null}
        {filterControlsVisible ? (
          <>
            <SegmentedControl
              aria-label="会话状态"
              value={status}
              className="flex-wrap"
              onValueChange={(value) =>
                update({
                  status:
                    value === 'all' ? undefined : (value as ConversationStatus),
                })
              }
            >
              {statusOptions
                .filter((option) =>
                  projectViewIncludesStatus(search.view, option.value),
                )
                .map((option) => (
                  <SegmentedControlItem key={option.value} value={option.value}>
                    {option.label}
                  </SegmentedControlItem>
                ))}
            </SegmentedControl>
            <Select
              value={provider}
              onValueChange={(value) =>
                update({
                  provider: value === 'all' ? undefined : (value as ProviderId),
                })
              }
            >
              <SelectTrigger aria-label="AI 工具" className="w-auto min-w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">所有 AI 工具</SelectItem>
                <SelectItem value="codex">Codex</SelectItem>
                <SelectItem value="claude-code">Claude Code</SelectItem>
              </SelectContent>
            </Select>
            {hasFilters ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  update({ provider: undefined, status: undefined })
                }
              >
                清除筛选
              </Button>
            ) : null}
          </>
        ) : null}
      </div>
      <SearchInput
        aria-label="搜索这个项目的会话"
        data-conversation-search-input
        className="w-full max-w-sm"
        value={draft}
        onChange={(event) => {
          const value = event.target.value
          setInput({ source: query, value })
          update({ q: value.trim() || undefined })
        }}
        maxLength={160}
        placeholder="搜索这个项目的会话"
      />
      {searchPage ? (
        <p className="text-sm text-text-secondary">
          范围：{projectName} · 搜索会话标题和你发送过的内容，不搜索 AI
          回复、工具输出或其他项目。
        </p>
      ) : null}
      {connectionState !== 'connected' ? (
        <Notice role="status" title="连接尚未恢复">
          当前只显示已经读取的历史，恢复连接后可以重新加载。
        </Notice>
      ) : null}
      {failed ? (
        <SectionState
          state="error"
          title={searchPage ? '暂时无法搜索' : '暂时无法读取会话'}
          description="请检查设备连接后重试。"
          action={
            <Button variant="secondary" onClick={retry}>
              重试
            </Button>
          }
        />
      ) : loading ? (
        <SectionState
          state="loading"
          title={searchPage ? '正在搜索' : '正在读取会话'}
        />
      ) : searchPage ? (
        <>
          {query.length === 0 ? (
            <SectionState
              state="empty"
              title="输入关键词"
              description={`在“${projectName}”的会话中搜索。`}
            />
          ) : results.length > 0 || durableSearchQuery.hasNextPage ? (
            <>
              {results.length === 0 ? (
                <Notice role="status" title="当前已加载的页面没有匹配项">
                  可以继续加载，查找这台设备上更早的匹配会话。
                </Notice>
              ) : null}
              <ConversationSearchResults
                archiveView={archiveView}
                machineName={machineName}
                results={results}
                hasNextPage={durableSearchQuery.hasNextPage === true}
                isFetchingNextPage={durableSearchQuery.isFetchingNextPage}
                fetchNextError={
                  durableSearchQuery.isFetchNextPageError
                    ? '下一页暂时无法读取，已加载的结果仍然保留。'
                    : undefined
                }
                onLoadMore={() => {
                  void durableSearchQuery.fetchNextPage()
                }}
                onRefreshMembership={() =>
                  durableSearchQuery.refetch({ cancelRefetch: false })
                }
                onResetPagination={() => {
                  void queryClient.resetQueries({
                    queryKey: searchOptions.queryKey,
                    exact: true,
                  })
                }}
              />
            </>
          ) : pendingSearch ? (
            <SectionState state="loading" title="正在搜索" />
          ) : (
            <SectionState
              state="empty"
              title={`没有找到“${query}”`}
              description="换个关键词或筛选条件试试。"
            />
          )}
          {durableSearchQuery.isRefetchError &&
          durableSearchQuery.data !== undefined &&
          !durableSearchQuery.isFetchNextPageError ? (
            <Notice
              role="status"
              tone="warn"
              title="搜索结果未能更新"
              action={
                <Button size="sm" variant="secondary" onClick={retry}>
                  重试
                </Button>
              }
            >
              当前显示上次已经读取的结果。
            </Notice>
          ) : null}
        </>
      ) : (
        <>
          {conversations.length > 0 ? (
            <ConversationRows
              archiveView={archiveView}
              machineName={machineName}
              conversations={conversations}
            />
          ) : (
            <SectionState
              state="empty"
              title={
                browseQuery.data !== undefined && browseQuery.data.length >= 100
                  ? '已加载的索引中没有匹配的会话'
                  : provider !== 'all' || status !== 'all'
                    ? '没有符合条件的会话'
                    : archiveView === 'archived'
                      ? '没有已归档的会话'
                      : '还没有会话'
              }
              description={
                browseQuery.data !== undefined && browseQuery.data.length >= 100
                  ? '可以使用项目内搜索，查找这台设备上更早的会话。'
                  : provider !== 'all' || status !== 'all'
                    ? '可以调整或清除筛选条件。'
                    : archiveView === 'archived'
                      ? '归档的会话会出现在这里，可以随时取消归档。'
                      : '可以在这个项目中新建会话。'
              }
            />
          )}
          {browseQuery.data !== undefined && browseQuery.data.length >= 100 ? (
            <p className="text-sm text-text-muted">
              当前只显示这份索引中已加载的会话，最多最近 100
              个；可以使用项目内搜索查找更早的记录。
            </p>
          ) : null}
          {browseQuery.isError && browseQuery.data !== undefined ? (
            <Notice
              role="status"
              tone="warn"
              title="会话列表未能更新"
              action={
                <Button size="sm" variant="secondary" onClick={retry}>
                  重试
                </Button>
              }
            >
              当前显示上次读取的会话。
            </Notice>
          ) : null}
        </>
      )}
    </section>
  )
}
