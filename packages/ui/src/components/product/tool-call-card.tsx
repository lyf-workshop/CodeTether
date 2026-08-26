import type { ComponentPropsWithoutRef, ReactNode } from 'react'

import { cn } from '../../lib/cn'
import type { ExecutionStatus } from '../../tokens'
import { StatusGlyph } from './status-glyph'

export interface ToolCallDelta {
  additions: number
  deletions: number
}

export interface ToolCallCardProps extends Omit<
  ComponentPropsWithoutRef<'div'>,
  'children' | 'title'
> {
  title: string
  status: ExecutionStatus
  description?: string
  metadata?: ReactNode
  delta?: ToolCallDelta
  action?: ReactNode
}

/** Dense, read-only tool execution row derived from Figma nodes 14:165/14:170. */
export function ToolCallCard({
  title,
  status,
  description,
  metadata,
  delta,
  action,
  className,
  ...props
}: ToolCallCardProps) {
  return (
    <div
      data-slot="tool-call-card"
      data-status={status}
      className={cn(
        'flex min-h-12 w-full min-w-0 items-center gap-3 border-b border-border/50 px-1 py-2',
        'transition-colors duration-150 motion-reduce:transition-none',
        'focus-within:bg-surface-muted/45',
        'data-[status=running]:bg-surface-muted/45',
        'data-[status=waiting]:bg-status-waiting-muted/15',
        'data-[status=failed]:bg-status-failed-muted/15',
        className,
      )}
      {...props}
    >
      <StatusGlyph status={status} />
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        {description ? (
          <span className="min-w-0 shrink truncate text-md font-medium text-text-primary">
            {description}
          </span>
        ) : null}
        <span
          className={cn(
            'truncate text-md font-medium text-text-primary',
            description && 'text-sm font-regular text-text-secondary',
          )}
        >
          {title}
        </span>
      </div>
      <div className="ml-auto flex min-w-0 shrink items-center justify-end gap-3 text-sm font-regular">
        {metadata ? (
          <span className="min-w-0 truncate text-text-secondary">
            {metadata}
          </span>
        ) : null}
        {delta ? (
          <span className="inline-flex shrink-0 items-center gap-2 tabular-nums">
            <span className="text-success">+{Math.abs(delta.additions)}</span>
            <span className="text-danger">-{Math.abs(delta.deletions)}</span>
          </span>
        ) : null}
        {action ? (
          <span className="shrink-0 text-primary">{action}</span>
        ) : null}
      </div>
    </div>
  )
}
