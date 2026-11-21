import { ChevronRight } from 'lucide-react'
import { cn } from '@codetether/ui'

export function PreviousConversationsCompactHeader({
  count,
  problemSummary,
  expanded,
  contentId,
  onToggle,
}: {
  count?: number
  problemSummary: string
  expanded: boolean
  contentId: string
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={contentId}
      className="flex w-full min-w-0 items-center gap-2 rounded-xs text-left text-sm text-text-secondary outline-none hover:text-text-primary focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onToggle}
    >
      <ChevronRight
        aria-hidden="true"
        className={cn('size-4 shrink-0', expanded && 'rotate-90')}
      />
      <span className="shrink-0 font-medium text-text-primary">
        {count === undefined ? '以前的会话' : `发现 ${count} 个以前的会话`}
      </span>
      {problemSummary ? (
        <span className="min-w-0 truncate text-xs" title={problemSummary}>
          · {problemSummary}
        </span>
      ) : null}
    </button>
  )
}
