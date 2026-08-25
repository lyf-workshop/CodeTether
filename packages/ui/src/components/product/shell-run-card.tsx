import type { ComponentPropsWithoutRef, ReactNode } from 'react'

import { cn } from '../../lib/cn'
import type { ExecutionStatus } from '../../tokens'
import { StatusGlyph } from './status-glyph'

export interface ShellRunCardProps extends Omit<
  ComponentPropsWithoutRef<'div'>,
  'children'
> {
  command: string
  status: ExecutionStatus
  summary?: ReactNode
  action?: ReactNode
}

/** Compact shell execution summary based on Figma node 14:181. */
export function ShellRunCard({
  command,
  status,
  summary,
  action,
  className,
  ...props
}: ShellRunCardProps) {
  return (
    <div
      data-slot="shell-run-card"
      className={cn(
        'flex min-h-13 w-full min-w-0 items-center gap-3 rounded-sm border border-border bg-surface-inset p-3',
        className,
      )}
      {...props}
    >
      <StatusGlyph status={status} />
      <code className="min-w-0 flex-1 truncate font-sans text-sm font-medium text-text-primary">
        {command}
      </code>
      {summary ? (
        <span className="shrink-0 text-2xs font-medium text-text-secondary">
          {summary}
        </span>
      ) : null}
      {action ? <span className="shrink-0 text-primary">{action}</span> : null}
    </div>
  )
}
