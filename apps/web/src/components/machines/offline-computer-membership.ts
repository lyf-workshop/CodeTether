import type { MachineSummary } from '@codetether/protocol'

type GroupableMachine = Pick<
  MachineSummary,
  'machineId' | 'kind' | 'connectionState'
>

/** Session-only placement memory shared by Devices and the sidebar. */
export class OfflineComputerMembership {
  private readonly previouslyOffline = new Set<string>()

  isGrouped(machine: GroupableMachine): boolean {
    if (machine.kind !== 'remote') {
      this.previouslyOffline.delete(machine.machineId)
      return false
    }
    if (machine.connectionState === 'offline') {
      this.previouslyOffline.add(machine.machineId)
      return true
    }
    if (machine.connectionState === 'connecting')
      return this.previouslyOffline.has(machine.machineId)
    this.previouslyOffline.delete(machine.machineId)
    return false
  }
}

export const offlineComputerMembership = new OfflineComputerMembership()
