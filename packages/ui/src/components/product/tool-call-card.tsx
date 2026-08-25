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

/** Dense, read-only tool activity card derived from Figma nodes 14:165/14:170. */
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
      className={cn(
        'flex min-h-13 w-full min-w-0 items-center gap-3 rounded-sm border border-border bg-surface-inset p-3',
        className,
      )}
      {...props}
    >
      <StatusGlyph status={status} />
      <div className="min-w-0 flex-1">
        {description ? (
          <p className="truncate text-xs text-text-secondary">{description}</p>
        ) : null}
        <p
          className={cn(
            'truncate text-sm font-medium text-text-primary',
            description && 'mt-1',
          )}
        >
          {title}
        </p>
      </div>
      <div className="ml-auto flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-3 text-2xs">
        {metadata ? (
          <span className="text-text-secondary">{metadata}</span>
        ) : null}
        {delta ? (
          <span className="inline-flex items-center gap-2 font-medium tabular-nums">
            <span className="text-success">+{Math.abs(delta.additions)}</span>
            <span className="text-danger">-{Math.abs(delta.deletions)}</span>
          </span>
        ) : null}
        {action ? <span className="text-primary">{action}</span> : null}
      </div>
    </div>
  )
}
