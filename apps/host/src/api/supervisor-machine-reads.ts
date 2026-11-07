import type {
  GetMachineResponse,
  ListMachinesResponse,
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
  const response = {
    protocolVersion: detail.protocolVersion,
    machine: detail.machine,
    providers: detail.providers,
    connection: detail.connection,
    providerDiscovery: detail.providerDiscovery,
    relay: detail.relay,
  }
  if (supervisorJsonBytes(response) <= supervisorRowsByteBudget) return response

  const providers = detail.providers.map((provider) => ({
    provider: provider.provider,
    displayName: provider.displayName,
    availability: provider.availability,
    capabilities: provider.capabilities,
    executionHealth: provider.executionHealth,
    reasoningOptions: provider.reasoningOptions === undefined ? undefined : [],
  }))
  const compact = {
    ...response,
    providers,
    relay: undefined,
    [supervisorReadTruncated]: true,
  }
  const remaining = supervisorRowsByteBudget - supervisorJsonBytes(compact)
  // Reserve an equal share for each Provider so the first cannot consume the
  // second Provider's reasoning menu. Keep option IDs and order intact.
  const perProvider = Math.floor(remaining / Math.max(providers.length, 1))
  return {
    ...compact,
    providers: providers.map((provider, index) => {
      const options = detail.providers[index]?.reasoningOptions
      return options === undefined
        ? provider
        : {
            ...provider,
            reasoningOptions: boundedSupervisorRows(options, perProvider + 2),
          }
    }),
  }
}
