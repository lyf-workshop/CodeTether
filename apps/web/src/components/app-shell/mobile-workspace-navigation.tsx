import { Link } from '@tanstack/react-router'
import { Inbox, Monitor, Settings } from 'lucide-react'
import { cn } from '@codetether/ui'
import { formatInboxAttentionBadge } from '../inbox/inbox-model'

interface MobileWorkspaceNavigationProps {
  readonly currentPath: string
  readonly attentionCount?: number
}

/** The same real destinations as desktop; device/project/conversation detail stay under Devices. */
export function MobileWorkspaceNavigation({
  currentPath,
  attentionCount,
}: MobileWorkspaceNavigationProps) {
  const current = currentPath.startsWith('/inbox')
    ? 'inbox'
    : currentPath.startsWith('/settings') || currentPath === '/doctor'
      ? 'settings'
      : 'devices'
  const badge =
    attentionCount === undefined
      ? undefined
      : formatInboxAttentionBadge(attentionCount)
  const destinations = [
    { id: 'devices', to: '/devices', label: '设备', icon: Monitor },
    { id: 'inbox', to: '/inbox', label: '待处理', icon: Inbox },
    { id: 'settings', to: '/settings', label: '设置', icon: Settings },
  ] as const
  return (
    <nav
      data-slot="mobile-workspace-navigation"
      aria-label="手机主导航"
      className="ct-mobile-workspace-navigation border-t border-border bg-navigation"
    >
      {destinations.map((destination) => {
        const Icon = destination.icon
        return (
          <Link
            key={destination.id}
            to={destination.to}
            aria-current={current === destination.id ? 'page' : undefined}
            aria-label={
              destination.id === 'inbox' && attentionCount !== undefined
                ? '待处理，' + attentionCount + ' 个打开事项'
                : destination.label
            }
            className={cn(
              'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-sm px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring',
              current === destination.id
                ? 'text-text-primary'
                : 'text-text-muted',
            )}
          >
            <Icon aria-hidden="true" className="size-5" />
            <span>{destination.label}</span>
            {destination.id === 'inbox' && badge !== undefined ? (
              <span
                aria-hidden="true"
                className="absolute top-0 left-1/2 ml-2 rounded-full bg-danger px-1.5 text-xs text-text-inverse"
              >
                {badge}
              </span>
            ) : null}
          </Link>
        )
      })}
    </nav>
  )
}
