import type {
  MachineConnectionState,
  MachineSummary,
  RemoteMachineAddress,
} from '@codetether/protocol'

const architectureLabels: Record<string, string> = {
  x64: 'x64',
  x86_64: 'x64',
  amd64: 'x64',
  arm64: 'ARM64',
  aarch64: 'ARM64',
  x86: 'x86',
  i686: 'x86',
}

export function machinePlatformLabel(platform: string): string {
  if (platform.toLocaleLowerCase('en-US') === 'windows') return 'Windows'
  return platform
}

export function machineArchitectureLabel(architecture: string): string {
  return (
    architectureLabels[architecture.toLocaleLowerCase('en-US')] ?? architecture
  )
}

export function machineEnvironmentLabel(
  machine: Pick<MachineSummary, 'architecture' | 'platform'>,
): string {
  return `${machinePlatformLabel(machine.platform)} · ${machineArchitectureLabel(machine.architecture)}`
}

export function machineAvailabilityLabel(
  availability: MachineSummary['availability'],
): string {
  return availability === 'available' ? '可用' : '不可用'
}

export type MachineConnectionBadgeVariant =
  'danger' | 'info' | 'secondary' | 'success' | 'warning'

export function machineConnectionStateLabel(
  state: MachineConnectionState,
): string {
  switch (state) {
    case 'local':
      return '可用'
    case 'connecting':
      return '连接中'
    case 'online':
      return '在线'
    case 'offline':
      return '离线'
    case 'recovery_required':
      return '需要更新地址'
    case 'authentication_failed':
      return '身份验证失败'
    case 'incompatible':
      return '版本不兼容'
  }
}

export function machineConnectionBadgeVariant(
  state: MachineConnectionState,
): MachineConnectionBadgeVariant {
  switch (state) {
    case 'local':
    case 'online':
      return 'success'
    case 'connecting':
      return 'info'
    case 'offline':
      return 'secondary'
    case 'recovery_required':
      return 'warning'
    case 'authentication_failed':
      return 'danger'
    case 'incompatible':
      return 'warning'
  }
}

export function machineKindLabel(machine: Pick<MachineSummary, 'kind'>) {
  return machine.kind === 'local' ? '本地' : '远程'
}

export function remoteMachineAddressLabel(
  address: RemoteMachineAddress,
): string {
  const host = address.host.includes(':') ? `[${address.host}]` : address.host
  return `${host}:${address.port}`
}

export function formatMachineLastSeen(lastSeenAt?: string): string | undefined {
  if (lastSeenAt === undefined) return undefined
  const timestamp = new Date(lastSeenAt)
  if (Number.isNaN(timestamp.getTime())) return undefined
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp)
}
