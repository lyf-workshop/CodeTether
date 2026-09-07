import { randomBytes } from 'node:crypto'
import {
  chmod,
  lstat,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, normalize } from 'node:path'

import {
  discoverClaudeCodeInstallations,
  fingerprintClaudeCodeInstallation,
  observeClaudeCodeInstallation,
  type ClaudeCodeInstallationCandidate,
  type ClaudeCodeInstallationDiscovery,
  type ClaudeCodeInstallationObservation,
} from '@codetether/adapter-claude'
import {
  discoverCodexInstallations,
  fingerprintCodexInstallation,
  observeCodexInstallation,
  type CodexInstallationCandidate,
  type CodexInstallationDiscovery,
  type CodexInstallationObservation,
} from '@codetether/adapter-codex'
import type { AgentProvider } from '@codetether/agent-core'
import {
  MachineTransportError,
  ProviderInstallationIdSchema,
  ProviderInstallationRevisionSchema,
  machineTransportLimits,
  providerBackendConfigurationRevisionFor,
  providerInstallationIdFor,
  providerInstallationRevisionFor,
  type MachineTransportMachineId,
  type ProviderInstallationId,
  type ProviderInstallationRevision,
  type RemoteProviderBackendObservation,
  type RemoteProviderCompatibilityObservation,
  type RemoteProviderDescriptor,
  type RemoteProviderDiscovery,
  type RemoteProviderInstallationDescriptor,
} from '@codetether/machine-transport'
import { z } from 'zod'

import { spawnNodeProviderProcess } from './provider-process-guardian.js'

const STATE_FILE = 'provider-installations.json'
const MAXIMUM_STATE_BYTES = 128 * 1024
const PROVIDERS = ['codex', 'claude-code'] as const
// The Provider discovery result is wrapped in a Machine-protocol envelope
// containing bounded request/Machine/Node identities before framing. Keep a
// conservative fixed allowance for that envelope so a schema-valid set of
// many lifecycle candidates can never exceed the frozen 16 KiB frame bound.
const PROVIDER_DISCOVERY_PAYLOAD_MAXIMUM_BYTES =
  machineTransportLimits.maximumFrameBytes - 2 * 1024

const PersistedInstallationSchema = z
  .object({
    provider: z.enum(PROVIDERS),
    installationId: ProviderInstallationIdSchema,
    launcherPath: z.string().min(1).max(4096).refine(isAbsolute),
    launcherKind: z.enum([
      'native',
      'symlink',
      'hardlink',
      'wrapper',
      'npm_shim',
      'unknown',
    ]),
    installMethod: z.enum([
      'native_installer',
      'npm',
      'homebrew',
      'package_manager',
      'manual',
      'unknown',
    ]),
    firstObservedAt: z.iso.datetime({ offset: true }),
    lastObservedAt: z.iso.datetime({ offset: true }),
    lastVersion: z.string().trim().min(1).max(120).optional(),
    lastRevision: ProviderInstallationRevisionSchema.optional(),
  })
  .strict()

const ProviderLifecycleStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    selected: z
      .object({
        codex: ProviderInstallationIdSchema.optional(),
        'claude-code': ProviderInstallationIdSchema.optional(),
      })
      .strict(),
    installations: z
      .array(PersistedInstallationSchema)
      .max(machineTransportLimits.maximumProviderInstallationCandidates * 2),
  })
  .strict()

type ProviderLifecycleState = z.infer<typeof ProviderLifecycleStateSchema>
type PersistedInstallation = z.infer<typeof PersistedInstallationSchema>

export interface NodeProviderLifecycleCoordinatorOptions {
  readonly machineId: MachineTransportMachineId
  readonly dataDirectory?: string
  readonly environment?: NodeJS.ProcessEnv
  readonly platform?: NodeJS.Platform
  readonly now?: () => Date
  /** Internal deterministic-test seam. */
  readonly discoverCodex?: (
    options: Parameters<typeof discoverCodexInstallations>[0],
  ) => Promise<CodexInstallationDiscovery>
  /** Internal deterministic-test seam. */
  readonly discoverClaude?: (
    options: Parameters<typeof discoverClaudeCodeInstallations>[0],
  ) => Promise<ClaudeCodeInstallationDiscovery>
  /** Internal deterministic-test seam. */
  readonly observeCodex?: (
    options: Parameters<typeof observeCodexInstallation>[0],
  ) => Promise<CodexInstallationObservation>
  /** Internal deterministic-test seam. */
  readonly observeClaude?: (
    options: Parameters<typeof observeClaudeCodeInstallation>[0],
  ) => Promise<ClaudeCodeInstallationObservation>
}

export interface NodeSelectedCodexInstallation {
  readonly provider: 'codex'
  readonly installationId: ProviderInstallationId
  readonly installationRevision: ProviderInstallationRevision
  readonly executable: string
  readonly environment: NodeJS.ProcessEnv
  readonly version?: string
  readonly compatibility: RemoteProviderCompatibilityObservation
}

export interface NodeSelectedClaudeInstallation {
  readonly provider: 'claude-code'
  readonly installationId: ProviderInstallationId
  readonly installationRevision: ProviderInstallationRevision
  readonly launcher: ClaudeCodeInstallationCandidate['launcher']
  readonly environment: NodeJS.ProcessEnv
  readonly version?: string
  readonly compatibility: RemoteProviderCompatibilityObservation
}

export type NodeSelectedProviderInstallation =
  NodeSelectedCodexInstallation | NodeSelectedClaudeInstallation

interface CurrentInstallationBase {
  readonly installationId: ProviderInstallationId
  readonly installationRevision: ProviderInstallationRevision
  readonly descriptor: RemoteProviderInstallationDescriptor
}

interface CurrentCodexInstallation extends CurrentInstallationBase {
  readonly provider: 'codex'
  readonly observation: CodexInstallationObservation
}

interface CurrentClaudeInstallation extends CurrentInstallationBase {
  readonly provider: 'claude-code'
  readonly observation: ClaudeCodeInstallationObservation
}

type CurrentInstallation = CurrentCodexInstallation | CurrentClaudeInstallation

interface CurrentInstallationScan {
  readonly installations: readonly CurrentInstallation[]
  readonly truncated: boolean
}

interface CurrentProviderLifecycle {
  readonly descriptor: RemoteProviderDescriptor
  readonly selected?: CurrentInstallation
}

class ProviderLifecycleProbeError extends Error {
  readonly provider: AgentProvider

  constructor(provider: AgentProvider) {
    super('Provider lifecycle probe failed')
    this.name = 'ProviderLifecycleProbeError'
    this.provider = provider
  }
}

/**
 * Single Machine-local authority for Provider discovery, selection, revision
 * validation, compatibility, and backend configuration observation.
 */
export class NodeProviderLifecycleCoordinator {
  readonly #machineId: MachineTransportMachineId
  readonly #dataDirectory?: string
  readonly #environment: NodeJS.ProcessEnv
  readonly #platform: NodeJS.Platform
  readonly #now: () => Date
  readonly #discoverCodex: NonNullable<
    NodeProviderLifecycleCoordinatorOptions['discoverCodex']
  >
  readonly #discoverClaude: NonNullable<
    NodeProviderLifecycleCoordinatorOptions['discoverClaude']
  >
  readonly #observeCodex: NonNullable<
    NodeProviderLifecycleCoordinatorOptions['observeCodex']
  >
  readonly #observeClaude: NonNullable<
    NodeProviderLifecycleCoordinatorOptions['observeClaude']
  >
  readonly #abort = new AbortController()
  readonly #inFlight = new Map<
    AgentProvider,
    Promise<CurrentProviderLifecycle>
  >()
  readonly #current = new Map<AgentProvider, CurrentProviderLifecycle>()
  readonly #generation = new Map<AgentProvider, number>()
  #statePromise: Promise<ProviderLifecycleState> | undefined
  #stateMutation: Promise<void> = Promise.resolve()
  #closed = false

  constructor(options: NodeProviderLifecycleCoordinatorOptions) {
    this.#machineId = options.machineId
    if (
      options.dataDirectory !== undefined &&
      !isAbsolute(options.dataDirectory)
    ) {
      throw new TypeError('Provider lifecycle state directory must be absolute')
    }
    this.#dataDirectory = options.dataDirectory
    this.#environment = { ...(options.environment ?? process.env) }
    this.#platform = options.platform ?? process.platform
    this.#now = options.now ?? (() => new Date())
    this.#discoverCodex = options.discoverCodex ?? discoverCodexInstallations
    this.#discoverClaude =
      options.discoverClaude ?? discoverClaudeCodeInstallations
    this.#observeCodex = options.observeCodex ?? observeCodexInstallation
    this.#observeClaude = options.observeClaude ?? observeClaudeCodeInstallation
  }

  async describe(): Promise<RemoteProviderDiscovery> {
    this.#assertOpen()
    const previous = new Map(this.#current)
    const [codexResult, claudeResult] = await Promise.allSettled([
      this.refreshProvider('codex'),
      this.refreshProvider('claude-code'),
    ])
    const codex = this.#settledProviderLifecycle(
      'codex',
      codexResult,
      previous.get('codex'),
    )
    const claude = this.#settledProviderLifecycle(
      'claude-code',
      claudeResult,
      previous.get('claude-code'),
    )
    return boundedProviderDiscoveryPayload({
      providers: [codex.descriptor, claude.descriptor],
      observedAt: this.#now().toISOString(),
    })
  }

  refreshProvider(provider: AgentProvider): Promise<CurrentProviderLifecycle> {
    this.#assertOpen()
    const existing = this.#inFlight.get(provider)
    if (existing !== undefined) return existing
    const generation = (this.#generation.get(provider) ?? 0) + 1
    this.#generation.set(provider, generation)
    const operation = this.#refreshProvider(provider, generation).finally(
      () => {
        if (this.#inFlight.get(provider) === operation) {
          this.#inFlight.delete(provider)
        }
      },
    )
    this.#inFlight.set(provider, operation)
    return operation
  }

  async selected(
    provider: AgentProvider,
    installationId: ProviderInstallationId,
    expectedRevision: ProviderInstallationRevision,
  ): Promise<NodeSelectedProviderInstallation> {
    const selected = await this.resolveSelected(
      provider,
      installationId,
      expectedRevision,
    )
    if (!executionReady(provider, selected.compatibility)) {
      throw new MachineTransportError(
        'provider_unavailable',
        'Selected Provider installation is not execution compatible',
        { peerAuthenticated: true },
      )
    }
    return selected
  }

  /**
   * Resolves one exact selected installation without silently substituting a
   * PATH alternative. The revision is re-fingerprinted immediately before it
   * is handed to a discovery adapter or execution owner.
   */
  async resolveSelected(
    provider: AgentProvider,
    installationId: ProviderInstallationId,
    expectedRevision: ProviderInstallationRevision,
  ): Promise<NodeSelectedProviderInstallation> {
    this.#assertOpen()
    let lifecycle = this.#current.get(provider)
    if (lifecycle === undefined)
      lifecycle = await this.refreshProvider(provider)
    let selected = lifecycle.selected
    if (
      selected === undefined ||
      selected.installationId !== installationId ||
      selected.installationRevision !== expectedRevision
    ) {
      lifecycle = await this.refreshProvider(provider)
      selected = lifecycle.selected
    }
    if (
      selected === undefined ||
      selected.installationId !== installationId ||
      selected.installationRevision !== expectedRevision
    ) {
      throw new MachineTransportError(
        'provider_unavailable',
        'Selected Provider installation changed or is unavailable',
        { peerAuthenticated: true },
      )
    }
    const currentPrivateRevision =
      selected.provider === 'codex'
        ? await fingerprintCodexInstallation(
            selected.observation.installation,
            this.#abort.signal,
          )
        : await fingerprintClaudeCodeInstallation(
            selected.observation.installation,
            this.#abort.signal,
          )
    const currentWireRevision = providerInstallationRevisionFor(
      this.#machineId,
      provider,
      currentPrivateRevision,
    )
    if (currentWireRevision !== expectedRevision) {
      this.#current.delete(provider)
      void this.refreshProvider(provider).catch(() => undefined)
      throw new MachineTransportError(
        'provider_unavailable',
        'Selected Provider installation changed and requires revalidation',
        { peerAuthenticated: true },
      )
    }
    const version = selected.descriptor.version
    const compatibility = selected.descriptor.compatibility
    if (compatibility === undefined) {
      throw new MachineTransportError(
        'provider_unavailable',
        'Selected Provider installation compatibility is unavailable',
        { peerAuthenticated: true },
      )
    }
    return selected.provider === 'codex'
      ? {
          provider: 'codex',
          installationId,
          installationRevision: expectedRevision,
          executable: selected.observation.installation.executable,
          environment: selected.observation.runtimeEnvironment(),
          ...(version === undefined ? {} : { version }),
          compatibility,
        }
      : {
          provider: 'claude-code',
          installationId,
          installationRevision: expectedRevision,
          launcher: copyClaudeLauncher(
            selected.observation.installation.launcher,
          ),
          environment: selected.observation.runtimeEnvironment(),
          ...(version === undefined ? {} : { version }),
          compatibility,
        }
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    this.#abort.abort()
    await Promise.allSettled(this.#inFlight.values())
    await this.#stateMutation
  }

  async #refreshProvider(
    provider: AgentProvider,
    generation: number,
  ): Promise<CurrentProviderLifecycle> {
    const state = await this.#state()
    const known = state.installations.filter(
      (entry) => entry.provider === provider,
    )
    const selectedId = state.selected[provider]
    const previousPaths = known
      .toSorted((left, right) =>
        left.installationId === selectedId
          ? -1
          : right.installationId === selectedId
            ? 1
            : right.lastObservedAt.localeCompare(left.lastObservedAt),
      )
      .map(({ launcherPath }) => launcherPath)

    let scan: CurrentInstallationScan
    try {
      scan =
        provider === 'codex'
          ? await this.#observeCodexInstallations(previousPaths)
          : await this.#observeClaudeInstallations(previousPaths)
    } catch (error) {
      if (this.#abort.signal.aborted) throw error
      // Installation enumeration/probing belongs to only this Provider. Mark
      // the private current result unusable and let describe() return a narrow
      // failure descriptor without overwriting the Controller's durable
      // last-known lifecycle. State-load and persistence failures remain
      // outside this catch and therefore still fail the whole operation.
      this.#current.delete(provider)
      throw new ProviderLifecycleProbeError(provider)
    }
    if (this.#generation.get(provider) !== generation) {
      throw new Error('Stale Provider lifecycle observation was discarded')
    }
    const lifecycle = await this.#commitObservation(
      provider,
      scan.installations,
      selectedId,
      known,
      scan.truncated,
    )
    if (this.#generation.get(provider) !== generation) {
      throw new Error('Stale Provider lifecycle observation was discarded')
    }
    this.#current.set(provider, lifecycle)
    return lifecycle
  }

  #settledProviderLifecycle(
    provider: AgentProvider,
    result: PromiseSettledResult<CurrentProviderLifecycle>,
    previous: CurrentProviderLifecycle | undefined,
  ): CurrentProviderLifecycle {
    if (result.status === 'fulfilled') return result.value
    if (!(result.reason instanceof ProviderLifecycleProbeError)) {
      throw result.reason
    }
    if (result.reason.provider !== provider) {
      throw new Error('Provider lifecycle failure identity changed')
    }
    return {
      descriptor: providerProbeFailedDescriptor(
        provider,
        previous?.descriptor.version,
      ),
    }
  }

  async #observeCodexInstallations(
    previousPaths: readonly string[],
  ): Promise<CurrentInstallationScan> {
    const discovery = await this.#discoverCodex({
      environment: this.#environment,
      platform: this.#platform,
      previouslyKnownPaths: previousPaths,
      maximumPathEntries:
        machineTransportLimits.maximumProviderInstallationPathEntries,
      maximumInstallations:
        machineTransportLimits.maximumProviderInstallationsPerProvider,
      signal: this.#abort.signal,
    })
    const result: CurrentCodexInstallation[] = []
    for (const installation of boundedUniqueInstallations(
      discovery.installations,
    )) {
      let observation: CodexInstallationObservation
      try {
        observation = await this.#stableCodexObservation(installation)
      } catch (error) {
        if (this.#abort.signal.aborted) throw error
        // One malformed, hung, or concurrently replaced installation must not
        // hide another usable installation of the same Provider. A previously
        // selected failed installation is retained as unavailable by
        // #commitObservation; a newly seen failed candidate has no trustworthy
        // revision to publish yet.
        continue
      }
      if (observation.privateRevision === undefined) continue
      const installationId = providerInstallationIdFor(
        this.#machineId,
        'codex',
        logicalIdentity(installation.launcherPath, this.#platform),
      )
      const installationRevision = providerInstallationRevisionFor(
        this.#machineId,
        'codex',
        observation.privateRevision,
      )
      result.push({
        provider: 'codex',
        installationId,
        installationRevision,
        observation,
        descriptor: placeholderInstallationDescriptor(
          this.#machineId,
          'codex',
          installationId,
          installationRevision,
          observation,
          this.#now().toISOString(),
        ),
      })
    }
    return { installations: result, truncated: discovery.truncated }
  }

  async #observeClaudeInstallations(
    previousPaths: readonly string[],
  ): Promise<CurrentInstallationScan> {
    const discovery = await this.#discoverClaude({
      environment: this.#environment,
      platform: this.#platform,
      previouslyKnownPaths: previousPaths,
      maximumPathEntries:
        machineTransportLimits.maximumProviderInstallationPathEntries,
      maximumInstallations:
        machineTransportLimits.maximumProviderInstallationsPerProvider,
      signal: this.#abort.signal,
    })
    const result: CurrentClaudeInstallation[] = []
    for (const installation of boundedUniqueInstallations(
      discovery.installations,
    )) {
      let observation: ClaudeCodeInstallationObservation
      try {
        observation = await this.#stableClaudeObservation(installation)
      } catch (error) {
        if (this.#abort.signal.aborted) throw error
        // Provider-installation failures are isolated exactly as on Codex.
        continue
      }
      if (observation.privateRevision === undefined) continue
      const installationId = providerInstallationIdFor(
        this.#machineId,
        'claude-code',
        logicalIdentity(installation.launcherPath, this.#platform),
      )
      const installationRevision = providerInstallationRevisionFor(
        this.#machineId,
        'claude-code',
        observation.privateRevision,
      )
      result.push({
        provider: 'claude-code',
        installationId,
        installationRevision,
        observation,
        descriptor: placeholderInstallationDescriptor(
          this.#machineId,
          'claude-code',
          installationId,
          installationRevision,
          observation,
          this.#now().toISOString(),
        ),
      })
    }
    return { installations: result, truncated: discovery.truncated }
  }

  async #stableCodexObservation(
    installation: CodexInstallationCandidate,
  ): Promise<CodexInstallationObservation> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const before = await fingerprintCodexInstallation(
        installation,
        this.#abort.signal,
      )
      const observation = await this.#observeCodex({
        installation,
        environment: this.#environment,
        codexHome: nodeCodexHome(this.#environment),
        ...(this.#platform === 'win32'
          ? {}
          : {
              processFactory: (specification) =>
                spawnNodeProviderProcess({
                  provider: 'codex',
                  ...specification,
                }),
            }),
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
      const observation = await this.#observeClaude({
        installation,
        environment: this.#environment,
        signal: this.#abort.signal,
        processOwnership:
          this.#platform === 'win32' ? 'direct-child' : 'posix-process-group',
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

  async #commitObservation(
    provider: AgentProvider,
    current: readonly CurrentInstallation[],
    previousSelectedId: ProviderInstallationId | undefined,
    previousKnown: readonly PersistedInstallation[],
    scanTruncated: boolean,
  ): Promise<CurrentProviderLifecycle> {
    let result!: CurrentProviderLifecycle
    const mutation = this.#stateMutation.then(async () => {
      const state = await this.#state()
      const selectedId =
        state.selected[provider] ??
        previousSelectedId ??
        current.find(
          ({ descriptor }) =>
            descriptor.availability === 'available' &&
            executionReady(provider, descriptor.compatibility),
        )?.installationId
      if (selectedId !== undefined && state.selected[provider] === undefined) {
        state.selected[provider] = selectedId
      }
      const now = this.#now().toISOString()
      const previousById = new Map(
        [...previousKnown, ...state.installations]
          .filter((entry) => entry.provider === provider)
          .map((entry) => [entry.installationId, entry]),
      )
      const currentWithHistory = current.map((entry) => {
        const previous = previousById.get(entry.installationId)
        const descriptor: RemoteProviderInstallationDescriptor = {
          ...entry.descriptor,
          selected: entry.installationId === selectedId,
          firstObservedAt: previous?.firstObservedAt ?? now,
          lastObservedAt: now,
        }
        return { ...entry, descriptor }
      })
      const selected = currentWithHistory.find(
        (entry) => entry.installationId === selectedId,
      )
      const currentIds = new Set(
        currentWithHistory.map(({ installationId }) => installationId),
      )
      const missingKnown = [...previousById.values()].filter(
        ({ installationId }) => !currentIds.has(installationId),
      )
      const previousDescriptorsById = new Map(
        (this.#current.get(provider)?.descriptor.installations ?? []).map(
          (descriptor) => [descriptor.installationId, descriptor],
        ),
      )
      const descriptors = [
        ...currentWithHistory.map(({ descriptor }) => ({
          descriptor,
          current: true,
        })),
        ...missingKnown.map((persisted) => ({
          descriptor: scanTruncated
            ? lastKnownInstallationDescriptor(
                persisted,
                previousDescriptorsById.get(persisted.installationId),
                persisted.installationId === selectedId,
              )
            : unavailableInstallationDescriptor(
                persisted,
                provider,
                now,
                persisted.installationId === selectedId,
              ),
          current: false,
        })),
      ]
        .toSorted(
          (left, right) =>
            Number(right.descriptor.selected) -
              Number(left.descriptor.selected) ||
            Number(right.current) - Number(left.current) ||
            left.descriptor.installationId.localeCompare(
              right.descriptor.installationId,
            ),
        )
        .map(({ descriptor }) => descriptor)
      const boundedDescriptors = descriptors.slice(
        0,
        machineTransportLimits.maximumProviderInstallationsPerProvider,
      )
      const mergedKnown = currentWithHistory.map((entry) => {
        const descriptor = entry.descriptor
        return PersistedInstallationSchema.parse({
          provider,
          installationId: entry.installationId,
          launcherPath: entry.observation.installation.launcherPath,
          launcherKind: descriptor.launcherKind,
          installMethod: descriptor.installMethod,
          firstObservedAt: descriptor.firstObservedAt,
          lastObservedAt: descriptor.lastObservedAt,
          ...(descriptor.version === undefined
            ? {}
            : { lastVersion: descriptor.version }),
          lastRevision: entry.installationRevision,
        })
      })
      const currentPersistedById = new Map(
        mergedKnown.map((entry) => [entry.installationId, entry]),
      )
      const boundedKnown = scanTruncated
        ? [...currentPersistedById.values(), ...missingKnown]
            .filter(
              (entry, index, entries) =>
                entries.findIndex(
                  ({ installationId }) =>
                    installationId === entry.installationId,
                ) === index,
            )
            .toSorted(
              (left, right) =>
                Number(right.installationId === selectedId) -
                  Number(left.installationId === selectedId) ||
                Number(currentIds.has(right.installationId)) -
                  Number(currentIds.has(left.installationId)) ||
                right.lastObservedAt.localeCompare(left.lastObservedAt) ||
                left.installationId.localeCompare(right.installationId),
            )
            .slice(
              0,
              machineTransportLimits.maximumProviderInstallationCandidates,
            )
        : boundedDescriptors.flatMap(({ installationId }) => {
            const persisted =
              currentPersistedById.get(installationId) ??
              previousById.get(installationId)
            return persisted === undefined ? [] : [persisted]
          })
      state.installations = [
        ...state.installations.filter((entry) => entry.provider !== provider),
        ...boundedKnown,
      ]
      await this.#persistState(state)
      result = {
        descriptor: providerDescriptor(
          provider,
          boundedDescriptors,
          selectedId,
          selected?.descriptor ??
            (scanTruncated
              ? undefined
              : boundedDescriptors.find(
                  (descriptor) =>
                    descriptor.selected &&
                    descriptor.installationId === selectedId,
                )),
          scanTruncated,
        ),
        ...(selected === undefined ? {} : { selected }),
      }
    })
    this.#stateMutation = mutation.catch(() => undefined)
    await mutation
    return result
  }

  #state(): Promise<ProviderLifecycleState> {
    this.#statePromise ??= this.#loadState()
    return this.#statePromise
  }

  async #loadState(): Promise<ProviderLifecycleState> {
    if (this.#dataDirectory === undefined) return emptyState()
    const path = join(this.#dataDirectory, STATE_FILE)
    try {
      const metadata = await lstat(path)
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw new Error('Provider lifecycle state path is unsafe')
      }
      if (metadata.size > MAXIMUM_STATE_BYTES) {
        throw new Error('Provider lifecycle state exceeds its bound')
      }
      const source = await readFile(path)
      if (source.byteLength > MAXIMUM_STATE_BYTES) {
        throw new Error('Provider lifecycle state exceeds its bound')
      }
      return ProviderLifecycleStateSchema.parse(
        JSON.parse(source.toString('utf8')),
      )
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return emptyState()
      throw error
    }
  }

  async #persistState(state: ProviderLifecycleState): Promise<void> {
    if (this.#dataDirectory === undefined) return
    const path = join(this.#dataDirectory, STATE_FILE)
    const temporaryPath = `${path}.tmp-${randomBytes(8).toString('hex')}`
    const value = Buffer.from(
      `${JSON.stringify(ProviderLifecycleStateSchema.parse(state), null, 2)}\n`,
      'utf8',
    )
    if (value.byteLength > MAXIMUM_STATE_BYTES) {
      throw new Error('Provider lifecycle state exceeds its bound')
    }
    try {
      await writeFile(temporaryPath, value, { flag: 'wx', mode: 0o600 })
      await chmod(temporaryPath, 0o600)
      await rename(temporaryPath, path)
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined)
      throw error
    }
  }

  #assertOpen(): void {
    if (this.#closed)
      throw new Error('Provider lifecycle coordinator is closed')
  }
}

function nodeCodexHome(environment: NodeJS.ProcessEnv): string {
  const configured = environment.CODEX_HOME
  if (configured !== undefined && isAbsolute(configured)) return configured
  const home = environment.HOME?.trim() || environment.USERPROFILE?.trim()
  return join(
    home === undefined || home.length === 0 ? homedir() : home,
    '.codex',
  )
}

function placeholderInstallationDescriptor(
  machineId: MachineTransportMachineId,
  provider: AgentProvider,
  installationId: ProviderInstallationId,
  revision: ProviderInstallationRevision,
  observation: CodexInstallationObservation | ClaudeCodeInstallationObservation,
  observedAt: string,
): RemoteProviderInstallationDescriptor {
  const compatibility = compatibilityDescriptor(
    provider,
    observation.compatibility,
    observedAt,
  )
  const isClaude = provider === 'claude-code'
  const backend = backendDescriptor(
    isClaude ? observation.backend : observation.backend,
    provider,
    observedAt,
    machineId,
  )
  return {
    installationId,
    provider,
    selected: false,
    ...(observation.version === undefined
      ? {}
      : { version: observation.version }),
    launcherKind: observation.installation.launcherKind,
    installMethod: observation.installation.installMethod,
    availability:
      compatibility.state === 'unavailable' ? 'unavailable' : 'available',
    revision,
    firstObservedAt: observedAt,
    lastObservedAt: observedAt,
    compatibility,
    backend,
  }
}

function compatibilityDescriptor(
  provider: AgentProvider,
  observation:
    | CodexInstallationObservation['compatibility']
    | ClaudeCodeInstallationObservation['compatibility'],
  observedAt: string,
): RemoteProviderCompatibilityObservation {
  const enabledCapabilities =
    provider === 'codex'
      ? new Set([
          'execution',
          'streaming',
          'nativeResume',
          'nativeSessionDiscovery',
        ])
      : undefined
  const capabilities = Object.fromEntries(
    Object.entries(observation.capabilities).map(([name, capability]) => {
      const enabled =
        enabledCapabilities === undefined || enabledCapabilities.has(name)
      return [
        name,
        {
          ...capability,
          enabled,
          effective: enabled && capability.observed === 'supported',
        },
      ]
    }),
  ) as RemoteProviderCompatibilityObservation['capabilities']
  return {
    state: observation.state,
    runtimeReadiness: observation.runtimeReadiness,
    freshness: 'current',
    contractVersion: observation.contractVersion,
    observedAt,
    capabilities,
  }
}

function backendDescriptor(
  observation:
    | CodexInstallationObservation['backend']
    | ClaudeCodeInstallationObservation['backend'],
  provider: AgentProvider,
  observedAt: string,
  machineId: MachineTransportMachineId,
): RemoteProviderBackendObservation {
  return {
    mode: observation.mode,
    readiness: observation.readiness,
    freshness: 'current',
    configurationRevision: providerBackendConfigurationRevisionFor(
      machineId,
      provider,
      observation.privateConfigurationRevision,
    ),
    configuration: {
      source: observation.source,
      hasBaseUrl: observation.hasBaseUrl,
      hasApiKey: observation.hasApiKey,
      hasAuthToken: observation.hasAuthToken,
      hasOAuthToken: observation.hasOAuthToken,
      bedrockConfigured: observation.bedrockConfigured,
      vertexConfigured: observation.vertexConfigured,
    },
    ...(observation.sanitizedOrigin === undefined
      ? {}
      : { sanitizedOrigin: observation.sanitizedOrigin }),
    observedAt,
  }
}

function unavailableInstallationDescriptor(
  persisted: PersistedInstallation,
  provider: AgentProvider,
  observedAt: string,
  selected: boolean,
): RemoteProviderInstallationDescriptor {
  return {
    installationId: persisted.installationId,
    provider: persisted.provider,
    selected,
    ...(persisted.lastVersion === undefined
      ? {}
      : { version: persisted.lastVersion }),
    launcherKind: persisted.launcherKind,
    installMethod: persisted.installMethod,
    availability: 'unavailable',
    ...(persisted.lastRevision === undefined
      ? {}
      : { revision: persisted.lastRevision }),
    firstObservedAt: persisted.firstObservedAt,
    lastObservedAt: observedAt,
    compatibility: unavailableCompatibilityDescriptor(provider, observedAt),
  }
}

function lastKnownInstallationDescriptor(
  persisted: PersistedInstallation,
  previous: RemoteProviderInstallationDescriptor | undefined,
  selected: boolean,
): RemoteProviderInstallationDescriptor {
  if (previous !== undefined && previous.revision === persisted.lastRevision) {
    return {
      ...previous,
      selected,
      firstObservedAt: persisted.firstObservedAt,
      lastObservedAt: persisted.lastObservedAt,
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
  const available = persisted.lastRevision !== undefined
  return {
    installationId: persisted.installationId,
    provider: persisted.provider,
    selected,
    ...(persisted.lastVersion === undefined
      ? {}
      : { version: persisted.lastVersion }),
    launcherKind: persisted.launcherKind,
    installMethod: persisted.installMethod,
    availability: available ? 'available' : 'unresolved',
    ...(persisted.lastRevision === undefined
      ? {}
      : { revision: persisted.lastRevision }),
    firstObservedAt: persisted.firstObservedAt,
    lastObservedAt: persisted.lastObservedAt,
  }
}

function providerDescriptor(
  provider: AgentProvider,
  installations: readonly RemoteProviderInstallationDescriptor[],
  selectedInstallationId: ProviderInstallationId | undefined,
  selected: RemoteProviderInstallationDescriptor | undefined,
  installationsTruncated: boolean,
): RemoteProviderDescriptor {
  const compatibility = selected?.compatibility
  const executable = executionReady(provider, compatibility)
  const streaming =
    executable && compatibility?.capabilities.streaming.effective === true
  const nativeResume =
    executable && compatibility?.capabilities.nativeResume.effective === true
  const capabilities =
    provider === 'codex'
      ? {
          streaming,
          resume: nativeResume,
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
      : {
          streaming,
          resume: nativeResume,
          interrupt: false,
          approvals: false,
          fileRead:
            executable &&
            compatibility?.capabilities.fileRead.effective === true,
          fileEdit: false,
          shell: false,
          search:
            executable && compatibility?.capabilities.search.effective === true,
          diff: false,
          toolEvents:
            executable &&
            compatibility?.capabilities.toolEvents.effective === true,
          modelSelection: false,
          reasoningControl:
            executable &&
            compatibility?.capabilities.reasoningControl.effective === true,
        }
  return {
    provider,
    displayName: provider === 'codex' ? 'Codex' : 'Claude Code',
    availability:
      selected === undefined
        ? installations.length === 0
          ? 'not_installed'
          : 'unavailable'
        : compatibility?.state === 'incompatible'
          ? 'unsupported_version'
          : compatibility?.state === 'unavailable'
            ? 'unavailable'
            : 'available',
    ...(selected?.version === undefined ? {} : { version: selected.version }),
    capabilities,
    ...(provider === 'claude-code' && capabilities.reasoningControl
      ? {
          reasoningLabel: '思考强度',
          reasoningOptions: [
            { id: 'low', label: '低' },
            { id: 'medium', label: '中' },
            { id: 'high', label: '高' },
            { id: 'xhigh', label: '很高' },
            { id: 'max', label: '最大' },
          ],
        }
      : {}),
    installations,
    ...(installationsTruncated ? { installationsTruncated: true } : {}),
    ...(selectedInstallationId === undefined ? {} : { selectedInstallationId }),
    ...(compatibility === undefined ? {} : { compatibility }),
    ...(selected?.backend === undefined ? {} : { backend: selected.backend }),
  }
}

function providerProbeFailedDescriptor(
  provider: AgentProvider,
  lastKnownVersion: string | undefined,
): RemoteProviderDescriptor {
  const base = providerDescriptor(provider, [], undefined, undefined, false)
  const withoutInstallations = { ...base }
  delete withoutInstallations.installations
  return {
    ...withoutInstallations,
    availability: 'unavailable',
    ...(lastKnownVersion === undefined ? {} : { version: lastKnownVersion }),
    executionFailureReason: 'provider_start_failed',
  }
}

function unavailableCompatibilityDescriptor(
  provider: AgentProvider,
  observedAt: string,
): RemoteProviderCompatibilityObservation {
  const enabledCapabilities =
    provider === 'codex'
      ? new Set([
          'execution',
          'streaming',
          'nativeResume',
          'nativeSessionDiscovery',
        ])
      : undefined
  const unavailable = (name: string) => ({
    observed: 'unavailable' as const,
    enabled: enabledCapabilities === undefined || enabledCapabilities.has(name),
    effective: false,
  })
  return {
    state: 'unavailable',
    runtimeReadiness: 'unavailable',
    freshness: 'current',
    contractVersion: 1,
    observedAt,
    capabilities: {
      execution: unavailable('execution'),
      streaming: unavailable('streaming'),
      nativeResume: unavailable('nativeResume'),
      nativeSessionDiscovery: unavailable('nativeSessionDiscovery'),
      fileRead: unavailable('fileRead'),
      search: unavailable('search'),
      toolEvents: unavailable('toolEvents'),
      reasoningControl: unavailable('reasoningControl'),
    },
  }
}

function executionReady(
  provider: AgentProvider,
  compatibility: RemoteProviderCompatibilityObservation | undefined,
): boolean {
  return (
    compatibility?.capabilities.execution.effective === true &&
    compatibility.capabilities.streaming.effective === true &&
    (provider === 'codex' ||
      (compatibility.capabilities.fileRead.effective === true &&
        compatibility.capabilities.search.effective === true &&
        compatibility.capabilities.toolEvents.effective === true)) &&
    (compatibility.state === 'verified' ||
      compatibility.state === 'compatible_unverified' ||
      compatibility.state === 'limited')
  )
}

function boundedProviderDiscoveryPayload(
  discovery: RemoteProviderDiscovery,
): RemoteProviderDiscovery {
  const providers = discovery.providers.map((provider) => ({
    ...provider,
    ...(provider.installations === undefined
      ? {}
      : { installations: [...provider.installations] }),
  }))
  while (
    Buffer.byteLength(
      JSON.stringify({ providers, observedAt: discovery.observedAt }),
      'utf8',
    ) > PROVIDER_DISCOVERY_PAYLOAD_MAXIMUM_BYTES
  ) {
    const removable = providers
      .map((provider, providerIndex) => {
        const installations = provider.installations ?? []
        const installationIndex = installations.findLastIndex(
          ({ selected }) => !selected,
        )
        return installationIndex < 0
          ? undefined
          : {
              providerIndex,
              installationIndex,
              alternateCount: installations.length - 1,
              bytes: Buffer.byteLength(
                JSON.stringify(installations[installationIndex]),
                'utf8',
              ),
            }
      })
      .filter((entry) => entry !== undefined)
      .toSorted(
        (left, right) =>
          right.alternateCount - left.alternateCount ||
          right.bytes - left.bytes ||
          left.providerIndex - right.providerIndex,
      )
    const candidate = removable[0]
    if (candidate === undefined) {
      throw new Error(
        'Provider lifecycle discovery exceeds the Machine frame budget',
      )
    }
    const provider = providers[candidate.providerIndex]
    if (provider?.installations === undefined) {
      throw new Error('Provider lifecycle discovery bound became invalid')
    }
    providers[candidate.providerIndex] = {
      ...provider,
      installations: provider.installations.filter(
        (_, index) => index !== candidate.installationIndex,
      ),
      installationsTruncated: true,
    }
  }
  return { providers, observedAt: discovery.observedAt }
}

function boundedUniqueInstallations<
  T extends { readonly fileIdentity: string },
>(installations: readonly T[]): readonly T[] {
  const result: T[] = []
  const identities = new Set<string>()
  for (const installation of installations) {
    if (identities.has(installation.fileIdentity)) continue
    identities.add(installation.fileIdentity)
    result.push(installation)
    if (
      result.length ===
      machineTransportLimits.maximumProviderInstallationsPerProvider
    ) {
      break
    }
  }
  return result
}

function logicalIdentity(path: string, platform: NodeJS.Platform): string {
  const normalized = normalize(path)
  return platform === 'win32' ? normalized.toLowerCase() : normalized
}

function emptyState(): ProviderLifecycleState {
  return { schemaVersion: 1, selected: {}, installations: [] }
}

function copyClaudeLauncher(
  launcher: ClaudeCodeInstallationCandidate['launcher'],
): ClaudeCodeInstallationCandidate['launcher'] {
  return {
    kind: launcher.kind,
    launcherPath: launcher.launcherPath,
    executable: launcher.executable,
    prefixArguments: [...launcher.prefixArguments],
    sourcePath: launcher.sourcePath,
  }
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  )
}
