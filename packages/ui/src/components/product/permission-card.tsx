import type { ComponentPropsWithoutRef, ReactNode } from 'react'

import { Badge } from '../badge'
import { Card } from '../card'
import { cn } from '../../lib/cn'
import {
  agentDefinitions,
  riskDefinitions,
  type AgentId,
  type PermissionRisk,
} from '../../tokens'
import { AgentIdentityMark } from './agent-badge'

export interface PermissionCardProps extends Omit<
  ComponentPropsWithoutRef<'article'>,
  'children' | 'title'
> {
  agent: AgentId
  title: string
  description?: string
  command?: string
  risk: PermissionRisk
  context?: ReactNode
  secondaryAction?: ReactNode
  primaryAction?: ReactNode
}

/** Presentational approval request matching Permission / Card (19:453). */
export function PermissionCard({
  agent,
  title,
  description,
  command,
  risk,
  context,
  secondaryAction,
  primaryAction,
  className,
  ...props
}: PermissionCardProps) {
  const agentDefinition = agentDefinitions[agent]
  const riskDefinition = riskDefinitions[risk]
  const RiskIcon = riskDefinition.icon

  return (
    <Card
      asChild
      className={cn(
        'min-h-48 w-full min-w-0 gap-3 rounded-lg border-border bg-surface p-4 shadow-none',
        className,
      )}
    >
      <article data-slot="permission-card" {...props}>
        <header className="flex min-w-0 items-start gap-3">
          <AgentIdentityMark agent={agent} />
          <div className="min-w-0 flex-1 pt-0.5">
            <span className="sr-only">{agentDefinition.name}: </span>
            <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
            {description ? (
              <p className="mt-1 text-xs text-text-secondary">{description}</p>
            ) : null}
          </div>
        </header>

        {command ? (
          <code className="block min-w-0 overflow-x-auto whitespace-pre font-sans text-sm font-medium text-text-primary">
            {command}
          </code>
        ) : null}

        {context ? (
          <div className="min-w-0 text-xs text-text-secondary">{context}</div>
        ) : null}

        <footer className="mt-auto flex min-w-0 flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            data-risk={risk}
            className={cn('h-7 rounded-sm px-2', riskDefinition.badgeClassName)}
          >
            <RiskIcon aria-hidden="true" />
            {riskDefinition.label}
          </Badge>
          {secondaryAction || primaryAction ? (
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              {secondaryAction}
              {primaryAction}
            </div>
          ) : null}
        </footer>
      </article>
    </Card>
  )
}
