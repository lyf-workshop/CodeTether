import type {
  MachineConnectionState,
  MachineExecutionTransport,
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

export function machinePlatformFamily(
  platform: string,
): 'windows' | 'macos' | 'linux' | 'other' {
  switch (platform.toLocaleLowerCase('en-US')) {
    case 'windows':
    case 'win32':
      return 'windows'
    case 'macos':
    case 'darwin':
      return 'macos'
    case 'linux':
      return 'linux'
    default:
      return 'other'
  }
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
      return '这台电脑'
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

/** Product-facing connection copy; the protocol state remains unchanged. */
export function machineConnectionStatusLabel(
  state: MachineConnectionState,
): string {
  return machineConnectionStateLabel(state)
}

export function machineConnectionTransportLabel(
  state: MachineConnectionState,
): string {
  switch (state) {
    case 'local':
      return '这台设备'
    case 'online':
    case 'connecting':
    case 'offline':
    case 'recovery_required':
    case 'authentication_failed':
    case 'incompatible':
      return '配对设备'
  }
}

export function remoteMachineSummaryDescription(
  state: MachineConnectionState,
  freshness: 'current' | 'last_known' = 'current',
): string {
  if (freshness === 'last_known') {
    return 'CodeTether 正在重新连接，当前显示这台设备的上次已知状态；恢复连接后会重新确认项目和 AI 工具 状态。'
  }

  switch (state) {
    case 'online':
      return '已连接。可以查看这台设备上的项目和 AI 工具；可用操作取决于各自当前状态。'
    case 'connecting':
      return '正在连接这台设备。连接完成后会重新确认项目和 AI 工具 状态。'
    case 'offline':
      return '这台设备当前离线。重新连接后会重新确认其上的项目和 AI 工具 状态。'
    case 'recovery_required':
      return '这台设备当前无法连接。更新地址后可重新确认项目和 AI 工具 状态。'
    case 'authentication_failed':
      return '这台设备的连接未通过身份验证，当前不能使用其上的项目或 AI 工具。'
    case 'incompatible':
      return '这台设备的 CodeTether 版本不兼容，更新并重新连接后才能使用其上的项目或 AI 工具。'
    case 'local':
      return '这台设备由本地 CodeTether 直接管理。'
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
  return machine.kind === 'local' ? '这台电脑' : 'Node 配对'
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

export function machineConnectionTone(
  state: MachineConnectionState,
): 'ok' | 'warn' | 'err' | 'off' | 'run' {
  switch (state) {
    case 'local':
    case 'online':
      return 'ok'
    case 'connecting':
      return 'run'
    case 'offline':
      return 'off'
    case 'recovery_required':
    case 'incompatible':
      return 'warn'
    case 'authentication_failed':
      return 'err'
  }
}

export function machineExecutionTransportLabel(
  transport: MachineExecutionTransport | undefined,
): string {
  switch (transport) {
    case 'direct':
      return '局域网直连'
    case 'relay':
      return '通过 Relay'
    case 'unavailable':
      return '暂时无法连接'
    case undefined:
      return '未知'
  }
}
