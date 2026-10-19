import type { AttentionListResponse } from '@codetether/protocol'
import { cn } from '@codetether/ui'
import type { InboxFilter } from './inbox-model'

interface InboxSummaryProps {
  readonly activeFilter: InboxFilter
  readonly onFilterChange: (filter: InboxFilter) => void
  readonly summary: AttentionListResponse['summary']
}

/** Counts are the Host summary, not recomputed from the retained bounded rows. */
export function InboxSummary({
  activeFilter,
  onFilterChange,
  summary,
}: InboxSummaryProps) {
  const items = [
    { filter: 'all', label: '全部', count: summary.totalOpen },
    { filter: 'approval', label: '等待批准', count: summary.approvalOpen },
    {
      filter: 'completed_review',
      label: '待查看',
      count: summary.completedReviewOpen,
    },
    { filter: 'failed', label: '失败', count: summary.failedOpen },
  ] as const
  return (
    <section
      aria-label="待处理筛选"
      className="flex max-w-full overflow-x-auto"
    >
      <div className="inline-flex shrink-0 gap-0.5 rounded-md border border-border bg-surface-inset p-1">
        {items.map((item) => (
          <button
            type="button"
            key={item.filter}
            aria-pressed={activeFilter === item.filter}
            aria-label={'筛选' + item.label + '，' + item.count + ' 项'}
            onClick={() => onFilterChange(item.filter)}
            className={cn(
              'flex h-8 items-center gap-1.5 whitespace-nowrap rounded-sm px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
              activeFilter === item.filter
                ? 'border border-border bg-surface text-text-primary'
                : 'border border-transparent text-text-secondary hover:text-text-primary',
            )}
          >
            <span>{item.label}</span>
            <span className="text-xs tabular-nums text-text-muted">
              {item.count}
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
