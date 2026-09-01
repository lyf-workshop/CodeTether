import type { ProviderPresentation } from '../../provider/provider-presentation.js'

export interface NewConversationProviderDefaults {
  readonly model?: string
  readonly reasoning?: string
}

/** A Provider must support both the live Turn path and durable native resume. */
export function executableConversationProviders(
  providers: readonly ProviderPresentation[],
): readonly ProviderPresentation[] {
  return providers.filter(
    (provider) =>
      provider.available &&
      provider.capabilities.streaming &&
      provider.capabilities.resume,
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
