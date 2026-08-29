import type { ReactNode } from 'react'
import { FolderPlus, RefreshCw, ServerOff } from 'lucide-react'

import { Button } from '@codetether/ui'

interface ProjectsEmptyStateProps {
  action: ReactNode
}

export function ProjectsEmptyState({ action }: ProjectsEmptyStateProps) {
  return (
    <section className="grid min-h-80 place-items-center rounded-lg border border-dashed border-border bg-surface/35 px-6 py-12 text-center">
      <div className="max-w-sm">
        <span
          aria-hidden="true"
          className="mx-auto grid size-11 place-items-center rounded-md border border-border bg-surface-muted text-text-secondary"
        >
          <FolderPlus className="size-5" />
        </span>
        <h2 className="mt-4 text-section font-semibold text-text-primary">
          还没有项目
        </h2>
        <p className="mt-1.5 text-base font-regular text-text-secondary">
          将一个本地工作区添加到 CodeTether，即可开始创建智能体会话。
        </p>
        <div className="mt-5 flex justify-center">{action}</div>
      </div>
    </section>
  )
}

interface ProjectsErrorStateProps {
  incompatible?: boolean
  onRetry: () => void
  title?: string
}

export function ProjectsErrorState({
  incompatible = false,
  onRetry,
  title,
}: ProjectsErrorStateProps) {
  return (
    <section
      role="alert"
      className="grid min-h-64 place-items-center rounded-lg border border-border bg-surface/45 px-6 py-10 text-center"
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

export function ProjectsLoadingState() {
  return (
    <div aria-busy="true" aria-label="正在加载项目" className="space-y-4">
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="min-h-32 animate-pulse rounded-lg border border-border bg-surface/50 p-5 motion-reduce:animate-none"
        >
          <div className="flex items-start gap-4">
            <div className="size-11 rounded-md bg-surface-elevated" />
            <div className="min-w-0 flex-1 space-y-3 pt-1">
              <div className="h-4 w-40 rounded-full bg-surface-elevated" />
              <div className="h-3 w-3/5 rounded-full bg-surface-muted" />
              <div className="h-3 w-28 rounded-full bg-surface-muted" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
