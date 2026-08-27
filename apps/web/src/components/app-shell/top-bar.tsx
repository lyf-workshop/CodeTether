import type { ComponentPropsWithoutRef, MouseEventHandler, Ref } from 'react'
import { Link } from '@tanstack/react-router'
import { Bell, CircleHelp, Plus, Search } from 'lucide-react'

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
  | { label: string; to: '/projects' }
  | {
      label: string
      params: { projectId: string }
      to: '/projects/$projectId'
    }
  | {
      label: string
      params: { projectId: string }
      to: '/projects/$projectId/conversations'
    }

interface TopBarProps extends Omit<
  ComponentPropsWithoutRef<'header'>,
  'children'
> {
  currentPage: string
  breadcrumbs?: readonly TopBarBreadcrumb[]
  notificationCount?: number
  onHelp?: MouseEventHandler<HTMLButtonElement>
  onNewConversation?: MouseEventHandler<HTMLButtonElement>
  onNotifications?: MouseEventHandler<HTMLButtonElement>
  onProfile?: MouseEventHandler<HTMLButtonElement>
  onSearch?: MouseEventHandler<HTMLButtonElement>
  profile?: TopBarProfile
  newConversationButtonRef?: Ref<HTMLButtonElement>
}

/** Shared desktop header. Product actions are injected by the AppShell. */
function TopBar({
  breadcrumbs,
  className,
  currentPage,
  notificationCount = 0,
  onHelp,
  onNewConversation,
  onNotifications,
  onProfile,
  onSearch,
  profile,
  newConversationButtonRef,
  ...props
}: TopBarProps) {
  const notificationsLabel =
    notificationCount > 0 ? `通知，${notificationCount} 条未读` : '通知'
  const resolvedBreadcrumbs = breadcrumbs ?? [{ label: currentPage }]

  return (
    <header
      data-slot="top-bar"
      className={cn(
        'flex h-[var(--layout-topbar-height)] min-w-0 shrink-0 border-b border-border bg-navigation',
        className,
      )}
      {...props}
    >
      <div className="flex w-[var(--layout-sidebar-current-width)] shrink-0 items-center gap-3 overflow-hidden px-[var(--layout-topbar-inline-padding)]">
        <span
          aria-hidden="true"
          className="grid size-[var(--layout-brand-mark-size)] shrink-0 place-items-center rounded-sm border border-primary bg-primary text-sm font-semibold text-text-inverse"
        >
          C
        </span>
        <span className="hidden truncate text-brand font-semibold text-text-primary lg:block">
          CodeTether
        </span>
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-4 pr-[var(--layout-topbar-inline-padding)] pl-[var(--layout-content-inline-padding)]">
        <nav aria-label="当前位置" className="min-w-0 flex-1 overflow-hidden">
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

        <div className="flex shrink-0 items-center gap-4">
          <Button
            ref={newConversationButtonRef}
            size="sm"
            onClick={onNewConversation}
            aria-label="新建会话"
            className="h-[2.125rem] w-9 gap-2 px-0 md:w-26 md:px-3"
          >
            <Plus aria-hidden="true" />
            <span className="hidden md:inline">新建会话</span>
          </Button>

          {onSearch === undefined ? null : (
            <Button
              variant="outline"
              size="sm"
              onClick={onSearch}
              aria-keyshortcuts="Meta+K Control+K"
              aria-label="搜索，快捷键 ⌘K 或 Ctrl+K"
              className="h-9 w-9 justify-center border-border-strong bg-surface-inset px-0 text-text-secondary hover:bg-surface-muted hover:text-text-primary lg:w-44 lg:justify-start lg:px-3"
            >
              <Search aria-hidden="true" />
              <span className="hidden lg:inline">搜索</span>
              <kbd
                aria-hidden="true"
                className="ml-auto hidden whitespace-nowrap font-sans text-2xs text-text-muted xl:inline"
              >
                ⌘K / Ctrl+K
              </kbd>
            </Button>
          )}

          {onNotifications === undefined &&
          onHelp === undefined &&
          (onProfile === undefined || profile === undefined) ? null : (
            <div className="flex items-center gap-1">
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

              {onHelp === undefined ? null : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <IconButton
                      label="帮助"
                      size="sm"
                      variant="ghost"
                      onClick={onHelp}
                      className="text-text-secondary hover:text-text-primary"
                    >
                      <CircleHelp aria-hidden="true" />
                    </IconButton>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">帮助</TooltipContent>
                </Tooltip>
              )}

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
          )}
        </div>
      </div>
    </header>
  )
}

function BreadcrumbContent({
  breadcrumb,
  isCurrent,
}: {
  breadcrumb: TopBarBreadcrumb
  isCurrent: boolean
}) {
  const className =
    'min-w-0 truncate rounded-xs text-text-primary outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none'

  if (breadcrumb.to === undefined) {
    return (
      <span
        className={
          isCurrent
            ? 'hidden min-w-0 truncate text-text-primary sm:block'
            : 'min-w-0 truncate text-text-primary'
        }
      >
        {breadcrumb.label}
      </span>
    )
  }
  if (breadcrumb.to === '/projects') {
    return (
      <Link to="/projects" className={className}>
        {breadcrumb.label}
      </Link>
    )
  }
  if (breadcrumb.to === '/projects/$projectId') {
    return (
      <Link
        to="/projects/$projectId"
        params={breadcrumb.params}
        className={className}
      >
        {breadcrumb.label}
      </Link>
    )
  }
  return (
    <Link
      to="/projects/$projectId/conversations"
      params={breadcrumb.params}
      className={className}
    >
      {breadcrumb.label}
    </Link>
  )
}

export { TopBar, type TopBarBreadcrumb, type TopBarProfile, type TopBarProps }
