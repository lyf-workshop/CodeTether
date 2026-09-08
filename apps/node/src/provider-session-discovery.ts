import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

import {
  ClaudeCodeOwnedProcessCleanupError,
  ClaudeSessionDiscovery,
} from '@codetether/adapter-claude'
import {
  CodexOwnedProcessCleanupError,
  CodexSessionDiscovery,
} from '@codetether/adapter-codex'
import type {
  AgentProvider,
  NativeProviderSessionCandidate,
  ProviderSessionDiscovery,
  ProviderSessionDiscoveryPage,
} from '@codetether/agent-core'
import type {
  ProviderInstallationId,
  ProviderInstallationRevision,
} from '@codetether/machine-transport'
import { machineTransportLimits } from '@codetether/machine-transport'

import { spawnNodeProviderProcess } from './provider-process-guardian.js'
import type { NodeProviderLifecycleCoordinator } from './provider-lifecycle.js'
import { armAbortDeadline } from './shared-abortable-operation.js'

export interface RemoteProviderSessionDiscoveryRegistryOptions {
  readonly discoveries?: readonly ProviderSessionDiscovery[]
  /** Node lifecycle environment snapshot; never supplied by Machine input. */
  readonly environment?: NodeJS.ProcessEnv
  /** Shared exact-installation authority used by production discovery. */
  readonly providerLifecycle?: NodeProviderLifecycleCoordinator
  /** Internal deterministic-test seam; Machine input cannot set this bound. */
  readonly discoveryWorkTimeoutMs?: number
}

/** Machine-local, read-only Provider metadata boundary. */
export class RemoteProviderSessionDiscoveryRegistry {
  readonly #discoveries = new Map<AgentProvider, ProviderSessionDiscovery>()
  readonly #providerLifecycle?: NodeProviderLifecycleCoordinator
  readonly #discoveryWorkTimeoutMs: number

  constructor(options: RemoteProviderSessionDiscoveryRegistryOptions = {}) {
    const environment = options.environment ?? process.env
    this.#providerLifecycle = options.providerLifecycle
    this.#discoveryWorkTimeoutMs =
      options.discoveryWorkTimeoutMs ??
      machineTransportLimits.providerSessionDiscoveryWorkTimeoutMs
    if (
      !Number.isSafeInteger(this.#discoveryWorkTimeoutMs) ||
      this.#discoveryWorkTimeoutMs <= 0
    ) {
      throw new TypeError('Provider session discovery timeout is invalid')
    }
    const discoveries = options.discoveries ?? [
      new CodexSessionDiscovery({
        codexHome: nodeCodexHome(environment),
        processFactory: (specification) =>
          spawnNodeProviderProcess({
            provider: 'codex',
            ...specification,
          }),
      }),
      new ClaudeSessionDiscovery({ environment }),
    ]
    for (const discovery of discoveries) {
      if (this.#discoveries.has(discovery.provider)) {
        throw new TypeError(
          `Duplicate Provider session discovery adapter: ${discovery.provider}`,
        )
      }
      this.#discoveries.set(discovery.provider, discovery)
    }
  }

  async discover(input: {
    readonly provider: AgentProvider
    readonly providerInstallationId: ProviderInstallationId
    readonly expectedInstallationRevision: ProviderInstallationRevision
    readonly projectRoot: string
    readonly cursor?: string
    readonly limit: number
    readonly signal?: AbortSignal
  }): Promise<ProviderSessionDiscoveryPage> {
    try {
      const discovery = await this.#discoveryFor(input)
      if (discovery === undefined) return unsupported(input.provider)
      const deadlineAbort = new AbortController()
      const deadline = armAbortDeadline(
        deadlineAbort,
        this.#discoveryWorkTimeoutMs,
      )
      const signal =
        input.signal === undefined
          ? deadlineAbort.signal
          : AbortSignal.any([input.signal, deadlineAbort.signal])
      try {
        return await discovery.discover({
          projectRoot: input.projectRoot,
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
          limit: input.limit,
          signal,
        })
      } catch (error) {
        if (isOwnedProcessCleanupFailure(error)) throw error
        if (deadline.expired() && input.signal?.aborted !== true) {
          return unavailable(input.provider)
        }
        throw error
      } finally {
        deadline.clear()
      }
    } catch (error) {
      throw this.#preserveCleanupFailure(input.provider, error)
    }
  }

  async validateCandidate(input: {
    readonly provider: AgentProvider
    readonly providerInstallationId: ProviderInstallationId
    readonly expectedInstallationRevision: ProviderInstallationRevision
    readonly projectRoot: string
    readonly nativeSessionId: string
    readonly revision: string
    readonly signal?: AbortSignal
  }): Promise<NativeProviderSessionCandidate | undefined> {
    try {
      const discovery = await this.#discoveryFor(input)
      if (discovery === undefined) return undefined
      const deadlineAbort = new AbortController()
      const deadline = armAbortDeadline(
        deadlineAbort,
        this.#discoveryWorkTimeoutMs,
      )
      const signal =
        input.signal === undefined
          ? deadlineAbort.signal
          : AbortSignal.any([input.signal, deadlineAbort.signal])
      try {
        return await discovery.validateCandidate({
          projectRoot: input.projectRoot,
          nativeSessionId: input.nativeSessionId,
          revision: input.revision,
          signal,
        })
      } catch (error) {
        if (isOwnedProcessCleanupFailure(error)) throw error
        if (deadline.expired() && input.signal?.aborted !== true) {
          return undefined
        }
        throw error
      } finally {
        deadline.clear()
      }
    } catch (error) {
      throw this.#preserveCleanupFailure(input.provider, error)
    }
  }

  #preserveCleanupFailure(provider: AgentProvider, error: unknown): unknown {
    if (
      this.#providerLifecycle !== undefined &&
      isOwnedProcessCleanupFailure(error)
    ) {
      return this.#providerLifecycle.latchOwnedProcessCleanupFailure(
        provider,
        error,
      )
    }
    return error
  }

  async #discoveryFor(input: {
    readonly provider: AgentProvider
    readonly providerInstallationId: ProviderInstallationId
    readonly expectedInstallationRevision: ProviderInstallationRevision
    readonly signal?: AbortSignal
  }): Promise<ProviderSessionDiscovery | undefined> {
    if (this.#providerLifecycle === undefined) {
      return this.#discoveries.get(input.provider)
    }
    const selected = await this.#providerLifecycle.resolveSelected(
      input.provider,
      input.providerInstallationId,
      input.expectedInstallationRevision,
      input.signal,
    )
    if (
      selected.compatibility.capabilities.nativeSessionDiscovery.effective !==
      true
    ) {
      return undefined
    }
    return selected.provider === 'codex'
      ? new CodexSessionDiscovery({
          executable: selected.executable,
          codexHome: nodeCodexHome(selected.environment),
          environment: selected.environment,
          providerVersion: selected.version,
          processFactory: (specification) =>
            spawnNodeProviderProcess({
              provider: 'codex',
              ...specification,
            }),
        })
      : new ClaudeSessionDiscovery({
          environment: selected.environment,
          providerVersion: selected.version,
        })
  }
}

function isOwnedProcessCleanupFailure(
  error: unknown,
): error is CodexOwnedProcessCleanupError | ClaudeCodeOwnedProcessCleanupError {
  return (
    error instanceof CodexOwnedProcessCleanupError ||
    error instanceof ClaudeCodeOwnedProcessCleanupError
  )
}

function nodeCodexHome(environment: NodeJS.ProcessEnv): string {
  const configured = environment.CODEX_HOME
  return configured !== undefined && isAbsolute(configured)
    ? configured
    : join(nodeHome(environment), '.codex')
}

function nodeHome(environment: NodeJS.ProcessEnv): string {
  return (
    environment.HOME?.trim() || environment.USERPROFILE?.trim() || homedir()
  )
}

function unsupported(provider: AgentProvider): ProviderSessionDiscoveryPage {
  return {
    provider,
    status: 'unsupported',
    resumeStatus: 'unsupported',
    candidates: [],
    failureReason: 'provider_session_discovery_unavailable',
    metrics: {
      filesInspected: 0,
      candidatesParsed: 0,
      candidatesMatched: 0,
      corruptEntriesSkipped: 0,
      elapsedMs: 0,
      truncated: false,
    },
  }
}

function unavailable(provider: AgentProvider): ProviderSessionDiscoveryPage {
  return {
    ...unsupported(provider),
    status: 'unavailable',
    resumeStatus: 'unavailable',
  }
}
