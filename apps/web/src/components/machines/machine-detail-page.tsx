import { useState, type ReactNode } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import {
  ArrowLeft,
  MapPin,
  Monitor,
  RefreshCw,
  Server,
  ShieldCheck,
  Unplug,
} from 'lucide-react'

import {
  AgentBadge,
  Badge,
  Button,
  ConversationItem,
  Separator,
  cn,
} from '@codetether/ui'
import {
  MachineIdSchema,
  type MachineId,
  type MachineProviderDiscovery,
  type ProviderDescriptor,
  type ProjectRecord,
  type RemoteMachineConnection,
  type MachineSummary,
} from '@codetether/protocol'
import { CodeTetherResponseError } from '@codetether/client'

import {
  useHostConnectionState,
  useHostRuntime,
} from '../../runtime/host/host-runtime-hooks'
import { machineErrorMessage } from '../../runtime/host/machine-actions'
import { machineDetailQueryOptions } from '../../runtime/host/machine-query'
import { providerPresentationsForMachine } from '../../provider/provider-presentation'
import { formatConversationActivity } from '../conversations/conversation-list-model'
import { MachinesErrorState, MachinesLoadingState } from './machine-page-states'
import { MachineProjectsSection } from './machine-projects-section'
import {
  machineArchitectureLabel,
  formatMachineLastSeen,
  machineConnectionBadgeVariant,
  machineConnectionStateLabel,
  machinePlatformLabel,
  remoteMachineAddressLabel,
} from './machine-presentation'
import { UnpairMachineDialog } from './unpair-machine-dialog'
import { UpdateMachineAddressDialog } from './update-machine-address-dialog'

export function MachineDetailRoute() {
  const { machineId: rawMachineId } = useParams({
    from: '/machines/$machineId',
  })
  const machineId = MachineIdSchema.safeParse(rawMachineId)
  if (!machineId.success) return <MachineNotFound />
  return <MachineDetailPage machineId={machineId.data} />
}

function MachineDetailPage({ machineId }: { machineId: MachineId }) {
  const runtime = useHostRuntime()
  const hostConnectionState = useHostConnectionState()
  const [unpairOpen, setUnpairOpen] = useState(false)
  const machineQuery = useQuery({
    ...machineDetailQueryOptions(runtime, machineId),
    enabled: hostConnectionState === 'connected',
  })
  const connectionUnavailable =
    hostConnectionState === 'unavailable' ||
    hostConnectionState === 'incompatible'

  function retry() {
    runtime.retry()
    if (hostConnectionState === 'connected') void machineQuery.refetch()
  }

  if (connectionUnavailable) {
    return (
      <MachinePageFrame>
        <MachinesErrorState
          incompatible={hostConnectionState === 'incompatible'}
          onRetry={retry}
        />
      </MachinePageFrame>
    )
  }
  if (machineQuery.data === undefined && !machineQuery.isError) {
    return (
      <MachinePageFrame>
        <MachinesLoadingState />
      </MachinePageFrame>
    )
  }
  if (
    machineQuery.error instanceof CodeTetherResponseError &&
    machineQuery.error.envelope.code === 'not_found'
  ) {
    return <MachineNotFound />
  }
  if (machineQuery.data === undefined) {
    return (
      <MachinePageFrame>
        <MachinesErrorState onRetry={retry} />
      </MachinePageFrame>
    )
  }

  const { machine } = machineQuery.data
  if (machine.kind === 'remote') {
    const remoteConnection = machineQuery.data.connection
    if (remoteConnection === undefined) {
      return (
        <MachinePageFrame>
          <MachinesErrorState onRetry={retry} />
        </MachinePageFrame>
      )
    }
    return (
      <RemoteMachineDetail
        connection={remoteConnection}
        hostConnectionState={hostConnectionState}
        machine={machine}
        providerDiscovery={machineQuery.data.providerDiscovery}
        providers={machineQuery.data.providers}
        projects={machineQuery.data.projects}
        onUnpair={() => setUnpairOpen(true)}
        unpairOpen={unpairOpen}
        onUnpairOpenChange={setUnpairOpen}
      />
    )
  }
  const { providers, projects, conversations } = machineQuery.data
  const providerPresentations = providerPresentationsForMachine(providers)
  const providerById = new Map(
    providerPresentations.map((provider) => [provider.provider, provider]),
  )
  const projectsById = new Map(
    projects.map((project) => [project.projectId, project]),
  )
  const available = machine.availability === 'available'

  return (
    <MachinePageFrame>
      <Link
        to="/machines"
        className="mb-4 inline-flex w-fit items-center gap-1.5 rounded-xs text-sm font-medium text-text-secondary outline-none transition-colors hover:text-text-primary focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        返回机器
      </Link>

      <header className="flex min-w-0 flex-wrap items-start gap-4">
        <span
          aria-hidden="true"
          className="grid size-11 shrink-0 place-items-center rounded-md border border-primary/35 bg-primary-muted text-primary"
        >
          <Monitor className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <h1
              title={machine.displayName}
              className="min-w-0 truncate text-page font-semibold text-text-primary"
            >
              {machine.displayName}
            </h1>
            {machine.isLocal ? <Badge variant="secondary">本地</Badge> : null}
            <Badge variant={available ? 'success' : 'danger'}>
              {machineConnectionStateLabel(machine.connectionState)}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-text-secondary">
            智能体在这台机器上访问项目并执行会话。
          </p>
        </div>
      </header>

      <div className="mt-6 grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="min-w-0 rounded-lg border border-border bg-surface/65 p-5">
          <h2 className="text-section font-semibold text-text-primary">概览</h2>
          <Separator className="my-5" />
          <dl className="grid min-w-0 gap-x-6 gap-y-5 sm:grid-cols-2">
            <MachineMetadata label="机器名称" value={machine.displayName} />
            <MachineMetadata
              label="类型"
              value={machine.isLocal ? '本地电脑' : machine.kind}
            />
            <MachineMetadata
              label="平台"
              value={machinePlatformLabel(machine.platform)}
            />
            <MachineMetadata
              label="架构"
              value={machineArchitectureLabel(machine.architecture)}
            />
          </dl>
        </section>

        <section className="rounded-lg border border-border bg-surface/65 p-5">
          <h2 className="text-section font-semibold text-text-primary">
            智能体
          </h2>
          <p className="mt-0.5 text-sm text-text-secondary">
            此机器真实检测到的可用能力。
          </p>
          <Separator className="my-4" />
          <ul className="space-y-3">
            {providerPresentations.map((provider) => (
              <li
                key={provider.provider}
                className="flex min-w-0 items-center gap-2"
              >
                <AgentBadge agent={provider.agent} variant="compact" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
                  {provider.displayName}
                </span>
                <span
                  className={cn(
                    'shrink-0 text-xs',
                    provider.available ? 'text-success' : 'text-text-muted',
                  )}
                >
                  {provider.availabilityLabel}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <MachineProjectsSection machine={machine} projects={projects} />

      <section
        className="mt-5 min-w-0 rounded-lg border border-border bg-surface/65 p-5"
        aria-labelledby="machine-conversations-heading"
      >
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2
              id="machine-conversations-heading"
              className="text-section font-semibold text-text-primary"
            >
              最近会话
            </h2>
            <p className="mt-0.5 text-sm text-text-secondary">
              在这台机器上执行的最近会话。
            </p>
          </div>
          <span className="text-xs text-text-muted">
            {conversations.length} 个
          </span>
        </div>
        <Separator className="my-4" />
        {conversations.length === 0 ? (
          <p className="text-sm text-text-muted">这台机器上还没有会话。</p>
        ) : (
          <ul className="space-y-3">
            {conversations.map((conversation) => {
              const project = projectsById.get(conversation.projectId)
              return (
                <li key={conversation.conversationId}>
                  <ConversationItem
                    appearance="row"
                    title={conversation.title}
                    description={`${project?.name ?? '项目'} · ${providerById.get(conversation.provider)?.displayName ?? conversation.provider}`}
                    status={conversation.status}
                    model={conversation.model}
                    activity={formatConversationActivity(
                      conversation.lastActivityAt,
                    )}
                    primaryAction={
                      <Link
                        to="/conversations/$conversationId"
                        params={{ conversationId: conversation.conversationId }}
                        aria-label={`打开会话：${conversation.title}`}
                        className="absolute inset-0 z-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                      />
                    }
                  />
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {hostConnectionState === 'reconnecting' ? (
        <p
          role="status"
          className="mt-4 inline-flex items-center gap-1.5 text-xs text-text-muted"
        >
          <RefreshCw
            aria-hidden="true"
            className="size-3.5 animate-spin motion-reduce:animate-none"
          />
          正在重新连接，当前显示最近读取的机器数据。
        </p>
      ) : null}
    </MachinePageFrame>
  )
}

interface RemoteMachineDetailProps {
  connection: RemoteMachineConnection
  hostConnectionState: ReturnType<typeof useHostConnectionState>
  machine: MachineSummary
  providerDiscovery: MachineProviderDiscovery | undefined
  providers: readonly ProviderDescriptor[]
  projects: readonly ProjectRecord[]
  onUnpair: () => void
  onUnpairOpenChange: (open: boolean) => void
  unpairOpen: boolean
}

function RemoteMachineDetail({
  connection,
  hostConnectionState,
  machine,
  providerDiscovery,
  providers,
  projects,
  onUnpair,
  onUnpairOpenChange,
  unpairOpen,
}: RemoteMachineDetailProps) {
  const runtime = useHostRuntime()
  const [addressOpen, setAddressOpen] = useState(false)
  const lastSuccessful = formatMachineLastSeen(connection.lastSuccessfulAt)
  const lastAttempt = formatMachineLastSeen(connection.lastAttemptAt)
  const retryMutation = useMutation({
    mutationFn: async () =>
      await runtime.retryMachineConnection(machine.machineId),
  })
  const providerRefreshMutation = useMutation({
    mutationFn: async () =>
      await runtime.refreshMachineProviders(machine.machineId),
  })
  const hostReadyForConnectionAction = hostConnectionState === 'connected'
  const canRetry =
    connection.state !== 'online' && connection.state !== 'connecting'

  return (
    <MachinePageFrame>
      <Link
        to="/machines"
        className="mb-4 inline-flex w-fit items-center gap-1.5 rounded-xs text-sm font-medium text-text-secondary outline-none transition-colors hover:text-text-primary focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        返回机器
      </Link>

      <header className="flex min-w-0 flex-wrap items-start gap-4">
        <span
          aria-hidden="true"
          className="grid size-11 shrink-0 place-items-center rounded-md border border-primary/35 bg-primary-muted text-primary"
        >
          <Server className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <h1
              title={machine.displayName}
              className="min-w-0 truncate text-page font-semibold text-text-primary"
            >
              {machine.displayName}
            </h1>
            <Badge variant="secondary">远程</Badge>
            <Badge
              variant={machineConnectionBadgeVariant(machine.connectionState)}
            >
              {machineConnectionStateLabel(machine.connectionState)}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-text-secondary">
            已与此 CodeTether Node 建立长期信任关系。
          </p>
        </div>
        <Button
          variant="danger"
          size="sm"
          className="w-full sm:w-auto"
          disabled={projects.length > 0}
          title={
            projects.length > 0
              ? '请先在项目详情中移除此机器上的工作区位置'
              : undefined
          }
          onClick={onUnpair}
        >
          <Unplug aria-hidden="true" />
          取消配对
        </Button>
      </header>

      <div className="mt-6 grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="min-w-0 rounded-lg border border-border bg-surface/65 p-5">
          <h2 className="text-section font-semibold text-text-primary">概览</h2>
          <Separator className="my-5" />
          <dl className="grid min-w-0 gap-x-6 gap-y-5 sm:grid-cols-2">
            <MachineMetadata label="机器名称" value={machine.displayName} />
            <MachineMetadata label="类型" value="远程机器" />
            <MachineMetadata
              label="平台"
              value={machinePlatformLabel(machine.platform)}
            />
            <MachineMetadata
              label="架构"
              value={machineArchitectureLabel(machine.architecture)}
            />
          </dl>
        </section>

        <section className="min-w-0 rounded-lg border border-border bg-surface/65 p-5">
          <h2 className="text-section font-semibold text-text-primary">
            安全连接
          </h2>
          <Separator className="my-4" />
          <div className="flex min-w-0 items-start gap-3">
            <ShieldCheck
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-success"
            />
            <div className="min-w-0">
              <p className="text-sm font-medium text-text-primary">已信任</p>
              <p className="mt-1 text-xs leading-relaxed text-text-muted">
                {remoteConnectionDescription(connection.state)}
              </p>
            </div>
          </div>
          <dl className="mt-4 min-w-0 space-y-3 border-t border-border pt-4">
            <MachineMetadata
              label="当前连接地址"
              value={
                connection.currentEndpoint === undefined
                  ? '暂无已验证地址'
                  : remoteMachineAddressLabel(connection.currentEndpoint)
              }
            />
            <MachineMetadata
              label="最近成功连接"
              value={lastSuccessful ?? '暂无'}
            />
            <MachineMetadata
              label="最近连接尝试"
              value={lastAttempt ?? '暂无'}
            />
          </dl>
          <div className="mt-4 flex min-w-0 flex-wrap gap-2">
            {canRetry ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={
                  retryMutation.isPending || !hostReadyForConnectionAction
                }
                onClick={() => retryMutation.mutate()}
              >
                <RefreshCw
                  aria-hidden="true"
                  className={cn(
                    retryMutation.isPending &&
                      'animate-spin motion-reduce:animate-none',
                  )}
                />
                {retryMutation.isPending ? '正在重试…' : '重试'}
              </Button>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              disabled={
                retryMutation.isPending || !hostReadyForConnectionAction
              }
              onClick={() => setAddressOpen(true)}
            >
              <MapPin aria-hidden="true" />
              更新连接地址
            </Button>
          </div>
          {retryMutation.isError ? (
            <p
              role="alert"
              className="mt-3 break-words rounded-sm border border-danger/30 bg-danger-muted px-3 py-2 text-sm text-danger"
            >
              {machineErrorMessage(retryMutation.error, 'retry')}
            </p>
          ) : null}
        </section>
      </div>

      <RemoteMachineProvidersSection
        connection={connection}
        discovery={providerDiscovery}
        hostReady={hostReadyForConnectionAction}
        providers={providers}
        refreshError={providerRefreshMutation.error}
        refreshPending={providerRefreshMutation.isPending}
        onRefresh={() => providerRefreshMutation.mutate()}
      />

      <section className="mt-5 min-w-0 rounded-lg border border-border bg-surface/65 p-5">
        <h2 className="text-section font-semibold text-text-primary">
          当前能力
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-text-secondary">
          可以在这台机器上注册和查看项目工作区位置。位置注册本身不会授予执行权限。
          {machine.capabilities.providerExecution
            ? '当前仅支持经过验证的 Codex 文本流式与原生恢复；工具、写入、Shell、审批和中断均未启用。'
            : '当前连接或智能体尚未满足远程执行条件。'}
        </p>
      </section>

      <MachineProjectsSection machine={machine} projects={projects} />

      {projects.length > 0 ? (
        <p role="status" className="mt-3 text-xs text-text-muted">
          这台机器仍有 {projects.length}{' '}
          个项目位置。请先在对应的项目详情中明确移除这些位置，再单独取消配对。
        </p>
      ) : null}

      {hostConnectionState === 'reconnecting' ? (
        <p
          role="status"
          className="mt-4 inline-flex items-center gap-1.5 text-xs text-text-muted"
        >
          <RefreshCw
            aria-hidden="true"
            className="size-3.5 animate-spin motion-reduce:animate-none"
          />
          正在重新连接，当前显示最近读取的机器数据。
        </p>
      ) : null}

      <UnpairMachineDialog
        machine={machine}
        projectCount={projects.length}
        open={unpairOpen}
        onOpenChange={onUnpairOpenChange}
      />
      <UpdateMachineAddressDialog
        currentEndpoint={connection.currentEndpoint}
        machine={machine}
        open={addressOpen}
        onOpenChange={setAddressOpen}
      />
    </MachinePageFrame>
  )
}

function RemoteMachineProvidersSection({
  connection,
  discovery,
  hostReady,
  onRefresh,
  providers,
  refreshError,
  refreshPending,
}: {
  connection: RemoteMachineConnection
  discovery: MachineProviderDiscovery | undefined
  hostReady: boolean
  onRefresh: () => void
  providers: readonly ProviderDescriptor[]
  refreshError: unknown
  refreshPending: boolean
}) {
  const observed =
    discovery?.state !== 'not_observed' && discovery !== undefined
  const presentations = observed
    ? providerPresentationsForMachine(providers)
    : []
  const observedAt =
    discovery?.state === 'current' || discovery?.state === 'last_known'
      ? formatMachineLastSeen(discovery.observedAt)
      : undefined
  const canRefresh = connection.state === 'online' && hostReady

  return (
    <section
      className="mt-5 min-w-0 rounded-lg border border-border bg-surface/65 p-5"
      aria-labelledby="remote-machine-providers-heading"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id="remote-machine-providers-heading"
            className="text-section font-semibold text-text-primary"
          >
            智能体
          </h2>
          <p className="mt-0.5 text-sm text-text-secondary">
            由受信任的 CodeTether Node 执行一次有界检测。
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={!canRefresh || refreshPending}
          aria-describedby={
            canRefresh ? undefined : 'remote-provider-refresh-unavailable'
          }
          title={canRefresh ? undefined : '远程机器在线后才能重新检测智能体'}
          onClick={onRefresh}
        >
          <RefreshCw
            aria-hidden="true"
            className={cn(
              refreshPending && 'animate-spin motion-reduce:animate-none',
            )}
          />
          {refreshPending ? '正在检测…' : '重新检测智能体'}
        </Button>
        {canRefresh ? null : (
          <span id="remote-provider-refresh-unavailable" className="sr-only">
            远程机器在线后才能重新检测智能体。
          </span>
        )}
      </div>
      <Separator className="my-4" />

      {discovery === undefined || discovery.state === 'not_observed' ? (
        <p className="text-sm text-text-muted">
          尚未从这台机器检测智能体。远程会话执行仍未启用。
        </p>
      ) : (
        <>
          <p className="mb-4 text-xs text-text-muted" role="status">
            {discovery.state === 'current'
              ? `当前连接已验证${observedAt === undefined ? '' : ` · ${observedAt}`}`
              : `上次检测${observedAt === undefined ? '' : ` · ${observedAt}`} · 当前未重新验证`}
          </p>
          <ul className="grid min-w-0 gap-3 md:grid-cols-2">
            {presentations.map((provider) => (
              <li
                key={provider.provider}
                aria-label={`${provider.displayName}：${
                  provider.available ? '已安装' : provider.availabilityLabel
                }`}
                className="flex min-w-0 items-start gap-3 rounded-md border border-border bg-surface-muted/45 px-3 py-3"
              >
                <AgentBadge agent={provider.agent} variant="compact" />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0 truncate text-sm font-medium text-text-primary">
                      {provider.displayName}
                    </span>
                    <span
                      className={cn(
                        'text-xs',
                        provider.available ? 'text-success' : 'text-text-muted',
                      )}
                    >
                      {provider.available
                        ? '已安装'
                        : provider.availabilityLabel}
                    </span>
                  </div>
                  {provider.version === undefined ? null : (
                    <p
                      title={provider.version}
                      className="mt-1 max-w-full truncate font-mono text-xs text-text-muted"
                    >
                      {provider.version}
                    </p>
                  )}
                  {provider.available ? (
                    <p className="mt-1 text-xs text-text-muted">
                      {provider.capabilities.streaming &&
                      provider.capabilities.resume
                        ? discovery.state === 'current'
                          ? '远程会话基础能力已启用 · 仅文本流式与原生恢复'
                          : '上次检测支持文本流式与原生恢复 · 当前未重新验证'
                        : '已检测到 CLI；远程执行尚未启用'}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {refreshError !== null && refreshError !== undefined ? (
        <p
          role="alert"
          className="mt-3 break-words rounded-sm border border-danger/30 bg-danger-muted px-3 py-2 text-sm text-danger"
        >
          {machineErrorMessage(refreshError, 'refresh-providers')}
        </p>
      ) : null}
    </section>
  )
}

function remoteConnectionDescription(
  state: MachineSummary['connectionState'],
): string {
  switch (state) {
    case 'online':
      return '远程节点当前在线，身份验证已通过。'
    case 'connecting':
      return '正在验证远程节点并建立安全连接。'
    case 'offline':
      return '远程节点当前离线；信任关系仍然保留。'
    case 'recovery_required':
      return '已保存的地址当前不可用；请重试或更新连接地址。'
    case 'authentication_failed':
      return '最近连接无法验证远程节点身份，CodeTether 已拒绝信任该连接。'
    case 'incompatible':
      return '远程节点协议版本不兼容，需要更新后才能重新连接。'
    case 'local':
      return '本地连接。'
  }
}

function MachineMetadata({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd title={value} className="mt-1.5 truncate text-base text-text-primary">
        {value}
      </dd>
    </div>
  )
}

function MachineNotFound() {
  return (
    <MachinePageFrame>
      <section className="grid min-h-64 place-items-center rounded-lg border border-border bg-surface/45 px-6 py-10 text-center">
        <div className="max-w-md">
          <h1 className="text-section font-semibold text-text-primary">
            机器不存在
          </h1>
          <p className="mt-1.5 text-sm text-text-secondary">
            该机器记录不存在，或链接中的机器标识无效。
          </p>
          <Button asChild variant="secondary" className="mt-5">
            <Link to="/machines">返回机器列表</Link>
          </Button>
        </div>
      </section>
    </MachinePageFrame>
  )
}

function MachinePageFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full min-w-0 px-[var(--layout-content-inline-padding)] py-[var(--layout-content-block-padding)]">
      {children}
    </div>
  )
}
