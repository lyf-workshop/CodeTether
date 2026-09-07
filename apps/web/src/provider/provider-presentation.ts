import type {
  Bootstrap,
  ProviderAvailability,
  ProviderCapabilities,
  ProviderBackendMode,
  ProviderBackendReadiness,
  ProviderCompatibilityState,
  ProviderDescriptor,
  ProviderExecutionHealth,
  ProviderId,
  ProviderInstallationAvailability,
  ProviderInstallationLauncherKind,
  ProviderInstallationMethod,
  ProviderInstallationSummary,
  ProviderLifecycleFreshness,
  MachineProviderLifecycle,
  ProviderModel,
  ProviderReasoningOption,
} from '@codetether/protocol'
import type { AgentId } from '@codetether/ui'

import { canonicalFailureActionPresentation } from '../failures/failure-presentation.js'

export type AgentProvider = ProviderId

export const supportedAgentProviders = [
  'codex',
  'claude-code',
] as const satisfies readonly AgentProvider[]

export interface ProviderPresentation {
  readonly provider: AgentProvider
  readonly agent: AgentId
  readonly displayName: string
  readonly availability: ProviderAvailability
  readonly availabilityLabel: string
  readonly available: boolean
  readonly version?: string
  readonly testedVersion?: string
  readonly capabilities: ProviderCapabilities
  readonly models: readonly ProviderModel[]
  readonly reasoningLabel: string
  readonly reasoningOptions: readonly ProviderReasoningOption[]
  readonly executionHealth?: ProviderExecutionHealth
}

export interface ProviderExecutionHealthPresentation {
  readonly state: ProviderExecutionHealth['state'] | 'not_observed'
  readonly stateLabel: string
  readonly freshnessLabel: string
  readonly description: string
  readonly observedAt?: string
}

export interface ProviderInstallationLifecyclePresentation {
  readonly state:
    ProviderInstallationAvailability | 'not_observed' | 'not_selected'
  readonly stateLabel: string
  readonly detailLabel: string
  readonly selected: boolean
  readonly alternateCount: number
  readonly version?: string
  readonly observedAt?: string
}

export interface ProviderRuntimeLifecyclePresentation {
  readonly state: ProviderCompatibilityState | 'not_observed'
  readonly stateLabel: string
  readonly freshnessLabel: string
  readonly description: string
  readonly observedAt?: string
}

export interface ProviderBackendLifecyclePresentation {
  readonly mode: ProviderBackendMode | 'not_observed'
  readonly modeLabel: string
  readonly readiness: ProviderBackendReadiness | 'not_observed'
  readonly readinessLabel: string
  readonly freshnessLabel: string
  readonly description: string
  readonly observedAt?: string
}

export interface ProviderLifecyclePresentation {
  readonly installation: ProviderInstallationLifecyclePresentation
  readonly runtime: ProviderRuntimeLifecyclePresentation
  readonly backend: ProviderBackendLifecyclePresentation
}

const providerAgentIds = {
  codex: 'codex',
  'claude-code': 'claude',
} as const satisfies Record<AgentProvider, AgentId>

const providerFallbackNames = {
  codex: 'Codex',
  'claude-code': 'Claude Code',
} as const satisfies Record<AgentProvider, string>

const availabilityLabels = {
  available: '可用',
  not_installed: '未安装',
  unsupported_version: '版本不支持',
  misconfigured: '暂时不可用',
  unavailable: '暂时不可用',
} as const satisfies Record<ProviderAvailability, string>

const unavailableCapabilities: ProviderCapabilities = {
  streaming: false,
  resume: false,
  interrupt: false,
  approvals: false,
  fileRead: false,
  fileEdit: false,
  shell: false,
  search: false,
  diff: false,
  toolEvents: false,
  modelSelection: false,
  reasoningControl: false,
}

export function providerPresentation(
  bootstrap: Bootstrap | undefined,
  provider: AgentProvider,
): ProviderPresentation {
  const descriptor = bootstrap?.providers?.find(
    (candidate) => candidate.provider === provider,
  )
  if (descriptor !== undefined) {
    return presentProviderDescriptor(descriptor)
  }

  const legacyCodexAvailable =
    provider === 'codex' &&
    bootstrap !== undefined &&
    bootstrap.providers === undefined &&
    bootstrap.capabilities.codex === true
  const availability: ProviderAvailability = legacyCodexAvailable
    ? 'available'
    : 'unavailable'

  return {
    provider,
    agent: providerAgentIds[provider],
    displayName: providerFallbackNames[provider],
    availability,
    availabilityLabel: availabilityLabels[availability],
    available: legacyCodexAvailable,
    capabilities:
      provider === 'codex' && bootstrap !== undefined
        ? {
            ...unavailableCapabilities,
            streaming: bootstrap.capabilities.streaming,
            resume: bootstrap.capabilities.resume,
            interrupt: bootstrap.capabilities.interrupt,
            approvals: bootstrap.capabilities.approvals,
            diff: bootstrap.capabilities.diff,
            reasoningControl: bootstrap.capabilities.codex,
          }
        : unavailableCapabilities,
    models: [],
    reasoningLabel: '推理',
    reasoningOptions: [],
  }
}

/** Presents Provider truth scoped to one Machine without falling back globally. */
export function providerPresentationForMachine(
  descriptors: readonly ProviderDescriptor[],
  provider: AgentProvider,
): ProviderPresentation {
  const descriptor = descriptors.find(
    (candidate) => candidate.provider === provider,
  )
  return descriptor === undefined
    ? unavailableProviderPresentation(provider)
    : presentProviderDescriptor(descriptor)
}

export function providerPresentationsForMachine(
  descriptors: readonly ProviderDescriptor[],
): readonly ProviderPresentation[] {
  return supportedAgentProviders.map((provider) =>
    providerPresentationForMachine(descriptors, provider),
  )
}

export function providerPresentations(
  bootstrap: Bootstrap | undefined,
): readonly ProviderPresentation[] {
  return supportedAgentProviders.map((provider) =>
    providerPresentation(bootstrap, provider),
  )
}

export function providerAgentId(provider: AgentProvider): AgentId {
  return providerAgentIds[provider]
}

export function providerDisplayName(provider: AgentProvider): string {
  return providerFallbackNames[provider]
}

export function providerExecutionHealthPresentation(
  health: ProviderExecutionHealth | undefined,
  providerDisplayName?: string,
): ProviderExecutionHealthPresentation {
  if (health === undefined) {
    return {
      state: 'not_observed',
      stateLabel: '尚未验证',
      freshnessLabel: '未观察',
      description: '尚无独立的执行健康结果；安装状态不代表当前可以执行。',
    }
  }

  const stateLabels = {
    healthy: '执行正常',
    degraded: '执行受限',
    unavailable: '执行不可用',
    unknown: '状态未知',
  } as const satisfies Record<ProviderExecutionHealth['state'], string>
  const freshnessLabel =
    health.freshness === 'current' ? '当前状态' : '上次已知'
  const failurePresentation =
    health.failure === undefined
      ? undefined
      : canonicalFailureActionPresentation(health.failure, {
          providerDisplayName,
        })
  const description =
    failurePresentation !== undefined
      ? `${failurePresentation.cause} ${failurePresentation.guidance}`
      : health.state === 'healthy' && health.freshness === 'current'
        ? '当前连接上的执行条件已经过验证。'
        : health.state === 'healthy'
          ? '上次验证时执行正常；当前连接尚未重新验证。'
          : '当前没有可确认的执行健康结果。'

  return {
    state: health.state,
    stateLabel: stateLabels[health.state],
    freshnessLabel,
    description,
    ...(health.observedAt === undefined
      ? {}
      : { observedAt: health.observedAt }),
  }
}

/**
 * Presents the selected installation and its lifecycle observations without
 * exposing private installation identities, executable paths, revisions, or
 * backend configuration values.
 */
export function providerLifecyclePresentation(
  lifecycle: MachineProviderLifecycle | undefined,
): ProviderLifecyclePresentation {
  const selected = lifecycle?.installations.find(
    (installation) => installation.selected,
  )

  return {
    installation: providerInstallationLifecyclePresentation(
      selected,
      lifecycle?.installations.length ?? 0,
      lifecycle !== undefined,
    ),
    runtime: providerRuntimeLifecyclePresentation(selected?.compatibility),
    backend: providerBackendLifecyclePresentation(selected?.backend),
  }
}

export function providerLifecycleForMachine(
  lifecycles: readonly MachineProviderLifecycle[],
  provider: AgentProvider,
): MachineProviderLifecycle | undefined {
  return lifecycles.find((candidate) => candidate.provider === provider)
}

export function providerLifecycleFreshnessLabel(
  freshness: ProviderLifecycleFreshness,
): string {
  switch (freshness) {
    case 'current':
      return '当前状态'
    case 'last_known':
      return '上次已知'
    case 'not_observed':
      return '尚未观察'
  }
}

function providerInstallationLifecyclePresentation(
  installation: ProviderInstallationSummary | undefined,
  installationCount: number,
  lifecycleObserved: boolean,
): ProviderInstallationLifecyclePresentation {
  if (installation === undefined) {
    const state = lifecycleObserved ? 'not_selected' : 'not_observed'
    return {
      state,
      stateLabel:
        state === 'not_observed'
          ? '尚未观察'
          : installationCount === 0
            ? '未检测到安装'
            : '尚未选择',
      detailLabel:
        installationCount === 0
          ? '没有可展示的已选安装'
          : `另发现 ${installationCount} 个安装`,
      selected: false,
      alternateCount: installationCount,
    }
  }

  const stateLabels = {
    available: '已选择',
    unavailable: '所选安装不可用',
    unresolved: '所选安装未解析',
  } as const satisfies Record<ProviderInstallationAvailability, string>
  const versionLabel =
    installation.version === undefined
      ? '版本未知'
      : `版本 ${installation.version}`
  const detailLabel = [
    versionLabel,
    providerInstallationMethodLabel(installation.installMethod),
    providerInstallationLauncherLabel(installation.launcherKind),
  ].join(' · ')

  return {
    state: installation.availability,
    stateLabel: stateLabels[installation.availability],
    detailLabel,
    selected: true,
    alternateCount: Math.max(installationCount - 1, 0),
    ...(installation.version === undefined
      ? {}
      : { version: installation.version }),
    observedAt: installation.lastObservedAt,
  }
}

function providerRuntimeLifecyclePresentation(
  compatibility: ProviderInstallationSummary['compatibility'],
): ProviderRuntimeLifecyclePresentation {
  if (compatibility === undefined) {
    return {
      state: 'not_observed',
      stateLabel: '尚未验证',
      freshnessLabel: '尚未观察',
      description: '尚无针对所选安装修订的兼容性结果。',
    }
  }

  const stateLabels = {
    verified: '兼容',
    compatible_unverified: '兼容 — 新版本',
    limited: '受限',
    incompatible: '需要更新 CodeTether',
    unavailable: '不可用',
  } as const satisfies Record<ProviderCompatibilityState, string>
  const stateDescriptions = {
    verified: '当前 CodeTether 运行契约已验证。',
    compatible_unverified: '必需运行契约已通过；此安装修订尚未列入已验证矩阵。',
    limited: '核心执行仍可用，但一个或多个可选能力不可用。',
    incompatible: '当前安装缺少安全执行所需契约；项目和历史仍然安全。',
    unavailable: '所选安装当前无法运行；项目和历史仍然可用。',
  } as const satisfies Record<ProviderCompatibilityState, string>
  const failurePresentation =
    compatibility.failure === undefined
      ? undefined
      : canonicalFailureActionPresentation(compatibility.failure)
  const description =
    failurePresentation === undefined
      ? stateDescriptions[compatibility.state]
      : `${failurePresentation.cause} ${failurePresentation.guidance}`

  return {
    state: compatibility.state,
    stateLabel: stateLabels[compatibility.state],
    freshnessLabel: providerLifecycleFreshnessLabel(compatibility.freshness),
    description,
    ...(compatibility.observedAt === undefined
      ? {}
      : { observedAt: compatibility.observedAt }),
  }
}

function providerBackendLifecyclePresentation(
  backend: ProviderInstallationSummary['backend'],
): ProviderBackendLifecyclePresentation {
  if (backend === undefined) {
    return {
      mode: 'not_observed',
      modeLabel: '尚未观察',
      readiness: 'not_observed',
      readinessLabel: '尚未验证',
      freshnessLabel: '尚未观察',
      description: '后端就绪状态与 Provider 运行时兼容性分开验证。',
    }
  }

  const modeLabels = {
    first_party: 'Provider 官方服务',
    custom_gateway: '自定义网关',
    bedrock: 'Amazon Bedrock',
    vertex: 'Google Vertex AI',
    unknown: '后端模式未知',
  } as const satisfies Record<ProviderBackendMode, string>
  const readinessLabels = {
    unknown: '尚未验证',
    ready: '就绪',
    unavailable: '不可用',
    authentication_required: '需要登录',
    misconfigured: '配置不可用',
  } as const satisfies Record<ProviderBackendReadiness, string>
  const readinessDescriptions = {
    unknown: '尚未通过显式检查或实际执行确认推理后端。',
    ready: '当前推理后端已验证可用。',
    unavailable: '推理后端当前不可用；运行时兼容性保持独立。',
    authentication_required: '当前后端需要在这台机器上完成身份验证。',
    misconfigured: '当前后端配置无法用于 Provider 执行。',
  } as const satisfies Record<ProviderBackendReadiness, string>
  const failurePresentation =
    backend.failure === undefined
      ? undefined
      : canonicalFailureActionPresentation(backend.failure)
  const description =
    failurePresentation === undefined
      ? readinessDescriptions[backend.readiness]
      : `${failurePresentation.cause} ${failurePresentation.guidance}`

  return {
    mode: backend.mode,
    modeLabel: modeLabels[backend.mode],
    readiness: backend.readiness,
    readinessLabel: readinessLabels[backend.readiness],
    freshnessLabel: providerLifecycleFreshnessLabel(backend.freshness),
    description,
    ...(backend.observedAt === undefined
      ? {}
      : { observedAt: backend.observedAt }),
  }
}

function providerInstallationMethodLabel(
  method: ProviderInstallationMethod,
): string {
  switch (method) {
    case 'native_installer':
      return '原生安装器'
    case 'npm':
      return 'npm'
    case 'homebrew':
      return 'Homebrew'
    case 'package_manager':
      return '包管理器'
    case 'manual':
      return '手动安装'
    case 'unknown':
      return '来源未知'
  }
}

function providerInstallationLauncherLabel(
  launcher: ProviderInstallationLauncherKind,
): string {
  switch (launcher) {
    case 'native':
      return '原生可执行文件'
    case 'symlink':
      return '符号链接'
    case 'hardlink':
      return '硬链接'
    case 'wrapper':
      return '启动包装器'
    case 'npm_shim':
      return 'npm 启动器'
    case 'unknown':
      return '启动方式未知'
  }
}

function presentProviderDescriptor(
  descriptor: ProviderDescriptor,
): ProviderPresentation {
  const provider = descriptor.provider
  return {
    provider,
    agent: providerAgentIds[provider],
    displayName: descriptor.displayName,
    availability: descriptor.availability,
    availabilityLabel: availabilityLabels[descriptor.availability],
    available: descriptor.availability === 'available',
    ...(descriptor.version === undefined
      ? {}
      : { version: descriptor.version }),
    ...(descriptor.testedVersion === undefined
      ? {}
      : { testedVersion: descriptor.testedVersion }),
    capabilities: descriptor.capabilities,
    models: descriptor.models ?? [],
    reasoningLabel: descriptor.reasoningLabel ?? '推理',
    reasoningOptions: descriptor.reasoningOptions ?? [],
    ...(descriptor.executionHealth === undefined
      ? {}
      : { executionHealth: descriptor.executionHealth }),
  }
}

function unavailableProviderPresentation(
  provider: AgentProvider,
): ProviderPresentation {
  return {
    provider,
    agent: providerAgentIds[provider],
    displayName: providerFallbackNames[provider],
    availability: 'unavailable',
    availabilityLabel: availabilityLabels.unavailable,
    available: false,
    capabilities: unavailableCapabilities,
    models: [],
    reasoningLabel: '推理',
    reasoningOptions: [],
  }
}
