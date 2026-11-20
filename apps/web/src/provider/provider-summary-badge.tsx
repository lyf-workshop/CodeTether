import { Badge } from '@codetether/ui'
import type { ProviderId } from '@codetether/protocol'
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
  return summary.status ? (
    <Badge variant={summary.status.variant} title={summary.freshnessLabel}>
      {summary.status.label}
    </Badge>
  ) : (
    <span className="text-xs text-text-muted">{summary.freshnessLabel}</span>
  )
}

export function MachineProviderBadge({
  read,
  provider,
}: {
  readonly read?: MachineProviderRead
  readonly provider: ProviderId
}) {
  if (!read?.data)
    return (
      <span className="text-xs text-text-muted">
        {read?.isError ? '工具状态读取失败' : '正在读取工具状态…'}
      </span>
    )
  return (
    <ProviderSummaryBadge
      summary={machineProviderSummary(read.data, provider)}
    />
  )
}
