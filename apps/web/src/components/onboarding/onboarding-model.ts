import type {
  DoctorBackendStatus,
  DoctorComponentState,
  DoctorProviderStatus,
  DoctorReport,
  DoctorRemoteComputer,
  MachineId,
  MachineConnectionState,
  OnboardingStep,
  ProjectId,
  ProviderId,
} from '@codetether/protocol'

import { canonicalFailureActionPresentation } from '../../failures/failure-presentation.js'

export const onboardingSteps = [
  'welcome',
  'computer_check',
  'provider_check',
  'project_setup',
  'previous_conversations',
  'remote_setup',
  'ready',
] as const satisfies readonly OnboardingStep[]

export const providerInstallationGuidance = {
  codex: {
    label: 'Codex',
    href: 'https://developers.openai.com/codex/cli',
    action: '查看 Codex 官方安装指南',
  },
  'claude-code': {
    label: 'Claude Code',
    href: 'https://docs.anthropic.com/en/docs/claude-code/getting-started',
    action: '查看 Claude Code 官方安装指南',
  },
} as const satisfies Record<
  ProviderId,
  { readonly label: string; readonly href: string; readonly action: string }
>

export function onboardingStepIndex(step: OnboardingStep): number {
  return onboardingSteps.indexOf(step)
}

export function providerDisplayName(provider: ProviderId): string {
  return providerInstallationGuidance[provider].label
}

export function doctorStateLabel(state: DoctorComponentState): string {
  switch (state) {
    case 'ready':
      return '就绪'
    case 'needs_attention':
      return '需要处理'
    case 'limited':
      return '受限'
    case 'unavailable':
      return '不可用'
    case 'offline':
      return '离线'
    case 'unknown':
      return '尚未检查'
  }
}

export function doctorStateBadgeVariant(
  state: DoctorComponentState,
): 'success' | 'warning' | 'danger' | 'secondary' {
  switch (state) {
    case 'ready':
      return 'success'
    case 'needs_attention':
    case 'limited':
      return 'warning'
    case 'unavailable':
      return 'danger'
    case 'offline':
    case 'unknown':
      return 'secondary'
  }
}

export function doctorOverallPresentation(doctor: DoctorReport): {
  readonly title: string
  readonly detail: string
} {
  switch (doctor.overall) {
    case 'ready':
      return {
        title: 'CodeTether 可以使用',
        detail: '当前项目至少有一个 AI 工具执行路径可用。',
      }
    case 'limited':
      return {
        title: 'CodeTether 可以使用，部分功能受限',
        detail: '可用的核心执行路径不受影响；请查看下面标出的受限功能。',
      }
    case 'unavailable':
      return {
        title: 'CodeTether 当前不可用',
        detail:
          doctor.thisComputer.state === 'unavailable'
            ? '应用服务当前不可用；已有项目和历史记录不会被删除。'
            : '一个必需组件当前不可用；请查看下面对应的电脑、AI 工具或项目状态。',
      }
    case 'offline':
      return {
        title: '当前工作环境离线',
        detail:
          '上次已知状态会明确标出；安全信任以及已有项目和历史记录仍然保留。',
      }
    case 'unknown':
      return {
        title: '状态尚未完全检查',
        detail: '选择“重新检查”可更新事实状态，不会发送提示或创建对话。',
      }
    case 'needs_attention': {
      if (
        doctor.project !== undefined &&
        doctor.project.state !== 'ready' &&
        doctor.project.state !== 'limited'
      ) {
        return {
          title: '当前项目需要处理',
          detail: '项目文件夹当前没有可确认的执行路径；历史记录仍可查看。',
        }
      }
      if (!doctor.providers.some(isProviderUsable)) {
        return {
          title: 'AI 工具或服务需要处理',
          detail: '请查看下面对应的安装、兼容性、登录或 AI 服务状态。',
        }
      }
      return {
        title: '设置需要处理',
        detail: '请查看下面标出的组件和针对性恢复建议。',
      }
    }
  }
}

export function remoteComputerRepairText(
  state: Exclude<MachineConnectionState, 'local'>,
): string | undefined {
  switch (state) {
    case 'online':
      return undefined
    case 'connecting':
      return '正在建立安全连接。请稍候，然后选择“重新检查”。'
    case 'offline':
      return '这台电脑当前离线；安全信任仍然保留。电脑恢复连接后选择“重新检查”，无需重新配对。'
    case 'recovery_required':
      return '已保存的网络地址当前不可用。请打开电脑详情并更新连接地址；安全信任仍然保留。'
    case 'authentication_failed':
      return 'CodeTether 无法验证这台电脑的已信任身份，因此已拒绝连接。请打开电脑详情核对目标电脑和现有信任；CodeTether 不会自动接受变化后的身份。'
    case 'incompatible':
      return '这台电脑上的 CodeTether 远程组件与当前版本不兼容。请更新远程组件后重新检查；项目和对话历史仍然可用。'
  }
}

export function remoteOnboardingBlockerText(
  machine: DoctorRemoteComputer,
  projectLocationState: DoctorComponentState | undefined,
  checkFailed: boolean,
): string {
  if (checkFailed) {
    return '部分检查暂时未能完成。已有项目和会话仍然安全；请稍候后重新检查。'
  }
  if (machine.connectionState !== 'online') {
    return (
      remoteComputerRepairText(machine.connectionState) ??
      '这台电脑当前无法建立安全连接。'
    )
  }
  if (projectLocationState !== 'ready') {
    return '需要确认另一台电脑上的项目文件夹当前可用。此检查不会发送提示或创建对话。'
  }
  const provider = machine.providers.find(
    (candidate) => candidate.state !== 'ready' && candidate.state !== 'limited',
  )
  if (provider?.backend?.readiness === 'unavailable') {
    return '项目文件夹可用，但 AI 服务当前不可用。无需重新选择项目或重新配对。'
  }
  if (provider?.backend?.readiness === 'authentication_required') {
    return provider.backend.mode === 'first_party'
      ? '项目文件夹可用，但 AI 服务需要登录。完成登录后重新检查。'
      : '项目文件夹可用，但自定义 AI 服务的凭据或配置需要检查；无需登录第一方服务。'
  }
  return '项目文件夹可用，但所选 AI 工具当前尚未就绪。修复工具或服务后重新检查。'
}

export function localOnboardingBlockerText(
  doctor: DoctorReport,
  projectLocationState: DoctorComponentState | undefined,
  checkFailed: boolean,
): string {
  if (checkFailed) {
    return '当前检查暂时未能完成。已有项目和会话仍然安全；请稍候后重新检查。'
  }
  if (doctor.thisComputer.state !== 'ready') {
    return '这台电脑的 CodeTether 服务当前尚未就绪。请重新检查；已有项目和会话不会受到影响。'
  }
  if (projectLocationState === 'unknown') {
    return '项目文件夹尚未完成当前检查。重新检查不会发送提示或创建对话。'
  }
  if (projectLocationState !== 'ready') {
    return '项目文件夹当前不可用。恢复文件夹或安全地选择另一个项目后再开始新执行。'
  }
  const provider = doctor.providers.find(
    (candidate) => !isProviderUsable(candidate),
  )
  if (provider !== undefined) return providerRepairText(provider)
  return '当前项目没有可用的 AI 工具。修复工具或 AI 服务后重新检查。'
}

export function isProviderUsable(provider: DoctorProviderStatus): boolean {
  if (provider.state !== 'ready' && provider.state !== 'limited') return false
  if (
    provider.runtimeReadiness !== 'ready' &&
    provider.runtimeReadiness !== 'limited'
  ) {
    return false
  }
  return (
    provider.backend === undefined || provider.backend.readiness === 'ready'
  )
}

/**
 * Evaluates the exact Project/Machine context selected during onboarding.
 * Doctor.overall may be ready because a different Location on the same
 * Project has a usable execution path, so it is deliberately insufficient for
 * the Ready screen.
 */
export function isDoctorExecutionContextReady(
  doctor: DoctorReport,
  projectId: ProjectId | undefined,
  machineId: MachineId | undefined,
): boolean {
  if (projectId === undefined || machineId === undefined) return false
  if (doctor.project?.projectId !== projectId) return false

  const location = doctor.project.locations.find(
    (candidate) => candidate.machineId === machineId,
  )
  if (location?.state !== 'ready') return false

  if (machineId === doctor.thisComputer.machineId) {
    return (
      doctor.thisComputer.state === 'ready' &&
      doctor.providers.some(isProviderUsable)
    )
  }

  const remote = doctor.remoteComputers.find(
    (candidate) => candidate.machineId === machineId,
  )
  return (
    remote?.connectionState === 'online' &&
    (remote.state === 'ready' || remote.state === 'limited') &&
    remote.providers.some(isProviderUsable)
  )
}

export function providerCompatibilityLabel(
  provider: DoctorProviderStatus,
): string {
  if (provider.freshness === 'not_observed') return '尚未检查'
  const label = (() => {
    if (!provider.installed) return '未安装'
    switch (provider.compatibility) {
      case 'verified':
        return '兼容'
      case 'compatible_unverified':
        return '兼容 — 检测到新版本'
      case 'limited':
        return '部分功能受限'
      case 'incompatible':
        return '需要更新 CodeTether'
      case 'unavailable':
        return '当前不可用'
      case undefined:
        return '尚未检查'
    }
  })()
  return provider.freshness === 'last_known' && label !== '尚未检查'
    ? `上次检查：${label}`
    : label
}

export function providerVersionLabel(provider: DoctorProviderStatus): string {
  if (provider.freshness === 'not_observed') return '尚未检查'
  const label = provider.installed ? (provider.version ?? '已安装') : '未安装'
  return provider.freshness === 'last_known' ? `上次检查：${label}` : label
}

export function backendModeLabel(
  backend: DoctorBackendStatus | undefined,
): string {
  if (backend === undefined) return 'AI 服务尚未检查'
  switch (backend.mode) {
    case 'first_party':
      return 'Provider AI 服务'
    case 'custom_gateway':
      return '自定义 AI 服务'
    case 'bedrock':
      return 'Amazon Bedrock'
    case 'vertex':
      return 'Google Vertex AI'
    case 'unknown':
      return 'AI 服务'
  }
}

export function backendReadinessLabel(
  backend: DoctorBackendStatus | undefined,
): string {
  if (backend === undefined) return '尚未检查'
  const label = (() => {
    switch (backend.readiness) {
      case 'ready':
        return '就绪'
      case 'unavailable':
        return '暂时不可用'
      case 'authentication_required':
        return backend.mode === 'first_party' ? '需要登录' : '需要检查配置'
      case 'misconfigured':
        return '需要检查配置'
      case 'unknown':
        return '尚未检查'
    }
  })()
  return backend.freshness === 'last_known' && label !== '尚未检查'
    ? `上次检查：${label}`
    : label
}

export function lifecycleObservationLabel(
  freshness: DoctorProviderStatus['freshness'],
  observedAt?: string,
): string {
  if (freshness === 'not_observed') return '尚未检查'
  const timestamp = formatObservationTime(observedAt)
  if (freshness === 'last_known') {
    return timestamp === undefined ? '上次检查' : `上次检查：${timestamp}`
  }
  return timestamp === undefined ? '当前状态' : `检查于 ${timestamp}`
}

function formatObservationTime(observedAt?: string): string | undefined {
  if (observedAt === undefined) return undefined
  const date = new Date(observedAt)
  if (Number.isNaN(date.getTime())) return undefined
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

export function providerRepairText(provider: DoctorProviderStatus): string {
  if (provider.freshness === 'not_observed') {
    return '当前安装和运行状态尚未检查。电脑连接可用后选择“重新检查”。'
  }
  if (provider.freshness === 'last_known') {
    return '这是上次检查的状态，不代表当前状态。电脑连接可用后选择“重新检查”。'
  }
  if (!provider.installed)
    return '安装后选择“重新检查”。CodeTether 不会自动安装或更新。'
  if (provider.compatibility === 'incompatible') {
    return '此版本当前无法安全执行新工作。项目和对话历史仍然可用。'
  }
  if (provider.runtimeReadiness === 'unavailable') {
    return '所选安装当前不可用。CodeTether 不会自动切换到其他安装。'
  }
  if (provider.backend?.readiness === 'authentication_required') {
    return provider.backend.mode === 'first_party'
      ? '请按 Provider 的官方登录流程完成登录，然后重新检查。'
      : '自定义 AI 服务需要检查凭据或配置；无需登录第一方服务。'
  }
  if (provider.backend?.readiness === 'unavailable') {
    return '工具运行环境兼容，但 AI 服务暂时无法连接。无需重新安装工具。'
  }
  const currentHealth =
    provider.executionHealth?.freshness === 'current'
      ? provider.executionHealth
      : undefined
  if (currentHealth?.failure !== undefined) {
    const presentation = canonicalFailureActionPresentation(
      currentHealth.failure,
      { providerDisplayName: providerDisplayName(provider.provider) },
    )
    return `${presentation.cause} ${presentation.guidance}`
  }
  if (currentHealth?.state === 'unavailable') {
    return '最近一次执行检查不可用。请检查 AI 工具和服务状态，然后重新检查。'
  }
  if (currentHealth?.state === 'degraded') {
    return '最近一次执行检查显示服务受限。请稍后重新检查或明确开始一个新轮次。'
  }
  if (provider.sessionDiscovery === 'unsupported') {
    return '新对话仍可使用；此版本暂不支持查找以前的对话。'
  }
  return 'CodeTether 会在新执行前再次验证当前状态。'
}
