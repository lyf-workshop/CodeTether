import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'

import { Button, Notice } from '@codetether/ui'

import {
  useHostConnectionState,
  useHostRuntime,
} from '../../runtime/host/host-runtime-hooks'
import { machineListQueryOptions } from '../../runtime/host/machine-query'
import { projectListQueryOptions } from '../../runtime/host/project-query'
import {
  MachinesEmptyState,
  MachinesErrorState,
  MachinesLoadingState,
} from './machine-page-states'
import { sortMachinesForDisplay } from './machine-presentation'
import { MachineSummaryCard } from './machine-summary-card'
import {
  AuthorizedMobileDevices,
  AuthorizedMobileDevicesList,
} from './authorized-mobile-devices'
import { useAccountSession } from '../../runtime/account/use-account-session'

export function MachinesPage() {
  const runtime = useHostRuntime()
  const navigate = useNavigate()
  const connectionState = useHostConnectionState()
  const { query: account } = useAccountSession()
  const machinesQuery = useQuery({
    ...machineListQueryOptions(runtime),
    enabled: connectionState === 'connected',
  })
  const machines = sortMachinesForDisplay(machinesQuery.data ?? [])
  const projectsQuery = useQuery({
    ...projectListQueryOptions(runtime),
    enabled: connectionState === 'connected',
  })
  const unavailable =
    connectionState === 'unavailable' || connectionState === 'incompatible'
  const loading =
    !unavailable && machinesQuery.data === undefined && !machinesQuery.isError

  function retry() {
    runtime.retry()
    if (connectionState === 'connected') {
      void machinesQuery.refetch()
      void projectsQuery.refetch()
    }
  }

  return (
    <div className="mx-auto min-h-full w-full min-w-0 max-w-(--page-w) px-4 py-6 sm:px-8">
      <header className="mb-8 flex min-w-0 flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="text-page font-semibold">电脑</h1>
          <p className="mt-2 max-w-prose text-base text-text-secondary">
            每台电脑独立显示它的项目和 AI
            工具。选择一台电脑，查看项目与最近的会话。
          </p>
        </div>
        <Button
          variant="secondary"
          disabled={connectionState !== 'connected'}
          onClick={() => {
            void navigate({ to: '/add' })
          }}
        >
          <Plus aria-hidden="true" />
          添加设备
        </Button>
      </header>
      {unavailable ? (
        <MachinesErrorState
          incompatible={connectionState === 'incompatible'}
          onRetry={retry}
        />
      ) : loading ? (
        <MachinesLoadingState />
      ) : machinesQuery.isError && machinesQuery.data === undefined ? (
        <MachinesErrorState onRetry={retry} />
      ) : machines.length === 0 ? (
        <MachinesEmptyState />
      ) : (
        <div className="space-y-10">
          {connectionState === 'reconnecting' ? (
            <Notice role="status" title="正在重新连接">
              当前显示最近读取的设备数据，连接恢复后会重新确认。
            </Notice>
          ) : null}
          {machinesQuery.isError ? (
            <Notice
              role="status"
              tone="warn"
              title="设备列表未能更新"
              action={
                <Button size="sm" variant="secondary" onClick={retry}>
                  重试
                </Button>
              }
            >
              当前显示最近读取的设备记录。
            </Notice>
          ) : null}
          {projectsQuery.isError ? (
            <Notice
              role="status"
              tone="warn"
              title={
                projectsQuery.data === undefined
                  ? '暂时无法读取项目'
                  : '项目列表未能更新'
              }
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={connectionState !== 'connected'}
                  onClick={() => void projectsQuery.refetch()}
                >
                  重试
                </Button>
              }
            >
              {projectsQuery.data === undefined
                ? '项目数量暂不可用，请重试。'
                : '当前显示最近读取的项目记录。'}
            </Notice>
          ) : null}
          <div className="grid min-w-0 gap-4 sm:grid-cols-2 desktop:grid-cols-3">
            {machines.map((machine) => (
              <MachineSummaryCard
                key={machine.machineId}
                machine={machine}
                projects={projectsQuery.data}
                projectError={projectsQuery.isError}
                hostConnected={connectionState === 'connected'}
              />
            ))}
          </div>
        </div>
      )}
      {account.data ? (
        <AuthorizedMobileDevices
          key={account.data.userId}
          userId={account.data.userId}
        />
      ) : (
        <AuthorizedMobileDevicesList devices={[]} />
      )}
    </div>
  )
}
