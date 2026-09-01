import type { AgentProvider } from '@codetether/agent-core'
import { MachineIdSchema, type MachineId } from '@codetether/protocol'

import type { AgentHostRuntime } from './agent-runtime.js'
import type { ProviderRegistry } from './provider-registry.js'

export interface MachineProviderRuntimeResolverOptions {
  readonly localMachineId: MachineId
  readonly localProviders: ProviderRegistry
  readonly createRemoteProvider?: (
    machineId: MachineId,
    provider: AgentProvider,
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
  ): AgentHostRuntime | undefined {
    const machine = MachineIdSchema.parse(machineId)
    if (machine === this.#localMachineId) {
      return this.#localProviders.get(provider)
    }
    if (this.#createRemoteProvider === undefined) return undefined
    const key = machineProviderKey(machine, provider)
    const existing = this.#remoteProviders.get(key)?.runtime
    if (existing !== undefined) return existing
    const created = this.#createRemoteProvider(machine, provider)
    if (created === undefined) return undefined
    if (created.provider !== provider) {
      throw new Error('Remote runtime factory returned another Provider')
    }
    this.#remoteProviders.set(key, { machineId: machine, runtime: created })
    return created
  }

  existing(
    machineId: MachineId,
    provider: AgentProvider,
  ): AgentHostRuntime | undefined {
    const machine = MachineIdSchema.parse(machineId)
    return machine === this.#localMachineId
      ? this.#localProviders.get(provider)
      : this.#remoteProviders.get(machineProviderKey(machine, provider))
          ?.runtime
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
): string {
  return JSON.stringify([machineId, provider])
}
