import type {
  Bootstrap,
  CanonicalFailure,
  DoctorBackendStatus,
  DoctorProviderStatus,
  MachineProviderDiscovery,
  MachineConnectionState,
  MachineSummary,
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
  readonly observed?: boolean
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

const compatibilityLabels = {
  verified: '兼容',
  compatible_unverified: '兼容的新版本，尚未完整验证',
  limited: '部分功能受限',
  incompatible: '需要更新 CodeTether',
  unavailable: '暂时不可用',
} as const satisfies Record<ProviderCompatibilityState, string>

const availabilityLabels = {
  available: '可用',
  not_installed: '未安装',
  unsupported_version: '需要更新此 AI 工具',
  misconfigured: '暂时不可用',
  unavailable: '暂时不可用',
} as const satisfies Record<ProviderAvailability, string>

const summaryStatuses = {
  available: { label: '可用', variant: 'success' },
  limited: { label: '可用，部分功能受限', variant: 'warning' },
  login: { label: '未登录', variant: 'warning' },
  updateTool: { label: '需要更新此 AI 工具', variant: 'warning' },
  updateApp: { label: '需要更新 CodeTether', variant: 'warning' },
  unconfirmed: { label: '已安装，待确认', variant: 'secondary' },
  checking: { label: '正在检查…', variant: 'secondary' },
  missing: { label: '未安装', variant: 'secondary' },
  unavailable: { label: '暂时不可用', variant: 'danger' },
} as const

type SummaryStatus = keyof typeof summaryStatuses
export interface ProviderSummary {
  readonly status?: (typeof summaryStatuses)[SummaryStatus]
  readonly freshnessLabel: string
  readonly executionHistoryLabel?: string
  readonly advisory?: string
  readonly checking?: boolean
}

/** Read-only projection of the selected installation. This never grants or denies selection. */
export function providerSummary(
  provider:
    | (Pick<
        ProviderDescriptor,
        'availability' | 'displayName' | 'executionHealth' | 'version'
      > & { readonly observed?: boolean })
    | undefined,
  lifecycle?: MachineProviderLifecycle,
  discovery?: MachineProviderDiscovery,
  connectionState?: MachineConnectionState,
  machineKind: MachineSummary['kind'] | undefined = connectionState === 'local'
    ? 'local'
    : undefined,
): ProviderSummary {
  const selected = lifecycle?.installations.find(
    (item) =>
      item.selected && item.installationId === lifecycle.selectedInstallationId,
  )
  const compatibility = selected?.compatibility
  const observedBackend = selected?.backend
  // A historical sign-in requirement cannot override current discovery. On an
  // offline computer the entire projection is explicitly historical.
  const backend =
    observedBackend?.freshness === 'last_known' &&
    discovery?.state !== 'last_known'
      ? undefined
      : observedBackend
  const health = provider?.executionHealth
  const currentHealth = health?.freshness === 'current' ? health : undefined
  const executionDate = formatExecutionDate(health?.observedAt)
  const executionHistoryLabel =
    health?.freshness === 'last_known' &&
    (health.state === 'unavailable' || health.state === 'degraded')
      ? `上次运行${health.state === 'unavailable' ? '失败' : '受限'}${executionDate === undefined ? '' : ` · ${executionDate}`}`
      : undefined
  const observedAt = [
    selected?.lastObservedAt,
    compatibility?.observedAt,
    observedBackend?.observedAt,
    health?.observedAt,
    discovery?.state === 'current' || discovery?.state === 'last_known'
      ? discovery.observedAt
      : undefined,
  ].reduce<string | undefined>(
    (latest, value) =>
      value && (!latest || Date.parse(value) > Date.parse(latest))
        ? value
        : latest,
    undefined,
  )
  const freshnessLabel = observedAt
    ? lifecycleObservationLabel('last_known', observedAt)
    : '尚未检查'
  if (
    connectionState !== undefined &&
    connectionState !== 'local' &&
    connectionState !== 'online'
  ) {
    const installationKnown =
      (lifecycle?.installations.length ?? 0) > 0 ||
      provider?.version !== undefined ||
      provider?.availability === 'available' ||
      provider?.availability === 'unsupported_version' ||
      provider?.availability === 'misconfigured'
    return installationKnown
      ? {
          status: summaryStatuses.unconfirmed,
          freshnessLabel,
          ...(executionHistoryLabel === undefined
            ? {}
            : { executionHistoryLabel }),
        }
      : { freshnessLabel: '电脑未连接' }
  }
  // A local startup placeholder retains only prior lifecycle observations.
  // A completed failed probe reports current compatibility or execution
  // failure, so it must keep its actual unavailable label.
  const checking =
    machineKind === 'local' &&
    provider?.availability === 'unavailable' &&
    lifecycle !== undefined &&
    lifecycle.installations.every(
      (installation) => installation.compatibility?.freshness !== 'current',
    ) &&
    (provider.executionHealth?.state === 'unknown' ||
      provider.executionHealth?.freshness === 'last_known')
  if (checking) {
    return {
      status: summaryStatuses.checking,
      freshnessLabel,
      executionHistoryLabel,
      checking: true,
    }
  }
  if (
    !provider ||
    provider.observed === false ||
    discovery?.state === 'not_observed'
  ) {
    return { freshnessLabel: '尚未检查' }
  }
  const displayName = provider.displayName
  function summary(state: SummaryStatus, nextStep?: string): ProviderSummary {
    const status = summaryStatuses[state]
    if (state === 'available' || state === 'unconfirmed')
      return { status, freshnessLabel, executionHistoryLabel }
    const advisory = `${displayName} ${status.label}${nextStep ? `，${nextStep}` : ''}。`
    return { status, freshnessLabel, executionHistoryLabel, advisory }
  }

  if (
    provider.availability === 'not_installed' ||
    lifecycle?.installations.length === 0
  ) {
    return summary('missing', '请在电脑上安装后重新检查')
  }
  if (compatibility?.state === 'incompatible') {
    return summary('updateApp', '更新后请在电脑详情重新检查')
  }
  if (
    provider.availability === 'unsupported_version' ||
    currentHealth?.failure?.reason === 'provider_unsupported_version'
  ) {
    return summary('updateTool', '更新后请在电脑详情重新检查')
  }
  const authFailure = currentHealth?.failure?.userAction === 'login_on_machine'
  if (backend?.readiness === 'authentication_required' || authFailure) {
    if (
      backend?.mode &&
      backend.mode !== 'unknown' &&
      backend.mode !== 'first_party'
    ) {
      return summary('unavailable', '请检查 AI 服务配置')
    }
    return summary('login', '请在电脑上完成登录')
  }
  if (
    provider.availability === 'misconfigured' ||
    backend?.readiness === 'misconfigured'
  ) {
    return summary('unavailable', '请检查 AI 服务配置')
  }
  if (
    provider.availability === 'unavailable' ||
    (lifecycle !== undefined && selected?.availability !== 'available') ||
    (compatibility?.state === 'unavailable' &&
      compatibility.freshness !== 'not_observed') ||
    backend?.readiness === 'unavailable' ||
    currentHealth?.state === 'unavailable'
  ) {
    return summary(
      'unavailable',
      providerHealthNextStep(currentHealth?.failure) ?? '请在电脑详情重新检查',
    )
  }
  if (
    compatibility?.state === 'limited' ||
    currentHealth?.state === 'degraded'
  ) {
    return summary('limited', providerHealthNextStep(currentHealth?.failure))
  }
  if (
    compatibility?.freshness === 'not_observed' ||
    (backend?.readiness === 'unknown' && currentHealth?.state !== 'healthy')
  ) {
    return summary('unconfirmed')
  }
  return summary('available')
}

function formatExecutionDate(observedAt?: string): string | undefined {
  if (observedAt === undefined) return undefined
  const date = new Date(observedAt)
  if (Number.isNaN(date.getTime())) return undefined
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
  }).format(date)
}

function providerHealthNextStep(
  failure?: CanonicalFailure,
): string | undefined {
  if (!failure) return undefined
  const steps = {
    retry: '请稍后再试',
    wait:
      failure.reason === 'usage_limit_reached'
        ? '请等待额度恢复'
        : '请稍后再试',
    login_on_machine: '请在电脑上完成登录',
    open_machine: '请在电脑详情查看工具状态',
    open_project: '请检查项目位置',
    repair_project_location: '请在项目中修复文件夹位置',
    reconnect_machine: '请重新连接电脑',
    reinstall_provider: '请重新安装工具',
    update_provider: '请更新工具后重新检查',
    reduce_active_work: '请等待其他任务完成',
    view_details: '请在电脑详情查看原因',
    contact_provider: '请联系 AI 服务提供方',
    none: undefined,
  } satisfies Record<CanonicalFailure['userAction'], string | undefined>
  return steps[failure.userAction]
}

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
      stateLabel: '待确认',
      freshnessLabel: '尚未检查',
      description: '尚未检查这个工具能否完成会话。',
    }
  }

  const stateLabels = {
    healthy: '运行正常',
    degraded: '部分功能受限',
    unavailable: '暂时不可用',
    unknown: '状态未知',
  } as const satisfies Record<ProviderExecutionHealth['state'], string>
  const freshnessLabel =
    health.freshness === 'current' ? '当前状态' : '上次检查'
  const failurePresentation =
    health.failure === undefined
      ? undefined
      : canonicalFailureActionPresentation(health.failure, {
          providerDisplayName,
        })
  const description =
    failurePresentation !== undefined
      ? `${failurePresentation.cause}${failurePresentation.guidance}`
      : health.state === 'healthy' && health.freshness === 'current'
        ? '最近一次使用时运行正常。'
        : health.state === 'healthy'
          ? '上次使用时运行正常。'
          : '尚未确认这个工具能否完成会话。'

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

export function machineProviderSummary(
  detail: {
    readonly machine?: Pick<MachineSummary, 'connectionState' | 'kind'>
    readonly providers: readonly ProviderDescriptor[]
    readonly providerLifecycles?: readonly MachineProviderLifecycle[]
    readonly providerDiscovery?: MachineProviderDiscovery
  },
  provider: ProviderId,
  connectionState = detail.machine?.connectionState,
): ProviderSummary {
  return providerSummary(
    detail.providers.find((item) => item.provider === provider),
    providerLifecycleForMachine(detail.providerLifecycles ?? [], provider),
    detail.providerDiscovery,
    connectionState,
    detail.machine?.kind,
  )
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
      return '上次检查'
    case 'not_observed':
      return '尚未检查'
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
          ? '尚未检查'
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

export function installationCompatibilityLabel(
  installation: ProviderInstallationSummary,
): string {
  if (installation.availability !== 'available')
    return summaryStatuses.unavailable.label
  const compatibility = installation.compatibility
  if (!compatibility || compatibility.freshness === 'not_observed')
    return '尚未检查兼容性'
  return [
    compatibilityLabels[compatibility.state],
    providerLifecycleFreshnessLabel(compatibility.freshness),
  ].join(' · ')
}

function providerRuntimeLifecyclePresentation(
  compatibility: ProviderInstallationSummary['compatibility'],
): ProviderRuntimeLifecyclePresentation {
  if (compatibility === undefined) {
    return {
      state: 'not_observed',
      stateLabel: '尚未验证',
      freshnessLabel: '尚未检查',
      description: '尚未检查此版本能否与 CodeTether 一起使用。',
    }
  }

  const stateDescriptions = {
    verified: '此版本可以与 CodeTether 一起使用。',
    compatible_unverified: '此版本可以使用，但部分功能尚未经过检查。',
    limited: '可以开始会话，但部分功能暂不可用。',
    incompatible: '请更新 CodeTether 以使用此版本的工具。',
    unavailable: '所选安装当前无法运行；项目和历史仍然可用。',
  } as const satisfies Record<ProviderCompatibilityState, string>
  const failurePresentation =
    compatibility.failure === undefined
      ? undefined
      : canonicalFailureActionPresentation(compatibility.failure)
  const description =
    failurePresentation === undefined
      ? stateDescriptions[compatibility.state]
      : `${failurePresentation.cause}${failurePresentation.guidance}`

  return {
    state: compatibility.state,
    stateLabel: compatibilityLabels[compatibility.state],
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
      modeLabel: '尚未检查',
      readiness: 'not_observed',
      readinessLabel: '尚未验证',
      freshnessLabel: '尚未检查',
      description: '尚未检查 AI 服务是否可用。',
    }
  }

  const readinessDescriptions = {
    unknown: '开始会话后可以确认 AI 服务是否可用。',
    ready: 'AI 服务可以使用。',
    unavailable: 'AI 服务暂时无法连接。',
    authentication_required: '当前 AI 服务需要在这台电脑上完成身份验证。',
    misconfigured: '请在电脑上检查 AI 服务配置。',
  } as const satisfies Record<ProviderBackendReadiness, string>
  const failurePresentation =
    backend.failure === undefined
      ? undefined
      : canonicalFailureActionPresentation(backend.failure)
  const description =
    failurePresentation === undefined
      ? readinessDescriptions[backend.readiness]
      : `${failurePresentation.cause}${failurePresentation.guidance}`

  return {
    mode: backend.mode,
    modeLabel: backendModeLabel(backend),
    readiness: backend.readiness,
    readinessLabel: backendReadinessLabel(backend),
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
    reasoningLabel: '推理',
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
    observed: false,
    availabilityLabel: availabilityLabels.unavailable,
    available: false,
    capabilities: unavailableCapabilities,
    models: [],
    reasoningLabel: '推理',
    reasoningOptions: [],
  }
}

export function onboardingProviderInstallationLabel(
  provider: DoctorProviderStatus,
): string {
  if (provider.freshness === 'not_observed') return '尚未检查'
  const label = !provider.installed
    ? '未安装'
    : provider.selected
      ? '已安装'
      : '已安装 · 未选择'
  return label
}

export function onboardingProviderRuntimeLabel(
  provider: DoctorProviderStatus,
): string {
  if (provider.freshness === 'not_observed') return '尚未检查'
  const compatibility = providerCompatibilityLabel(provider)
  const readiness =
    provider.runtimeReadiness === 'ready'
      ? '可用'
      : provider.runtimeReadiness === 'limited'
        ? '部分功能可用'
        : undefined
  const label =
    readiness === undefined ? compatibility : `${readiness} · ${compatibility}`
  return label
}

export function onboardingProviderServiceLabel(
  provider: DoctorProviderStatus,
): string {
  if (provider.backend === undefined) return '尚未验证'
  if (provider.backend.readiness !== 'unknown')
    return backendReadinessLabel(provider.backend)
  return '尚未验证'
}

export function onboardingSessionDiscoveryLabel(
  state: DoctorProviderStatus['sessionDiscovery'],
): string {
  return {
    supported: '支持查找',
    unsupported: '暂不支持查找',
    unavailable: '暂时无法查找',
    unknown: '尚未检查',
  }[state]
}

export function providerCompatibilityLabel(
  provider: DoctorProviderStatus,
): string {
  if (provider.freshness === 'not_observed') return '尚未检查'
  const label = !provider.installed
    ? '未安装'
    : provider.compatibility
      ? compatibilityLabels[provider.compatibility]
      : '尚未检查'
  return label
}

export function providerVersionLabel(provider: DoctorProviderStatus): string {
  if (provider.freshness === 'not_observed') return '尚未检查'
  const label = provider.installed ? (provider.version ?? '已安装') : '未安装'
  return label
}

export function backendModeLabel(
  backend: Pick<DoctorBackendStatus, 'mode'> | undefined,
): string {
  if (backend === undefined) return 'AI 服务尚未检查'
  switch (backend.mode) {
    case 'first_party':
      return '官方 AI 服务'
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
  backend:
    Pick<DoctorBackendStatus, 'mode' | 'readiness' | 'freshness'> | undefined,
): string {
  if (backend === undefined) return '尚未检查'
  switch (backend.readiness) {
    case 'ready':
      return '可用'
    case 'unavailable':
      return '暂时不可用'
    case 'authentication_required':
      return backend.mode === 'first_party' ? '未登录' : '需要检查配置'
    case 'misconfigured':
      return '需要检查配置'
    case 'unknown':
      return '尚未检查'
  }
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
