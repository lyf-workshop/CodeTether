import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

import { ClaudeSessionDiscovery } from '@codetether/adapter-claude'
import { CodexSessionDiscovery } from '@codetether/adapter-codex'
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

import { spawnNodeProviderProcess } from './provider-process-guardian.js'
import type { NodeProviderLifecycleCoordinator } from './provider-lifecycle.js'

export interface RemoteProviderSessionDiscoveryRegistryOptions {
  readonly discoveries?: readonly ProviderSessionDiscovery[]
  /** Node lifecycle environment snapshot; never supplied by Machine input. */
  readonly environment?: NodeJS.ProcessEnv
  /** Shared exact-installation authority used by production discovery. */
  readonly providerLifecycle?: NodeProviderLifecycleCoordinator
}

/** Machine-local, read-only Provider metadata boundary. */
export class RemoteProviderSessionDiscoveryRegistry {
  readonly #discoveries = new Map<AgentProvider, ProviderSessionDiscovery>()
  readonly #providerLifecycle?: NodeProviderLifecycleCoordinator

  constructor(options: RemoteProviderSessionDiscoveryRegistryOptions = {}) {
    const environment = options.environment ?? process.env
    this.#providerLifecycle = options.providerLifecycle
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
    const discovery = await this.#discoveryFor(input)
    if (discovery === undefined) return unsupported(input.provider)
    return await discovery.discover({
      projectRoot: input.projectRoot,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      limit: input.limit,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
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
    const discovery = await this.#discoveryFor(input)
    if (discovery === undefined) return undefined
    return await discovery.validateCandidate({
      projectRoot: input.projectRoot,
      nativeSessionId: input.nativeSessionId,
      revision: input.revision,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
  }

  async #discoveryFor(input: {
    readonly provider: AgentProvider
    readonly providerInstallationId: ProviderInstallationId
    readonly expectedInstallationRevision: ProviderInstallationRevision
  }): Promise<ProviderSessionDiscovery | undefined> {
    if (this.#providerLifecycle === undefined) {
      return this.#discoveries.get(input.provider)
    }
    const selected = await this.#providerLifecycle.resolveSelected(
      input.provider,
      input.providerInstallationId,
      input.expectedInstallationRevision,
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
