import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type Ref,
} from 'react'
import { Link } from '@tanstack/react-router'
import { Archive, MoreHorizontal, Pin, Plus } from 'lucide-react'
import {
  ConversationIdSchema,
  type ConversationSummary,
  type ProjectId,
  type TurnId,
} from '@codetether/protocol'

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
import { organizationConversationStatus } from './conversation-view-model'
import {
  ConversationRailSearchResults,
  RailSearchStatus,
} from './conversation-rail-search'
import { ConversationOrganizationMenu } from '../conversations/conversation-organization-controls'
import { useDebouncedSearchQuery } from '../conversations/use-debounced-search-query'
import { providerDisplayName } from '../../provider/provider-presentation'

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
  matchDescription?: string
  selected: boolean
  projectId?: ProjectId
  rowRef?: Ref<HTMLLIElement>
  targetTurnId?: TurnId
  onArchived?: (conversation: ConversationSummary) => void
  onMembershipChanged?: (conversationId: string) => void
  onUnarchived?: (conversation: ConversationSummary) => void
}

function ConversationRailRow({
  conversation,
  matchDescription,
  selected,
  projectId,
  rowRef,
  targetTurnId,
  onArchived,
  onMembershipChanged,
  onUnarchived,
}: ConversationRailRowProps) {
  const conversationId = ConversationIdSchema.safeParse(conversation.id)
  const status = statusDefinitions[conversation.status]
  const statusSummary = [
    conversation.provider === undefined
      ? undefined
      : providerDisplayName(conversation.provider),
    status.label,
    conversation.machine,
  ]
    .filter((value): value is string => value !== undefined)
    .join(' · ')
  const attentionClass =
    conversation.status === 'waiting'
      ? 'border-status-waiting/20 bg-status-waiting-muted/25 hover:border-status-waiting/35 hover:bg-status-waiting-muted/35'
      : conversation.status === 'failed'
        ? 'border-status-failed/20 bg-status-failed-muted/25 hover:border-status-failed/35 hover:bg-status-failed-muted/35'
        : null

  return (
    <li
      ref={rowRef}
      className="group/row relative min-w-0"
      data-conversation-rail-row={conversation.id}
    >
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
          search={targetTurnId === undefined ? {} : { turn: targetTurnId }}
          aria-current={selected ? 'page' : undefined}
          data-selected={selected || undefined}
          data-conversation-rail-primary-action
        >
          <StatusDot status={conversation.status} />

          <span className="min-w-0 flex-1 self-stretch py-2">
            <span
              title={conversation.title}
              className={cn(
                'block truncate text-md',
                selected ? 'font-semibold' : 'font-medium',
                conversation.status === 'completed' && !selected
                  ? 'text-text-secondary'
                  : 'text-text-primary',
              )}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                {conversation.pinnedAt === undefined ? null : (
                  <Pin
                    aria-label="已置顶"
                    className="size-3 shrink-0 text-text-muted"
                  />
                )}
                <span className="truncate">{conversation.title}</span>
              </span>
            </span>
            <span className="mt-1 flex min-w-0 items-center gap-1 text-xs font-regular">
              <span
                className={cn(
                  'shrink-0',
                  statusTextColorClasses[conversation.status],
                )}
              >
                {statusSummary}
              </span>
              {matchDescription === undefined ? null : (
                <>
                  <span aria-hidden="true" className="shrink-0 text-text-muted">
                    ·
                  </span>
                  <span
                    title={matchDescription}
                    className="min-w-0 truncate text-text-secondary"
                  >
                    {matchDescription}
                  </span>
                </>
              )}
            </span>
          </span>

          <span className="flex h-full shrink-0 items-center py-2 pr-7 text-text-muted group-hover/row:opacity-0 group-focus-within/row:opacity-0">
            <span className="text-xs font-regular tabular-nums">
              {conversation.lastActivity}
            </span>
          </span>
        </Link>
      </Button>
      {projectId === undefined || !conversationId.success ? null : (
        <ConversationOrganizationMenu
          conversation={{
            conversationId: conversationId.data,
            projectId,
            title: conversation.title,
            titleSource: conversation.titleSource,
            status: organizationConversationStatus(conversation.status),
            ...(conversation.pinnedAt === undefined
              ? {}
              : { pinnedAt: conversation.pinnedAt }),
            ...(conversation.archivedAt === undefined
              ? {}
              : { archivedAt: conversation.archivedAt }),
          }}
          align="end"
          onArchived={(updated) => {
            if (!selected) onMembershipChanged?.(conversation.id)
            onArchived?.(updated)
          }}
          onRenamed={(updated) => {
            onMembershipChanged?.(updated.conversationId)
          }}
          onUnarchived={(updated) => {
            if (!selected) onMembershipChanged?.(conversation.id)
            onUnarchived?.(updated)
          }}
          trigger={
            <IconButton
              label={`管理会话：${conversation.title}`}
              variant="ghost"
              size="sm"
              className="absolute top-1/2 right-1 z-10 size-8 -translate-y-1/2 text-text-secondary opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 data-[state=open]:opacity-100"
              data-conversation-rail-organization-trigger
            >
              <MoreHorizontal aria-hidden="true" />
            </IconButton>
          }
        />
      )}
    </li>
  )
}

export interface ConversationRailProps extends Omit<
  ComponentPropsWithoutRef<'aside'>,
  'children'
> {
  currentArchivedConversation?: ConversationRailItemViewModel
  currentConversationId: string
  groups: readonly ConversationRailGroupViewModel[]
  newConversationButtonRef?: Ref<HTMLButtonElement>
  newConversationDisabled?: boolean
  onNewConversation?: () => void
  projectId?: ProjectId
  onArchived?: (conversation: ConversationSummary) => void
}

/** Frozen conversation navigation presentation for the desktop workspace. */
export function ConversationRail({
  className,
  currentConversationId,
  currentArchivedConversation,
  groups,
  newConversationButtonRef,
  newConversationDisabled = false,
  onNewConversation,
  projectId,
  onArchived,
  ...props
}: ConversationRailProps) {
  const headingId = useId()
  const [filter, setFilter] = useState<ConversationRailFilter>('all')
  const [query, setQuery] = useState('')
  const trimmedQuery = query.trim()
  const debouncedQuery = useDebouncedSearchQuery(query)
  const selectedRowRef = useRef<HTMLLIElement>(null)
  const railNavigationRef = useRef<HTMLElement>(null)
  const previousSelectedPinRef = useRef<string | null | undefined>(undefined)

  const visibleGroups = useMemo(() => {
    const normalizedQuery =
      projectId === undefined ? query.trim().toLowerCase() : ''

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
  }, [filter, groups, projectId, query])

  const currentConversation = useMemo(
    () =>
      groups
        .flatMap((group) => group.conversations)
        .find((conversation) => conversation.id === currentConversationId),
    [currentConversationId, groups],
  )
  const durableSearchActive = projectId !== undefined && trimmedQuery.length > 0
  const durableSearchPending =
    durableSearchActive && debouncedQuery !== trimmedQuery

  const selectedPinnedAt = groups
    .flatMap((group) => group.conversations)
    .find((conversation) => conversation.id === currentConversationId)?.pinnedAt

  useEffect(() => {
    const next = selectedPinnedAt ?? null
    const previous = previousSelectedPinRef.current
    previousSelectedPinRef.current = next
    if (previous === undefined || previous === next) return
    selectedRowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedPinnedAt])

  function focusAfterMembershipChange(conversationId: string) {
    const navigation = railNavigationRef.current
    if (navigation === null) return
    const rows = Array.from(
      navigation.querySelectorAll<HTMLElement>('[data-conversation-rail-row]'),
    )
    const changedIndex = rows.findIndex(
      (row) => row.dataset.conversationRailRow === conversationId,
    )
    const candidateRows =
      changedIndex < 0 ? [] : [rows[changedIndex + 1], rows[changedIndex - 1]]
    const target = candidateRows
      .filter((row): row is HTMLElement => row !== undefined)
      .map((row) =>
        row.querySelector<HTMLElement>(
          '[data-conversation-rail-primary-action]',
        ),
      )
      .find((action): action is HTMLElement => action !== null)

    window.requestAnimationFrame(() => {
      if (target?.isConnected) target.focus()
      else navigation.focus()
    })
  }

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
        aria-label="搜索会话标题或你说过的内容"
        placeholder="搜索标题或历史提问"
        autoComplete="off"
        maxLength={256}
        spellCheck={false}
        containerClassName="mt-1.5 px-4"
        className="h-9 bg-surface-inset text-sm"
        data-conversation-rail-search-input
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
        <nav
          ref={railNavigationRef}
          aria-label="会话历史"
          className="px-3 pb-3"
          tabIndex={-1}
        >
          {currentArchivedConversation === undefined ? null : (
            <section aria-labelledby={`${headingId}-archived-current`}>
              <div className="flex h-7 items-center gap-2 px-1 text-text-secondary">
                <Archive aria-hidden="true" className="size-4" />
                <h3
                  id={`${headingId}-archived-current`}
                  className="text-xs font-medium"
                >
                  已归档
                </h3>
              </div>
              <ul className="mt-2 mb-4">
                <ConversationRailRow
                  conversation={currentArchivedConversation}
                  selected
                  projectId={projectId}
                  rowRef={selectedRowRef}
                  onMembershipChanged={focusAfterMembershipChange}
                  onUnarchived={() => undefined}
                />
              </ul>
            </section>
          )}
          {durableSearchActive ? (
            durableSearchPending ? (
              <RailSearchStatus>正在搜索完整会话历史…</RailSearchStatus>
            ) : (
              <ConversationRailSearchResults
                currentConversation={currentConversation}
                currentConversationId={currentConversationId}
                filter={filter}
                headingId={headingId}
                projectId={projectId}
                query={debouncedQuery}
                renderItem={(item) => (
                  <ConversationRailRow
                    key={item.conversation.id}
                    conversation={item.conversation}
                    matchDescription={item.matchDescription}
                    selected={item.selected}
                    projectId={projectId}
                    rowRef={item.selected ? selectedRowRef : undefined}
                    targetTurnId={item.targetTurnId}
                    onArchived={(updated) => {
                      if (updated.conversationId === currentConversationId) {
                        onArchived?.(updated)
                      }
                    }}
                    onMembershipChanged={item.onMembershipChanged}
                  />
                )}
              />
            )
          ) : visibleGroups.length > 0 ? (
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
                          projectId={projectId}
                          rowRef={
                            conversation.id === currentConversationId
                              ? selectedRowRef
                              : undefined
                          }
                          onArchived={(updated) => {
                            if (
                              updated.conversationId === currentConversationId
                            ) {
                              onArchived?.(updated)
                            }
                          }}
                          onMembershipChanged={focusAfterMembershipChange}
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

          {projectId === undefined ? null : (
            <Button
              asChild
              variant="ghost"
              className="mt-4 h-[var(--layout-sidebar-context-item-height)] w-full justify-start gap-2.5 border-transparent bg-transparent px-3 text-sm text-text-secondary hover:bg-surface-muted/60 hover:text-text-primary"
            >
              <Link
                to="/projects/$projectId/conversations"
                params={{ projectId }}
                search={{ view: 'archived' }}
              >
                <Archive aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-left">
                  查看已归档会话
                </span>
              </Link>
            </Button>
          )}
        </nav>
      </ScrollArea>
    </aside>
  )
}
