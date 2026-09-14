import type { ComponentPropsWithoutRef, MouseEvent } from 'react'
import { Link } from '@tanstack/react-router'
import {
  FolderOpen,
  Inbox,
  Monitor,
  Settings,
  type LucideIcon,
} from 'lucide-react'

import { Tooltip, TooltipContent, TooltipTrigger, cn } from '@codetether/ui'

import { formatInboxAttentionBadge } from '../inbox/inbox-model'

type SidebarDestination = '/inbox' | '/machines' | '/projects' | '/settings'

interface SidebarNavItem {
  label: string
  to: SidebarDestination
  icon: LucideIcon
}

const primaryNavItems = [
  { label: '项目', to: '/projects', icon: FolderOpen },
  { label: '电脑', to: '/machines', icon: Monitor },
  { label: '收件箱', to: '/inbox', icon: Inbox },
] as const satisfies readonly SidebarNavItem[]

const settingsNavItem = {
  label: '设置',
  to: '/settings',
  icon: Settings,
} as const satisfies SidebarNavItem

function isCurrentRoute(currentPath: string, destination: SidebarDestination) {
  return (
    currentPath === destination || currentPath.startsWith(`${destination}/`)
  )
}

interface SidebarLinkProps {
  attentionCount?: number
  currentPath: string
  item: SidebarNavItem
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void
}

function SidebarLink({
  attentionCount = 0,
  currentPath,
  item,
  onClick,
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
          onClick={onClick}
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
  inboxAttentionCount?: number
  onSettingsClick?: (event: MouseEvent<HTMLAnchorElement>) => void
}

/** Shared desktop navigation for the product's primary destinations. */
export function PrimarySidebar({
  currentPath,
  inboxAttentionCount = 0,
  onSettingsClick,
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

        <div className="mt-auto pt-3">
          <nav aria-label="应用">
            <SidebarLink
              item={settingsNavItem}
              currentPath={currentPath}
              onClick={onSettingsClick}
            />
          </nav>
        </div>
      </div>
    </aside>
  )
}
