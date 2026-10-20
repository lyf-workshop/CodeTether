import { FolderOpen, Monitor } from 'lucide-react'
import { Button, Notice, SectionState } from '@codetether/ui'
import type { SetupStepProps } from './onboarding-step-props'
import { OnboardingStepHeading as StepHeading } from './onboarding-step-layout'
import { AddProjectDialog } from '../projects/add-project-dialog'
import { AddRemoteMachineDialog } from '../machines/add-remote-machine-dialog'
import { machineCanAddProject } from '../machines/device-project-model'
import { onboardingProjectChoices } from './onboarding-presentation'

export function OnboardingProjectStep(props: SetupStepProps) {
  const { doctor } = props
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
              <Button variant="secondary" onClick={props.onRetryProjectChoices}>
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
                  <span className="mt-1 block text-xs text-warning-text">
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
        <p role="status" className="mt-3 text-sm text-warning-text">
          不可用的项目文件夹不能继续设置。请恢复文件夹，或选择另一个项目。
        </p>
      ) : null}
      {props.projectChoicesFailed && !props.projectChoicesPending ? (
        <div className="mt-3">
          <Notice
            role="status"
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
                  {machine.kind === 'local' ? '这台电脑' : machine.displayName}
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
