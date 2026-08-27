import type { AgentHostRuntime } from './agent-runtime.js'

/**
 * Read-only runtime used when Codex cannot launch. Durable Host APIs remain
 * available while every provider mutation fails closed through capabilities.
 */
export class UnavailableAgentRuntime implements AgentHostRuntime {
  readonly provider = 'codex'
  readonly available = false

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
    throw unavailableError()
  }

  async resumeConversation(): Promise<never> {
    throw unavailableError()
  }

  async startTurn(): Promise<never> {
    throw unavailableError()
  }

  async interruptTurn(): Promise<never> {
    throw unavailableError()
  }

  async close(): Promise<void> {}
}

function unavailableError(): Error {
  return new Error('Codex runtime is unavailable')
}
