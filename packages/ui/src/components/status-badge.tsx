import * as React from 'react'

import type { BadgeProps } from '@codetether/ui/components/badge'
import {
  StatusTag,
  type StatusTone,
} from '@codetether/ui/components/status-tag'
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

    return (
      <StatusTag
        ref={ref}
        data-slot="status-badge"
        data-status={status}
        tone={statusTones[status]}
        showDot={showIcon}
        className={className}
        {...props}
      >
        {definition.label}
      </StatusTag>
    )
  },
)

const statusTones: Record<ExecutionStatus, StatusTone> = {
  idle: 'off',
  thinking: 'run',
  running: 'run',
  waiting: 'warn',
  completed: 'ok',
  failed: 'err',
  offline: 'off',
}

StatusBadge.displayName = 'StatusBadge'

export { StatusBadge, type StatusBadgeProps }
