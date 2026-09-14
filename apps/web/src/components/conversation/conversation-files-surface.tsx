import { ArrowUpRight, FileCode2 } from 'lucide-react'

import { Button, cn } from '@codetether/ui'

import type { ConversationChangesViewModel } from './conversation-view-model'

export interface ConversationFilesSurfaceProps {
  readonly changes: ConversationChangesViewModel
  readonly onOpenChange?: (changeId: string) => void
  readonly selectedChangeId?: string
  readonly supportsDiff: boolean
}

/** Shows only file paths already present in the trusted Conversation projection. */
export function ConversationFilesSurface({
  changes,
  onOpenChange,
  selectedChangeId,
  supportsDiff,
}: ConversationFilesSurfaceProps) {
  if (changes.files.length === 0) {
    return (
      <p role="status" className="text-sm text-text-muted">
        {supportsDiff
          ? '本次会话没有已知文件变更。'
          : '当前 Agent 未提供文件变更信息。'}
      </p>
    )
  }

  return (
    <ul aria-label={`${changes.files.length} 个已知文件`} className="space-y-1">
      {changes.files.map((change) => {
        const canOpen = supportsDiff && onOpenChange !== undefined
        return (
          <li key={change.id} className="min-w-0">
            <div
              className={cn(
                'grid min-h-12 min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 rounded-sm px-1.5 py-1',
                selectedChangeId === change.id && 'bg-primary-muted/45',
              )}
            >
              <FileCode2
                aria-hidden="true"
                className="size-3.5 shrink-0 text-text-muted"
              />
              <span
                className="min-w-0 flex-1 truncate text-sm text-text-primary"
                title={change.path}
              >
                {change.path}
              </span>
              <span className="flex shrink-0 items-center gap-1 text-xs tabular-nums">
                <span className="text-success/90">+{change.additions}</span>
                {change.deletions > 0 ? (
                  <span className="text-danger/90">-{change.deletions}</span>
                ) : null}
              </span>
              {canOpen ? (
                <Button
                  type="button"
                  aria-label={`打开 ${change.path} 的变更`}
                  variant="ghost"
                  size="sm"
                  className="col-start-2 h-7 w-fit px-1 text-xs text-text-secondary"
                  onClick={() => onOpenChange?.(change.id)}
                >
                  <ArrowUpRight aria-hidden="true" />
                  查看变更
                </Button>
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
