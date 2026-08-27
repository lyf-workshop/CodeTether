import type { ComponentPropsWithoutRef } from 'react'
import { Link } from '@tanstack/react-router'
import {
  Activity,
  Bot,
  ChevronDown,
  FolderOpen,
  Inbox,
  Monitor,
  Settings,
  type LucideIcon,
} from 'lucide-react'

import {
  Button,
  Separator,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  agentDefinitions,
  cn,
  statusDefinitions,
  type AgentId,
  type ExecutionStatus,
} from '@codetether/ui'
import type { ProjectRecord } from '@codetether/protocol'

import { formatInboxAttentionBadge } from '../inbox/inbox-model'

type SidebarDestination =
  '/inbox' | '/activity' | '/projects' | '/agents' | '/machines' | '/settings'

interface SidebarNavItem {
  label: string
  to: SidebarDestination
  icon: LucideIcon
}

interface AgentPresence {
  agent: AgentId
}

const primaryNavItems = [
  { label: '收件箱', to: '/inbox', icon: Inbox },
  { label: '活动', to: '/activity', icon: Activity },
  { label: '项目', to: '/projects', icon: FolderOpen },
  { label: '智能体', to: '/agents', icon: Bot },
  { label: '机器', to: '/machines', icon: Monitor },
] as const satisfies readonly SidebarNavItem[]

const settingsNavItem = {
  label: '设置',
  to: '/settings',
  icon: Settings,
} as const satisfies SidebarNavItem

const agentPresences = [
  { agent: 'codex' },
  { agent: 'claude' },
  { agent: 'opencode' },
] as const satisfies readonly AgentPresence[]

function isCurrentRoute(currentPath: string, destination: SidebarDestination) {
  return (
    currentPath === destination || currentPath.startsWith(`${destination}/`)
  )
}

interface PresenceDotProps {
  label: string
  stateLabel?: string
  status: ExecutionStatus
}

function PresenceDot({ label, stateLabel, status }: PresenceDotProps) {
  const definition = statusDefinitions[status]

  return (
    <span
      role="img"
      aria-label={`${label}：${stateLabel ?? definition.label}`}
      data-status={status}
      className={cn(
        'size-2 shrink-0 rounded-full bg-current',
        definition.iconClassName,
        'motion-safe:animate-none',
      )}
    />
  )
}

interface SidebarLinkProps {
  attentionCount?: number
  currentPath: string
  item: SidebarNavItem
}

function SidebarLink({
  attentionCount = 0,
  currentPath,
  item,
}: SidebarLinkProps) {
  const selected = isCurrentRoute(currentPath, item.to)
  const Icon = item.icon
  const accessibleLabel =
    attentionCount > 0
      ? `${item.label}，${attentionCount} 项待处理`
      : item.label
  const attentionLabel = formatInboxAttentionBadge(attentionCount)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to={item.to}
          aria-label={accessibleLabel}
          aria-current={selected ? 'page' : undefined}
          data-selected={selected || undefined}
          className={cn(
            'group relative flex h-[var(--layout-sidebar-nav-item-height)] w-full min-w-0 items-center justify-center gap-[var(--layout-sidebar-nav-gap)] rounded-sm border px-2 text-md font-medium outline-none',
            'transition-colors duration-150 motion-reduce:transition-none',
            'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-navigation',
            'lg:justify-start',
            selected
              ? 'border-primary bg-primary-muted text-text-primary'
              : 'border-transparent text-text-secondary hover:border-border hover:bg-surface-muted hover:text-text-primary',
          )}
        >
          <Icon
            aria-hidden="true"
            className="size-4 shrink-0 text-text-secondary transition-colors duration-150 group-hover:text-text-primary motion-reduce:transition-none"
          />
          <span className="hidden min-w-0 flex-1 truncate lg:block">
            {item.label}
          </span>
          {attentionLabel !== undefined ? (
            <span
              aria-hidden="true"
              className="absolute top-1 right-1 grid h-4 min-w-4 place-items-center rounded-full border border-primary/30 bg-primary-muted px-1 text-2xs font-semibold tabular-nums text-primary lg:static lg:h-5 lg:min-w-5"
            >
              {attentionLabel}
            </span>
          ) : null}
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right" className="lg:hidden">
        {accessibleLabel}
      </TooltipContent>
    </Tooltip>
  )
}

export interface PrimarySidebarProps extends Omit<
  ComponentPropsWithoutRef<'aside'>,
  'children'
> {
  currentPath: string
  currentProject?: Pick<ProjectRecord, 'name' | 'projectId'>
  codexAvailable?: boolean
  inboxAttentionCount?: number
}

/** Shared desktop navigation with capability-backed Agent availability. */
export function PrimarySidebar({
  currentPath,
  currentProject,
  codexAvailable = false,
  inboxAttentionCount = 0,
  className,
  'aria-label': ariaLabel = '主导航',
  ...props
}: PrimarySidebarProps) {
  return (
    <aside
      aria-label={ariaLabel}
      data-slot="primary-sidebar"
      className={cn(
        'flex h-full min-h-0 w-[var(--layout-sidebar-collapsed-width)] shrink-0 flex-col overflow-hidden border-r border-border bg-navigation',
        'transition-[width] duration-200 motion-reduce:transition-none',
        'lg:w-[var(--layout-sidebar-width)]',
        className,
      )}
      {...props}
    >
      <div className="flex min-h-0 flex-1 flex-col px-[var(--layout-sidebar-inline-padding)] py-[var(--layout-sidebar-block-padding)]">
        <div>
          <h2 className="hidden px-2 text-xs font-semibold text-text-muted lg:block">
            工作区
          </h2>
          <nav aria-label="工作区" className="space-y-2 lg:mt-3">
            {primaryNavItems.map((item) => (
              <SidebarLink
                key={item.to}
                item={item}
                currentPath={currentPath}
                attentionCount={
                  item.to === '/inbox' ? inboxAttentionCount : undefined
                }
              />
            ))}
          </nav>
        </div>

        <div className="hidden min-h-0 flex-1 overflow-y-auto lg:block">
          <Separator className="my-3" />

          <section aria-labelledby="sidebar-current-project-heading">
            <h2
              id="sidebar-current-project-heading"
              className="px-2 text-xs font-semibold text-text-muted"
            >
              当前项目
            </h2>
            <Button
              asChild
              variant="outline"
              className="mt-2 h-[var(--layout-sidebar-context-item-height)] w-full justify-start rounded-sm border-border-strong bg-primary-muted/40 px-2 text-left hover:bg-primary-muted/60"
            >
              <Link
                to={
                  currentProject === undefined
                    ? '/projects'
                    : '/projects/$projectId'
                }
                params={
                  currentProject === undefined
                    ? undefined
                    : { projectId: currentProject.projectId }
                }
                aria-label={
                  currentProject === undefined
                    ? '选择项目'
                    : `打开 ${currentProject.name} 项目详情`
                }
                aria-current={
                  currentProject !== undefined &&
                  currentPath === `/projects/${currentProject.projectId}`
                    ? 'page'
                    : undefined
                }
              >
                <FolderOpen
                  aria-hidden="true"
                  className="size-4 shrink-0 text-primary"
                />
                <span className="min-w-0 flex-1 truncate text-md font-semibold text-text-primary">
                  {currentProject?.name ?? '选择项目'}
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className="size-4 shrink-0 text-text-secondary"
                />
              </Link>
            </Button>
          </section>

          <Separator className="my-3" />

          <section aria-labelledby="sidebar-agents-heading">
            <h2
              id="sidebar-agents-heading"
              className="px-2 text-xs font-semibold text-text-muted"
            >
              智能体
            </h2>
            <ul className="mt-2 space-y-0.5">
              {agentPresences.map(({ agent }) => {
                const definition = agentDefinitions[agent]
                const connected = agent === 'codex' && codexAvailable
                const status: ExecutionStatus = connected ? 'idle' : 'offline'
                const stateLabel =
                  agent === 'codex' ? (connected ? '可用' : '不可用') : '未接入'

                return (
                  <li
                    key={agent}
                    className="flex h-[var(--layout-sidebar-presence-item-height)] min-w-0 items-center gap-1 pr-3 pl-2"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'grid size-[var(--layout-sidebar-mark-size)] shrink-0 place-items-center rounded-md border text-sm font-semibold',
                        definition.accentClassName,
                      )}
                    >
                      {definition.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-md font-medium text-text-primary">
                      {definition.name}
                    </span>
                    <span className="text-2xs text-text-muted">
                      {stateLabel}
                    </span>
                    <PresenceDot
                      label={definition.name}
                      stateLabel={stateLabel}
                      status={status}
                    />
                  </li>
                )
              })}
            </ul>
          </section>
        </div>

        <div className="mt-auto pt-3">
          <Separator className="mb-3" />
          <nav aria-label="应用">
            <SidebarLink item={settingsNavItem} currentPath={currentPath} />
          </nav>
        </div>
      </div>
    </aside>
  )
}
