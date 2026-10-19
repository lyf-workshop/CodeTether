import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  ArrowRight,
  FolderOpen,
  LoaderCircle,
  Monitor,
  RefreshCw,
} from 'lucide-react'

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  SectionState,
  Notice,
  SegmentedControl,
  SegmentedControlItem,
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
import { machineCanAddProject } from '../machines/device-project-model'
import { machineConnectionStateLabel } from '../machines/machine-presentation'
import { NodeSetupInstructions } from '../machines/node-setup-instructions'
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
  providerCompatibilityLabel,
  providerDisplayName,
  providerInstallationGuidance,
  providerRepairText,
  providerVersionLabel,
  remoteOnboardingBlockerText,
} from './onboarding-model'
import { ProviderGuidanceLink } from './provider-guidance-link'
import {
  OnboardingWelcome,
  OnboardingCompletion,
  OnboardingProgress as OnboardingProgressIndicator,
  OnboardingStepHeading,
} from './onboarding-step-layout'
import './onboarding-layout.css'
import {
  createOnboardingTransitionGate,
  continueOnboardingChecks,
  onboardingScreenIndex,
  onboardingProjectChoices,
} from './onboarding-presentation'

const stepLabels = {
  welcome: '欢迎',
  computer_check: '检查 AI 工具',
  provider_check: '检查 AI 工具',
  project_setup: '项目',
  previous_conversations: '以前的会话',
  remote_setup: '配对设备',
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
  const transitionGateRef = useRef(createOnboardingTransitionGate())
  const [transitionSequencePending, setTransitionSequencePending] =
    useState(false)
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
  const onboardingVisualStep =
    onboardingStep === undefined
      ? undefined
      : onboardingScreenIndex(onboardingStep)
  const onboardingContentReady =
    onboardingStep !== undefined && doctorQuery.data !== undefined

  useEffect(() => {
    if (!onboardingContentReady) return
    const frame = requestAnimationFrame(() => stepHeadingRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [onboardingContentReady, onboardingVisualStep])

  async function transition(
    next: OnboardingTransition,
    progress = onboarding,
  ): Promise<OnboardingProgress | undefined> {
    if (
      progress === undefined ||
      !connected ||
      transitionGateRef.current.isPending()
    )
      return
    setTransitionSequencePending(true)
    try {
      return await transitionGateRef.current.run(async () => {
        const commit = async (
          current: OnboardingProgress,
          action: OnboardingTransition,
        ) => {
          const result = await transitionMutation.mutateAsync({
            progress: current,
            transition: action,
          })
          return result.data.onboarding
        }
        return next.kind === 'continue'
          ? await continueOnboardingChecks(progress, commit)
          : await commit(progress, next)
      })
    } catch {
      // The mutation presents errors and refetches the Host-owned revision.
      // A failed second Continue remains at provider_check; never roll back,
      // guess a revision, automatically probe, or retry a durable write.
    } finally {
      setTransitionSequencePending(false)
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
  const currentStep = onboardingScreenIndex(onboarding.step)

  return (
    <div
      className="ct-onboarding-viewport"
      aria-busy={
        transitionSequencePending ||
        transitionMutation.isPending ||
        providerRefreshing ||
        contextChecking ||
        doctorQuery.isFetching
      }
    >
      <div className="ct-onboarding-inner">
        {onboarding.completedAt !== undefined && onboarding.step !== 'ready' ? (
          <div className="mb-6 flex justify-end">
            <Link
              to="/devices"
              className="rounded-sm px-3 py-2 text-sm text-text-secondary outline-none hover:text-text-primary focus-visible:ring-2 focus-visible:ring-ring"
            >
              暂时返回
            </Link>
          </div>
        ) : null}
        <OnboardingProgressIndicator current={currentStep} />
        <main className="ct-onboarding-content min-w-0" id="setup-main">
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
            busy={
              transitionSequencePending ||
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
            projectChoicesPending={
              projectListQuery.data === undefined ||
              machineListQuery.data === undefined
            }
            projectChoicesFailed={
              projectListQuery.isError || machineListQuery.isError
            }
            onRetryProjectChoices={() => {
              void projectListQuery.refetch()
              void machineListQuery.refetch()
            }}
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
            onRemoteProjectCreated={async () => {
              await Promise.allSettled([
                projectListQuery.refetch(),
                machineListQuery.refetch(),
                doctorQuery.refetch(),
              ])
            }}
            onCheckSelectedContext={() => void checkSelectedContext(onboarding)}
            onStart={() =>
              void navigate(
                onboarding.projectId === undefined ||
                  onboarding.machineId === undefined
                  ? { to: '/devices' }
                  : {
                      to: '/projects/$projectId',
                      params: { projectId: onboarding.projectId },
                      search: { machineId: onboarding.machineId },
                    },
              )
            }
          />
          {transitionMutation.isError ? (
            <div className="mt-6">
              <p role="alert" className="text-sm text-danger">
                设置进度暂时无法保存。没有删除或重置任何已有数据，请重试。
              </p>
            </div>
          ) : null}
        </main>
        <p className="sr-only" role="status" aria-live="polite">
          {transitionSequencePending || transitionMutation.isPending
            ? '正在保存设置进度。'
            : providerRefreshing || contextChecking || doctorQuery.isFetching
              ? '正在检查当前状态。'
              : `当前步骤：${stepLabels[onboarding.step]}`}
        </p>
      </div>
    </div>
  )
}

interface SetupStepProps {
  readonly doctor: DoctorReport
  readonly machines: readonly MachineSummary[]
  readonly onboarding: OnboardingProgress
  readonly projects: readonly ProjectRecord[]
  readonly busy: boolean
  readonly contextCheckFailed: boolean
  readonly contextCheckCurrent: boolean
  readonly providerRefreshFailed: boolean
  readonly projectChoicesPending: boolean
  readonly projectChoicesFailed: boolean
  readonly onRetryProjectChoices: () => void
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
  readonly onRemoteProjectCreated: () => Promise<void> | void
  readonly onCheckSelectedContext: () => void
  readonly onStart: () => void
}

function SetupStep(props: SetupStepProps) {
  const { doctor, onboarding } = props
  switch (onboarding.step) {
    case 'welcome':
      return (
        <OnboardingWelcome>
          <PrimaryContinue busy={props.busy} onClick={props.onContinue}>
            开始设置
          </PrimaryContinue>
        </OnboardingWelcome>
      )
    case 'computer_check':
    case 'provider_check': {
      const readyCount = doctor.providers.filter(isProviderUsable).length
      return (
        <div>
          <StepHeading
            title="检查 AI 工具"
            description="CodeTether 使用已经选择的安装，不会在设置过程中自动安装、更新或切换工具。"
          />
          <div className="mt-5">
            <StatusRow
              label={doctor.thisComputer.displayName}
              detail={`${doctor.thisComputer.platform} · ${doctor.thisComputer.architecture}`}
              state={doctor.thisComputer.state}
            />
          </div>
          <div className="mt-7 space-y-3">
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
              disabled={props.busy || doctor.thisComputer.state !== 'ready'}
              onClick={props.onContinue}
            >
              {readyCount > 0 ? '继续' : '暂不设置 AI 工具'}
              <ArrowRight aria-hidden="true" />
            </Button>
          </div>
          {readyCount === 0 ? (
            <p role="status" className="mt-3 text-sm text-warning">
              你可以完成应用设置，但在至少一个 AI 工具就绪前不能运行。
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
    case 'project_setup': {
      const choices = onboardingProjectChoices(props.projects, props.machines)
      return (
        <div>
          <StepHeading
            title="添加第一个项目"
            description="选择已有项目，或添加这台电脑或另一台已安全连接设备上的项目文件夹。普通文件夹也可以使用。"
          />
          {props.projectChoicesPending ? (
            <SectionState
              state={props.projectChoicesFailed ? 'error' : 'loading'}
              title={
                props.projectChoicesFailed
                  ? '暂时无法读取设备和项目'
                  : '正在读取设备和项目'
              }
              action={
                props.projectChoicesFailed ? (
                  <Button
                    variant="secondary"
                    onClick={props.onRetryProjectChoices}
                  >
                    重试
                  </Button>
                ) : undefined
              }
            />
          ) : choices.length > 0 ? (
            <div className="mt-5 max-h-64 space-y-2 overflow-y-auto">
              {choices.map(({ key, project, machine, location, state }) => (
                <div
                  key={key}
                  className="flex min-w-0 flex-wrap items-center gap-3 rounded-md border border-border bg-surface p-3"
                >
                  <FolderOpen
                    aria-hidden="true"
                    className="size-4 shrink-0 text-text-muted"
                  />
                  <span className="min-w-0 flex-1 basis-40">
                    <span className="block truncate text-sm font-medium">
                      {project.name}
                    </span>
                    <span
                      title={location.rootPath}
                      className="mt-1 block truncate text-xs text-text-muted"
                    >
                      {machine.displayName} · {location.rootPath}
                    </span>
                    {!state.available ? (
                      <span className="mt-1 block text-xs text-warning">
                        {state.label} · {state.reason}
                      </span>
                    ) : null}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={!state.available || props.busy}
                    onClick={() => {
                      void props.onProjectSelected(project, machine.machineId)
                    }}
                  >
                    选择
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-5 rounded-md border border-border bg-surface-muted p-4 text-sm text-text-secondary">
              {props.projects.length > 0
                ? '项目的设备记录尚未取得，不会改用其他设备。请重新读取设备和项目。'
                : '还没有项目。选择一个你已有的项目文件夹即可开始。'}
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
          {props.projectChoicesFailed && !props.projectChoicesPending ? (
            <div className="mt-3">
              <Notice
                tone="warn"
                title="设备和项目列表未能更新"
                action={
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={props.onRetryProjectChoices}
                  >
                    重试
                  </Button>
                }
              >
                当前保留上次读取的列表；添加和选择仍需通过设备与项目的当前检查。
              </Notice>
            </div>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-2">
            {props.machines.map((machine) => (
              <AddProjectDialog
                key={machine.machineId}
                fixedMachineId={machine.machineId}
                deferPreviousConversations
                onProjectCreated={(project, _created, machineId) => {
                  if (machineId === machine.machineId)
                    return props.onProjectSelected(project, machine.machineId)
                }}
                trigger={
                  <Button
                    type="button"
                    variant={machine.kind === 'local' ? 'default' : 'secondary'}
                    className="max-w-full min-w-0"
                    disabled={props.busy || !machineCanAddProject(machine)}
                    title={
                      machineCanAddProject(machine)
                        ? undefined
                        : '设备在线且能运行 AI 工具后才能添加项目。'
                    }
                  >
                    <FolderOpen aria-hidden="true" />
                    <span className="truncate">
                      在
                      {machine.kind === 'local'
                        ? '这台电脑'
                        : machine.displayName}
                      上添加项目
                    </span>
                  </Button>
                }
              />
            ))}
            <AddRemoteMachineDialog
              presentation="ordinary"
              onPaired={props.onRemotePaired}
              trigger={
                <Button type="button" variant="secondary" disabled={props.busy}>
                  <Monitor aria-hidden="true" />
                  添加设备
                </Button>
              }
            />
          </div>
        </div>
      )
    }
    case 'previous_conversations':
      return onboarding.projectId === undefined ||
        onboarding.machineId === undefined ? (
        <InvalidSetupState
          busy={props.busy}
          onReselectProject={props.onProjectContextLost}
        />
      ) : (
        <div className="ct-onboarding-previous">
          <PreviousConversationsStep
            presentation="page"
            projectId={onboarding.projectId}
            machineId={onboarding.machineId}
            onFinished={props.onPreviousConversationsFinished}
          />
        </div>
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
      const configuredRemoteProject = onboardingProjectChoices(
        props.projects,
        remoteMachines,
      ).some((choice) => choice.state.available)
      return (
        <div>
          <StepHeading
            title="还有其他设备吗？"
            description="本机使用不需要网络远程设置。你可以以后随时从“设备”中添加。"
          />
          <OnboardingNodeInstructions />
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
                    detail={machineConnectionStateLabel(
                      machine.connectionState,
                    )}
                    state={
                      remoteStatus?.state ??
                      (machine.connectionState === 'online'
                        ? 'ready'
                        : machine.connectionState === 'offline'
                          ? 'offline'
                          : 'needs_attention')
                    }
                  />
                  <AddProjectDialog
                    fixedMachineId={machine.machineId}
                    onProjectCreated={async () => {
                      await props.onRemoteProjectCreated()
                    }}
                    trigger={
                      <Button
                        className="mt-3"
                        size="sm"
                        variant="secondary"
                        disabled={props.busy || !machineCanAddProject(machine)}
                      >
                        添加项目
                      </Button>
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
                      <span className="text-text-secondary">互联网连接</span>
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
                  添加设备
                </Button>
              }
            />
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
      const selectedLocal =
        onboarding.machineId === doctor.thisComputer.machineId
      const selectedRemote = doctor.remoteComputers.find(
        (machine) => machine.machineId === onboarding.machineId,
      )
      const contextProviders = selectedLocal
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
        <OnboardingCompletion
          ready={executionPathReady}
          action={
            <PrimaryContinue busy={props.busy} onClick={props.onStart}>
              打开 CodeTether
            </PrimaryContinue>
          }
          description={
            !props.contextCheckCurrent
              ? '正在确认当前项目、AI 工具和 AI 服务的最新状态。'
              : executionPathReady
                ? '你可以打开项目并开始工作。'
                : usableProviders.length > 0
                  ? '项目和历史记录可以使用；当前项目文件夹恢复可用后才能运行 AI 工具。'
                  : '项目和历史记录可以使用；AI 工具就绪后才能开始新一轮工作。'
          }
        >
          <div className="space-y-2 text-left">
            <StatusRow
              label={
                selectedLocal
                  ? '这台电脑'
                  : selectedRemote
                    ? '配对设备'
                    : '所选设备'
              }
              detail={
                selectedLocal
                  ? doctor.thisComputer.displayName
                  : (selectedRemote?.displayName ?? '设备信息尚未取得')
              }
              state={
                selectedLocal
                  ? doctor.thisComputer.state
                  : (selectedRemote?.state ?? 'unknown')
              }
            />
            {contextProviders.map((provider) => (
              <StatusRow
                key={provider.provider}
                label={providerDisplayName(provider.provider)}
                detail={providerCompatibilityLabel(provider)}
                state={provider.state}
              />
            ))}
            {selectedDoctorProject !== undefined ? (
              <StatusRow
                label="项目"
                detail={selectedDoctorProject.name}
                state={selectedProjectLocation?.state ?? 'unknown'}
              />
            ) : null}
          </div>
          {!executionPathReady ? (
            <div className="mt-4 rounded-sm border border-warning/30 bg-warning-muted/30 p-3 text-left text-sm text-text-secondary">
              <p role={props.contextCheckFailed ? 'alert' : 'status'}>
                {!props.contextCheckCurrent
                  ? '正在重新确认当前执行路径。此检查不会发送提示或创建会话。'
                  : selectedLocal
                    ? localOnboardingBlockerText(
                        doctor,
                        selectedProjectLocation?.state,
                        props.contextCheckFailed,
                      )
                    : selectedRemote !== undefined
                      ? remoteOnboardingBlockerText(
                          selectedRemote,
                          selectedProjectLocation?.state,
                          props.contextCheckFailed,
                        )
                      : '所选设备的状态尚未取得。已有项目和历史会继续保留，不会改用其他设备。'}
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
        </OnboardingCompletion>
      )
    }
  }
}

function OnboardingNodeInstructions() {
  const [platform, setPlatform] = useState<'linux' | 'macos'>('linux')
  return (
    <section className="mt-5 min-w-0" aria-label="CodeTether Node 设置说明">
      <p className="text-sm text-text-secondary">
        配对 Linux 服务器或 Apple 芯片的 Mac，不需要账号。Windows
        和同一账号下的其他桌面版目前不能作为配对设备添加。
      </p>
      <details className="mt-3 rounded-md border border-border bg-surface p-4 text-sm">
        <summary className="cursor-pointer">
          在设备上运行 CodeTether Node
        </summary>
        <div className="mt-4 space-y-4">
          <SegmentedControl
            aria-label="设备系统"
            value={platform}
            onValueChange={(value) =>
              setPlatform(value === 'macos' ? 'macos' : 'linux')
            }
          >
            <SegmentedControlItem value="linux">Linux</SegmentedControlItem>
            <SegmentedControlItem value="macos">
              Apple 芯片 Mac
            </SegmentedControlItem>
          </SegmentedControl>
          <NodeSetupInstructions platform={platform} />
        </div>
      </details>
    </section>
  )
}

function StepHeading({
  description,
  title,
}: {
  readonly description: string
  readonly title: string
}) {
  return <OnboardingStepHeading title={title} description={description} />
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
        <span
          title={detail}
          className="mt-0.5 block truncate text-xs text-text-muted"
        >
          {detail}
        </span>
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
            你的已有项目和会话没有改变。请稍候，然后重新检查。
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
