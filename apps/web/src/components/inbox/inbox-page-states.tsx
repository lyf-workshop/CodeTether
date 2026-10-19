import { RefreshCw, ServerOff } from 'lucide-react'

import { Button } from '@codetether/ui'

interface InboxErrorStateProps {
  incompatible?: boolean
  onRetry: () => void
  title?: string
}

export function InboxErrorState({
  incompatible = false,
  onRetry,
  title,
}: InboxErrorStateProps) {
  return (
    <section
      role="alert"
      className="grid min-h-[var(--layout-inbox-empty-height)] place-items-center rounded-md border border-border bg-surface/35 px-6 text-center"
    >
      <div className="max-w-md">
        <span
          aria-hidden="true"
          className="mx-auto grid size-11 place-items-center rounded-md border border-border bg-surface-muted text-text-secondary"
        >
          <ServerOff className="size-5" />
        </span>
        <h2 className="mt-4 text-section font-semibold text-text-primary">
          {title ??
            (incompatible
              ? 'CodeTether 版本不兼容'
              : 'CodeTether 暂时无法连接')}
        </h2>
        <p className="mt-1.5 text-base font-regular text-text-secondary">
          {incompatible
            ? '当前应用与本地服务版本不兼容，请更新 CodeTether 后重试。'
            : '本地服务暂时不可用，请稍后重试。'}
        </p>
        <Button variant="secondary" className="mt-5" onClick={onRetry}>
          <RefreshCw aria-hidden="true" />
          重试
        </Button>
      </div>
    </section>
  )
}

export function InboxLoadingState() {
  return (
    <div aria-busy="true" aria-label="正在加载待处理事项" className="space-y-4">
      <div className="h-10 w-full max-w-sm animate-pulse rounded-md bg-surface-muted motion-reduce:animate-none" />
      <div className="divide-y divide-border overflow-hidden rounded-md border border-border">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="min-w-0 animate-pulse bg-surface p-4 motion-reduce:animate-none"
          >
            <div className="h-4 w-2/5 rounded bg-surface-muted" />
            <div className="mt-3 h-3 w-3/5 rounded bg-surface-muted" />
            <div className="mt-3 h-3 w-1/3 rounded bg-surface-muted" />
          </div>
        ))}
      </div>
    </div>
  )
}
