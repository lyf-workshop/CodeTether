import { useQueries, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowUpRight, Monitor, RefreshCw } from 'lucide-react'

import { AgentBadge, Badge, Button, cn } from '@codetether/ui'
import type { GetMachineResponse, MachineSummary } from '@codetether/protocol'

import {
  useHostConnectionState,
  useHostRuntime,
} from '../../runtime/host/host-runtime-hooks'
import {
  machineDetailQueryOptions,
  machineListQueryOptions,
} from '../../runtime/host/machine-query'
import { providerPresentationsForMachine } from '../../provider/provider-presentation'
import {
  machineAvailabilityLabel,
  machineEnvironmentLabel,
} from './machine-presentation'
import {
  MachinesEmptyState,
  MachinesErrorState,
  MachinesLoadingState,
} from './machine-page-states'

export function MachinesPage() {
  const runtime = useHostRuntime()
  const connectionState = useHostConnectionState()
  const machinesQuery = useQuery({
    ...machineListQueryOptions(runtime),
    enabled: connectionState === 'connected',
  })
  const machines = machinesQuery.data ?? []
  const detailQueries = useQueries({
    queries: machines.map((machine) => ({
      ...machineDetailQueryOptions(runtime, machine.machineId),
      enabled: connectionState === 'connected',
    })),
  })
  const connectionUnavailable =
    connectionState === 'unavailable' || connectionState === 'incompatible'
  const loading =
    !connectionUnavailable &&
    (machinesQuery.isPending ||
      (connectionState !== 'connected' && machinesQuery.data === undefined))

  function retry() {
    runtime.retry()
    if (connectionState === 'connected') void machinesQuery.refetch()
  }

  return (
    <div className="flex min-h-full min-w-0 flex-col px-[var(--layout-content-inline-padding)] py-[var(--layout-content-block-padding)]">
      <header className="min-w-0">
        <h1 className="text-page font-semibold text-text-primary">机器</h1>
        <p className="mt-0.5 text-sm text-text-secondary">
          查看 CodeTether 实际运行智能体的位置。
        </p>
      </header>

      <div className="mt-6 min-w-0 flex-1">
        {connectionUnavailable ? (
          <MachinesErrorState
            incompatible={connectionState === 'incompatible'}
            onRetry={retry}
          />
        ) : loading ? (
          <MachinesLoadingState />
        ) : machinesQuery.isError ? (
          <MachinesErrorState onRetry={retry} />
        ) : machines.length === 0 ? (
          <MachinesEmptyState />
        ) : (
          <section aria-labelledby="machine-list-heading">
            <div className="mb-3 flex min-w-0 items-center justify-between gap-4">
              <div>
                <h2
                  id="machine-list-heading"
                  className="text-sm font-medium text-text-primary"
                >
                  可用位置
                </h2>
                <p className="mt-0.5 text-xs text-text-muted">
                  共 {machines.length} 台机器
                </p>
              </div>
              {connectionState === 'reconnecting' ? (
                <span
                  role="status"
                  className="inline-flex items-center gap-1.5 text-xs text-text-muted"
                >
                  <RefreshCw
                    aria-hidden="true"
                    className="size-3.5 animate-spin motion-reduce:animate-none"
                  />
                  正在重新连接
                </span>
              ) : null}
            </div>
            <div className="space-y-4">
              {machines.map((machine, index) => (
                <MachineRow
                  key={machine.machineId}
                  machine={machine}
                  detail={detailQueries[index]?.data}
                  detailError={detailQueries[index]?.isError ?? false}
                  detailPending={detailQueries[index]?.isPending ?? false}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function MachineRow({
  detail,
  detailError,
  detailPending,
  machine,
}: {
  detail?: GetMachineResponse
  detailError: boolean
  detailPending: boolean
  machine: MachineSummary
}) {
  const providers = providerPresentationsForMachine(detail?.providers ?? [])
  const available = machine.availability === 'available'

  return (
    <article className="grid min-w-0 gap-5 rounded-lg border border-border bg-surface/70 p-5 transition-colors duration-150 hover:border-border-strong hover:bg-surface/90 motion-reduce:transition-none sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
      <span
        aria-hidden="true"
        className={cn(
          'grid size-11 shrink-0 place-items-center rounded-md border',
          available
            ? 'border-primary/35 bg-primary-muted text-primary'
            : 'border-border-strong bg-surface-muted text-text-muted',
        )}
      >
        <Monitor className="size-5" />
      </span>

      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <h2
            title={machine.displayName}
            className="min-w-0 truncate text-section font-semibold text-text-primary"
          >
            {machine.displayName}
          </h2>
          {machine.isLocal ? <Badge variant="secondary">本地</Badge> : null}
          <Badge variant={available ? 'success' : 'danger'}>
            {machineAvailabilityLabel(machine.availability)}
          </Badge>
        </div>
        <p className="mt-1.5 text-sm text-text-secondary">
          {machineEnvironmentLabel(machine)}
        </p>
        <div
          className="mt-4 flex min-w-0 flex-wrap items-center gap-2"
          aria-label="此机器上的智能体"
        >
          {detailPending ? (
            <span className="text-xs text-text-muted">正在读取智能体…</span>
          ) : detailError || detail === undefined ? (
            <span className="text-xs text-text-muted">
              智能体信息暂时不可用
            </span>
          ) : providers.length === 0 ? (
            <span className="text-xs text-text-muted">未检测到智能体</span>
          ) : (
            providers.map((provider) => (
              <span
                key={provider.provider}
                className="inline-flex min-w-0 items-center gap-1.5 text-xs text-text-secondary"
              >
                <AgentBadge agent={provider.agent} variant="compact" />
                <span className="truncate">{provider.displayName}</span>
                <span
                  className={
                    provider.available ? 'text-success' : 'text-text-muted'
                  }
                >
                  {provider.availabilityLabel}
                </span>
              </span>
            ))
          )}
        </div>
      </div>

      <Button asChild size="sm" className="min-w-28">
        <Link
          to="/machines/$machineId"
          params={{ machineId: machine.machineId }}
        >
          打开机器
          <ArrowUpRight aria-hidden="true" />
        </Link>
      </Button>
    </article>
  )
}
