import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import type {
  DoctorReport,
  OnboardingProgress,
  OnboardingTransition,
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
import { OnboardingProgress as OnboardingProgressIndicator } from './onboarding-step-layout'
import { SetupLoading, SetupUnavailable } from './onboarding-step-feedback'
import { OnboardingStepView } from './onboarding-step-view'
import './onboarding-layout.css'
import {
  createOnboardingTransitionGate,
  continueOnboardingChecks,
  onboardingScreenIndex,
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
          <OnboardingStepView
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
              <p role="alert" className="text-sm text-danger-text">
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
