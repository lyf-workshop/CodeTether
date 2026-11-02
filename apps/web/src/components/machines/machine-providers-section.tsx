import { useLayoutEffect, useRef, type RefObject } from 'react'
import { RefreshCw } from 'lucide-react'
import { AgentBadge, Badge, Button, Separator, cn } from '@codetether/ui'
import type {
  MachineProviderDiscovery,
  MachineProviderLifecycle,
  ProviderDescriptor,
  RemoteMachineConnection,
} from '@codetether/protocol'

import {
  providerExecutionHealthPresentation,
  providerLifecycleForMachine,
  providerLifecyclePresentation,
  providerPresentationsForMachine,
  type ProviderLifecyclePresentation,
  type ProviderPresentation,
} from '../../provider/provider-presentation'
import { machineErrorMessage } from '../../runtime/host/machine-actions'
import { formatMachineLastSeen } from './machine-presentation'
import { ProviderInstallationSelector } from './provider-installation-selector'

interface MachineProvidersSectionProps {
  providers: readonly ProviderDescriptor[]
  lifecycles: readonly MachineProviderLifecycle[]
  connection?: RemoteMachineConnection
  discovery?: MachineProviderDiscovery
  hostReady: boolean
  onRefresh: () => void
  refreshPending: boolean
  refreshError: unknown
  onSelectInstallation: (
    provider: ProviderDescriptor['provider'],
    providerInstallationId: string,
  ) => void
  selectionPending: boolean
  selectionError: unknown
  pendingInstallationId?: string
  pendingProvider?: ProviderDescriptor['provider']
}

export function MachineProvidersSection({
  providers,
  lifecycles,
  connection,
  discovery,
  hostReady,
  onRefresh,
  refreshPending,
  refreshError,
  onSelectInstallation,
  selectionPending,
  selectionError,
  pendingInstallationId,
  pendingProvider,
}: MachineProvidersSectionProps) {
  const [providerRefreshButtonRef, rememberProviderRefreshFocus] =
    useProviderRefreshFocusRestoration(refreshPending)
  const remote = connection !== undefined
  const headingId = remote
    ? 'remote-machine-providers-heading'
    : 'local-machine-providers-heading'
  const canRefresh = hostReady && (!remote || connection.state === 'online')
  const observed =
    !remote || (discovery !== undefined && discovery.state !== 'not_observed')
  const presentations = observed
    ? providerPresentationsForMachine(providers)
    : []
  const observedAt =
    discovery?.state === 'current' || discovery?.state === 'last_known'
      ? formatMachineLastSeen(discovery.observedAt)
      : undefined
  return (
    <section
      className="min-w-0 rounded-lg border border-border bg-surface p-5"
      aria-busy={refreshPending}
      aria-labelledby={headingId}
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={headingId} className="text-lg font-semibold">
            AI 工具
          </h2>
          <p className="mt-1 text-sm text-text-secondary">
            这台设备上已检测到的 AI 工具。详细状态可按需查看。
          </p>
        </div>
        <Button
          ref={providerRefreshButtonRef}
          variant="secondary"
          size="sm"
          disabled={!canRefresh || refreshPending}
          aria-describedby={
            canRefresh ? undefined : `${headingId}-refresh-unavailable`
          }
          onClick={() => {
            rememberProviderRefreshFocus()
            onRefresh()
          }}
        >
          <RefreshCw
            aria-hidden="true"
            className={cn(
              refreshPending && 'animate-spin motion-reduce:animate-none',
            )}
          />
          {refreshPending ? '正在检测…' : '重新检测'}
        </Button>
        {canRefresh ? null : (
          <span id={`${headingId}-refresh-unavailable`} className="sr-only">
            设备连接恢复后才能重新检测 AI 工具。
          </span>
        )}
      </div>
      <Separator className="my-4" />
      {remote ? (
        <p role="status" className="mb-3 text-sm text-text-muted">
          {!observed
            ? '尚未检测到这台设备上的 AI 工具。'
            : discovery?.state === 'current' && hostReady
              ? `当前连接已验证${observedAt === undefined ? '' : ` · ${observedAt}`}`
              : `显示的是上次已知的状态${observedAt === undefined ? '' : ` · ${observedAt}`}`}
        </p>
      ) : null}
      <ul className="space-y-3">
        {presentations.map((provider) => (
          <MachineProviderCard
            key={provider.provider}
            provider={provider}
            lifecycles={lifecycles}
            remote={remote}
            hostReady={hostReady}
            onSelectInstallation={onSelectInstallation}
            selectionPending={selectionPending}
            pendingInstallationId={
              pendingProvider === undefined ||
              pendingProvider === provider.provider
                ? pendingInstallationId
                : undefined
            }
          />
        ))}
      </ul>
      {remote ? (
        <p className="mt-3 text-sm text-text-muted">
          这台设备上的会话暂不支持停止和审批。
        </p>
      ) : null}
      {selectionError !== null && selectionError !== undefined ? (
        <p
          role="alert"
          className="mt-3 rounded-sm bg-danger-muted px-3 py-2 text-sm text-danger-text"
        >
          {machineErrorMessage(selectionError, 'select-provider-installation')}
        </p>
      ) : null}
      {refreshError !== null && refreshError !== undefined ? (
        <p
          role="alert"
          className="mt-3 rounded-sm bg-danger-muted px-3 py-2 text-sm text-danger-text"
        >
          {machineErrorMessage(refreshError, 'refresh-providers')}
        </p>
      ) : null}
    </section>
  )
}

function MachineProviderCard({
  provider,
  lifecycles,
  remote,
  hostReady,
  onSelectInstallation,
  selectionPending,
  pendingInstallationId,
}: {
  provider: ProviderPresentation
  lifecycles: readonly MachineProviderLifecycle[]
  remote: boolean
  hostReady: boolean
  onSelectInstallation: MachineProvidersSectionProps['onSelectInstallation']
  selectionPending: boolean
  pendingInstallationId?: string
}) {
  const health = providerExecutionHealthPresentation(
    provider.executionHealth,
    provider.displayName,
  )
  const lifecycleGroup = providerLifecycleForMachine(
    lifecycles,
    provider.provider,
  )
  const lifecycle = providerLifecyclePresentation(lifecycleGroup)
  const installationLabel =
    lifecycleGroup === undefined
      ? provider.available
        ? '已安装'
        : provider.availabilityLabel
      : lifecycle.installation.stateLabel
  const version = lifecycle.installation.version ?? provider.version
  return (
    <li className="flex min-w-0 flex-wrap items-start gap-3 border-t border-border pt-3 first:border-t-0 first:pt-0">
      <AgentBadge agent={provider.agent} size="lg" />
      <div className="min-w-0 flex-1 basis-32">
        {version === undefined ? null : (
          <p
            title={version}
            className="max-w-full truncate font-mono text-xs text-text-muted"
          >
            {version}
          </p>
        )}
        <Badge
          variant={provider.available ? 'success' : 'danger'}
          className="mt-2"
        >
          {provider.available ? '可用' : provider.availabilityLabel}
        </Badge>
        <details className="group/details mt-2">
          <summary className="w-fit cursor-pointer rounded-sm text-sm text-text-muted outline-none hover:text-text-primary focus-visible:ring-2 focus-visible:ring-ring">
            查看详细状态
          </summary>
          <div className="mt-2">
            <MachineProviderLifecycleDetails
              health={health}
              installationLabel={installationLabel}
              lifecycle={lifecycle}
              lifecycleObserved={lifecycleGroup !== undefined}
              providerAvailable={provider.available}
            />
            {remote && provider.available ? (
              <p className="mt-1 text-xs text-text-muted">
                {remoteProviderCapabilitySummary(provider)}
              </p>
            ) : null}
            <ProviderInstallationSelector
              lifecycle={lifecycleGroup}
              disabled={!hostReady || selectionPending}
              pendingInstallationId={pendingInstallationId}
              onSelect={(providerInstallationId) =>
                onSelectInstallation(provider.provider, providerInstallationId)
              }
            />
          </div>
        </details>
      </div>
    </li>
  )
}

function useProviderRefreshFocusRestoration(
  refreshPending: boolean,
): readonly [RefObject<HTMLButtonElement | null>, () => void] {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const previousPendingRef = useRef(refreshPending)
  const restoreFocusRef = useRef(false)

  useLayoutEffect(() => {
    const wasPending = previousPendingRef.current
    previousPendingRef.current = refreshPending

    if (refreshPending && restoreFocusRef.current) {
      const disarmFocusRestoration = (): void => {
        restoreFocusRef.current = false
      }
      document.addEventListener('pointerdown', disarmFocusRestoration, true)
      document.addEventListener('keydown', disarmFocusRestoration, true)
      return () => {
        document.removeEventListener(
          'pointerdown',
          disarmFocusRestoration,
          true,
        )
        document.removeEventListener('keydown', disarmFocusRestoration, true)
      }
    }

    if (!wasPending || !restoreFocusRef.current) return

    restoreFocusRef.current = false
    if (document.activeElement === document.body) {
      buttonRef.current?.focus()
    }
  }, [refreshPending])

  function rememberFocus(): void {
    restoreFocusRef.current = document.activeElement === buttonRef.current
  }

  return [buttonRef, rememberFocus] as const
}

function MachineProviderLifecycleDetails({
  health,
  installationLabel,
  lifecycle,
  lifecycleObserved,
  providerAvailable,
}: {
  health: ReturnType<typeof providerExecutionHealthPresentation>
  installationLabel: string
  lifecycle: ProviderLifecyclePresentation
  lifecycleObserved: boolean
  providerAvailable: boolean
}) {
  const installationDetail = lifecycleObserved
    ? lifecycle.installation.detailLabel
    : '这个版本尚未提供安装生命周期详情'

  return (
    <>
      <dl className="mt-2 grid min-w-0 gap-1.5 text-xs">
        <MachineProviderStatusRow
          label="安装状态"
          tone={
            (lifecycleObserved &&
              lifecycle.installation.state === 'available') ||
            (!lifecycleObserved && providerAvailable)
              ? 'text-success-text'
              : 'text-text-secondary'
          }
          value={installationLabel}
        />
        <MachineProviderStatusRow
          label="运行时"
          tone={providerRuntimeLifecycleTone(lifecycle.runtime.state)}
          value={`${lifecycle.runtime.stateLabel} · ${lifecycle.runtime.freshnessLabel}`}
        />
        <MachineProviderStatusRow
          label="后端"
          tone={providerBackendLifecycleTone(lifecycle.backend.readiness)}
          value={`${lifecycle.backend.modeLabel} · ${lifecycle.backend.readinessLabel} · ${lifecycle.backend.freshnessLabel}`}
        />
        <MachineProviderStatusRow
          label="执行状态"
          tone={providerExecutionHealthTone(health.state)}
          value={`${health.stateLabel} · ${health.freshnessLabel}`}
        />
      </dl>
      <p className="mt-2 break-words text-xs leading-relaxed text-text-muted">
        安装 · {installationDetail}
      </p>
      {lifecycle.installation.alternateCount === 0 ? null : (
        <p className="mt-1 text-xs text-text-muted">
          另发现 {lifecycle.installation.alternateCount} 个安装；不会自动切换。
        </p>
      )}
      <p className="mt-1 break-words text-xs leading-relaxed text-text-muted">
        运行时 · {lifecycle.runtime.description}
      </p>
      <p className="mt-1 break-words text-xs leading-relaxed text-text-muted">
        后端 · {lifecycle.backend.description}
      </p>
      <p className="mt-1 break-words text-xs leading-relaxed text-text-muted">
        执行 · {health.description}
      </p>
      {health.observedAt === undefined ? null : (
        <p className="mt-1 text-xs text-text-muted">
          执行验证时间 · {formatMachineLastSeen(health.observedAt)}
        </p>
      )}
    </>
  )
}

function MachineProviderStatusRow({
  label,
  tone,
  value,
}: {
  label: string
  tone: string
  value: string
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <dt className="shrink-0 text-text-muted">{label}</dt>
      <dd className={cn('min-w-0 break-words text-right font-medium', tone)}>
        {value}
      </dd>
    </div>
  )
}

function remoteProviderCapabilitySummary(
  provider: ProviderPresentation,
): string {
  const { capabilities } = provider
  if (!capabilities.streaming || !capabilities.resume) {
    return '已检测到 AI 工具；尚未提供会话所需的远程能力'
  }

  const enabled = [
    '文本流式',
    '原生恢复',
    capabilities.fileRead ? '读取' : undefined,
    capabilities.search ? '搜索' : undefined,
    capabilities.toolEvents ? '工具事件' : undefined,
    capabilities.reasoningControl ? provider.reasoningLabel : undefined,
  ].filter((value): value is string => value !== undefined)
  const summary = enabled.join('、')
  return `已声明能力 · ${summary}`
}

function providerExecutionHealthTone(
  state: ReturnType<typeof providerExecutionHealthPresentation>['state'],
): string {
  switch (state) {
    case 'healthy':
      return 'text-success-text'
    case 'degraded':
      return 'text-warning-text'
    case 'unavailable':
      return 'text-danger-text'
    case 'unknown':
    case 'not_observed':
      return 'text-text-secondary'
  }
}

function providerRuntimeLifecycleTone(
  state: ProviderLifecyclePresentation['runtime']['state'],
): string {
  switch (state) {
    case 'verified':
    case 'compatible_unverified':
      return 'text-success-text'
    case 'limited':
      return 'text-warning-text'
    case 'incompatible':
    case 'unavailable':
      return 'text-danger-text'
    case 'not_observed':
      return 'text-text-secondary'
  }
}

function providerBackendLifecycleTone(
  readiness: ProviderLifecyclePresentation['backend']['readiness'],
): string {
  switch (readiness) {
    case 'ready':
      return 'text-success-text'
    case 'unavailable':
    case 'authentication_required':
    case 'misconfigured':
      return 'text-danger-text'
    case 'unknown':
    case 'not_observed':
      return 'text-text-secondary'
  }
}
