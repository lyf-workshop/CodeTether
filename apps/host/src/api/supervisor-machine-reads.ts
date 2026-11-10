import type {
  AvailableProviderModel,
  GetMachineResponse,
  ListMachinesResponse,
  ProviderReasoningOption,
  RefreshConversationModelsResponse,
} from '@codetether/protocol'
import {
  supervisorPublicJwkSchema,
  supervisorReadTruncated,
} from '@codetether/supervisor-transport'

import type { DurableHostIdentity } from '../persistence/host-identity.js'
import {
  boundedSupervisorRows,
  supervisorJsonBytes,
  supervisorRowsByteBudget,
  truncateSupervisorText,
} from '../supervisor-read-budget.js'

const supervisorModelLimit = 50

export function supervisorBootstrap(identity: DurableHostIdentity) {
  const platform =
    identity.platform === undefined
      ? undefined
      : truncateSupervisorText(identity.platform, 512)
  const appVersion =
    identity.appVersion === undefined
      ? undefined
      : truncateSupervisorText(identity.appVersion, 512)
  return {
    protocolVersion: 1 as const,
    identity: {
      hostId: identity.hostId,
      publicJwk: JSON.stringify(
        supervisorPublicJwkSchema.parse(JSON.parse(identity.publicJwk)),
      ),
      fingerprint: identity.fingerprint,
      keyAlgorithm: identity.keyAlgorithm,
      identityGeneration: identity.identityGeneration,
      safeLabel: identity.safeLabel,
      platform,
      appVersion,
      createdAt: compactIdentityTimestamp(identity.createdAt),
      updatedAt: compactIdentityTimestamp(identity.updatedAt),
      lastRegisteredAt: compactIdentityTimestamp(identity.lastRegisteredAt),
    },
    ...(platform !== identity.platform || appVersion !== identity.appVersion
      ? { truncated: true }
      : {}),
  }
}

function compactIdentityTimestamp(
  value: string | undefined,
): string | undefined {
  if (value === undefined || supervisorJsonBytes(value) <= 128) return value
  const instant = new Date(value)
  return Number.isNaN(instant.getTime()) ? undefined : instant.toISOString()
}

export function supervisorMachineList({
  protocolVersion,
  machines,
}: ListMachinesResponse) {
  // The Host registry orders the local machine first, then stable remote IDs.
  const bounded = boundedSupervisorRows(machines)
  return {
    protocolVersion,
    machines: bounded,
    ...(bounded.length < machines.length
      ? { [supervisorReadTruncated]: true }
      : {}),
  }
}

export function supervisorMachineDetail(detail: GetMachineResponse) {
  // Provider lifecycle installations and the local Project/Conversation
  // collections are outside the remote machine projection.
  const providersWithCappedModels = detail.providers.map((provider) => ({
    ...provider,
    availableModels: provider.availableModels?.slice(0, supervisorModelLimit),
  }))
  const modelCountCapped = detail.providers.some(
    (provider) =>
      (provider.availableModels?.length ?? 0) > supervisorModelLimit,
  )
  const response = {
    protocolVersion: detail.protocolVersion,
    machine: detail.machine,
    providers: providersWithCappedModels,
    connection: detail.connection,
    providerDiscovery: detail.providerDiscovery,
    relay: detail.relay,
  }
  const cappedResponse = modelCountCapped
    ? {
        ...response,
        _truncated: true as const,
        [supervisorReadTruncated]: true,
      }
    : response
  if (supervisorJsonBytes(cappedResponse) <= supervisorRowsByteBudget)
    return cappedResponse

  const providers = detail.providers.map((provider) => ({
    provider: provider.provider,
    displayName: provider.displayName,
    availability: provider.availability,
    capabilities: provider.capabilities,
    executionHealth: provider.executionHealth,
    reasoningOptions:
      provider.reasoningOptions === undefined
        ? undefined
        : ([] as ProviderReasoningOption[]),
    availableModels:
      provider.availableModels === undefined
        ? undefined
        : ([] as AvailableProviderModel[]),
  }))
  const compact = {
    ...response,
    providers,
    relay: undefined,
    _truncated: true as const,
    [supervisorReadTruncated]: true,
  }
  const minimumBytes = supervisorJsonBytes(compact)
  if (minimumBytes > supervisorRowsByteBudget) {
    throw new RangeError('Supervisor machine detail exceeds the frame budget')
  }
  // Give each Provider a fair share of the remaining frame. Reasoning options
  // retain a small reserve while the selectable model catalog gets priority.
  const perProvider = Math.floor(
    (supervisorRowsByteBudget - minimumBytes) / Math.max(providers.length, 1),
  )
  for (const [index, provider] of providers.entries()) {
    const original = detail.providers[index]
    if (original === undefined) continue
    let used = 0
    let currentBytes = supervisorJsonBytes(compact)
    const append = <T>(
      target: T[] | undefined,
      rows: readonly T[],
      cap: number,
    ) => {
      if (target === undefined) return 0
      let added = 0
      for (const row of rows) {
        target.push(row)
        const nextBytes = supervisorJsonBytes(compact)
        const difference = nextBytes - currentBytes
        if (used + difference > cap || nextBytes > supervisorRowsByteBudget) {
          target.pop()
          break
        }
        used += difference
        currentBytes = nextBytes
        added += 1
      }
      return added
    }
    const reasoningOptions = original.reasoningOptions ?? []
    const initialReasoning = append(
      provider.reasoningOptions,
      reasoningOptions,
      Math.floor(perProvider / 3),
    )
    append(
      provider.availableModels,
      original.availableModels?.slice(0, supervisorModelLimit) ?? [],
      perProvider,
    )
    append(
      provider.reasoningOptions,
      reasoningOptions.slice(initialReasoning),
      perProvider,
    )
  }
  return compact
}

export function supervisorModelCatalog(
  response: RefreshConversationModelsResponse,
) {
  const models = response.provider.availableModels
  const cappedModels = models?.slice(0, supervisorModelLimit)
  const countCapped = (models?.length ?? 0) > supervisorModelLimit
  const capped = {
    ...response,
    provider: { ...response.provider, availableModels: cappedModels },
    ...(countCapped ? { _truncated: true as const } : {}),
  }
  if (supervisorJsonBytes(capped) <= supervisorRowsByteBudget) return capped

  const provider = {
    provider: response.provider.provider,
    displayName: response.provider.displayName,
    availability: response.provider.availability,
    capabilities: response.provider.capabilities,
    reasoningOptions:
      response.provider.reasoningOptions === undefined
        ? undefined
        : ([] as ProviderReasoningOption[]),
    availableModels: [] as AvailableProviderModel[],
  }
  const compact = {
    protocolVersion: response.protocolVersion,
    provider,
    _truncated: true as const,
  }
  if (supervisorJsonBytes(compact) > supervisorRowsByteBudget) {
    throw new RangeError('Supervisor model catalog exceeds the frame budget')
  }
  const minimumBytes = supervisorJsonBytes(compact)
  const reasoningBudget = Math.floor(
    (supervisorRowsByteBudget - minimumBytes) / 3,
  )
  for (const option of response.provider.reasoningOptions ?? []) {
    provider.reasoningOptions?.push(option)
    if (supervisorJsonBytes(compact) > minimumBytes + reasoningBudget) {
      provider.reasoningOptions?.pop()
      break
    }
  }
  for (const model of cappedModels ?? []) {
    provider.availableModels.push(model)
    if (supervisorJsonBytes(compact) > supervisorRowsByteBudget) {
      provider.availableModels.pop()
      break
    }
  }
  for (const option of (response.provider.reasoningOptions ?? []).slice(
    provider.reasoningOptions?.length ?? 0,
  )) {
    provider.reasoningOptions?.push(option)
    if (supervisorJsonBytes(compact) > supervisorRowsByteBudget) {
      provider.reasoningOptions?.pop()
      break
    }
  }
  return compact
}
