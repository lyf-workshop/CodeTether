import type { MachineId, MachineSummary } from '@codetether/protocol'

export interface FixedProjectCreationMachine {
  readonly machine?: MachineSummary
  readonly state:
    | 'unselected'
    | 'loading'
    | 'missing'
    | 'offline'
    | 'project_access_unavailable'
    | 'execution_unavailable'
    | 'ready'
}

/** Registration remains bound to the explicitly requested durable Machine. */
export function selectFixedProjectCreationMachine(
  machines: readonly MachineSummary[] | undefined,
  machineId?: MachineId,
): FixedProjectCreationMachine {
  if (machineId === undefined) return { state: 'unselected' }
  if (machines === undefined) return { state: 'loading' }
  const machine = machines.find(
    (candidate) => candidate.machineId === machineId,
  )
  if (machine === undefined) return { state: 'missing' }
  if (
    machine.availability !== 'available' ||
    (machine.connectionState !== 'local' &&
      machine.connectionState !== 'online')
  ) {
    return { state: 'offline', machine }
  }
  if (!machine.capabilities.projectAccess)
    return { state: 'project_access_unavailable', machine }
  if (!machine.capabilities.providerExecution)
    return { state: 'execution_unavailable', machine }
  return { state: 'ready', machine }
}

export function fixedProjectCreationMachineExplanation(
  state: FixedProjectCreationMachine['state'],
): string | undefined {
  switch (state) {
    case 'unselected':
    case 'ready':
      return undefined
    case 'loading':
      return '正在读取这台设备…'
    case 'missing':
      return '找不到这台设备。请关闭弹窗并重新选择设备。'
    case 'offline':
      return '恢复在线后才能在这台设备上添加项目。'
    case 'project_access_unavailable':
      return '这台设备当前没有开放项目访问。'
    case 'execution_unavailable':
      return '这台设备当前不能运行 AI 工具。请先在设备详情中检查。'
  }
}
