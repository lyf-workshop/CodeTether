import type { ReactNode } from 'react'
import { ArrowRight, FolderOpen, LoaderCircle, RefreshCw } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@codetether/ui'
import {
  doctorStateBadgeVariant,
  doctorStateLabel,
  onboardingConnectionStateLabel,
} from './onboarding-model'

export function PrimaryContinue({
  busy,
  children,
  disabled = false,
  onClick,
}: {
  readonly busy: boolean
  readonly children: ReactNode
  readonly disabled?: boolean
  readonly onClick: () => void
}) {
  return (
    <Button type="button" disabled={busy || disabled} onClick={onClick}>
      {busy ? (
        <LoaderCircle
          aria-hidden="true"
          className="animate-spin motion-reduce:animate-none"
        />
      ) : null}
      {children}
      {!busy ? <ArrowRight aria-hidden="true" /> : null}
    </Button>
  )
}

export function StatusRow({
  detail,
  label,
  state,
  statusLabel,
}: {
  readonly detail: string
  readonly label: string
  readonly state: Parameters<typeof doctorStateLabel>[0]
  readonly statusLabel?: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-md border border-border bg-surface-muted px-4 py-3 text-left">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-text-primary">
          {label}
        </span>
        <span
          title={detail}
          className="mt-0.5 block truncate text-xs text-text-muted"
        >
          {detail}
        </span>
      </span>
      <Badge variant={doctorStateBadgeVariant(state)}>
        {statusLabel ?? doctorStateLabel(state)}
      </Badge>
    </div>
  )
}

export function SetupLoading({
  failed,
  onRetry,
}: {
  readonly failed: boolean
  readonly onRetry: () => void
}) {
  return (
    <div className="grid min-h-dvh place-items-center bg-background p-6 text-text-primary">
      <div
        className="text-center"
        role={failed ? 'alert' : 'status'}
        aria-live="polite"
      >
        {failed ? null : (
          <LoaderCircle
            aria-hidden="true"
            className="mx-auto size-6 animate-spin text-primary motion-reduce:animate-none"
          />
        )}
        <p className="mt-3 text-sm text-text-secondary">
          {failed
            ? '暂时无法读取设置状态。请确认 CodeTether 正在运行后重试。'
            : '正在准备 CodeTether…'}
        </p>
        {failed ? (
          <Button className="mt-4" type="button" onClick={onRetry}>
            <RefreshCw aria-hidden="true" />
            重新检查
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export function SetupUnavailable({
  connectionState,
  onRetry,
}: {
  readonly connectionState: string
  readonly onRetry: () => void
}) {
  return (
    <div className="grid min-h-dvh place-items-center bg-background p-6 text-text-primary">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>无法连接到 CodeTether</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-text-secondary">
            你的已有项目和会话没有改变。请稍候，然后重新检查。
          </p>
          <details className="mt-4 text-xs text-text-muted">
            <summary className="cursor-pointer">技术详情</summary>
            <p className="mt-2">
              连接状态：{onboardingConnectionStateLabel(connectionState)}
            </p>
          </details>
          <Button className="mt-5" type="button" onClick={onRetry}>
            <RefreshCw aria-hidden="true" />
            重新检查
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

export function InvalidSetupState({
  busy,
  onReselectProject,
}: {
  readonly busy: boolean
  readonly onReselectProject: () => void
}) {
  return (
    <div className="rounded-md border border-danger/30 bg-danger-muted p-4 text-sm text-danger-text">
      <p role="alert">
        此设置流程原先选择的项目文件夹已不可用。已有项目和会话不会被删除。
      </p>
      <Button
        className="mt-4"
        type="button"
        variant="secondary"
        disabled={busy}
        onClick={onReselectProject}
      >
        <FolderOpen aria-hidden="true" />
        重新选择项目
      </Button>
    </div>
  )
}
