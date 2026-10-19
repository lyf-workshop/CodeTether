import * as React from 'react'

import { cn } from '@codetether/ui/lib/cn'

export type StatusTone = 'ok' | 'warn' | 'err' | 'off' | 'run'

export interface StatusTagProps extends React.ComponentPropsWithoutRef<'span'> {
  tone?: StatusTone
  showDot?: boolean
}

const toneClasses: Record<StatusTone, string> = {
  ok: 'text-success-text [&>[data-slot=status-tag-dot]]:bg-success',
  warn: 'text-warning-text [&>[data-slot=status-tag-dot]]:bg-warning',
  err: 'text-danger-text [&>[data-slot=status-tag-dot]]:bg-danger',
  off: 'text-text-muted [&>[data-slot=status-tag-dot]]:bg-status-offline',
  run: 'text-primary-text [&>[data-slot=status-tag-dot]]:bg-status-running',
}

export const StatusTag = React.forwardRef<HTMLSpanElement, StatusTagProps>(
  ({ children, className, tone = 'off', showDot = true, ...props }, ref) => (
    <span
      ref={ref}
      data-slot="status-tag"
      data-tone={tone}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm',
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      {showDot ? (
        <span
          aria-hidden="true"
          data-slot="status-tag-dot"
          className="size-(--status-dot-size) shrink-0 rounded-full"
        />
      ) : null}
      {children}
    </span>
  ),
)

StatusTag.displayName = 'StatusTag'
