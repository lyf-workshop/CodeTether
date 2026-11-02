import { useState } from 'react'
import { Monitor } from 'lucide-react'
import { Button, SegmentedControl, SegmentedControlItem } from '@codetether/ui'
import type { SetupStepProps } from './onboarding-step-props'
import { InvalidSetupState, StatusRow } from './onboarding-step-feedback'
import { OnboardingStepHeading as StepHeading } from './onboarding-step-layout'
import { AddProjectDialog } from '../projects/add-project-dialog'
import { AddRemoteMachineDialog } from '../machines/add-remote-machine-dialog'
import { machineCanAddProject } from '../machines/device-project-model'
import { machineConnectionStateLabel } from '../machines/machine-presentation'
import { NodeSetupInstructions } from '../machines/node-setup-instructions'
import { onboardingProjectChoices } from './onboarding-presentation'
import {
  providerDisplayName,
  onboardingProviderInstallationLabel,
  onboardingProviderRuntimeLabel,
  onboardingProviderServiceLabel,
} from './onboarding-model'

export function OnboardingRemoteStep(props: SetupStepProps) {
  const { doctor, onboarding } = props
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
                detail={machineConnectionStateLabel(machine.connectionState)}
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
                    {onboardingProviderInstallationLabel(provider)} ·{' '}
                    {onboardingProviderRuntimeLabel(provider)} · AI 服务：{' '}
                    {onboardingProviderServiceLabel(provider)}
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
