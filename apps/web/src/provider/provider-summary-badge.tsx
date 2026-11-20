import { Badge } from '@codetether/ui'
import type { MachineConnectionState, ProviderId } from '@codetether/protocol'
import type { MachineProviderRead } from './use-machine-provider-details'
import {
  machineProviderSummary,
  type ProviderSummary,
} from './provider-presentation'

export function ProviderSummaryBadge({
  summary,
}: {
  readonly summary: ProviderSummary
}) {
  const primary = summary.status ? (
    <Badge variant={summary.status.variant} title={summary.freshnessLabel}>
      {summary.status.label}
    </Badge>
  ) : (
    <span className="text-xs text-text-muted">{summary.freshnessLabel}</span>
  )
  return summary.executionHistoryLabel === undefined ? (
    primary
  ) : (
    <span className="inline-flex min-w-0 flex-col items-end gap-0.5 text-right">
      {primary}
      <span className="text-xs font-normal text-text-muted">
        {summary.executionHistoryLabel}
      </span>
    </span>
  )
}

export function MachineProviderBadge({
  read,
  provider,
  connectionState,
}: {
  readonly read?: MachineProviderRead
  readonly provider: ProviderId
  readonly connectionState?: MachineConnectionState
}) {
  if (!read?.data)
    return (
      <span className="text-xs text-text-muted">
        {connectionState !== undefined &&
        connectionState !== 'local' &&
        connectionState !== 'online'
          ? '电脑未连接'
          : read?.isError
            ? '工具状态读取失败'
            : '正在读取工具状态…'}
      </span>
    )
  return (
    <ProviderSummaryBadge
      summary={machineProviderSummary(read.data, provider, connectionState)}
    />
  )
}
