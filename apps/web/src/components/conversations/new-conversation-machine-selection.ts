import type {
  MachineId,
  MachineSummary,
  ProjectRecord,
} from '@codetether/protocol'

export type NewConversationMachineContextIssue =
  | 'machine_missing'
  | 'machine_unavailable'
  | 'project_access_unavailable'
  | 'provider_execution_unavailable'
  | 'project_location_missing'
  | 'project_location_unavailable'

interface NewConversationMachineSelectionInput {
  readonly machines: readonly MachineSummary[] | undefined
  readonly currentProject?: Pick<ProjectRecord, 'locations'>
  readonly currentMachineId?: MachineId
  readonly selectedMachineId?: MachineId
}

/** Explicit launch context stays bound even when another Machine can execute. */
export function selectNewConversationMachine({
  machines,
  currentProject,
  currentMachineId,
  selectedMachineId,
}: NewConversationMachineSelectionInput) {
  const candidateMachines = (machines ?? []).filter(
    (machine) =>
      machine.availability === 'available' &&
      (machine.connectionState === 'local' ||
        machine.connectionState === 'online') &&
      machine.capabilities.projectAccess &&
      machine.capabilities.providerExecution &&
      (currentProject === undefined ||
        currentProject.locations.some(
          (location) => location.machineId === machine.machineId,
        )),
  )
  const machineId =
    currentMachineId ?? selectedMachineId ?? candidateMachines[0]?.machineId
  const machine = (
    currentMachineId === undefined ? candidateMachines : (machines ?? [])
  ).find((candidate) => candidate.machineId === machineId)
  let contextIssue: NewConversationMachineContextIssue | undefined
  if (currentMachineId !== undefined && machines !== undefined) {
    if (machine === undefined) contextIssue = 'machine_missing'
    else if (
      machine.availability !== 'available' ||
      (machine.connectionState !== 'local' &&
        machine.connectionState !== 'online')
    )
      contextIssue = 'machine_unavailable'
    else if (!machine.capabilities.projectAccess)
      contextIssue = 'project_access_unavailable'
    else if (!machine.capabilities.providerExecution)
      contextIssue = 'provider_execution_unavailable'
    else if (currentProject !== undefined) {
      const location = currentProject.locations.find(
        (candidate) => candidate.machineId === currentMachineId,
      )
      if (location === undefined) contextIssue = 'project_location_missing'
      else if (location.availability !== 'available')
        contextIssue = 'project_location_unavailable'
    }
  }
  return { candidateMachines, machineId, machine, contextIssue }
}

export function newConversationMachineContextExplanation(
  issue: NewConversationMachineContextIssue | undefined,
): string | undefined {
  switch (issue) {
    case undefined:
      return undefined
    case 'machine_missing':
      return '所选电脑当前不可用。请返回设备列表确认电脑状态后再创建会话。'
    case 'machine_unavailable':
      return '所选电脑当前离线或不可用。恢复连接后才能在此电脑创建会话。'
    case 'project_access_unavailable':
      return '所选电脑当前不支持访问项目工作区，暂时无法创建会话。'
    case 'provider_execution_unavailable':
      return '所选电脑当前未满足在线连接、当前智能体检测或安全执行条件。'
    case 'project_location_missing':
      return '此项目在所选电脑上没有已授权的工作区位置，暂时无法创建会话。'
    case 'project_location_unavailable':
      return '此项目在所选电脑上的目录当前不可用；恢复原目录后才能创建会话。'
  }
}
