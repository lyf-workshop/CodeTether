import { Check, GitBranch } from 'lucide-react'

import { Badge, cn } from '@codetether/ui'

import type {
  ConversationListSummaryMock,
  ConversationsProjectMock,
} from '../../mocks/conversations'

interface ProjectSummaryProps {
  project: ConversationsProjectMock
  summary: ConversationListSummaryMock
}

interface SummaryMetricProps {
  label: string
  value: number
  tone?: 'default' | 'warning'
}

function SummaryMetric({ label, tone = 'default', value }: SummaryMetricProps) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs font-regular text-text-muted">{label}</dt>
      <dd
        className={cn(
          'mt-1 text-section font-semibold tabular-nums',
          tone === 'warning' ? 'text-warning' : 'text-text-primary',
        )}
      >
        {value}
      </dd>
    </div>
  )
}

export function ProjectSummary({ project, summary }: ProjectSummaryProps) {
  return (
    <section
      aria-labelledby="conversations-project-heading"
      className="grid min-h-[var(--layout-conversations-summary-height)] grid-cols-[minmax(11rem,1.25fr)_repeat(3,minmax(4.75rem,0.5fr))_minmax(9rem,1fr)_auto] items-center gap-4 rounded-md border border-border bg-surface/65 px-4"
    >
      <div className="min-w-0">
        <h2
          id="conversations-project-heading"
          className="truncate text-base font-semibold text-text-primary"
        >
          {project.name}
        </h2>
        <p className="mt-1 truncate font-mono text-xs font-regular text-text-secondary">
          {project.path}
        </p>
      </div>

      <dl className="contents">
        <SummaryMetric label="活跃会话" value={summary.running} />
        <SummaryMetric
          label="需要处理"
          value={summary.waiting}
          tone="warning"
        />
        <SummaryMetric label="本周完成" value={summary.completedThisWeek} />
      </dl>

      <div className="min-w-0">
        <p className="text-xs font-regular text-text-muted">最近活动</p>
        <p className="mt-1 truncate text-sm font-regular text-text-primary">
          {project.recentActivity}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Badge
          variant="outline"
          className="h-7 rounded-sm bg-surface-elevated px-2.5 font-mono text-xs font-regular"
        >
          <GitBranch aria-hidden="true" />
          {project.branch}
        </Badge>
        <Badge
          variant="success"
          className="h-7 rounded-sm px-2.5 text-xs font-medium"
        >
          <Check aria-hidden="true" />
          {project.gitStatus}
        </Badge>
      </div>
    </section>
  )
}

export type { ProjectSummaryProps }
