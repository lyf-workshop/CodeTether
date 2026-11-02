import { Link } from '@tanstack/react-router'
import { Button, Notice } from '@codetether/ui'

/** The route carries only a bounded historical failure marker, never an error. */
export function AttentionReviewNotice() {
  return (
    <div className="shrink-0 px-4 py-3">
      <Notice
        role="alert"
        tone="warn"
        title="未能更新待处理状态"
        action={
          <Button asChild variant="secondary" size="sm">
            <Link to="/inbox">返回待处理</Link>
          </Button>
        }
      >
        刚才未能更新待处理状态，结果仍可查看。该事项可能仍在待处理中，请返回待处理检查。
      </Notice>
    </div>
  )
}
