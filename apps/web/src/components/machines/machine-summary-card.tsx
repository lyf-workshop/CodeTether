import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Folder, Monitor, Server } from 'lucide-react'

import { StatusTag } from '@codetether/ui'
import type { MachineSummary, ProjectRecord } from '@codetether/protocol'

import {
  machineProviderSummary,
  providerDisplayName,
  supportedAgentProviders,
} from '../../provider/provider-presentation'
import { ProviderSummaryBadge } from '../../provider/provider-summary-badge'
import { useHostRuntime } from '../../runtime/host/host-runtime-hooks'
import { machineDetailQueryOptions } from '../../runtime/host/machine-query'
import { projectLocationForMachine } from '../../runtime/host/project-location'
import {
  formatMachineLastSeen,
  machineConnectionStateLabel,
  machineConnectionTone,
  machineEnvironmentLabel,
} from './machine-presentation'

interface MachineSummaryCardProps {
  readonly machine: MachineSummary
  readonly projects: readonly ProjectRecord[] | undefined
  readonly projectError: boolean
  readonly hostConnected: boolean
}

export function MachineSummaryCard({
  machine,
  projects,
  projectError,
  hostConnected,
}: MachineSummaryCardProps) {
  const runtime = useHostRuntime()
  const cardRef = useRef<HTMLElement>(null)
  const [hasBeenVisible, setHasBeenVisible] = useState(
    () => typeof IntersectionObserver === 'undefined',
  )
  useEffect(() => {
    const card = cardRef.current
    if (hasBeenVisible || card === null) return
    let observing = true
    const observer = new IntersectionObserver(
      (entries) => {
        if (!observing || !entries.some((entry) => entry.isIntersecting)) return
        observing = false
        setHasBeenVisible(true)
        observer.disconnect()
      },
      { rootMargin: '200px' },
    )
    observer.observe(card)
    return () => {
      observing = false
      observer.disconnect()
    }
  }, [hasBeenVisible])
  const detail = useQuery({
    ...machineDetailQueryOptions(runtime, machine.machineId),
    enabled: hostConnected && hasBeenVisible,
  })
  const MachineIcon = machine.kind === 'local' ? Monitor : Server
  const projectCount = projects?.filter(
    (project) =>
      projectLocationForMachine(project, machine.machineId) !== undefined,
  ).length
  const lastSeen = formatMachineLastSeen(machine.lastSeenAt)

  return (
    <article
      ref={cardRef}
      id={`device-${machine.machineId}`}
      className="group relative flex min-w-0 flex-col rounded-xl border border-border bg-surface p-5 shadow-subtle transition-colors hover:border-border-strong hover:bg-surface-muted"
    >
      <Link
        to="/devices/$machineId"
        params={{ machineId: machine.machineId }}
        aria-label={`查看电脑：${machine.displayName}`}
        className="absolute inset-0 z-10 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      />
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-inset text-text-secondary"
        >
          <MachineIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2
            title={machine.displayName}
            className="truncate text-lg font-semibold text-text-primary"
          >
            {machine.displayName}
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            {machineEnvironmentLabel(machine)}
          </p>
          {machine.kind === 'local' ? (
            <p className="mt-1 text-sm text-text-secondary">
              这台电脑无需账号即可使用。
            </p>
          ) : null}
        </div>
        <StatusTag tone={machineConnectionTone(machine.connectionState)}>
          {machineConnectionStateLabel(machine.connectionState)}
        </StatusTag>
      </div>
      <dl className="mt-5 space-y-2 border-t border-border pt-4 text-sm">
        {supportedAgentProviders.map((provider) => {
          return (
            <div
              key={provider}
              className="flex items-center justify-between gap-3"
            >
              <dt className="text-text-secondary">
                {providerDisplayName(provider)}
              </dt>
              <dd>
                {detail.data ? (
                  <ProviderSummaryBadge
                    summary={machineProviderSummary(
                      detail.data,
                      provider,
                      machine.connectionState,
                    )}
                  />
                ) : (
                  <span className="text-text-muted">
                    {machine.connectionState !== 'local' &&
                    machine.connectionState !== 'online'
                      ? '电脑未连接'
                      : detail.isError
                        ? '状态暂不可用'
                        : '正在读取…'}
                  </span>
                )}
              </dd>
            </div>
          )
        })}
      </dl>
      {detail.isError && detail.data !== undefined ? (
        <p role="status" className="mt-2 mb-4 text-xs text-text-muted">
          AI 工具状态未能更新，显示上次读取结果
        </p>
      ) : detail.data?.providerDiscovery?.state === 'last_known' ? (
        <p className="mt-2 mb-4 text-xs text-text-muted">
          AI 工具显示上次已知的安装状态
        </p>
      ) : null}
      <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-4 text-sm text-text-secondary">
        <span className="inline-flex items-center gap-1.5">
          {projectCount === undefined ? (
            projectError ? (
              '项目数量暂不可用'
            ) : (
              '正在读取项目…'
            )
          ) : (
            <>
              <Folder aria-hidden="true" className="size-4 shrink-0" />
              {projectCount} 个项目
            </>
          )}
        </span>
        {machine.kind === 'remote' &&
        machine.connectionState !== 'online' &&
        lastSeen !== undefined ? (
          <span className="text-text-muted">上次在线 {lastSeen}</span>
        ) : null}
      </div>
    </article>
  )
}
