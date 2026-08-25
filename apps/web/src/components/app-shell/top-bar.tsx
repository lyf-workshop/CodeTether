import type { ComponentPropsWithoutRef, MouseEventHandler } from 'react'
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

interface TopBarProps extends Omit<
  ComponentPropsWithoutRef<'header'>,
  'children'
> {
  currentPage: string
  currentProject: string
  notificationCount?: number
  onHelp?: MouseEventHandler<HTMLButtonElement>
  onNewTask?: MouseEventHandler<HTMLButtonElement>
  onNotifications?: MouseEventHandler<HTMLButtonElement>
  onProfile?: MouseEventHandler<HTMLButtonElement>
  onSearch?: MouseEventHandler<HTMLButtonElement>
  profile?: TopBarProfile
}

const defaultProfile: TopBarProfile = {
  initials: 'DU',
  name: 'Demo user',
}

/** Shared desktop header. Actions remain callback-driven until product flows exist. */
function TopBar({
  className,
  currentPage,
  currentProject,
  notificationCount = 0,
  onHelp,
  onNewTask,
  onNotifications,
  onProfile,
  onSearch,
  profile = defaultProfile,
  ...props
}: TopBarProps) {
  const notificationsLabel =
    notificationCount > 0
      ? `Notifications, ${notificationCount} unread`
      : 'Notifications'

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
        <nav
          aria-label="Current location"
          className="min-w-0 flex-1 overflow-hidden"
        >
          <ol className="flex min-w-0 items-center gap-3 text-md font-medium">
            <li className="min-w-0 shrink truncate text-text-primary">
              {currentProject}
            </li>
            <li aria-hidden="true" className="shrink-0 text-lg text-text-muted">
              ›
            </li>
            <li
              aria-current="page"
              className="hidden min-w-0 truncate text-text-primary sm:block"
            >
              {currentPage}
            </li>
          </ol>
        </nav>

        <div className="flex shrink-0 items-center gap-4">
          <Button
            size="sm"
            onClick={onNewTask}
            className="h-[2.125rem] w-9 gap-2 px-0 md:w-26 md:px-3"
          >
            <Plus aria-hidden="true" />
            <span className="hidden md:inline">New Task</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={onSearch}
            aria-keyshortcuts="Meta+K Control+K"
            aria-label="Search, Command K or Control K"
            className="h-9 w-9 justify-center border-border-strong bg-surface-inset px-0 text-text-secondary hover:bg-surface-muted hover:text-text-primary lg:w-44 lg:justify-start lg:px-3"
          >
            <Search aria-hidden="true" />
            <span className="hidden lg:inline">Search</span>
            <kbd
              aria-hidden="true"
              className="ml-auto hidden whitespace-nowrap font-sans text-2xs text-text-muted xl:inline"
            >
              ⌘K / Ctrl+K
            </kbd>
          </Button>

          <div className="flex items-center gap-1">
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

            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton
                  label="Help"
                  size="sm"
                  variant="ghost"
                  onClick={onHelp}
                  className="text-text-secondary hover:text-text-primary"
                >
                  <CircleHelp aria-hidden="true" />
                </IconButton>
              </TooltipTrigger>
              <TooltipContent side="bottom">Help</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton
                  label={`Open profile for ${profile.name}`}
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
          </div>
        </div>
      </div>
    </header>
  )
}

export { TopBar, type TopBarProfile, type TopBarProps }
