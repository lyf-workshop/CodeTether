import { MonitorCog, RefreshCw, TriangleAlert } from 'lucide-react'

import { Button } from '@codetether/ui'

export function MachinesLoadingState() {
  return (
    <div className="space-y-4" aria-label="正在读取机器" aria-busy="true">
      <div className="h-36 animate-pulse rounded-lg border border-border bg-surface/55 motion-reduce:animate-none" />
    </div>
  )
}

export function MachinesErrorState({
  incompatible = false,
  onRetry,
}: {
  incompatible?: boolean
  onRetry: () => void
}) {
  return (
    <section className="grid min-h-64 place-items-center rounded-lg border border-danger/25 bg-danger-muted/20 px-6 py-10 text-center">
      <div className="max-w-md">
        <TriangleAlert
          aria-hidden="true"
          className="mx-auto size-8 text-danger"
        />
        <h1 className="mt-4 text-section font-semibold text-text-primary">
          {incompatible ? 'CodeTether 版本不兼容' : '暂时无法读取机器'}
        </h1>
        <p className="mt-1.5 text-sm text-text-secondary">
          {incompatible
            ? '请更新 CodeTether 后重试。'
            : '本地服务暂时不可用，机器记录和已有历史不会受到影响。'}
        </p>
        <Button variant="secondary" className="mt-5" onClick={onRetry}>
          <RefreshCw aria-hidden="true" />
          重试
        </Button>
      </div>
    </section>
  )
}

export function MachinesEmptyState() {
  return (
    <section className="grid min-h-64 place-items-center rounded-lg border border-border bg-surface/45 px-6 py-10 text-center">
      <div className="max-w-md">
        <MonitorCog
          aria-hidden="true"
          className="mx-auto size-8 text-text-muted"
        />
        <h1 className="mt-4 text-section font-semibold text-text-primary">
          没有可用的机器
        </h1>
        <p className="mt-1.5 text-sm text-text-secondary">
          CodeTether 尚未读取到本机记录。重新连接后再试。
        </p>
      </div>
    </section>
  )
}
