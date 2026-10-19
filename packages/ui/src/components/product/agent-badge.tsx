import type { ComponentPropsWithoutRef } from 'react'
import { Bot, Code, Sparkles } from 'lucide-react'

import { cn } from '../../lib/cn'
import { agentDefinitions, type AgentId } from '../../tokens'

export interface AgentBadgeProps extends Omit<
  ComponentPropsWithoutRef<'span'>,
  'children'
> {
  agent: AgentId
  variant?: 'default' | 'compact'
  size?: 'sm' | 'md' | 'lg'
}

const agentIcons = { codex: Bot, claude: Sparkles, opencode: Code } as const
const agentSizes = {
  sm: 'size-(--avatar-size-xs) rounded-xs [&>svg]:size-2.5',
  md: 'size-(--avatar-size-sm) rounded-xs [&>svg]:size-3',
  lg: 'size-(--avatar-size-md) rounded-sm [&>svg]:size-4',
} as const

/** Provider identity only; marks are abstract interface icons, not brand logos. */
export function AgentBadge({
  agent,
  variant = 'default',
  size = 'md',
  className,
  ...props
}: AgentBadgeProps) {
  const definition = agentDefinitions[agent]
  const isCompact = variant === 'compact'
  const Icon = agentIcons[agent]

  return (
    <span
      data-agent={agent}
      data-slot="agent-badge"
      data-appearance={variant}
      data-size={size}
      className={cn(
        'inline-flex max-w-full shrink-0 items-center gap-1.5 whitespace-nowrap text-sm text-text-secondary',
        className,
      )}
      {...props}
    >
      {isCompact ? null : (
        <span
          aria-hidden="true"
          className={cn(
            'grid shrink-0 place-items-center',
            agentSizes[size],
            definition.accentClassName,
          )}
        >
          <Icon aria-hidden="true" />
        </span>
      )}
      <span className="truncate">{definition.name}</span>
    </span>
  )
}

export interface AgentIdentityMarkProps extends Omit<
  ComponentPropsWithoutRef<'div'>,
  'children'
> {
  agent: AgentId
}

/** Shared identity mark for permission and question cards. */
export function AgentIdentityMark({
  agent,
  className,
  ...props
}: AgentIdentityMarkProps) {
  const definition = agentDefinitions[agent]
  const Icon = agentIcons[agent]

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
      <Icon aria-hidden="true" className="size-4" />
    </div>
  )
}
