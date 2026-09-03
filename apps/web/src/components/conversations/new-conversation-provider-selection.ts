import {
  providerExecutionHealthPresentation,
  type ProviderPresentation,
} from '../../provider/provider-presentation.js'

export interface NewConversationProviderDefaults {
  readonly model?: string
  readonly reasoning?: string
}

export interface NewConversationProviderEligibility {
  readonly eligible: boolean
  readonly label: string
  readonly executionLabel?: string
  readonly executionAdvisory?: string
}

/** Installation/capabilities gate selection; recent runtime health stays advisory. */
export function newConversationProviderEligibility(
  provider: ProviderPresentation,
): NewConversationProviderEligibility {
  if (!provider.available) {
    return {
      eligible: false,
      label: `${provider.displayName} · ${provider.availabilityLabel}`,
    }
  }

  const health = providerExecutionHealthPresentation(
    provider.executionHealth,
    provider.displayName,
  )
  const currentFailure =
    provider.executionHealth?.freshness === 'current'
      ? provider.executionHealth.failure
      : undefined
  if (!provider.capabilities.streaming || !provider.capabilities.resume) {
    if (currentFailure !== undefined) {
      return {
        eligible: false,
        label: `${provider.displayName} · ${provider.availabilityLabel}`,
        executionLabel: `${health.stateLabel} · ${health.freshnessLabel}`,
        executionAdvisory: `${health.description} 完成所需操作并通过现有刷新流程重新验证后，才能选择此智能体。`,
      }
    }
    return {
      eligible: false,
      label: `${provider.displayName} · 不支持流式会话与原生恢复`,
    }
  }

  const healthIsCurrentAndHealthy =
    provider.executionHealth?.state === 'healthy' &&
    provider.executionHealth.freshness === 'current'
  return {
    eligible: true,
    label: `${provider.displayName} · ${provider.availabilityLabel}`,
    ...(provider.executionHealth === undefined
      ? {}
      : {
          executionLabel: `${health.stateLabel} · ${health.freshnessLabel}`,
        }),
    ...(provider.executionHealth === undefined || healthIsCurrentAndHealthy
      ? {}
      : {
          executionAdvisory: `${health.stateLabel} · ${health.freshnessLabel}。${health.description} 这是最近一次观测；新会话的首个明确轮次会重新验证，不会重发任何旧请求。`,
        }),
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

export function defaultProviderControls(
  provider: ProviderPresentation,
): NewConversationProviderDefaults {
  const model = defaultProviderModel(provider)
  return {
    ...(model === undefined ? {} : { model }),
  }
}

export function defaultProviderModel(
  provider: ProviderPresentation,
): string | undefined {
  return (
    provider.models.find((model) => model.isDefault === true) ??
    provider.models[0]
  )?.id
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
