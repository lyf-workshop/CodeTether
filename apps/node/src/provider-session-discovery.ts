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

import { spawnNodeProviderProcess } from './provider-process-guardian.js'

export interface RemoteProviderSessionDiscoveryRegistryOptions {
  readonly discoveries?: readonly ProviderSessionDiscovery[]
}

/** Machine-local, read-only Provider metadata boundary. */
export class RemoteProviderSessionDiscoveryRegistry {
  readonly #discoveries = new Map<AgentProvider, ProviderSessionDiscovery>()

  constructor(options: RemoteProviderSessionDiscoveryRegistryOptions = {}) {
    const discoveries = options.discoveries ?? [
      new CodexSessionDiscovery({
        codexHome: nodeCodexHome(),
        processFactory: (specification) =>
          spawnNodeProviderProcess({
            provider: 'codex',
            ...specification,
          }),
      }),
      new ClaudeSessionDiscovery(),
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
    readonly projectRoot: string
    readonly cursor?: string
    readonly limit: number
    readonly signal?: AbortSignal
  }): Promise<ProviderSessionDiscoveryPage> {
    const discovery = this.#discoveries.get(input.provider)
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
    readonly projectRoot: string
    readonly nativeSessionId: string
    readonly revision: string
    readonly signal?: AbortSignal
  }): Promise<NativeProviderSessionCandidate | undefined> {
    const discovery = this.#discoveries.get(input.provider)
    if (discovery === undefined) return undefined
    return await discovery.validateCandidate({
      projectRoot: input.projectRoot,
      nativeSessionId: input.nativeSessionId,
      revision: input.revision,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
  }
}

function nodeCodexHome(): string {
  const configured = process.env.CODEX_HOME
  return configured !== undefined && isAbsolute(configured)
    ? configured
    : join(homedir(), '.codex')
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
