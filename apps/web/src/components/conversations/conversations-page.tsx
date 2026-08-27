import {
  forwardRef,
  useMemo,
  useState,
  type ComponentPropsWithoutRef,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import { Filter, Plus, RefreshCw, SortAsc } from 'lucide-react'

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
  ConversationSummary,
  ProjectId,
  ProjectRecord,
} from '@codetether/protocol'

import {
  useHostConnectionState,
  useHostRuntime,
} from '../../runtime/host/host-runtime-hooks'
import { conversationListQueryOptions } from '../../runtime/host/conversation-list-query'
import { conversationListPageViewState } from '../../runtime/host/conversation-list-view-state'
import { projectDetailQueryOptions } from '../../runtime/host/project-query'
import { ConversationGroup } from './conversation-group'
import {
  conversationStatusCounts,
  groupProjectConversations,
  providerDisplayName,
  uniqueProviders,
  visibleProjectConversations,
  type ConversationProviderFilter,
  type ConversationSortOption,
  type ConversationStatusFilter,
} from './conversation-list-model'
import {
  ConversationLimitNotice,
  ConversationsEmptyState,
  ConversationsErrorState,
  ConversationsLoadingState,
  ConversationsNotFoundState,
  ProjectUnavailableNotice,
} from './conversation-page-states'
import { NewConversationDialog } from './new-conversation-dialog'
import { ProjectSummary } from './project-summary'

interface ConversationsPageProps {
  projectId: ProjectId
}

interface StatusFilterOption {
  label: string
  value: ConversationStatusFilter
  count: number
}

const sortLabels = {
  recent: '最近活动',
  oldest: '最早活动',
  title: '会话标题',
} satisfies Record<ConversationSortOption, string>

const emptyConversations: readonly ConversationSummary[] = []

export function ConversationsPage({ projectId }: ConversationsPageProps) {
  const runtime = useHostRuntime()
  const connectionState = useHostConnectionState()
  const [providerFilter, setProviderFilter] =
    useState<ConversationProviderFilter>('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<ConversationSortOption>('recent')
  const [statusFilter, setStatusFilter] =
    useState<ConversationStatusFilter>('all')

  const projectQuery = useQuery({
    ...projectDetailQueryOptions(runtime, projectId),
    enabled: connectionState === 'connected',
  })
  const conversationsQuery = useQuery({
    ...conversationListQueryOptions(runtime, projectId),
    enabled: connectionState === 'connected',
  })
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
  const providers = useMemo(
    () => uniqueProviders(conversations),
    [conversations],
  )
  const visibleConversations = useMemo(
    () =>
      visibleProjectConversations(conversations, {
        provider: providerFilter,
        query,
        sort,
        status: statusFilter,
      }),
    [conversations, providerFilter, query, sort, statusFilter],
  )
  const groupedConversations = useMemo(
    () => groupProjectConversations(visibleConversations),
    [visibleConversations],
  )
  const statusFilters = useMemo<readonly StatusFilterOption[]>(
    () => [
      { label: '全部', value: 'all', count: summary.total },
      { label: '运行中', value: 'running', count: summary.running },
      { label: '等待', value: 'waiting', count: summary.waiting },
      { label: '完成', value: 'completed', count: summary.completed },
    ],
    [summary],
  )
  const connectionUnavailable =
    connectionState === 'unavailable' || connectionState === 'incompatible'
  const loading =
    !connectionUnavailable &&
    (viewState.kind === 'loading' ||
      (connectionState !== 'connected' && projectQuery.data === undefined))

  function handleRetry() {
    runtime.retry()
    if (connectionState === 'connected') {
      void Promise.all([projectQuery.refetch(), conversationsQuery.refetch()])
    }
  }

  const project =
    viewState.kind === 'ready' || viewState.kind === 'empty'
      ? viewState.project
      : undefined

  return (
    <div className="flex min-h-full min-w-0 flex-col px-[var(--layout-content-inline-padding)] py-[var(--layout-content-block-padding)]">
      <header>
        <h1 className="text-page font-semibold text-text-primary">会话</h1>
        <p className="mt-0.5 text-sm font-regular text-text-secondary">
          {project === undefined
            ? '查看项目中的 Codex 历史会话。'
            : `在 ${project.name} 中查看 Codex 历史会话。`}
        </p>
      </header>

      <div className="mt-6 min-w-0 flex-1">
        {connectionUnavailable ? (
          <ConversationsErrorState
            incompatible={connectionState === 'incompatible'}
            onRetry={handleRetry}
          />
        ) : loading ? (
          <ConversationsLoadingState />
        ) : viewState.kind === 'loading' ? (
          <ConversationsLoadingState />
        ) : viewState.kind === 'not-found' ? (
          <ConversationsNotFoundState />
        ) : viewState.kind === 'error' ? (
          <ConversationsErrorState title="无法读取会话" onRetry={handleRetry} />
        ) : viewState.kind === 'empty' ? (
          <>
            <ProjectSummary project={viewState.project} summary={summary} />
            {viewState.project.availability === 'unavailable' ? (
              <ProjectUnavailableNotice />
            ) : null}
            <div className="mt-4">
              <ConversationsEmptyState
                action={
                  viewState.project.availability ===
                  'unavailable' ? undefined : (
                    <NewConversationDialog
                      currentProject={viewState.project}
                      trigger={<NewConversationButton />}
                    />
                  )
                }
              />
            </div>
          </>
        ) : (
          <>
            <ConversationToolbar
              providerFilter={providerFilter}
              providers={providers}
              query={query}
              sort={sort}
              statusFilter={statusFilter}
              statusFilters={statusFilters}
              project={viewState.project}
              onProviderFilterChange={setProviderFilter}
              onQueryChange={setQuery}
              onSortChange={setSort}
              onStatusFilterChange={setStatusFilter}
            />

            <div className="mt-4">
              <ProjectSummary project={viewState.project} summary={summary} />
            </div>

            {viewState.project.availability === 'unavailable' ? (
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
              {groupedConversations.length > 0 ? (
                <div className="space-y-5" aria-label="按智能体分组的会话">
                  {groupedConversations.map((group) => (
                    <ConversationGroup
                      key={group.provider}
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
              当前显示 {visibleConversations.length} 个会话
            </p>
          </>
        )}
      </div>
    </div>
  )
}

interface ConversationToolbarProps {
  project: ProjectRecord
  providerFilter: ConversationProviderFilter
  providers: readonly Exclude<ConversationProviderFilter, 'all'>[]
  query: string
  sort: ConversationSortOption
  statusFilter: ConversationStatusFilter
  statusFilters: readonly StatusFilterOption[]
  onProviderFilterChange: (provider: ConversationProviderFilter) => void
  onQueryChange: (query: string) => void
  onSortChange: (sort: ConversationSortOption) => void
  onStatusFilterChange: (status: ConversationStatusFilter) => void
}

function ConversationToolbar({
  project,
  providerFilter,
  providers,
  query,
  sort,
  statusFilter,
  statusFilters,
  onProviderFilterChange,
  onQueryChange,
  onSortChange,
  onStatusFilterChange,
}: ConversationToolbarProps) {
  const currentProviderLabel =
    providerFilter === 'all'
      ? '全部智能体'
      : providerDisplayName(providerFilter)

  return (
    <div className="grid min-w-0 gap-3 2xl:grid-cols-[var(--layout-conversations-search-width)_minmax(0,1fr)] 2xl:items-center 2xl:gap-5">
      <SearchInput
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        aria-label="搜索会话标题或智能体"
        placeholder="搜索会话标题或智能体…"
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
                {filter.label} {filter.count}
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

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                aria-label={`排序，当前：${sortLabels[sort]}`}
                className="h-9 rounded-sm bg-surface-inset px-3 text-sm"
              >
                <SortAsc aria-hidden="true" />
                排序
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>排序方式</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={sort}
                onValueChange={(value) =>
                  onSortChange(value as ConversationSortOption)
                }
              >
                {(
                  Object.entries(sortLabels) as [
                    ConversationSortOption,
                    string,
                  ][]
                ).map(([value, label]) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    {label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <NewConversationDialog
            currentProject={project}
            trigger={
              <NewConversationButton
                disabled={project.availability === 'unavailable'}
              />
            }
          />
        </div>
      </div>
    </div>
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

export type { ConversationsPageProps }
