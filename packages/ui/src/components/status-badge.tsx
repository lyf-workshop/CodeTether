import * as React from 'react'

import { Badge, type BadgeProps } from '@codetether/ui/components/badge'
import { cn } from '@codetether/ui/lib/cn'
import { statusDefinitions, type ExecutionStatus } from '@codetether/ui/tokens'

interface StatusBadgeProps extends Omit<
  BadgeProps,
  'asChild' | 'children' | 'variant'
> {
  status: ExecutionStatus
  showIcon?: boolean
}

const StatusBadge = React.forwardRef<HTMLSpanElement, StatusBadgeProps>(
  ({ className, showIcon = true, status, ...props }, ref) => {
    const definition = statusDefinitions[status]
    const Icon = definition.icon

    return (
      <Badge
        ref={ref}
        data-slot="status-badge"
        data-status={status}
        variant="outline"
        className={cn(
          'h-8 rounded-sm px-3',
          definition.badgeClassName,
          className,
        )}
        {...props}
      >
        {showIcon && (
          <Icon aria-hidden="true" className={definition.iconClassName} />
        )}
        {definition.label}
      </Badge>
    )
  },
)

StatusBadge.displayName = 'StatusBadge'

export { StatusBadge, type StatusBadgeProps }
