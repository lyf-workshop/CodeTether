import type { AgentProvider } from '@codetether/agent-core'
import type {
  MachineProviderLifecycle,
  MachineId,
  ProviderCapabilities,
  ProviderDescriptor,
} from '@codetether/protocol'

import type { AgentHostRuntime } from './agent-runtime.js'

const providerOrder: readonly AgentProvider[] = ['codex', 'claude-code']

export const LOCAL_CODEX_CAPABILITIES: ProviderCapabilities = {
  streaming: true,
  resume: true,
  interrupt: true,
  approvals: true,
  fileRead: true,
  fileEdit: true,
  shell: true,
  search: true,
  diff: true,
  toolEvents: true,
  modelSelection: true,
  reasoningControl: true,
}

export const UNAVAILABLE_PROVIDER_CAPABILITIES: ProviderCapabilities = {
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

/** Host-owned lookup for the bounded set of installed Provider adapters. */
export class ProviderRegistry {
  readonly #runtimes = new Map<AgentProvider, AgentHostRuntime>()
  readonly #lifecycles = new Map<AgentProvider, MachineProviderLifecycle>()

  constructor(
    runtimes: readonly AgentHostRuntime[],
    lifecycles: readonly MachineProviderLifecycle[] = [],
  ) {
    for (const runtime of runtimes) {
      if (this.#runtimes.has(runtime.provider)) {
        throw new Error(`Provider ${runtime.provider} was registered twice`)
      }
      this.#runtimes.set(runtime.provider, runtime)
    }
    for (const lifecycle of lifecycles) this.setLifecycle(lifecycle)
  }

  runtimes(): readonly AgentHostRuntime[] {
    return providerOrder.flatMap((provider) => {
      const runtime = this.#runtimes.get(provider)
      return runtime === undefined ? [] : [runtime]
    })
  }

  descriptors(): readonly ProviderDescriptor[] {
    return providerOrder.flatMap((provider) => {
      const runtime = this.#runtimes.get(provider)
      return runtime === undefined
        ? []
        : [runtime.descriptor ?? fallbackDescriptor(runtime)]
    })
  }

  get(provider: AgentProvider): AgentHostRuntime | undefined {
    return this.#runtimes.get(provider)
  }

  descriptor(provider: AgentProvider): ProviderDescriptor | undefined {
    const runtime = this.#runtimes.get(provider)
    return (
      runtime?.descriptor ??
      (runtime === undefined ? undefined : fallbackDescriptor(runtime))
    )
  }

  lifecycles(): readonly MachineProviderLifecycle[] {
    return providerOrder.flatMap((provider) => {
      const lifecycle = this.#lifecycles.get(provider)
      return lifecycle === undefined ? [] : [lifecycle]
    })
  }

  lifecycle(provider: AgentProvider): MachineProviderLifecycle | undefined {
    return this.#lifecycles.get(provider)
  }

  setLifecycle(lifecycle: MachineProviderLifecycle): void {
    const runtime = this.#runtimes.get(lifecycle.provider)
    const selected = lifecycle.installations.find(
      ({ installationId }) =>
        installationId === lifecycle.selectedInstallationId,
    )
    if (
      runtime?.installation !== undefined &&
      (selected?.installationId !== runtime.installation.installationId ||
        selected.revision !== runtime.installation.installationRevision)
    ) {
      throw new Error(
        `Provider ${lifecycle.provider} lifecycle does not match its runtime installation`,
      )
    }
    this.#lifecycles.set(lifecycle.provider, lifecycle)
  }

  /**
   * Replaces only a locally unavailable assembly placeholder. This is used by
   * an explicit Turn-start recovery probe after the user repairs the Provider
   * environment; a live runtime can never be displaced or switched.
   */
  replace(previous: AgentHostRuntime, runtime: AgentHostRuntime): void {
    if (
      previous.provider !== runtime.provider ||
      this.#runtimes.get(runtime.provider) !== previous
    ) {
      throw new Error(
        `Provider ${runtime.provider} runtime changed during replacement`,
      )
    }
    this.#runtimes.set(runtime.provider, runtime)
  }

  /**
   * Atomically changes an idle local runtime and its selected-installation
   * projection after the Host lifecycle authority has revalidated a changed
   * executable revision. Callers must settle active work before invoking it.
   */
  replaceWithLifecycle(
    previous: AgentHostRuntime,
    runtime: AgentHostRuntime,
    lifecycle: MachineProviderLifecycle,
  ): void {
    this.assertReplacementWithLifecycle(previous, runtime, lifecycle)
    this.#runtimes.set(runtime.provider, runtime)
    this.#lifecycles.set(runtime.provider, lifecycle)
  }

  /** Validates a staged handoff before the currently-owned runtime is closed. */
  assertReplacementWithLifecycle(
    previous: AgentHostRuntime,
    runtime: AgentHostRuntime,
    lifecycle: MachineProviderLifecycle,
  ): void {
    if (
      previous.provider !== runtime.provider ||
      lifecycle.provider !== runtime.provider ||
      this.#runtimes.get(runtime.provider) !== previous
    ) {
      throw new Error('Provider lifecycle replacement identity changed')
    }
    const selected = lifecycle.installations.find(
      ({ installationId }) =>
        installationId === lifecycle.selectedInstallationId,
    )
    const unavailableWithoutSelection =
      runtime.available === false &&
      runtime.installation === undefined &&
      selected === undefined &&
      lifecycle.selectedInstallationId === undefined
    const exactSelectedInstallation =
      runtime.installation !== undefined &&
      selected?.installationId === runtime.installation.installationId &&
      selected.revision === runtime.installation.installationRevision
    if (!unavailableWithoutSelection && !exactSelectedInstallation) {
      throw new Error(
        'Replacement runtime does not match selected installation',
      )
    }
  }

  async close(): Promise<void> {
    const results = await Promise.allSettled(
      this.runtimes().map(async (runtime) => await runtime.close()),
    )
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    )
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) {
      throw new AggregateError(failures, 'Provider registry shutdown failed')
    }
  }
}

export function providerSessionKey(
  machineId: MachineId,
  provider: AgentProvider,
  providerThreadId: string,
): string {
  return JSON.stringify([machineId, provider, providerThreadId])
}

function fallbackDescriptor(runtime: AgentHostRuntime): ProviderDescriptor {
  const available = runtime.available !== false
  return {
    provider: runtime.provider,
    displayName: runtime.provider === 'codex' ? 'Codex' : 'Claude Code',
    availability: available ? 'available' : 'unavailable',
    capabilities: available
      ? runtime.provider === 'codex'
        ? LOCAL_CODEX_CAPABILITIES
        : UNAVAILABLE_PROVIDER_CAPABILITIES
      : UNAVAILABLE_PROVIDER_CAPABILITIES,
  }
}
