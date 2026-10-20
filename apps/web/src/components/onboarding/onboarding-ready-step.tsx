import { RefreshCw } from 'lucide-react'
import { Button, cn } from '@codetether/ui'
import type { SetupStepProps } from './onboarding-step-props'
import { PrimaryContinue, StatusRow } from './onboarding-step-feedback'
import { OnboardingCompletion } from './onboarding-step-layout'
import {
  isDoctorExecutionContextReady,
  isProviderUsable,
  localOnboardingBlockerText,
  providerDisplayName,
  remoteOnboardingBlockerText,
  onboardingProviderServiceUnverified,
  onboardingProviderInstallationLabel,
  onboardingProviderRuntimeLabel,
  onboardingProviderServiceLabel,
  onboardingUnverifiedServiceGuidance,
} from './onboarding-model'

export function OnboardingReadyStep(props: SetupStepProps) {
  const { doctor, onboarding } = props
  const selectedLocal = onboarding.machineId === doctor.thisComputer.machineId
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
  const serviceUnverified =
    props.contextCheckCurrent &&
    !props.contextCheckFailed &&
    contextProviders.some(onboardingProviderServiceUnverified) &&
    selectedProjectLocation?.state === 'ready' &&
    (selectedLocal
      ? doctor.thisComputer.state === 'ready'
      : selectedRemote?.connectionState === 'online')
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
            : serviceUnverified
              ? '项目和运行环境已检查，AI 服务尚未验证。打开项目后可通过首次显式对话验证；无需为了完成设置专门发送测试消息。'
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
            detail={`${onboardingProviderInstallationLabel(provider)} · ${onboardingProviderRuntimeLabel(provider)} · AI 服务：${onboardingProviderServiceLabel(provider)}`}
            state={provider.state}
            statusLabel={
              onboardingProviderServiceUnverified(provider)
                ? 'AI 服务尚未验证'
                : undefined
            }
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
        <div
          className={cn(
            'mt-4 rounded-sm border p-3 text-left text-sm text-text-secondary',
            serviceUnverified
              ? 'border-border bg-surface-muted'
              : 'border-warning/30 bg-warning-muted/30',
          )}
        >
          <p role={props.contextCheckFailed ? 'alert' : 'status'}>
            {!props.contextCheckCurrent
              ? '正在重新确认当前执行路径。此检查不会发送提示或创建会话。'
              : serviceUnverified && !props.contextCheckFailed
                ? onboardingUnverifiedServiceGuidance
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
