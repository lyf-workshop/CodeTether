import type { ComponentPropsWithoutRef, ReactNode } from 'react'

import { Badge } from '../badge'
import { Card } from '../card'
import { StatusBadge } from '../status-badge'
import { cn } from '../../lib/cn'
import {
  agentDefinitions,
  type AgentId,
  type ExecutionStatus,
} from '../../tokens'
import { AgentIdentityMark } from './agent-badge'
import { MachineBadge } from './machine-badge'

export interface QuestionCardProps extends Omit<
  ComponentPropsWithoutRef<'article'>,
  'children' | 'title'
> {
  agent: AgentId
  title: string
  question: string
  project?: string
  machine?: string
  timestamp?: string
  status?: ExecutionStatus
  secondaryAction?: ReactNode
  primaryAction?: ReactNode
}

/** Presentational agent question derived from Figma node 15:348. */
export function QuestionCard({
  agent,
  title,
  question,
  project,
  machine,
  timestamp,
  status = 'waiting',
  secondaryAction,
  primaryAction,
  className,
  ...props
}: QuestionCardProps) {
  const agentDefinition = agentDefinitions[agent]

  return (
    <Card
      asChild
      className={cn(
        'w-full min-w-0 flex-row flex-wrap items-start gap-3 rounded-md border-border bg-surface px-4 pt-4 pb-2 shadow-none',
        className,
      )}
    >
      <article data-slot="question-card" {...props}>
        <AgentIdentityMark agent={agent} className="rounded-sm" />

        <div className="min-w-0 flex-1 basis-80">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
            <p className="text-xs font-medium text-text-secondary">
              {agentDefinition.name}
            </p>
            <StatusBadge
              status={status}
              showIcon={false}
              className="h-6 rounded-full px-2 text-2xs"
            />
          </div>
          <h3 className="mt-1 text-base font-semibold text-text-primary">
            {title}
          </h3>
          <p className="mt-1 text-xs text-text-secondary">{question}</p>

          {project || machine || timestamp ? (
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
              {project ? (
                <Badge
                  variant="outline"
                  className="h-7 max-w-full rounded-sm border-border-strong bg-surface-elevated px-2 text-xs font-medium text-text-secondary"
                >
                  <span className="truncate">{project}</span>
                </Badge>
              ) : null}
              {machine ? <MachineBadge name={machine} /> : null}
              {timestamp ? (
                <span className="text-2xs text-text-muted">{timestamp}</span>
              ) : null}
            </div>
          ) : null}
        </div>

        {secondaryAction || primaryAction ? (
          <div className="mt-0 ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2 self-start sm:mt-6">
            {secondaryAction}
            {primaryAction}
          </div>
        ) : null}
      </article>
    </Card>
  )
}
