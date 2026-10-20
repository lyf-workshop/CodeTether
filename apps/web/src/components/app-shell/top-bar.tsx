import type {
  ComponentPropsWithoutRef,
  MouseEventHandler,
  ReactNode,
  Ref,
} from 'react'
import { Link } from '@tanstack/react-router'
import type { MachineId, ProjectId } from '@codetether/protocol'
import {
  Bell,
  ArrowLeft,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  ShieldCheck,
} from 'lucide-react'

import {
  Button,
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from '@codetether/ui'

interface TopBarProfile {
  initials: string
  name: string
}

type TopBarBreadcrumb =
  | { label: string; to?: undefined }
  | { label: string; to: '/machines' }
  | { label: string; to: '/devices' }
  | { label: string; to: '/devices/$machineId'; params: { machineId: string } }
  | { label: string; to: '/projects' }
  | { label: string; to: '/add' }
  | { label: string; to: '/settings'; search?: { projectId?: ProjectId } }
  | {
      label: string
      to: '/settings/$section'
      params: { section: string }
      search?: { projectId?: ProjectId }
    }
  | {
      label: string
      params: { projectId: string }
      to: '/projects/$projectId'
      search?: { machineId?: MachineId }
    }
  | {
      label: string
      params: { projectId: string }
      to: '/projects/$projectId/conversations'
      search?: { machineId?: MachineId }
    }

interface TopBarProps extends Omit<
  ComponentPropsWithoutRef<'header'>,
  'children'
> {
  currentPage: string
  breadcrumbs?: readonly TopBarBreadcrumb[]
  notificationCount?: number
  onDoctor?: MouseEventHandler<HTMLButtonElement>
  onNotifications?: MouseEventHandler<HTMLButtonElement>
  onProfile?: MouseEventHandler<HTMLButtonElement>
  onSearch?: MouseEventHandler<HTMLButtonElement>
  profile?: TopBarProfile
  sidebarCollapsed?: boolean
  onToggleSidebar?: MouseEventHandler<HTMLButtonElement>
  workspaceActionsRef?: Ref<HTMLDivElement>
}

/** Shared desktop header. Product actions are injected by the AppShell. */
function TopBar({
  breadcrumbs,
  className,
  currentPage,
  notificationCount = 0,
  onDoctor,
  onNotifications,
  onProfile,
  onSearch,
  profile,
  sidebarCollapsed = false,
  onToggleSidebar,
  workspaceActionsRef,
  ...props
}: TopBarProps) {
  const notificationsLabel =
    notificationCount > 0
      ? `收件箱，${notificationCount} 个待处理事项`
      : '收件箱'
  const resolvedBreadcrumbs = breadcrumbs ?? [{ label: currentPage }]
  const parentBreadcrumb = resolvedBreadcrumbs
    .slice(0, -1)
    .reverse()
    .find((breadcrumb) => breadcrumb.to !== undefined)
  const sidebarToggleLabel = sidebarCollapsed ? '显示侧边栏' : '隐藏侧边栏'

  return (
    <header
      data-slot="top-bar"
      className={cn(
        'flex h-[var(--layout-topbar-height)] min-w-0 shrink-0 border-b border-border bg-background',
        className,
      )}
      {...props}
    >
      <div
        data-slot="top-bar-left-controls"
        className="flex h-full shrink-0 items-center pl-[var(--layout-topbar-inline-padding)]"
      >
        {onToggleSidebar === undefined ? null : (
          <Tooltip>
            <TooltipTrigger asChild>
              <IconButton
                type="button"
                size="sm"
                variant="ghost"
                label={sidebarToggleLabel}
                aria-pressed={!sidebarCollapsed}
                data-slot="workspace-sidebar-toggle"
                className="size-8 shrink-0 text-text-secondary"
                onClick={onToggleSidebar}
              >
                {sidebarCollapsed ? (
                  <PanelLeftOpen aria-hidden="true" />
                ) : (
                  <PanelLeftClose aria-hidden="true" />
                )}
              </IconButton>
            </TooltipTrigger>
            <TooltipContent side="bottom">{sidebarToggleLabel}</TooltipContent>
          </Tooltip>
        )}
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-3 pr-[var(--layout-topbar-inline-padding)] pl-3">
        <nav
          aria-label="当前位置"
          data-slot="desktop-breadcrumbs"
          className="min-w-0 flex-1 overflow-hidden"
        >
          <ol className="flex min-w-0 items-center gap-3 text-md font-medium">
            {resolvedBreadcrumbs.map((breadcrumb, index) => {
              const isCurrent = index === resolvedBreadcrumbs.length - 1

              return (
                <li
                  key={`${breadcrumb.label}-${index}`}
                  aria-current={isCurrent ? 'page' : undefined}
                  className="flex min-w-0 items-center gap-3"
                >
                  {index > 0 ? (
                    <span
                      aria-hidden="true"
                      className="shrink-0 text-lg text-text-muted"
                    >
                      ›
                    </span>
                  ) : null}
                  <BreadcrumbContent
                    breadcrumb={breadcrumb}
                    isCurrent={isCurrent}
                  />
                </li>
              )
            })}
          </ol>
        </nav>
        <div data-slot="mobile-breadcrumb">
          {parentBreadcrumb === undefined ? null : (
            <span data-slot="mobile-back-link">
              <BreadcrumbContent
                breadcrumb={parentBreadcrumb}
                isCurrent={false}
              >
                <ArrowLeft aria-hidden="true" className="size-4" />
                <span className="sr-only">返回{parentBreadcrumb.label}</span>
              </BreadcrumbContent>
            </span>
          )}
          <span
            className="min-w-0 truncate text-md font-medium"
            title={currentPage}
          >
            {currentPage}
          </span>
        </div>

        <div
          data-slot="top-bar-right-actions"
          className="flex min-w-0 shrink-0 items-center gap-2"
        >
          {onSearch === undefined ? null : (
            <IconButton
              type="button"
              variant="ghost"
              size="sm"
              onClick={onSearch}
              data-slot="workspace-global-search"
              aria-keyshortcuts="Meta+K Control+K"
              label="搜索，快捷键 ⌘K 或 Ctrl+K"
              className="size-8 shrink-0 text-text-secondary"
            >
              <Search aria-hidden="true" />
            </IconButton>
          )}

          <div className="flex shrink-0 items-center gap-1">
            {onNotifications === undefined ? null : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <IconButton
                    label={notificationsLabel}
                    size="sm"
                    variant="ghost"
                    onClick={onNotifications}
                    className="relative text-text-secondary hover:text-text-primary"
                  >
                    <Bell aria-hidden="true" />
                    {notificationCount > 0 ? (
                      <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
                    ) : null}
                  </IconButton>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {notificationsLabel}
                </TooltipContent>
              </Tooltip>
            )}

            {onDoctor === undefined ? null : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    aria-label="检查状态"
                    size="sm"
                    variant="ghost"
                    onClick={onDoctor}
                    className="h-8 gap-2 px-2 text-text-secondary hover:text-text-primary"
                  >
                    <ShieldCheck aria-hidden="true" />
                    <span className="narrow-desktop:sr-only">检查状态</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">检查状态</TooltipContent>
              </Tooltip>
            )}

            <div
              ref={workspaceActionsRef}
              data-slot="top-bar-workspace-actions"
              className="flex shrink-0 items-center gap-1"
            />

            {onProfile === undefined || profile === undefined ? null : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <IconButton
                    label={`打开${profile.name}的个人资料`}
                    size="sm"
                    variant="ghost"
                    onClick={onProfile}
                    className="ml-1 size-[var(--layout-brand-mark-size)] rounded-full border-border-strong bg-text-secondary text-xs font-semibold text-background hover:bg-text-primary hover:text-background"
                  >
                    <span aria-hidden="true">{profile.initials}</span>
                  </IconButton>
                </TooltipTrigger>
                <TooltipContent side="bottom">{profile.name}</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}

function BreadcrumbContent({
  breadcrumb,
  isCurrent,
  children,
}: {
  children?: ReactNode
  breadcrumb: TopBarBreadcrumb
  isCurrent: boolean
}) {
  const className =
    'min-w-0 truncate rounded-xs text-text-primary outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none'

  if (breadcrumb.to === undefined) {
    return (
      <span
        title={breadcrumb.label}
        className={
          isCurrent
            ? 'hidden min-w-0 truncate text-text-primary sm:block'
            : 'min-w-0 truncate text-text-primary'
        }
      >
        {children ?? breadcrumb.label}
      </span>
    )
  }
  if (breadcrumb.to === '/add')
    return (
      <Link to="/add" className={className} title={breadcrumb.label}>
        {children ?? breadcrumb.label}
      </Link>
    )
  if (breadcrumb.to === '/settings')
    return (
      <Link
        to="/settings"
        search={breadcrumb.search}
        className={className}
        title={breadcrumb.label}
      >
        {children ?? breadcrumb.label}
      </Link>
    )
  if (breadcrumb.to === '/settings/$section')
    return (
      <Link
        to="/settings/$section"
        params={breadcrumb.params}
        search={breadcrumb.search}
        className={className}
        title={breadcrumb.label}
      >
        {children ?? breadcrumb.label}
      </Link>
    )
  if (breadcrumb.to === '/projects') {
    return (
      <Link to="/projects" className={className} title={breadcrumb.label}>
        {children ?? breadcrumb.label}
      </Link>
    )
  }
  if (breadcrumb.to === '/devices/$machineId') {
    return (
      <Link
        to="/devices/$machineId"
        params={breadcrumb.params}
        className={className}
        title={breadcrumb.label}
      >
        {children ?? breadcrumb.label}
      </Link>
    )
  }
  if (breadcrumb.to === '/machines' || breadcrumb.to === '/devices') {
    return (
      <Link to={breadcrumb.to} className={className} title={breadcrumb.label}>
        {children ?? breadcrumb.label}
      </Link>
    )
  }
  if (breadcrumb.to === '/projects/$projectId') {
    return (
      <Link
        to="/projects/$projectId"
        params={breadcrumb.params}
        search={breadcrumb.search}
        className={className}
        title={breadcrumb.label}
      >
        {children ?? breadcrumb.label}
      </Link>
    )
  }
  return (
    <Link
      to="/projects/$projectId/conversations"
      params={breadcrumb.params}
      search={breadcrumb.search}
      className={className}
      title={breadcrumb.label}
    >
      {children ?? breadcrumb.label}
    </Link>
  )
}

export { TopBar, type TopBarBreadcrumb, type TopBarProfile, type TopBarProps }
