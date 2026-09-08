import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  ArrowRight,
  Bot,
  Check,
  FolderOpen,
  LoaderCircle,
  Monitor,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@codetether/ui'
import type {
  DoctorProviderStatus,
  DoctorReport,
  MachineId,
  MachineSummary,
  OnboardingProgress,
  OnboardingTransition,
  ProjectRecord,
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
import { machineListQueryOptions } from '../../runtime/host/machine-query'
import { onboardingQueryOptions } from '../../runtime/host/onboarding-query'
import { projectListQueryOptions } from '../../runtime/host/project-query'
import { AddRemoteMachineDialog } from '../machines/add-remote-machine-dialog'
import { AddProjectDialog } from '../projects/add-project-dialog'
import { AddProjectLocationDialog } from '../projects/add-project-location-dialog'
import { PreviousConversationsStep } from '../projects/previous-conversations-step'
import {
  backendModeLabel,
  backendReadinessLabel,
  doctorStateBadgeVariant,
  doctorStateLabel,
  isDoctorExecutionContextReady,
  isProviderUsable,
  lifecycleObservationLabel,
  localOnboardingBlockerText,
  onboardingStepIndex,
  onboardingSteps,
  providerCompatibilityLabel,
  providerDisplayName,
  providerInstallationGuidance,
  providerRepairText,
  providerVersionLabel,
  remoteOnboardingBlockerText,
} from './onboarding-model'
import { ProviderGuidanceLink } from './provider-guidance-link'

const stepLabels = {
  welcome: '欢迎',
  computer_check: '这台电脑',
  provider_check: 'AI 工具',
  project_setup: '项目',
  previous_conversations: '以前的会话',
  remote_setup: '另一台电脑',
  ready: '完成',
} as const

export function OnboardingPage() {
  const runtime = useHostRuntime()
  const queryClient = useQueryClient()
  const connectionState = useHostConnectionState()
  const navigate = useNavigate()
  const stepHeadingRef = useRef<HTMLHeadingElement>(null)
  const providerRefreshCoordinatorRef = useRef(new DoctorRefreshCoordinator())
  const remoteRefreshCoordinatorRef = useRef(new DoctorRefreshCoordinator())
  const contextCheckCoordinatorRef = useRef(new DoctorRefreshCoordinator())
  const readyCheckKeyRef = useRef<string | undefined>(undefined)
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const [providerRefreshing, setProviderRefreshing] = useState(false)
  const [providerRefreshFailed, setProviderRefreshFailed] = useState(false)
  const [contextChecking, setContextChecking] = useState(false)
  const [contextCheckFailed, setContextCheckFailed] = useState(false)
  const [contextCheckedKey, setContextCheckedKey] = useState<string>()
  const connected = connectionState === 'connected'
  const onboardingQuery = useQuery({
    ...onboardingQueryOptions(runtime),
    enabled: connected,
  })
  const onboarding = onboardingQuery.data
  const doctorQuery = useQuery({
    ...doctorQueryOptions(runtime, onboarding?.projectId),
    enabled: connected && onboarding !== undefined,
  })
  const refetchDoctor = doctorQuery.refetch
  const projectListQuery = useQuery({
    ...projectListQueryOptions(runtime),
    enabled:
      connected &&
      (onboarding?.step === 'project_setup' ||
        onboarding?.step === 'remote_setup' ||
        onboarding?.step === 'ready'),
  })
  const machineListQuery = useQuery({
    ...machineListQueryOptions(runtime),
    enabled:
      connected &&
      (onboarding?.step === 'project_setup' ||
        onboarding?.step === 'remote_setup'),
  })
  const transitionMutation = useMutation({
    mutationFn: async ({
      progress,
      transition,
    }: {
      readonly progress: OnboardingProgress
      readonly transition: OnboardingTransition
    }) => await runtime.updateOnboarding(progress.revision, transition),
    onError: async () => {
      // Another Desktop window may have committed the same logical step. Pull
      // the durable Host revision so the next explicit action does not loop on
      // a stale compare-and-set value.
      await Promise.allSettled([
        onboardingQuery.refetch(),
        doctorQuery.refetch(),
      ])
    },
  })
  const onboardingStep = onboarding?.step
  const onboardingContentReady =
    onboardingStep !== undefined && doctorQuery.data !== undefined

  useEffect(() => {
    if (!onboardingContentReady) return
    const frame = requestAnimationFrame(() => stepHeadingRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [onboardingContentReady, onboardingStep])

  async function transition(
    next: OnboardingTransition,
  ): Promise<OnboardingProgress | undefined> {
    if (onboarding === undefined || transitionMutation.isPending) return
    try {
      const result = await transitionMutation.mutateAsync({
        progress: onboarding,
        transition: next,
      })
      return result.data.onboarding
    } catch {
      // The mutation owns presentation and refreshes the authoritative durable
      // revision. Callers must not create an unhandled rejection.
    }
  }

  const checkSelectedContext = useCallback(
    (
      progress: OnboardingProgress,
      refreshProviderFacts = true,
    ): Promise<void> => {
      if (
        progress.projectId === undefined ||
        progress.machineId === undefined
      ) {
        return Promise.resolve()
      }
      const projectId = progress.projectId
      const machineId = progress.machineId
      const checkKey = `${progress.revision}:${projectId}:${machineId}`
      setContextCheckedKey(undefined)
      return contextCheckCoordinatorRef.current
        .run(async () => {
          setContextChecking(true)
          setContextCheckFailed(false)
          try {
            const currentDoctor = queryClient.getQueryData<DoctorReport>(
              doctorQueryKeys.report(projectId),
            )
            const remote = currentDoctor?.remoteComputers.find(
              (machine) => machine.machineId === machineId,
            )
            const refresh = refreshProviderFacts
              ? await refreshMachinesBounded([machineId], async (machineId) => {
                  if (
                    machineId !== currentDoctor?.thisComputer.machineId &&
                    remote?.connectionState !== 'online'
                  ) {
                    const retry =
                      await runtime.retryMachineConnection(machineId)
                    if (retry.data.machine.connectionState !== 'online') {
                      throw new Error('remote_machine_not_online')
                    }
                  }
                  await runtime.refreshMachineProviders(machineId)
                })
              : { failedMachineIds: [] }
            const response = await runtime.getDoctor({
              projectId,
              check: true,
            })
            queryClient.setQueryData(
              doctorQueryKeys.report(projectId),
              response.doctor,
            )
            setContextCheckFailed(refresh.failedMachineIds.length > 0)
          } catch {
            setContextCheckFailed(true)
            await refetchDoctor()
          } finally {
            setContextChecking(false)
          }
        })
        .finally(() => setContextCheckedKey(checkKey))
    },
    [queryClient, refetchDoctor, runtime],
  )

  useEffect(() => {
    if (
      onboarding?.step !== 'ready' ||
      onboarding.projectId === undefined ||
      onboarding.machineId === undefined
    ) {
      return
    }
    const checkKey = `${onboarding.revision}:${onboarding.projectId}:${onboarding.machineId}`
    if (readyCheckKeyRef.current === checkKey) return
    readyCheckKeyRef.current = checkKey
    // Revalidate the exact ProjectLocation and consume current lifecycle facts.
    // A redundant metadata scan would intentionally make successful backend
    // observations last-known under Phase 8B, without checking the AI service.
    // Explicit Check Again and remote Project selection still refresh Providers.
    void checkSelectedContext(onboarding, false)
  }, [checkSelectedContext, onboarding])

  function refreshProviders(): Promise<void> {
    return providerRefreshCoordinatorRef.current.run(async () => {
      setProviderRefreshing(true)
      setProviderRefreshFailed(false)
      try {
        const doctor = doctorQuery.data
        let refreshFailed = false
        if (doctor !== undefined) {
          const result = await refreshMachinesBounded(
            [doctor.thisComputer.machineId],
            (machineId) => runtime.refreshMachineProviders(machineId),
          )
          refreshFailed = result.failedMachineIds.length > 0
        }
        const refreshed = await doctorQuery.refetch()
        setProviderRefreshFailed(refreshFailed || refreshed.isError)
      } finally {
        setProviderRefreshing(false)
      }
    })
  }

  if (!connected) {
    return (
      <SetupUnavailable
        connectionState={connectionState}
        onRetry={() => {
          runtime.retry()
          void onboardingQuery.refetch()
          void doctorQuery.refetch()
        }}
      />
    )
  }

  if (onboarding === undefined || doctorQuery.data === undefined) {
    return (
      <SetupLoading
        failed={onboardingQuery.isError || doctorQuery.isError}
        onRetry={() => {
          void onboardingQuery.refetch()
          void doctorQuery.refetch()
        }}
      />
    )
  }

  const doctor = doctorQuery.data
  const projects = projectListQuery.data ?? []
  const machines = machineListQuery.data ?? []
  const selectedProject = projects.find(
    (project) => project.projectId === onboarding.projectId,
  )
  const currentStep = onboardingStepIndex(onboarding.step)

  return (
    <div
      className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-5 py-6 sm:px-8 sm:py-10"
      aria-busy={
        transitionMutation.isPending ||
        providerRefreshing ||
        contextChecking ||
        doctorQuery.isFetching
      }
    >
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="grid size-9 place-items-center rounded-md border border-primary/40 bg-primary text-sm font-semibold text-text-inverse"
          >
            C
          </span>
          <div>
            <p className="font-semibold text-text-primary">CodeTether</p>
            <p className="text-xs text-text-muted">设置</p>
          </div>
        </div>
        {onboarding.completedAt !== undefined && onboarding.step !== 'ready' ? (
          <Link
            to="/inbox"
            className="rounded-sm px-3 py-2 text-sm text-text-secondary outline-none hover:text-text-primary focus-visible:ring-2 focus-visible:ring-ring"
          >
            暂时返回
          </Link>
        ) : null}
      </header>

      <nav aria-label="设置进度" className="mt-8 overflow-x-auto pb-2">
        <ol className="flex min-w-max items-center gap-2">
          {onboardingSteps.map((step, index) => {
            const complete = index < currentStep
            const active = step === onboarding.step
            return (
              <li
                key={step}
                aria-current={active ? 'step' : undefined}
                className="flex items-center gap-2"
              >
                <span
                  className={`grid size-7 place-items-center rounded-full border text-xs font-semibold ${
                    complete
                      ? 'border-success/40 bg-success-muted text-success'
                      : active
                        ? 'border-primary bg-primary text-text-inverse'
                        : 'border-border bg-surface-muted text-text-muted'
                  }`}
                >
                  {complete ? (
                    <Check aria-hidden="true" className="size-3.5" />
                  ) : (
                    index + 1
                  )}
                </span>
                <span
                  className={
                    active
                      ? 'text-sm font-medium text-text-primary'
                      : 'text-sm text-text-muted'
                  }
                >
                  {stepLabels[step]}
                </span>
                {index < onboardingSteps.length - 1 ? (
                  <span aria-hidden="true" className="h-px w-5 bg-border" />
                ) : null}
              </li>
            )
          })}
        </ol>
      </nav>

      <main
        className="flex flex-1 items-start justify-center py-6"
        id="setup-main"
      >
        <Card className="w-full max-w-3xl shadow-2xl shadow-black/20">
          <CardContent className="p-5 sm:p-7">
            <h1
              ref={stepHeadingRef}
              tabIndex={-1}
              className="sr-only outline-none"
            >
              {stepLabels[onboarding.step]}
            </h1>
            <SetupStep
              doctor={doctor}
              machines={machines}
              onboarding={onboarding}
              projects={projects}
              selectedProject={selectedProject}
              busy={
                transitionMutation.isPending ||
                providerRefreshing ||
                contextChecking
              }
              contextCheckFailed={contextCheckFailed}
              contextCheckCurrent={
                onboarding.step !== 'ready' ||
                (onboarding.projectId !== undefined &&
                  onboarding.machineId !== undefined &&
                  contextCheckedKey ===
                    `${onboarding.revision}:${onboarding.projectId}:${onboarding.machineId}`)
              }
              providerRefreshFailed={providerRefreshFailed}
              projectDialogOpen={projectDialogOpen}
              setProjectDialogOpen={setProjectDialogOpen}
              onContinue={() => void transition({ kind: 'continue' })}
              onProviderRefresh={() => void refreshProviders()}
              onProjectSelected={async (project, machineId) => {
                const progress = await transition({
                  kind: 'project_selected',
                  projectId: project.projectId,
                  machineId,
                })
                if (
                  progress !== undefined &&
                  machineId !== doctor.thisComputer.machineId
                ) {
                  await checkSelectedContext(progress)
                }
              }}
              onProjectContextLost={() =>
                void transition({ kind: 'project_reselect' })
              }
              onPreviousConversationsFinished={async (disposition) => {
                await transition({
                  kind: 'previous_conversations_finished',
                  disposition,
                })
              }}
              onRemoteSetupFinished={async (disposition) => {
                await transition({
                  kind: 'remote_setup_finished',
                  disposition,
                })
              }}
              onRemotePaired={async (machineId) => {
                await remoteRefreshCoordinatorRef.current.run(async () => {
                  await refreshMachinesBounded([machineId], (id) =>
                    runtime.refreshMachineProviders(id),
                  )
                  await Promise.allSettled([
                    machineListQuery.refetch(),
                    doctorQuery.refetch(),
                  ])
                })
              }}
              onCheckSelectedContext={() =>
                void checkSelectedContext(onboarding)
              }
              onStart={() =>
                void navigate(
                  onboarding.projectId === undefined
                    ? { to: '/inbox' }
                    : {
                        to: '/projects/$projectId',
                        params: { projectId: onboarding.projectId },
                      },
                )
              }
            />
          </CardContent>
          {transitionMutation.isError ? (
            <CardFooter>
              <p role="alert" className="text-sm text-danger">
                设置进度暂时无法保存。没有删除或重置任何已有数据，请重试。
              </p>
            </CardFooter>
          ) : null}
        </Card>
      </main>
      <p className="sr-only" role="status" aria-live="polite">
        {transitionMutation.isPending
          ? '正在保存设置进度。'
          : providerRefreshing || contextChecking || doctorQuery.isFetching
            ? '正在检查当前状态。'
            : `当前步骤：${stepLabels[onboarding.step]}`}
      </p>
    </div>
  )
}

interface SetupStepProps {
  readonly doctor: DoctorReport
  readonly machines: readonly MachineSummary[]
  readonly onboarding: OnboardingProgress
  readonly projects: readonly ProjectRecord[]
  readonly selectedProject?: ProjectRecord
  readonly busy: boolean
  readonly contextCheckFailed: boolean
  readonly contextCheckCurrent: boolean
  readonly providerRefreshFailed: boolean
  readonly projectDialogOpen: boolean
  readonly setProjectDialogOpen: (open: boolean) => void
  readonly onContinue: () => void
  readonly onProviderRefresh: () => void
  readonly onProjectSelected: (
    project: ProjectRecord,
    machineId: MachineId,
  ) => Promise<void> | void
  readonly onProjectContextLost: () => void
  readonly onPreviousConversationsFinished: (
    disposition: 'reviewed' | 'skipped',
  ) => Promise<void> | void
  readonly onRemoteSetupFinished: (
    disposition: 'configured' | 'skipped',
  ) => Promise<void> | void
  readonly onRemotePaired: (machineId: MachineId) => Promise<void> | void
  readonly onCheckSelectedContext: () => void
  readonly onStart: () => void
}

function SetupStep(props: SetupStepProps) {
  const { doctor, onboarding } = props
  switch (onboarding.step) {
    case 'welcome':
      return (
        <CenteredStep
          icon={<Bot aria-hidden="true" />}
          title="欢迎使用 CodeTether"
          description="把 Codex、Claude Code、项目和以前的会话放在一个安全的工作空间里。"
        >
          <p className="text-sm leading-relaxed text-text-secondary">
            我们会先检查这台电脑上的现有配置。CodeTether
            不会自动安装、更新或切换你的 AI 工具。
          </p>
          <PrimaryContinue busy={props.busy} onClick={props.onContinue}>
            开始设置
          </PrimaryContinue>
        </CenteredStep>
      )
    case 'computer_check':
      return (
        <CenteredStep
          icon={<Monitor aria-hidden="true" />}
          title="这台电脑已连接"
          description="CodeTether 可以使用本机的安全工作空间。"
        >
          <StatusRow
            label={doctor.thisComputer.displayName}
            detail={`${doctor.thisComputer.platform} · ${doctor.thisComputer.architecture}`}
            state={doctor.thisComputer.state}
          />
          <PrimaryContinue
            busy={props.busy}
            disabled={doctor.thisComputer.state !== 'ready'}
            onClick={props.onContinue}
          >
            检查 AI 工具
          </PrimaryContinue>
        </CenteredStep>
      )
    case 'provider_check': {
      const readyCount = doctor.providers.filter(isProviderUsable).length
      return (
        <div>
          <StepHeading
            icon={<Bot aria-hidden="true" />}
            title="检查你的 AI 工具"
            description="CodeTether 使用已经选择的安装，不会在设置过程中自动安装、更新或切换工具。"
          />
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {doctor.providers.map((provider) => (
              <ProviderCard key={provider.provider} provider={provider} />
            ))}
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={props.busy}
              onClick={props.onProviderRefresh}
            >
              <RefreshCw aria-hidden="true" />
              重新检查
            </Button>
            <Button
              type="button"
              disabled={props.busy}
              onClick={props.onContinue}
            >
              {readyCount > 0 ? '继续' : '暂不设置 AI 工具'}
              <ArrowRight aria-hidden="true" />
            </Button>
          </div>
          {readyCount === 0 ? (
            <p role="status" className="mt-3 text-sm text-warning">
              你可以完成应用设置，但在至少一个 AI 工具就绪前不能开始智能体执行。
            </p>
          ) : null}
          {props.providerRefreshFailed ? (
            <p role="alert" className="mt-3 text-sm text-warning">
              这次检查暂时未能完成。下面保留已有状态及其检查时间，不会把旧状态当作新的结果。
            </p>
          ) : null}
        </div>
      )
    }
    case 'project_setup':
      return (
        <div>
          <StepHeading
            icon={<FolderOpen aria-hidden="true" />}
            title="选择一个项目文件夹"
            description="选择已有项目，或添加这台电脑或另一台已安全连接电脑上的项目文件夹。普通文件夹也可以使用。"
          />
          {props.projects.length > 0 ? (
            <div className="mt-5 max-h-64 space-y-2 overflow-y-auto">
              {props.projects.map((project) => {
                const localLocation = project.locations.find(
                  (location) =>
                    location.machineId === doctor.thisComputer.machineId &&
                    location.availability === 'available',
                )
                const selectedLocation =
                  localLocation ??
                  project.locations.find(
                    (location) =>
                      location.availability === 'available' &&
                      props.machines.some(
                        (machine) =>
                          machine.machineId === location.machineId &&
                          (machine.kind === 'local' ||
                            machine.connectionState === 'online'),
                      ),
                  )
                const selectedMachine = props.machines.find(
                  (machine) =>
                    machine.machineId === selectedLocation?.machineId,
                )
                return (
                  <div
                    key={project.projectId}
                    className="flex min-w-0 items-center gap-3 rounded-md border border-border bg-surface-muted px-4 py-3"
                  >
                    <FolderOpen
                      aria-hidden="true"
                      className="size-4 shrink-0 text-primary"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {project.name}
                      </span>
                      {selectedMachine?.kind === 'remote' ? (
                        <span className="mt-0.5 block truncate text-xs text-text-muted">
                          {selectedMachine.displayName}
                        </span>
                      ) : null}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={selectedLocation === undefined || props.busy}
                      onClick={() => {
                        if (selectedLocation !== undefined) {
                          void props.onProjectSelected(
                            project,
                            selectedLocation.machineId,
                          )
                        }
                      }}
                    >
                      选择
                    </Button>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="mt-5 rounded-md border border-border bg-surface-muted p-4 text-sm text-text-secondary">
              还没有项目。选择一个你已有的项目文件夹即可开始。
            </p>
          )}
          {props.projects.some((project) =>
            project.locations.some(
              (location) =>
                location.machineId === doctor.thisComputer.machineId &&
                location.availability !== 'available',
            ),
          ) ? (
            <p role="status" className="mt-3 text-sm text-warning">
              不可用的项目文件夹不能继续设置。请恢复文件夹，或选择另一个项目。
            </p>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => props.setProjectDialogOpen(true)}
            >
              <FolderOpen aria-hidden="true" />
              选择文件夹
            </Button>
            <AddRemoteMachineDialog
              presentation="ordinary"
              onPaired={props.onRemotePaired}
              trigger={
                <Button type="button" variant="secondary">
                  <Monitor aria-hidden="true" />
                  添加另一台电脑
                </Button>
              }
            />
            {props.machines.some((machine) => machine.kind === 'remote') ? (
              <AddProjectLocationDialog
                createNewProject
                deferPreviousConversations
                machines={props.machines}
                presentation="ordinary"
                onProjectCreated={props.onProjectSelected}
                trigger={
                  <Button type="button" variant="secondary">
                    <FolderOpen aria-hidden="true" />
                    使用另一台电脑上的项目
                  </Button>
                }
              />
            ) : null}
          </div>
          <AddProjectDialog
            deferPreviousConversations
            open={props.projectDialogOpen}
            onOpenChange={props.setProjectDialogOpen}
            onProjectCreated={(project, _created, machineId) => {
              if (machineId !== undefined) {
                return props.onProjectSelected(project, machineId)
              }
            }}
          />
        </div>
      )
    case 'previous_conversations':
      return onboarding.projectId === undefined ||
        onboarding.machineId === undefined ? (
        <InvalidSetupState
          busy={props.busy}
          onReselectProject={props.onProjectContextLost}
        />
      ) : (
        <PreviousConversationsStep
          presentation="page"
          projectId={onboarding.projectId}
          machineId={onboarding.machineId}
          onFinished={props.onPreviousConversationsFinished}
        />
      )
    case 'remote_setup': {
      if (
        onboarding.projectId === undefined ||
        onboarding.machineId === undefined
      ) {
        return (
          <InvalidSetupState
            busy={props.busy}
            onReselectProject={props.onProjectContextLost}
          />
        )
      }
      const remoteMachines = props.machines.filter(
        (machine) => machine.kind === 'remote',
      )
      const configuredRemoteProject = remoteMachines.some((machine) =>
        props.selectedProject?.locations.some(
          (location) =>
            location.machineId === machine.machineId &&
            location.availability === 'available',
        ),
      )
      return (
        <div>
          <StepHeading
            icon={<ShieldCheck aria-hidden="true" />}
            title="添加另一台电脑（可选）"
            description="本机使用不需要网络远程设置。你可以以后随时从“机器”或“设置”中添加。"
          />
          <ol className="mt-5 grid gap-2 rounded-md border border-border bg-surface-muted p-4 text-sm text-text-secondary sm:grid-cols-3">
            <li>
              <strong className="text-text-primary">1.</strong>{' '}
              在另一台受支持的电脑上安装并启动 CodeTether 远程组件。
            </li>
            <li>
              <strong className="text-text-primary">2.</strong>{' '}
              在那台电脑上开启一次安全连接，取得地址和短时设置代码。
            </li>
            <li>
              <strong className="text-text-primary">3.</strong>{' '}
              在这里确认电脑名称、系统和安全校验码。
            </li>
          </ol>
          <p className="mt-3 text-xs text-text-muted">
            不需要开放公网端口、配置 TLS
            或设置端口转发。设置代码只能使用一次，不会成为长期凭据。
          </p>
          <details className="mt-3 rounded-md border border-border bg-surface-muted px-4 py-3 text-sm text-text-secondary">
            <summary className="cursor-pointer font-medium text-text-primary">
              如何启动另一台电脑上的 CodeTether
            </summary>
            <div className="mt-3 space-y-2 leading-relaxed">
              <p>
                当前支持的远程组件是与本 Desktop 版本匹配的 Linux x64 CodeTether
                远程助手。请从本次受控测试或部署的提供方取得与当前 Desktop
                构建标识匹配的
                <code className="mx-1 rounded bg-surface px-1 py-0.5 font-mono text-xs">
                  codetether-node-linux-x64
                </code>
                文件；当前 Desktop 安装包不会自动复制它，也不要从未知来源下载。
              </p>
              <p>在另一台电脑的私有局域网中启动一次安全设置：</p>
              <code className="block overflow-x-auto rounded-sm border border-border bg-background px-3 py-2 font-mono text-xs text-text-primary">
                ./codetether-node-linux-x64 --bind &lt;私有局域网地址&gt;
                --data-dir &lt;私有绝对目录&gt; --name
                &quot;&lt;电脑名称&gt;&quot; --pair
              </code>
              <p className="text-xs text-text-muted">
                远程助手会显示连接地址、一次性设置代码和安全校验码。请勿设置公网端口转发；公开分发与平台安装器属于后续发布阶段。
              </p>
            </div>
          </details>
          <div className="mt-5 space-y-3">
            {remoteMachines.map((machine) => {
              const remoteStatus = doctor.remoteComputers.find(
                (candidate) => candidate.machineId === machine.machineId,
              )
              return (
                <div
                  key={machine.machineId}
                  className="rounded-md border border-border bg-surface-muted p-3"
                >
                  <StatusRow
                    label={machine.displayName}
                    detail={
                      machine.connectionState === 'online'
                        ? '已安全连接'
                        : '当前离线，信任关系仍保留'
                    }
                    state={
                      machine.connectionState === 'online' ? 'ready' : 'offline'
                    }
                  />
                  {remoteStatus?.providers.map((provider) => (
                    <div
                      key={provider.provider}
                      className="mt-2 flex items-center justify-between gap-3 px-1 text-sm"
                    >
                      <span className="text-text-secondary">
                        {providerDisplayName(provider.provider)}
                      </span>
                      <span className="text-text-primary">
                        {providerCompatibilityLabel(provider)} ·{' '}
                        {doctorStateLabel(provider.state)}
                      </span>
                    </div>
                  ))}
                  {remoteStatus !== undefined ? (
                    <div className="mt-2 flex items-center justify-between gap-3 border-t border-border px-1 pt-2 text-sm">
                      <span className="text-text-secondary">
                        Internet 远程访问
                      </span>
                      <span className="text-text-primary">
                        {remoteStatus.relay.internetExecutionEnabled
                          ? '已连接'
                          : remoteStatus.executionTransport === 'direct'
                            ? '未连接；局域网直连仍可用'
                            : '当前不可用'}
                      </span>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <AddRemoteMachineDialog
              presentation="ordinary"
              onPaired={props.onRemotePaired}
              trigger={
                <Button type="button" variant="secondary">
                  <Monitor aria-hidden="true" />
                  添加电脑
                </Button>
              }
            />
            {props.selectedProject !== undefined &&
            remoteMachines.length > 0 ? (
              <AddProjectLocationDialog
                machines={props.machines}
                presentation="ordinary"
                project={props.selectedProject}
                trigger={
                  <Button type="button" variant="secondary">
                    <FolderOpen aria-hidden="true" />
                    添加远程项目文件夹
                  </Button>
                }
              />
            ) : null}
          </div>
          {remoteMachines.length > 0 && !configuredRemoteProject ? (
            <p role="status" className="mt-3 text-sm text-text-secondary">
              安全连接已保存。若要完成远程工作设置，请在这台电脑上验证项目文件夹；也可以暂时跳过。
            </p>
          ) : null}
          <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-border pt-4">
            <Button
              type="button"
              variant="secondary"
              disabled={props.busy}
              onClick={() => void props.onRemoteSetupFinished('skipped')}
            >
              暂时跳过
            </Button>
            {configuredRemoteProject ? (
              <Button
                type="button"
                disabled={props.busy}
                onClick={() => void props.onRemoteSetupFinished('configured')}
              >
                完成远程设置
              </Button>
            ) : null}
          </div>
        </div>
      )
    }
    case 'ready': {
      const selectedRemote = doctor.remoteComputers.find(
        (machine) => machine.machineId === onboarding.machineId,
      )
      const contextProviders =
        onboarding.machineId === doctor.thisComputer.machineId
          ? doctor.providers
          : (selectedRemote?.providers ?? [])
      const usableProviders = contextProviders.filter(isProviderUsable)
      const selectedDoctorProject =
        doctor.project?.projectId === onboarding.projectId
          ? doctor.project
          : undefined
      const selectedProjectLocation = selectedDoctorProject?.locations.find(
        (location) => location.machineId === onboarding.machineId,
      )
      const executionPathReady =
        props.contextCheckCurrent &&
        !props.contextCheckFailed &&
        isDoctorExecutionContextReady(
          doctor,
          onboarding.projectId,
          onboarding.machineId,
        )
      return (
        <CenteredStep
          icon={<Check aria-hidden="true" />}
          title="CodeTether 设置完成"
          description={
            !props.contextCheckCurrent
              ? '正在确认当前项目、AI 工具和 AI 服务的最新状态。'
              : executionPathReady
                ? '你可以打开项目并开始工作。'
                : usableProviders.length > 0
                  ? '项目和历史记录可以使用；当前项目文件夹恢复可用后才能开始新的智能体执行。'
                  : '项目和历史记录可以使用；AI 工具就绪后才能开始新的智能体执行。'
          }
        >
          <div className="space-y-2 text-left">
            <StatusRow
              label={selectedRemote === undefined ? '这台电脑' : '另一台电脑'}
              detail={
                selectedRemote?.displayName ?? doctor.thisComputer.displayName
              }
              state={selectedRemote?.state ?? doctor.thisComputer.state}
            />
            {contextProviders.map((provider) => (
              <StatusRow
                key={provider.provider}
                label={providerDisplayName(provider.provider)}
                detail={providerCompatibilityLabel(provider)}
                state={provider.state}
              />
            ))}
            {doctor.project !== undefined ? (
              <StatusRow
                label="项目"
                detail={doctor.project.name}
                state={selectedProjectLocation?.state ?? 'unknown'}
              />
            ) : null}
          </div>
          {!executionPathReady ? (
            <div className="mt-4 rounded-sm border border-warning/30 bg-warning-muted/30 p-3 text-left text-sm text-text-secondary">
              <p role={props.contextCheckFailed ? 'alert' : 'status'}>
                {!props.contextCheckCurrent
                  ? '正在重新确认当前执行路径。此检查不会发送提示或创建对话。'
                  : selectedRemote === undefined
                    ? localOnboardingBlockerText(
                        doctor,
                        selectedProjectLocation?.state,
                        props.contextCheckFailed,
                      )
                    : remoteOnboardingBlockerText(
                        selectedRemote,
                        selectedProjectLocation?.state,
                        props.contextCheckFailed,
                      )}
              </p>
              <Button
                className="mt-3"
                type="button"
                size="sm"
                variant="secondary"
                disabled={props.busy}
                onClick={props.onCheckSelectedContext}
              >
                <RefreshCw aria-hidden="true" />
                重新检查
              </Button>
            </div>
          ) : null}
          <PrimaryContinue busy={props.busy} onClick={props.onStart}>
            打开 CodeTether
          </PrimaryContinue>
        </CenteredStep>
      )
    }
  }
}

function StepHeading({
  description,
  icon,
  title,
}: {
  readonly description: string
  readonly icon: ReactNode
  readonly title: string
}) {
  return (
    <div>
      <span
        aria-hidden="true"
        className="grid size-10 place-items-center rounded-md border border-primary/30 bg-primary-muted text-primary [&>svg]:size-5"
      >
        {icon}
      </span>
      <h2 className="mt-4 text-xl font-semibold text-text-primary">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-text-secondary">
        {description}
      </p>
    </div>
  )
}

function CenteredStep({
  children,
  description,
  icon,
  title,
}: {
  readonly children: ReactNode
  readonly description: string
  readonly icon: ReactNode
  readonly title: string
}) {
  return (
    <div className="mx-auto max-w-xl py-3 text-center">
      <span
        aria-hidden="true"
        className="mx-auto grid size-12 place-items-center rounded-lg border border-primary/30 bg-primary-muted text-primary [&>svg]:size-6"
      >
        {icon}
      </span>
      <h2 className="mt-5 text-2xl font-semibold text-text-primary">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-text-secondary">
        {description}
      </p>
      <div className="mt-6 space-y-4">{children}</div>
    </div>
  )
}

function PrimaryContinue({
  busy,
  children,
  disabled = false,
  onClick,
}: {
  readonly busy: boolean
  readonly children: ReactNode
  readonly disabled?: boolean
  readonly onClick: () => void
}) {
  return (
    <Button type="button" disabled={busy || disabled} onClick={onClick}>
      {busy ? (
        <LoaderCircle
          aria-hidden="true"
          className="animate-spin motion-reduce:animate-none"
        />
      ) : null}
      {children}
      {!busy ? <ArrowRight aria-hidden="true" /> : null}
    </Button>
  )
}

function StatusRow({
  detail,
  label,
  state,
}: {
  readonly detail: string
  readonly label: string
  readonly state: Parameters<typeof doctorStateLabel>[0]
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-md border border-border bg-surface-muted px-4 py-3 text-left">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-text-primary">
          {label}
        </span>
        <span className="mt-0.5 block text-xs text-text-muted">{detail}</span>
      </span>
      <Badge variant={doctorStateBadgeVariant(state)}>
        {doctorStateLabel(state)}
      </Badge>
    </div>
  )
}

function ProviderCard({
  provider,
}: {
  readonly provider: DoctorProviderStatus
}) {
  const guidance = providerInstallationGuidance[provider.provider]
  const currentlyConfirmedMissing =
    provider.freshness === 'current' && !provider.installed
  const currentFirstPartyAuthRequired =
    provider.backend?.freshness === 'current' &&
    provider.backend.readiness === 'authentication_required' &&
    provider.backend.mode === 'first_party'
  return (
    <Card className="bg-surface-muted">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{guidance.label}</CardTitle>
            <p className="mt-1 text-xs text-text-muted">
              {providerVersionLabel(provider)} ·{' '}
              {lifecycleObservationLabel(
                provider.freshness,
                provider.observedAt,
              )}
            </p>
          </div>
          <Badge variant={doctorStateBadgeVariant(provider.state)}>
            {doctorStateLabel(provider.state)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1 text-sm">
          <p className="text-text-primary">
            运行环境：{providerCompatibilityLabel(provider)}
          </p>
          <p className="text-text-secondary">
            {backendModeLabel(provider.backend)}：
            {backendReadinessLabel(provider.backend)}
          </p>
        </div>
        <p className="text-xs leading-relaxed text-text-muted">
          {providerRepairText(provider)}
        </p>
        {currentlyConfirmedMissing ? (
          <ProviderGuidanceLink provider={provider.provider}>
            {guidance.action}
          </ProviderGuidanceLink>
        ) : null}
        {currentFirstPartyAuthRequired ? (
          <ProviderGuidanceLink provider={provider.provider}>
            查看官方登录指南
          </ProviderGuidanceLink>
        ) : null}
        <details className="rounded-sm border border-border px-3 py-2 text-xs text-text-muted">
          <summary className="cursor-pointer font-medium text-text-secondary">
            技术详情
          </summary>
          <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
            <dt>选择</dt>
            <dd>{provider.selected ? '已选择' : '未选择'}</dd>
            <dt>其他安装</dt>
            <dd>{provider.alternateInstallations}</dd>
            {provider.installMethod !== undefined ? (
              <>
                <dt>安装方式</dt>
                <dd>{provider.installMethod}</dd>
              </>
            ) : null}
            <dt>状态来源</dt>
            <dd>
              {provider.freshness === 'current'
                ? '当前'
                : provider.freshness === 'last_known'
                  ? '上次检查'
                  : '尚未观察'}
            </dd>
            <dt>以前的会话</dt>
            <dd>{provider.sessionDiscovery}</dd>
            {provider.failure !== undefined ? (
              <>
                <dt>诊断代码</dt>
                <dd className="break-all font-mono">
                  {provider.failure.reason}
                </dd>
              </>
            ) : null}
          </dl>
        </details>
      </CardContent>
    </Card>
  )
}

function SetupLoading({
  failed,
  onRetry,
}: {
  readonly failed: boolean
  readonly onRetry: () => void
}) {
  return (
    <div className="grid min-h-dvh place-items-center bg-background p-6 text-text-primary">
      <div
        className="text-center"
        role={failed ? 'alert' : 'status'}
        aria-live="polite"
      >
        {failed ? null : (
          <LoaderCircle
            aria-hidden="true"
            className="mx-auto size-6 animate-spin text-primary motion-reduce:animate-none"
          />
        )}
        <p className="mt-3 text-sm text-text-secondary">
          {failed
            ? '暂时无法读取设置状态。请确认 CodeTether 正在运行后重试。'
            : '正在准备 CodeTether…'}
        </p>
        {failed ? (
          <Button className="mt-4" type="button" onClick={onRetry}>
            <RefreshCw aria-hidden="true" />
            重新检查
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function SetupUnavailable({
  connectionState,
  onRetry,
}: {
  readonly connectionState: string
  readonly onRetry: () => void
}) {
  return (
    <div className="grid min-h-dvh place-items-center bg-background p-6 text-text-primary">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>无法连接到 CodeTether</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-text-secondary">
            你的已有项目和对话没有改变。请稍候，然后重新检查。
          </p>
          <details className="mt-4 text-xs text-text-muted">
            <summary className="cursor-pointer">技术详情</summary>
            <p className="mt-2 font-mono">host_state: {connectionState}</p>
          </details>
          <Button className="mt-5" type="button" onClick={onRetry}>
            <RefreshCw aria-hidden="true" />
            重新检查
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function InvalidSetupState({
  busy,
  onReselectProject,
}: {
  readonly busy: boolean
  readonly onReselectProject: () => void
}) {
  return (
    <div className="rounded-md border border-danger/30 bg-danger-muted p-4 text-sm text-danger">
      <p role="alert">
        此设置流程原先选择的项目文件夹已不可用。已有项目和会话不会被删除。
      </p>
      <Button
        className="mt-4"
        type="button"
        variant="secondary"
        disabled={busy}
        onClick={onReselectProject}
      >
        <FolderOpen aria-hidden="true" />
        重新选择项目
      </Button>
    </div>
  )
}
