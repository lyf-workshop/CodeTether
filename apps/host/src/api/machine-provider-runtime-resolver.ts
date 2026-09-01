import type { AgentProvider } from '@codetether/agent-core'
import { MachineIdSchema, type MachineId } from '@codetether/protocol'

import type { AgentHostRuntime } from './agent-runtime.js'
import type { ProviderRegistry } from './provider-registry.js'

export interface MachineProviderRuntimeResolverOptions {
  readonly localMachineId: MachineId
  readonly localProviders: ProviderRegistry
  readonly createRemoteCodex?: (
    machineId: MachineId,
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
  readonly #createRemoteCodex?: MachineProviderRuntimeResolverOptions['createRemoteCodex']
  readonly #remoteCodex = new Map<MachineId, AgentHostRuntime>()

  constructor(options: MachineProviderRuntimeResolverOptions) {
    this.#localMachineId = MachineIdSchema.parse(options.localMachineId)
    this.#localProviders = options.localProviders
    this.#createRemoteCodex = options.createRemoteCodex
  }

  get(
    machineId: MachineId,
    provider: AgentProvider,
  ): AgentHostRuntime | undefined {
    const machine = MachineIdSchema.parse(machineId)
    if (machine === this.#localMachineId) {
      return this.#localProviders.get(provider)
    }
    if (provider !== 'codex' || this.#createRemoteCodex === undefined) {
      return undefined
    }
    const existing = this.#remoteCodex.get(machine)
    if (existing !== undefined) return existing
    const created = this.#createRemoteCodex(machine)
    if (created === undefined) return undefined
    if (created.provider !== 'codex') {
      throw new Error('Remote Codex runtime factory returned another Provider')
    }
    this.#remoteCodex.set(machine, created)
    return created
  }

  existing(
    machineId: MachineId,
    provider: AgentProvider,
  ): AgentHostRuntime | undefined {
    const machine = MachineIdSchema.parse(machineId)
    return machine === this.#localMachineId
      ? this.#localProviders.get(provider)
      : provider === 'codex'
        ? this.#remoteCodex.get(machine)
        : undefined
  }

  remoteRuntimes(): readonly [MachineId, AgentHostRuntime][] {
    return [...this.#remoteCodex.entries()]
  }

  async close(): Promise<void> {
    const runtimes = [...this.#remoteCodex.values()]
    this.#remoteCodex.clear()
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
