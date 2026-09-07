import type { AgentProvider } from '@codetether/agent-core'
import { MachineIdSchema, type MachineId } from '@codetether/protocol'

import type {
  AgentHostRuntime,
  ProviderRuntimeInstallation,
} from './agent-runtime.js'
import type { ProviderRegistry } from './provider-registry.js'

export interface MachineProviderRuntimeResolverOptions {
  readonly localMachineId: MachineId
  readonly localProviders: ProviderRegistry
  readonly createRemoteProvider?: (
    machineId: MachineId,
    provider: AgentProvider,
    installation?: ProviderRuntimeInstallation,
  ) => AgentHostRuntime | undefined
}

/**
 * Resolves execution ownership by Machine before Provider. Local adapters stay
 * in ProviderRegistry; remote adapters are exact per-Machine instances and
 * never become global Provider availability.
 */
export class MachineProviderRuntimeResolver {
  readonly #localMachineId: MachineId
  readonly #localProviders: ProviderRegistry
  readonly #createRemoteProvider?: MachineProviderRuntimeResolverOptions['createRemoteProvider']
  readonly #remoteProviders = new Map<
    string,
    { readonly machineId: MachineId; readonly runtime: AgentHostRuntime }
  >()

  constructor(options: MachineProviderRuntimeResolverOptions) {
    this.#localMachineId = MachineIdSchema.parse(options.localMachineId)
    this.#localProviders = options.localProviders
    this.#createRemoteProvider = options.createRemoteProvider
  }

  get(
    machineId: MachineId,
    provider: AgentProvider,
    installation?: ProviderRuntimeInstallation,
  ): AgentHostRuntime | undefined {
    const machine = MachineIdSchema.parse(machineId)
    if (machine === this.#localMachineId) {
      return this.#localProviders.get(provider)
    }
    if (this.#createRemoteProvider === undefined) return undefined
    const key = machineProviderKey(machine, provider, installation)
    const existing = this.#remoteProviders.get(key)?.runtime
    if (existing !== undefined) return existing
    const created = this.#createRemoteProvider(machine, provider, installation)
    if (created === undefined) return undefined
    if (created.provider !== provider) {
      throw new Error('Remote runtime factory returned another Provider')
    }
    if (
      installation !== undefined &&
      (created.installation?.installationId !== installation.installationId ||
        created.installation.installationRevision !==
          installation.installationRevision)
    ) {
      throw new Error('Remote runtime factory returned another installation')
    }
    this.#remoteProviders.set(key, { machineId: machine, runtime: created })
    return created
  }

  existing(
    machineId: MachineId,
    provider: AgentProvider,
    installation?: ProviderRuntimeInstallation,
  ): AgentHostRuntime | undefined {
    const machine = MachineIdSchema.parse(machineId)
    return machine === this.#localMachineId
      ? this.#localProviders.get(provider)
      : this.#remoteProviders.get(
          machineProviderKey(machine, provider, installation),
        )?.runtime
  }

  /** Finds the one exact runtime that currently owns a native session. */
  existingSession(
    machineId: MachineId,
    provider: AgentProvider,
    installationId: ProviderRuntimeInstallation['installationId'] | undefined,
    providerThreadId: string,
  ): AgentHostRuntime | undefined {
    const machine = MachineIdSchema.parse(machineId)
    if (machine === this.#localMachineId) {
      const local = this.#localProviders.get(provider)
      if (local === undefined) return undefined
      // Local Providers have one selected runtime per Provider. Older runtime
      // implementations do not expose the optional ownership predicate, so
      // preserve the frozen single-owner contract in that case. When the
      // predicate exists, a definite false still prevents disposing a session
      // that this exact runtime does not own.
      return local.hasConversationSession === undefined ||
        local.hasConversationSession(providerThreadId)
        ? local
        : undefined
    }
    const owners = [...this.#remoteProviders.values()]
      .filter(
        ({ machineId: candidateMachineId, runtime }) =>
          candidateMachineId === machine &&
          runtime.provider === provider &&
          (installationId === undefined ||
            runtime.installation?.installationId === installationId) &&
          (runtime.ownsConversationSession?.(providerThreadId) ??
            runtime.hasConversationSession?.(providerThreadId)) === true,
      )
      .map(({ runtime }) => runtime)
    if (owners.length > 1) {
      throw new Error('Provider session has multiple installation owners')
    }
    return owners[0]
  }

  /** Retires only an already-idle exact runtime; active/opening work is pinned. */
  async retireIfIdle(runtime: AgentHostRuntime): Promise<boolean> {
    const entry = [...this.#remoteProviders.entries()].find(
      ([, candidate]) => candidate.runtime === runtime,
    )
    if (entry === undefined || runtime.canRetireInstallation?.() !== true) {
      return false
    }
    this.#remoteProviders.delete(entry[0])
    await runtime.close()
    return true
  }

  /**
   * Retires idle cached revisions of the same logical installation. An active,
   * opening, or session-owning runtime stays pinned until its exact owner is
   * released; alternate logical installations are never touched.
   */
  async retireObsoleteIdle(
    machineId: MachineId,
    provider: AgentProvider,
    current: ProviderRuntimeInstallation,
  ): Promise<number> {
    const machine = MachineIdSchema.parse(machineId)
    if (machine === this.#localMachineId) return 0
    const obsolete = [...this.#remoteProviders.entries()].filter(
      ([, candidate]) =>
        candidate.machineId === machine &&
        candidate.runtime.provider === provider &&
        candidate.runtime.installation?.installationId ===
          current.installationId &&
        candidate.runtime.installation.installationRevision !==
          current.installationRevision &&
        candidate.runtime.canRetireInstallation?.() === true,
    )
    for (const [key] of obsolete) this.#remoteProviders.delete(key)
    const results = await Promise.allSettled(
      obsolete.map(async ([, candidate]) => await candidate.runtime.close()),
    )
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    )
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) {
      throw new AggregateError(
        failures,
        'Obsolete Provider runtime retirement failed',
      )
    }
    return obsolete.length
  }

  remoteRuntimes(): readonly [MachineId, AgentHostRuntime][] {
    return [...this.#remoteProviders.values()].map(({ machineId, runtime }) => [
      machineId,
      runtime,
    ])
  }

  async close(): Promise<void> {
    const runtimes = [...this.#remoteProviders.values()].map(
      ({ runtime }) => runtime,
    )
    this.#remoteProviders.clear()
    const results = await Promise.allSettled(
      runtimes.map(async (runtime) => await runtime.close()),
    )
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    )
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) {
      throw new AggregateError(failures, 'Remote Provider shutdown failed')
    }
  }
}

function machineProviderKey(
  machineId: MachineId,
  provider: AgentProvider,
  installation?: ProviderRuntimeInstallation,
): string {
  return JSON.stringify([
    machineId,
    provider,
    installation?.installationId ?? null,
    installation?.installationRevision ?? null,
  ])
}
