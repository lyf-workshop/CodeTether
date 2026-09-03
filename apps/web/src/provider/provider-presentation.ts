import type {
  Bootstrap,
  ProviderAvailability,
  ProviderCapabilities,
  ProviderDescriptor,
  ProviderExecutionHealth,
  ProviderId,
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
