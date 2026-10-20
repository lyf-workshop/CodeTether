import type {
  ConversationSummary,
  MachineId,
  MachineSummary,
  ProjectRecord,
} from '@codetether/protocol'
import { machineConnectionStateLabel } from './machine-presentation.js'

type DeviceState = Pick<
  MachineSummary,
  'kind' | 'connectionState' | 'availability' | 'capabilities'
>

export function machineCanAddProject(machine: DeviceState): boolean {
  return (
    (machine.connectionState === 'local' ||
      machine.connectionState === 'online') &&
    machine.availability === 'available' &&
    machine.capabilities.projectAccess &&
    machine.capabilities.providerExecution
  )
}

export function machineCannotAddProjectReason(): string {
  return '设备恢复在线并可以运行 AI 工具后，即可添加项目。'
}

export function deviceProjectState(
  machine: DeviceState,
  location: ProjectRecord['locations'][number] | undefined,
): { available: boolean; label?: string; reason?: string } {
  if (
    machine.connectionState !== 'local' &&
    machine.connectionState !== 'online'
  ) {
    return {
      available: false,
      label:
        machine.connectionState === 'offline'
          ? '设备离线'
          : machineConnectionStateLabel(machine.connectionState),
      reason: '恢复连接后才能继续或新建会话；已有历史仍然可读。',
    }
  }
  if (
    !machine.capabilities.providerExecution ||
    machine.availability !== 'available'
  ) {
    return {
      available: false,
      label: '不能运行',
      reason: '这台设备当前不能运行 AI 工具。已有历史仍然可读。',
    }
  }
  if (location?.availability !== 'available') {
    return {
      available: false,
      label: '无法访问',
      reason: '找不到文件夹或没有读取权限。已有历史仍然可读。',
    }
  }
  return { available: true }
}

export function projectConversationMetrics(
  conversations: readonly ConversationSummary[] | undefined,
  machineId: MachineId,
  multipleLocations = false,
) {
  if (conversations === undefined) return undefined
  const own = conversations.filter(
    (conversation) => conversation.machineId === machineId,
  )
  const capped = conversations.length >= 100
  const countLabel =
    multipleLocations && capped
      ? `已加载 ${own.length} 个会话`
      : `${own.length}${capped ? '+' : ''} 个会话`
  let lastActivityAt: string | undefined
  for (const conversation of own) {
    if (
      lastActivityAt === undefined ||
      conversation.lastActivityAt > lastActivityAt
    )
      lastActivityAt = conversation.lastActivityAt
  }
  return {
    countLabel,
    runningCount: own.filter(
      (conversation) =>
        conversation.status === 'running' || conversation.status === 'waiting',
    ).length,
    lastActivityAt,
    capped,
  }
}

export function unpairMachinePreflight(
  projects: readonly ProjectRecord[],
  machineId: MachineId,
) {
  const bound = projects.flatMap((project) => {
    const location = project.locations.find(
      (candidate) => candidate.machineId === machineId,
    )
    return location
      ? [
          {
            projectId: project.projectId,
            name: project.name,
            rootPath: location.rootPath,
          },
        ]
      : []
  })
  return { blocked: bound.length > 0, projects: bound }
}
