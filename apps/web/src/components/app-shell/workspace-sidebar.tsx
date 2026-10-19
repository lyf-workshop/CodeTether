import {
  useId,
  useState,
  type ComponentPropsWithoutRef,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Inbox,
  Monitor,
  Pin,
  Plus,
  Server,
  Settings,
  SquarePen,
} from 'lucide-react'

import {
  Button,
  CodeTetherMark,
  IconButton,
  Separator,
  cn,
} from '@codetether/ui'
import type {
  ConversationSummary,
  MachineId,
  MachineSummary,
  ProjectId,
  ProjectRecord,
} from '@codetether/protocol'

import {
  useHostConnectionState,
  useHostRuntime,
} from '../../runtime/host/host-runtime-hooks'
import { conversationListQueryOptions } from '../../runtime/host/conversation-list-query'
import { machineListQueryOptions } from '../../runtime/host/machine-query'
import { projectListQueryOptions } from '../../runtime/host/project-query'
import { formatInboxAttentionBadge } from '../inbox/inbox-model'
import { AddRemoteMachineDialog } from '../machines/add-remote-machine-dialog'
import {
  formatMachineLastSeen,
  machineConnectionStateLabel,
} from '../machines/machine-presentation'
import {
  emptyWorkspaceTreeExpansion,
  revealWorkspacePath,
  toggleWorkspaceMachine,
  toggleWorkspaceProject,
  workspaceConversationStatusLabel,
  workspaceDeviceGroups,
  workspaceLocationConversations,
  workspaceProviderPresentation,
  type WorkspaceDeviceGroup,
  type WorkspaceProjectEntry,
} from './workspace-sidebar-model'

export interface WorkspaceSidebarProps extends Omit<
  ComponentPropsWithoutRef<'aside'>,
  'children'
> {
  currentConversationId?: string
  currentConversation?: ConversationSummary
  currentPath: string
  currentProjectId?: ProjectId
  currentMachineId?: MachineId
  inboxAttentionCount?: number
  onAddProject?: (machineId: MachineId) => void
  onNewConversation: (
    project: ProjectRecord | undefined,
    trigger: HTMLButtonElement,
    machineId?: MachineId,
  ) => void
  onSettingsClick?: (event: MouseEvent<HTMLAnchorElement>) => void
}

export function WorkspaceSidebar({
  currentConversationId,
  currentConversation,
  currentPath,
  currentProjectId,
  currentMachineId,
  inboxAttentionCount = 0,
  onAddProject,
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
  const machinesQuery = useQuery({
    ...machineListQueryOptions(runtime),
    enabled: connectionState === 'connected',
  })
  const activeProjectId = currentConversation?.projectId ?? currentProjectId
  const activeProject = projectsQuery.data?.find(
    (project) => project.projectId === activeProjectId,
  )
  const activeMachineId =
    currentConversation?.machineId ??
    currentMachineId ??
    (activeProject?.locations.length === 1
      ? activeProject.locations[0]?.machineId
      : undefined)
  const [expansion, setExpansion] = useState(emptyWorkspaceTreeExpansion)
  const revealedExpansion = revealWorkspacePath(
    expansion,
    activeMachineId,
    activeProjectId,
  )
  if (revealedExpansion !== expansion) setExpansion(revealedExpansion)
  const groups = workspaceDeviceGroups(
    machinesQuery.data ?? [],
    projectsQuery.data ?? [],
  )
  const pending =
    projectsQuery.data === undefined || machinesQuery.data === undefined
  const failed = projectsQuery.isError || machinesQuery.isError

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
        className="flex h-(--layout-topbar-height) shrink-0 items-center gap-2 px-4"
      >
        <CodeTetherMark />
        <span className="truncate text-md font-semibold">CodeTether</span>
      </div>
      <div className="shrink-0 px-3 pt-3 pb-2">
        <Button
          type="button"
          size="sm"
          className="h-9 w-full justify-start gap-2 px-3"
          onClick={(event) =>
            onNewConversation(
              activeProject,
              event.currentTarget,
              activeMachineId,
            )
          }
        >
          <SquarePen aria-hidden="true" />
          <span className="truncate">新建会话</span>
        </Button>
        <nav aria-label="全局导航" className="mt-2 space-y-0.5">
          <WorkspaceNavLink
            currentPath={currentPath}
            label="待处理"
            to="/inbox"
            icon={Inbox}
            attentionCount={inboxAttentionCount}
          />
        </nav>
      </div>
      <section
        className="flex min-h-0 flex-1 flex-col"
        aria-label="设备、项目和会话"
      >
        <div className="flex shrink-0 items-center gap-2 px-4 pt-5 pb-1.5 text-xs font-semibold text-text-muted">
          <Link
            to="/devices"
            aria-current={currentPath === '/devices' ? 'page' : undefined}
            className="flex-1 rounded-xs outline-none hover:text-text-primary focus-visible:ring-2 focus-visible:ring-ring"
          >
            设备
          </Link>
          <AddRemoteMachineDialog
            trigger={
              <IconButton
                type="button"
                variant="ghost"
                size="sm"
                label="添加设备"
                className="size-6"
                disabled={connectionState !== 'connected'}
              >
                <Plus aria-hidden="true" />
              </IconButton>
            }
          />
        </div>
        <div
          data-workspace-project-scroller
          className="min-h-0 flex-1 overflow-y-auto px-2 pb-3"
        >
          {pending ? (
            <WorkspaceTreeBoundary
              connectionState={connectionState}
              failed={failed}
              onRetry={() => {
                runtime.retry()
                if (connectionState === 'connected') {
                  void machinesQuery.refetch()
                  void projectsQuery.refetch()
                }
              }}
            />
          ) : groups.length === 0 ? (
            <p className="px-2 py-4 text-sm text-text-muted">还没有设备</p>
          ) : (
            <>
              {connectionState !== 'connected' ? (
                <p role="status" className="px-2 py-2 text-xs text-text-muted">
                  连接中断，显示上次读取的设备和项目。
                </p>
              ) : null}
              <div className="space-y-1">
                {groups.map((group) => (
                  <WorkspaceDeviceSection
                    key={group.machine.machineId}
                    group={group}
                    active={activeMachineId === group.machine.machineId}
                    expanded={
                      !revealedExpansion.collapsedMachineIds.has(
                        group.machine.machineId,
                      )
                    }
                    onExpandedChange={() =>
                      setExpansion(
                        toggleWorkspaceMachine(
                          revealedExpansion,
                          group.machine.machineId,
                        ),
                      )
                    }
                    onAddProject={onAddProject}
                  >
                    {group.projects.map((entry) => (
                      <WorkspaceProjectSection
                        key={entry.key}
                        entry={entry}
                        machine={group.machine}
                        active={
                          activeProjectId === entry.project.projectId &&
                          activeMachineId === group.machine.machineId
                        }
                        currentConversationId={currentConversationId}
                        currentConversation={currentConversation}
                        expanded={revealedExpansion.expandedProjectKeys.has(
                          entry.key,
                        )}
                        onExpandedChange={() =>
                          setExpansion(
                            toggleWorkspaceProject(
                              revealedExpansion,
                              entry.key,
                            ),
                          )
                        }
                        onNewConversation={onNewConversation}
                      />
                    ))}
                  </WorkspaceDeviceSection>
                ))}
              </div>
            </>
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

function WorkspaceDeviceSection({
  group,
  active,
  expanded,
  onExpandedChange,
  onAddProject,
  children,
}: {
  group: WorkspaceDeviceGroup
  active: boolean
  expanded: boolean
  onExpandedChange: () => void
  onAddProject?: WorkspaceSidebarProps['onAddProject']
  children: ReactNode
}) {
  const contentId = useId()
  const { machine, projects } = group
  const connectionState = useHostConnectionState()
  const Icon = machine.kind === 'local' ? Monitor : Server
  const canAddProject =
    connectionState === 'connected' &&
    machine.availability === 'available' &&
    (machine.connectionState === 'local' ||
      machine.connectionState === 'online') &&
    machine.capabilities.projectAccess
  const status =
    machine.connectionState === 'local'
      ? '这台电脑'
      : machineConnectionStateLabel(machine.connectionState)
  const lastSeen = formatMachineLastSeen(machine.lastSeenAt)
  return (
    <div data-workspace-machine={machine.machineId}>
      <div
        data-state={active ? 'selected' : undefined}
        className={cn(
          'group/device flex h-[var(--tree-device-h)] min-w-0 items-center rounded-sm px-1',
          active ? 'bg-surface-muted' : 'hover:bg-surface-muted/55',
        )}
      >
        <IconButton
          type="button"
          size="sm"
          variant="ghost"
          className="size-5 shrink-0 text-text-muted"
          aria-controls={contentId}
          aria-expanded={expanded}
          label={`${expanded ? '折叠' : '展开'}设备：${machine.displayName}`}
          onClick={onExpandedChange}
        >
          {expanded ? (
            <ChevronDown aria-hidden="true" />
          ) : (
            <ChevronRight aria-hidden="true" />
          )}
        </IconButton>
        <Link
          to="/devices/$machineId"
          params={{ machineId: machine.machineId }}
          aria-current={active ? 'location' : undefined}
          title={`${machine.displayName} · ${status}${lastSeen === undefined ? '' : ` · 上次在线 ${lastSeen}`}`}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-xs text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <Icon
            aria-hidden="true"
            className="size-4 shrink-0 text-text-muted"
          />
          <span className="truncate">{machine.displayName}</span>
        </Link>
        {canAddProject && onAddProject !== undefined ? (
          <IconButton
            type="button"
            size="sm"
            variant="ghost"
            label={`在 ${machine.displayName} 上添加项目`}
            className="size-6 shrink-0 text-text-muted opacity-0 group-hover/device:opacity-100 group-focus-within/device:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none"
            onClick={() => onAddProject(machine.machineId)}
          >
            <Plus aria-hidden="true" />
          </IconButton>
        ) : machine.connectionState !== 'local' &&
          machine.connectionState !== 'online' ? (
          <span
            className="shrink-0 text-2xs font-normal text-text-muted"
            title={lastSeen === undefined ? status : `上次在线 ${lastSeen}`}
          >
            {status}
          </span>
        ) : null}
      </div>
      {expanded ? (
        <div id={contentId} className="ml-5">
          {projects.length === 0 ? (
            <p className="flex h-[var(--tree-secondary-h)] items-center px-2 text-xs text-text-muted">
              还没有项目
            </p>
          ) : (
            children
          )}
        </div>
      ) : null}
    </div>
  )
}

function WorkspaceProjectSection({
  entry,
  machine,
  active,
  currentConversationId,
  currentConversation,
  expanded,
  onExpandedChange,
  onNewConversation,
}: {
  entry: WorkspaceProjectEntry
  machine: MachineSummary
  active: boolean
  currentConversationId?: string
  currentConversation?: ConversationSummary
  expanded: boolean
  onExpandedChange: () => void
  onNewConversation: WorkspaceSidebarProps['onNewConversation']
}) {
  const runtime = useHostRuntime()
  const connectionState = useHostConnectionState()
  const contentId = useId()
  const [showAll, setShowAll] = useState(false)
  const { project, location } = entry
  const conversationsQuery = useQuery({
    ...conversationListQueryOptions(runtime, project.projectId),
    enabled: expanded && connectionState === 'connected',
  })
  const conversations = workspaceLocationConversations(
    conversationsQuery.data ?? [],
    project.projectId,
    machine.machineId,
    showAll,
    currentConversation,
  )
  const bounded = (conversationsQuery.data?.length ?? 0) >= 100
  const machineReady =
    machine.availability === 'available' &&
    (machine.connectionState === 'local' ||
      machine.connectionState === 'online')
  const unavailableReason = !machineReady
    ? machineConnectionStateLabel(machine.connectionState)
    : !machine.capabilities.providerExecution
      ? '不能运行'
      : location.availability !== 'available'
        ? '无法访问'
        : undefined
  const canCreate =
    unavailableReason === undefined &&
    machine.capabilities.projectAccess &&
    connectionState === 'connected'
  return (
    <div
      data-workspace-project={project.projectId}
      data-workspace-location={entry.key}
      data-active={active || undefined}
    >
      <div
        className={cn(
          'group/project flex h-[var(--tree-project-h)] min-w-0 items-center rounded-sm px-1',
          active ? 'bg-surface-muted' : 'hover:bg-surface-muted/55',
        )}
      >
        <IconButton
          type="button"
          size="sm"
          variant="ghost"
          aria-controls={contentId}
          aria-expanded={expanded}
          label={`${expanded ? '折叠' : '展开'}项目：${project.name}`}
          className="size-5 shrink-0 text-text-muted"
          onClick={() => {
            if (expanded) setShowAll(false)
            onExpandedChange()
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
          search={{ machineId: machine.machineId }}
          aria-current={active ? 'location' : undefined}
          title={location.rootPath}
          className={cn(
            'min-w-0 flex-1 truncate rounded-xs px-0.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
            unavailableReason === undefined
              ? 'text-text-primary'
              : 'text-text-muted',
          )}
        >
          {project.name}
        </Link>
        {canCreate ? (
          <IconButton
            type="button"
            size="sm"
            variant="ghost"
            label={`在 ${project.name} 中新建会话`}
            className="size-6 shrink-0 text-text-muted opacity-0 group-hover/project:opacity-100 group-focus-within/project:opacity-100 focus-visible:opacity-100"
            onClick={(event) =>
              onNewConversation(project, event.currentTarget, machine.machineId)
            }
          >
            <Plus aria-hidden="true" />
          </IconButton>
        ) : machineReady && unavailableReason !== undefined ? (
          <span className="shrink-0 text-2xs text-text-muted">
            {unavailableReason}
          </span>
        ) : null}
      </div>
      {expanded ? (
        <div id={contentId}>
          {conversationsQuery.data === undefined &&
          conversations.visible.length === 0 ? (
            <p role="status" className="px-2 py-2 text-xs text-text-muted">
              {connectionState === 'connected' && !conversationsQuery.isError
                ? '正在加载会话…'
                : '暂时无法读取会话'}
            </p>
          ) : conversations.visible.length === 0 ? (
            <p className="flex h-[var(--tree-secondary-h)] items-center px-2 text-xs text-text-muted">
              还没有会话
            </p>
          ) : (
            <ul aria-label={`${machine.displayName} · ${project.name} 会话`}>
              {conversations.visible.map((conversation) => (
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
          {conversations.hasMore ? (
            <button
              type="button"
              className="flex h-[var(--tree-secondary-h)] w-full items-center rounded-sm px-2 text-left text-xs text-text-muted outline-none hover:bg-surface-muted/55 focus-visible:ring-2 focus-visible:ring-ring/60"
              onClick={() => setShowAll((current) => !current)}
            >
              {showAll
                ? '收起'
                : bounded
                  ? `显示已读取的 ${conversations.activeCount} 个`
                  : `显示全部 ${conversations.activeCount} 个`}
            </button>
          ) : null}
          {bounded && showAll ? (
            <p className="px-2 py-1 text-2xs text-text-muted">
              只读取项目最近 100 个会话；更早的会话请使用项目内搜索。
            </p>
          ) : null}
          <Link
            to="/projects/$projectId/conversations"
            params={{ projectId: project.projectId }}
            search={{ view: 'archived', machineId: machine.machineId }}
            className="flex h-[var(--tree-secondary-h)] items-center gap-2 rounded-sm px-2 text-xs text-text-muted outline-none hover:bg-surface-muted/55 focus-visible:ring-2 focus-visible:ring-ring/60"
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
  const status = workspaceConversationStatusLabel(conversation.status)
  const archived = conversation.archivedAt !== undefined
  return (
    <li className="min-w-0">
      <Link
        to="/conversations/$conversationId"
        params={{ conversationId: conversation.conversationId }}
        aria-current={selected ? 'page' : undefined}
        data-selected={selected || undefined}
        data-provider={conversation.provider}
        title={`${conversation.title} · ${provider.label}${status === undefined ? '' : ` · ${status}`}${archived ? ' · 已归档' : ''}`}
        className={cn(
          'flex h-[var(--tree-conversation-h)] min-w-0 items-center gap-3 rounded-sm px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
          selected
            ? 'bg-surface-muted font-medium text-text-primary'
            : 'text-text-secondary hover:bg-surface-muted/55 hover:text-text-primary',
        )}
      >
        <span
          role={status === undefined ? undefined : 'img'}
          aria-label={status}
          aria-hidden={status === undefined ? true : undefined}
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            conversation.status === 'running'
              ? 'bg-primary motion-safe:animate-pulse'
              : conversation.status === 'waiting'
                ? 'bg-warning'
                : conversation.status === 'failed'
                  ? 'bg-danger'
                  : 'bg-transparent',
          )}
        />
        <span className="min-w-0 flex-1 truncate">{conversation.title}</span>
        {archived ? (
          <Archive
            aria-label="当前已归档"
            className="size-3 shrink-0 text-text-muted"
          />
        ) : null}
        {conversation.pinnedAt !== undefined ? (
          <Pin
            aria-label="已置顶"
            className="size-3 shrink-0 text-text-muted"
          />
        ) : null}
      </Link>
    </li>
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
  to: '/inbox' | '/devices' | '/settings'
}) {
  const selected = currentPath === to || currentPath.startsWith(`${to}/`)
  const badge = formatInboxAttentionBadge(attentionCount)
  return (
    <Link
      to={to}
      aria-label={
        attentionCount > 0 ? `${label}，${attentionCount} 项待处理` : label
      }
      aria-current={selected ? 'page' : undefined}
      onClick={onClick}
      className={cn(
        'flex h-9 min-w-0 items-center gap-2.5 rounded-sm px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
        selected
          ? 'bg-surface-muted text-text-primary'
          : 'text-text-secondary hover:bg-surface-muted/55 hover:text-text-primary',
      )}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge === undefined ? null : (
        <span
          aria-hidden="true"
          className="grid h-5 min-w-5 place-items-center rounded-full bg-primary-muted px-1 text-2xs font-semibold tabular-nums text-primary"
        >
          {badge}
        </span>
      )}
    </Link>
  )
}

function WorkspaceTreeBoundary({
  connectionState,
  failed,
  onRetry,
}: {
  connectionState: ReturnType<typeof useHostConnectionState>
  failed: boolean
  onRetry: () => void
}) {
  if (connectionState === 'connected' && !failed)
    return (
      <p role="status" className="px-2 py-4 text-sm text-text-muted">
        正在加载设备和项目…
      </p>
    )
  return (
    <div className="px-2 py-3">
      <p role="status" className="text-xs text-text-muted">
        设备和项目暂时不可用
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
