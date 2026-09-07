import { useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import {
  Activity,
  Bot,
  CircleHelp,
  FolderOpen,
  History,
  LoaderCircle,
  Monitor,
  Network,
  RefreshCw,
  Settings,
  ShieldCheck,
} from 'lucide-react'

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@codetether/ui'
import type {
  DoctorComponentState,
  DoctorProviderStatus,
  DoctorRemoteComputer,
} from '@codetether/protocol'

import {
  useHostConnectionState,
  useHostRuntime,
} from '../../runtime/host/host-runtime-hooks'
import {
  doctorQueryKeys,
  doctorQueryOptions,
} from '../../runtime/host/doctor-query'
import {
  DoctorRefreshCoordinator,
  refreshMachinesBounded,
} from '../../runtime/host/doctor-refresh'
import { onboardingQueryOptions } from '../../runtime/host/onboarding-query'
import { machineConnectionStateLabel } from '../machines/machine-presentation'
import { AddProjectDialog } from '../projects/add-project-dialog'
import {
  backendModeLabel,
  backendReadinessLabel,
  doctorOverallPresentation,
  doctorStateBadgeVariant,
  doctorStateLabel,
  isProviderUsable,
  lifecycleObservationLabel,
  providerCompatibilityLabel,
  providerDisplayName,
  providerInstallationGuidance,
  providerRepairText,
  providerVersionLabel,
  remoteComputerRepairText,
} from '../onboarding/onboarding-model'
import { ProviderGuidanceLink } from '../onboarding/provider-guidance-link'

export function DoctorPage() {
  const runtime = useHostRuntime()
  const queryClient = useQueryClient()
  const connectionState = useHostConnectionState()
  const navigate = useNavigate()
  const search = useSearch({ from: '/doctor' })
  const checkButtonRef = useRef<HTMLButtonElement>(null)
  const refreshCoordinatorRef = useRef(new DoctorRefreshCoordinator())
  const [checking, setChecking] = useState(false)
  const [checkIssue, setCheckIssue] = useState<'partial' | 'failed'>()
  const onboardingQuery = useQuery({
    ...onboardingQueryOptions(runtime),
    enabled: connectionState === 'connected',
  })
  const projectId = search.projectId ?? onboardingQuery.data?.projectId
  const doctorQuery = useQuery({
    ...doctorQueryOptions(runtime, projectId),
    enabled:
      connectionState === 'connected' &&
      (search.projectId !== undefined ||
        onboardingQuery.data !== undefined ||
        onboardingQuery.isError),
  })
  const reopenMutation = useMutation({
    mutationFn: async () => {
      const progress = onboardingQuery.data
      if (progress !== undefined && progress.step === 'ready') {
        await runtime.updateOnboarding(progress.revision, { kind: 'reopen' })
      }
    },
    onSuccess: async () => await navigate({ to: '/setup' }),
  })

  function checkAgain(): Promise<void> {
    return refreshCoordinatorRef.current.run(async () => {
      setChecking(true)
      setCheckIssue(undefined)
      try {
        const current = doctorQuery.data
        let failedMachineCount = 0
        if (current !== undefined) {
          const result = await refreshMachinesBounded(
            [
              current.thisComputer.machineId,
              ...current.remoteComputers.map((machine) => machine.machineId),
            ],
            async (machineId) => {
              const remote = current.remoteComputers.find(
                (machine) => machine.machineId === machineId,
              )
              if (remote !== undefined && remote.connectionState !== 'online') {
                const retry = await runtime.retryMachineConnection(machineId)
                if (retry.data.machine.connectionState !== 'online') return
              }
              await runtime.refreshMachineProviders(machineId)
            },
          )
          failedMachineCount = result.failedMachineIds.length
        }
        try {
          const response = await runtime.getDoctor({
            ...(projectId === undefined ? {} : { projectId }),
            check: true,
          })
          queryClient.setQueryData(
            doctorQueryKeys.report(projectId),
            response.doctor,
          )
          if (failedMachineCount > 0) setCheckIssue('partial')
        } catch {
          setCheckIssue('failed')
          await doctorQuery.refetch()
        }
      } finally {
        setChecking(false)
        requestAnimationFrame(() => checkButtonRef.current?.focus())
      }
    })
  }

  if (connectionState !== 'connected') {
    return (
      <DoctorUnavailable
        connectionState={connectionState}
        onRetry={() => {
          runtime.retry()
          void doctorQuery.refetch()
        }}
      />
    )
  }

  if (doctorQuery.data === undefined) {
    return (
      <DoctorLoading
        failed={doctorQuery.isError}
        onRetry={() => void doctorQuery.refetch()}
      />
    )
  }

  const doctor = doctorQuery.data
  const overallPresentation = doctorOverallPresentation(doctor)

  return (
    <section
      aria-labelledby="doctor-heading"
      aria-busy={checking || doctorQuery.isFetching}
      className="mx-auto w-full max-w-5xl px-[var(--layout-content-inline-padding)] py-[var(--layout-content-block-padding)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1
            id="doctor-heading"
            className="text-page font-semibold text-text-primary"
          >
            CodeTether 检查
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-text-secondary">
            查看电脑、AI 工具、AI
            服务、项目和远程连接分别是否可用。检查不会发送提示或创建对话。
          </p>
        </div>
        <Button
          ref={checkButtonRef}
          type="button"
          size="sm"
          disabled={checking || doctorQuery.isFetching}
          onClick={() => void checkAgain()}
        >
          {checking || doctorQuery.isFetching ? (
            <LoaderCircle
              aria-hidden="true"
              className="animate-spin motion-reduce:animate-none"
            />
          ) : (
            <RefreshCw aria-hidden="true" />
          )}
          重新检查
        </Button>
      </div>

      <Card className="mt-5 border-primary/30 bg-primary-muted/15">
        <CardContent className="flex flex-wrap items-center gap-4 p-5">
          <span
            aria-hidden="true"
            className="grid size-11 place-items-center rounded-md border border-primary/30 bg-primary-muted text-primary"
          >
            <Activity className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-lg font-semibold text-text-primary">
              {overallPresentation.title}
            </span>
            <span className="mt-1 block text-sm text-text-secondary">
              {overallPresentation.detail}
            </span>
          </span>
          <StateBadge state={doctor.overall} />
        </CardContent>
      </Card>

      {checkIssue !== undefined ? (
        <p
          role="alert"
          className="mt-4 rounded-sm border border-warning/30 bg-warning-muted/30 px-3 py-2 text-sm text-text-secondary"
        >
          {checkIssue === 'partial'
            ? '部分电脑暂时无法完成检查。下面保留其明确标注的新鲜度和上次已知状态。'
            : '检查暂时未完成。下面的现有状态没有被改成“就绪”，请稍后重试。'}
        </p>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <DoctorSection
          icon={<Monitor aria-hidden="true" />}
          title="这台电脑"
          state={doctor.thisComputer.state}
        >
          <KeyValue label="电脑" value={doctor.thisComputer.displayName} />
          <KeyValue
            label="应用服务"
            value={doctorStateLabel(doctor.thisComputer.state)}
          />
          <details className="mt-3 rounded-sm border border-border px-3 py-2 text-xs text-text-muted">
            <summary className="cursor-pointer font-medium text-text-secondary">
              技术详情
            </summary>
            <div className="mt-2 space-y-1">
              <KeyValue
                label="平台"
                value={doctor.thisComputer.platform}
                compact
              />
              <KeyValue
                label="架构"
                value={doctor.thisComputer.architecture}
                compact
              />
              <KeyValue
                label="机器标识"
                value={doctor.thisComputer.machineId}
                compact
                mono
              />
            </div>
          </details>
        </DoctorSection>

        <DoctorSection
          icon={<FolderOpen aria-hidden="true" />}
          title="当前项目"
          state={doctor.project?.state ?? 'unknown'}
        >
          {doctor.project === undefined ? (
            <>
              <p className="text-sm text-text-secondary">
                尚未选择项目。选择文件夹后，CodeTether 会验证并注册它。
              </p>
              <AddProjectDialog
                trigger={
                  <Button className="mt-4" size="sm" type="button">
                    <FolderOpen aria-hidden="true" />
                    选择项目
                  </Button>
                }
              />
            </>
          ) : (
            <>
              <KeyValue label="项目" value={doctor.project.name} />
              <div className="mt-3 space-y-2">
                {doctor.project.locations.map((location) => (
                  <div
                    key={location.machineId}
                    className="flex items-center justify-between gap-3 rounded-sm border border-border bg-surface-muted px-3 py-2"
                  >
                    <span className="min-w-0 truncate text-sm">
                      {location.machineName}
                    </span>
                    <StateBadge state={location.state} />
                  </div>
                ))}
              </div>
              {doctor.project.state !== 'ready' ? (
                <div className="mt-3">
                  <p className="text-sm text-warning">
                    {doctor.project.state === 'unknown'
                      ? '远程项目文件夹尚未完成当前检查。选择“重新检查”不会发送提示或创建对话。'
                      : doctor.project.state === 'offline'
                        ? '项目所在电脑当前离线。历史记录仍可查看，电脑恢复连接后可重新检查。'
                        : '项目文件夹在对应电脑上不可用。请从项目详情选择或更新一个有效位置。'}
                  </p>
                  <Link
                    to="/projects/$projectId"
                    params={{ projectId: doctor.project.projectId }}
                    className="mt-2 inline-flex rounded-sm text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    打开项目详情
                  </Link>
                </div>
              ) : null}
            </>
          )}
        </DoctorSection>
      </div>

      <section aria-labelledby="doctor-providers-heading" className="mt-4">
        <div className="mb-3 flex items-center gap-2">
          <Bot aria-hidden="true" className="size-5 text-primary" />
          <h2
            id="doctor-providers-heading"
            className="text-lg font-semibold text-text-primary"
          >
            AI 工具
          </h2>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {doctor.providers.map((provider) => (
            <DoctorProviderCard key={provider.provider} provider={provider} />
          ))}
        </div>
      </section>

      <section aria-labelledby="doctor-remote-heading" className="mt-4">
        <div className="mb-3 flex items-center gap-2">
          <Network aria-hidden="true" className="size-5 text-primary" />
          <h2
            id="doctor-remote-heading"
            className="text-lg font-semibold text-text-primary"
          >
            远程访问
          </h2>
        </div>
        {doctor.remoteComputers.length === 0 ? (
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-text-secondary">
                尚未添加其他电脑。本机使用不需要远程连接。
              </p>
              <Link
                to="/machines"
                className="mt-3 inline-flex rounded-sm text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                添加另一台电脑
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {doctor.remoteComputers.map((machine) => (
              <RemoteComputerCard key={machine.machineId} machine={machine} />
            ))}
          </div>
        )}
      </section>

      <Card className="mt-4">
        <CardHeader>
          <div className="flex items-center gap-2">
            <History aria-hidden="true" className="size-4 text-primary" />
            <CardTitle>以前的会话</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2">
            {doctor.providers.map((provider) => (
              <KeyValue
                key={provider.provider}
                label={providerDisplayName(provider.provider)}
                value={sessionDiscoveryLabel(provider.sessionDiscovery)}
              />
            ))}
          </div>
          <p className="mt-3 text-xs text-text-muted">
            找不到以前的会话不会阻止创建新对话。检查本身不会读取会话内容或启动推理。
          </p>
        </CardContent>
      </Card>

      <div className="mt-5 flex flex-wrap gap-2">
        <Link
          to="/settings"
          className="inline-flex h-9 items-center gap-2 rounded-sm border border-border-strong bg-surface-muted px-3 text-sm font-medium text-text-primary outline-none hover:bg-surface-emphasis focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Settings aria-hidden="true" className="size-4" />
          打开设置
        </Link>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={
            reopenMutation.isPending || onboardingQuery.data === undefined
          }
          onClick={() => reopenMutation.mutate()}
        >
          <CircleHelp aria-hidden="true" className="size-4" />
          重新运行设置
        </Button>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {checking || doctorQuery.isFetching
          ? '正在重新检查。'
          : `检查完成：${doctorStateLabel(doctor.overall)}。`}
      </p>
    </section>
  )
}

function DoctorSection({
  children,
  icon,
  state,
  title,
}: {
  readonly children: ReactNode
  readonly icon: ReactNode
  readonly state: DoctorComponentState
  readonly title: string
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-primary [&>svg]:size-4">{icon}</span>
            <CardTitle>{title}</CardTitle>
          </div>
          <StateBadge state={state} />
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function DoctorProviderCard({
  provider,
}: {
  readonly provider: DoctorProviderStatus
}) {
  const guidance = providerInstallationGuidance[provider.provider]
  const authRequired =
    provider.backend?.freshness === 'current' &&
    provider.backend.readiness === 'authentication_required'
  const currentlyConfirmedMissing =
    provider.freshness === 'current' && !provider.installed
  return (
    <DoctorSection
      icon={<Bot aria-hidden="true" />}
      title={providerDisplayName(provider.provider)}
      state={provider.state}
    >
      <div className="space-y-2">
        <KeyValue label="安装" value={providerVersionLabel(provider)} />
        <KeyValue
          label="运行环境"
          value={providerCompatibilityLabel(provider)}
        />
        <KeyValue
          label={backendModeLabel(provider.backend)}
          value={backendReadinessLabel(provider.backend)}
        />
        <KeyValue
          label="检查时间"
          value={lifecycleObservationLabel(
            provider.freshness,
            provider.observedAt,
          )}
        />
      </div>
      {provider.freshness !== 'current' ? (
        <p
          role="status"
          className="mt-3 rounded-sm border border-warning/30 bg-warning-muted/30 px-3 py-2 text-sm text-text-secondary"
        >
          {provider.freshness === 'last_known'
            ? '这是上次检查的状态，不代表当前电脑状态。'
            : '此工具尚未完成状态检查。'}
        </p>
      ) : null}
      {authRequired ? (
        <p className="mt-3 rounded-sm border border-warning/30 bg-warning-muted/30 px-3 py-2 text-sm text-text-secondary">
          {provider.backend?.mode === 'first_party'
            ? '此 AI 服务需要完成 Provider 的第一方登录。'
            : '自定义 AI 服务需要检查凭据或配置；CodeTether 不会要求第一方登录。'}
        </p>
      ) : null}
      <p className="mt-3 text-sm leading-relaxed text-text-secondary">
        {providerRepairText(provider)}
      </p>
      {currentlyConfirmedMissing ? (
        <div className="mt-3">
          <ProviderGuidanceLink provider={provider.provider}>
            {guidance.action}
          </ProviderGuidanceLink>
        </div>
      ) : null}
      {authRequired && provider.backend?.mode === 'first_party' ? (
        <div className="mt-3">
          <ProviderGuidanceLink provider={provider.provider}>
            查看官方登录指南
          </ProviderGuidanceLink>
        </div>
      ) : null}
      <details className="mt-3 rounded-sm border border-border px-3 py-2 text-xs text-text-muted">
        <summary className="cursor-pointer font-medium text-text-secondary">
          技术详情
        </summary>
        <div className="mt-2 space-y-1">
          <KeyValue
            label="已选择安装"
            value={provider.selected ? '是' : '否'}
            compact
          />
          <KeyValue
            label="其他安装"
            value={String(provider.alternateInstallations)}
            compact
          />
          {provider.installMethod !== undefined ? (
            <KeyValue
              label="安装方式"
              value={provider.installMethod}
              compact
              mono
            />
          ) : null}
          {provider.launcherKind !== undefined ? (
            <KeyValue
              label="启动类型"
              value={provider.launcherKind}
              compact
              mono
            />
          ) : null}
          <KeyValue
            label="状态"
            value={provider.compatibility ?? 'not_observed'}
            compact
            mono
          />
          <KeyValue
            label="新会话"
            value={provider.runtimeReadiness ?? 'not_observed'}
            compact
            mono
          />
          <KeyValue
            label="以前的会话"
            value={provider.sessionDiscovery}
            compact
            mono
          />
          <KeyValue
            label="信息新鲜度"
            value={provider.freshness}
            compact
            mono
          />
          {provider.failure !== undefined ? (
            <KeyValue
              label="诊断代码"
              value={provider.failure.reason}
              compact
              mono
            />
          ) : null}
          {provider.backend?.failure !== undefined ? (
            <KeyValue
              label="AI 服务诊断代码"
              value={provider.backend.failure.reason}
              compact
              mono
            />
          ) : null}
        </div>
      </details>
    </DoctorSection>
  )
}

function RemoteComputerCard({
  machine,
}: {
  readonly machine: DoctorRemoteComputer
}) {
  const executionReady = machine.providers.some(isProviderUsable)
  const repairText = remoteComputerRepairText(machine.connectionState)
  const internetLabel = machine.relay.internetExecutionEnabled
    ? 'Internet 远程连接可用'
    : machine.executionTransport === 'direct'
      ? '局域网直连可用；Internet 远程连接不可用'
      : 'Internet 远程连接不可用'
  return (
    <DoctorSection
      icon={<ShieldCheck aria-hidden="true" />}
      title={machine.displayName}
      state={machine.state}
    >
      <KeyValue
        label="连接"
        value={machineConnectionStateLabel(machine.connectionState)}
      />
      <KeyValue label="远程访问" value={internetLabel} />
      <KeyValue
        label="AI 工具"
        value={executionReady ? '至少一个执行路径可用' : '没有就绪的执行路径'}
      />
      <KeyValue
        label="工具状态"
        value={lifecycleObservationLabel(
          machine.providerFreshness,
          machine.observedAt,
        )}
      />
      {repairText !== undefined ? (
        <p
          role={
            machine.connectionState === 'authentication_failed' ||
            machine.connectionState === 'incompatible'
              ? 'alert'
              : 'status'
          }
          className="mt-3 rounded-sm border border-warning/30 bg-warning-muted/30 px-3 py-2 text-sm text-text-secondary"
        >
          {repairText}
        </p>
      ) : null}
      <div className="mt-3 space-y-2">
        {machine.providers.map((provider) => (
          <div
            key={provider.provider}
            className="rounded-sm border border-border bg-surface-muted px-3 py-2.5"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-text-primary">
                {providerDisplayName(provider.provider)}
              </span>
              <StateBadge state={provider.state} />
            </div>
            <div className="mt-2 space-y-1">
              <KeyValue
                label="版本"
                value={providerVersionLabel(provider)}
                compact
              />
              <KeyValue
                label="运行环境"
                value={providerCompatibilityLabel(provider)}
                compact
              />
              <KeyValue
                label={backendModeLabel(provider.backend)}
                value={backendReadinessLabel(provider.backend)}
                compact
              />
              <KeyValue
                label="以前的会话"
                value={sessionDiscoveryLabel(provider.sessionDiscovery)}
                compact
              />
            </div>
            {provider.state !== 'ready' ? (
              <p className="mt-2 text-xs leading-relaxed text-text-secondary">
                {providerRepairText(provider)}
              </p>
            ) : null}
          </div>
        ))}
      </div>
      <details className="mt-3 rounded-sm border border-border px-3 py-2 text-xs text-text-muted">
        <summary className="cursor-pointer font-medium text-text-secondary">
          技术详情
        </summary>
        <div className="mt-2 space-y-1">
          <KeyValue
            label="传输"
            value={machine.executionTransport ?? 'none'}
            compact
            mono
          />
          <KeyValue
            label="Provider 状态"
            value={machine.providerFreshness}
            compact
            mono
          />
          <KeyValue
            label="Relay 连接"
            value={machine.relay.connectionState}
            compact
            mono
          />
          <KeyValue
            label="Relay enrollment"
            value={machine.relay.enrollment}
            compact
            mono
          />
          <KeyValue
            label="Node presence"
            value={machine.relay.nodePresence}
            compact
            mono
          />
          {machine.relay.failure !== undefined ? (
            <KeyValue
              label="诊断代码"
              value={machine.relay.failure.reason}
              compact
              mono
            />
          ) : null}
        </div>
      </details>
      <Link
        to="/machines/$machineId"
        params={{ machineId: machine.machineId }}
        className="mt-3 inline-flex rounded-sm text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        打开电脑详情
      </Link>
    </DoctorSection>
  )
}

function StateBadge({ state }: { readonly state: DoctorComponentState }) {
  return (
    <Badge variant={doctorStateBadgeVariant(state)}>
      {doctorStateLabel(state)}
    </Badge>
  )
}

function KeyValue({
  compact = false,
  label,
  mono = false,
  value,
}: {
  readonly compact?: boolean
  readonly label: string
  readonly mono?: boolean
  readonly value: string
}) {
  return (
    <div
      className={`flex min-w-0 items-start justify-between gap-4 ${compact ? 'text-xs' : 'text-sm'}`}
    >
      <span className="shrink-0 text-text-muted">{label}</span>
      <span
        className={`min-w-0 break-words text-right text-text-primary ${mono ? 'font-mono' : ''}`}
      >
        {value}
      </span>
    </div>
  )
}

function sessionDiscoveryLabel(
  state: DoctorProviderStatus['sessionDiscovery'],
): string {
  switch (state) {
    case 'supported':
      return '可用'
    case 'unsupported':
      return '此 Provider 版本不支持'
    case 'unavailable':
      return '暂时不可用'
    case 'unknown':
      return '尚未检查'
  }
}

function DoctorLoading({
  failed,
  onRetry,
}: {
  readonly failed: boolean
  readonly onRetry: () => void
}) {
  return (
    <div className="grid min-h-[50vh] place-items-center p-6">
      <div
        className="text-center"
        role={failed ? 'alert' : 'status'}
        aria-live="polite"
      >
        {!failed ? (
          <LoaderCircle
            aria-hidden="true"
            className="mx-auto size-6 animate-spin text-primary motion-reduce:animate-none"
          />
        ) : null}
        <p className="mt-3 text-sm text-text-secondary">
          {failed
            ? '暂时无法生成检查报告。已有数据没有改变。'
            : '正在读取当前状态…'}
        </p>
        {failed ? (
          <Button className="mt-4" size="sm" type="button" onClick={onRetry}>
            重新检查
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function DoctorUnavailable({
  connectionState,
  onRetry,
}: {
  readonly connectionState: string
  readonly onRetry: () => void
}) {
  return (
    <section
      className="mx-auto w-full max-w-2xl p-6"
      aria-labelledby="doctor-unavailable-heading"
    >
      <Card>
        <CardHeader>
          <CardTitle id="doctor-unavailable-heading">
            CodeTether 当前不可连接
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-text-secondary">
            项目和对话历史没有被删除。请等待应用服务恢复后重新检查。
          </p>
          <Button className="mt-4" size="sm" type="button" onClick={onRetry}>
            <RefreshCw aria-hidden="true" />
            重新检查
          </Button>
          <details className="mt-4 text-xs text-text-muted">
            <summary className="cursor-pointer">技术详情</summary>
            <p className="mt-2 font-mono">host_state: {connectionState}</p>
          </details>
        </CardContent>
      </Card>
    </section>
  )
}
