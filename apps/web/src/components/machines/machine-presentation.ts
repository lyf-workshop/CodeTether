import type { MachineSummary } from '@codetether/protocol'

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
