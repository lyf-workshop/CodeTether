import { type ComponentPropsWithoutRef, type MouseEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  Inbox,
  Plus,
  Search,
  CircleUserRound,
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
  ProjectId,
  ProjectRecord,
} from '@codetether/protocol'
import {
  useHostConnectionState,
  useHostRuntime,
} from '../../runtime/host/host-runtime-hooks'
import { machineListQueryOptions } from '../../runtime/host/machine-query'
import { projectListQueryOptions } from '../../runtime/host/project-query'
import { formatInboxAttentionBadge } from '../inbox/inbox-model'
import { useWorkspaceTreeExpansion } from './use-workspace-tree-expansion'
import {
  toggleWorkspaceMachine,
  toggleWorkspaceProject,
  workspaceDeviceGroups,
} from './workspace-sidebar-model'
import { WorkspaceDeviceSection } from './workspace-device-section'
import { WorkspaceProjectSection } from './workspace-project-section'

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
    mode?: 'fixed' | 'preselected',
  ) => void
  onSearch?: (event: MouseEvent<HTMLButtonElement>) => void
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
  onSearch,
  className,
  'aria-label': ariaLabel = '工作区导航',
  ...props
}: WorkspaceSidebarProps) {
  const runtime = useHostRuntime()
  const navigate = useNavigate()
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
  const { expansion: revealedExpansion, setExpansion } =
    useWorkspaceTreeExpansion(activeMachineId, activeProjectId)
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
        <span className="min-w-0 flex-1 truncate text-md font-semibold">
          CodeTether
        </span>
        {onSearch === undefined ? null : (
          <IconButton
            type="button"
            size="sm"
            variant="ghost"
            data-slot="workspace-sidebar-search"
            label="搜索，快捷键 Ctrl K 或 ⌘ K"
            aria-keyshortcuts="Meta+K Control+K"
            className="size-8 shrink-0"
            onClick={onSearch}
          >
            <Search aria-hidden="true" />
          </IconButton>
        )}
      </div>
      <div className="shrink-0 px-3 pt-3 pb-2">
        <Button
          type="button"
          data-slot="workspace-new-conversation"
          size="sm"
          className="h-9 w-full justify-start gap-2 px-3"
          onClick={(event) =>
            onNewConversation(
              activeProject,
              event.currentTarget,
              activeMachineId,
              'preselected',
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
          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            label="添加设备"
            className="size-6"
            disabled={connectionState !== 'connected'}
            onClick={() => {
              void navigate({ to: '/add' })
            }}
          >
            <Plus aria-hidden="true" />
          </IconButton>
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
      <div className="shrink-0 space-y-0.5 p-3">
        <Link
          to="/settings/$section"
          params={{ section: 'account' }}
          aria-current={
            currentPath === '/settings/account' ? 'page' : undefined
          }
          className="flex min-w-0 items-center gap-2 rounded-sm px-3 py-2 text-sm text-text-secondary outline-none hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CircleUserRound aria-hidden="true" className="size-4 shrink-0" />
          <span className="truncate">账号</span>
        </Link>
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
