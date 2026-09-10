import { createHash } from 'node:crypto'
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
  NativeTranscriptPage,
  ProviderSessionMetadataAdapter,
  ProviderSessionDiscovery,
  ProviderSessionDiscoveryPage,
  ProviderSessionTranscriptReader,
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
  readonly discoveries?: readonly ProviderSessionMetadataAdapter[]
  /** Node lifecycle environment snapshot; never supplied by Machine input. */
  readonly environment?: NodeJS.ProcessEnv
  /** Shared exact-installation authority used by production discovery. */
  readonly providerLifecycle?: NodeProviderLifecycleCoordinator
  /** Internal deterministic-test seam; Machine input cannot set this bound. */
  readonly discoveryWorkTimeoutMs?: number
  /** Internal deterministic-test seam; Machine input cannot set this bound. */
  readonly transcriptWorkTimeoutMs?: number
}

/** Machine-local, read-only Provider metadata boundary. */
export class RemoteProviderSessionDiscoveryRegistry {
  readonly #discoveries = new Map<
    AgentProvider,
    ProviderSessionMetadataAdapter
  >()
  readonly #providerLifecycle?: NodeProviderLifecycleCoordinator
  readonly #discoveryWorkTimeoutMs: number
  readonly #transcriptWorkTimeoutMs: number

  constructor(options: RemoteProviderSessionDiscoveryRegistryOptions = {}) {
    const environment = options.environment ?? process.env
    this.#providerLifecycle = options.providerLifecycle
    this.#discoveryWorkTimeoutMs =
      options.discoveryWorkTimeoutMs ??
      machineTransportLimits.providerSessionDiscoveryWorkTimeoutMs
    this.#transcriptWorkTimeoutMs =
      options.transcriptWorkTimeoutMs ??
      machineTransportLimits.providerSessionTranscriptWorkTimeoutMs
    if (
      !Number.isSafeInteger(this.#discoveryWorkTimeoutMs) ||
      this.#discoveryWorkTimeoutMs <= 0
    ) {
      throw new TypeError('Provider session discovery timeout is invalid')
    }
    if (
      !Number.isSafeInteger(this.#transcriptWorkTimeoutMs) ||
      this.#transcriptWorkTimeoutMs <= 0
    ) {
      throw new TypeError('Provider transcript timeout is invalid')
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

  async readTranscript(input: {
    readonly provider: AgentProvider
    readonly providerInstallationId: ProviderInstallationId
    readonly expectedInstallationRevision: ProviderInstallationRevision
    readonly projectRoot: string
    readonly nativeSessionId: string
    readonly boundary?: string
    readonly adoptedAt: string
    readonly cursor?: string
    readonly limit: number
    readonly signal?: AbortSignal
  }): Promise<NativeTranscriptPage> {
    try {
      const adapter = await this.#adapterFor(input, false)
      const reader: ProviderSessionTranscriptReader | undefined =
        adapter?.readSessionTranscript === undefined
          ? undefined
          : {
              provider: adapter.provider,
              readSessionTranscript:
                adapter.readSessionTranscript.bind(adapter),
            }
      if (reader === undefined) {
        return transcriptFailure(input.provider, 'unsupported')
      }
      const deadlineAbort = new AbortController()
      const deadline = armAbortDeadline(
        deadlineAbort,
        this.#transcriptWorkTimeoutMs,
      )
      const signal =
        input.signal === undefined
          ? deadlineAbort.signal
          : AbortSignal.any([input.signal, deadlineAbort.signal])
      try {
        return await reader.readSessionTranscript({
          projectRoot: input.projectRoot,
          nativeSessionId: input.nativeSessionId,
          ...(input.boundary === undefined ? {} : { boundary: input.boundary }),
          adoptedAt: input.adoptedAt,
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
          limit: input.limit,
          signal,
        })
      } catch (error) {
        if (isOwnedProcessCleanupFailure(error)) throw error
        if (deadline.expired() && input.signal?.aborted !== true) {
          return transcriptFailure(input.provider, 'unavailable')
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
    return await this.#adapterFor(input, true)
  }

  async #adapterFor(
    input: {
      readonly provider: AgentProvider
      readonly providerInstallationId: ProviderInstallationId
      readonly expectedInstallationRevision: ProviderInstallationRevision
      readonly signal?: AbortSignal
    },
    requireDiscoveryCapability: boolean,
  ): Promise<ProviderSessionMetadataAdapter | undefined> {
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
      requireDiscoveryCapability &&
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

function transcriptFailure(
  provider: AgentProvider,
  status: NativeTranscriptPage['status'],
): NativeTranscriptPage {
  return {
    provider,
    status,
    entries: [],
    complete: true,
    metrics: {
      bytesRead: 0,
      recordsScanned: 0,
      entriesReturned: 0,
      elapsedMs: 0,
      truncated: status === 'partial',
    },
  }
}

export function privateTranscriptPage(
  page: NativeTranscriptPage,
): NativeTranscriptPage {
  let truncated = page.metrics.truncated
  const entries = page.entries.map((entry) => {
    const id = retainUtf8(
      entry.id,
      machineTransportLimits.maximumProviderSessionTranscriptEntryIdBytes,
    )
    const content = retainUtf8(
      entry.content,
      machineTransportLimits.maximumProviderSessionTranscriptEntryContentBytes,
    )
    if (id.truncated || content.truncated) truncated = true
    return {
      ...entry,
      id: id.truncated
        ? createHash('sha256').update(entry.id, 'utf8').digest('base64url')
        : id.value,
      content: content.value,
    }
  })
  return {
    ...page,
    status:
      truncated && entries.length > 0
        ? 'partial'
        : page.status === 'machine_offline'
          ? 'unavailable'
          : page.status,
    entries,
    metrics: {
      ...page.metrics,
      entriesReturned: entries.length,
      truncated,
    },
  }
}

function retainUtf8(
  value: string,
  maximumBytes: number,
): {
  readonly value: string
  readonly truncated: boolean
} {
  const encoded = Buffer.from(value, 'utf8')
  if (encoded.byteLength <= maximumBytes) return { value, truncated: false }
  let end = maximumBytes
  while (end > 0 && (encoded[end]! & 0xc0) === 0x80) end -= 1
  return {
    value: encoded.subarray(0, end).toString('utf8'),
    truncated: true,
  }
}
