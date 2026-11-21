import type { ComponentPropsWithoutRef, ReactNode } from 'react'

import { cn } from '../../lib/cn'

export interface SessionItemProps extends Omit<
  ComponentPropsWithoutRef<'article'>,
  'title'
> {
  title: string
  leading?: ReactNode
  metadata?: ReactNode
  status?: ReactNode
  activity?: ReactNode
  primaryAction?: ReactNode
  actions?: ReactNode
  actionPlacement?: 'inline' | 'overlay'
}

/** A dense session row with separate navigation and action targets. */
export function SessionItem({
  title,
  leading,
  metadata,
  status,
  activity,
  primaryAction,
  actions,
  actionPlacement = 'inline',
  className,
  ...props
}: SessionItemProps) {
  return (
    <article
      data-slot="session-item"
      className={cn(
        'group relative isolate flex min-h-15 min-w-0 flex-wrap items-center gap-3 border-t border-border bg-surface px-4 py-3 hover:bg-surface-muted',
        className,
      )}
      {...props}
    >
      {primaryAction}
      {leading ? (
        <div className="pointer-events-none relative z-[1] shrink-0">
          {leading}
        </div>
      ) : null}
      <div className="pointer-events-none relative z-[1] min-w-0 flex-1 basis-32">
        <h3
          title={title}
          className="truncate text-base font-medium text-text-primary"
        >
          {title}
        </h3>
        {metadata ? (
          <div className="mt-1 min-w-0 text-sm text-text-muted">{metadata}</div>
        ) : null}
      </div>
      <div className="pointer-events-none relative z-[1] flex max-w-full shrink-0 flex-wrap items-center gap-3">
        {status}
        {activity ? (
          <span className="text-sm text-text-muted">{activity}</span>
        ) : null}
      </div>
      {actions ? (
        <div
          className={cn(
            actionPlacement === 'overlay'
              ? 'absolute top-1/2 right-3 z-10 flex w-max -translate-y-1/2 items-center gap-1 rounded-sm bg-surface px-1 opacity-0 shadow-sm group-hover/conversation-row:opacity-100 group-focus-within/conversation-row:opacity-100 max-[600px]:opacity-100 [@media(hover:none)]:opacity-100'
              : 'relative z-10 flex max-w-full basis-full flex-wrap items-center justify-end gap-1 sm:basis-auto',
          )}
        >
          {actions}
        </div>
      ) : null}
    </article>
  )
}
