import { Link } from '@tanstack/react-router'
import { CheckCircle2, FolderOpen, ListFilter } from 'lucide-react'

import { Button } from '@codetether/ui'

import type { InboxFilter } from './inbox-model'

interface InboxEmptyStateProps {
  activeFilter: InboxFilter
  onReset: () => void
}

export function InboxEmptyState({
  activeFilter,
  onReset,
}: InboxEmptyStateProps) {
  const isFiltered = activeFilter !== 'all'

  return (
    <div className="grid min-h-[var(--layout-inbox-empty-height)] place-items-center rounded-md border border-dashed border-border bg-surface/30 px-6 text-center">
      <div className="max-w-md">
        <span
          aria-hidden="true"
          className="mx-auto grid size-10 place-items-center rounded-full bg-success-muted text-success"
        >
          <CheckCircle2 className="size-5" />
        </span>
        <h2 className="mt-3 text-base font-semibold text-text-primary">
          {isFiltered ? '当前筛选下没有待处理事项' : '暂无待处理事项'}
        </h2>
        <p className="mt-1 text-sm font-regular text-text-secondary">
          {isFiltered
            ? '可以切换筛选条件，查看其他需要关注的 Agent 事项。'
            : '当前没有需要你审批、查看或确认的 Agent 事项。'}
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          {isFiltered ? (
            <Button size="sm" variant="outline" onClick={onReset}>
              <ListFilter aria-hidden="true" />
              查看全部
            </Button>
          ) : null}
          <Button asChild size="sm" variant={isFiltered ? 'ghost' : 'outline'}>
            <Link to="/projects">
              <FolderOpen aria-hidden="true" />
              查看会话
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
