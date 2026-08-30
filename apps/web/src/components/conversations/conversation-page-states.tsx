import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import {
  MessageSquare,
  RefreshCw,
  ServerOff,
  TriangleAlert,
} from 'lucide-react'

import { Button } from '@codetether/ui'

export function ConversationsLoadingState() {
  return (
    <div aria-busy="true" aria-label="正在加载会话" className="space-y-4">
      <div className="h-24 animate-pulse rounded-md border border-border bg-surface/50 motion-reduce:animate-none" />
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="h-[var(--layout-conversations-row-height)] animate-pulse rounded-md border border-border bg-surface/45 motion-reduce:animate-none"
        />
      ))}
    </div>
  )
}

interface ConversationsErrorStateProps {
  incompatible?: boolean
  onRetry: () => void
  title?: string
}

export function ConversationsErrorState({
  incompatible = false,
  onRetry,
  title,
}: ConversationsErrorStateProps) {
  return (
    <section
      role="alert"
      className="grid min-h-64 place-items-center rounded-md border border-border bg-surface/45 px-6 py-10 text-center"
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

export function ConversationsEmptyState({ action }: { action?: ReactNode }) {
  return (
    <section className="grid min-h-64 place-items-center rounded-md border border-dashed border-border bg-surface/35 px-6 py-10 text-center">
      <div className="max-w-sm">
        <span
          aria-hidden="true"
          className="mx-auto grid size-11 place-items-center rounded-md border border-border bg-surface-muted text-text-secondary"
        >
          <MessageSquare className="size-5" />
        </span>
        <h2 className="mt-4 text-section font-semibold text-text-primary">
          还没有会话
        </h2>
        <p className="mt-1.5 text-base font-regular text-text-secondary">
          在这个项目中创建一个智能体会话，即可开始工作。
        </p>
        {action ? (
          <div className="mt-5 flex justify-center">{action}</div>
        ) : null}
      </div>
    </section>
  )
}

export function ConversationsNotFoundState() {
  return (
    <section className="grid min-h-64 place-items-center rounded-md border border-border bg-surface/45 px-6 py-10 text-center">
      <div className="max-w-md">
        <h2 className="text-section font-semibold text-text-primary">
          项目不存在
        </h2>
        <p className="mt-1.5 text-base font-regular text-text-secondary">
          该项目可能已被移除，或链接中的项目标识无效。
        </p>
        <Button asChild variant="secondary" className="mt-5">
          <Link to="/projects">返回项目列表</Link>
        </Button>
      </div>
    </section>
  )
}

export function ProjectUnavailableNotice() {
  return (
    <section
      role="status"
      className="mt-4 flex min-w-0 items-start gap-3 rounded-md border border-warning/30 bg-warning-muted/40 px-4 py-3"
    >
      <TriangleAlert
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-warning"
      />
      <div className="min-w-0">
        <h2 className="text-sm font-medium text-text-primary">
          项目目录当前不可用
        </h2>
        <p className="mt-0.5 text-sm font-regular text-text-secondary">
          持久化会话历史仍可查看，但恢复目录前不能创建或继续会话。
        </p>
      </div>
    </section>
  )
}

export function ConversationLimitNotice() {
  return (
    <p className="mt-3 text-xs font-regular text-text-muted" role="status">
      当前显示前 100 个会话。其余历史将在后续分页能力中提供。
    </p>
  )
}
