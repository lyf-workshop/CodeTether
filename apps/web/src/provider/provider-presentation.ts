import type {
  Bootstrap,
  ProviderAvailability,
  ProviderCapabilities,
  ProviderId,
  ProviderModel,
  ProviderReasoningOption,
} from '@codetether/protocol'
import type { AgentId } from '@codetether/ui'

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
    }
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
