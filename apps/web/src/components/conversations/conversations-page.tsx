import { useMemo, useState } from 'react'
import {
  Archive,
  ChevronRight,
  Filter,
  MessageSquarePlus,
  Plus,
  SortAsc,
} from 'lucide-react'

import {
  Badge,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  SearchInput,
  cn,
  type AgentId,
  type ExecutionStatus,
} from '@codetether/ui'

import { conversationsMock } from '../../mocks/conversations'
import { ConversationGroup } from './conversation-group'
import { ProjectSummary } from './project-summary'

type StatusFilter = 'all' | 'running' | 'waiting' | 'completed'
type AgentFilter = 'all' | AgentId
type SortOption = 'recent' | 'oldest' | 'title'

interface StatusFilterOption {
  label: string
  value: StatusFilter
  count: number
}

const sortLabels = {
  recent: '最近活动',
  oldest: '最早活动',
  title: '会话标题',
} satisfies Record<SortOption, string>

function matchesStatus(
  conversationStatus: ExecutionStatus,
  filter: StatusFilter,
) {
  return filter === 'all' || conversationStatus === filter
}

export function ConversationsPage() {
  const data = conversationsMock
  const [agentFilter, setAgentFilter] = useState<AgentFilter>('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortOption>('recent')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [liveMessage, setLiveMessage] = useState('')

  const statusFilters = useMemo<readonly StatusFilterOption[]>(
    () => [
      { label: '全部', value: 'all', count: data.summary.total },
      { label: '运行中', value: 'running', count: data.summary.running },
      { label: '等待', value: 'waiting', count: data.summary.waiting },
      { label: '完成', value: 'completed', count: data.summary.completed },
    ],
    [data.summary],
  )

  const visibleConversations = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN')

    return data.conversations
      .filter((conversation) => !conversation.archived)
      .filter((conversation) =>
        matchesStatus(conversation.status, statusFilter),
      )
      .filter(
        (conversation) =>
          agentFilter === 'all' || conversation.agent === agentFilter,
      )
      .filter((conversation) => {
        const searchableText =
          `${conversation.title} ${conversation.description}`.toLocaleLowerCase(
            'zh-CN',
          )

        return searchableText.includes(normalizedQuery)
      })
      .toSorted((left, right) => {
        if (sort === 'title') {
          return left.title.localeCompare(right.title, 'zh-CN')
        }

        const direction = sort === 'recent' ? -1 : 1
        return left.updatedAt.localeCompare(right.updatedAt) * direction
      })
  }, [agentFilter, data.conversations, query, sort, statusFilter])

  const groupedConversations = useMemo(
    () =>
      data.agents
        .map((agent) => ({
          agent,
          conversations: visibleConversations.filter(
            (conversation) => conversation.agent === agent.id,
          ),
        }))
        .filter((group) => group.conversations.length > 0),
    [data.agents, visibleConversations],
  )

  const machineNames = useMemo(
    () => new Map(data.machines.map((machine) => [machine.id, machine.name])),
    [data.machines],
  )

  const currentAgentLabel =
    agentFilter === 'all'
      ? '全部智能体'
      : data.agents.find((agent) => agent.id === agentFilter)?.name

  return (
    <div className="flex min-h-full min-w-0 flex-col px-[var(--layout-content-inline-padding)] py-[var(--layout-content-block-padding)]">
      <header>
        <h1 className="text-page font-semibold text-text-primary">会话</h1>
        <p className="mt-0.5 text-sm font-regular text-text-secondary">
          在 {data.project.name} 中统一管理不同智能体的历史会话。
        </p>
      </header>

      <div className="mt-6 grid min-w-0 gap-3 2xl:grid-cols-[var(--layout-conversations-search-width)_minmax(0,1fr)] 2xl:items-center 2xl:gap-5">
        <SearchInput
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="搜索会话标题或描述"
          placeholder="搜索会话标题、内容或文件…"
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
                  onClick={() => setStatusFilter(filter.value)}
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
                  aria-label={`筛选智能体，当前：${currentAgentLabel}`}
                  className="h-9 rounded-sm bg-surface-inset px-3 text-sm"
                >
                  <Filter aria-hidden="true" />
                  筛选
                  {agentFilter !== 'all' ? (
                    <Badge className="h-4 min-w-4 border-transparent px-1 text-2xs">
                      1
                    </Badge>
                  ) : null}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>按智能体筛选</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={agentFilter}
                  onValueChange={(value) =>
                    setAgentFilter(value as AgentFilter)
                  }
                >
                  <DropdownMenuRadioItem value="all">
                    全部智能体
                  </DropdownMenuRadioItem>
                  {data.agents.map((agent) => (
                    <DropdownMenuRadioItem key={agent.id} value={agent.id}>
                      {agent.name}
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
                  onValueChange={(value) => setSort(value as SortOption)}
                >
                  {(Object.entries(sortLabels) as [SortOption, string][]).map(
                    ([value, label]) => (
                      <DropdownMenuRadioItem key={value} value={value}>
                        {label}
                      </DropdownMenuRadioItem>
                    ),
                  )}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <Dialog>
              <DialogTrigger asChild>
                <Button size="sm" className="h-9 px-4 text-sm">
                  <Plus aria-hidden="true" />
                  新建会话
                </Button>
              </DialogTrigger>
              <DialogContent closeLabel="关闭新建会话提示" className="max-w-md">
                <DialogHeader>
                  <span
                    aria-hidden="true"
                    className="grid size-10 place-items-center rounded-md bg-primary-muted text-primary"
                  >
                    <MessageSquarePlus className="size-5" />
                  </span>
                  <DialogTitle>新建会话</DialogTitle>
                  <DialogDescription>
                    完整的新建会话流程将在后续版本提供。当前仅支持浏览、筛选与打开会话。
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button size="sm">知道了</Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <ProjectSummary project={data.project} summary={data.summary} />
      </div>

      <div className="mt-4 min-w-0 flex-1">
        {groupedConversations.length > 0 ? (
          <div className="space-y-5" aria-label="按智能体分组的会话">
            {groupedConversations.map((group) => (
              <ConversationGroup
                key={group.agent.id}
                agent={group.agent}
                conversations={group.conversations}
                machineNames={machineNames}
                selectedConversationId="demo"
              />
            ))}
          </div>
        ) : (
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
        )}
      </div>

      <div className="sticky bottom-0 z-20 mx-4 mt-2 bg-background/95 py-2 backdrop-blur-sm">
        <Button
          variant="ghost"
          onClick={() => setLiveMessage('已归档会话页面尚未实现。')}
          className="h-11 w-full justify-start rounded-md border border-border bg-surface/85 px-3.5 text-sm font-medium text-text-secondary hover:border-border-strong hover:bg-surface-muted hover:text-text-primary"
        >
          <Archive aria-hidden="true" />
          <span>已归档会话</span>
          <span className="ml-auto text-xs font-regular tabular-nums text-text-muted">
            {data.summary.archived}
          </span>
          <ChevronRight aria-hidden="true" className="text-text-muted" />
        </Button>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {liveMessage || `当前显示 ${visibleConversations.length} 个会话`}
      </p>
    </div>
  )
}

export type { AgentFilter, SortOption, StatusFilter }
