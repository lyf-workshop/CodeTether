import { Button, cn } from '@codetether/ui'
import type { AttentionListResponse } from '@codetether/protocol'

import type { InboxFilter } from './inbox-model'

interface InboxFiltersProps {
  activeFilter: InboxFilter
  onFilterChange: (filter: InboxFilter) => void
  summary: AttentionListResponse['summary']
}

export function InboxFilters({
  activeFilter,
  onFilterChange,
  summary,
}: InboxFiltersProps) {
  const filters: readonly {
    count: number
    label: string
    value: InboxFilter
  }[] = [
    { count: summary.totalOpen, label: '全部', value: 'all' },
    { count: summary.approvalOpen, label: '审批', value: 'approval' },
    {
      count: summary.completedReviewOpen,
      label: '完成',
      value: 'completed_review',
    },
    { count: summary.failedOpen, label: '失败', value: 'failed' },
  ]

  return (
    <div
      role="group"
      aria-label="筛选需要处理的事项"
      className="flex min-w-0 items-center gap-1.5"
    >
      {filters.map((filter) => {
        const selected = filter.value === activeFilter

        return (
          <Button
            key={filter.value}
            size="sm"
            variant="secondary"
            aria-label={`${filter.label}，${filter.count} 项`}
            aria-pressed={selected}
            onClick={() => onFilterChange(filter.value)}
            className={cn(
              'h-7 min-w-[var(--layout-inbox-filter-width)] rounded-sm px-2.5 text-xs font-medium tabular-nums',
              selected
                ? 'border-primary bg-primary-muted text-primary hover:border-primary hover:bg-primary-muted'
                : 'border-border bg-surface-muted/70 text-text-secondary hover:border-border-strong hover:bg-surface-muted',
            )}
          >
            {filter.label}
          </Button>
        )
      })}
    </div>
  )
}
