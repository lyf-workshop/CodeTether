import {
  useId,
  useState,
  type ComponentPropsWithoutRef,
  type MouseEvent,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  Archive,
  Bot,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleX,
  FolderKanban,
  Inbox,
  LoaderCircle,
  Monitor,
  Plus,
  Settings,
  Sparkles,
} from 'lucide-react'

import {
  Button,
  IconButton,
  Separator,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
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
import { projectListQueryOptions } from '../../runtime/host/project-query'
import { formatInboxAttentionBadge } from '../inbox/inbox-model'
import {
  hasMoreWorkspaceConversations,
  visibleWorkspaceConversations,
  workspaceConversationStatusLabel,
  workspaceProviderPresentation,
} from './workspace-sidebar-model'

export interface WorkspaceSidebarProps extends Omit<
  ComponentPropsWithoutRef<'aside'>,
  'children'
> {
  currentConversationId?: string
  currentConversation?: ConversationSummary
  currentPath: string
  currentProjectId?: ProjectId
  inboxAttentionCount?: number
  onNewConversation: (
    project: ProjectRecord | undefined,
    trigger: HTMLButtonElement,
  ) => void
  onSettingsClick?: (event: MouseEvent<HTMLAnchorElement>) => void
}

export function WorkspaceSidebar({
  currentConversationId,
  currentConversation,
  currentPath,
  currentProjectId,
  inboxAttentionCount = 0,
  onNewConversation,
  onSettingsClick,
  className,
  'aria-label': ariaLabel = '工作区导航',
  ...props
}: WorkspaceSidebarProps) {
  const runtime = useHostRuntime()
  const connectionState = useHostConnectionState()
  const projectsQuery = useQuery({
    ...projectListQueryOptions(runtime),
    enabled: connectionState === 'connected',
  })
  const [projectExpansion, setProjectExpansion] = useState<{
    activeProjectId: ProjectId | undefined
    expandedProjectId: ProjectId | undefined
  }>(() => ({
    activeProjectId: currentProjectId,
    expandedProjectId: currentProjectId,
  }))
  const expandedProjectId =
    projectExpansion.activeProjectId === currentProjectId
      ? projectExpansion.expandedProjectId
      : currentProjectId

  return (
    <aside
      aria-label={ariaLabel}
      data-slot="workspace-sidebar"
      className={cn(
        'flex h-full min-h-0 w-full min-w-0 shrink-0 flex-col overflow-hidden border-r border-border bg-navigation text-text-primary',
        className,
      )}
      {...props}
    >
      <div
        data-slot="workspace-sidebar-brand"
        className="flex h-12 shrink-0 items-center gap-3 px-3"
      >
        <span
          aria-hidden="true"
          className="grid size-[var(--layout-brand-mark-size)] shrink-0 place-items-center rounded-sm border border-primary bg-primary text-sm font-semibold text-text-inverse"
        >
          C
        </span>
        <span className="truncate text-brand font-semibold text-text-primary">
          CodeTether
        </span>
      </div>
      <div className="shrink-0 px-3 pt-3 pb-2">
        <div className="flex min-w-0 items-center">
          <Button
            type="button"
            size="sm"
            className="h-9 min-w-0 flex-1 justify-start gap-2 px-3"
            onClick={(event) =>
              onNewConversation(undefined, event.currentTarget)
            }
          >
            <Plus aria-hidden="true" />
            <span className="truncate">新建会话</span>
          </Button>
        </div>
        <nav aria-label="全局导航" className="mt-2 space-y-0.5">
          <WorkspaceNavLink
            currentPath={currentPath}
            label="收件箱"
            to="/inbox"
            icon={Inbox}
            attentionCount={inboxAttentionCount}
          />
          <WorkspaceNavLink
            currentPath={currentPath}
            label="电脑"
            to="/machines"
            icon={Monitor}
          />
        </nav>
      </div>

      <Separator />

      <section className="flex min-h-0 flex-1 flex-col" aria-label="项目和会话">
        <div className="flex h-10 shrink-0 items-center justify-between px-3">
          <Link
            to="/projects"
            aria-current={currentPath === '/projects' ? 'page' : undefined}
            className="flex min-w-0 items-center gap-2 rounded-xs px-1 text-xs font-semibold text-text-muted outline-none hover:text-text-primary focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <FolderKanban aria-hidden="true" className="size-3.5" />
            <span>项目</span>
          </Link>
        </div>

        <div
          data-workspace-project-scroller
          className="min-h-0 flex-1 overflow-y-auto px-2 pb-3"
        >
          {projectsQuery.data === undefined ? (
            <ProjectListBoundary
              connectionState={connectionState}
              failed={projectsQuery.isError}
              onRetry={() => void projectsQuery.refetch()}
            />
          ) : projectsQuery.data.length === 0 ? (
            <p className="px-2 py-4 text-sm text-text-muted">还没有项目</p>
          ) : (
            <div className="space-y-0.5">
              {projectsQuery.data.map((project) => (
                <WorkspaceProjectSection
                  key={project.projectId}
                  project={project}
                  active={project.projectId === currentProjectId}
                  currentConversationId={currentConversationId}
                  currentConversation={
                    currentConversation?.projectId === project.projectId
                      ? currentConversation
                      : undefined
                  }
                  expanded={project.projectId === expandedProjectId}
                  onExpandedChange={(expanded) =>
                    setProjectExpansion({
                      activeProjectId: currentProjectId,
                      expandedProjectId: expanded
                        ? project.projectId
                        : undefined,
                    })
                  }
                  onNewConversation={onNewConversation}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <Separator />
      <div className="shrink-0 p-3">
        <WorkspaceNavLink
          currentPath={currentPath}
          label="设置"
          to="/settings"
          icon={Settings}
          onClick={onSettingsClick}
        />
      </div>
    </aside>
  )
}

interface WorkspaceProjectSectionProps {
  active: boolean
  currentConversationId?: string
  currentConversation?: ConversationSummary
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  onNewConversation: WorkspaceSidebarProps['onNewConversation']
  project: ProjectRecord
}

function WorkspaceProjectSection({
  active,
  currentConversationId,
  currentConversation,
  expanded,
  onExpandedChange,
  onNewConversation,
  project,
}: WorkspaceProjectSectionProps) {
  const runtime = useHostRuntime()
  const connectionState = useHostConnectionState()
  const contentId = useId()
  const [showAll, setShowAll] = useState(false)
  const conversationsQuery = useQuery({
    ...conversationListQueryOptions(runtime, project.projectId),
    enabled: expanded && connectionState === 'connected',
  })
  const conversations = (conversationsQuery.data ?? []).filter(
    (conversation) => conversation.projectId === project.projectId,
  )
  const visibleConversations = visibleWorkspaceConversations(
    conversations,
    showAll,
  )
  const currentArchivedConversation =
    currentConversation?.archivedAt === undefined
      ? undefined
      : currentConversation

  return (
    <div data-workspace-project={project.projectId} data-active={active}>
      <div
        className={cn(
          'group/project flex h-9 min-w-0 items-center gap-0.5 rounded-sm px-1',
          active ? 'bg-surface-muted/70' : 'hover:bg-surface-muted/45',
        )}
      >
        <IconButton
          type="button"
          size="sm"
          variant="ghost"
          aria-controls={contentId}
          aria-expanded={expanded}
          label={`${expanded ? '折叠' : '展开'}项目：${project.name}`}
          className="size-7 shrink-0 text-text-muted"
          onClick={() => {
            if (expanded) setShowAll(false)
            onExpandedChange(!expanded)
          }}
        >
          {expanded ? (
            <ChevronDown aria-hidden="true" />
          ) : (
            <ChevronRight aria-hidden="true" />
          )}
        </IconButton>
        <Link
          to="/projects/$projectId"
          params={{ projectId: project.projectId }}
          aria-current={active ? 'location' : undefined}
          title={project.name}
          className={cn(
            'min-w-0 flex-1 truncate rounded-xs px-1 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
            active
              ? 'font-semibold text-text-primary'
              : 'font-medium text-text-secondary hover:text-text-primary',
          )}
        >
          {project.name}
        </Link>
        <IconButton
          type="button"
          size="sm"
          variant="ghost"
          label={`在 ${project.name} 中新建会话`}
          className="size-7 shrink-0 text-text-muted hover:text-text-primary"
          onClick={(event) => onNewConversation(project, event.currentTarget)}
        >
          <Plus aria-hidden="true" />
        </IconButton>
      </div>

      {expanded ? (
        <div id={contentId} className="ml-3 border-l border-border/80 pl-2">
          {conversationsQuery.data === undefined ? (
            <p role="status" className="px-2 py-2 text-xs text-text-muted">
              {connectionState === 'connected' && !conversationsQuery.isError
                ? '正在加载会话…'
                : '暂时无法读取会话'}
            </p>
          ) : visibleConversations.length === 0 ? (
            <p className="px-2 py-2 text-xs text-text-muted">还没有会话</p>
          ) : (
            <ul
              className="space-y-0.5 py-1"
              aria-label={`${project.name} 会话`}
            >
              {visibleConversations.map((conversation) => (
                <WorkspaceConversationRow
                  key={conversation.conversationId}
                  conversation={conversation}
                  selected={
                    conversation.conversationId === currentConversationId
                  }
                />
              ))}
            </ul>
          )}

          {hasMoreWorkspaceConversations(conversations) ? (
            <button
              type="button"
              className="mx-1 flex h-7 w-[calc(100%-0.5rem)] items-center rounded-sm px-2 text-left text-xs text-text-muted outline-none hover:bg-surface-muted/50 hover:text-text-primary focus-visible:ring-2 focus-visible:ring-ring/60"
              onClick={() => setShowAll((current) => !current)}
            >
              {showAll ? '收起' : '展开显示'}
            </button>
          ) : null}

          {currentArchivedConversation === undefined ? null : (
            <div className="mt-1 border-t border-border/70 pt-1">
              <p className="px-2 py-1 text-2xs font-medium text-text-muted">
                当前已归档
              </p>
              <ul aria-label={`${project.name} 当前已归档会话`}>
                <WorkspaceConversationRow
                  conversation={currentArchivedConversation}
                  selected={
                    currentArchivedConversation.conversationId ===
                    currentConversationId
                  }
                />
              </ul>
            </div>
          )}

          <Link
            to="/projects/$projectId/conversations"
            params={{ projectId: project.projectId }}
            search={{ view: 'archived' }}
            className="mx-1 flex h-7 items-center gap-2 rounded-sm px-2 text-xs text-text-muted outline-none hover:bg-surface-muted/50 hover:text-text-primary focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <Archive aria-hidden="true" className="size-3.5" />
            <span className="truncate">查看已归档会话</span>
          </Link>
        </div>
      ) : null}
    </div>
  )
}

function WorkspaceConversationRow({
  conversation,
  selected,
}: {
  conversation: ConversationSummary
  selected: boolean
}) {
  const provider = workspaceProviderPresentation(conversation.provider)
  const statusLabel = workspaceConversationStatusLabel(conversation.status)

  return (
    <li className="min-w-0">
      <Link
        to="/conversations/$conversationId"
        params={{ conversationId: conversation.conversationId }}
        aria-current={selected ? 'page' : undefined}
        data-selected={selected || undefined}
        title={conversation.title}
        className={cn(
          'group/conversation flex h-8 min-w-0 items-center gap-2 rounded-sm px-2 text-sm outline-none transition-colors motion-reduce:transition-none',
          'focus-visible:ring-2 focus-visible:ring-ring/60',
          selected
            ? 'bg-primary-muted font-medium text-text-primary hover:bg-primary-muted'
            : 'text-text-secondary hover:bg-surface-muted/55 hover:text-text-primary',
        )}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              role="img"
              aria-label={provider.label}
              data-provider={conversation.provider}
              className={cn(
                'grid size-5 shrink-0 place-items-center rounded-xs border bg-surface-inset',
                provider.tone === 'codex'
                  ? 'border-agent-codex/70 text-agent-codex'
                  : 'border-agent-claude/70 text-agent-claude',
              )}
            >
              {provider.icon === 'bot' ? (
                <Bot aria-hidden="true" className="size-3" />
              ) : (
                <Sparkles aria-hidden="true" className="size-3" />
              )}
            </span>
          </TooltipTrigger>
          <TooltipContent side="right">Agent: {provider.label}</TooltipContent>
        </Tooltip>
        <span className="min-w-0 flex-1 truncate">{conversation.title}</span>
        {statusLabel === undefined ? null : (
          <ConversationStatusIndicator
            label={statusLabel}
            status={conversation.status}
          />
        )}
      </Link>
    </li>
  )
}

function ConversationStatusIndicator({
  label,
  status,
}: {
  label: string
  status: ConversationSummary['status']
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={label}
          className={cn(
            'grid size-4 shrink-0 place-items-center',
            status === 'waiting'
              ? 'text-warning'
              : status === 'failed'
                ? 'text-danger'
                : 'text-primary',
          )}
        >
          {status === 'running' ? (
            <LoaderCircle
              aria-hidden="true"
              className="size-3 animate-spin motion-reduce:animate-none"
            />
          ) : status === 'waiting' ? (
            <CircleAlert aria-hidden="true" className="size-3" />
          ) : (
            <CircleX aria-hidden="true" className="size-3" />
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

function WorkspaceNavLink({
  attentionCount = 0,
  currentPath,
  icon: Icon,
  label,
  onClick,
  to,
}: {
  attentionCount?: number
  currentPath: string
  icon: typeof Inbox
  label: string
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void
  to: '/inbox' | '/machines' | '/settings'
}) {
  const selected = currentPath === to || currentPath.startsWith(`${to}/`)
  const attentionLabel = formatInboxAttentionBadge(attentionCount)
  const accessibleLabel =
    attentionCount > 0 ? `${label}，${attentionCount} 项待处理` : label

  return (
    <Link
      to={to}
      aria-label={accessibleLabel}
      aria-current={selected ? 'page' : undefined}
      onClick={onClick}
      className={cn(
        'flex h-9 min-w-0 items-center gap-2.5 rounded-sm px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
        selected
          ? 'bg-primary-muted text-text-primary'
          : 'text-text-secondary hover:bg-surface-muted/55 hover:text-text-primary',
      )}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {attentionLabel === undefined ? null : (
        <span
          aria-hidden="true"
          className="grid h-5 min-w-5 place-items-center rounded-full border border-primary/30 bg-primary-muted px-1 text-2xs font-semibold tabular-nums text-primary"
        >
          {attentionLabel}
        </span>
      )}
    </Link>
  )
}

function ProjectListBoundary({
  connectionState,
  failed,
  onRetry,
}: {
  connectionState: ReturnType<typeof useHostConnectionState>
  failed: boolean
  onRetry: () => void
}) {
  if (connectionState === 'connected' && !failed) {
    return (
      <p role="status" className="px-2 py-4 text-sm text-text-muted">
        正在加载项目…
      </p>
    )
  }

  return (
    <div className="px-2 py-3">
      <p role="status" className="text-xs leading-relaxed text-text-muted">
        项目暂时不可用
      </p>
      <button
        type="button"
        className="mt-1 rounded-xs text-xs text-text-secondary outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/60"
        onClick={onRetry}
      >
        重试
      </button>
    </div>
  )
}
