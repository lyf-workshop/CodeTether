import type { ComponentPropsWithoutRef } from 'react'

import { StatusBadge } from '../status-badge'
import { cn } from '../../lib/cn'
import type { ExecutionStatus } from '../../tokens'
import { StatusDot } from './status-glyph'

export interface ConversationItemProps extends Omit<
  ComponentPropsWithoutRef<'article'>,
  'children' | 'title'
> {
  title: string
  description?: string
  status: ExecutionStatus
}

/** Presentational conversation summary matching Conversation / Row (19:436). */
export function ConversationItem({
  title,
  description,
  status,
  className,
  ...props
}: ConversationItemProps) {
  return (
    <article
      data-slot="conversation-item"
      className={cn(
        'flex min-h-21 w-full min-w-0 items-center gap-3 rounded-lg border border-border bg-surface p-4',
        className,
      )}
      {...props}
    >
      <StatusDot status={status} />
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-base font-semibold text-text-primary">
          {title}
        </h3>
        {description ? (
          <p className="mt-1 truncate text-xs text-text-secondary">
            {description}
          </p>
        ) : null}
      </div>
      <StatusBadge
        status={status}
        showIcon={false}
        className="h-7 shrink-0 px-3"
      />
    </article>
  )
}
