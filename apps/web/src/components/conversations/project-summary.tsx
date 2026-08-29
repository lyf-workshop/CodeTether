import { CircleCheck, TriangleAlert } from 'lucide-react'

import { Badge, cn } from '@codetether/ui'
import type { ProjectRecord } from '@codetether/protocol'

import type { ConversationStatusCounts } from './conversation-list-model'
import {
  compactProjectPath,
  projectFolderName,
} from '../projects/project-format'

interface ProjectSummaryProps {
  project: ProjectRecord
  summary: ConversationStatusCounts
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
  const available = project.availability === 'available'
  const AvailabilityIcon = available ? CircleCheck : TriangleAlert

  return (
    <section
      aria-labelledby="conversations-project-heading"
      className="grid min-h-[var(--layout-conversations-summary-height)] grid-cols-[minmax(12rem,1.5fr)_repeat(4,minmax(4.75rem,0.5fr))_auto] items-center gap-4 rounded-md border border-border bg-surface/65 px-4"
    >
      <div className="min-w-0">
        <h2
          id="conversations-project-heading"
          title={project.name}
          className="truncate text-base font-semibold text-text-primary"
        >
          {project.name}
        </h2>
        <p
          title={project.rootPath}
          className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-text-secondary"
        >
          <span className="shrink-0 font-medium text-text-primary">
            {projectFolderName(project.rootPath)}
          </span>
          <span className="min-w-0 truncate font-mono">
            {compactProjectPath(project.rootPath)}
          </span>
        </p>
      </div>

      <dl className="contents">
        <SummaryMetric label="全部会话" value={summary.total} />
        <SummaryMetric label="运行中" value={summary.running} />
        <SummaryMetric
          label="需要处理"
          value={summary.waiting + summary.failed}
          tone="warning"
        />
        <SummaryMetric label="已完成" value={summary.completed} />
      </dl>

      <Badge
        variant={available ? 'success' : 'warning'}
        className="h-7 rounded-sm px-2.5 text-xs font-medium"
      >
        <AvailabilityIcon aria-hidden="true" />
        {available ? '可用' : '不可用'}
      </Badge>
    </section>
  )
}

export type { ProjectSummaryProps }
