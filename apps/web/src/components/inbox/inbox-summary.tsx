import type { LucideIcon } from 'lucide-react'
import {
  CircleCheck,
  ListTodo,
  ShieldQuestion,
  TriangleAlert,
} from 'lucide-react'

import { cn } from '@codetether/ui'
import type { AttentionListResponse } from '@codetether/protocol'

import type { InboxFilter } from './inbox-model'

interface InboxSummaryProps {
  activeFilter: InboxFilter
  onFilterChange: (filter: InboxFilter) => void
  summary: AttentionListResponse['summary']
}

interface SummaryItem {
  caption: string
  filter: InboxFilter
  icon: LucideIcon
  label: string
  tone: string
  value: number
}

export function InboxSummary({
  activeFilter,
  onFilterChange,
  summary,
}: InboxSummaryProps) {
  const items: readonly SummaryItem[] = [
    {
      caption: '当前所有需要处理或查看的事项',
      filter: 'all',
      icon: ListTodo,
      label: '待处理总数',
      tone: 'bg-primary-muted text-primary',
      value: summary.totalOpen,
    },
    {
      caption: '等待你的明确允许或拒绝',
      filter: 'approval',
      icon: ShieldQuestion,
      label: '需要审批',
      tone: 'bg-warning-muted text-warning',
      value: summary.approvalOpen,
    },
    {
      caption: 'Agent 已完成，等待查看结果',
      filter: 'completed_review',
      icon: CircleCheck,
      label: '完成待查看',
      tone: 'bg-success-muted text-success',
      value: summary.completedReviewOpen,
    },
    {
      caption: 'Turn 失败，等待确认',
      filter: 'failed',
      icon: TriangleAlert,
      label: '失败',
      tone: 'bg-danger-muted text-danger',
      value: summary.failedOpen,
    },
  ]

  return (
    <section
      aria-label="收件箱摘要"
      className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4"
    >
      {items.map((item) => {
        const Icon = item.icon
        const selected = activeFilter === item.filter

        return (
          <button
            key={item.filter}
            type="button"
            aria-label={`筛选${item.label}，${item.value} 项`}
            aria-pressed={selected}
            onClick={() => onFilterChange(item.filter)}
            className={cn(
              'group flex h-[var(--layout-inbox-summary-height)] min-w-0 flex-col justify-center rounded-md border border-border bg-surface/65 px-4 text-left outline-none',
              'transition-colors duration-150 motion-reduce:transition-none hover:border-border-strong hover:bg-surface-muted/65',
              'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/45',
              selected && 'border-primary/55 bg-primary-muted/30',
            )}
          >
            <span className="flex min-w-0 items-start gap-3">
              <span
                aria-hidden="true"
                className={cn(
                  'grid size-9.5 shrink-0 place-items-center rounded-md',
                  item.tone,
                )}
              >
                <Icon className="size-[1.125rem]" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-md font-semibold text-text-primary">
                  {item.label}
                </span>
                <span className="mt-0.5 block text-section font-semibold tabular-nums text-text-primary">
                  {item.value}
                </span>
              </span>
            </span>
            <span className="mt-1.5 block truncate text-xs font-regular text-text-muted">
              {item.caption}
            </span>
          </button>
        )
      })}
    </section>
  )
}
