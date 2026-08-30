import type { ProviderPresentation } from '../../provider/provider-presentation.js'

export interface NewConversationProviderDefaults {
  readonly model?: string
  readonly reasoning?: string
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
