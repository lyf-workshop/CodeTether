import {
  useId,
  useMemo,
  useState,
  type ComponentPropsWithoutRef,
  type Ref,
} from 'react'
import { Link } from '@tanstack/react-router'
import { Archive, MoreHorizontal, Plus } from 'lucide-react'
import type { ProjectId } from '@codetether/protocol'

import {
  AgentIdentityMark,
  Badge,
  Button,
  IconButton,
  ScrollArea,
  SearchInput,
  agentDefinitions,
  cn,
  statusDefinitions,
  type ExecutionStatus,
} from '@codetether/ui'

import type {
  ConversationRailFilter,
  ConversationRailGroupViewModel,
  ConversationRailItemViewModel,
} from './conversation-view-model'

const railFilters = [
  { label: '全部', value: 'all' },
  { label: '进行中', value: 'running' },
  { label: '等待', value: 'waiting' },
  { label: '完成', value: 'completed' },
] as const satisfies readonly {
  label: string
  value: ConversationRailFilter
}[]

const statusDotColorClasses = {
  idle: 'text-status-idle/70',
  thinking: 'text-status-thinking/80',
  running: 'text-status-running',
  waiting: 'text-status-waiting',
  completed: 'text-text-muted/60',
  failed: 'text-status-failed',
  offline: 'text-status-offline/70',
} satisfies Record<ExecutionStatus, string>

const statusTextColorClasses = {
  idle: 'text-text-muted',
  thinking: 'text-status-thinking',
  running: 'text-status-running',
  waiting: 'text-status-waiting',
  completed: 'text-text-muted',
  failed: 'text-status-failed',
  offline: 'text-text-muted',
} satisfies Record<ExecutionStatus, string>

interface StatusDotProps {
  status: ExecutionStatus
}

function StatusDot({ status }: StatusDotProps) {
  const definition = statusDefinitions[status]

  return (
    <span
      role="img"
      aria-label={definition.label}
      className={cn(
        'size-2 shrink-0 rounded-full bg-current',
        statusDotColorClasses[status],
      )}
    />
  )
}

interface ConversationRailRowProps {
  conversation: ConversationRailItemViewModel
  selected: boolean
}

function ConversationRailRow({
  conversation,
  selected,
}: ConversationRailRowProps) {
  const status = statusDefinitions[conversation.status]
  const statusSummary = conversation.machine
    ? `${status.label} · ${conversation.machine}`
    : status.label
  const attentionClass =
    conversation.status === 'waiting'
      ? 'border-status-waiting/20 bg-status-waiting-muted/25 hover:border-status-waiting/35 hover:bg-status-waiting-muted/35'
      : conversation.status === 'failed'
        ? 'border-status-failed/20 bg-status-failed-muted/25 hover:border-status-failed/35 hover:bg-status-failed-muted/35'
        : null

  return (
    <li>
      <Button
        asChild
        variant="ghost"
        className={cn(
          'group relative h-16 w-full min-w-0 justify-start gap-3 overflow-hidden rounded-sm px-3 text-left whitespace-normal',
          'border border-transparent bg-transparent hover:bg-surface-muted/60',
          selected
            ? "bg-surface-muted/75 before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-r-full before:bg-primary before:content-[''] hover:bg-surface-muted"
            : attentionClass,
        )}
      >
        <Link
          to="/conversations/$conversationId"
          params={{ conversationId: conversation.id }}
          search={{}}
          aria-current={selected ? 'page' : undefined}
          data-selected={selected || undefined}
        >
          <StatusDot status={conversation.status} />

          <span className="min-w-0 flex-1 self-stretch py-2">
            <span
              className={cn(
                'block truncate text-md',
                selected ? 'font-semibold' : 'font-medium',
                conversation.status === 'completed' && !selected
                  ? 'text-text-secondary'
                  : 'text-text-primary',
              )}
            >
              {conversation.title}
            </span>
            <span
              className={cn(
                'mt-1 block truncate text-xs font-regular',
                statusTextColorClasses[conversation.status],
              )}
            >
              {statusSummary}
            </span>
          </span>

          <span className="flex h-full shrink-0 flex-col items-end justify-between py-2 text-text-muted">
            <span className="text-xs font-regular tabular-nums">
              {conversation.lastActivity}
            </span>
            <MoreHorizontal
              aria-hidden="true"
              className={cn(
                'size-4 transition-opacity duration-150 motion-reduce:transition-none',
                selected
                  ? 'opacity-60 group-hover:opacity-100'
                  : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
              )}
            />
          </span>
        </Link>
      </Button>
    </li>
  )
}

export interface ConversationRailProps extends Omit<
  ComponentPropsWithoutRef<'aside'>,
  'children'
> {
  archivedCount?: number
  currentConversationId: string
  groups: readonly ConversationRailGroupViewModel[]
  newConversationButtonRef?: Ref<HTMLButtonElement>
  newConversationDisabled?: boolean
  onNewConversation?: () => void
  projectId?: ProjectId
}

/** Frozen conversation navigation presentation for the desktop workspace. */
export function ConversationRail({
  archivedCount,
  className,
  currentConversationId,
  groups,
  newConversationButtonRef,
  newConversationDisabled = false,
  onNewConversation,
  projectId,
  ...props
}: ConversationRailProps) {
  const headingId = useId()
  const [filter, setFilter] = useState<ConversationRailFilter>('all')
  const [query, setQuery] = useState('')

  const visibleGroups = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return groups
      .map((group) => ({
        ...group,
        conversations: group.conversations.filter((conversation) => {
          const matchesFilter =
            filter === 'all' || conversation.status === filter
          const searchableText = [conversation.title, conversation.machine]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()

          return matchesFilter && searchableText.includes(normalizedQuery)
        }),
      }))
      .filter((group) => group.conversations.length > 0)
  }, [filter, groups, query])

  return (
    <aside
      aria-labelledby={headingId}
      data-slot="conversation-rail"
      className={cn(
        'flex h-full min-h-0 min-w-0 flex-col border-r border-border bg-surface-inset text-text-primary',
        className,
      )}
      {...props}
    >
      <div className="flex items-center justify-between pr-4 pl-5 pt-3.5">
        <h2 id={headingId} className="text-section font-semibold">
          {projectId === undefined ? (
            '会话'
          ) : (
            <Link
              to="/projects/$projectId/conversations"
              params={{ projectId }}
              className="rounded-xs outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              会话
            </Link>
          )}
        </h2>
        <IconButton
          ref={newConversationButtonRef}
          label={
            newConversationDisabled ? '项目不可用，无法新建会话' : '新建会话'
          }
          size="sm"
          variant="secondary"
          disabled={newConversationDisabled}
          onClick={onNewConversation}
          className="h-[var(--layout-brand-mark-size)] w-[var(--layout-sidebar-mark-size)]"
        >
          <Plus aria-hidden="true" />
        </IconButton>
      </div>

      <SearchInput
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label="搜索会话"
        placeholder="搜索会话"
        containerClassName="mt-1.5 px-4"
        className="h-9 bg-surface-inset text-sm"
      />

      <div
        role="group"
        aria-label="筛选会话"
        className="mt-3 flex flex-wrap gap-1.5 px-4"
      >
        {railFilters.map((option) => {
          const selected = filter === option.value

          return (
            <Button
              key={option.value}
              size="sm"
              variant="secondary"
              aria-pressed={selected}
              onClick={() => setFilter(option.value)}
              className={cn(
                'h-7 rounded-sm px-2.5 text-sm',
                selected
                  ? 'border-primary bg-primary-muted text-primary hover:border-primary hover:bg-primary-muted'
                  : 'border-border/70 bg-surface-muted/60 text-text-secondary hover:border-border-strong hover:bg-surface-muted',
              )}
            >
              {option.label}
            </Button>
          )
        })}
      </div>

      <ScrollArea className="mt-4 min-h-0 flex-1">
        <nav aria-label="会话历史" className="px-3 pb-3">
          {visibleGroups.length > 0 ? (
            <div className="space-y-4">
              {visibleGroups.map((group) => {
                const agent = agentDefinitions[group.agent]
                const groupHeadingId = `${headingId}-${group.agent}`

                return (
                  <section key={group.agent} aria-labelledby={groupHeadingId}>
                    <div className="flex h-7 items-center gap-2.5 px-1">
                      <AgentIdentityMark
                        agent={group.agent}
                        className="size-7 rounded-sm text-sm"
                      />
                      <h3
                        id={groupHeadingId}
                        className="min-w-0 flex-1 truncate text-md font-semibold"
                      >
                        {agent.name}
                      </h3>
                      <Badge
                        variant="secondary"
                        aria-label={`${group.conversations.length} 个会话`}
                        className="h-6 min-w-6 border-transparent bg-surface-muted/70 px-2 text-xs tabular-nums"
                      >
                        {group.conversations.length}
                      </Badge>
                    </div>

                    <ul className="mt-3 space-y-1.5">
                      {group.conversations.map((conversation) => (
                        <ConversationRailRow
                          key={conversation.id}
                          conversation={conversation}
                          selected={conversation.id === currentConversationId}
                        />
                      ))}
                    </ul>
                  </section>
                )
              })}
            </div>
          ) : (
            <p
              role="status"
              className="rounded-sm bg-surface-muted/40 px-3 py-6 text-center text-sm text-text-muted"
            >
              没有符合条件的会话。
            </p>
          )}

          {archivedCount === undefined ? null : (
            <Button
              variant="ghost"
              className="mt-4 h-[var(--layout-sidebar-context-item-height)] w-full justify-start gap-2.5 border-transparent bg-transparent px-3 text-sm text-text-secondary hover:bg-surface-muted/60 hover:text-text-primary"
            >
              <Archive aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-left">
                已归档会话
              </span>
              <Badge
                variant="secondary"
                aria-label={`${archivedCount} 个已归档会话`}
                className="h-6 min-w-6 border-transparent bg-surface-muted/70 px-2 text-xs tabular-nums"
              >
                {archivedCount}
              </Badge>
            </Button>
          )}
        </nav>
      </ScrollArea>
    </aside>
  )
}
