import type { ComponentPropsWithoutRef } from 'react'

import { Badge } from '../badge'
import { cn } from '../../lib/cn'
import { agentDefinitions, type AgentId } from '../../tokens'

export interface AgentBadgeProps extends Omit<
  ComponentPropsWithoutRef<'span'>,
  'children'
> {
  agent: AgentId
  variant?: 'default' | 'compact'
}

/** Visual-only agent badge based on 7:1449, with 14:137 as compact mode. */
export function AgentBadge({
  agent,
  variant = 'default',
  className,
  ...props
}: AgentBadgeProps) {
  const definition = agentDefinitions[agent]
  const isCompact = variant === 'compact'

  return (
    <Badge
      variant="outline"
      data-agent={agent}
      data-slot="agent-badge"
      data-appearance={variant}
      className={cn(
        isCompact
          ? 'h-7 rounded-sm border-border-strong bg-surface-elevated px-2 text-xs font-medium text-text-secondary'
          : 'h-9 min-w-31 justify-start gap-2.5 rounded-md border-border-strong bg-surface-muted py-1 pr-3 pl-1.5 text-md font-medium text-text-primary',
        className,
      )}
      {...props}
    >
      {isCompact ? null : (
        <span
          aria-hidden="true"
          className={cn(
            'grid size-[var(--avatar-size-sm)] shrink-0 place-items-center rounded-md border text-base font-semibold',
            definition.accentClassName,
          )}
        >
          {definition.icon}
        </span>
      )}
      <span className="truncate">{definition.shortName}</span>
    </Badge>
  )
}

export interface AgentIdentityMarkProps extends Omit<
  ComponentPropsWithoutRef<'div'>,
  'children'
> {
  agent: AgentId
}

/** Shared 42px identity mark used by Figma permission and question cards. */
export function AgentIdentityMark({
  agent,
  className,
  ...props
}: AgentIdentityMarkProps) {
  const definition = agentDefinitions[agent]

  return (
    <div
      role="img"
      aria-label={`${definition.name} 标识`}
      data-agent={agent}
      data-slot="agent-identity-mark"
      className={cn(
        'grid size-[var(--avatar-size-md)] shrink-0 place-items-center rounded-md border text-md font-semibold',
        definition.accentClassName,
        className,
      )}
      {...props}
    >
      {definition.icon}
    </div>
  )
}
