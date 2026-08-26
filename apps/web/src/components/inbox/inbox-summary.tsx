import type { LucideIcon } from 'lucide-react'
import {
  CircleCheck,
  MessageCircleQuestion,
  ShieldQuestion,
  TriangleAlert,
} from 'lucide-react'

import { Badge, cn } from '@codetether/ui'

import type {
  InboxSummaryMock,
  InboxTodayOverviewMock,
} from '../../mocks/inbox'
import type { InboxFilter } from './inbox-filters'

interface InboxSummaryProps {
  activeFilter: InboxFilter
  onFilterChange: (filter: InboxFilter) => void
  summary: InboxSummaryMock
  todayOverview: InboxTodayOverviewMock
}

interface SummaryItem {
  caption: string
  filter: Exclude<InboxFilter, 'all' | 'unread'>
  icon: LucideIcon
  label: string
  tone: string
  value: number
}

export function InboxSummary({
  activeFilter,
  onFilterChange,
  summary,
  todayOverview,
}: InboxSummaryProps) {
  const items: readonly SummaryItem[] = [
    {
      caption: 'Shell、文件与网络权限',
      filter: 'approval',
      icon: ShieldQuestion,
      label: '需要审批',
      tone: 'bg-warning-muted text-warning',
      value: summary.approvals,
    },
    {
      caption: '智能体等待你的输入',
      filter: 'question',
      icon: MessageCircleQuestion,
      label: '需要回复',
      tone: 'bg-info-muted text-info',
      value: summary.replies,
    },
    {
      caption: '任务完成，等待检查',
      filter: 'completed',
      icon: CircleCheck,
      label: '完成待查看',
      tone: 'bg-success-muted text-success',
      value: summary.completed,
    },
    {
      caption: '执行失败或机器离线',
      filter: 'failed',
      icon: TriangleAlert,
      label: '失败任务',
      tone: 'bg-danger-muted text-danger',
      value: summary.failed,
    },
  ]

  return (
    <section
      aria-label="收件箱摘要"
      className="grid min-w-0 grid-cols-[repeat(4,minmax(0,12.75rem))_minmax(17.5rem,1fr)] gap-4"
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

      <div className="ml-6 flex h-[var(--layout-inbox-summary-height)] min-w-0 items-center rounded-md border border-border bg-surface/45 px-4">
        <div className="w-full min-w-0">
          <p className="text-md font-semibold text-text-primary">今日概览</p>
          <div className="mt-3 flex min-w-0 items-center gap-4">
            <OverviewMetric label="待处理" value={todayOverview.pending} />
            <OverviewMetric
              label="平均响应"
              labelClassName="hidden min-[1360px]:inline"
              value={todayOverview.averageResponseTime}
            />
            <Badge
              variant={todayOverview.highRisk > 0 ? 'danger' : 'secondary'}
              className="ml-auto h-6 rounded-full border-transparent px-2.5 text-xs"
            >
              {todayOverview.highRisk} 高风险
            </Badge>
          </div>
        </div>
      </div>
    </section>
  )
}

interface OverviewMetricProps {
  label: string
  labelClassName?: string
  value: number | string
}

function OverviewMetric({ label, labelClassName, value }: OverviewMetricProps) {
  return (
    <span className="flex min-w-0 shrink-0 items-baseline gap-2">
      <span className="truncate text-base font-semibold tabular-nums text-text-primary">
        {value}
      </span>
      <span
        className={cn(
          'truncate text-xs font-regular text-text-muted',
          labelClassName,
        )}
      >
        {label}
      </span>
    </span>
  )
}
