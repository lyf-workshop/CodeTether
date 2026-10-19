import { useQueries, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Monitor, Plus, Server } from 'lucide-react'

import {
  Button,
  DeviceSection,
  Notice,
  SectionState,
  StatusTag,
} from '@codetether/ui'

import {
  useHostConnectionState,
  useHostRuntime,
} from '../../runtime/host/host-runtime-hooks'
import {
  machineDetailQueryOptions,
  machineListQueryOptions,
} from '../../runtime/host/machine-query'
import { AddProjectDialog } from '../projects/add-project-dialog'
import { AddRemoteMachineDialog } from './add-remote-machine-dialog'
import { machineCanAddProject } from './device-project-model'
import {
  MachinesEmptyState,
  MachinesErrorState,
  MachinesLoadingState,
} from './machine-page-states'
import {
  formatMachineLastSeen,
  machineConnectionStateLabel,
  machineConnectionTone,
  machineEnvironmentLabel,
} from './machine-presentation'
import { MachineProjectsSection } from './machine-projects-section'

export function MachinesPage() {
  const runtime = useHostRuntime()
  const connectionState = useHostConnectionState()
  const machinesQuery = useQuery({
    ...machineListQueryOptions(runtime),
    enabled: connectionState === 'connected',
  })
  const machines = [...(machinesQuery.data ?? [])].sort(
    (a, b) => Number(b.kind === 'local') - Number(a.kind === 'local'),
  )
  const detailQueries = useQueries({
    queries: machines.map((machine) => ({
      ...machineDetailQueryOptions(runtime, machine.machineId),
      enabled: connectionState === 'connected',
    })),
  })
  const unavailable =
    connectionState === 'unavailable' || connectionState === 'incompatible'
  const loading =
    !unavailable && machinesQuery.data === undefined && !machinesQuery.isError

  function retry() {
    runtime.retry()
    if (connectionState === 'connected') void machinesQuery.refetch()
  }

  return (
    <div className="mx-auto min-h-full w-full min-w-0 max-w-(--page-w) px-4 py-6 sm:px-8">
      <header className="mb-8 flex min-w-0 flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="text-page font-semibold">设备</h1>
          <p className="mt-2 max-w-prose text-base text-text-secondary">
            每台设备下面是你在上面添加的项目文件夹。打开项目就能查看会话，在里面新建会话时会直接使用这个文件夹。
          </p>
        </div>
        <AddRemoteMachineDialog
          trigger={
            <Button
              variant="secondary"
              disabled={connectionState !== 'connected'}
            >
              <Plus aria-hidden="true" />
              添加设备
            </Button>
          }
        />
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
            <Notice title="正在重新连接">
              当前显示最近读取的设备数据，连接恢复后会重新确认。
            </Notice>
          ) : null}
          {machinesQuery.isError ? (
            <Notice
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
          {machines.map((machine, index) => {
            const detailQuery = detailQueries[index]
            const detail = detailQuery?.data
            const lastSeen = formatMachineLastSeen(machine.lastSeenAt)
            const connected =
              machine.connectionState === 'local' ||
              machine.connectionState === 'online'
            const MachineIcon = machine.kind === 'local' ? Monitor : Server
            const canAdd =
              connectionState === 'connected' && machineCanAddProject(machine)
            return (
              <DeviceSection
                key={machine.machineId}
                id={`device-${machine.machineId}`}
                icon={<MachineIcon />}
                title={
                  <Link
                    to="/devices/$machineId"
                    params={{ machineId: machine.machineId }}
                    title={machine.displayName}
                    className="rounded-xs outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {machine.displayName}
                  </Link>
                }
                status={
                  <StatusTag
                    tone={machineConnectionTone(machine.connectionState)}
                  >
                    {machineConnectionStateLabel(machine.connectionState)}
                  </StatusTag>
                }
                metadata={`${machineEnvironmentLabel(machine)}${machine.kind === 'remote' ? (detail?.connection?.executionTransport === 'relay' ? ' · 通过 Relay' : ' · Node 配对') : ''}`}
                description={
                  !connected
                    ? `${lastSeen === undefined ? '' : `上次在线 ${lastSeen}。`}可以查看以前的会话，恢复后才能继续或新建。`
                    : undefined
                }
                action={
                  canAdd ? (
                    <AddProjectDialog
                      fixedMachineId={machine.machineId}
                      trigger={
                        <Button variant="secondary" size="sm">
                          <Plus aria-hidden="true" />
                          添加项目
                        </Button>
                      }
                    />
                  ) : undefined
                }
              >
                {detail === undefined ? (
                  detailQuery?.isError ? (
                    <Notice
                      tone="err"
                      title="暂时无法读取项目"
                      action={
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={connectionState !== 'connected'}
                          onClick={() => {
                            void detailQuery.refetch()
                          }}
                        >
                          重试
                        </Button>
                      }
                    >
                      这台设备的项目列表暂时不可用。
                    </Notice>
                  ) : (
                    <SectionState
                      state="loading"
                      title={`正在读取“${machine.displayName}”上的项目`}
                    />
                  )
                ) : (
                  <MachineProjectsSection
                    machine={machine}
                    projects={detail.projects}
                    heading={false}
                  />
                )}
              </DeviceSection>
            )
          })}
        </div>
      )}
    </div>
  )
}
