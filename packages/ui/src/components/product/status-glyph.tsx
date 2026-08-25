import type { ComponentPropsWithoutRef } from 'react'

import { cn } from '../../lib/cn'
import { statusDefinitions, type ExecutionStatus } from '../../tokens'

export interface StatusGlyphProps extends Omit<
  ComponentPropsWithoutRef<'span'>,
  'children'
> {
  status: ExecutionStatus
}

/** Compact canonical status icon for dense activity cards. */
export function StatusGlyph({ status, className, ...props }: StatusGlyphProps) {
  const definition = statusDefinitions[status]
  const Icon = definition.icon

  return (
    <span
      role="img"
      aria-label={`${definition.label} status`}
      data-status={status}
      data-slot="status-glyph"
      className={cn('inline-flex shrink-0', className)}
      {...props}
    >
      <Icon
        aria-hidden="true"
        className={cn('size-4', definition.iconClassName)}
      />
    </span>
  )
}

export interface StatusDotProps extends Omit<
  ComponentPropsWithoutRef<'span'>,
  'children'
> {
  status: ExecutionStatus
}

/** Canonically colored status dot used by compact list rows. */
export function StatusDot({ status, className, ...props }: StatusDotProps) {
  const definition = statusDefinitions[status]

  return (
    <span
      role="img"
      aria-label={`${definition.label} status`}
      data-status={status}
      data-slot="status-dot"
      className={cn(
        'size-2 shrink-0 rounded-full bg-current',
        definition.iconClassName,
        'motion-safe:animate-none',
        className,
      )}
      {...props}
    />
  )
}
