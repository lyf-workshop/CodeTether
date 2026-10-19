import { useState, type ReactNode } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import {
  ArrowLeft,
  MapPin,
  Monitor,
  Plus,
  RefreshCw,
  Server,
  Unplug,
} from 'lucide-react'

import { Button, Notice, SectionState, StatusTag, cn } from '@codetether/ui'
import {
  MachineIdSchema,
  ProviderInstallationIdSchema,
  type MachineId,
  type MachineSummary,
  type ProviderDescriptor,
  type RemoteMachineConnection,
} from '@codetether/protocol'
import { CodeTetherResponseError } from '@codetether/client'

import {
  useHostConnectionState,
  useHostRuntime,
} from '../../runtime/host/host-runtime-hooks'
import { machineErrorMessage } from '../../runtime/host/machine-actions'
import { machineDetailQueryOptions } from '../../runtime/host/machine-query'
import { AddProjectDialog } from '../projects/add-project-dialog'
import { machineCanAddProject } from './device-project-model'
import { MachineConversationsSection } from './machine-conversations-section'
import { MachinesErrorState, MachinesLoadingState } from './machine-page-states'
import {
  formatMachineLastSeen,
  machineConnectionStateLabel,
  machineConnectionTone,
  machineEnvironmentLabel,
  machineExecutionTransportLabel,
  remoteMachineAddressLabel,
  remoteMachineSummaryDescription,
} from './machine-presentation'
import { MachineProjectsSection } from './machine-projects-section'
import { MachineProvidersSection } from './machine-providers-section'
import { MachineRelaySection } from './machine-relay-section'
import { UnpairMachineDialog } from './unpair-machine-dialog'
import { UpdateMachineAddressDialog } from './update-machine-address-dialog'

export function MachineDetailRoute() {
  const { machineId: rawMachineId } = useParams({ strict: false })
  const machineId = MachineIdSchema.safeParse(rawMachineId)
  return machineId.success ? (
    <MachineDetailPage machineId={machineId.data} />
  ) : (
    <MachineNotFound />
  )
}

function MachineDetailPage({ machineId }: { machineId: MachineId }) {
  const runtime = useHostRuntime()
  const hostConnectionState = useHostConnectionState()
  const machineQuery = useQuery({
    ...machineDetailQueryOptions(runtime, machineId),
    enabled: hostConnectionState === 'connected',
  })
  const [unpairOpen, setUnpairOpen] = useState(false)
  const providerRefreshMutation = useMutation({
    mutationFn: async () => await runtime.refreshMachineProviders(machineId),
  })
  const providerSelectionMutation = useMutation({
    mutationFn: async (input: {
      readonly provider: ProviderDescriptor['provider']
      readonly providerInstallationId: string
    }) =>
      await runtime.selectMachineProviderInstallation(machineId, {
        provider: input.provider,
        providerInstallationId: ProviderInstallationIdSchema.parse(
          input.providerInstallationId,
        ),
      }),
    onSuccess: () => {
      void machineQuery.refetch()
    },
  })
  const hostReady = hostConnectionState === 'connected'
  const unavailable =
    hostConnectionState === 'unavailable' ||
    hostConnectionState === 'incompatible'

  function retry() {
    runtime.retry()
    if (hostReady) void machineQuery.refetch()
  }

  if (unavailable)
    return (
      <MachinePageFrame>
        <MachinesErrorState
          incompatible={hostConnectionState === 'incompatible'}
          onRetry={retry}
        />
      </MachinePageFrame>
    )
  if (machineQuery.data === undefined && !machineQuery.isError)
    return (
      <MachinePageFrame>
        <MachinesLoadingState />
      </MachinePageFrame>
    )
  if (
    machineQuery.error instanceof CodeTetherResponseError &&
    machineQuery.error.envelope.code === 'not_found'
  )
    return <MachineNotFound />
  if (machineQuery.data === undefined)
    return (
      <MachinePageFrame>
        <MachinesErrorState onRetry={retry} />
      </MachinePageFrame>
    )

  const {
    machine,
    projects,
    conversations,
    providers,
    providerLifecycles = [],
    providerDiscovery,
    connection,
    relay,
  } = machineQuery.data
  if (machine.kind === 'remote' && connection === undefined)
    return (
      <MachinePageFrame>
        <MachinesErrorState onRetry={retry} />
      </MachinePageFrame>
    )
  const MachineIcon = machine.kind === 'local' ? Monitor : Server
  const canAdd = hostReady && machineCanAddProject(machine)
  const online =
    machine.connectionState === 'local' || machine.connectionState === 'online'
  const lastSeen = formatMachineLastSeen(machine.lastSeenAt)

  return (
    <MachinePageFrame>
      <Link
        to="/devices"
        className="mb-4 inline-flex w-fit items-center gap-1.5 rounded-xs text-sm text-text-secondary outline-none hover:text-text-primary focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        返回设备
      </Link>
      <header className="mb-8 flex min-w-0 flex-wrap items-center gap-4">
        <span
          aria-hidden="true"
          className="grid size-12 shrink-0 place-items-center rounded-lg border border-border bg-surface-inset text-text-secondary"
        >
          <MachineIcon className="size-6" />
        </span>
        <div className="min-w-0 flex-1 basis-40">
          <h1
            title={machine.displayName}
            className="truncate text-page font-semibold"
          >
            {machine.displayName}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <StatusTag tone={machineConnectionTone(machine.connectionState)}>
              {machineConnectionStateLabel(machine.connectionState)}
            </StatusTag>
            <span className="text-sm text-text-muted">
              {machineEnvironmentLabel(machine)}
            </span>
          </div>
        </div>
        {canAdd ? (
          <AddProjectDialog
            fixedMachineId={machine.machineId}
            trigger={
              <Button variant="secondary">
                <Plus aria-hidden="true" />
                添加项目
              </Button>
            }
          />
        ) : null}
      </header>
      {!online ? (
        <div className="mb-6">
          <Notice tone="warn" title={`${machine.displayName}当前无法连接`}>
            {lastSeen === undefined ? '' : `上次在线 ${lastSeen}。`}
            可以查看以前的会话，但暂时不能发送消息、新建会话或添加项目。
          </Notice>
        </div>
      ) : !machine.capabilities.providerExecution ? (
        <div className="mb-6">
          <Notice tone="warn" title="这台设备当前不能运行 AI 工具">
            已有会话历史仍然可读。请在右侧查看 AI 工具的当前状态。
          </Notice>
        </div>
      ) : null}
      {hostConnectionState === 'reconnecting' ? (
        <div className="mb-6">
          <Notice title="正在重新连接">
            当前显示最近读取的设备数据，连接恢复后会重新确认。
          </Notice>
        </div>
      ) : null}
      {machineQuery.isError ? (
        <div className="mb-6">
          <Notice
            tone="warn"
            title="设备状态未能更新"
            action={
              <Button variant="secondary" size="sm" onClick={retry}>
                重试
              </Button>
            }
          >
            当前显示最近读取的设备记录。
          </Notice>
        </div>
      ) : null}
      <div className="grid min-w-0 gap-8 min-[1001px]:grid-cols-[var(--layout-device-detail-columns)]">
        <div className="min-w-0 space-y-10">
          <MachineProjectsSection
            machine={machine}
            projects={projects}
            appearance="list"
            showAddCard={false}
          />
          <MachineConversationsSection
            machine={machine}
            projects={projects}
            conversations={conversations}
          />
        </div>
        <aside className="min-w-0 space-y-4" aria-label="设备状态与连接">
          <MachineProvidersSection
            providers={providers}
            lifecycles={providerLifecycles}
            connection={connection}
            discovery={providerDiscovery}
            hostReady={hostReady}
            onRefresh={() => providerRefreshMutation.mutate()}
            refreshPending={providerRefreshMutation.isPending}
            refreshError={providerRefreshMutation.error}
            onSelectInstallation={(provider, providerInstallationId) =>
              providerSelectionMutation.mutate({
                provider,
                providerInstallationId,
              })
            }
            selectionPending={providerSelectionMutation.isPending}
            selectionError={providerSelectionMutation.error}
            pendingProvider={providerSelectionMutation.variables?.provider}
            pendingInstallationId={
              providerSelectionMutation.variables?.providerInstallationId
            }
          />
          <MachineConnectionSection
            machine={machine}
            connection={connection}
            hostReady={hostReady}
            onUnpair={() => setUnpairOpen(true)}
          />
          {machine.kind === 'remote' ? (
            <details className="min-w-0 rounded-lg border border-border bg-surface p-4">
              <summary className="cursor-pointer rounded-xs text-md font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Relay 高级连接设置
              </summary>
              <MachineRelaySection
                hostReady={hostReady}
                machine={machine}
                relay={relay}
              />
            </details>
          ) : null}
        </aside>
      </div>
      <UnpairMachineDialog
        machine={machine}
        projects={projects}
        open={unpairOpen}
        onOpenChange={setUnpairOpen}
      />
    </MachinePageFrame>
  )
}

function MachineConnectionSection({
  machine,
  connection,
  hostReady,
  onUnpair,
}: {
  machine: MachineSummary
  connection?: RemoteMachineConnection
  hostReady: boolean
  onUnpair: () => void
}) {
  const runtime = useHostRuntime()
  const [addressOpen, setAddressOpen] = useState(false)
  const retryMutation = useMutation({
    mutationFn: async () =>
      await runtime.retryMachineConnection(machine.machineId),
  })
  const directState = connection?.directState ?? connection?.state
  const canRetry =
    directState !== undefined &&
    directState !== 'online' &&
    directState !== 'connecting'
  return (
    <section
      className="min-w-0 rounded-lg border border-border bg-surface p-5"
      aria-labelledby="machine-connection-heading"
    >
      <h2
        id="machine-connection-heading"
        className="mb-4 text-lg font-semibold"
      >
        连接
      </h2>
      <dl className="space-y-3 text-md">
        <MachineMetadata
          label="连接方式"
          value={
            machine.kind === 'local'
              ? '这台电脑'
              : machineExecutionTransportLabel(connection?.executionTransport)
          }
        />
        {connection ? (
          <>
            <MachineMetadata
              label="局域网直连"
              value={machineConnectionStateLabel(
                connection.directState ?? connection.state,
              )}
            />
            <MachineMetadata
              label="直连地址"
              value={
                connection.currentEndpoint === undefined
                  ? '暂无已验证地址'
                  : remoteMachineAddressLabel(connection.currentEndpoint)
              }
            />
            <MachineMetadata
              label="上次成功连接"
              value={
                formatMachineLastSeen(connection.lastSuccessfulAt) ?? '未知'
              }
            />
            <MachineMetadata
              label="上次连接尝试"
              value={formatMachineLastSeen(connection.lastAttemptAt) ?? '未知'}
            />
            <MachineMetadata label="配对方式" value="CodeTether Node" />
          </>
        ) : (
          <MachineMetadata
            label="服务状态"
            value={hostReady ? '运行中' : '正在重新连接'}
          />
        )}
      </dl>
      {connection ? (
        <>
          <p className="mt-4 text-sm text-text-secondary">
            {remoteMachineSummaryDescription(
              machine.connectionState,
              hostReady ? 'current' : 'last_known',
            )}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {canRetry ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={retryMutation.isPending || !hostReady}
                onClick={() => retryMutation.mutate()}
              >
                <RefreshCw
                  aria-hidden="true"
                  className={cn(
                    retryMutation.isPending &&
                      'animate-spin motion-reduce:animate-none',
                  )}
                />
                {retryMutation.isPending ? '正在重试…' : '重试连接'}
              </Button>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              disabled={retryMutation.isPending || !hostReady}
              onClick={() => setAddressOpen(true)}
            >
              <MapPin aria-hidden="true" />
              更新地址
            </Button>
            <Button variant="danger" size="sm" onClick={onUnpair}>
              <Unplug aria-hidden="true" />
              取消配对
            </Button>
          </div>
          {retryMutation.isError ? (
            <p
              role="alert"
              className="mt-3 rounded-sm bg-danger-muted px-3 py-2 text-sm text-danger-text"
            >
              {machineErrorMessage(retryMutation.error, 'retry')}
            </p>
          ) : null}
          <UpdateMachineAddressDialog
            currentEndpoint={connection.currentEndpoint}
            machine={machine}
            open={addressOpen}
            onOpenChange={setAddressOpen}
          />
        </>
      ) : null}
    </section>
  )
}

function MachineMetadata({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline gap-3">
      <dt className="shrink-0 text-text-muted">{label}</dt>
      <dd
        title={value}
        className="min-w-0 flex-1 truncate text-right text-text-primary"
      >
        {value}
      </dd>
    </div>
  )
}

function MachineNotFound() {
  return (
    <MachinePageFrame>
      <SectionState
        state="empty"
        title="设备不存在"
        description="这台设备的记录不存在，或链接中的设备标识无效。"
        action={
          <Button asChild variant="secondary">
            <Link to="/devices">返回设备列表</Link>
          </Button>
        }
      />
    </MachinePageFrame>
  )
}

function MachinePageFrame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto min-h-full w-full min-w-0 max-w-(--page-w) px-4 py-6 sm:px-8">
      {children}
    </div>
  )
}
