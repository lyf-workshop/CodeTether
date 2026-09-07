import type { AgentProvider } from '@codetether/agent-core'
import type { ProviderDescriptor } from '@codetether/protocol'

import type {
  AgentHostRuntime,
  ProviderRuntimeInstallation,
} from './agent-runtime.js'

/**
 * Read-only runtime used when Codex cannot launch. Durable Host APIs remain
 * available while every provider mutation fails closed through capabilities.
 */
export class UnavailableAgentRuntime implements AgentHostRuntime {
  readonly provider: AgentProvider
  readonly descriptor?: ProviderDescriptor
  readonly available = false
  readonly installation?: ProviderRuntimeInstallation

  constructor(
    provider: AgentProvider = 'codex',
    descriptor?: ProviderDescriptor,
    installation?: ProviderRuntimeInstallation,
  ) {
    this.provider = provider
    this.descriptor = descriptor
    this.installation = installation
  }

  subscribeEvents(): () => void {
    return () => undefined
  }

  subscribeFailures(): () => void {
    return () => undefined
  }

  subscribeApprovals(): () => void {
    return () => undefined
  }

  async startConversation(): Promise<never> {
    throw unavailableError(this.provider)
  }

  async resumeConversation(): Promise<never> {
    throw unavailableError(this.provider)
  }

  async startTurn(): Promise<never> {
    throw unavailableError(this.provider)
  }

  async interruptTurn(): Promise<never> {
    throw unavailableError(this.provider)
  }

  async close(): Promise<void> {}
}

function unavailableError(provider: AgentProvider): Error {
  return new Error(
    `${provider === 'codex' ? 'Codex' : 'Claude Code'} is unavailable`,
  )
}
