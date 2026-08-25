import type { ComponentPropsWithoutRef } from 'react'

import { Badge } from '../badge'
import { cn } from '../../lib/cn'

export interface MachineBadgeProps extends Omit<
  ComponentPropsWithoutRef<'span'>,
  'children'
> {
  name: string
}

/** Compact machine identity label based on Figma node 14:143. */
export function MachineBadge({ name, className, ...props }: MachineBadgeProps) {
  return (
    <Badge
      variant="outline"
      data-slot="machine-badge"
      className={cn(
        'h-7 max-w-full rounded-sm border-border-strong bg-surface-elevated px-2 text-xs font-medium text-text-secondary',
        className,
      )}
      {...props}
    >
      <span className="truncate">{name}</span>
    </Badge>
  )
}
