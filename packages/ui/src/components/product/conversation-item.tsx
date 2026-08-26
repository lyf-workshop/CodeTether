import type { ComponentPropsWithoutRef, ReactNode } from 'react'

import { Badge } from '../badge'
import { StatusBadge } from '../status-badge'
import { cn } from '../../lib/cn'
import type { ExecutionStatus } from '../../tokens'
import { MachineBadge } from './machine-badge'
import { StatusDot } from './status-glyph'

export interface ConversationItemProps extends Omit<
  ComponentPropsWithoutRef<'article'>,
  'children' | 'title'
> {
  title: string
  description?: string
  status: ExecutionStatus
  appearance?: 'card' | 'row'
  action?: ReactNode
  activity?: string
  activityDetail?: string
  machine?: string
  model?: string
  primaryAction?: ReactNode
  selected?: boolean
}

/** Shared presentational summary for the component showcase and dense lists. */
export function ConversationItem({
  action,
  activity,
  activityDetail,
  appearance = 'card',
  title,
  description,
  machine,
  model,
  primaryAction,
  selected = false,
  status,
  className,
  ...props
}: ConversationItemProps) {
  if (appearance === 'row') {
    return (
      <article
        data-slot="conversation-item"
        data-appearance="row"
        data-selected={selected || undefined}
        className={cn(
          'group relative isolate flex h-[var(--layout-conversations-row-height)] w-full min-w-0 items-center gap-3 overflow-hidden rounded-md border border-border bg-surface/55 px-3.5',
          'transition-colors duration-150 motion-reduce:transition-none hover:border-border-strong hover:bg-surface-muted/55',
          selected &&
            "border-primary/40 bg-primary-muted/55 before:absolute before:inset-y-2.5 before:left-0 before:w-0.5 before:rounded-r-full before:bg-primary before:content-[''] hover:border-primary/60 hover:bg-primary-muted/65",
          className,
        )}
        {...props}
      >
        {primaryAction}

        <StatusDot
          status={status}
          className={cn(
            'pointer-events-none relative z-[1]',
            status === 'completed' && 'text-text-muted',
            status === 'running' && 'motion-safe:animate-pulse',
          )}
        />

        <div className="pointer-events-none relative z-[1] min-w-0 flex-1">
          <h3
            className={cn(
              'truncate text-md font-semibold',
              selected || status !== 'completed'
                ? 'text-text-primary'
                : 'text-text-secondary',
            )}
          >
            {title}
          </h3>
          {description ? (
            <p className="mt-1 truncate text-xs font-regular text-text-muted">
              {description}
            </p>
          ) : null}
        </div>

        <div className="pointer-events-none relative z-[1] hidden shrink-0 items-center gap-2 min-[1180px]:flex">
          {model ? (
            <Badge
              variant="outline"
              className="h-7 w-[var(--layout-conversations-model-width)] justify-start rounded-sm bg-surface-elevated px-2 text-xs font-regular"
            >
              <span className="truncate">{model}</span>
            </Badge>
          ) : null}
          {machine ? (
            <MachineBadge
              name={machine}
              className="w-[var(--layout-conversations-machine-width)] justify-start font-regular"
            />
          ) : null}
          <StatusBadge
            status={status}
            showIcon={false}
            className={cn(
              'h-6 min-w-[var(--layout-conversations-status-width)] px-2.5 text-xs font-medium',
              status === 'completed' &&
                'border-transparent bg-surface-elevated text-text-secondary',
            )}
          />
        </div>

        {activity ? (
          <div className="pointer-events-none relative z-[1] flex w-[var(--layout-conversations-activity-width)] shrink-0 flex-col gap-1 text-xs font-regular text-text-muted tabular-nums">
            <span className="truncate">{activity}</span>
            {activityDetail ? (
              <span
                className={cn(
                  'truncate',
                  status === 'waiting' && 'text-status-waiting',
                )}
              >
                {activityDetail}
              </span>
            ) : null}
          </div>
        ) : null}

        {action ? (
          <div className="relative z-10 flex size-8 shrink-0 items-center justify-center">
            {action}
          </div>
        ) : null}
      </article>
    )
  }

  return (
    <article
      data-slot="conversation-item"
      data-appearance="card"
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
