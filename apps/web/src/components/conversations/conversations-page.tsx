import {
  forwardRef,
  useMemo,
  useState,
  type ComponentPropsWithoutRef,
} from 'react'
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { Archive, Filter, MessageSquare, Plus, RefreshCw } from 'lucide-react'

import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  SearchInput,
  cn,
} from '@codetether/ui'
import type {
  ConversationSearchResult,
  ConversationSummary,
  ProjectId,
  ProjectRecord,
} from '@codetether/protocol'

import {
  useHostConnectionState,
  useHostRuntime,
} from '../../runtime/host/host-runtime-hooks'
import {
  conversationListQueryOptions,
  type ConversationArchiveView,
} from '../../runtime/host/conversation-list-query'
import {
  conversationSearchInfiniteQueryOptions,
  flattenConversationSearchPages,
} from '../../runtime/host/conversation-search-query'
import { conversationListPageViewState } from '../../runtime/host/conversation-list-view-state'
import { projectDetailQueryOptions } from '../../runtime/host/project-query'
import { ConversationGroup } from './conversation-group'
import { isConversationSearchMode } from './conversation-search-presentation'
import { ConversationSearchResults } from './conversation-search-results'
import {
  conversationStatusCounts,
  groupProjectConversations,
  providerDisplayName,
  uniqueProviders,
  visibleProjectConversations,
  type ConversationProviderFilter,
  type ConversationStatusFilter,
} from './conversation-list-model'
import {
  ConversationLimitNotice,
  ConversationsErrorState,
  ConversationsLoadingState,
  ConversationsNotFoundState,
  ProjectUnavailableNotice,
} from './conversation-page-states'
import { NewConversationDialog } from './new-conversation-dialog'
import { ProjectSummary } from './project-summary'
import { projectLocationAvailability } from '../../runtime/host/project-location'
import { useDebouncedSearchQuery } from './use-debounced-search-query'

interface ConversationsPageProps {
  projectId: ProjectId
}

interface StatusFilterOption {
  label: string
  value: ConversationStatusFilter
  count?: number
}

const emptyConversations: readonly ConversationSummary[] = []

export function ConversationsPage({ projectId }: ConversationsPageProps) {
  const runtime = useHostRuntime()
  const queryClient = useQueryClient()
  const connectionState = useHostConnectionState()
  const navigate = useNavigate({ from: '/projects/$projectId/conversations' })
  const search = useSearch({ from: '/projects/$projectId/conversations' })
  const archiveView: ConversationArchiveView =
    search.view === 'archived' ? 'archived' : 'active'
  const query = search.q ?? ''
  const searchMode = isConversationSearchMode(query)
  const debouncedQuery = useDebouncedSearchQuery(query)
  const searchPending = searchMode && debouncedQuery !== query.trim()
  const [providerFilter, setProviderFilter] =
    useState<ConversationProviderFilter>('all')
  const [statusFilter, setStatusFilter] =
    useState<ConversationStatusFilter>('all')

  const projectQuery = useQuery({
    ...projectDetailQueryOptions(runtime, projectId),
    enabled: connectionState === 'connected',
  })
  const activeConversationsQuery = useQuery({
    ...conversationListQueryOptions(runtime, projectId, 'active'),
    enabled: connectionState === 'connected',
  })
  const archivedConversationsQuery = useQuery({
    ...conversationListQueryOptions(runtime, projectId, 'archived'),
    enabled: connectionState === 'connected',
  })
  const conversationsQuery =
    archiveView === 'archived'
      ? archivedConversationsQuery
      : activeConversationsQuery
  const searchQueryOptions = conversationSearchInfiniteQueryOptions(
    runtime,
    projectId,
    {
      query: debouncedQuery.length > 0 ? debouncedQuery : 'search-disabled',
      archive: archiveView,
      ...(providerFilter === 'all' ? {} : { provider: providerFilter }),
      ...(statusFilter === 'all' ? {} : { status: statusFilter }),
    },
  )
  const durableSearchQuery = useInfiniteQuery({
    ...searchQueryOptions,
    enabled:
      connectionState === 'connected' &&
      searchMode &&
      debouncedQuery.length > 0,
  })
  const searchResults = useMemo(
    () => flattenConversationSearchPages(durableSearchQuery.data?.pages ?? []),
    [durableSearchQuery.data?.pages],
  )
  const viewState = conversationListPageViewState(
    projectQuery,
    conversationsQuery,
  )
  const conversations =
    viewState.kind === 'ready' ? viewState.conversations : emptyConversations
  const summary = useMemo(
    () => conversationStatusCounts(conversations),
    [conversations],
  )
  const knownConversations = useMemo(
    () => [
      ...(activeConversationsQuery.data ?? []),
      ...(archivedConversationsQuery.data ?? []),
    ],
    [activeConversationsQuery.data, archivedConversationsQuery.data],
  )
  const providers = useMemo(
    () => uniqueProviders(knownConversations),
    [knownConversations],
  )
  const visibleConversations = useMemo(
    () =>
      visibleProjectConversations(conversations, {
        provider: providerFilter,
        query: '',
        status: statusFilter,
      }),
    [conversations, providerFilter, statusFilter],
  )
  const groupedConversations = useMemo(
    () => groupProjectConversations(visibleConversations),
    [visibleConversations],
  )
  const statusFilters = useMemo<readonly StatusFilterOption[]>(
    () => [
      {
        label: '全部',
        value: 'all',
        ...(searchMode ? {} : { count: summary.total }),
      },
      {
        label: '运行中',
        value: 'running',
        ...(searchMode ? {} : { count: summary.running }),
      },
      {
        label: '等待',
        value: 'waiting',
        ...(searchMode ? {} : { count: summary.waiting }),
      },
      {
        label: '完成',
        value: 'completed',
        ...(searchMode ? {} : { count: summary.completed }),
      },
    ],
    [searchMode, summary],
  )
  const connectionUnavailable =
    connectionState === 'unavailable' || connectionState === 'incompatible'
  const loadingProject =
    !connectionUnavailable &&
    (projectQuery.isPending ||
      (connectionState !== 'connected' && projectQuery.data === undefined))
  const project = projectQuery.data

  function handleRetry() {
    runtime.retry()
    if (connectionState === 'connected') {
      void Promise.all([
        projectQuery.refetch(),
        activeConversationsQuery.refetch(),
        archivedConversationsQuery.refetch(),
        ...(searchMode ? [durableSearchQuery.refetch()] : []),
      ])
    }
  }

  function selectArchiveView(nextView: ConversationArchiveView) {
    void navigate({
      params: { projectId },
      search: {
        ...(nextView === 'archived' ? { view: 'archived' as const } : {}),
        ...(query.length > 0 ? { q: query } : {}),
      },
    })
  }

  function updateSearchQuery(nextQuery: string) {
    const nextSearchMode = isConversationSearchMode(nextQuery)
    void navigate({
      params: { projectId },
      replace: searchMode === nextSearchMode,
      resetScroll: false,
      search: {
        ...(archiveView === 'archived' ? { view: 'archived' as const } : {}),
        ...(nextQuery.length > 0 ? { q: nextQuery } : {}),
      },
    })
  }

  return (
    <div className="flex min-h-full min-w-0 flex-col px-[var(--layout-content-inline-padding)] py-[var(--layout-content-block-padding)]">
      <header>
        <h1 className="text-page font-semibold text-text-primary">会话</h1>
        <p className="mt-0.5 text-sm font-regular text-text-secondary">
          {project === undefined
            ? '查看项目中的智能体历史会话。'
            : `在 ${project.name} 中查看智能体历史会话。`}
        </p>
      </header>

      <div className="mt-4 flex min-w-0 items-center">
        <ConversationArchiveViewControl
          value={archiveView}
          onChange={selectArchiveView}
        />
      </div>

      <div className="mt-4 min-w-0 flex-1">
        {connectionUnavailable ? (
          <ConversationsErrorState
            incompatible={connectionState === 'incompatible'}
            onRetry={handleRetry}
          />
        ) : loadingProject ? (
          <ConversationsLoadingState />
        ) : projectQuery.isError ? (
          viewState.kind === 'not-found' ? (
            <ConversationsNotFoundState />
          ) : (
            <ConversationsErrorState
              title="无法读取项目"
              onRetry={handleRetry}
            />
          )
        ) : searchMode && project !== undefined ? (
          <ConversationSearchReadyContent
            archiveView={archiveView}
            connectionState={connectionState}
            error={
              durableSearchQuery.isError &&
              durableSearchQuery.data === undefined
                ? conversationSearchErrorMessage()
                : undefined
            }
            fetchNextError={
              durableSearchQuery.isFetchNextPageError
                ? conversationSearchErrorMessage()
                : undefined
            }
            refreshError={
              durableSearchQuery.isRefetchError &&
              !durableSearchQuery.isFetchNextPageError
                ? '无法刷新搜索结果；当前仍显示上一次读取的内容。'
                : undefined
            }
            hasNextPage={durableSearchQuery.hasNextPage === true}
            hasArchivedConversations={
              (archivedConversationsQuery.data?.length ?? 0) > 0
            }
            isFetchingNextPage={durableSearchQuery.isFetchingNextPage}
            loading={durableSearchQuery.isPending}
            project={project}
            providerFilter={providerFilter}
            providers={providers}
            query={query}
            results={searchResults}
            searchPending={
              searchPending ||
              (durableSearchQuery.isFetching &&
                !durableSearchQuery.isFetchingNextPage)
            }
            statusFilter={statusFilter}
            statusFilters={statusFilters}
            onArchiveViewChange={selectArchiveView}
            onClearSearch={() => updateSearchQuery('')}
            onLoadMore={() => void durableSearchQuery.fetchNextPage()}
            onRefreshMembership={async () => {
              await durableSearchQuery.refetch({ cancelRefetch: false })
            }}
            onProviderFilterChange={setProviderFilter}
            onQueryChange={updateSearchQuery}
            onResetPagination={() => {
              void queryClient.resetQueries({
                queryKey: searchQueryOptions.queryKey,
                exact: true,
              })
            }}
            onRetry={() => void durableSearchQuery.refetch()}
            onStatusFilterChange={setStatusFilter}
          />
        ) : viewState.kind === 'loading' ? (
          <ConversationsLoadingState />
        ) : viewState.kind === 'not-found' ? (
          <ConversationsNotFoundState />
        ) : viewState.kind === 'error' ? (
          <ConversationsErrorState title="无法读取会话" onRetry={handleRetry} />
        ) : (
          <ConversationReadyContent
            archiveView={archiveView}
            conversations={conversations}
            groupedConversations={groupedConversations}
            hasArchivedConversations={
              (archivedConversationsQuery.data?.length ?? 0) > 0
            }
            project={viewState.project}
            providerFilter={providerFilter}
            providers={providers}
            query={query}
            statusFilter={statusFilter}
            statusFilters={statusFilters}
            summary={summary}
            visibleConversationCount={visibleConversations.length}
            connectionState={connectionState}
            onArchiveViewChange={selectArchiveView}
            onProviderFilterChange={setProviderFilter}
            onQueryChange={updateSearchQuery}
            onStatusFilterChange={setStatusFilter}
          />
        )}
      </div>
    </div>
  )
}

interface ConversationSearchReadyContentProps {
  archiveView: ConversationArchiveView
  connectionState: ReturnType<typeof useHostConnectionState>
  error?: string
  fetchNextError?: string
  hasArchivedConversations: boolean
  hasNextPage: boolean
  isFetchingNextPage: boolean
  loading: boolean
  project: ProjectRecord
  providerFilter: ConversationProviderFilter
  providers: readonly Exclude<ConversationProviderFilter, 'all'>[]
  query: string
  refreshError?: string
  results: readonly ConversationSearchResult[]
  searchPending: boolean
  statusFilter: ConversationStatusFilter
  statusFilters: readonly StatusFilterOption[]
  onArchiveViewChange: (view: ConversationArchiveView) => void
  onClearSearch: () => void
  onLoadMore: () => void
  onRefreshMembership: () => Promise<unknown>
  onProviderFilterChange: (provider: ConversationProviderFilter) => void
  onQueryChange: (query: string) => void
  onResetPagination: () => void
  onRetry: () => void
  onStatusFilterChange: (status: ConversationStatusFilter) => void
}

function ConversationSearchReadyContent({
  archiveView,
  connectionState,
  error,
  fetchNextError,
  hasArchivedConversations,
  hasNextPage,
  isFetchingNextPage,
  loading,
  project,
  providerFilter,
  providers,
  query,
  refreshError,
  results,
  searchPending,
  statusFilter,
  statusFilters,
  onArchiveViewChange,
  onClearSearch,
  onLoadMore,
  onRefreshMembership,
  onProviderFilterChange,
  onQueryChange,
  onResetPagination,
  onRetry,
  onStatusFilterChange,
}: ConversationSearchReadyContentProps) {
  return (
    <>
      <ConversationToolbar
        providerFilter={providerFilter}
        providers={providers}
        query={query}
        statusFilter={statusFilter}
        statusFilters={statusFilters}
        project={project}
        onProviderFilterChange={onProviderFilterChange}
        onQueryChange={onQueryChange}
        onStatusFilterChange={onStatusFilterChange}
      />

      <div className="mt-4 flex min-w-0 items-start justify-between gap-3 border-b border-border pb-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text-primary">
            在 {project.name} 中搜索“{query.trim()}”
          </p>
          <p className="mt-0.5 text-xs text-text-muted">
            搜索会话标题和你发送过的历史提问
          </p>
        </div>
        {searchPending ? (
          <p
            role="status"
            className="inline-flex shrink-0 items-center gap-1.5 text-xs text-text-muted"
          >
            <RefreshCw
              aria-hidden="true"
              className="size-3.5 animate-spin motion-reduce:animate-none"
            />
            正在搜索…
          </p>
        ) : null}
      </div>

      {projectLocationAvailability(project) === 'unavailable' ? (
        <ProjectUnavailableNotice />
      ) : null}

      {connectionState === 'reconnecting' ? (
        <p role="status" className="mt-3 text-xs text-text-muted">
          正在重新连接，已显示最近一次搜索结果。
        </p>
      ) : null}

      {refreshError === undefined ? null : (
        <div
          role="alert"
          className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-sm border border-danger/30 bg-danger-muted px-3 py-2 text-sm text-danger"
        >
          <span>{refreshError}</span>
          <Button size="sm" variant="secondary" onClick={onRetry}>
            重试
          </Button>
        </div>
      )}

      <div className="mt-4 min-w-0" aria-busy={searchPending || loading}>
        {error !== undefined ? (
          <SearchErrorState message={error} onRetry={onRetry} />
        ) : loading && results.length === 0 ? (
          <SearchResultsLoading />
        ) : results.length > 0 ? (
          <ConversationSearchResults
            archiveView={archiveView}
            fetchNextError={fetchNextError}
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            onLoadMore={onLoadMore}
            onRefreshMembership={onRefreshMembership}
            onResetPagination={onResetPagination}
            results={results}
          />
        ) : searchPending ? (
          <SearchResultsLoading />
        ) : (
          <SearchNoResults
            archiveView={archiveView}
            hasArchivedConversations={hasArchivedConversations}
            query={query.trim()}
            onArchiveViewChange={onArchiveViewChange}
            onClearSearch={onClearSearch}
          />
        )}
      </div>
    </>
  )
}

interface ConversationReadyContentProps {
  archiveView: ConversationArchiveView
  connectionState: ReturnType<typeof useHostConnectionState>
  conversations: readonly ConversationSummary[]
  groupedConversations: ReturnType<typeof groupProjectConversations>
  hasArchivedConversations: boolean
  project: ProjectRecord
  providerFilter: ConversationProviderFilter
  providers: readonly Exclude<ConversationProviderFilter, 'all'>[]
  query: string
  statusFilter: ConversationStatusFilter
  statusFilters: readonly StatusFilterOption[]
  summary: ReturnType<typeof conversationStatusCounts>
  visibleConversationCount: number
  onArchiveViewChange: (view: ConversationArchiveView) => void
  onProviderFilterChange: (provider: ConversationProviderFilter) => void
  onQueryChange: (query: string) => void
  onStatusFilterChange: (status: ConversationStatusFilter) => void
}

function ConversationReadyContent({
  archiveView,
  connectionState,
  conversations,
  groupedConversations,
  hasArchivedConversations,
  project,
  providerFilter,
  providers,
  query,
  statusFilter,
  statusFilters,
  summary,
  visibleConversationCount,
  onArchiveViewChange,
  onProviderFilterChange,
  onQueryChange,
  onStatusFilterChange,
}: ConversationReadyContentProps) {
  const empty = conversations.length === 0

  return (
    <>
      <ConversationToolbar
        providerFilter={providerFilter}
        providers={providers}
        query={query}
        statusFilter={statusFilter}
        statusFilters={statusFilters}
        project={project}
        onProviderFilterChange={onProviderFilterChange}
        onQueryChange={onQueryChange}
        onStatusFilterChange={onStatusFilterChange}
      />

      <div className="mt-4">
        <ProjectSummary
          project={project}
          summary={summary}
          totalLabel={archiveView === 'archived' ? '已归档' : '活跃会话'}
        />
      </div>

      {projectLocationAvailability(project) === 'unavailable' ? (
        <ProjectUnavailableNotice />
      ) : null}

      {connectionState === 'reconnecting' ? (
        <p
          role="status"
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-regular text-text-muted"
        >
          <RefreshCw
            aria-hidden="true"
            className="size-3.5 animate-spin motion-reduce:animate-none"
          />
          正在重新连接，当前显示最近读取的会话。
        </p>
      ) : null}

      <div className="mt-4 min-w-0">
        {empty ? (
          <ConversationOrganizationEmptyState
            archiveView={archiveView}
            hasArchivedConversations={hasArchivedConversations}
            project={project}
            onArchiveViewChange={onArchiveViewChange}
          />
        ) : groupedConversations.length > 0 ? (
          <div className="space-y-5" aria-label="按智能体分组的会话">
            {groupedConversations.map((group) => (
              <ConversationGroup
                key={group.provider}
                archiveView={archiveView}
                provider={group.provider}
                conversations={group.conversations}
              />
            ))}
          </div>
        ) : (
          <NoConversationResults />
        )}
      </div>

      {conversations.length === 100 ? <ConversationLimitNotice /> : null}

      <p className="sr-only" role="status" aria-live="polite">
        当前显示 {visibleConversationCount} 个会话
      </p>
    </>
  )
}

interface ConversationArchiveViewControlProps {
  onChange: (view: ConversationArchiveView) => void
  value: ConversationArchiveView
}

function ConversationArchiveViewControl({
  onChange,
  value,
}: ConversationArchiveViewControlProps) {
  return (
    <div
      role="group"
      aria-label="会话组织视图"
      className="inline-flex rounded-sm border border-border bg-surface-muted/70 p-0.5"
    >
      {(
        [
          ['active', '活跃'],
          ['archived', '已归档'],
        ] as const
      ).map(([view, label]) => (
        <Button
          key={view}
          type="button"
          size="sm"
          variant="ghost"
          data-conversation-view-control
          aria-pressed={value === view}
          onClick={() => onChange(view)}
          className={cn(
            'h-7 min-w-20 border-0 px-3 text-xs',
            value === view
              ? 'bg-surface-elevated text-text-primary shadow-sm hover:bg-surface-elevated'
              : 'text-text-secondary',
          )}
        >
          {label}
        </Button>
      ))}
    </div>
  )
}

interface ConversationToolbarProps {
  project: ProjectRecord
  providerFilter: ConversationProviderFilter
  providers: readonly Exclude<ConversationProviderFilter, 'all'>[]
  query: string
  statusFilter: ConversationStatusFilter
  statusFilters: readonly StatusFilterOption[]
  onProviderFilterChange: (provider: ConversationProviderFilter) => void
  onQueryChange: (query: string) => void
  onStatusFilterChange: (status: ConversationStatusFilter) => void
}

function ConversationToolbar({
  project,
  providerFilter,
  providers,
  query,
  statusFilter,
  statusFilters,
  onProviderFilterChange,
  onQueryChange,
  onStatusFilterChange,
}: ConversationToolbarProps) {
  const currentProviderLabel =
    providerFilter === 'all'
      ? '全部智能体'
      : providerDisplayName(providerFilter)

  return (
    <div className="grid min-w-0 gap-3 2xl:grid-cols-[var(--layout-conversations-search-width)_minmax(0,1fr)] 2xl:items-center 2xl:gap-5">
      <SearchInput
        id="project-conversation-search"
        data-conversation-search-input
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        aria-label="搜索会话标题或你说过的内容"
        placeholder="搜索标题或历史提问…"
        autoComplete="off"
        maxLength={256}
        spellCheck={false}
        className="h-10 bg-surface-inset text-sm"
      />

      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="按状态筛选会话"
          className="flex min-w-0 items-center gap-1.5"
        >
          {statusFilters.map((filter) => {
            const selected = filter.value === statusFilter
            return (
              <Button
                key={filter.value}
                size="sm"
                variant="secondary"
                aria-pressed={selected}
                onClick={() => onStatusFilterChange(filter.value)}
                className={cn(
                  'h-7 rounded-sm px-2.5 text-xs font-medium tabular-nums',
                  selected
                    ? 'border-primary bg-primary-muted text-primary hover:border-primary hover:bg-primary-muted'
                    : 'border-border bg-surface-muted/70 text-text-secondary hover:border-border-strong hover:bg-surface-muted',
                )}
              >
                {filter.label}
                {filter.count === undefined ? null : ` ${filter.count}`}
              </Button>
            )
          })}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                aria-label={`筛选智能体，当前：${currentProviderLabel}`}
                className="h-9 rounded-sm bg-surface-inset px-3 text-sm"
              >
                <Filter aria-hidden="true" />
                筛选
                {providerFilter !== 'all' ? (
                  <Badge className="h-4 min-w-4 border-transparent px-1 text-2xs">
                    1
                  </Badge>
                ) : null}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>按智能体筛选</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={providerFilter}
                onValueChange={(value) =>
                  onProviderFilterChange(value as ConversationProviderFilter)
                }
              >
                <DropdownMenuRadioItem value="all">
                  全部智能体
                </DropdownMenuRadioItem>
                {providers.map((provider) => (
                  <DropdownMenuRadioItem key={provider} value={provider}>
                    {providerDisplayName(provider)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <NewConversationDialog
            currentProject={project}
            trigger={
              <NewConversationButton
                disabled={
                  projectLocationAvailability(project) === 'unavailable'
                }
              />
            }
          />
        </div>
      </div>
    </div>
  )
}

interface ConversationOrganizationEmptyStateProps {
  archiveView: ConversationArchiveView
  hasArchivedConversations: boolean
  onArchiveViewChange: (view: ConversationArchiveView) => void
  project: ProjectRecord
}

function ConversationOrganizationEmptyState({
  archiveView,
  hasArchivedConversations,
  onArchiveViewChange,
  project,
}: ConversationOrganizationEmptyStateProps) {
  const archived = archiveView === 'archived'
  return (
    <section className="grid min-h-64 place-items-center rounded-md border border-dashed border-border bg-surface/35 px-6 py-10 text-center">
      <div className="max-w-sm">
        <span
          aria-hidden="true"
          className="mx-auto grid size-11 place-items-center rounded-md border border-border bg-surface-muted text-text-secondary"
        >
          {archived ? (
            <Archive className="size-5" />
          ) : (
            <MessageSquare className="size-5" />
          )}
        </span>
        <h2 className="mt-4 text-section font-semibold text-text-primary">
          {archived ? '暂无已归档会话' : '还没有活跃会话'}
        </h2>
        <p className="mt-1.5 text-base text-text-secondary">
          {archived
            ? '归档可以帮助你整理暂时不需要的历史会话。'
            : '新建一个智能体会话，即可在这个项目中开始工作。'}
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {archived ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onArchiveViewChange('active')}
            >
              返回活跃会话
            </Button>
          ) : projectLocationAvailability(project) === 'available' ? (
            <NewConversationDialog
              currentProject={project}
              trigger={<NewConversationButton />}
            />
          ) : null}
          {!archived && hasArchivedConversations ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onArchiveViewChange('archived')}
            >
              查看已归档
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  )
}

const NewConversationButton = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof Button>
>(function NewConversationButton(
  { className, disabled = false, title, ...props },
  ref,
) {
  return (
    <Button
      ref={ref}
      size="sm"
      className={cn('h-9 px-4 text-sm', className)}
      disabled={disabled}
      title={title ?? (disabled ? '当前无法在此项目中创建会话' : undefined)}
      {...props}
    >
      <Plus aria-hidden="true" />
      新建会话
    </Button>
  )
})

function NoConversationResults() {
  return (
    <div className="grid min-h-48 place-items-center rounded-md border border-dashed border-border bg-surface/35 px-6 text-center">
      <div>
        <p className="text-base font-medium text-text-primary">
          没有符合条件的会话
        </p>
        <p className="mt-1 text-sm font-regular text-text-secondary">
          尝试调整搜索关键词或筛选条件。
        </p>
      </div>
    </div>
  )
}

function SearchResultsLoading() {
  return (
    <div role="status" aria-label="正在搜索历史" className="space-y-2">
      {Array.from({ length: 4 }, (_, index) => (
        <div
          key={index}
          className="h-[4.5rem] animate-pulse rounded-md border border-border bg-surface-muted/45 motion-reduce:animate-none"
        />
      ))}
    </div>
  )
}

interface SearchErrorStateProps {
  message: string
  onRetry: () => void
}

function SearchErrorState({ message, onRetry }: SearchErrorStateProps) {
  return (
    <section className="grid min-h-48 place-items-center rounded-md border border-border bg-surface/35 px-6 text-center">
      <div className="max-w-sm">
        <h2 className="text-base font-semibold text-text-primary">
          无法搜索历史
        </h2>
        <p className="mt-1.5 text-sm text-text-secondary">{message}</p>
        <Button
          className="mt-4"
          size="sm"
          variant="secondary"
          onClick={onRetry}
        >
          重试
        </Button>
      </div>
    </section>
  )
}

interface SearchNoResultsProps {
  archiveView: ConversationArchiveView
  hasArchivedConversations: boolean
  query: string
  onArchiveViewChange: (view: ConversationArchiveView) => void
  onClearSearch: () => void
}

function SearchNoResults({
  archiveView,
  hasArchivedConversations,
  query,
  onArchiveViewChange,
  onClearSearch,
}: SearchNoResultsProps) {
  const canSearchOtherView =
    archiveView === 'archived' || hasArchivedConversations
  return (
    <section className="grid min-h-52 place-items-center rounded-md border border-dashed border-border bg-surface/35 px-6 py-8 text-center">
      <div className="max-w-md min-w-0">
        <h2 className="text-base font-semibold text-text-primary">
          没有找到匹配的会话
        </h2>
        <p className="mt-1.5 break-words text-sm text-text-secondary">
          当前{archiveView === 'archived' ? '已归档' : '活跃'}会话中没有匹配“
          {query}”的标题或历史提问。
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button size="sm" variant="secondary" onClick={onClearSearch}>
            清除搜索
          </Button>
          {canSearchOtherView ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                onArchiveViewChange(
                  archiveView === 'archived' ? 'active' : 'archived',
                )
              }
            >
              在{archiveView === 'archived' ? '活跃会话' : '已归档'}中搜索
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function conversationSearchErrorMessage(): string {
  return 'CodeTether 暂时无法搜索历史，请重试。'
}

export type { ConversationsPageProps }
