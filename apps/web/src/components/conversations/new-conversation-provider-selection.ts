import {
  providerSummary,
  type ProviderSummary,
  type ProviderPresentation,
} from '../../provider/provider-presentation.js'

export interface NewConversationProviderEligibility {
  readonly eligible: boolean
  readonly label: string
  readonly summary: ProviderSummary
  readonly checking?: boolean
  readonly executionAdvisory?: string
}

/** Installation/capabilities gate selection; recent runtime health stays advisory. */
export function newConversationProviderEligibility(
  provider: ProviderPresentation,
  summary = providerSummary(provider),
): NewConversationProviderEligibility {
  if (summary.checking) {
    return {
      eligible: false,
      checking: true,
      label: `${provider.displayName} · 正在检查…`,
      summary,
    }
  }
  const supported =
    provider.capabilities.streaming && provider.capabilities.resume
  const eligible = provider.available && supported
  return {
    eligible,
    summary,
    label:
      !supported &&
      provider.available &&
      (!summary.advisory ||
        provider.executionHealth?.freshness === 'last_known')
        ? '此工具暂不支持创建可恢复的会话。'
        : (summary.advisory ?? summary.status?.label ?? summary.freshnessLabel),
    executionAdvisory: summary.advisory,
  }
}

/** A Provider must support both the live Turn path and durable native resume. */
export function executableConversationProviders(
  providers: readonly ProviderPresentation[],
): readonly ProviderPresentation[] {
  return providers.filter(
    (provider) => newConversationProviderEligibility(provider).eligible,
  )
}

/** Preserve an eligible choice, otherwise fall back to the first executable Provider. */
export function effectiveConversationProvider(
  selectedProvider: ProviderPresentation['provider'],
  providers: readonly ProviderPresentation[],
): ProviderPresentation | undefined {
  return (
    providers.find((provider) => provider.provider === selectedProvider) ??
    providers[0]
  )
}

export function effectiveProviderReasoning(
  selectedReasoning: string | undefined,
  provider: ProviderPresentation,
): string | undefined {
  return selectedReasoning !== undefined &&
    provider.reasoningOptions.some((option) => option.id === selectedReasoning)
    ? selectedReasoning
    : undefined
}

export function providerReasoningFromControl(
  value: string,
  provider: ProviderPresentation,
): string | undefined {
  if (value === providerDefaultReasoningSelection(provider)) return undefined
  return effectiveProviderReasoning(value, provider)
}

export function providerDefaultReasoningSelection(
  provider: ProviderPresentation,
): string {
  const optionIds = new Set(
    provider.reasoningOptions.map((option) => option.id),
  )
  let candidate = '__provider_default__'
  while (optionIds.has(candidate)) candidate += '_'
  return candidate
}
