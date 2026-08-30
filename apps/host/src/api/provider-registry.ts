import type { AgentProvider } from '@codetether/agent-core'
import type {
  ProviderCapabilities,
  ProviderDescriptor,
} from '@codetether/protocol'

import type { AgentHostRuntime } from './agent-runtime.js'

const providerOrder: readonly AgentProvider[] = ['codex', 'claude-code']

const codexCapabilities: ProviderCapabilities = {
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

const unavailableCapabilities: ProviderCapabilities = {
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
  readonly #descriptors = new Map<AgentProvider, ProviderDescriptor>()

  constructor(runtimes: readonly AgentHostRuntime[]) {
    for (const runtime of runtimes) {
      if (this.#runtimes.has(runtime.provider)) {
        throw new Error(`Provider ${runtime.provider} was registered twice`)
      }
      this.#runtimes.set(runtime.provider, runtime)
      this.#descriptors.set(
        runtime.provider,
        runtime.descriptor ?? fallbackDescriptor(runtime),
      )
    }
  }

  runtimes(): readonly AgentHostRuntime[] {
    return providerOrder.flatMap((provider) => {
      const runtime = this.#runtimes.get(provider)
      return runtime === undefined ? [] : [runtime]
    })
  }

  descriptors(): readonly ProviderDescriptor[] {
    return providerOrder.flatMap((provider) => {
      const descriptor = this.#descriptors.get(provider)
      return descriptor === undefined ? [] : [descriptor]
    })
  }

  get(provider: AgentProvider): AgentHostRuntime | undefined {
    return this.#runtimes.get(provider)
  }

  descriptor(provider: AgentProvider): ProviderDescriptor | undefined {
    return this.#descriptors.get(provider)
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
  provider: AgentProvider,
  providerThreadId: string,
): string {
  return JSON.stringify([provider, providerThreadId])
}

function fallbackDescriptor(runtime: AgentHostRuntime): ProviderDescriptor {
  const available = runtime.available !== false
  return {
    provider: runtime.provider,
    displayName: runtime.provider === 'codex' ? 'Codex' : 'Claude Code',
    availability: available ? 'available' : 'unavailable',
    capabilities: available
      ? runtime.provider === 'codex'
        ? codexCapabilities
        : unavailableCapabilities
      : unavailableCapabilities,
  }
}
