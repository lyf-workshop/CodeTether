import { installationCompatibilityLabel } from '../../provider/provider-presentation'
import { Check, ShieldAlert } from 'lucide-react'

import { Badge, Button, cn } from '@codetether/ui'
import type {
  MachineProviderLifecycle,
  ProviderInstallationSummary,
} from '@codetether/protocol'

/**
 * Small, explicit Owner control for the durable Machine/Provider selection.
 *
 * Discovery remains read-only until the Owner presses one of the eligible
 * buttons.  Installation identities stay internal to the action callback;
 * this surface exposes only safe version and lifecycle facts.
 */
export function ProviderInstallationSelector({
  lifecycle,
  disabled = false,
  pendingInstallationId,
  onSelect,
}: {
  readonly lifecycle: MachineProviderLifecycle | undefined
  readonly disabled?: boolean
  readonly pendingInstallationId?: string
  readonly onSelect: (installationId: string) => void
}) {
  if (lifecycle === undefined || lifecycle.installations.length === 0) {
    return null
  }

  return (
    <div className="mt-3 rounded-sm border border-border/80 bg-surface-muted/35 p-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-text-secondary">
            AI 工具安装选择
          </p>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">
            仅在你明确选择后改变这台设备未来新会话使用的安装。已有会话保持原绑定。
          </p>
        </div>
        <Badge variant="secondary" className="shrink-0">
          {lifecycle.installations.length} 个安装
        </Badge>
      </div>
      <ul className="mt-3 space-y-2" aria-label="AI 工具安装列表">
        {lifecycle.installations.map((installation) => (
          <ProviderInstallationOption
            key={String(installation.installationId)}
            installation={installation}
            disabled={disabled}
            pending={
              pendingInstallationId === String(installation.installationId)
            }
            onSelect={onSelect}
          />
        ))}
      </ul>
    </div>
  )
}

function ProviderInstallationOption({
  installation,
  disabled,
  pending,
  onSelect,
}: {
  readonly installation: ProviderInstallationSummary
  readonly disabled: boolean
  readonly pending: boolean
  readonly onSelect: (installationId: string) => void
}) {
  const compatibility = installation.compatibility
  const eligible =
    installation.availability === 'available' &&
    compatibility?.freshness === 'current' &&
    (compatibility.runtimeReadiness === 'ready' ||
      compatibility.runtimeReadiness === 'limited') &&
    (compatibility.state === 'verified' ||
      compatibility.state === 'compatible_unverified' ||
      compatibility.state === 'limited')
  const selected = installation.selected
  const version = installation.version ?? '版本未知'
  const status = installationCompatibilityLabel(installation)
  const actionDisabled = selected || !eligible || disabled || pending

  return (
    <li
      className={cn(
        'flex min-w-0 items-center gap-3 rounded-sm border border-border bg-surface/60 px-3 py-2',
        selected && 'border-primary/45 bg-primary-muted/35',
        !eligible && !selected && 'opacity-75',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-full border',
          selected
            ? 'border-primary/45 bg-primary-muted text-primary'
            : eligible
              ? 'border-success/40 bg-success-muted text-success-text'
              : 'border-border text-text-muted',
        )}
      >
        {selected ? (
          <Check className="size-3.5" />
        ) : eligible ? null : (
          <ShieldAlert className="size-3.5" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-text-primary">
          {version}
        </p>
        <p className="mt-0.5 truncate text-xs text-text-muted">{status}</p>
      </div>
      <Button
        size="sm"
        variant={selected ? 'secondary' : 'outline'}
        disabled={actionDisabled}
        aria-label={
          selected
            ? `${version} 当前已选择`
            : eligible
              ? `选择 ${version}`
              : `${version} 不可选择`
        }
        onClick={() => onSelect(String(installation.installationId))}
      >
        {pending
          ? '正在保存…'
          : selected
            ? '当前选择'
            : eligible
              ? '选择'
              : '不可用'}
      </Button>
    </li>
  )
}
