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

/** Compact shell execution row based on Figma node 14:181. */
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
      <code className="min-w-0 flex-1 truncate font-sans text-md font-medium text-text-primary">
        {command}
      </code>
      {summary ? (
        <span className="min-w-0 shrink truncate text-sm font-regular text-text-secondary">
          {summary}
        </span>
      ) : null}
      {action ? <span className="shrink-0 text-primary">{action}</span> : null}
    </div>
  )
}
