import { useState, type ReactNode } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import {
  ArrowLeft,
  FolderOpen,
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
import { projectLocationForMachine } from '../../runtime/host/project-location'
import { providerPresentationsForMachine } from '../../provider/provider-presentation'
import { formatConversationActivity } from '../conversations/conversation-list-model'
import {
  compactProjectPath,
  projectFolderName,
} from '../projects/project-format'
import { MachinesErrorState, MachinesLoadingState } from './machine-page-states'
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

      <section
        className="mt-5 min-w-0 rounded-lg border border-border bg-surface/65 p-5"
        aria-labelledby="machine-projects-heading"
      >
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2
              id="machine-projects-heading"
              className="text-section font-semibold text-text-primary"
            >
              项目
            </h2>
            <p className="mt-0.5 text-sm text-text-secondary">
              注册在这台机器上的工作区。
            </p>
          </div>
          <span className="text-xs text-text-muted">{projects.length} 个</span>
        </div>
        <Separator className="my-4" />
        {projects.length === 0 ? (
          <p className="text-sm text-text-muted">这台机器上还没有项目。</p>
        ) : (
          <ul className="grid min-w-0 gap-3 lg:grid-cols-2">
            {projects.map((project) => {
              const location = projectLocationForMachine(
                project,
                machine.machineId,
              )
              return (
                <li
                  key={project.projectId}
                  className="min-w-0 rounded-md border border-border bg-surface-muted/35 p-3"
                >
                  <Link
                    to="/projects/$projectId"
                    params={{ projectId: project.projectId }}
                    className="flex min-w-0 items-center gap-3 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  >
                    <FolderOpen
                      aria-hidden="true"
                      className="size-4 shrink-0 text-primary"
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className="block truncate text-sm font-medium text-text-primary"
                        title={project.name}
                      >
                        {project.name}
                      </span>
                      {location === undefined ? null : (
                        <span
                          className="mt-0.5 block truncate font-mono text-xs text-text-muted"
                          title={location.rootPath}
                        >
                          {projectFolderName(location.rootPath)} ·{' '}
                          {compactProjectPath(location.rootPath)}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>

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
  onUnpair: () => void
  onUnpairOpenChange: (open: boolean) => void
  unpairOpen: boolean
}

function RemoteMachineDetail({
  connection,
  hostConnectionState,
  machine,
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

      <section className="mt-5 min-w-0 rounded-lg border border-border bg-surface/65 p-5">
        <h2 className="text-section font-semibold text-text-primary">
          当前能力
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-text-secondary">
          此阶段仅验证远程节点身份和安全连接。远程项目、智能体、会话、终端和文件操作尚未启用。
        </p>
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

      <UnpairMachineDialog
        machine={machine}
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
