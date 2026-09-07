import { normalize } from 'node:path'

import {
  CLAUDE_CODE_CAPABILITIES,
  ClaudeSessionDiscovery,
  discoverClaudeCodeInstallations,
  fingerprintClaudeCodeInstallation,
  observeClaudeCodeInstallation,
  type ClaudeCodeAvailableDetection,
  type ClaudeCodeInstallationCandidate,
  type ClaudeCodeInstallationObservation,
} from '@codetether/adapter-claude'
import {
  CodexSessionDiscovery,
  discoverCodexInstallations,
  fingerprintCodexInstallation,
  observeCodexInstallation,
  type CodexInstallationCandidate,
  type CodexInstallationObservation,
} from '@codetether/adapter-codex'
import {
  canonicalFailure,
  type AgentProvider,
  type ProviderSessionDiscovery,
} from '@codetether/agent-core'
import {
  MachineTransportMachineIdSchema,
  providerBackendConfigurationRevisionFor,
  providerInstallationIdFor,
  providerInstallationRevisionFor,
} from '@codetether/machine-transport'
import {
  MachineProviderLifecycleSchema,
  ProviderBackendConfigurationRevisionSchema,
  ProviderInstallationIdSchema,
  ProviderInstallationRevisionSchema,
  TimestampSchema,
  type MachineId,
  type MachineProviderLifecycle,
  type ProviderBackendObservation,
  type ProviderCompatibilityObservation,
  type ProviderInstallationId,
} from '@codetether/protocol'

import {
  ConversationStore,
  type DurableMachineProviderLifecycleObservation,
  type DurableProviderInstallation,
} from '../persistence/index.js'
import type { AgentHostRuntime } from './agent-runtime.js'
import {
  CLAUDE_CODE_REASONING_LABEL,
  ClaudeCodeHostRuntime,
  claudeCodeReasoningOptions,
} from './claude-code-host-runtime.js'
import { CodexHostRuntime } from './codex-host-runtime.js'
import { UNAVAILABLE_PROVIDER_CAPABILITIES } from './provider-registry.js'
import { UnavailableAgentRuntime } from './unavailable-agent-runtime.js'

const MAXIMUM_INSTALLATIONS_PER_PROVIDER = 8

export interface LocalProviderLifecycleCoordinatorOptions {
  readonly machineId: MachineId
  readonly persistence: ConversationStore
  readonly hostVersion: string
  readonly codexExecutable?: string
  readonly disableCodexHooks?: boolean
  readonly ephemeralCodexThreads?: boolean
  readonly environment?: NodeJS.ProcessEnv
  readonly platform?: NodeJS.Platform
  readonly now?: () => Date
  /** Internal deterministic-test seam; product code uses bounded discovery. */
  readonly discoverCodex?: typeof discoverCodexInstallations
  /** Internal deterministic-test seam; product code uses bounded discovery. */
  readonly discoverClaude?: typeof discoverClaudeCodeInstallations
  /** Internal deterministic-test seam; product code uses bounded observation. */
  readonly observeCodex?: typeof observeCodexInstallation
  /** Internal deterministic-test seam; product code uses bounded observation. */
  readonly observeClaude?: typeof observeClaudeCodeInstallation
}

export interface LocalProviderLifecycleState {
  readonly runtime: AgentHostRuntime
  readonly lifecycle: MachineProviderLifecycle
  readonly sessionDiscovery?: ProviderSessionDiscovery
}

export interface PreparedLocalProviderLifecycleState extends LocalProviderLifecycleState {
  /** Durably publishes the staged observation after Host runtime handoff. */
  commit(): MachineProviderLifecycle
  /** Releases an unaccepted replacement without changing current truth. */
  discard(): Promise<void>
}

interface ObservedInstallation {
  readonly durable: DurableProviderInstallation
  readonly candidate:
    CodexInstallationCandidate | ClaudeCodeInstallationCandidate
  readonly runtimeEnvironment: () => NodeJS.ProcessEnv
}

interface ObservedInstallationScan {
  readonly installations: readonly ObservedInstallation[]
  readonly truncated: boolean
}

/**
 * The single local lifecycle authority. It coalesces refreshes, owns private
 * executable paths, persists only bounded observations, and never performs
 * inference while discovering or probing installations.
 */
export class LocalProviderLifecycleCoordinator {
  readonly #options: LocalProviderLifecycleCoordinatorOptions
  readonly #abort = new AbortController()
  readonly #states = new Map<AgentProvider, LocalProviderLifecycleState>()
  readonly #refreshes = new Map<
    AgentProvider,
    Promise<LocalProviderLifecycleState>
  >()
  readonly #preparations = new Set<PreparedLocalProviderLifecycleState>()

  private constructor(options: LocalProviderLifecycleCoordinatorOptions) {
    this.#options = options
  }

  static async create(
    options: LocalProviderLifecycleCoordinatorOptions,
  ): Promise<LocalProviderLifecycleCoordinator> {
    const coordinator = new LocalProviderLifecycleCoordinator(options)
    try {
      await Promise.all([
        coordinator.refresh('codex'),
        coordinator.refresh('claude-code'),
      ])
      return coordinator
    } catch (error) {
      await coordinator.close().catch(() => undefined)
      throw error
    }
  }

  states(): readonly LocalProviderLifecycleState[] {
    return (['codex', 'claude-code'] as const).flatMap((provider) => {
      const state = this.#states.get(provider)
      return state === undefined ? [] : [state]
    })
  }

  state(provider: AgentProvider): LocalProviderLifecycleState | undefined {
    return this.#states.get(provider)
  }

  refresh(provider: AgentProvider): Promise<LocalProviderLifecycleState> {
    this.#abort.signal.throwIfAborted()
    const current = this.#refreshes.get(provider)
    if (current !== undefined) return current
    const refresh = this.#refreshAndCommit(provider)
    this.#refreshes.set(provider, refresh)
    const release = (): void => {
      if (this.#refreshes.get(provider) === refresh) {
        this.#refreshes.delete(provider)
      }
    }
    void refresh.then(release, release)
    return refresh
  }

  /**
   * Stages an exact replacement for the Host's asynchronous runtime handoff.
   * It becomes current and durable only after `commit`.
   */
  async prepareRefresh(
    provider: AgentProvider,
  ): Promise<PreparedLocalProviderLifecycleState> {
    this.#abort.signal.throwIfAborted()
    return await this.#prepareRefresh(provider)
  }

  async close(): Promise<void> {
    this.#abort.abort()
    await Promise.allSettled(this.#refreshes.values())
    await Promise.allSettled(
      [...this.#preparations].map(
        async (preparation) => await preparation.discard(),
      ),
    )
    await Promise.allSettled(
      this.states().map(async ({ runtime }) => await runtime.close()),
    )
    this.#states.clear()
  }

  async #refreshAndCommit(
    provider: AgentProvider,
  ): Promise<LocalProviderLifecycleState> {
    const prepared = await this.#prepareRefresh(provider)
    try {
      const lifecycle = prepared.commit()
      return {
        runtime: prepared.runtime,
        lifecycle,
        ...(prepared.sessionDiscovery === undefined
          ? {}
          : { sessionDiscovery: prepared.sessionDiscovery }),
      }
    } catch (error) {
      await prepared.discard().catch(() => undefined)
      throw error
    }
  }

  async #prepareRefresh(
    provider: AgentProvider,
  ): Promise<PreparedLocalProviderLifecycleState> {
    const timestamp = TimestampSchema.parse(
      (this.#options.now ?? (() => new Date()))().toISOString(),
    )
    const previous = this.#options.persistence.getProviderLifecycle(
      this.#options.machineId,
      provider,
    )
    const previousInstallations = new Map(
      (previous?.installations ?? []).flatMap((installation) => {
        const durable = this.#options.persistence.getProviderInstallation(
          installation.installationId,
        )
        return durable === undefined
          ? []
          : ([[installation.installationId, durable]] as const)
      }),
    )
    const selectedPrevious =
      previous?.selectedInstallationId === undefined
        ? undefined
        : previousInstallations.get(previous.selectedInstallationId)
    const previousPaths = [...previousInstallations.values()].flatMap(
      (installation) =>
        installation.launcherPath === undefined
          ? []
          : [installation.launcherPath],
    )
    const configuredPaths =
      provider === 'codex' && this.#options.codexExecutable !== undefined
        ? [this.#options.codexExecutable]
        : selectedPrevious?.launcherPath === undefined
          ? []
          : [selectedPrevious.launcherPath]
    let providerProbeFailed = false
    let scan: ObservedInstallationScan
    try {
      scan =
        provider === 'codex'
          ? await this.#observeCodex(
              configuredPaths,
              previousPaths,
              previousInstallations,
              timestamp,
            )
          : await this.#observeClaude(
              configuredPaths,
              previousPaths,
              previousInstallations,
              timestamp,
            )
    } catch {
      // A Provider-owned discovery/probe failure is scoped to that Provider.
      // Persistence reads/writes remain outside this boundary and still abort
      // startup because they represent shared durable-state corruption.
      this.#abort.signal.throwIfAborted()
      providerProbeFailed = true
      scan = { installations: [], truncated: false }
    }
    const observed = scan.installations
    let selectedInstallationId = previous?.selectedInstallationId
    if (selectedInstallationId === undefined) {
      selectedInstallationId = observed[0]?.durable.installationId
    }
    const absent = [...previousInstallations.values()]
      .filter(
        (known) =>
          !observed.some(
            ({ durable }) => durable.installationId === known.installationId,
          ),
      )
      .sort(
        (left, right) =>
          Number(right.installationId === selectedInstallationId) -
            Number(left.installationId === selectedInstallationId) ||
          left.installationId.localeCompare(right.installationId),
      )
      .map((missing) => ({
        durable: providerProbeFailed
          ? probeFailedInstallation(missing, timestamp)
          : scan.truncated
            ? lastKnownInstallation(missing)
            : unavailableInstallation(missing, timestamp),
        candidate: unavailableCandidate(provider, missing),
        runtimeEnvironment: () => ({
          ...(this.#options.environment ?? process.env),
        }),
      }))
    const installations = prioritizeLocalProviderInstallations(
      observed,
      absent,
      selectedInstallationId,
    )
    const durableInstallations = installations
      .slice(0, MAXIMUM_INSTALLATIONS_PER_PROVIDER)
      .map(({ durable }) => ({
        ...durable,
        selected: durable.installationId === selectedInstallationId,
      }))
    if (
      selectedInstallationId !== undefined &&
      !durableInstallations.some(
        (installation) =>
          installation.installationId === selectedInstallationId,
      )
    ) {
      selectedInstallationId = undefined
    }
    const observation: DurableMachineProviderLifecycleObservation = {
      machineId: this.#options.machineId,
      provider,
      observedAt: timestamp,
      ...(selectedInstallationId === undefined
        ? {}
        : { selectedInstallationId }),
      ...(scan.truncated ? { installationsTruncated: true } : {}),
      installations: durableInstallations,
    }
    const lifecycle = publicLifecycleFromObservation(observation)
    const selected =
      selectedInstallationId === undefined
        ? undefined
        : installations.find(
            ({ durable }) => durable.installationId === selectedInstallationId,
          )
    const existing = this.#states.get(provider)
    const runtime = await this.#runtimeFor(
      provider,
      selected,
      existing?.runtime,
      timestamp,
      providerProbeFailed,
    )
    const sessionDiscovery = this.#sessionDiscoveryFor(provider, selected)
    const state: LocalProviderLifecycleState = {
      runtime,
      lifecycle,
      ...(sessionDiscovery === undefined ? {} : { sessionDiscovery }),
    }
    let disposition: 'pending' | 'committed' | 'discarded' = 'pending'
    let committedState: LocalProviderLifecycleState | undefined
    const prepared: PreparedLocalProviderLifecycleState = {
      ...state,
      commit: () => {
        if (disposition === 'discarded') {
          throw new Error('Discarded Provider lifecycle refresh cannot commit')
        }
        if (committedState !== undefined) return committedState.lifecycle
        this.#abort.signal.throwIfAborted()
        const persisted = MachineProviderLifecycleSchema.parse(
          this.#options.persistence.recordProviderLifecycle(observation),
        )
        const stagedSelection = selectedLifecycleInstallation(lifecycle)
        const persistedSelection = selectedLifecycleInstallation(persisted)
        if (
          stagedSelection?.installationId !==
            persistedSelection?.installationId ||
          stagedSelection?.revision !== persistedSelection?.revision ||
          stagedSelection?.lastObservedAt !== persistedSelection?.lastObservedAt
        ) {
          throw new Error(
            'Provider lifecycle refresh was superseded before runtime handoff',
          )
        }
        committedState = {
          runtime,
          lifecycle: persisted,
          ...(sessionDiscovery === undefined ? {} : { sessionDiscovery }),
        }
        this.#states.set(provider, committedState)
        disposition = 'committed'
        this.#preparations.delete(prepared)
        return persisted
      },
      discard: async () => {
        if (disposition !== 'pending') return
        disposition = 'discarded'
        this.#preparations.delete(prepared)
        if (runtime !== existing?.runtime) await runtime.close()
      },
    }
    this.#preparations.add(prepared)
    return prepared
  }

  async #observeCodex(
    configuredPaths: readonly string[],
    previousPaths: readonly string[],
    previous: ReadonlyMap<ProviderInstallationId, DurableProviderInstallation>,
    timestamp: string,
  ): Promise<ObservedInstallationScan> {
    const discovery = await (
      this.#options.discoverCodex ?? discoverCodexInstallations
    )({
      environment: this.#options.environment,
      platform: this.#options.platform,
      configuredPaths,
      previouslyKnownPaths: previousPaths,
      maximumInstallations: MAXIMUM_INSTALLATIONS_PER_PROVIDER,
      signal: this.#abort.signal,
    })
    const observed = await observeLocalProviderCandidates(
      discovery.installations,
      async (candidate) => await this.#stableCodexObservation(candidate),
      this.#abort.signal,
    )
    return {
      installations: observed.map(({ candidate, observation }) =>
        this.#codexInstallation(candidate, observation, previous, timestamp),
      ),
      truncated: discovery.truncated,
    }
  }

  async #observeClaude(
    configuredPaths: readonly string[],
    previousPaths: readonly string[],
    previous: ReadonlyMap<ProviderInstallationId, DurableProviderInstallation>,
    timestamp: string,
  ): Promise<ObservedInstallationScan> {
    const discovery = await (
      this.#options.discoverClaude ?? discoverClaudeCodeInstallations
    )({
      environment: this.#options.environment,
      platform: this.#options.platform,
      configuredPaths,
      previouslyKnownPaths: previousPaths,
      maximumInstallations: MAXIMUM_INSTALLATIONS_PER_PROVIDER,
      signal: this.#abort.signal,
    })
    const observed = await observeLocalProviderCandidates(
      discovery.installations,
      async (candidate) => await this.#stableClaudeObservation(candidate),
      this.#abort.signal,
    )
    return {
      installations: observed.map(({ candidate, observation }) =>
        this.#claudeInstallation(candidate, observation, previous, timestamp),
      ),
      truncated: discovery.truncated,
    }
  }

  async #stableCodexObservation(
    installation: CodexInstallationCandidate,
  ): Promise<CodexInstallationObservation> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const before = await fingerprintCodexInstallation(
        installation,
        this.#abort.signal,
      )
      const observation = await (
        this.#options.observeCodex ?? observeCodexInstallation
      )({
        installation,
        environment: this.#options.environment,
        signal: this.#abort.signal,
        fingerprint: async () => before,
      })
      const after = await fingerprintCodexInstallation(
        installation,
        this.#abort.signal,
      )
      if (before === after) return observation
    }
    throw new Error('Codex installation changed during compatibility probing')
  }

  async #stableClaudeObservation(
    installation: ClaudeCodeInstallationCandidate,
  ): Promise<ClaudeCodeInstallationObservation> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const before = await fingerprintClaudeCodeInstallation(
        installation,
        this.#abort.signal,
      )
      const observation = await (
        this.#options.observeClaude ?? observeClaudeCodeInstallation
      )({
        installation,
        environment: this.#options.environment,
        signal: this.#abort.signal,
        checkFirstPartyAuth: true,
        fingerprint: async () => before,
      })
      const after = await fingerprintClaudeCodeInstallation(
        installation,
        this.#abort.signal,
      )
      if (before === after) return observation
    }
    throw new Error('Claude installation changed during compatibility probing')
  }

  #codexInstallation(
    candidate: CodexInstallationCandidate,
    observation: CodexInstallationObservation,
    previous: ReadonlyMap<ProviderInstallationId, DurableProviderInstallation>,
    timestamp: string,
  ): ObservedInstallation {
    const identity = installationIdentity(
      this.#options.machineId,
      'codex',
      candidate.launcherPath,
      this.#options.platform ?? process.platform,
    )
    const prior = previous.get(identity.installationId)
    const revision =
      observation.privateRevision === undefined
        ? undefined
        : ProviderInstallationRevisionSchema.parse(
            providerInstallationRevisionFor(
              MachineTransportMachineIdSchema.parse(this.#options.machineId),
              'codex',
              observation.privateRevision,
            ),
          )
    return {
      durable: {
        installationId: identity.installationId,
        machineId: this.#options.machineId,
        provider: 'codex',
        locatorKey: identity.locatorKey,
        launcherPath: candidate.launcherPath,
        resolvedExecutablePath: candidate.executable,
        selected: false,
        ...(observation.version === undefined
          ? {}
          : { version: observation.version }),
        launcherKind: candidate.launcherKind,
        installMethod: candidate.installMethod,
        availability:
          observation.compatibility.state === 'unavailable'
            ? 'unavailable'
            : 'available',
        ...(revision === undefined ? {} : { revision }),
        firstObservedAt: prior?.firstObservedAt ?? timestamp,
        lastObservedAt: timestamp,
        compatibility: compatibilityObservation(
          observation.compatibility,
          timestamp,
        ),
        backend: codexBackendObservation(
          observation,
          timestamp,
          this.#options.machineId,
        ),
      },
      candidate,
      runtimeEnvironment: observation.runtimeEnvironment,
    }
  }

  #claudeInstallation(
    candidate: ClaudeCodeInstallationCandidate,
    observation: ClaudeCodeInstallationObservation,
    previous: ReadonlyMap<ProviderInstallationId, DurableProviderInstallation>,
    timestamp: string,
  ): ObservedInstallation {
    const identity = installationIdentity(
      this.#options.machineId,
      'claude-code',
      candidate.launcherPath,
      this.#options.platform ?? process.platform,
    )
    const prior = previous.get(identity.installationId)
    const revision =
      observation.privateRevision === undefined
        ? undefined
        : ProviderInstallationRevisionSchema.parse(
            providerInstallationRevisionFor(
              MachineTransportMachineIdSchema.parse(this.#options.machineId),
              'claude-code',
              observation.privateRevision,
            ),
          )
    return {
      durable: {
        installationId: identity.installationId,
        machineId: this.#options.machineId,
        provider: 'claude-code',
        locatorKey: identity.locatorKey,
        launcherPath: candidate.launcherPath,
        resolvedExecutablePath: candidate.launcher.sourcePath,
        selected: false,
        ...(observation.version === undefined
          ? {}
          : { version: observation.version }),
        launcherKind: candidate.launcherKind,
        installMethod: candidate.installMethod,
        availability:
          observation.compatibility.state === 'unavailable'
            ? 'unavailable'
            : 'available',
        ...(revision === undefined ? {} : { revision }),
        firstObservedAt: prior?.firstObservedAt ?? timestamp,
        lastObservedAt: timestamp,
        compatibility: compatibilityObservation(
          observation.compatibility,
          timestamp,
        ),
        backend: claudeBackendObservation(
          observation,
          timestamp,
          this.#options.machineId,
        ),
      },
      candidate,
      runtimeEnvironment: observation.runtimeEnvironment,
    }
  }

  async #runtimeFor(
    provider: AgentProvider,
    selected: ObservedInstallation | undefined,
    existing: AgentHostRuntime | undefined,
    observedAt: string,
    providerProbeFailed = false,
  ): Promise<AgentHostRuntime> {
    const installation = selected?.durable
    if (
      installation !== undefined &&
      installation.revision !== undefined &&
      installation.compatibility?.freshness === 'current' &&
      existing?.installation?.installationId === installation.installationId &&
      existing.installation.installationRevision === installation.revision &&
      existing.available !== false
    ) {
      return existing
    }
    if (
      selected === undefined ||
      installation === undefined ||
      installation.availability !== 'available' ||
      installation.revision === undefined ||
      installation.compatibility?.freshness !== 'current' ||
      installation.compatibility?.capabilities.execution.effective !== true ||
      installation.compatibility.capabilities.streaming.effective !== true ||
      (provider === 'claude-code' &&
        (installation.compatibility.capabilities.fileRead.effective !== true ||
          installation.compatibility.capabilities.search.effective !== true ||
          installation.compatibility.capabilities.toolEvents.effective !==
            true))
    ) {
      return unavailableRuntime(
        provider,
        installation,
        observedAt,
        providerProbeFailed ? 'provider_start_failed' : undefined,
      )
    }
    if (provider === 'codex') {
      const candidate = selected.candidate as CodexInstallationCandidate
      try {
        return await CodexHostRuntime.launch({
          version: this.#options.hostVersion,
          executable: candidate.executable,
          environment: selected.runtimeEnvironment(),
          providerInstallationId: installation.installationId,
          installationRevision: installation.revision,
          ...(this.#options.disableCodexHooks === undefined
            ? {}
            : { disableHooks: this.#options.disableCodexHooks }),
          ...(this.#options.ephemeralCodexThreads === undefined
            ? {}
            : { ephemeralThreads: this.#options.ephemeralCodexThreads }),
        })
      } catch {
        return unavailableRuntime(provider, installation, observedAt)
      }
    }
    const candidate = selected.candidate as ClaudeCodeInstallationCandidate
    const detection: ClaudeCodeAvailableDetection = {
      provider: 'claude-code',
      status: 'available',
      capabilities: CLAUDE_CODE_CAPABILITIES,
      durationMs: 0,
      version: installation.version ?? 'unknown',
      executablePath: candidate.launcher.sourcePath,
      launcher: candidate.launcher,
    }
    return new ClaudeCodeHostRuntime(detection, selected.runtimeEnvironment(), {
      installationId: installation.installationId,
      installationRevision: installation.revision,
    })
  }

  #sessionDiscoveryFor(
    provider: AgentProvider,
    selected: ObservedInstallation | undefined,
  ): ProviderSessionDiscovery | undefined {
    if (
      selected === undefined ||
      selected.durable.compatibility?.freshness !== 'current' ||
      selected.durable.compatibility?.capabilities.nativeSessionDiscovery
        .effective !== true
    ) {
      return undefined
    }
    return provider === 'codex'
      ? new CodexSessionDiscovery({
          executable: (selected.candidate as CodexInstallationCandidate)
            .executable,
          environment: selected.runtimeEnvironment(),
          providerVersion: selected.durable.version,
        })
      : new ClaudeSessionDiscovery({
          environment: selected.runtimeEnvironment(),
          providerVersion: selected.durable.version,
        })
  }
}

/** @internal Deterministic bounded ordering used by lifecycle refresh. */
export function prioritizeLocalProviderInstallations<
  TInstallation extends {
    readonly durable: { readonly installationId: ProviderInstallationId }
  },
>(
  observed: readonly TInstallation[],
  absent: readonly TInstallation[],
  selectedInstallationId?: ProviderInstallationId,
): TInstallation[] {
  return [
    ...observed.map((installation) => ({ installation, current: true })),
    ...absent.map((installation) => ({ installation, current: false })),
  ]
    .sort(
      (left, right) =>
        Number(
          right.installation.durable.installationId === selectedInstallationId,
        ) -
          Number(
            left.installation.durable.installationId === selectedInstallationId,
          ) ||
        Number(right.current) - Number(left.current) ||
        left.installation.durable.installationId.localeCompare(
          right.installation.durable.installationId,
        ),
    )
    .map(({ installation }) => installation)
}

/** @internal Isolates one broken installation while preserving owner abort. */
export async function observeLocalProviderCandidates<TCandidate, TObservation>(
  candidates: readonly TCandidate[],
  observe: (candidate: TCandidate) => Promise<TObservation>,
  signal: AbortSignal,
): Promise<readonly { candidate: TCandidate; observation: TObservation }[]> {
  const results: Array<{
    candidate: TCandidate
    observation: TObservation
  }> = []
  for (const candidate of candidates) {
    try {
      results.push({ candidate, observation: await observe(candidate) })
    } catch (error) {
      if (signal.aborted) throw error
      // One malformed, replaced, or inaccessible installation cannot hide a
      // second valid installation of the same Provider on this Machine.
    }
  }
  return results
}

function publicLifecycleFromObservation(
  observation: DurableMachineProviderLifecycleObservation,
): MachineProviderLifecycle {
  return MachineProviderLifecycleSchema.parse({
    provider: observation.provider,
    ...(observation.selectedInstallationId === undefined
      ? {}
      : { selectedInstallationId: observation.selectedInstallationId }),
    installations: observation.installations.map((installation) => ({
      installationId: installation.installationId,
      provider: installation.provider,
      selected: installation.selected,
      ...(installation.version === undefined
        ? {}
        : { version: installation.version }),
      launcherKind: installation.launcherKind,
      installMethod: installation.installMethod,
      availability: installation.availability,
      ...(installation.revision === undefined
        ? {}
        : { revision: installation.revision }),
      firstObservedAt: installation.firstObservedAt,
      lastObservedAt: installation.lastObservedAt,
      ...(installation.compatibility === undefined
        ? {}
        : { compatibility: installation.compatibility }),
      ...(installation.backend === undefined
        ? {}
        : { backend: installation.backend }),
    })),
  })
}

function selectedLifecycleInstallation(lifecycle: MachineProviderLifecycle) {
  return lifecycle.installations.find(
    ({ installationId }) => installationId === lifecycle.selectedInstallationId,
  )
}

function installationIdentity(
  machineId: MachineId,
  provider: AgentProvider,
  launcherPath: string,
  platform: NodeJS.Platform,
): {
  readonly installationId: ProviderInstallationId
  readonly locatorKey: string
} {
  const normalized = normalize(launcherPath)
  const locatorKey =
    platform === 'win32' ? normalized.toLowerCase() : normalized
  return {
    installationId: ProviderInstallationIdSchema.parse(
      providerInstallationIdFor(
        MachineTransportMachineIdSchema.parse(machineId),
        provider,
        locatorKey,
      ),
    ),
    locatorKey,
  }
}

function compatibilityObservation(
  observation: {
    readonly state: ProviderCompatibilityObservation['state']
    readonly runtimeReadiness: ProviderCompatibilityObservation['runtimeReadiness']
    readonly contractVersion: number
    readonly capabilities: ProviderCompatibilityObservation['capabilities']
    readonly failureCode?: string
  },
  timestamp: string,
): ProviderCompatibilityObservation {
  return {
    state: observation.state,
    runtimeReadiness: observation.runtimeReadiness,
    freshness: 'current',
    contractVersion: observation.contractVersion,
    observedAt: TimestampSchema.parse(timestamp),
    capabilities: observation.capabilities,
    ...(observation.failureCode === undefined
      ? {}
      : {
          failure: canonicalFailure(
            observation.failureCode === 'provider_protocol_error'
              ? 'provider_protocol_error'
              : 'provider_start_failed',
            timestamp,
          ),
        }),
  }
}

function claudeBackendObservation(
  observation: ClaudeCodeInstallationObservation,
  timestamp: string,
  machineId: MachineId,
): ProviderBackendObservation {
  const backend = observation.backend
  return {
    mode: backend.mode,
    readiness: backend.readiness,
    freshness: 'current',
    configurationRevision: backendConfigurationRevision(
      machineId,
      'claude-code',
      backend.privateConfigurationRevision,
    ),
    configuration: {
      source: backend.source,
      hasBaseUrl: backend.hasBaseUrl,
      hasApiKey: backend.hasApiKey,
      hasAuthToken: backend.hasAuthToken,
      hasOAuthToken: backend.hasOAuthToken,
      bedrockConfigured: backend.bedrockConfigured,
      vertexConfigured: backend.vertexConfigured,
    },
    ...(backend.sanitizedOrigin === undefined
      ? {}
      : { sanitizedOrigin: backend.sanitizedOrigin }),
    observedAt: TimestampSchema.parse(timestamp),
    ...(backend.readiness === 'authentication_required'
      ? { failure: canonicalFailure('login_required', timestamp) }
      : backend.readiness === 'misconfigured'
        ? { failure: canonicalFailure('provider_misconfigured', timestamp) }
        : {}),
  }
}

function codexBackendObservation(
  observation: CodexInstallationObservation,
  timestamp: string,
  machineId: MachineId,
): ProviderBackendObservation {
  const backend = observation.backend
  return {
    mode: backend.mode,
    readiness: backend.readiness,
    freshness: 'current',
    configurationRevision: backendConfigurationRevision(
      machineId,
      'codex',
      backend.privateConfigurationRevision,
    ),
    configuration: {
      source: backend.source,
      hasBaseUrl: backend.hasBaseUrl,
      hasApiKey: backend.hasApiKey,
      hasAuthToken: backend.hasAuthToken,
      hasOAuthToken: backend.hasOAuthToken,
      bedrockConfigured: backend.bedrockConfigured,
      vertexConfigured: backend.vertexConfigured,
    },
    ...(backend.sanitizedOrigin === undefined
      ? {}
      : { sanitizedOrigin: backend.sanitizedOrigin }),
    observedAt: TimestampSchema.parse(timestamp),
    ...(backend.readiness === 'authentication_required'
      ? { failure: canonicalFailure('login_required', timestamp) }
      : backend.readiness === 'misconfigured'
        ? { failure: canonicalFailure('provider_misconfigured', timestamp) }
        : {}),
  }
}

function backendConfigurationRevision(
  machineId: MachineId,
  provider: AgentProvider,
  privateRevision: string,
) {
  return ProviderBackendConfigurationRevisionSchema.parse(
    providerBackendConfigurationRevisionFor(
      MachineTransportMachineIdSchema.parse(machineId),
      provider,
      privateRevision,
    ),
  )
}

function unavailableInstallation(
  previous: DurableProviderInstallation,
  timestamp: string,
): DurableProviderInstallation {
  const unavailable = Object.fromEntries(
    Object.entries(
      previous.compatibility?.capabilities ??
        defaultCapabilities(previous.provider),
    ).map(([name, capability]) => [
      name,
      {
        observed: 'unavailable',
        enabled: capability.enabled,
        effective: false,
      },
    ]),
  ) as ProviderCompatibilityObservation['capabilities']
  return {
    ...previous,
    selected: true,
    availability: 'unavailable',
    lastObservedAt: TimestampSchema.parse(timestamp),
    compatibility: {
      state: 'unavailable',
      runtimeReadiness: 'unavailable',
      freshness: 'current',
      contractVersion: previous.compatibility?.contractVersion ?? 1,
      observedAt: TimestampSchema.parse(timestamp),
      failure: canonicalFailure('provider_not_installed', timestamp),
      capabilities: unavailable,
    },
    ...(previous.backend === undefined
      ? {}
      : {
          backend: {
            ...previous.backend,
            freshness:
              previous.backend.freshness === 'not_observed'
                ? 'not_observed'
                : 'last_known',
          },
        }),
  }
}

/** Retains an installation omitted by an explicitly incomplete scan. */
function lastKnownInstallation(
  previous: DurableProviderInstallation,
): DurableProviderInstallation {
  return {
    ...previous,
    ...(previous.compatibility === undefined
      ? {}
      : {
          compatibility: {
            ...previous.compatibility,
            freshness:
              previous.compatibility.freshness === 'not_observed'
                ? 'not_observed'
                : 'last_known',
          },
        }),
    ...(previous.backend === undefined
      ? {}
      : {
          backend: {
            ...previous.backend,
            freshness:
              previous.backend.freshness === 'not_observed'
                ? 'not_observed'
                : 'last_known',
          },
        }),
  }
}

function probeFailedInstallation(
  previous: DurableProviderInstallation,
  timestamp: string,
): DurableProviderInstallation {
  const unavailable = Object.fromEntries(
    Object.entries(
      previous.compatibility?.capabilities ??
        defaultCapabilities(previous.provider),
    ).map(([name, capability]) => [
      name,
      {
        observed: 'unavailable',
        enabled: capability.enabled,
        effective: false,
      },
    ]),
  ) as ProviderCompatibilityObservation['capabilities']
  return {
    ...previous,
    availability: 'unavailable',
    lastObservedAt: TimestampSchema.parse(timestamp),
    compatibility: {
      state: 'unavailable',
      runtimeReadiness: 'unavailable',
      freshness: 'current',
      contractVersion: previous.compatibility?.contractVersion ?? 1,
      observedAt: TimestampSchema.parse(timestamp),
      failure: canonicalFailure('provider_start_failed', timestamp),
      capabilities: unavailable,
    },
    ...(previous.backend === undefined
      ? {}
      : {
          backend: {
            ...previous.backend,
            freshness:
              previous.backend.freshness === 'not_observed'
                ? 'not_observed'
                : 'last_known',
          },
        }),
  }
}

function unavailableCandidate(
  provider: AgentProvider,
  previous: DurableProviderInstallation,
): CodexInstallationCandidate | ClaudeCodeInstallationCandidate {
  const launcherPath = previous.launcherPath ?? previous.locatorKey
  if (provider === 'codex') {
    return {
      launcherPath,
      executable: previous.resolvedExecutablePath ?? launcherPath,
      fileIdentity: previous.locatorKey,
      launcherKind: previous.launcherKind,
      installMethod: previous.installMethod,
    }
  }
  const executable = previous.resolvedExecutablePath ?? launcherPath
  return {
    launcherPath,
    launcher: {
      kind: 'native',
      launcherPath,
      executable,
      prefixArguments: [],
      sourcePath: executable,
    },
    fileIdentity: previous.locatorKey,
    launcherKind: previous.launcherKind,
    installMethod: previous.installMethod,
  }
}

function unavailableRuntime(
  provider: AgentProvider,
  installation?: DurableProviderInstallation,
  observedAt: string = new Date().toISOString(),
  failureReasonOverride?:
    | 'provider_not_installed'
    | 'provider_unsupported_version'
    | 'provider_start_failed',
): AgentHostRuntime {
  const failureReason =
    failureReasonOverride ??
    (installation?.compatibility?.state === 'incompatible'
      ? 'provider_unsupported_version'
      : installation === undefined || installation.availability !== 'available'
        ? 'provider_not_installed'
        : 'provider_start_failed')
  return new UnavailableAgentRuntime(
    provider,
    {
      provider,
      displayName: provider === 'codex' ? 'Codex' : 'Claude Code',
      availability:
        installation?.compatibility?.state === 'incompatible'
          ? 'unsupported_version'
          : installation === undefined
            ? 'not_installed'
            : 'unavailable',
      capabilities: UNAVAILABLE_PROVIDER_CAPABILITIES,
      executionHealth: {
        state: 'unavailable',
        freshness: 'current',
        observedAt: TimestampSchema.parse(observedAt),
        failure: canonicalFailure(failureReason, observedAt),
      },
      ...(installation?.version === undefined
        ? {}
        : { version: installation.version }),
      ...(provider === 'claude-code'
        ? {
            reasoningLabel: CLAUDE_CODE_REASONING_LABEL,
            reasoningOptions: claudeCodeReasoningOptions(),
          }
        : {}),
    },
    installation?.revision === undefined
      ? undefined
      : {
          installationId: installation.installationId,
          installationRevision: installation.revision,
        },
  )
}

function defaultCapabilities(
  provider: AgentProvider,
): ProviderCompatibilityObservation['capabilities'] {
  const codexEnabled = new Set([
    'execution',
    'streaming',
    'nativeResume',
    'nativeSessionDiscovery',
  ])
  const unavailable = (name: string) => ({
    observed: 'unavailable' as const,
    enabled: provider === 'claude-code' || codexEnabled.has(name),
    effective: false,
  })
  return {
    execution: unavailable('execution'),
    streaming: unavailable('streaming'),
    nativeResume: unavailable('nativeResume'),
    nativeSessionDiscovery: unavailable('nativeSessionDiscovery'),
    fileRead: unavailable('fileRead'),
    search: unavailable('search'),
    toolEvents: unavailable('toolEvents'),
    reasoningControl: unavailable('reasoningControl'),
  }
}
