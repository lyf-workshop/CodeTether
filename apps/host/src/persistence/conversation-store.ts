import { mkdirSync } from 'node:fs'
import { isIP } from 'node:net'
import { dirname, isAbsolute, posix, resolve, win32 } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import {
  ActionIdSchema,
  CanonicalFailureSchema,
  conversationSearchLimits,
  conversationListLimits,
  ConversationIdSchema,
  ConversationSummarySchema,
  ConversationTitleSourceSchema,
  MachineIdSchema,
  ManualConversationTitleSchema,
  ProjectIdSchema,
  ProviderDescriptorSchema,
  ProviderBackendObservationSchema,
  ProviderCompatibilityObservationSchema,
  ProviderExecutionHealthSchema,
  ProviderExecutionHealthStateSchema,
  ProviderIdSchema,
  ProviderInstallationIdSchema,
  ProviderInstallationRevisionSchema,
  ProviderInstallationSummarySchema,
  MachineProviderLifecycleSchema,
  OnboardingProgressSchema,
  UpdateOnboardingRequestSchema,
  providerLifecycleWireLimits,
  RelayEndpointSchema,
  RelayIdentityFingerprintSchema,
  RemoteMachineAddressSchema,
  TimestampSchema,
  machineWireLimits,
  TurnIdSchema,
  TurnInputRecordSchema,
  type ActionId,
  type CanonicalFailure,
  type ConversationId,
  type ConversationSummary,
  type ConversationTitleSource,
  type MachineId,
  type ProjectId,
  type ProviderDescriptor,
  type ProviderBackendObservation,
  type ProviderCompatibilityObservation,
  type ProviderExecutionHealth,
  type ProviderId,
  type ProviderInstallationId,
  type ProviderInstallationSummary,
  type MachineProviderLifecycle,
  type OnboardingProgress,
  type OnboardingTransition,
  type RelayEndpoint,
  type RelayIdentityFingerprint,
  type RemoteMachineAddress,
  type Timestamp,
  type TurnId,
  type TurnInputRecord,
  type UpdateOnboardingRequest,
} from '@codetether/protocol'

import {
  attentionFromRow,
  parseAttentionId,
  parseAttentionListLimit,
  parseAttentionStatus,
  parseAttentionType,
  parseNewAttentionItem,
  serializeAttentionPayload,
  type AttentionRow,
  type DurableAttentionItem,
  type DurableAttentionResolveResult,
  type DurableAttentionSummary,
  type DurableAttentionUpsertResult,
  type ListAttentionItemsOptions,
  type NewDurableAttentionItem,
  type SummarizeAttentionItemsOptions,
} from './attention-records.js'
import {
  resolveCodeTetherDatabasePath,
  type DataDirectoryOptions,
} from './data-directory.js'
import {
  conversationSearchPreview,
  decodeConversationSearchCursor,
  encodeConversationSearchCursor,
  normalizeConversationSearchQuery,
  normalizeConversationSearchText,
  type ConversationSearchCursorContext,
} from './conversation-search.js'
import { currentSchemaVersion, migrateDatabase } from './migrations.js'

const DEFAULT_BUSY_TIMEOUT_MS = 5_000

/**
 * Selected and Conversation-bound installations are durable authorities and
 * are never pruned. Keep only this many additional historical alternatives
 * per Machine/Provider so repeated external PATH changes cannot grow the
 * lifecycle catalog without bound.
 */
const MAXIMUM_RETAINED_UNBOUND_PROVIDER_INSTALLATIONS =
  providerLifecycleWireLimits.installationsPerProvider

export const providerExecutionHealthFailureMaximumBytes = 4 * 1024

const durableConversationStatuses = [
  'creating',
  'idle',
  'running',
  'waiting',
  'completed',
  'failed',
] as const
export type DurableConversationStatus =
  (typeof durableConversationStatuses)[number]

export const durableConversationOrigins = [
  'codetether',
  'adopted_native',
] as const
export type DurableConversationOrigin =
  (typeof durableConversationOrigins)[number]

const searchableConversationStatuses = [
  'idle',
  'running',
  'waiting',
  'completed',
  'failed',
] as const

export const conversationArchiveFilters = ['active', 'archived', 'all'] as const
export type ConversationArchiveFilter =
  (typeof conversationArchiveFilters)[number]

export type ConversationOrganizationConflictReason =
  'active' | 'archived' | 'open_approval'

export class ConversationOrganizationConflictError extends Error {
  readonly reason: ConversationOrganizationConflictReason

  constructor(reason: ConversationOrganizationConflictReason, message: string) {
    super(message)
    this.name = 'ConversationOrganizationConflictError'
    this.reason = reason
  }
}

export type RemoteMachineTrustConflictReason =
  | 'capacity'
  | 'machine_identity'
  | 'peer_identity'
  | 'peer_key'
  | 'controller_credential'

export class RemoteMachineTrustConflictError extends Error {
  constructor(
    readonly reason: RemoteMachineTrustConflictReason,
    message: string,
  ) {
    super(message)
    this.name = 'RemoteMachineTrustConflictError'
  }
}

export type ProjectLocationConflictReason =
  'project_machine' | 'machine_path' | 'machine_trust'

export class ProjectLocationConflictError extends Error {
  constructor(
    readonly reason: ProjectLocationConflictReason,
    message: string,
  ) {
    super(message)
    this.name = 'ProjectLocationConflictError'
  }
}

export type ProjectLocationRemovalReason =
  'not_found' | 'local_required' | 'has_conversations'

export class ProjectLocationRemovalError extends Error {
  constructor(
    readonly reason: ProjectLocationRemovalReason,
    message: string,
    readonly conversationCount: number = 0,
  ) {
    super(message)
    this.name = 'ProjectLocationRemovalError'
  }
}

export class NativeProviderSessionBindingConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NativeProviderSessionBindingConflictError'
  }
}

export class RemoteMachineProjectLocationConflictError extends Error {
  constructor(
    readonly machineId: MachineId,
    readonly locationCount: number,
  ) {
    super('Remote Machine has registered Project locations')
    this.name = 'RemoteMachineProjectLocationConflictError'
  }
}

const durableTurnStatuses = [
  'starting',
  'running',
  'waiting',
  'completed',
  'failed',
  'interrupted',
] as const
export type DurableTurnStatus = (typeof durableTurnStatuses)[number]

export interface DurableProject {
  readonly projectId: ProjectId
  readonly name: string
  readonly locations: readonly DurableProjectLocation[]
  readonly createdAt: Timestamp
  readonly updatedAt: Timestamp
}

export interface DurableProjectLocation {
  readonly projectId: ProjectId
  readonly machineId: MachineId
  readonly rootPath: string
  readonly rootPathKey: string
  readonly createdAt: Timestamp
  readonly updatedAt: Timestamp
}

export interface DurableMachine {
  readonly machineId: MachineId
  readonly displayName: string
  readonly kind: 'local' | 'remote'
  readonly platform: string
  readonly architecture: string
  readonly createdAt: Timestamp
  readonly lastSeenAt?: Timestamp
}

/** Private authenticated peer material. This type must never cross Protocol. */
export interface DurableTrustedMachinePeer {
  readonly machineId: MachineId
  readonly nodeIdentity: string
  readonly peerPublicKeySpki: Uint8Array
  readonly peerKeyFingerprint: string
  readonly controllerCredentialRef: string
  readonly controllerKeyFingerprint: string
  readonly trustState: 'pending' | 'active' | 'revoking'
  readonly protocolVersion: number
  readonly endpoints: readonly DurableTrustedMachineEndpoint[]
  readonly pairedAt: Timestamp
  readonly updatedAt: Timestamp
  readonly lastAuthenticatedAt?: Timestamp
}

/** Private bounded transport hint; identity remains in DurableTrustedMachinePeer. */
export interface DurableTrustedMachineEndpoint {
  readonly address: RemoteMachineAddress
  readonly source: 'pairing' | 'manual'
  readonly preferred: boolean
  readonly createdAt: Timestamp
  readonly updatedAt: Timestamp
  readonly lastSuccessfulAt?: Timestamp
  readonly lastFailureAt?: Timestamp
}

/** Presentation-safe last-known discovery from an authenticated remote Node. */
export interface DurableRemoteProviderObservation {
  readonly machineId: MachineId
  readonly providers: readonly ProviderDescriptor[]
  readonly observedAt: Timestamp
}

/** Latest durable execution-health observation; freshness is presentation state. */
export interface DurableProviderExecutionHealthObservation {
  readonly machineId: MachineId
  readonly provider: ProviderId
  readonly state: ProviderExecutionHealth['state']
  readonly failure?: CanonicalFailure
  readonly observedAt: Timestamp
}

/**
 * Private durable Provider installation. Exact paths never cross the public
 * Protocol; remote installations may retain only their Machine-local locator.
 */
export interface DurableProviderInstallation extends ProviderInstallationSummary {
  readonly machineId: MachineId
  readonly locatorKey: string
  readonly launcherPath?: string
  readonly resolvedExecutablePath?: string
}

/** One bounded, transactionally recorded lifecycle snapshot. */
export interface DurableMachineProviderLifecycleObservation {
  readonly machineId: MachineId
  readonly provider: ProviderId
  readonly observedAt: Timestamp
  readonly selectedInstallationId?: ProviderInstallationId
  readonly installations: readonly DurableProviderInstallation[]
  /** True when the owning Machine intentionally omitted bounded candidates. */
  readonly installationsTruncated?: boolean
}

/**
 * Presentation-safe Controller Relay configuration. Enrollment tokens,
 * Controller private keys, connection epochs, and presence never enter SQLite.
 */
export interface DurableMachineRelayConfiguration {
  readonly machineId: MachineId
  readonly endpoint: RelayEndpoint
  readonly relayIdentityFingerprint: RelayIdentityFingerprint
  readonly displayLabel?: string
  readonly enabled: boolean
  readonly enrollmentState: 'required' | 'enrolled' | 'revoked'
  readonly createdAt: Timestamp
  readonly updatedAt: Timestamp
  readonly enrolledAt?: Timestamp
  readonly lastConnectedAt?: Timestamp
  readonly lastAttemptAt?: Timestamp
}

export type NewDurableTrustedMachinePeer = Omit<
  DurableTrustedMachinePeer,
  'endpoints'
> & {
  readonly endpoints?: readonly DurableTrustedMachineEndpoint[]
  /** v9 input compatibility for staging the initial pairing endpoint. */
  readonly address?: RemoteMachineAddress
}

export interface DurableConversation {
  readonly conversationId: ConversationId
  readonly projectId: ProjectId
  readonly machineId: MachineId
  readonly title: string
  readonly titleSource: ConversationTitleSource
  readonly pinnedAt?: Timestamp
  readonly archivedAt?: Timestamp
  readonly provider: ProviderId
  /** Private Phase 8B execution binding; absent only for legacy v15 data. */
  readonly providerInstallationId?: ProviderInstallationId
  readonly providerThreadId?: string
  /** Private content-free Provider boundary; never projected to Protocol v1. */
  readonly nativeTranscriptBoundary?: string
  readonly origin: DurableConversationOrigin
  readonly providerSessionMaterialized: boolean
  readonly cwd: string
  readonly model?: string
  readonly reasoning?: string
  readonly status: DurableConversationStatus
  readonly createdAt: Timestamp
  readonly updatedAt: Timestamp
  readonly lastActivityAt: Timestamp
}

export type NewDurableConversation = Omit<
  DurableConversation,
  | 'titleSource'
  | 'pinnedAt'
  | 'archivedAt'
  | 'origin'
  | 'providerSessionMaterialized'
> &
  Partial<
    Pick<
      DurableConversation,
      | 'titleSource'
      | 'pinnedAt'
      | 'archivedAt'
      | 'origin'
      | 'providerSessionMaterialized'
    >
  >

export type NewDurableAdoptedConversation = Omit<
  NewDurableConversation,
  'origin' | 'providerSessionMaterialized' | 'providerThreadId'
> & {
  readonly providerThreadId: string
}

export interface DurableConversationAdoptionResult {
  readonly conversation: DurableConversation
  readonly created: boolean
}

export type DurableOnboardingUpdateResult =
  | {
      readonly status: 'updated' | 'unchanged'
      readonly onboarding: OnboardingProgress
    }
  | {
      readonly status:
        'revision_conflict' | 'invalid_transition' | 'context_unavailable'
      readonly onboarding: OnboardingProgress
    }

export type DurableConversationSummary = ConversationSummary

export interface DurableConversationMutationResult {
  readonly conversation: DurableConversation
  readonly changed: boolean
}

export interface ListProjectConversationsOptions {
  readonly provider?: ProviderId
  readonly status?: ConversationSummary['status']
  readonly archived?: ConversationArchiveFilter
  readonly limit?: number
}

export interface SearchProjectConversationsOptions {
  readonly query: string
  readonly provider?: ProviderId
  readonly status?: ConversationSummary['status']
  readonly archive?: ConversationArchiveFilter
  readonly limit?: number
  readonly cursor?: string
}

export interface DurableConversationSearchResult {
  readonly conversation: DurableConversationSummary
  readonly matchedField: 'title' | 'user_input'
  readonly matchPreview?: string
  readonly matchedTurnId?: TurnId
}

export interface DurableConversationSearchResponse {
  readonly results: readonly DurableConversationSearchResult[]
  readonly nextCursor?: string
  readonly hasMore: boolean
}

export interface DurableTurnSnapshot {
  readonly turnId: TurnId
  readonly conversationId: ConversationId
  readonly providerTurnId?: string
  readonly input: TurnInputRecord
  readonly status: DurableTurnStatus
  readonly startedAt: Timestamp
  readonly completedAt?: Timestamp
  readonly snapshotVersion: number
  /** Parsed CodeTether normalized presentation state; never raw provider JSON. */
  readonly snapshot: unknown
}

export interface CreateDurableTurnForStartAction {
  readonly actionId: ActionId
  readonly turn: DurableTurnSnapshot
  readonly conversation: DurableConversation
}

export interface ConversationStoreOptions extends DataDirectoryOptions {
  readonly busyTimeoutMs?: number
  readonly databasePath?: string
}

export class ConversationStore {
  readonly databasePath: string
  readonly schemaVersion = currentSchemaVersion

  readonly #database: DatabaseSync
  #closed = false

  private constructor(database: DatabaseSync, databasePath: string) {
    this.#database = database
    this.databasePath = databasePath
  }

  static open(options: ConversationStoreOptions = {}): ConversationStore {
    if (
      options.databasePath !== undefined &&
      !isAbsolute(options.databasePath)
    ) {
      throw new Error('SQLite databasePath must be absolute')
    }
    const databasePath = resolve(
      options.databasePath ?? resolveCodeTetherDatabasePath(options),
    )
    const busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS
    if (!Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs < 0) {
      throw new Error('SQLite busy timeout must be a non-negative integer')
    }

    mkdirSync(dirname(databasePath), { recursive: true })
    let database: DatabaseSync | undefined
    try {
      database = new DatabaseSync(databasePath)
      database.exec('PRAGMA foreign_keys = ON')
      database.exec(`PRAGMA busy_timeout = ${String(busyTimeoutMs)}`)
      database.exec('PRAGMA journal_mode = WAL')
      database.function(
        'codetether_search_normalize',
        { deterministic: true },
        (value) => {
          if (typeof value !== 'string') {
            throw new Error('Conversation search source must be text')
          }
          return normalizeConversationSearchText(value)
        },
      )
      migrateDatabase(database)
      assertDatabaseIntegrity(database)
      return new ConversationStore(database, databasePath)
    } catch (error) {
      try {
        database?.close()
      } catch {
        // Preserve the open, configuration, migration, or integrity failure.
      }
      throw error
    }
  }

  listMachines(): DurableMachine[] {
    const rows = this.#statement(
      `SELECT * FROM machines
       ORDER BY (kind = 'local') DESC, created_at ASC, machine_id ASC`,
    ).all() as unknown as MachineRow[]
    return rows.map(machineFromRow)
  }

  getMachine(machineId: MachineId): DurableMachine | undefined {
    const id = MachineIdSchema.parse(machineId)
    const row = this.#statement(
      'SELECT * FROM machines WHERE machine_id = ?',
    ).get(id) as MachineRow | undefined
    return row === undefined ? undefined : machineFromRow(row)
  }

  getOnboardingProgress(): OnboardingProgress {
    const row = this.#statement(
      'SELECT * FROM onboarding_progress WHERE singleton = 1',
    ).get() as OnboardingProgressRow | undefined
    if (row === undefined) {
      throw new Error('Durable onboarding singleton does not exist')
    }
    return onboardingProgressFromRow(row)
  }

  updateOnboardingProgress(
    request: UpdateOnboardingRequest,
    updatedAt: Timestamp,
  ): DurableOnboardingUpdateResult {
    const value = UpdateOnboardingRequestSchema.parse(request)
    const timestamp = TimestampSchema.parse(updatedAt)
    return this.runInTransaction(() => {
      const row = this.#statement(
        'SELECT * FROM onboarding_progress WHERE singleton = 1',
      ).get() as OnboardingProgressRow | undefined
      if (row === undefined) {
        throw new Error('Durable onboarding singleton does not exist')
      }
      const current = onboardingProgressFromRow(row)
      if (row.last_action_id === value.actionId) {
        return { status: 'unchanged', onboarding: current }
      }
      if (onboardingTransitionSatisfied(current, value.transition)) {
        return { status: 'unchanged', onboarding: current }
      }
      if (value.expectedRevision !== current.revision) {
        return { status: 'revision_conflict', onboarding: current }
      }

      const effectiveTimestamp =
        Date.parse(timestamp) < Date.parse(current.updatedAt)
          ? current.updatedAt
          : timestamp
      const next = advanceOnboarding(
        current,
        value.transition,
        effectiveTimestamp,
      )
      if (next === undefined) {
        return { status: 'invalid_transition', onboarding: current }
      }
      if (
        next.projectId !== undefined &&
        next.machineId !== undefined &&
        this.#statement(
          `SELECT 1 FROM project_locations
           WHERE project_id = ? AND machine_id = ?`,
        ).get(next.projectId, next.machineId) === undefined
      ) {
        return { status: 'context_unavailable', onboarding: current }
      }

      const changes = this.#statement(
        `UPDATE onboarding_progress
         SET
           step = ?, revision = ?, project_id = ?, machine_id = ?,
           previous_conversations_disposition = ?,
           remote_setup_disposition = ?, last_action_id = ?, updated_at = ?,
           completed_at = ?
         WHERE singleton = 1 AND revision = ?`,
      ).run(
        next.step,
        next.revision,
        next.projectId ?? null,
        next.machineId ?? null,
        next.previousConversationsDisposition ?? null,
        next.remoteSetupDisposition ?? null,
        value.actionId,
        next.updatedAt,
        next.completedAt ?? null,
        current.revision,
      ).changes
      if (changes !== 1 && changes !== 1n) {
        throw new Error('Durable onboarding compare-and-set failed')
      }
      return {
        status: 'updated',
        onboarding: this.getOnboardingProgress(),
      }
    })
  }

  updateMachineLastSeen(
    machineId: MachineId,
    lastSeenAt: Timestamp,
  ): DurableMachine {
    const id = MachineIdSchema.parse(machineId)
    const timestamp = TimestampSchema.parse(lastSeenAt)
    assertChanged(
      this.#statement(
        'UPDATE machines SET last_seen_at = ?, updated_at = ? WHERE machine_id = ?',
      ).run(timestamp, timestamp, id).changes,
      'Machine',
      id,
    )
    const machine = this.getMachine(id)
    if (machine === undefined) throw new Error(`Machine ${id} does not exist`)
    return machine
  }

  createRemoteMachineWithTrust(
    machine: DurableMachine,
    peer: NewDurableTrustedMachinePeer,
  ): void {
    const value = parseMachine(machine)
    const trusted = parseTrustedMachinePeer(peer)
    if (value.kind !== 'remote') {
      throw new Error('Only a remote Machine can have trusted peer material')
    }
    if (trusted.machineId !== value.machineId) {
      throw new Error('Trusted peer must belong to its remote Machine')
    }
    this.runInTransaction(() => {
      const row = this.#statement(
        'SELECT COUNT(*) AS count FROM machines',
      ).get() as { readonly count: number }
      if (row.count >= 64) {
        throw new RemoteMachineTrustConflictError(
          'capacity',
          'Durable Machine capacity has been reached',
        )
      }
      this.#assertRemoteTrustIdentityAvailable(value, trusted)
      this.#statement(
        `INSERT INTO machines (
          machine_id, display_name, kind, platform, architecture,
          created_at, updated_at, last_seen_at
        ) VALUES (?, ?, 'remote', ?, ?, ?, ?, ?)`,
      ).run(
        value.machineId,
        value.displayName,
        value.platform,
        value.architecture,
        value.createdAt,
        trusted.updatedAt,
        value.lastSeenAt ?? null,
      )
      this.#statement(
        `INSERT INTO trusted_machine_peers (
          machine_id, node_identity, peer_public_key_spki,
          peer_key_fingerprint, controller_credential_ref,
          controller_key_fingerprint, trust_state, protocol_version,
          paired_at, updated_at, last_authenticated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        trusted.machineId,
        trusted.nodeIdentity,
        trusted.peerPublicKeySpki,
        trusted.peerKeyFingerprint,
        trusted.controllerCredentialRef,
        trusted.controllerKeyFingerprint,
        trusted.trustState,
        trusted.protocolVersion,
        trusted.pairedAt,
        trusted.updatedAt,
        trusted.lastAuthenticatedAt ?? null,
      )
      const insertEndpoint = this.#statement(
        `INSERT INTO trusted_machine_endpoints (
          machine_id, endpoint_host, endpoint_port, source, preferred,
          created_at, updated_at, last_successful_at, last_failure_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      for (const endpoint of trusted.endpoints) {
        insertEndpoint.run(
          trusted.machineId,
          endpoint.address.host,
          endpoint.address.port,
          endpoint.source,
          endpoint.preferred ? 1 : 0,
          endpoint.createdAt,
          endpoint.updatedAt,
          endpoint.lastSuccessfulAt ?? null,
          endpoint.lastFailureAt ?? null,
        )
      }
    })
  }

  getTrustedMachinePeer(
    machineId: MachineId,
  ): DurableTrustedMachinePeer | undefined {
    const id = MachineIdSchema.parse(machineId)
    const row = this.#statement(
      'SELECT * FROM trusted_machine_peers WHERE machine_id = ?',
    ).get(id) as TrustedMachinePeerRow | undefined
    return row === undefined
      ? undefined
      : trustedMachinePeerFromRow(row, this.#listTrustedMachineEndpoints(id))
  }

  listTrustedMachinePeers(): DurableTrustedMachinePeer[] {
    const rows = this.#statement(
      `SELECT * FROM trusted_machine_peers
       ORDER BY paired_at ASC, machine_id ASC`,
    ).all() as unknown as TrustedMachinePeerRow[]
    return rows.map((row) => {
      const machineId = MachineIdSchema.parse(row.machine_id)
      return trustedMachinePeerFromRow(
        row,
        this.#listTrustedMachineEndpoints(machineId),
      )
    })
  }

  getRemoteProviderObservation(
    machineId: MachineId,
  ): DurableRemoteProviderObservation | undefined {
    const id = MachineIdSchema.parse(machineId)
    const rows = this.#statement(
      `SELECT machine_id, provider, descriptor_json, observed_at
       FROM remote_machine_provider_observations
       WHERE machine_id = ?
       ORDER BY CASE provider WHEN 'codex' THEN 0 ELSE 1 END, provider ASC`,
    ).all(id) as unknown as RemoteProviderObservationRow[]
    if (rows.length === 0) return undefined
    const observedAt = TimestampSchema.parse(rows[0]?.observed_at)
    const providers = rows.map((row) => {
      if (row.machine_id !== id) {
        throw new Error('Remote Provider observation Machine identity changed')
      }
      if (TimestampSchema.parse(row.observed_at) !== observedAt) {
        throw new Error('Remote Provider observation snapshot is inconsistent')
      }
      const descriptor = ProviderDescriptorSchema.parse(
        parseJson(row.descriptor_json, 'Remote Provider descriptor'),
      )
      if (descriptor.provider !== ProviderIdSchema.parse(row.provider)) {
        throw new Error('Remote Provider observation identity is inconsistent')
      }
      return descriptor
    })
    return parseRemoteProviderObservation({
      machineId: id,
      providers,
      observedAt,
    })
  }

  recordRemoteProviderObservation(
    observation: DurableRemoteProviderObservation,
  ): DurableRemoteProviderObservation {
    const value = parseRemoteProviderObservation(observation)
    return this.runInTransaction(() => {
      const machine = this.getMachine(value.machineId)
      const trust = this.getTrustedMachinePeer(value.machineId)
      if (
        machine?.kind !== 'remote' ||
        trust === undefined ||
        trust.trustState !== 'active'
      ) {
        throw new Error(
          'Remote Provider discovery requires an actively trusted Machine',
        )
      }
      this.#statement(
        'DELETE FROM remote_machine_provider_observations WHERE machine_id = ?',
      ).run(value.machineId)
      const insert = this.#statement(
        `INSERT INTO remote_machine_provider_observations (
           machine_id, provider, descriptor_json, observed_at
         ) VALUES (?, ?, ?, ?)`,
      )
      for (const provider of value.providers) {
        const serialized = JSON.stringify(provider)
        if (serialized.length > 16_384) {
          throw new Error('Remote Provider descriptor exceeds durable bounds')
        }
        insert.run(
          value.machineId,
          provider.provider,
          serialized,
          value.observedAt,
        )
      }
      return this.getRemoteProviderObservation(value.machineId) ?? value
    })
  }

  getProviderExecutionHealth(
    machineId: MachineId,
    provider: ProviderId,
  ): DurableProviderExecutionHealthObservation | undefined {
    const id = MachineIdSchema.parse(machineId)
    const providerId = ProviderIdSchema.parse(provider)
    const row = this.#statement(
      `SELECT machine_id, provider, state, failure_json, observed_at
       FROM machine_provider_execution_health
       WHERE machine_id = ? AND provider = ?`,
    ).get(id, providerId) as ProviderExecutionHealthRow | undefined
    return row === undefined ? undefined : providerExecutionHealthFromRow(row)
  }

  listProviderExecutionHealth(
    machineId: MachineId,
  ): DurableProviderExecutionHealthObservation[] {
    const id = MachineIdSchema.parse(machineId)
    const rows = this.#statement(
      `SELECT machine_id, provider, state, failure_json, observed_at
       FROM machine_provider_execution_health
       WHERE machine_id = ?
       ORDER BY CASE provider WHEN 'codex' THEN 0 ELSE 1 END, provider ASC`,
    ).all(id) as unknown as ProviderExecutionHealthRow[]
    return rows.map(providerExecutionHealthFromRow)
  }

  recordProviderExecutionHealth(
    observation: DurableProviderExecutionHealthObservation,
  ): DurableProviderExecutionHealthObservation {
    const value = parseProviderExecutionHealthObservation(observation)
    const failureJson =
      value.failure === undefined
        ? null
        : serializeProviderExecutionHealthFailure(value.failure)
    this.#statement(
      `INSERT INTO machine_provider_execution_health (
         machine_id, provider, state, failure_json, observed_at
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(machine_id, provider) DO UPDATE SET
         state = excluded.state,
         failure_json = excluded.failure_json,
         observed_at = excluded.observed_at
       WHERE julianday(excluded.observed_at) >=
         julianday(machine_provider_execution_health.observed_at)`,
    ).run(
      value.machineId,
      value.provider,
      value.state,
      failureJson,
      value.observedAt,
    )
    const current = this.getProviderExecutionHealth(
      value.machineId,
      value.provider,
    )
    if (current === undefined) {
      throw new Error('Provider execution health observation was not retained')
    }
    return current
  }

  getProviderInstallation(
    installationId: ProviderInstallationId,
  ): DurableProviderInstallation | undefined {
    const id = ProviderInstallationIdSchema.parse(installationId)
    const row = this.#statement(
      `SELECT
         provider_installations.*,
         CASE
           WHEN machine_provider_installation_selections.installation_id =
             provider_installations.installation_id
           THEN 1 ELSE 0
         END AS selected
       FROM provider_installations
       LEFT JOIN machine_provider_installation_selections
         ON machine_provider_installation_selections.machine_id =
              provider_installations.machine_id
        AND machine_provider_installation_selections.provider =
              provider_installations.provider
       WHERE provider_installations.installation_id = ?`,
    ).get(id) as ProviderInstallationRow | undefined
    return row === undefined
      ? undefined
      : this.#providerInstallationFromRow(row)
  }

  getProviderLifecycle(
    machineId: MachineId,
    provider: ProviderId,
  ): MachineProviderLifecycle | undefined {
    const machine = MachineIdSchema.parse(machineId)
    const providerId = ProviderIdSchema.parse(provider)
    const rows = this.#statement(
      `SELECT
         provider_installations.*,
         CASE
           WHEN machine_provider_installation_selections.installation_id =
             provider_installations.installation_id
           THEN 1 ELSE 0
         END AS selected
       FROM provider_installations
       LEFT JOIN machine_provider_installation_selections
         ON machine_provider_installation_selections.machine_id =
              provider_installations.machine_id
        AND machine_provider_installation_selections.provider =
              provider_installations.provider
       WHERE
         provider_installations.machine_id = ? AND
         provider_installations.provider = ?
       ORDER BY selected DESC, last_observed_at DESC, installation_id ASC
       LIMIT ?`,
    ).all(
      machine,
      providerId,
      providerLifecycleWireLimits.installationsPerProvider,
    ) as unknown as ProviderInstallationRow[]
    const selection = this.#statement(
      `SELECT installation_id
       FROM machine_provider_installation_selections
       WHERE machine_id = ? AND provider = ?`,
    ).get(machine, providerId) as
      { readonly installation_id: string | null } | undefined
    if (rows.length === 0 && selection === undefined) return undefined
    return MachineProviderLifecycleSchema.parse({
      provider: providerId,
      ...(selection === undefined || selection.installation_id === null
        ? {}
        : {
            selectedInstallationId: ProviderInstallationIdSchema.parse(
              selection.installation_id,
            ),
          }),
      installations: rows.map((row) =>
        providerInstallationPublic(this.#providerInstallationFromRow(row)),
      ),
    })
  }

  listProviderLifecycles(machineId: MachineId): MachineProviderLifecycle[] {
    const machine = MachineIdSchema.parse(machineId)
    return (['codex', 'claude-code'] as const).flatMap((provider) => {
      const lifecycle = this.getProviderLifecycle(machine, provider)
      return lifecycle === undefined ? [] : [lifecycle]
    })
  }

  recordProviderLifecycle(
    observation: DurableMachineProviderLifecycleObservation,
  ): MachineProviderLifecycle {
    const value = parseProviderLifecycleObservation(observation)
    return this.runInTransaction(() => {
      const currentSnapshot = this.#statement(
        `SELECT installation_id, updated_at
         FROM machine_provider_installation_selections
         WHERE machine_id = ? AND provider = ?`,
      ).get(value.machineId, value.provider) as
        | {
            readonly installation_id: string | null
            readonly updated_at: string
          }
        | undefined
      if (
        currentSnapshot !== undefined &&
        Date.parse(currentSnapshot.updated_at) >= Date.parse(value.observedAt)
      ) {
        return (
          this.getProviderLifecycle(value.machineId, value.provider) ??
          MachineProviderLifecycleSchema.parse({
            provider: value.provider,
            installations: [],
          })
        )
      }
      for (const installation of value.installations) {
        const existing = this.getProviderInstallation(
          installation.installationId,
        )
        if (
          existing !== undefined &&
          (existing.machineId !== installation.machineId ||
            existing.provider !== installation.provider ||
            existing.locatorKey !== installation.locatorKey)
        ) {
          throw new Error(
            'Provider installation identity is already bound to another locator',
          )
        }
        const revisionChanged =
          existing !== undefined && existing.revision !== installation.revision
        this.#statement(
          `INSERT INTO provider_installations (
             installation_id, machine_id, provider, locator_key,
             launcher_path, resolved_executable_path, launcher_kind,
             install_method, availability, observed_version,
             installation_revision, first_observed_at, last_observed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(installation_id) DO UPDATE SET
             launcher_path = COALESCE(
               excluded.launcher_path, provider_installations.launcher_path
             ),
             resolved_executable_path = COALESCE(
               excluded.resolved_executable_path,
               provider_installations.resolved_executable_path
             ),
             launcher_kind = excluded.launcher_kind,
             install_method = excluded.install_method,
             availability = excluded.availability,
             observed_version = excluded.observed_version,
             installation_revision = excluded.installation_revision,
             last_observed_at = excluded.last_observed_at
           WHERE julianday(excluded.last_observed_at) >
             julianday(provider_installations.last_observed_at)`,
        ).run(
          installation.installationId,
          installation.machineId,
          installation.provider,
          installation.locatorKey,
          installation.launcherPath ?? null,
          installation.resolvedExecutablePath ?? null,
          installation.launcherKind,
          installation.installMethod,
          installation.availability,
          installation.version ?? null,
          installation.revision ?? null,
          installation.firstObservedAt,
          installation.lastObservedAt,
        )
        const retained = this.#statement(
          `SELECT installation_revision, last_observed_at
           FROM provider_installations
           WHERE installation_id = ?`,
        ).get(installation.installationId) as
          | {
              readonly installation_revision: string | null
              readonly last_observed_at: string
            }
          | undefined
        if (
          retained === undefined ||
          retained.last_observed_at !== installation.lastObservedAt ||
          (retained.installation_revision ?? undefined) !==
            installation.revision
        ) {
          continue
        }
        if (revisionChanged) {
          this.#statement(
            `DELETE FROM provider_installation_compatibility
             WHERE installation_id = ?`,
          ).run(installation.installationId)
          this.#statement(
            `DELETE FROM provider_backend_observations
             WHERE installation_id = ?`,
          ).run(installation.installationId)
        }
        if (installation.compatibility !== undefined) {
          this.#recordProviderCompatibility(
            installation.installationId,
            installation.revision,
            installation.compatibility,
          )
          if (installation.compatibility.freshness === 'last_known') {
            this.#markProviderCompatibilityLastKnown(
              installation.installationId,
              installation.revision,
            )
          }
        }
        const existingBackend = existing?.backend
        const retainKnownBackend =
          !revisionChanged &&
          existingBackend !== undefined &&
          existingBackend.readiness !== 'unknown' &&
          (installation.backend === undefined ||
            (installation.backend.configurationRevision !== undefined &&
              installation.backend.configurationRevision ===
                existingBackend.configurationRevision &&
              (installation.backend.readiness === 'unknown' ||
                (installation.backend.freshness === 'last_known' &&
                  installation.backend.readiness ===
                    existingBackend.readiness &&
                  installation.backend.observedAt ===
                    existingBackend.observedAt))))
        if (retainKnownBackend && existingBackend !== undefined) {
          this.#markProviderBackendLastKnown(
            installation.installationId,
            installation.revision,
            existingBackend.configurationRevision,
          )
        } else if (installation.backend !== undefined) {
          this.#recordProviderBackend(
            installation.installationId,
            installation.revision,
            installation.backend,
          )
        }
        if (installation.backend?.freshness === 'last_known') {
          this.#markProviderBackendObservationLastKnown(
            installation.installationId,
            installation.revision,
          )
        }
      }

      const observedInstallationIds = new Set(
        value.installations.map(({ installationId }) => installationId),
      )
      const retainedRows = this.#statement(
        `SELECT installation_id, installation_revision
         FROM provider_installations
         WHERE machine_id = ? AND provider = ?`,
      ).all(value.machineId, value.provider) as Array<{
        readonly installation_id: string
        readonly installation_revision: string | null
      }>
      if (value.installationsTruncated === true) {
        for (const row of retainedRows) {
          const installationId = ProviderInstallationIdSchema.parse(
            row.installation_id,
          )
          if (observedInstallationIds.has(installationId)) continue
          const revision =
            row.installation_revision === null
              ? undefined
              : ProviderInstallationRevisionSchema.parse(
                  row.installation_revision,
                )
          this.#markProviderCompatibilityLastKnown(installationId, revision)
          this.#markProviderBackendObservationLastKnown(
            installationId,
            revision,
          )
        }
      } else {
        for (const row of retainedRows) {
          const installationId = ProviderInstallationIdSchema.parse(
            row.installation_id,
          )
          if (observedInstallationIds.has(installationId)) continue
          const revision =
            row.installation_revision === null
              ? undefined
              : ProviderInstallationRevisionSchema.parse(
                  row.installation_revision,
                )
          this.#statement(
            `UPDATE provider_installations
             SET availability = 'unavailable', last_observed_at = ?
             WHERE installation_id = ?`,
          ).run(value.observedAt, installationId)
          this.#recordProviderCompatibility(
            installationId,
            revision,
            unavailableProviderCompatibility(value.provider, value.observedAt),
          )
          this.#statement(
            `UPDATE provider_backend_observations
             SET freshness = 'last_known'
             WHERE installation_id = ? AND freshness = 'current'`,
          ).run(installationId)
        }
      }

      const selected =
        value.installationsTruncated === true &&
        currentSnapshot?.installation_id !== undefined &&
        currentSnapshot.installation_id !== null
          ? ProviderInstallationIdSchema.parse(currentSnapshot.installation_id)
          : value.selectedInstallationId
      this.#statement(
        `INSERT INTO machine_provider_installation_selections (
           machine_id, provider, installation_id, selected_at, updated_at
         ) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(machine_id, provider) DO UPDATE SET
           installation_id = excluded.installation_id,
           selected_at = CASE
             WHEN machine_provider_installation_selections.installation_id IS
               excluded.installation_id
             THEN machine_provider_installation_selections.selected_at
             ELSE excluded.selected_at
           END,
           updated_at = excluded.updated_at
         WHERE julianday(excluded.updated_at) >
           julianday(machine_provider_installation_selections.updated_at)`,
      ).run(
        value.machineId,
        value.provider,
        selected ?? null,
        selected === undefined ? null : value.observedAt,
        value.observedAt,
      )

      this.#pruneUnboundProviderInstallations(value.machineId, value.provider)

      return (
        this.getProviderLifecycle(value.machineId, value.provider) ??
        MachineProviderLifecycleSchema.parse({
          provider: value.provider,
          installations: [],
        })
      )
    })
  }

  /** Updates backend health without manufacturing a new binary observation. */
  recordProviderBackendObservation(
    installationId: ProviderInstallationId,
    revision: DurableProviderInstallation['revision'],
    observation: ProviderBackendObservation,
  ): DurableProviderInstallation {
    const id = ProviderInstallationIdSchema.parse(installationId)
    const backend = ProviderBackendObservationSchema.parse(observation)
    return this.runInTransaction(() => {
      const installation = this.getProviderInstallation(id)
      if (installation === undefined || installation.revision !== revision) {
        throw new Error(
          'Provider backend observation targets a stale installation revision',
        )
      }
      this.#recordProviderBackend(id, revision, backend)
      const retained = this.getProviderInstallation(id)
      if (retained === undefined) {
        throw new Error('Provider backend observation was not retained')
      }
      return retained
    })
  }

  getMachineRelayConfiguration(
    machineId: MachineId,
  ): DurableMachineRelayConfiguration | undefined {
    const id = MachineIdSchema.parse(machineId)
    const row = this.#statement(
      `SELECT * FROM machine_relay_configurations WHERE machine_id = ?`,
    ).get(id) as MachineRelayConfigurationRow | undefined
    return row === undefined ? undefined : machineRelayConfigurationFromRow(row)
  }

  listEnabledMachineRelayConfigurations(): DurableMachineRelayConfiguration[] {
    const rows = this.#statement(
      `SELECT * FROM machine_relay_configurations
       WHERE enabled = 1
       ORDER BY updated_at ASC, machine_id ASC`,
    ).all() as unknown as MachineRelayConfigurationRow[]
    return rows.map(machineRelayConfigurationFromRow)
  }

  configureMachineRelay(
    machineId: MachineId,
    endpoint: RelayEndpoint,
    relayIdentityFingerprint: RelayIdentityFingerprint,
    updatedAt: Timestamp,
    displayLabel?: string,
  ): DurableMachineRelayConfiguration {
    const id = MachineIdSchema.parse(machineId)
    const relayEndpoint = RelayEndpointSchema.parse(endpoint)
    const relayFingerprint = RelayIdentityFingerprintSchema.parse(
      relayIdentityFingerprint,
    )
    const timestamp = TimestampSchema.parse(updatedAt)
    const label =
      displayLabel === undefined
        ? undefined
        : parseBoundedText(displayLabel, 'Relay display label', 120)

    this.runInTransaction(() => {
      const machine = this.getMachine(id)
      const trust = this.getTrustedMachinePeer(id)
      if (
        machine?.kind !== 'remote' ||
        trust === undefined ||
        trust.trustState !== 'active'
      ) {
        throw new Error(
          'Relay configuration requires an actively trusted remote Machine',
        )
      }
      const previous = this.getMachineRelayConfiguration(id)
      const retainsEnrollment =
        previous?.relayIdentityFingerprint === relayFingerprint
      this.#statement(
        `INSERT INTO machine_relay_configurations (
           machine_id, endpoint_host, endpoint_port, transport_security,
           relay_identity_fingerprint, display_label, enabled,
           enrollment_state, created_at, updated_at, enrolled_at,
           last_connected_at, last_attempt_at
         ) VALUES (?, ?, ?, ?, ?, ?, 1, 'required', ?, ?, NULL, NULL, NULL)
         ON CONFLICT(machine_id) DO UPDATE SET
           endpoint_host = excluded.endpoint_host,
           endpoint_port = excluded.endpoint_port,
           transport_security = excluded.transport_security,
           relay_identity_fingerprint = excluded.relay_identity_fingerprint,
           display_label = excluded.display_label,
           enabled = 1,
           enrollment_state = CASE WHEN ? THEN enrollment_state ELSE 'required' END,
           enrolled_at = CASE WHEN ? THEN enrolled_at ELSE NULL END,
           last_connected_at = CASE WHEN ? THEN last_connected_at ELSE NULL END,
           last_attempt_at = NULL,
           updated_at = excluded.updated_at`,
      ).run(
        id,
        relayEndpoint.host,
        relayEndpoint.port,
        relayEndpoint.transportSecurity,
        relayFingerprint,
        label ?? null,
        timestamp,
        timestamp,
        retainsEnrollment ? 1 : 0,
        retainsEnrollment ? 1 : 0,
        retainsEnrollment ? 1 : 0,
      )
    })
    return this.#requireMachineRelayConfiguration(id)
  }

  markMachineRelayEnrolled(
    machineId: MachineId,
    enrolledAt: Timestamp,
  ): DurableMachineRelayConfiguration {
    const id = MachineIdSchema.parse(machineId)
    const timestamp = TimestampSchema.parse(enrolledAt)
    assertChanged(
      this.#statement(
        `UPDATE machine_relay_configurations SET
           enrollment_state = 'enrolled', enabled = 1,
           enrolled_at = ?, updated_at = ?
         WHERE machine_id = ? AND enrollment_state IN ('required', 'revoked')`,
      ).run(timestamp, timestamp, id).changes,
      'Relay configuration requiring explicit enrollment',
      id,
    )
    return this.#requireMachineRelayConfiguration(id)
  }

  markMachineRelayRevoked(
    machineId: MachineId,
    revokedAt: Timestamp,
  ): DurableMachineRelayConfiguration {
    const id = MachineIdSchema.parse(machineId)
    const timestamp = TimestampSchema.parse(revokedAt)
    assertChanged(
      this.#statement(
        `UPDATE machine_relay_configurations SET
           enrollment_state = 'revoked', enabled = 0,
           enrolled_at = NULL, updated_at = ?
         WHERE machine_id = ? AND enrollment_state != 'revoked'`,
      ).run(timestamp, id).changes,
      'Non-revoked Relay configuration',
      id,
    )
    return this.#requireMachineRelayConfiguration(id)
  }

  setMachineRelayEnabled(
    machineId: MachineId,
    enabled: boolean,
    updatedAt: Timestamp,
  ): DurableMachineRelayConfiguration {
    const id = MachineIdSchema.parse(machineId)
    const timestamp = TimestampSchema.parse(updatedAt)
    if (
      enabled &&
      this.#requireMachineRelayConfiguration(id).enrollmentState === 'revoked'
    ) {
      throw new Error('A revoked Relay enrollment cannot be enabled')
    }
    assertChanged(
      this.#statement(
        `UPDATE machine_relay_configurations SET enabled = ?, updated_at = ?
         WHERE machine_id = ?`,
      ).run(enabled ? 1 : 0, timestamp, id).changes,
      'Relay configuration',
      id,
    )
    return this.#requireMachineRelayConfiguration(id)
  }

  recordMachineRelayAttempt(
    machineId: MachineId,
    attemptedAt: Timestamp,
  ): DurableMachineRelayConfiguration {
    const id = MachineIdSchema.parse(machineId)
    const timestamp = TimestampSchema.parse(attemptedAt)
    assertChanged(
      this.#statement(
        `UPDATE machine_relay_configurations SET
           last_attempt_at = ?, updated_at = ?
         WHERE machine_id = ? AND enabled = 1`,
      ).run(timestamp, timestamp, id).changes,
      'Enabled Relay configuration',
      id,
    )
    return this.#requireMachineRelayConfiguration(id)
  }

  recordMachineRelayConnected(
    machineId: MachineId,
    connectedAt: Timestamp,
  ): DurableMachineRelayConfiguration {
    const id = MachineIdSchema.parse(machineId)
    const timestamp = TimestampSchema.parse(connectedAt)
    assertChanged(
      this.#statement(
        `UPDATE machine_relay_configurations SET
           last_connected_at = ?, last_attempt_at = ?, updated_at = ?
         WHERE machine_id = ? AND enabled = 1 AND enrollment_state = 'enrolled'`,
      ).run(timestamp, timestamp, timestamp, id).changes,
      'Enabled enrolled Relay configuration',
      id,
    )
    return this.#requireMachineRelayConfiguration(id)
  }

  deleteMachineRelayConfiguration(machineId: MachineId): boolean {
    const id = MachineIdSchema.parse(machineId)
    return (
      this.#statement(
        'DELETE FROM machine_relay_configurations WHERE machine_id = ?',
      ).run(id).changes > 0
    )
  }

  #requireMachineRelayConfiguration(
    machineId: MachineId,
  ): DurableMachineRelayConfiguration {
    const configuration = this.getMachineRelayConfiguration(machineId)
    if (configuration === undefined) {
      throw new Error(`Relay configuration for ${machineId} does not exist`)
    }
    return configuration
  }

  activateTrustedMachinePeer(
    machineId: MachineId,
    authenticatedAt: Timestamp,
  ): DurableTrustedMachinePeer {
    const id = MachineIdSchema.parse(machineId)
    const timestamp = TimestampSchema.parse(authenticatedAt)
    this.runInTransaction(() => {
      assertChanged(
        this.#statement(
          `UPDATE trusted_machine_peers SET
             trust_state = 'active', updated_at = ?, last_authenticated_at = ?
           WHERE machine_id = ? AND trust_state = 'pending'`,
        ).run(timestamp, timestamp, id).changes,
        'Pending trusted Machine peer',
        id,
      )
      assertChanged(
        this.#statement(
          `UPDATE trusted_machine_endpoints SET
             last_successful_at = ?, last_failure_at = NULL, updated_at = ?
           WHERE machine_id = ? AND preferred = 1`,
        ).run(timestamp, timestamp, id).changes,
        'Preferred trusted Machine endpoint',
        id,
      )
      assertChanged(
        this.#statement(
          `UPDATE machines SET last_seen_at = ?, updated_at = ?
           WHERE machine_id = ? AND kind = 'remote'`,
        ).run(timestamp, timestamp, id).changes,
        'Remote Machine',
        id,
      )
    })
    const peer = this.getTrustedMachinePeer(id)
    if (peer === undefined) {
      throw new Error(`Trusted Machine peer ${id} does not exist`)
    }
    return peer
  }

  markTrustedMachinePeerRevoking(
    machineId: MachineId,
    updatedAt: Timestamp,
  ): DurableTrustedMachinePeer {
    const id = MachineIdSchema.parse(machineId)
    const timestamp = TimestampSchema.parse(updatedAt)
    this.runInTransaction(() => {
      const locationCount = this.countProjectLocationsForMachine(id)
      if (locationCount > 0) {
        throw new RemoteMachineProjectLocationConflictError(id, locationCount)
      }
      assertChanged(
        this.#statement(
          `UPDATE trusted_machine_peers SET
             trust_state = 'revoking', updated_at = ?
           WHERE machine_id = ? AND trust_state = 'active'`,
        ).run(timestamp, id).changes,
        'Active trusted Machine peer',
        id,
      )
    })
    const peer = this.getTrustedMachinePeer(id)
    if (peer === undefined) {
      throw new Error(`Trusted Machine peer ${id} does not exist`)
    }
    return peer
  }

  restoreRevokingTrustedMachinePeer(
    machineId: MachineId,
    updatedAt: Timestamp,
  ): DurableTrustedMachinePeer {
    const id = MachineIdSchema.parse(machineId)
    const timestamp = TimestampSchema.parse(updatedAt)
    assertChanged(
      this.#statement(
        `UPDATE trusted_machine_peers SET
           trust_state = 'active', updated_at = ?
         WHERE machine_id = ? AND trust_state = 'revoking'`,
      ).run(timestamp, id).changes,
      'Revoking trusted Machine peer',
      id,
    )
    const peer = this.getTrustedMachinePeer(id)
    if (peer === undefined) {
      throw new Error(`Trusted Machine peer ${id} does not exist`)
    }
    return peer
  }

  recordTrustedMachineAuthentication(
    machineId: MachineId,
    address: RemoteMachineAddress,
    authenticatedAt: Timestamp,
    source: DurableTrustedMachineEndpoint['source'] = 'pairing',
  ): DurableTrustedMachinePeer {
    const id = MachineIdSchema.parse(machineId)
    const endpoint = canonicalTrustedMachineAddress(address)
    const timestamp = TimestampSchema.parse(authenticatedAt)
    const endpointSource = parseTrustedMachineEndpointSource(source)
    this.runInTransaction(() => {
      const exists = this.#statement(
        `SELECT 1 FROM trusted_machine_endpoints
         WHERE machine_id = ? AND endpoint_host = ? AND endpoint_port = ?`,
      ).get(id, endpoint.host, endpoint.port)
      if (exists === undefined) {
        const count = this.#statement(
          `SELECT COUNT(*) AS count FROM trusted_machine_endpoints
           WHERE machine_id = ?`,
        ).get(id) as { readonly count: number }
        if (count.count >= machineWireLimits.rememberedEndpoints) {
          const evicted = this.#statement(
            `DELETE FROM trusted_machine_endpoints
             WHERE rowid = (
               SELECT rowid FROM trusted_machine_endpoints
               WHERE machine_id = ? AND preferred = 0
               ORDER BY
                 COALESCE(last_successful_at, '') ASC,
                 COALESCE(last_failure_at, '') ASC,
                 updated_at ASC,
                 endpoint_host ASC,
                 endpoint_port ASC
               LIMIT 1
             )`,
          ).run(id).changes
          assertChanged(evicted, 'Evictable trusted Machine endpoint', id)
        }
      }
      this.#statement(
        `UPDATE trusted_machine_endpoints SET preferred = 0
         WHERE machine_id = ? AND preferred = 1`,
      ).run(id)
      if (exists === undefined) {
        this.#statement(
          `INSERT INTO trusted_machine_endpoints (
             machine_id, endpoint_host, endpoint_port, source, preferred,
             created_at, updated_at, last_successful_at, last_failure_at
           ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, NULL)`,
        ).run(
          id,
          endpoint.host,
          endpoint.port,
          endpointSource,
          timestamp,
          timestamp,
          timestamp,
        )
      } else {
        assertChanged(
          this.#statement(
            `UPDATE trusted_machine_endpoints SET
               source = ?, preferred = 1, updated_at = ?,
               last_successful_at = ?, last_failure_at = NULL
             WHERE machine_id = ? AND endpoint_host = ? AND endpoint_port = ?`,
          ).run(
            endpointSource,
            timestamp,
            timestamp,
            id,
            endpoint.host,
            endpoint.port,
          ).changes,
          'Trusted Machine endpoint',
          id,
        )
      }
      assertChanged(
        this.#statement(
          `UPDATE trusted_machine_peers SET
             updated_at = ?, last_authenticated_at = ?
           WHERE machine_id = ?`,
        ).run(timestamp, timestamp, id).changes,
        'Trusted Machine peer',
        id,
      )
      assertChanged(
        this.#statement(
          `UPDATE machines SET last_seen_at = ?, updated_at = ?
           WHERE machine_id = ? AND kind = 'remote'`,
        ).run(timestamp, timestamp, id).changes,
        'Remote Machine',
        id,
      )
    })
    const peer = this.getTrustedMachinePeer(id)
    if (peer === undefined) {
      throw new Error(`Trusted Machine peer ${id} does not exist`)
    }
    return peer
  }

  /**
   * Records end-peer Machine authentication completed through Relay without
   * inventing, promoting, or poisoning a direct endpoint. Relay remains a
   * transport path; the existing Controller/Node trust record is authoritative.
   */
  recordTrustedMachineRelayAuthentication(
    machineId: MachineId,
    authenticatedAt: Timestamp,
  ): DurableTrustedMachinePeer {
    const id = MachineIdSchema.parse(machineId)
    const timestamp = TimestampSchema.parse(authenticatedAt)
    this.runInTransaction(() => {
      assertChanged(
        this.#statement(
          `UPDATE trusted_machine_peers SET
             updated_at = ?, last_authenticated_at = ?
           WHERE machine_id = ? AND trust_state IN ('pending', 'active')`,
        ).run(timestamp, timestamp, id).changes,
        'Trusted Machine peer',
        id,
      )
      assertChanged(
        this.#statement(
          `UPDATE machines SET last_seen_at = ?, updated_at = ?
           WHERE machine_id = ? AND kind = 'remote'`,
        ).run(timestamp, timestamp, id).changes,
        'Remote Machine',
        id,
      )
    })
    const peer = this.getTrustedMachinePeer(id)
    if (peer === undefined) {
      throw new Error(`Trusted Machine peer ${id} does not exist`)
    }
    return peer
  }

  recordTrustedMachineEndpointFailure(
    machineId: MachineId,
    address: RemoteMachineAddress,
    failedAt: Timestamp,
  ): boolean {
    const id = MachineIdSchema.parse(machineId)
    const endpoint = canonicalTrustedMachineAddress(address)
    const timestamp = TimestampSchema.parse(failedAt)
    return (
      this.#statement(
        `UPDATE trusted_machine_endpoints SET
           last_failure_at = ?, updated_at = ?
         WHERE machine_id = ? AND endpoint_host = ? AND endpoint_port = ?`,
      ).run(timestamp, timestamp, id, endpoint.host, endpoint.port).changes > 0
    )
  }

  #listTrustedMachineEndpoints(
    machineId: MachineId,
  ): DurableTrustedMachineEndpoint[] {
    const rows = this.#statement(
      `SELECT * FROM trusted_machine_endpoints
       WHERE machine_id = ?
       ORDER BY
         preferred DESC,
         last_successful_at DESC,
         updated_at DESC,
         endpoint_host ASC,
         endpoint_port ASC`,
    ).all(machineId) as unknown as TrustedMachineEndpointRow[]
    return rows.map(trustedMachineEndpointFromRow)
  }

  deleteRemoteMachine(machineId: MachineId): boolean {
    const id = MachineIdSchema.parse(machineId)
    return this.runInTransaction(() => {
      const machine = this.getMachine(id)
      if (machine === undefined) return false
      if (machine.kind !== 'remote') {
        throw new Error('The canonical local Machine cannot be unpaired')
      }
      const locationCount = this.countProjectLocationsForMachine(id)
      if (locationCount > 0) {
        throw new RemoteMachineProjectLocationConflictError(id, locationCount)
      }
      return (
        this.#statement(
          `DELETE FROM machines WHERE machine_id = ? AND kind = 'remote'`,
        ).run(id).changes > 0
      )
    })
  }

  createProject(project: DurableProject): void {
    const value = parseProject(project)
    this.runInTransaction(() => {
      this.#statement(
        `INSERT INTO projects (
          project_id, name, created_at, updated_at
        ) VALUES (?, ?, ?, ?)`,
      ).run(value.projectId, value.name, value.createdAt, value.updatedAt)
      for (const location of value.locations) {
        this.#insertProjectLocation(location)
      }
    })
  }

  createProjectLocation(location: DurableProjectLocation): {
    readonly location: DurableProjectLocation
    readonly created: boolean
  } {
    const value = parseProjectLocation(location)
    return this.runInTransaction(() => {
      const existing = this.getProjectLocation(value.projectId, value.machineId)
      if (existing !== undefined) {
        if (
          existing.rootPath === value.rootPath &&
          existing.rootPathKey === value.rootPathKey
        ) {
          return { location: existing, created: false }
        }
        throw new ProjectLocationConflictError(
          'project_machine',
          'Project already has a different location on this Machine',
        )
      }

      const pathOwner = this.#statement(
        `SELECT project_id FROM project_locations
         WHERE machine_id = ? AND root_path_key = ?`,
      ).get(value.machineId, value.rootPathKey) as
        { readonly project_id: string } | undefined
      if (pathOwner !== undefined) {
        throw new ProjectLocationConflictError(
          'machine_path',
          'Directory is already registered to another Project on this Machine',
        )
      }

      const machine = this.getMachine(value.machineId)
      if (machine === undefined) {
        throw new ProjectLocationConflictError(
          'machine_trust',
          'Project location Machine is not registered',
        )
      }
      if (machine.kind === 'remote') {
        const trust = this.#statement(
          `SELECT trust_state FROM trusted_machine_peers
           WHERE machine_id = ?`,
        ).get(value.machineId) as { readonly trust_state: string } | undefined
        if (trust?.trust_state !== 'active') {
          throw new ProjectLocationConflictError(
            'machine_trust',
            'Remote Machine does not have active durable trust',
          )
        }
      }

      this.#insertProjectLocation(value)
      return { location: value, created: true }
    })
  }

  removeProjectLocation(
    projectId: ProjectId,
    machineId: MachineId,
  ): DurableProjectLocation {
    const project = ProjectIdSchema.parse(projectId)
    const machine = MachineIdSchema.parse(machineId)
    return this.runInTransaction(() => {
      const location = this.getProjectLocation(project, machine)
      if (location === undefined) {
        throw new ProjectLocationRemovalError(
          'not_found',
          'Project Location was not found',
        )
      }
      const durableMachine = this.getMachine(machine)
      if (durableMachine?.kind !== 'remote') {
        throw new ProjectLocationRemovalError(
          'local_required',
          'The local Project Location is required by the current Project model',
        )
      }
      const locationRow = this.#statement(
        `SELECT COUNT(*) AS count FROM project_locations
         WHERE project_id = ?`,
      ).get(project) as { readonly count: number }
      if (locationRow.count <= 1) {
        throw new ProjectLocationRemovalError(
          'local_required',
          'Project must retain its current usable Location',
        )
      }
      const conversationRow = this.#statement(
        `SELECT COUNT(*) AS count FROM conversations
         WHERE project_id = ? AND machine_id = ?`,
      ).get(project, machine) as { readonly count: number }
      if (conversationRow.count > 0) {
        throw new ProjectLocationRemovalError(
          'has_conversations',
          'Project Location has Conversations and cannot be removed',
          conversationRow.count,
        )
      }
      assertChanged(
        this.#statement(
          `DELETE FROM project_locations
           WHERE project_id = ? AND machine_id = ?`,
        ).run(project, machine).changes,
        'Project Location',
        `${project}:${machine}`,
      )
      return location
    })
  }

  updateProject(project: DurableProject): void {
    const value = parseProject(project)
    const existing = this.getProject(value.projectId)
    if (existing === undefined) {
      throw new Error(`Project ${value.projectId} does not exist`)
    }
    if (!sameProjectLocations(existing.locations, value.locations)) {
      throw new Error('Project location identity is immutable')
    }
    const result = this.#statement(
      `UPDATE projects SET name = ?, created_at = ?, updated_at = ?
       WHERE project_id = ?`,
    ).run(value.name, value.createdAt, value.updatedAt, value.projectId)
    assertChanged(result.changes, 'Project', value.projectId)
  }

  getProject(projectId: ProjectId): DurableProject | undefined {
    const id = ProjectIdSchema.parse(projectId)
    const rows = this.#statement(
      `${projectLocationSelect()}
       WHERE projects.project_id = ?
       ORDER BY project_locations.machine_id ASC`,
    ).all(id) as unknown as ProjectRow[]
    return rows.length === 0 ? undefined : projectFromRows(rows)
  }

  getProjectLocation(
    projectId: ProjectId,
    machineId: MachineId,
  ): DurableProjectLocation | undefined {
    const project = ProjectIdSchema.parse(projectId)
    const machine = MachineIdSchema.parse(machineId)
    const row = this.#statement(
      `SELECT
         project_id, machine_id, root_path, root_path_key, created_at, updated_at
       FROM project_locations
       WHERE project_id = ? AND machine_id = ?`,
    ).get(project, machine) as ProjectLocationRow | undefined
    return row === undefined ? undefined : projectLocationFromRow(row)
  }

  listProjectLocations(projectId: ProjectId): DurableProjectLocation[] {
    const id = ProjectIdSchema.parse(projectId)
    const rows = this.#statement(
      `SELECT
         project_id, machine_id, root_path, root_path_key, created_at, updated_at
       FROM project_locations
       WHERE project_id = ?
       ORDER BY machine_id ASC`,
    ).all(id) as unknown as ProjectLocationRow[]
    return rows.map(projectLocationFromRow)
  }

  countProjectLocationsForMachine(machineId: MachineId): number {
    const id = MachineIdSchema.parse(machineId)
    const row = this.#statement(
      'SELECT COUNT(*) AS count FROM project_locations WHERE machine_id = ?',
    ).get(id) as { readonly count: number }
    return row.count
  }

  getProjectByRootPathKey(
    machineId: MachineId,
    rootPathKey: string,
  ): DurableProject | undefined {
    const machine = MachineIdSchema.parse(machineId)
    const key = parseRootPathKey(rootPathKey)
    const row = this.#statement(
      `SELECT project_id FROM project_locations
       WHERE machine_id = ? AND root_path_key = ?`,
    ).get(machine, key) as { readonly project_id: string } | undefined
    return row === undefined
      ? undefined
      : this.getProject(ProjectIdSchema.parse(row.project_id))
  }

  listProjects(): DurableProject[] {
    const rows = this.#statement(
      `${projectLocationSelect()}
       ORDER BY
         projects.updated_at DESC,
         projects.project_id ASC,
         project_locations.machine_id ASC`,
    ).all() as unknown as ProjectRow[]
    return projectsFromRows(rows)
  }

  countConversationsForProject(projectId: ProjectId): number {
    const id = ProjectIdSchema.parse(projectId)
    const row = this.#statement(
      'SELECT COUNT(*) AS count FROM conversations WHERE project_id = ?',
    ).get(id) as { readonly count: number }
    return row.count
  }

  deleteProject(projectId: ProjectId): boolean {
    const id = ProjectIdSchema.parse(projectId)
    return (
      this.#statement('DELETE FROM projects WHERE project_id = ?').run(id)
        .changes > 0
    )
  }

  #insertProjectLocation(location: DurableProjectLocation): void {
    const machine = this.getMachine(location.machineId)
    if (machine === undefined) {
      throw new ProjectLocationConflictError(
        'machine_trust',
        'Project location Machine is not registered',
      )
    }
    if (machine.kind === 'remote') {
      const trust = this.#statement(
        `SELECT trust_state FROM trusted_machine_peers
         WHERE machine_id = ?`,
      ).get(location.machineId) as { readonly trust_state: string } | undefined
      if (trust?.trust_state !== 'active') {
        throw new ProjectLocationConflictError(
          'machine_trust',
          'Remote Machine does not have active durable trust',
        )
      }
    }
    this.#statement(
      `INSERT INTO project_locations (
        project_id, machine_id, root_path, root_path_key, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      location.projectId,
      location.machineId,
      location.rootPath,
      location.rootPathKey,
      location.createdAt,
      location.updatedAt,
    )
  }

  createConversation(conversation: NewDurableConversation): void {
    const value = parseConversation(conversation)
    if (value.providerInstallationId === undefined) {
      this.#insertConversation(value)
      return
    }
    this.#database.exec('SAVEPOINT create_conversation_provider_installation')
    try {
      this.#insertConversation(value)
      this.#database.exec(
        'RELEASE SAVEPOINT create_conversation_provider_installation',
      )
    } catch (error) {
      try {
        this.#database.exec(
          'ROLLBACK TO SAVEPOINT create_conversation_provider_installation',
        )
        this.#database.exec(
          'RELEASE SAVEPOINT create_conversation_provider_installation',
        )
      } catch {
        // Preserve the insertion failure.
      }
      throw error
    }
  }

  #insertConversation(value: DurableConversation): void {
    this.#statement(
      `INSERT INTO conversations (
        conversation_id, project_id, machine_id, title, title_source,
        pinned_at, archived_at, provider, provider_thread_id, origin,
        provider_session_materialized, cwd, model, reasoning, status,
        created_at, updated_at, last_activity_at, native_transcript_boundary
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      value.conversationId,
      value.projectId,
      value.machineId,
      value.title,
      value.titleSource,
      value.pinnedAt ?? null,
      value.archivedAt ?? null,
      value.provider,
      value.providerThreadId ?? null,
      value.origin,
      value.providerSessionMaterialized ? 1 : 0,
      value.cwd,
      value.model ?? null,
      value.reasoning ?? null,
      value.status,
      value.createdAt,
      value.updatedAt,
      value.lastActivityAt,
      value.nativeTranscriptBoundary ?? null,
    )
    if (value.providerInstallationId !== undefined) {
      this.#insertConversationProviderInstallationBinding(
        value,
        value.providerInstallationId,
        value.createdAt,
      )
    }
  }

  getConversationByProviderSession(
    machineId: MachineId,
    provider: ProviderId,
    providerThreadId: string,
  ): DurableConversation | undefined {
    const machine = MachineIdSchema.parse(machineId)
    const providerId = ProviderIdSchema.parse(provider)
    const nativeSessionId = parseBoundedText(
      providerThreadId,
      'Provider Thread ID',
      4096,
    )
    const row = this.#statement(
      `SELECT
         conversations.*,
         conversation_provider_installation_bindings.installation_id AS
           provider_installation_id
       FROM conversations
       LEFT JOIN conversation_provider_installation_bindings
         ON conversation_provider_installation_bindings.conversation_id =
              conversations.conversation_id
       WHERE
         conversations.machine_id = ? AND
         conversations.provider = ? AND
         conversations.provider_thread_id = ?`,
    ).get(machine, providerId, nativeSessionId) as ConversationRow | undefined
    return row === undefined ? undefined : conversationFromRow(row)
  }

  createOrGetAdoptedConversation(
    conversation: NewDurableAdoptedConversation,
  ): DurableConversationAdoptionResult {
    const value = parseConversation({
      ...conversation,
      origin: 'adopted_native',
      providerSessionMaterialized: true,
    })
    if (value.status !== 'idle') {
      throw new Error('An adopted Conversation must start idle')
    }
    const providerThreadId = value.providerThreadId
    if (providerThreadId === undefined) {
      throw new Error(
        'An adopted Conversation requires a native Provider session',
      )
    }
    return this.runInTransaction(() => {
      const existing = this.getConversationByProviderSession(
        value.machineId,
        value.provider,
        providerThreadId,
      )
      if (existing !== undefined) {
        if (
          existing.projectId !== value.projectId ||
          existing.cwd !== value.cwd
        ) {
          throw new NativeProviderSessionBindingConflictError(
            'Native Provider session is already bound to another Project Location',
          )
        }
        if (
          value.providerInstallationId !== undefined &&
          existing.providerInstallationId !== undefined &&
          existing.providerInstallationId !== value.providerInstallationId
        ) {
          throw new NativeProviderSessionBindingConflictError(
            'Native Provider session is already bound to another Provider installation',
          )
        }
        if (
          existing.providerInstallationId === undefined &&
          value.providerInstallationId !== undefined
        ) {
          this.#insertConversationProviderInstallationBinding(
            existing,
            value.providerInstallationId,
            value.createdAt,
          )
          return {
            conversation: requireConversation(
              this.getConversation(existing.conversationId),
              existing.conversationId,
            ),
            created: false,
          }
        }
        return { conversation: existing, created: false }
      }
      this.#insertConversation(value)
      return {
        conversation: requireConversation(
          this.getConversation(value.conversationId),
          value.conversationId,
        ),
        created: true,
      }
    })
  }

  updateConversation(conversation: DurableConversation): void {
    const value = parseConversation(conversation)
    const existing = requireConversation(
      this.getConversation(value.conversationId),
      value.conversationId,
    )
    if (
      existing.projectId !== value.projectId ||
      existing.machineId !== value.machineId ||
      existing.provider !== value.provider ||
      existing.providerInstallationId !== value.providerInstallationId ||
      existing.origin !== value.origin ||
      existing.nativeTranscriptBoundary !== value.nativeTranscriptBoundary ||
      (existing.providerThreadId !== undefined &&
        existing.providerThreadId !== value.providerThreadId) ||
      (existing.providerSessionMaterialized &&
        !value.providerSessionMaterialized) ||
      existing.cwd !== value.cwd
    ) {
      throw new Error('Conversation execution binding is immutable')
    }
    const result = this.#statement(
      `UPDATE conversations SET
        title = ?, title_source = ?, pinned_at = ?, archived_at = ?,
        provider_thread_id = ?, provider_session_materialized = ?, model = ?,
        reasoning = ?, status = ?, created_at = ?, updated_at = ?,
        last_activity_at = ?
      WHERE conversation_id = ?`,
    ).run(
      value.title,
      value.titleSource,
      value.pinnedAt ?? null,
      value.archivedAt ?? null,
      value.providerThreadId ?? null,
      value.providerSessionMaterialized ? 1 : 0,
      value.model ?? null,
      value.reasoning ?? null,
      value.status,
      value.createdAt,
      value.updatedAt,
      value.lastActivityAt,
      value.conversationId,
    )
    assertChanged(result.changes, 'Conversation', value.conversationId)
  }

  getConversation(
    conversationId: ConversationId,
  ): DurableConversation | undefined {
    const id = ConversationIdSchema.parse(conversationId)
    const row = this.#statement(
      `SELECT
         conversations.*,
         conversation_provider_installation_bindings.installation_id AS
           provider_installation_id
       FROM conversations
       LEFT JOIN conversation_provider_installation_bindings
         ON conversation_provider_installation_bindings.conversation_id =
              conversations.conversation_id
       WHERE conversations.conversation_id = ?`,
    ).get(id) as ConversationRow | undefined
    return row === undefined ? undefined : conversationFromRow(row)
  }

  listConversations(): DurableConversation[] {
    const rows = this.#statement(
      `SELECT
         conversations.*,
         conversation_provider_installation_bindings.installation_id AS
           provider_installation_id
       FROM conversations
       LEFT JOIN conversation_provider_installation_bindings
         ON conversation_provider_installation_bindings.conversation_id =
              conversations.conversation_id
       ORDER BY conversations.last_activity_at DESC,
         conversations.conversation_id ASC`,
    ).all() as unknown as ConversationRow[]
    return rows.map(conversationFromRow)
  }

  bindLegacyConversationInstallation(
    conversationId: ConversationId,
    installationId: ProviderInstallationId,
  ): DurableConversation {
    const conversationIdentity = ConversationIdSchema.parse(conversationId)
    const installationIdentity =
      ProviderInstallationIdSchema.parse(installationId)
    return this.runInTransaction(() => {
      const conversation = requireConversation(
        this.getConversation(conversationIdentity),
        conversationIdentity,
      )
      if (conversation.providerInstallationId !== undefined) {
        if (conversation.providerInstallationId !== installationIdentity) {
          throw new NativeProviderSessionBindingConflictError(
            'Conversation Provider installation is immutable',
          )
        }
        return conversation
      }
      this.#insertConversationProviderInstallationBinding(
        conversation,
        installationIdentity,
        new Date().toISOString(),
      )
      return requireConversation(
        this.getConversation(conversationIdentity),
        conversationIdentity,
      )
    })
  }

  renameConversation(
    conversationId: ConversationId,
    title: string,
    updatedAt: Timestamp,
  ): DurableConversationMutationResult {
    const id = ConversationIdSchema.parse(conversationId)
    const normalizedTitle = normalizeManualConversationTitle(title)
    const timestamp = TimestampSchema.parse(updatedAt)
    const existing = requireConversation(this.getConversation(id), id)
    if (
      existing.title === normalizedTitle &&
      existing.titleSource === 'manual'
    ) {
      return { conversation: existing, changed: false }
    }
    assertChanged(
      this.#statement(
        `UPDATE conversations SET
           title = ?, title_source = 'manual', updated_at = ?
         WHERE conversation_id = ?`,
      ).run(normalizedTitle, timestamp, id).changes,
      'Conversation',
      id,
    )
    return {
      conversation: requireConversation(this.getConversation(id), id),
      changed: true,
    }
  }

  pinConversation(
    conversationId: ConversationId,
    pinnedAt: Timestamp,
  ): DurableConversationMutationResult {
    const id = ConversationIdSchema.parse(conversationId)
    const timestamp = TimestampSchema.parse(pinnedAt)
    const existing = requireConversation(this.getConversation(id), id)
    if (existing.archivedAt !== undefined) {
      throw new ConversationOrganizationConflictError(
        'archived',
        `Conversation ${String(id)} is archived`,
      )
    }
    if (existing.pinnedAt !== undefined) {
      return { conversation: existing, changed: false }
    }
    assertChanged(
      this.#statement(
        `UPDATE conversations SET pinned_at = ?, updated_at = ?
         WHERE conversation_id = ? AND archived_at IS NULL`,
      ).run(timestamp, timestamp, id).changes,
      'Conversation',
      id,
    )
    return {
      conversation: requireConversation(this.getConversation(id), id),
      changed: true,
    }
  }

  unpinConversation(
    conversationId: ConversationId,
    updatedAt: Timestamp,
  ): DurableConversationMutationResult {
    const id = ConversationIdSchema.parse(conversationId)
    const timestamp = TimestampSchema.parse(updatedAt)
    const existing = requireConversation(this.getConversation(id), id)
    if (existing.pinnedAt === undefined) {
      return { conversation: existing, changed: false }
    }
    assertChanged(
      this.#statement(
        `UPDATE conversations SET pinned_at = NULL, updated_at = ?
         WHERE conversation_id = ?`,
      ).run(timestamp, id).changes,
      'Conversation',
      id,
    )
    return {
      conversation: requireConversation(this.getConversation(id), id),
      changed: true,
    }
  }

  archiveConversation(
    conversationId: ConversationId,
    archivedAt: Timestamp,
  ): DurableConversationMutationResult {
    const id = ConversationIdSchema.parse(conversationId)
    const timestamp = TimestampSchema.parse(archivedAt)
    return this.runInTransaction(() => {
      const existing = requireConversation(this.getConversation(id), id)
      if (existing.archivedAt !== undefined) {
        return { conversation: existing, changed: false }
      }
      if (existing.status === 'running' || existing.status === 'waiting') {
        throw new ConversationOrganizationConflictError(
          'active',
          `Conversation ${String(id)} is active`,
        )
      }
      if (this.hasOpenApprovalAttention(id)) {
        throw new ConversationOrganizationConflictError(
          'open_approval',
          `Conversation ${String(id)} has a pending Approval`,
        )
      }
      assertChanged(
        this.#statement(
          `UPDATE conversations SET
             archived_at = ?, pinned_at = NULL, updated_at = ?
           WHERE conversation_id = ?`,
        ).run(timestamp, timestamp, id).changes,
        'Conversation',
        id,
      )
      return {
        conversation: requireConversation(this.getConversation(id), id),
        changed: true,
      }
    })
  }

  unarchiveConversation(
    conversationId: ConversationId,
    updatedAt: Timestamp,
  ): DurableConversationMutationResult {
    const id = ConversationIdSchema.parse(conversationId)
    const timestamp = TimestampSchema.parse(updatedAt)
    const existing = requireConversation(this.getConversation(id), id)
    if (existing.archivedAt === undefined) {
      return { conversation: existing, changed: false }
    }
    assertChanged(
      this.#statement(
        `UPDATE conversations SET archived_at = NULL, updated_at = ?
         WHERE conversation_id = ?`,
      ).run(timestamp, id).changes,
      'Conversation',
      id,
    )
    return {
      conversation: requireConversation(this.getConversation(id), id),
      changed: true,
    }
  }

  hasOpenApprovalAttention(conversationId: ConversationId): boolean {
    const id = ConversationIdSchema.parse(conversationId)
    const row = this.#statement(
      `SELECT EXISTS(
         SELECT 1 FROM attention_items
         WHERE conversation_id = ? AND type = 'approval' AND status = 'open'
       ) AS present`,
    ).get(id) as { readonly present: number }
    return row.present === 1
  }

  listProjectConversations(
    projectId: ProjectId,
    options: ListProjectConversationsOptions = {},
  ): DurableConversationSummary[] {
    const id = ProjectIdSchema.parse(projectId)
    const limit = parseConversationListLimit(options.limit)
    const archived = parseConversationArchiveFilter(options.archived)
    const provider =
      options.provider === undefined
        ? undefined
        : ProviderIdSchema.parse(options.provider)
    if (
      options.status !== undefined &&
      !isOneOf(options.status, durableConversationStatuses)
    ) {
      throw new Error(
        `Unsupported durable Conversation status: ${String(options.status)}`,
      )
    }
    const filters = ['project_id = ?', "status <> 'creating'"]
    const parameters: Array<string | number> = [id]
    if (provider !== undefined) {
      filters.push('provider = ?')
      parameters.push(provider)
    }
    if (options.status !== undefined) {
      filters.push('status = ?')
      parameters.push(options.status)
    }
    if (archived === 'active') filters.push('archived_at IS NULL')
    if (archived === 'archived') filters.push('archived_at IS NOT NULL')
    parameters.push(limit)

    const orderBy =
      archived === 'archived'
        ? 'archived_at DESC, conversation_id ASC'
        : archived === 'active'
          ? `(pinned_at IS NULL) ASC, pinned_at DESC,
             last_activity_at DESC, conversation_id ASC`
          : `CASE WHEN archived_at IS NULL THEN 0 ELSE 1 END ASC,
             CASE WHEN archived_at IS NULL AND pinned_at IS NOT NULL
               THEN 0 ELSE 1 END ASC,
             CASE WHEN archived_at IS NULL THEN pinned_at END DESC,
             CASE WHEN archived_at IS NULL THEN last_activity_at END DESC,
             CASE WHEN archived_at IS NOT NULL THEN archived_at END DESC,
             conversation_id ASC`

    const rows = this.#statement(
      `SELECT
         conversation_id, project_id, machine_id, title, title_source, pinned_at,
         archived_at, provider, model, reasoning, status, created_at,
         updated_at, last_activity_at
       FROM conversations
       WHERE ${filters.join(' AND ')}
       ORDER BY ${orderBy}
       LIMIT ?`,
    ).all(...parameters) as unknown as ConversationSummaryRow[]
    return rows.map(conversationSummaryFromRow)
  }

  listMachineConversations(
    machineId: MachineId,
    limit: number = conversationListLimits.default,
  ): DurableConversationSummary[] {
    const id = MachineIdSchema.parse(machineId)
    const boundedLimit = parseConversationListLimit(limit)
    const rows = this.#statement(
      `SELECT
         conversation_id, project_id, machine_id, title, title_source,
         pinned_at, archived_at, provider, model, reasoning, status,
         created_at, updated_at, last_activity_at
       FROM conversations
       WHERE machine_id = ? AND status <> 'creating'
       ORDER BY last_activity_at DESC, conversation_id ASC
       LIMIT ?`,
    ).all(id, boundedLimit) as unknown as ConversationSummaryRow[]
    return rows.map(conversationSummaryFromRow)
  }

  searchProjectConversations(
    projectId: ProjectId,
    options: SearchProjectConversationsOptions,
  ): DurableConversationSearchResponse {
    const id = ProjectIdSchema.parse(projectId)
    const normalizedQuery = normalizeConversationSearchQuery(options.query)
    const archive = parseConversationArchiveFilter(options.archive)
    const limit = parseConversationSearchLimit(options.limit)
    const provider =
      options.provider === undefined
        ? undefined
        : ProviderIdSchema.parse(options.provider)
    if (
      options.status !== undefined &&
      !isOneOf(options.status, searchableConversationStatuses)
    ) {
      throw new Error(
        `Unsupported searchable Conversation status: ${String(options.status)}`,
      )
    }

    const cursorContext: ConversationSearchCursorContext = {
      projectId: id,
      query: normalizedQuery,
      archive,
      ...(provider === undefined ? {} : { provider }),
      ...(options.status === undefined ? {} : { status: options.status }),
    }
    const cursor =
      options.cursor === undefined
        ? undefined
        : decodeConversationSearchCursor(options.cursor, cursorContext)
    const filters = ['c.project_id = ?', "c.status <> 'creating'"]
    const parameters: Array<string | number> = [normalizedQuery]
    if (cursor !== undefined) {
      parameters.push(
        cursor.matchRank,
        cursor.archiveBucket,
        cursor.pinnedBucket,
        cursor.primaryTime,
        cursor.conversationId,
      )
    }
    parameters.push(id)
    if (provider !== undefined) {
      filters.push('c.provider = ?')
      parameters.push(provider)
    }
    if (options.status !== undefined) {
      filters.push('c.status = ?')
      parameters.push(options.status)
    }
    if (archive === 'active') filters.push('c.archived_at IS NULL')
    if (archive === 'archived') filters.push('c.archived_at IS NOT NULL')
    parameters.push(limit + 1)

    const cursorCte =
      cursor === undefined
        ? ''
        : `,
        cursor_value(
          match_rank, archive_bucket, pinned_bucket, primary_time,
          conversation_id
        ) AS (VALUES (?, ?, ?, ?, ?))`
    const cursorFilter =
      cursor === undefined
        ? ''
        : `AND (
          best.match_rank > cursor_value.match_rank OR
          (
            best.match_rank = cursor_value.match_rank AND
            best.archive_bucket > cursor_value.archive_bucket
          ) OR
          (
            best.match_rank = cursor_value.match_rank AND
            best.archive_bucket = cursor_value.archive_bucket AND
            best.pinned_bucket > cursor_value.pinned_bucket
          ) OR
          (
            best.match_rank = cursor_value.match_rank AND
            best.archive_bucket = cursor_value.archive_bucket AND
            best.pinned_bucket = cursor_value.pinned_bucket AND
            best.primary_time < cursor_value.primary_time
          ) OR
          (
            best.match_rank = cursor_value.match_rank AND
            best.archive_bucket = cursor_value.archive_bucket AND
            best.pinned_bucket = cursor_value.pinned_bucket AND
            best.primary_time = cursor_value.primary_time AND
            best.conversation_id > cursor_value.conversation_id
          )
        )`
    const cursorJoin = cursor === undefined ? '' : 'CROSS JOIN cursor_value'
    const rows = this.#statement(
      `WITH
        search_input(normalized_query) AS (VALUES (?))
        ${cursorCte},
        candidate_matches AS (
          SELECT
            c.conversation_id,
            c.project_id,
            c.machine_id,
            c.title,
            c.title_source,
            c.pinned_at,
            c.archived_at,
            c.provider,
            c.model,
            c.reasoning,
            c.status,
            c.created_at,
            c.updated_at,
            c.last_activity_at,
            d.field AS matched_field,
            d.turn_id AS matched_turn_id,
            CASE
              WHEN d.field = 'title' THEN c.title
              ELSE json_extract(t.input, '$.text')
            END AS match_source,
            CASE
              WHEN d.field = 'title' AND
                   d.normalized_text = search_input.normalized_query THEN 0
              WHEN d.field = 'title' AND
                   instr(d.normalized_text, search_input.normalized_query) = 1
                THEN 1
              WHEN d.field = 'title' THEN 2
              ELSE 3
            END AS match_rank,
            CASE WHEN c.archived_at IS NULL THEN 0 ELSE 1 END
              AS archive_bucket,
            CASE
              WHEN c.archived_at IS NULL AND c.pinned_at IS NOT NULL THEN 0
              ELSE 1
            END AS pinned_bucket,
            CASE
              WHEN c.archived_at IS NULL THEN c.last_activity_at
              ELSE c.archived_at
            END AS primary_time,
            ROW_NUMBER() OVER (
              PARTITION BY c.conversation_id
              ORDER BY
                CASE
                  WHEN d.field = 'title' AND
                       d.normalized_text = search_input.normalized_query THEN 0
                  WHEN d.field = 'title' AND
                       instr(
                         d.normalized_text,
                         search_input.normalized_query
                       ) = 1 THEN 1
                  WHEN d.field = 'title' THEN 2
                  ELSE 3
                END ASC,
                CASE WHEN d.field = 'user_input' THEN t.started_at END DESC,
                d.turn_id ASC
            ) AS match_choice
          FROM conversations AS c
          JOIN conversation_search_documents AS d
            ON d.conversation_id = c.conversation_id
          LEFT JOIN turns AS t
            ON t.turn_id = d.turn_id AND
               t.conversation_id = c.conversation_id
          CROSS JOIN search_input
          WHERE ${filters.join(' AND ')}
            AND instr(d.normalized_text, search_input.normalized_query) > 0
        ),
        best AS (
          SELECT * FROM candidate_matches WHERE match_choice = 1
        )
      SELECT best.*
      FROM best
      ${cursorJoin}
      WHERE 1 = 1
        ${cursorFilter}
      ORDER BY
        best.match_rank ASC,
        best.archive_bucket ASC,
        best.pinned_bucket ASC,
        best.primary_time DESC,
        best.conversation_id ASC
      LIMIT ?`,
    ).all(...parameters) as unknown as ConversationSearchRow[]

    const hasMore = rows.length > limit
    const pageRows = hasMore ? rows.slice(0, limit) : rows
    const results = pageRows.map((row) =>
      conversationSearchResultFromRow(row, normalizedQuery),
    )
    const last = pageRows.at(-1)
    return {
      results,
      ...(hasMore && last !== undefined
        ? {
            nextCursor: encodeConversationSearchCursor(cursorContext, {
              matchRank: last.match_rank,
              archiveBucket: last.archive_bucket,
              pinnedBucket: last.pinned_bucket,
              primaryTime: last.primary_time,
              conversationId: last.conversation_id,
            }),
          }
        : {}),
      hasMore,
    }
  }

  createAttentionItem(
    attention: NewDurableAttentionItem,
  ): DurableAttentionItem {
    const value = parseNewAttentionItem(attention)
    this.#statement(
      `INSERT INTO attention_items (
        attention_id, source_key, project_id, conversation_id, turn_id, type,
        status, payload_json, created_at, updated_at, resolved_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, NULL)`,
    ).run(
      value.attentionId,
      value.sourceKey,
      value.projectId,
      value.conversationId,
      value.turnId ?? null,
      value.type,
      serializeAttentionPayload(value.payload),
      value.createdAt,
      value.updatedAt,
    )
    return { ...value, status: 'open' }
  }

  upsertAttentionItem(
    attention: NewDurableAttentionItem,
  ): DurableAttentionUpsertResult {
    const value = parseNewAttentionItem(attention)
    const existing = this.getAttentionItemBySourceKey(value.sourceKey)
    if (existing === undefined) {
      return { item: this.createAttentionItem(value), created: true }
    }
    assertSameAttentionBinding(existing, value)
    if (
      existing.status !== 'open' ||
      Date.parse(value.updatedAt) <= Date.parse(existing.updatedAt)
    ) {
      return { item: existing, created: false }
    }
    this.#statement(
      `UPDATE attention_items SET payload_json = ?, updated_at = ?
       WHERE attention_id = ? AND status = 'open'`,
    ).run(
      serializeAttentionPayload(value.payload),
      value.updatedAt,
      existing.attentionId,
    )
    return {
      item: requireAttentionItem(
        this.getAttentionItem(existing.attentionId),
        existing.attentionId,
      ),
      created: false,
    }
  }

  getAttentionItem(attentionId: string): DurableAttentionItem | undefined {
    const id = parseAttentionId(attentionId)
    const row = this.#statement(
      'SELECT * FROM attention_items WHERE attention_id = ?',
    ).get(id) as AttentionRow | undefined
    return row === undefined ? undefined : attentionFromRow(row)
  }

  getAttentionItemBySourceKey(
    sourceKey: string,
  ): DurableAttentionItem | undefined {
    const key = parseBoundedText(sourceKey, 'Attention source key', 512)
    const row = this.#statement(
      'SELECT * FROM attention_items WHERE source_key = ?',
    ).get(key) as AttentionRow | undefined
    return row === undefined ? undefined : attentionFromRow(row)
  }

  listAttentionItems(
    options: ListAttentionItemsOptions = {},
  ): DurableAttentionItem[] {
    const limit = parseAttentionListLimit(options.limit)
    const filters: string[] = []
    const parameters: Array<string | number> = []
    if (options.projectId !== undefined) {
      filters.push('project_id = ?')
      parameters.push(ProjectIdSchema.parse(options.projectId))
    }
    if (options.conversationId !== undefined) {
      filters.push('conversation_id = ?')
      parameters.push(ConversationIdSchema.parse(options.conversationId))
    }
    if (options.turnId !== undefined) {
      filters.push('turn_id = ?')
      parameters.push(TurnIdSchema.parse(options.turnId))
    }
    if (options.type !== undefined) {
      filters.push('type = ?')
      parameters.push(parseAttentionType(options.type))
    }
    if (options.status !== undefined) {
      filters.push('status = ?')
      parameters.push(parseAttentionStatus(options.status))
    }
    parameters.push(limit)
    const where = filters.length === 0 ? '' : `WHERE ${filters.join(' AND ')}`
    const rows = this.#statement(
      `SELECT * FROM attention_items
       ${where}
       ORDER BY
         CASE type
           WHEN 'approval' THEN 0
           WHEN 'failed' THEN 1
           ELSE 2
         END,
         created_at DESC,
         attention_id ASC
       LIMIT ?`,
    ).all(...parameters) as unknown as AttentionRow[]
    return rows.map(attentionFromRow)
  }

  summarizeAttentionItems(
    options: SummarizeAttentionItemsOptions = {},
  ): DurableAttentionSummary {
    const filters: string[] = []
    const parameters: string[] = []
    if (options.projectId !== undefined) {
      filters.push('project_id = ?')
      parameters.push(ProjectIdSchema.parse(options.projectId))
    }
    if (options.conversationId !== undefined) {
      filters.push('conversation_id = ?')
      parameters.push(ConversationIdSchema.parse(options.conversationId))
    }
    const where = filters.length === 0 ? '' : `WHERE ${filters.join(' AND ')}`
    const row = this.#statement(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END), 0) AS open,
         COALESCE(SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END), 0)
           AS resolved,
         COALESCE(SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END), 0)
           AS expired,
         COALESCE(SUM(CASE WHEN status = 'open' AND type = 'approval'
           THEN 1 ELSE 0 END), 0)
           AS open_approval,
         COALESCE(SUM(CASE WHEN status = 'open' AND type = 'completed_review'
           THEN 1 ELSE 0 END), 0) AS open_completed_review,
         COALESCE(SUM(CASE WHEN status = 'open' AND type = 'failed'
           THEN 1 ELSE 0 END), 0)
           AS open_failed
       FROM attention_items
       ${where}`,
    ).get(...parameters) as unknown as AttentionSummaryRow
    return {
      total: row.total,
      open: row.open,
      resolved: row.resolved,
      expired: row.expired,
      openApproval: row.open_approval,
      openCompletedReview: row.open_completed_review,
      openFailed: row.open_failed,
    }
  }

  resolveAttentionItem(
    attentionId: string,
    resolvedAt: Timestamp,
    payloadPatch: Readonly<Record<string, unknown>> = {},
  ): DurableAttentionResolveResult | undefined {
    const existing = this.getAttentionItem(attentionId)
    if (existing === undefined) return undefined
    if (existing.status !== 'open') {
      return { item: existing, changed: false }
    }
    const timestamp = TimestampSchema.parse(resolvedAt)
    if (Date.parse(timestamp) < Date.parse(existing.createdAt)) {
      throw new Error('Attention resolvedAt must not precede createdAt')
    }
    const payload = { ...existing.payload, ...payloadPatch }
    const result = this.#statement(
      `UPDATE attention_items SET
         status = 'resolved', payload_json = ?, updated_at = ?, resolved_at = ?
       WHERE attention_id = ? AND status = 'open'`,
    ).run(
      serializeAttentionPayload(payload),
      timestamp,
      timestamp,
      existing.attentionId,
    )
    if (result.changes === 0 || result.changes === 0n) {
      const current = requireAttentionItem(
        this.getAttentionItem(existing.attentionId),
        existing.attentionId,
      )
      return { item: current, changed: false }
    }
    return {
      item: requireAttentionItem(
        this.getAttentionItem(existing.attentionId),
        existing.attentionId,
      ),
      changed: true,
    }
  }

  expireOpenApprovalAttentionItems(expiredAt: Timestamp): number {
    const timestamp = TimestampSchema.parse(expiredAt)
    const result = this.#statement(
      `UPDATE attention_items SET
         status = 'expired',
         payload_json = json_set(
           payload_json, '$.expirationReason', 'host_restart'
         ),
         updated_at = ?,
         resolved_at = ?
       WHERE type = 'approval' AND status = 'open'`,
    ).run(timestamp, timestamp)
    return Number(result.changes)
  }

  deleteConversation(conversationId: ConversationId): boolean {
    const id = ConversationIdSchema.parse(conversationId)
    return (
      this.#statement(
        'DELETE FROM conversations WHERE conversation_id = ?',
      ).run(id).changes > 0
    )
  }

  createTurn(turn: DurableTurnSnapshot): void {
    const value = parseTurn(turn)
    this.#statement(
      `INSERT INTO turns (
        turn_id, conversation_id, provider_turn_id, input, status, started_at,
        completed_at, snapshot_version, snapshot_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      value.turnId,
      value.conversationId,
      value.providerTurnId ?? null,
      JSON.stringify(value.input),
      value.status,
      value.startedAt,
      value.completedAt ?? null,
      value.snapshotVersion,
      serializeSnapshot(value.snapshot),
    )
  }

  /**
   * Atomically creates the durable Turn, binds its Start action identity, and
   * advances the owning Conversation. A durable action can therefore never
   * exist without its exact Turn, and Provider execution remains strictly
   * after this transaction commits.
   */
  createTurnForStartAction(input: CreateDurableTurnForStartAction): void {
    const actionId = ActionIdSchema.parse(input.actionId)
    const turn = parseTurn(input.turn)
    const conversation = parseConversation(input.conversation)
    if (turn.conversationId !== conversation.conversationId) {
      throw new Error('Start action Turn must belong to its Conversation')
    }
    this.runInTransaction(() => {
      this.createTurn(turn)
      this.#statement(
        `INSERT INTO turn_start_actions (action_id, turn_id, created_at)
         VALUES (?, ?, ?)`,
      ).run(actionId, turn.turnId, turn.startedAt)
      this.updateConversation(conversation)
    })
  }

  updateTurn(turn: DurableTurnSnapshot): void {
    const value = parseTurn(turn)
    const result = this.#statement(
      `UPDATE turns SET
        conversation_id = ?, provider_turn_id = ?, input = ?, status = ?,
        started_at = ?, completed_at = ?, snapshot_version = ?, snapshot_json = ?
      WHERE turn_id = ?
        AND (
          status NOT IN ('completed', 'failed', 'interrupted')
          OR status = ?
        )`,
    ).run(
      value.conversationId,
      value.providerTurnId ?? null,
      JSON.stringify(value.input),
      value.status,
      value.startedAt,
      value.completedAt ?? null,
      value.snapshotVersion,
      serializeSnapshot(value.snapshot),
      value.turnId,
      value.status,
    )
    assertChanged(result.changes, 'Turn', value.turnId)
  }

  getTurn(turnId: TurnId): DurableTurnSnapshot | undefined {
    const id = TurnIdSchema.parse(turnId)
    const row = this.#statement('SELECT * FROM turns WHERE turn_id = ?').get(
      id,
    ) as TurnRow | undefined
    return row === undefined ? undefined : turnFromRow(row)
  }

  getTurnForStartAction(actionId: ActionId): DurableTurnSnapshot | undefined {
    const id = ActionIdSchema.parse(actionId)
    const row = this.#statement(
      `SELECT turns.*
       FROM turn_start_actions
       INNER JOIN turns ON turns.turn_id = turn_start_actions.turn_id
       WHERE turn_start_actions.action_id = ?`,
    ).get(id) as TurnRow | undefined
    return row === undefined ? undefined : turnFromRow(row)
  }

  listTurns(conversationId: ConversationId): DurableTurnSnapshot[] {
    return this.#listTurns(conversationId)
  }

  listRecentTurns(
    conversationId: ConversationId,
    limit: number,
  ): DurableTurnSnapshot[] {
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new Error('Recent Turn limit must be a positive integer')
    }
    const descending = this.#listTurns(conversationId, limit, true)
    return descending.reverse()
  }

  countTurns(conversationId: ConversationId): number {
    const id = ConversationIdSchema.parse(conversationId)
    const row = this.#statement(
      'SELECT COUNT(*) AS count FROM turns WHERE conversation_id = ?',
    ).get(id) as { readonly count: number }
    return row.count
  }

  listIncompleteTurns(): DurableTurnSnapshot[] {
    const rows = this.#statement(
      `SELECT * FROM turns
       WHERE status IN ('starting', 'running', 'waiting')
       ORDER BY started_at ASC, turn_id ASC`,
    ).all() as unknown as TurnRow[]
    return rows.map(turnFromRow)
  }

  runInTransaction<T>(operation: () => T): T {
    this.#assertOpen()
    this.#database.exec('BEGIN IMMEDIATE')
    try {
      const result = operation()
      this.#database.exec('COMMIT')
      return result
    } catch (error) {
      try {
        this.#database.exec('ROLLBACK')
      } catch {
        // Preserve the original operation failure.
      }
      throw error
    }
  }

  checkpoint(): void {
    this.#assertOpen()
    this.#database.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  }

  close(): void {
    if (this.#closed) return
    let checkpointError: unknown
    try {
      this.checkpoint()
    } catch (error) {
      checkpointError = error
    }
    try {
      this.#database.close()
    } finally {
      this.#closed = true
    }
    if (checkpointError !== undefined) throw checkpointError
  }

  #listTurns(
    conversationId: ConversationId,
    limit?: number,
    descending = false,
  ): DurableTurnSnapshot[] {
    const id = ConversationIdSchema.parse(conversationId)
    const direction = descending ? 'DESC' : 'ASC'
    const sql = `SELECT * FROM turns
      WHERE conversation_id = ?
      ORDER BY started_at ${direction}, rowid ${direction}${limit === undefined ? '' : ' LIMIT ?'}`
    const rows = (limit === undefined
      ? this.#statement(sql).all(id)
      : this.#statement(sql).all(id, limit)) as unknown as TurnRow[]
    return rows.map(turnFromRow)
  }

  #providerInstallationFromRow(
    row: ProviderInstallationRow,
  ): DurableProviderInstallation {
    const installationId = ProviderInstallationIdSchema.parse(
      row.installation_id,
    )
    const compatibilityRow = this.#statement(
      `SELECT * FROM provider_installation_compatibility
       WHERE installation_id = ?`,
    ).get(installationId) as ProviderCompatibilityRow | undefined
    const backendRow = this.#statement(
      `SELECT * FROM provider_backend_observations
       WHERE installation_id = ?`,
    ).get(installationId) as ProviderBackendObservationRow | undefined
    if (
      compatibilityRow !== undefined &&
      compatibilityRow.installation_revision !== row.installation_revision
    ) {
      throw new Error('Provider compatibility revision is stale')
    }
    if (
      backendRow !== undefined &&
      backendRow.installation_revision !== row.installation_revision
    ) {
      throw new Error('Provider backend observation revision is stale')
    }
    return parseDurableProviderInstallation({
      installationId,
      machineId: MachineIdSchema.parse(row.machine_id),
      provider: ProviderIdSchema.parse(row.provider),
      locatorKey: row.locator_key,
      ...(row.launcher_path === null
        ? {}
        : { launcherPath: row.launcher_path }),
      ...(row.resolved_executable_path === null
        ? {}
        : { resolvedExecutablePath: row.resolved_executable_path }),
      selected: parseStoredBoolean(row.selected, 'Provider selection'),
      ...(row.observed_version === null
        ? {}
        : { version: row.observed_version }),
      launcherKind: parseProviderInstallationLauncherKind(row.launcher_kind),
      installMethod: parseProviderInstallationMethod(row.install_method),
      availability: parseProviderInstallationAvailability(row.availability),
      ...(row.installation_revision === null
        ? {}
        : {
            revision: ProviderInstallationRevisionSchema.parse(
              row.installation_revision,
            ),
          }),
      firstObservedAt: TimestampSchema.parse(row.first_observed_at),
      lastObservedAt: TimestampSchema.parse(row.last_observed_at),
      ...(compatibilityRow === undefined
        ? {}
        : { compatibility: compatibilityFromRow(compatibilityRow) }),
      ...(backendRow === undefined
        ? {}
        : { backend: backendObservationFromRow(backendRow) }),
    })
  }

  #recordProviderCompatibility(
    installationId: ProviderInstallationId,
    revision: DurableProviderInstallation['revision'],
    observation: ProviderCompatibilityObservation,
  ): void {
    const capabilitiesJson = serializeBoundedJson(
      observation.capabilities,
      'Provider compatibility capabilities',
      16_384,
    )
    const failureJson =
      observation.failure === undefined
        ? null
        : serializeBoundedJson(
            observation.failure,
            'Provider compatibility failure',
            4_096,
          )
    this.#statement(
      `INSERT INTO provider_installation_compatibility (
         installation_id, installation_revision, contract_version, state,
         runtime_readiness, freshness, capabilities_json, failure_json,
         observed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(installation_id) DO UPDATE SET
         installation_revision = excluded.installation_revision,
         contract_version = excluded.contract_version,
         state = excluded.state,
         runtime_readiness = excluded.runtime_readiness,
         freshness = excluded.freshness,
         capabilities_json = excluded.capabilities_json,
         failure_json = excluded.failure_json,
         observed_at = excluded.observed_at
       WHERE
         provider_installation_compatibility.installation_revision IS
           excluded.installation_revision AND
         (
           provider_installation_compatibility.observed_at IS NULL OR
           (
             excluded.observed_at IS NOT NULL AND
             julianday(excluded.observed_at) >
               julianday(provider_installation_compatibility.observed_at)
           )
         )`,
    ).run(
      installationId,
      revision ?? null,
      observation.contractVersion,
      observation.state,
      observation.runtimeReadiness,
      observation.freshness,
      capabilitiesJson,
      failureJson,
      observation.observedAt ?? null,
    )
  }

  #markProviderCompatibilityLastKnown(
    installationId: ProviderInstallationId,
    revision: DurableProviderInstallation['revision'],
  ): void {
    this.#statement(
      `UPDATE provider_installation_compatibility
       SET freshness = 'last_known'
       WHERE installation_id = ?
         AND installation_revision IS ?
         AND freshness = 'current'`,
    ).run(installationId, revision ?? null)
  }

  #pruneUnboundProviderInstallations(
    machineId: MachineId,
    provider: ProviderId,
  ): void {
    this.#statement(
      `DELETE FROM provider_installations
       WHERE installation_id IN (
         SELECT candidate.installation_id
         FROM provider_installations AS candidate
         WHERE
           candidate.machine_id = ? AND
           candidate.provider = ? AND
           NOT EXISTS (
             SELECT 1
             FROM machine_provider_installation_selections AS selection
             WHERE
               selection.machine_id = candidate.machine_id AND
               selection.provider = candidate.provider AND
               selection.installation_id = candidate.installation_id
           ) AND
           NOT EXISTS (
             SELECT 1
             FROM conversation_provider_installation_bindings AS binding
             WHERE binding.installation_id = candidate.installation_id
         )
         ORDER BY
           CASE candidate.availability
             WHEN 'unavailable' THEN 1
             ELSE 0
           END ASC,
           julianday(candidate.first_observed_at) DESC,
           candidate.first_observed_at DESC,
           julianday(candidate.last_observed_at) DESC,
           candidate.last_observed_at DESC,
           candidate.installation_id ASC
         LIMIT -1 OFFSET ?
       )`,
    ).run(
      MachineIdSchema.parse(machineId),
      ProviderIdSchema.parse(provider),
      MAXIMUM_RETAINED_UNBOUND_PROVIDER_INSTALLATIONS,
    )
  }

  #recordProviderBackend(
    installationId: ProviderInstallationId,
    revision: DurableProviderInstallation['revision'],
    observation: ProviderBackendObservation,
  ): void {
    const configurationJson = serializeBoundedJson(
      observation.configuration,
      'Provider backend configuration',
      4_096,
    )
    const failureJson =
      observation.failure === undefined
        ? null
        : serializeBoundedJson(
            observation.failure,
            'Provider backend failure',
            4_096,
          )
    this.#statement(
      `INSERT INTO provider_backend_observations (
         installation_id, installation_revision, configuration_revision,
         mode, readiness, freshness, configuration_json, sanitized_origin,
         failure_json, observed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(installation_id) DO UPDATE SET
         installation_revision = excluded.installation_revision,
         configuration_revision = excluded.configuration_revision,
         mode = excluded.mode,
         readiness = excluded.readiness,
         freshness = excluded.freshness,
         configuration_json = excluded.configuration_json,
         sanitized_origin = excluded.sanitized_origin,
         failure_json = excluded.failure_json,
         observed_at = excluded.observed_at
       WHERE
         provider_backend_observations.installation_revision IS
           excluded.installation_revision AND
         (
           provider_backend_observations.observed_at IS NULL OR
           (
             excluded.observed_at IS NOT NULL AND
             julianday(excluded.observed_at) >
               julianday(provider_backend_observations.observed_at)
           )
         )`,
    ).run(
      installationId,
      revision ?? null,
      observation.configurationRevision ?? null,
      observation.mode,
      observation.readiness,
      observation.freshness,
      configurationJson,
      observation.sanitizedOrigin ?? null,
      failureJson,
      observation.observedAt ?? null,
    )
  }

  /**
   * A metadata-only lifecycle refresh cannot manufacture current backend
   * health. Preserve the last explicit execution/auth observation and its
   * original timestamp, while making its staleness truthful.
   */
  #markProviderBackendLastKnown(
    installationId: ProviderInstallationId,
    revision: DurableProviderInstallation['revision'],
    configurationRevision: ProviderBackendObservation['configurationRevision'],
  ): void {
    this.#statement(
      `UPDATE provider_backend_observations
       SET freshness = 'last_known'
       WHERE installation_id = ?
         AND installation_revision IS ?
         AND configuration_revision IS ?
         AND freshness = 'current'`,
    ).run(installationId, revision ?? null, configurationRevision ?? null)
  }

  #markProviderBackendObservationLastKnown(
    installationId: ProviderInstallationId,
    revision: DurableProviderInstallation['revision'],
  ): void {
    this.#statement(
      `UPDATE provider_backend_observations
       SET freshness = 'last_known'
       WHERE installation_id = ?
         AND installation_revision IS ?
         AND freshness = 'current'`,
    ).run(installationId, revision ?? null)
  }

  #insertConversationProviderInstallationBinding(
    conversation: Pick<
      DurableConversation,
      'conversationId' | 'machineId' | 'provider'
    >,
    installationId: ProviderInstallationId,
    boundAt: Timestamp,
  ): void {
    this.#statement(
      `INSERT INTO conversation_provider_installation_bindings (
         conversation_id, machine_id, provider, installation_id, bound_at
       ) VALUES (?, ?, ?, ?, ?)`,
    ).run(
      conversation.conversationId,
      conversation.machineId,
      conversation.provider,
      ProviderInstallationIdSchema.parse(installationId),
      TimestampSchema.parse(boundAt),
    )
  }

  #assertRemoteTrustIdentityAvailable(
    machine: DurableMachine,
    peer: DurableTrustedMachinePeer,
  ): void {
    if (
      this.#statement('SELECT 1 FROM machines WHERE machine_id = ?').get(
        machine.machineId,
      ) !== undefined
    ) {
      throw new RemoteMachineTrustConflictError(
        'machine_identity',
        'Remote Machine identity is already registered',
      )
    }
    if (
      this.#statement(
        'SELECT 1 FROM trusted_machine_peers WHERE node_identity = ?',
      ).get(peer.nodeIdentity) !== undefined
    ) {
      throw new RemoteMachineTrustConflictError(
        'peer_identity',
        'Remote Node identity is already trusted',
      )
    }
    if (
      this.#statement(
        `SELECT 1 FROM trusted_machine_peers
         WHERE peer_key_fingerprint = ? OR peer_public_key_spki = ?`,
      ).get(peer.peerKeyFingerprint, peer.peerPublicKeySpki) !== undefined
    ) {
      throw new RemoteMachineTrustConflictError(
        'peer_key',
        'Remote Node key is already trusted',
      )
    }
    if (
      this.#statement(
        `SELECT 1 FROM trusted_machine_peers
         WHERE controller_credential_ref = ?`,
      ).get(peer.controllerCredentialRef) !== undefined
    ) {
      throw new RemoteMachineTrustConflictError(
        'controller_credential',
        'Controller credential is already bound to another Machine',
      )
    }
  }

  #statement(sql: string) {
    this.#assertOpen()
    return this.#database.prepare(sql)
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('ConversationStore is closed')
  }
}

interface ConversationRow {
  readonly conversation_id: string
  readonly project_id: string
  readonly machine_id: string
  readonly title: string
  readonly title_source: string
  readonly pinned_at: string | null
  readonly archived_at: string | null
  readonly provider: string
  readonly provider_installation_id: string | null
  readonly provider_thread_id: string | null
  readonly native_transcript_boundary: string | null
  readonly origin: string
  readonly provider_session_materialized: number
  readonly cwd: string
  readonly model: string | null
  readonly reasoning: string | null
  readonly status: string
  readonly created_at: string
  readonly updated_at: string
  readonly last_activity_at: string
}

interface ConversationSummaryRow {
  readonly conversation_id: string
  readonly project_id: string
  readonly machine_id: string
  readonly title: string
  readonly title_source: string
  readonly pinned_at: string | null
  readonly archived_at: string | null
  readonly provider: string
  readonly model: string | null
  readonly reasoning: string | null
  readonly status: string
  readonly created_at: string
  readonly updated_at: string
  readonly last_activity_at: string
}

interface ConversationSearchRow extends ConversationSummaryRow {
  readonly matched_field: 'title' | 'user_input'
  readonly matched_turn_id: string | null
  readonly match_source: string
  readonly match_rank: number
  readonly archive_bucket: number
  readonly pinned_bucket: number
  readonly primary_time: string
}

interface ProjectRow {
  readonly project_id: string
  readonly name: string
  readonly project_created_at: string
  readonly project_updated_at: string
  readonly machine_id: string
  readonly root_path: string
  readonly root_path_key: string
  readonly location_created_at: string
  readonly location_updated_at: string
}

interface ProjectLocationRow {
  readonly project_id: string
  readonly machine_id: string
  readonly root_path: string
  readonly root_path_key: string
  readonly created_at: string
  readonly updated_at: string
}

interface MachineRow {
  readonly machine_id: string
  readonly display_name: string
  readonly kind: string
  readonly platform: string
  readonly architecture: string
  readonly created_at: string
  readonly updated_at: string
  readonly last_seen_at: string | null
}

interface OnboardingProgressRow {
  readonly singleton: 1
  readonly flow_version: 1
  readonly step: string
  readonly revision: number
  readonly project_id: string | null
  readonly machine_id: string | null
  readonly previous_conversations_disposition: string | null
  readonly remote_setup_disposition: string | null
  readonly last_action_id: string | null
  readonly started_at: string
  readonly updated_at: string
  readonly completed_at: string | null
}

interface TrustedMachinePeerRow {
  readonly machine_id: string
  readonly node_identity: string
  readonly peer_public_key_spki: Uint8Array
  readonly peer_key_fingerprint: string
  readonly controller_credential_ref: string
  readonly controller_key_fingerprint: string
  readonly trust_state: string
  readonly protocol_version: number
  readonly paired_at: string
  readonly updated_at: string
  readonly last_authenticated_at: string | null
}

interface TrustedMachineEndpointRow {
  readonly machine_id: string
  readonly endpoint_host: string
  readonly endpoint_port: number
  readonly source: string
  readonly preferred: number
  readonly created_at: string
  readonly updated_at: string
  readonly last_successful_at: string | null
  readonly last_failure_at: string | null
}

interface RemoteProviderObservationRow {
  readonly machine_id: string
  readonly provider: string
  readonly descriptor_json: string
  readonly observed_at: string
}

interface ProviderExecutionHealthRow {
  readonly machine_id: string
  readonly provider: string
  readonly state: string
  readonly failure_json: string | null
  readonly observed_at: string
}

interface ProviderInstallationRow {
  readonly installation_id: string
  readonly machine_id: string
  readonly provider: string
  readonly locator_key: string
  readonly launcher_path: string | null
  readonly resolved_executable_path: string | null
  readonly launcher_kind: string
  readonly install_method: string
  readonly availability: string
  readonly observed_version: string | null
  readonly installation_revision: string | null
  readonly first_observed_at: string
  readonly last_observed_at: string
  readonly selected: number
}

interface ProviderCompatibilityRow {
  readonly installation_id: string
  readonly installation_revision: string | null
  readonly contract_version: number
  readonly state: string
  readonly runtime_readiness: string
  readonly freshness: string
  readonly capabilities_json: string
  readonly failure_json: string | null
  readonly observed_at: string | null
}

interface ProviderBackendObservationRow {
  readonly installation_id: string
  readonly installation_revision: string | null
  readonly configuration_revision: string | null
  readonly mode: string
  readonly readiness: string
  readonly freshness: string
  readonly configuration_json: string
  readonly sanitized_origin: string | null
  readonly failure_json: string | null
  readonly observed_at: string | null
}

interface MachineRelayConfigurationRow {
  readonly machine_id: string
  readonly endpoint_host: string
  readonly endpoint_port: number
  readonly transport_security: string
  readonly relay_identity_fingerprint: string
  readonly display_label: string | null
  readonly enabled: number
  readonly enrollment_state: string
  readonly created_at: string
  readonly updated_at: string
  readonly enrolled_at: string | null
  readonly last_connected_at: string | null
  readonly last_attempt_at: string | null
}

interface TurnRow {
  readonly turn_id: string
  readonly conversation_id: string
  readonly provider_turn_id: string | null
  readonly input: string
  readonly status: string
  readonly started_at: string
  readonly completed_at: string | null
  readonly snapshot_version: number
  readonly snapshot_json: string
}

interface AttentionSummaryRow {
  readonly total: number
  readonly open: number
  readonly resolved: number
  readonly expired: number
  readonly open_approval: number
  readonly open_completed_review: number
  readonly open_failed: number
}

function parseProject(value: DurableProject): DurableProject {
  const projectId = ProjectIdSchema.parse(value.projectId)
  const legacyLocation = (
    value as DurableProject & { readonly location?: DurableProjectLocation }
  ).location
  const locations = (
    value.locations ?? (legacyLocation === undefined ? [] : [legacyLocation])
  ).map(parseProjectLocation)
  if (
    locations.length < 1 ||
    locations.length > machineWireLimits.projectLocations
  ) {
    throw new Error('Project must have a bounded durable location set')
  }
  const machineIds = new Set<MachineId>()
  const locationKeys = new Set<string>()
  for (const location of locations) {
    if (location.projectId !== projectId) {
      throw new Error('Project locations must belong to their Project')
    }
    if (machineIds.has(location.machineId)) {
      throw new Error('Project can have at most one location per Machine')
    }
    const key = JSON.stringify([location.machineId, location.rootPathKey])
    if (locationKeys.has(key)) {
      throw new Error('Project location identity is duplicated')
    }
    machineIds.add(location.machineId)
    locationKeys.add(key)
  }
  return {
    projectId,
    name: parseBoundedText(value.name, 'Project name', 240),
    locations: [...locations].sort((left, right) =>
      left.machineId.localeCompare(right.machineId),
    ),
    createdAt: TimestampSchema.parse(value.createdAt),
    updatedAt: TimestampSchema.parse(value.updatedAt),
  }
}

function parseProjectLocation(
  value: DurableProjectLocation,
): DurableProjectLocation {
  const rootPath = parseCanonicalProjectRoot(value.rootPath)
  const rootPathKey = parseRootPathKey(value.rootPathKey)
  const expectedRootPathKey = rootPath.startsWith('/')
    ? rootPath
    : rootPath.toLowerCase()
  if (rootPathKey !== expectedRootPathKey) {
    throw new Error(
      'Project root path key does not match its trusted root path',
    )
  }
  return {
    projectId: ProjectIdSchema.parse(value.projectId),
    machineId: MachineIdSchema.parse(value.machineId),
    rootPath,
    rootPathKey,
    createdAt: TimestampSchema.parse(value.createdAt),
    updatedAt: TimestampSchema.parse(value.updatedAt),
  }
}

function machineFromRow(row: MachineRow): DurableMachine {
  if (row.kind !== 'local' && row.kind !== 'remote') {
    throw new Error(`Unsupported durable Machine kind: ${row.kind}`)
  }
  return parseMachine({
    machineId: MachineIdSchema.parse(row.machine_id),
    displayName: parseBoundedText(
      row.display_name,
      'Machine display name',
      240,
    ),
    kind: row.kind,
    platform: parseBoundedText(row.platform, 'Machine platform', 64),
    architecture: parseBoundedText(
      row.architecture,
      'Machine architecture',
      64,
    ),
    createdAt: TimestampSchema.parse(row.created_at),
    ...(row.last_seen_at === null
      ? {}
      : { lastSeenAt: TimestampSchema.parse(row.last_seen_at) }),
  })
}

function onboardingProgressFromRow(
  row: OnboardingProgressRow,
): OnboardingProgress {
  return OnboardingProgressSchema.parse({
    flowVersion: row.flow_version,
    step: row.step,
    revision: row.revision,
    ...(row.project_id === null ? {} : { projectId: row.project_id }),
    ...(row.machine_id === null ? {} : { machineId: row.machine_id }),
    ...(row.previous_conversations_disposition === null
      ? {}
      : {
          previousConversationsDisposition:
            row.previous_conversations_disposition,
        }),
    ...(row.remote_setup_disposition === null
      ? {}
      : { remoteSetupDisposition: row.remote_setup_disposition }),
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    ...(row.completed_at === null ? {} : { completedAt: row.completed_at }),
  })
}

function onboardingTransitionSatisfied(
  current: OnboardingProgress,
  transition: OnboardingTransition,
): boolean {
  switch (transition.kind) {
    case 'continue':
      return false
    case 'project_reselect':
      return current.step === 'project_setup'
    case 'project_selected':
      return (
        current.projectId === transition.projectId &&
        current.machineId === transition.machineId &&
        onboardingStepIndex(current.step) >=
          onboardingStepIndex('previous_conversations')
      )
    case 'previous_conversations_finished':
      return (
        current.previousConversationsDisposition === transition.disposition &&
        onboardingStepIndex(current.step) >= onboardingStepIndex('remote_setup')
      )
    case 'remote_setup_finished':
      return (
        current.remoteSetupDisposition === transition.disposition &&
        current.completedAt !== undefined &&
        current.step === 'ready'
      )
    case 'reopen':
      return current.completedAt !== undefined && current.step === 'welcome'
  }
}

function advanceOnboarding(
  current: OnboardingProgress,
  transition: OnboardingTransition,
  updatedAt: Timestamp,
): OnboardingProgress | undefined {
  let update: Partial<OnboardingProgress>
  switch (transition.kind) {
    case 'continue': {
      const next = {
        welcome: 'computer_check',
        computer_check: 'provider_check',
        provider_check: 'project_setup',
      } as const
      const step = next[current.step as keyof typeof next]
      if (step === undefined) return undefined
      update = { step }
      break
    }
    case 'project_reselect':
      if (
        (current.step !== 'previous_conversations' &&
          current.step !== 'remote_setup') ||
        current.projectId !== undefined ||
        current.machineId !== undefined
      ) {
        return undefined
      }
      update = {
        step: 'project_setup',
        previousConversationsDisposition: undefined,
        remoteSetupDisposition: undefined,
      }
      break
    case 'project_selected':
      if (current.step !== 'project_setup') return undefined
      update = {
        step: 'previous_conversations',
        projectId: transition.projectId,
        machineId: transition.machineId,
        previousConversationsDisposition: undefined,
        remoteSetupDisposition: undefined,
      }
      break
    case 'previous_conversations_finished':
      if (
        current.step !== 'previous_conversations' ||
        current.projectId === undefined ||
        current.machineId === undefined
      ) {
        return undefined
      }
      update = {
        step: 'remote_setup',
        previousConversationsDisposition: transition.disposition,
      }
      break
    case 'remote_setup_finished':
      if (
        current.step !== 'remote_setup' ||
        current.projectId === undefined ||
        current.machineId === undefined
      ) {
        return undefined
      }
      update = {
        step: 'ready',
        remoteSetupDisposition: transition.disposition,
        completedAt: current.completedAt ?? updatedAt,
      }
      break
    case 'reopen':
      if (current.completedAt === undefined) return undefined
      update = { step: 'welcome' }
      break
  }
  return OnboardingProgressSchema.parse({
    ...current,
    ...update,
    revision: current.revision + 1,
    updatedAt,
  })
}

function onboardingStepIndex(step: OnboardingProgress['step']): number {
  return [
    'welcome',
    'computer_check',
    'provider_check',
    'project_setup',
    'previous_conversations',
    'remote_setup',
    'ready',
  ].indexOf(step)
}

function parseMachine(value: DurableMachine): DurableMachine {
  if (value.kind !== 'local' && value.kind !== 'remote') {
    throw new Error(`Unsupported durable Machine kind: ${String(value.kind)}`)
  }
  return {
    machineId: MachineIdSchema.parse(value.machineId),
    displayName: parseBoundedText(
      value.displayName,
      'Machine display name',
      240,
    ),
    kind: value.kind,
    platform: parseBoundedText(value.platform, 'Machine platform', 64),
    architecture: parseBoundedText(
      value.architecture,
      'Machine architecture',
      64,
    ),
    createdAt: TimestampSchema.parse(value.createdAt),
    ...(value.lastSeenAt === undefined
      ? {}
      : { lastSeenAt: TimestampSchema.parse(value.lastSeenAt) }),
  }
}

function parseRemoteProviderObservation(
  value: DurableRemoteProviderObservation,
): DurableRemoteProviderObservation {
  const machineId = MachineIdSchema.parse(value.machineId)
  if (value.providers.length !== 2) {
    throw new Error('Remote Provider observation count is invalid')
  }
  const identities = new Set<ProviderId>()
  const providers = value.providers.map((provider) => {
    const descriptor = ProviderDescriptorSchema.parse(provider)
    const enabledCapabilities = Object.entries(descriptor.capabilities)
      .filter(([, enabled]) => enabled)
      .map(([capability]) => capability)
    const admittedExecutionFoundation =
      remoteProviderExecutionFoundation(descriptor)
    if (enabledCapabilities.length > 0 && !admittedExecutionFoundation) {
      throw new Error(
        'Remote Provider capabilities exceed an admitted execution foundation',
      )
    }
    const hasReasoningMetadata =
      descriptor.reasoningLabel !== undefined ||
      descriptor.reasoningOptions !== undefined
    if (
      hasReasoningMetadata !==
      (descriptor.provider === 'claude-code' &&
        descriptor.capabilities.reasoningControl)
    ) {
      throw new Error('Remote Provider reasoning metadata is inconsistent')
    }
    if (identities.has(descriptor.provider)) {
      throw new Error('Remote Provider observation identities must be unique')
    }
    identities.add(descriptor.provider)
    return descriptor
  })
  if (!identities.has('codex') || !identities.has('claude-code')) {
    throw new Error(
      'Remote Provider observation must contain each supported Provider',
    )
  }
  providers.sort((left, right) =>
    left.provider === right.provider ? 0 : left.provider === 'codex' ? -1 : 1,
  )
  return {
    machineId,
    providers,
    observedAt: TimestampSchema.parse(value.observedAt),
  }
}

function parseProviderExecutionHealthObservation(
  value: DurableProviderExecutionHealthObservation,
): DurableProviderExecutionHealthObservation {
  const machineId = MachineIdSchema.parse(value.machineId)
  const provider = ProviderIdSchema.parse(value.provider)
  const observedAt = new Date(
    TimestampSchema.parse(value.observedAt),
  ).toISOString()
  const health = ProviderExecutionHealthSchema.parse({
    state: value.state,
    freshness: 'last_known',
    observedAt,
    ...(value.failure === undefined ? {} : { failure: value.failure }),
  })
  return {
    machineId,
    provider,
    state: health.state,
    ...(health.failure === undefined ? {} : { failure: health.failure }),
    observedAt,
  }
}

function providerExecutionHealthFromRow(
  row: ProviderExecutionHealthRow,
): DurableProviderExecutionHealthObservation {
  return parseProviderExecutionHealthObservation({
    machineId: MachineIdSchema.parse(row.machine_id),
    provider: ProviderIdSchema.parse(row.provider),
    state: ProviderExecutionHealthStateSchema.parse(row.state),
    ...(row.failure_json === null
      ? {}
      : {
          failure: CanonicalFailureSchema.parse(
            parseJson(row.failure_json, 'Provider execution health failure'),
          ),
        }),
    observedAt: TimestampSchema.parse(row.observed_at),
  })
}

function serializeProviderExecutionHealthFailure(
  failure: CanonicalFailure,
): string {
  const serialized = JSON.stringify(CanonicalFailureSchema.parse(failure))
  if (
    Buffer.byteLength(serialized, 'utf8') >
    providerExecutionHealthFailureMaximumBytes
  ) {
    throw new Error('Provider execution health failure exceeds durable bounds')
  }
  return serialized
}

function parseProviderLifecycleObservation(
  value: DurableMachineProviderLifecycleObservation,
): DurableMachineProviderLifecycleObservation {
  const machineId = MachineIdSchema.parse(value.machineId)
  const provider = ProviderIdSchema.parse(value.provider)
  const observedAt = TimestampSchema.parse(value.observedAt)
  const installations = value.installations.map((installation) => {
    const parsed = parseDurableProviderInstallation(installation)
    if (parsed.machineId !== machineId || parsed.provider !== provider) {
      throw new Error(
        'Provider installation must belong to its lifecycle Machine and Provider',
      )
    }
    if (Date.parse(parsed.lastObservedAt) > Date.parse(observedAt)) {
      throw new Error(
        'Provider installation observation cannot be newer than its lifecycle snapshot',
      )
    }
    return parsed
  })
  const selectedInstallationId =
    value.selectedInstallationId === undefined
      ? undefined
      : ProviderInstallationIdSchema.parse(value.selectedInstallationId)
  if (
    value.installationsTruncated !== undefined &&
    typeof value.installationsTruncated !== 'boolean'
  ) {
    throw new Error('Provider installation truncation marker is invalid')
  }
  MachineProviderLifecycleSchema.parse({
    provider,
    ...(selectedInstallationId === undefined ? {} : { selectedInstallationId }),
    installations: installations.map(providerInstallationPublic),
  })
  return {
    machineId,
    provider,
    observedAt,
    ...(selectedInstallationId === undefined ? {} : { selectedInstallationId }),
    installations,
    ...(value.installationsTruncated === undefined
      ? {}
      : { installationsTruncated: value.installationsTruncated }),
  }
}

function unavailableProviderCompatibility(
  provider: ProviderId,
  observedAt: Timestamp,
): ProviderCompatibilityObservation {
  const codexEnabled = new Set([
    'execution',
    'streaming',
    'nativeResume',
    'nativeSessionDiscovery',
  ])
  const capability = (name: string) => ({
    observed: 'unavailable' as const,
    enabled: provider === 'claude-code' || codexEnabled.has(name),
    effective: false,
  })
  return ProviderCompatibilityObservationSchema.parse({
    state: 'unavailable',
    runtimeReadiness: 'unavailable',
    freshness: 'current',
    contractVersion: 1,
    observedAt,
    capabilities: {
      execution: capability('execution'),
      streaming: capability('streaming'),
      nativeResume: capability('nativeResume'),
      nativeSessionDiscovery: capability('nativeSessionDiscovery'),
      fileRead: capability('fileRead'),
      search: capability('search'),
      toolEvents: capability('toolEvents'),
      reasoningControl: capability('reasoningControl'),
    },
  })
}

function parseDurableProviderInstallation(
  value: DurableProviderInstallation,
): DurableProviderInstallation {
  const publicInstallation = ProviderInstallationSummarySchema.parse(
    providerInstallationPublic(value),
  )
  const launcherPath = parseProviderExecutablePath(
    value.launcherPath,
    'Provider launcher path',
  )
  const resolvedExecutablePath = parseProviderExecutablePath(
    value.resolvedExecutablePath,
    'Resolved Provider executable path',
  )
  if ((launcherPath === undefined) !== (resolvedExecutablePath === undefined)) {
    throw new Error(
      'Provider launcher and resolved executable paths must be retained together',
    )
  }
  return {
    ...publicInstallation,
    machineId: MachineIdSchema.parse(value.machineId),
    locatorKey: parseBoundedText(value.locatorKey, 'Provider locator key', 512),
    ...(launcherPath === undefined ? {} : { launcherPath }),
    ...(resolvedExecutablePath === undefined ? {} : { resolvedExecutablePath }),
  }
}

function providerInstallationPublic(
  installation: DurableProviderInstallation,
): ProviderInstallationSummary {
  return ProviderInstallationSummarySchema.parse({
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
  })
}

function compatibilityFromRow(
  row: ProviderCompatibilityRow,
): ProviderCompatibilityObservation {
  return ProviderCompatibilityObservationSchema.parse({
    state: row.state,
    runtimeReadiness: row.runtime_readiness,
    freshness: row.freshness,
    contractVersion: row.contract_version,
    ...(row.observed_at === null ? {} : { observedAt: row.observed_at }),
    ...(row.failure_json === null
      ? {}
      : {
          failure: CanonicalFailureSchema.parse(
            parseJson(row.failure_json, 'Provider compatibility failure'),
          ),
        }),
    capabilities: parseJson(
      row.capabilities_json,
      'Provider compatibility capabilities',
    ),
  })
}

function backendObservationFromRow(
  row: ProviderBackendObservationRow,
): ProviderBackendObservation {
  return ProviderBackendObservationSchema.parse({
    mode: row.mode,
    readiness: row.readiness,
    freshness: row.freshness,
    ...(row.configuration_revision === null
      ? {}
      : { configurationRevision: row.configuration_revision }),
    configuration: parseJson(
      row.configuration_json,
      'Provider backend configuration',
    ),
    ...(row.sanitized_origin === null
      ? {}
      : { sanitizedOrigin: row.sanitized_origin }),
    ...(row.observed_at === null ? {} : { observedAt: row.observed_at }),
    ...(row.failure_json === null
      ? {}
      : {
          failure: CanonicalFailureSchema.parse(
            parseJson(row.failure_json, 'Provider backend failure'),
          ),
        }),
  })
}

function parseProviderExecutablePath(
  value: string | undefined,
  label: string,
): string | undefined {
  if (value === undefined) return undefined
  try {
    return parseCanonicalProjectRoot(value)
  } catch (error) {
    throw new Error(`${label} must be an absolute normalized path`, {
      cause: error,
    })
  }
}

function parseProviderInstallationLauncherKind(
  value: string,
): DurableProviderInstallation['launcherKind'] {
  switch (value) {
    case 'native':
    case 'symlink':
    case 'hardlink':
    case 'wrapper':
    case 'npm_shim':
    case 'unknown':
      return value
    default:
      throw new Error(`Unsupported Provider launcher kind: ${value}`)
  }
}

function parseProviderInstallationMethod(
  value: string,
): DurableProviderInstallation['installMethod'] {
  switch (value) {
    case 'native_installer':
    case 'npm':
    case 'homebrew':
    case 'package_manager':
    case 'manual':
    case 'unknown':
      return value
    default:
      throw new Error(`Unsupported Provider installation method: ${value}`)
  }
}

function parseProviderInstallationAvailability(
  value: string,
): DurableProviderInstallation['availability'] {
  switch (value) {
    case 'available':
    case 'unavailable':
    case 'unresolved':
      return value
    default:
      throw new Error(
        `Unsupported Provider installation availability: ${value}`,
      )
  }
}

function serializeBoundedJson(
  value: unknown,
  label: string,
  maximumBytes: number,
): string {
  const serialized = JSON.stringify(value)
  if (Buffer.byteLength(serialized, 'utf8') > maximumBytes) {
    throw new Error(`${label} exceeds durable bounds`)
  }
  return serialized
}

function machineRelayConfigurationFromRow(
  row: MachineRelayConfigurationRow,
): DurableMachineRelayConfiguration {
  if (
    row.enrollment_state !== 'required' &&
    row.enrollment_state !== 'enrolled' &&
    row.enrollment_state !== 'revoked'
  ) {
    throw new Error(
      `Unsupported Relay enrollment state: ${row.enrollment_state}`,
    )
  }
  const endpoint = RelayEndpointSchema.parse({
    host: row.endpoint_host,
    port: row.endpoint_port,
    transportSecurity: row.transport_security,
  })
  const enrollmentState = row.enrollment_state
  const enrolledAt =
    row.enrolled_at === null
      ? undefined
      : TimestampSchema.parse(row.enrolled_at)
  if ((enrollmentState === 'enrolled') !== (enrolledAt !== undefined)) {
    throw new Error('Durable Relay enrollment timestamp is inconsistent')
  }
  return {
    machineId: MachineIdSchema.parse(row.machine_id),
    endpoint,
    relayIdentityFingerprint: RelayIdentityFingerprintSchema.parse(
      row.relay_identity_fingerprint,
    ),
    ...(row.display_label === null
      ? {}
      : {
          displayLabel: parseBoundedText(
            row.display_label,
            'Relay display label',
            120,
          ),
        }),
    enabled: row.enabled === 1,
    enrollmentState,
    createdAt: TimestampSchema.parse(row.created_at),
    updatedAt: TimestampSchema.parse(row.updated_at),
    ...(enrolledAt === undefined ? {} : { enrolledAt }),
    ...(row.last_connected_at === null
      ? {}
      : { lastConnectedAt: TimestampSchema.parse(row.last_connected_at) }),
    ...(row.last_attempt_at === null
      ? {}
      : { lastAttemptAt: TimestampSchema.parse(row.last_attempt_at) }),
  }
}

function remoteProviderExecutionFoundation(
  descriptor: ProviderDescriptor,
): boolean {
  if (descriptor.availability !== 'available') return false
  const enabled = new Set(
    Object.entries(descriptor.capabilities)
      .filter(([, value]) => value)
      .map(([capability]) => capability),
  )
  if (descriptor.provider === 'codex') {
    return (
      enabled.has('streaming') &&
      [...enabled].every(
        (capability) => capability === 'streaming' || capability === 'resume',
      )
    )
  }
  const required = ['fileRead', 'search', 'streaming', 'toolEvents'] as const
  return (
    required.every((capability) => enabled.has(capability)) &&
    [...enabled].every(
      (capability) =>
        required.includes(capability as (typeof required)[number]) ||
        capability === 'resume' ||
        capability === 'reasoningControl',
    ) &&
    (descriptor.capabilities.reasoningControl
      ? descriptor.reasoningLabel !== undefined &&
        descriptor.reasoningOptions?.map(({ id }) => id).join(',') ===
          'low,medium,high,xhigh,max'
      : descriptor.reasoningLabel === undefined &&
        descriptor.reasoningOptions === undefined)
  )
}

function parseTrustedMachinePeer(
  value: DurableTrustedMachinePeer | NewDurableTrustedMachinePeer,
): DurableTrustedMachinePeer {
  if (
    !(value.peerPublicKeySpki instanceof Uint8Array) ||
    value.peerPublicKeySpki.byteLength < 32 ||
    value.peerPublicKeySpki.byteLength > 4096
  ) {
    throw new Error('Trusted Machine peer public key is invalid')
  }
  if (
    !Number.isSafeInteger(value.protocolVersion) ||
    value.protocolVersion <= 0 ||
    value.protocolVersion > 2_147_483_647
  ) {
    throw new Error('Trusted Machine protocol version is invalid')
  }
  const legacyAddress = 'address' in value ? value.address : undefined
  const endpointInputs =
    value.endpoints ??
    (legacyAddress === undefined
      ? []
      : [
          {
            address: legacyAddress,
            source: 'pairing' as const,
            preferred: true,
            createdAt: value.pairedAt,
            updatedAt: value.updatedAt,
          },
        ])
  if (
    endpointInputs.length < 1 ||
    endpointInputs.length > machineWireLimits.rememberedEndpoints
  ) {
    throw new Error('Trusted Machine endpoint count is invalid')
  }
  const endpoints = endpointInputs.map(parseTrustedMachineEndpoint)
  if (endpoints.filter((endpoint) => endpoint.preferred).length !== 1) {
    throw new Error('Trusted Machine must have exactly one preferred endpoint')
  }
  const keys = new Set<string>()
  for (const endpoint of endpoints) {
    const key = `${endpoint.address.host}\0${String(endpoint.address.port)}`
    if (keys.has(key))
      throw new Error('Trusted Machine endpoints must be unique')
    keys.add(key)
  }
  return {
    machineId: MachineIdSchema.parse(value.machineId),
    nodeIdentity: parseBoundedTextRange(
      value.nodeIdentity,
      'Trusted Machine Node identity',
      16,
      256,
    ),
    peerPublicKeySpki: new Uint8Array(value.peerPublicKeySpki),
    peerKeyFingerprint: parseBoundedTextRange(
      value.peerKeyFingerprint,
      'Trusted Machine peer key fingerprint',
      43,
      128,
    ),
    controllerCredentialRef: parseBoundedText(
      value.controllerCredentialRef,
      'Trusted Machine controller credential reference',
      512,
    ),
    controllerKeyFingerprint: parseBoundedTextRange(
      value.controllerKeyFingerprint,
      'Trusted Machine controller key fingerprint',
      43,
      128,
    ),
    trustState: parseMachineTrustLifecycle(value.trustState),
    protocolVersion: value.protocolVersion,
    endpoints,
    pairedAt: TimestampSchema.parse(value.pairedAt),
    updatedAt: TimestampSchema.parse(value.updatedAt),
    ...(value.lastAuthenticatedAt === undefined
      ? {}
      : {
          lastAuthenticatedAt: TimestampSchema.parse(value.lastAuthenticatedAt),
        }),
  }
}

function trustedMachinePeerFromRow(
  row: TrustedMachinePeerRow,
  endpoints: readonly DurableTrustedMachineEndpoint[],
): DurableTrustedMachinePeer {
  return parseTrustedMachinePeer({
    machineId: MachineIdSchema.parse(row.machine_id),
    nodeIdentity: row.node_identity,
    peerPublicKeySpki: row.peer_public_key_spki,
    peerKeyFingerprint: row.peer_key_fingerprint,
    controllerCredentialRef: row.controller_credential_ref,
    controllerKeyFingerprint: row.controller_key_fingerprint,
    trustState: parseMachineTrustLifecycle(row.trust_state),
    protocolVersion: row.protocol_version,
    endpoints,
    pairedAt: row.paired_at,
    updatedAt: row.updated_at,
    ...(row.last_authenticated_at === null
      ? {}
      : { lastAuthenticatedAt: row.last_authenticated_at }),
  })
}

function trustedMachineEndpointFromRow(
  row: TrustedMachineEndpointRow,
): DurableTrustedMachineEndpoint {
  return parseTrustedMachineEndpoint({
    address: { host: row.endpoint_host, port: row.endpoint_port },
    source: parseTrustedMachineEndpointSource(row.source),
    preferred: row.preferred === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.last_successful_at === null
      ? {}
      : { lastSuccessfulAt: row.last_successful_at }),
    ...(row.last_failure_at === null
      ? {}
      : { lastFailureAt: row.last_failure_at }),
  })
}

function parseTrustedMachineEndpoint(
  value: DurableTrustedMachineEndpoint,
): DurableTrustedMachineEndpoint {
  const address = canonicalTrustedMachineAddress(value.address)
  return {
    address,
    source: parseTrustedMachineEndpointSource(value.source),
    preferred: value.preferred,
    createdAt: TimestampSchema.parse(value.createdAt),
    updatedAt: TimestampSchema.parse(value.updatedAt),
    ...(value.lastSuccessfulAt === undefined
      ? {}
      : { lastSuccessfulAt: TimestampSchema.parse(value.lastSuccessfulAt) }),
    ...(value.lastFailureAt === undefined
      ? {}
      : { lastFailureAt: TimestampSchema.parse(value.lastFailureAt) }),
  }
}

/**
 * Endpoint hints are private, but their keys must still be stable.  The
 * coordinator resolves hostnames before they enter durable trust; this keeps
 * direct persistence callers from creating bracket/case variants of one
 * literal endpoint.
 */
function canonicalTrustedMachineAddress(
  value: RemoteMachineAddress,
): RemoteMachineAddress {
  const address = RemoteMachineAddressSchema.parse(value)
  const bracketed = address.host.startsWith('[')
  const host = bracketed ? address.host.slice(1, -1) : address.host
  if (isIP(host) === 6) {
    const normalized = new URL(`http://[${host}]/`).hostname
    return {
      host: normalized.slice(1, -1).toLowerCase(),
      port: address.port,
    }
  }
  return { host: host.toLowerCase(), port: address.port }
}

function parseTrustedMachineEndpointSource(
  value: string,
): DurableTrustedMachineEndpoint['source'] {
  if (value !== 'pairing' && value !== 'manual') {
    throw new Error(`Unsupported trusted Machine endpoint source: ${value}`)
  }
  return value
}

function parseConversation(
  value: DurableConversation | NewDurableConversation,
): DurableConversation {
  const provider = ProviderIdSchema.parse(value.provider)
  const providerInstallationId =
    value.providerInstallationId === undefined
      ? undefined
      : ProviderInstallationIdSchema.parse(value.providerInstallationId)
  // Conversation bindings can now point at an authenticated ProjectLocation
  // on a Machine whose path syntax differs from the Controller.  This is a
  // durable/path-shape check only; ProjectRegistry re-authorizes the exact
  // Machine-scoped Location before every workspace-dependent operation.
  const cwd = parseCanonicalProjectRoot(value.cwd)
  assertOptionalBoundedText(value.providerThreadId, 'Provider Thread ID', 4096)
  assertOptionalBoundedText(
    value.nativeTranscriptBoundary,
    'Native transcript boundary',
    4096,
  )
  assertOptionalBoundedText(value.model, 'Conversation model', 240)
  assertOptionalBoundedText(value.reasoning, 'Conversation reasoning', 120)
  const origin = value.origin ?? 'codetether'
  if (!isOneOf(origin, durableConversationOrigins)) {
    throw new Error(`Unsupported durable Conversation origin: ${origin}`)
  }
  const providerSessionMaterialized = value.providerSessionMaterialized ?? false
  if (typeof providerSessionMaterialized !== 'boolean') {
    throw new Error('Provider session materialization must be boolean')
  }
  if (providerSessionMaterialized && value.providerThreadId === undefined) {
    throw new Error(
      'A materialized Provider session requires a native Provider identity',
    )
  }
  if (
    origin === 'adopted_native' &&
    (!providerSessionMaterialized || value.providerThreadId === undefined)
  ) {
    throw new Error(
      'An adopted native Conversation requires a materialized Provider session',
    )
  }
  if (
    value.nativeTranscriptBoundary !== undefined &&
    origin !== 'adopted_native'
  ) {
    throw new Error(
      'Only an adopted Conversation can have a transcript boundary',
    )
  }
  if (!isOneOf(value.status, durableConversationStatuses)) {
    throw new Error(`Unsupported durable Conversation status: ${value.status}`)
  }
  const titleSource = ConversationTitleSourceSchema.parse(
    value.titleSource ?? 'generated',
  )
  const pinnedAt =
    value.pinnedAt === undefined
      ? undefined
      : TimestampSchema.parse(value.pinnedAt)
  const archivedAt =
    value.archivedAt === undefined
      ? undefined
      : TimestampSchema.parse(value.archivedAt)
  if (pinnedAt !== undefined && archivedAt !== undefined) {
    throw new Error('Archived Conversations cannot be pinned')
  }
  return {
    conversationId: ConversationIdSchema.parse(value.conversationId),
    projectId: ProjectIdSchema.parse(value.projectId),
    machineId: MachineIdSchema.parse(value.machineId),
    title: parseBoundedText(value.title, 'Conversation title', 240),
    titleSource,
    ...(pinnedAt === undefined ? {} : { pinnedAt }),
    ...(archivedAt === undefined ? {} : { archivedAt }),
    provider,
    ...(providerInstallationId === undefined ? {} : { providerInstallationId }),
    ...(value.providerThreadId === undefined
      ? {}
      : { providerThreadId: value.providerThreadId.trim() }),
    ...(value.nativeTranscriptBoundary === undefined
      ? {}
      : { nativeTranscriptBoundary: value.nativeTranscriptBoundary.trim() }),
    origin,
    providerSessionMaterialized,
    cwd,
    ...(value.model === undefined ? {} : { model: value.model.trim() }),
    ...(value.reasoning === undefined
      ? {}
      : { reasoning: value.reasoning.trim() }),
    status: value.status,
    createdAt: TimestampSchema.parse(value.createdAt),
    updatedAt: TimestampSchema.parse(value.updatedAt),
    lastActivityAt: TimestampSchema.parse(value.lastActivityAt),
  }
}

function projectFromRows(rows: readonly ProjectRow[]): DurableProject {
  const row = rows[0]
  if (row === undefined) throw new Error('Project rows cannot be empty')
  for (const candidate of rows) {
    if (
      candidate.project_id !== row.project_id ||
      candidate.name !== row.name ||
      candidate.project_created_at !== row.project_created_at ||
      candidate.project_updated_at !== row.project_updated_at
    ) {
      throw new Error('Project row aggregation contains mixed identities')
    }
  }
  return parseProject({
    projectId: ProjectIdSchema.parse(row.project_id),
    name: row.name,
    locations: rows.map((location) => ({
      projectId: ProjectIdSchema.parse(location.project_id),
      machineId: MachineIdSchema.parse(location.machine_id),
      rootPath: location.root_path,
      rootPathKey: location.root_path_key,
      createdAt: TimestampSchema.parse(location.location_created_at),
      updatedAt: TimestampSchema.parse(location.location_updated_at),
    })),
    createdAt: TimestampSchema.parse(row.project_created_at),
    updatedAt: TimestampSchema.parse(row.project_updated_at),
  })
}

function projectsFromRows(rows: readonly ProjectRow[]): DurableProject[] {
  const projects: DurableProject[] = []
  let currentRows: ProjectRow[] = []
  for (const row of rows) {
    if (
      currentRows.length > 0 &&
      currentRows[0]?.project_id !== row.project_id
    ) {
      projects.push(projectFromRows(currentRows))
      currentRows = []
    }
    currentRows.push(row)
  }
  if (currentRows.length > 0) projects.push(projectFromRows(currentRows))
  return projects
}

function projectLocationFromRow(
  row: ProjectLocationRow,
): DurableProjectLocation {
  return parseProjectLocation({
    projectId: ProjectIdSchema.parse(row.project_id),
    machineId: MachineIdSchema.parse(row.machine_id),
    rootPath: row.root_path,
    rootPathKey: row.root_path_key,
    createdAt: TimestampSchema.parse(row.created_at),
    updatedAt: TimestampSchema.parse(row.updated_at),
  })
}

function sameProjectLocations(
  left: readonly DurableProjectLocation[],
  right: readonly DurableProjectLocation[],
): boolean {
  if (left.length !== right.length) return false
  return left.every((location, index) => {
    const candidate = right[index]
    return (
      candidate !== undefined &&
      location.projectId === candidate.projectId &&
      location.machineId === candidate.machineId &&
      location.rootPath === candidate.rootPath &&
      location.rootPathKey === candidate.rootPathKey &&
      location.createdAt === candidate.createdAt &&
      location.updatedAt === candidate.updatedAt
    )
  })
}

function projectLocationSelect(): string {
  return `SELECT
    projects.project_id,
    projects.name,
    projects.created_at AS project_created_at,
    projects.updated_at AS project_updated_at,
    project_locations.machine_id,
    project_locations.root_path,
    project_locations.root_path_key,
    project_locations.created_at AS location_created_at,
    project_locations.updated_at AS location_updated_at
  FROM projects
  INNER JOIN project_locations
    ON project_locations.project_id = projects.project_id`
}

function parseTurn(value: DurableTurnSnapshot): DurableTurnSnapshot {
  assertOptionalBoundedText(value.providerTurnId, 'Provider Turn ID', 4096)
  if (!isOneOf(value.status, durableTurnStatuses)) {
    throw new Error(`Unsupported durable Turn status: ${value.status}`)
  }
  if (
    !Number.isSafeInteger(value.snapshotVersion) ||
    value.snapshotVersion <= 0
  ) {
    throw new Error('Turn snapshotVersion must be a positive safe integer')
  }
  const parsed: DurableTurnSnapshot = {
    turnId: TurnIdSchema.parse(value.turnId),
    conversationId: ConversationIdSchema.parse(value.conversationId),
    ...(value.providerTurnId === undefined
      ? {}
      : { providerTurnId: value.providerTurnId.trim() }),
    input: TurnInputRecordSchema.parse(value.input),
    status: value.status,
    startedAt: TimestampSchema.parse(value.startedAt),
    ...(value.completedAt === undefined
      ? {}
      : { completedAt: TimestampSchema.parse(value.completedAt) }),
    snapshotVersion: value.snapshotVersion,
    snapshot: value.snapshot,
  }
  serializeSnapshot(parsed.snapshot)
  return parsed
}

function conversationFromRow(row: ConversationRow): DurableConversation {
  return parseConversation({
    conversationId: ConversationIdSchema.parse(row.conversation_id),
    projectId: ProjectIdSchema.parse(row.project_id),
    machineId: MachineIdSchema.parse(row.machine_id),
    title: row.title,
    titleSource: parseConversationTitleSource(row.title_source),
    ...(row.pinned_at === null
      ? {}
      : { pinnedAt: TimestampSchema.parse(row.pinned_at) }),
    ...(row.archived_at === null
      ? {}
      : { archivedAt: TimestampSchema.parse(row.archived_at) }),
    provider: parseProvider(row.provider),
    ...(row.provider_installation_id === null
      ? {}
      : {
          providerInstallationId: ProviderInstallationIdSchema.parse(
            row.provider_installation_id,
          ),
        }),
    ...(row.provider_thread_id === null
      ? {}
      : { providerThreadId: row.provider_thread_id }),
    ...(row.native_transcript_boundary === null
      ? {}
      : {
          nativeTranscriptBoundary: parseBoundedText(
            row.native_transcript_boundary,
            'Native transcript boundary',
            4096,
          ),
        }),
    origin: parseConversationOrigin(row.origin),
    providerSessionMaterialized: parseStoredBoolean(
      row.provider_session_materialized,
      'Provider session materialization',
    ),
    cwd: row.cwd,
    ...(row.model === null ? {} : { model: row.model }),
    ...(row.reasoning === null ? {} : { reasoning: row.reasoning }),
    status: parseConversationStatus(row.status),
    createdAt: TimestampSchema.parse(row.created_at),
    updatedAt: TimestampSchema.parse(row.updated_at),
    lastActivityAt: TimestampSchema.parse(row.last_activity_at),
  })
}

function conversationSummaryFromRow(
  row: ConversationSummaryRow,
): DurableConversationSummary {
  return ConversationSummarySchema.parse({
    conversationId: row.conversation_id,
    projectId: row.project_id,
    machineId: row.machine_id,
    title: row.title,
    titleSource: parseConversationTitleSource(row.title_source),
    ...(row.pinned_at === null ? {} : { pinnedAt: row.pinned_at }),
    ...(row.archived_at === null ? {} : { archivedAt: row.archived_at }),
    provider: parseProvider(row.provider),
    ...(row.model === null ? {} : { model: row.model }),
    ...(row.reasoning === null ? {} : { reasoning: row.reasoning }),
    status: parseConversationStatus(row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActivityAt: row.last_activity_at,
  })
}

function conversationSearchResultFromRow(
  row: ConversationSearchRow,
  normalizedQuery: string,
): DurableConversationSearchResult {
  const conversation = conversationSummaryFromRow(row)
  if (row.matched_field === 'title') {
    return { conversation, matchedField: 'title' }
  }
  if (row.matched_turn_id === null) {
    throw new Error('A User input search match requires a Turn identity')
  }
  return {
    conversation,
    matchedField: 'user_input',
    matchPreview: conversationSearchPreview(row.match_source, normalizedQuery),
    matchedTurnId: TurnIdSchema.parse(row.matched_turn_id),
  }
}

function turnFromRow(row: TurnRow): DurableTurnSnapshot {
  return parseTurn({
    turnId: TurnIdSchema.parse(row.turn_id),
    conversationId: ConversationIdSchema.parse(row.conversation_id),
    ...(row.provider_turn_id === null
      ? {}
      : { providerTurnId: row.provider_turn_id }),
    input: TurnInputRecordSchema.parse(parseJson(row.input, 'Turn input')),
    status: parseTurnStatus(row.status),
    startedAt: TimestampSchema.parse(row.started_at),
    ...(row.completed_at === null
      ? {}
      : { completedAt: TimestampSchema.parse(row.completed_at) }),
    snapshotVersion: row.snapshot_version,
    snapshot: parseJson(row.snapshot_json, 'Turn snapshot'),
  })
}

function serializeSnapshot(value: unknown): string {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) {
    throw new Error('Turn snapshot must be JSON serializable')
  }
  parseJson(serialized, 'Turn snapshot')
  return serialized
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch (error) {
    throw new Error(`${label} contains invalid JSON`, { cause: error })
  }
}

function assertChanged(
  changes: number | bigint,
  recordKind: string,
  recordId: string,
): void {
  if (changes === 0 || changes === 0n) {
    throw new Error(`${recordKind} ${recordId} does not exist`)
  }
}

function assertSameAttentionBinding(
  existing: DurableAttentionItem,
  candidate: NewDurableAttentionItem,
): void {
  if (
    existing.projectId !== candidate.projectId ||
    existing.conversationId !== candidate.conversationId ||
    existing.turnId !== candidate.turnId ||
    existing.type !== candidate.type
  ) {
    throw new Error(
      `Attention source key ${candidate.sourceKey} is already bound to another source`,
    )
  }
}

function requireAttentionItem(
  item: DurableAttentionItem | undefined,
  attentionId: string,
): DurableAttentionItem {
  if (item === undefined) {
    throw new Error(`Attention ${attentionId} does not exist`)
  }
  return item
}

function assertDatabaseIntegrity(database: DatabaseSync): void {
  const result = database.prepare('PRAGMA quick_check').get() as
    Record<string, unknown> | undefined
  if (result === undefined || Object.values(result)[0] !== 'ok') {
    throw new Error('SQLite integrity check failed')
  }
  if (database.prepare('PRAGMA foreign_key_check').all().length > 0) {
    throw new Error('SQLite foreign key integrity check failed')
  }
  const onboarding = database
    .prepare(
      `SELECT COUNT(*) AS count
       FROM onboarding_progress
       WHERE singleton = 1`,
    )
    .get() as { readonly count: number }
  if (onboarding.count !== 1) {
    throw new Error(
      'SQLite onboarding state must contain one durable singleton',
    )
  }
  const machines = database
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN kind = 'local' THEN 1 ELSE 0 END) AS local,
         SUM(CASE WHEN kind = 'remote' THEN 1 ELSE 0 END) AS remote
       FROM machines`,
    )
    .get() as {
    readonly total: number
    readonly local: number
    readonly remote: number
  }
  if (
    machines.total < 1 ||
    machines.total > 64 ||
    machines.local !== 1 ||
    machines.remote !== machines.total - 1
  ) {
    throw new Error(
      'SQLite Machine state must contain one local and only supported remote Machines',
    )
  }
  const invalidTrust = database
    .prepare(
      `SELECT COUNT(*) AS count
       FROM machines
       LEFT JOIN trusted_machine_peers
         ON trusted_machine_peers.machine_id = machines.machine_id
       WHERE
         (machines.kind = 'remote' AND trusted_machine_peers.machine_id IS NULL)
         OR
         (machines.kind = 'local' AND trusted_machine_peers.machine_id IS NOT NULL)`,
    )
    .get() as { readonly count: number }
  if (invalidTrust.count !== 0) {
    throw new Error(
      'SQLite remote Machines must have exactly one private trust binding',
    )
  }
  const invalidEndpoints = database
    .prepare(
      `SELECT COUNT(*) AS count
       FROM trusted_machine_peers
       LEFT JOIN (
         SELECT
           machine_id,
           COUNT(*) AS endpoint_count,
           SUM(preferred) AS preferred_count
         FROM trusted_machine_endpoints
         GROUP BY machine_id
       ) AS endpoint_summary
         ON endpoint_summary.machine_id = trusted_machine_peers.machine_id
       WHERE
         COALESCE(endpoint_summary.endpoint_count, 0) NOT BETWEEN 1 AND 8
         OR COALESCE(endpoint_summary.preferred_count, 0) <> 1`,
    )
    .get() as { readonly count: number }
  if (invalidEndpoints.count !== 0) {
    throw new Error(
      'SQLite trusted Machines must have one preferred bounded endpoint set',
    )
  }
  const locations = database
    .prepare(
      `SELECT COUNT(*) AS count
       FROM projects
       LEFT JOIN project_locations
         ON project_locations.project_id = projects.project_id
       WHERE project_locations.project_id IS NULL`,
    )
    .get() as { readonly count: number }
  if (locations.count !== 0) {
    throw new Error('SQLite Projects must have a durable Machine location')
  }
}

function parseProvider(value: string): ProviderId {
  return ProviderIdSchema.parse(value)
}

function parseConversationStatus(value: string): DurableConversationStatus {
  if (!isOneOf(value, durableConversationStatuses)) {
    throw new Error(`Unsupported durable Conversation status: ${value}`)
  }
  return value
}

function parseConversationOrigin(value: string): DurableConversationOrigin {
  if (isOneOf(value, durableConversationOrigins)) return value
  throw new Error(`Unsupported durable Conversation origin: ${value}`)
}

function parseStoredBoolean(value: number, label: string): boolean {
  if (value === 0) return false
  if (value === 1) return true
  throw new Error(`${label} must be stored as 0 or 1`)
}

function parseConversationTitleSource(value: string): ConversationTitleSource {
  return ConversationTitleSourceSchema.parse(value)
}

function parseTurnStatus(value: string): DurableTurnStatus {
  if (!isOneOf(value, durableTurnStatuses)) {
    throw new Error(`Unsupported durable Turn status: ${value}`)
  }
  return value
}

function isOneOf<const Values extends readonly string[]>(
  value: string,
  values: Values,
): value is Values[number] {
  return values.includes(value)
}

function assertOptionalBoundedText(
  value: string | undefined,
  label: string,
  maxLength: number,
): void {
  if (value !== undefined) assertBoundedText(value, label, maxLength)
}

function assertBoundedText(
  value: string,
  label: string,
  maxLength: number,
): void {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    throw new Error(`${label} must contain 1-${String(maxLength)} characters`)
  }
}

function parseBoundedText(
  value: string,
  label: string,
  maxLength: number,
): string {
  assertBoundedText(value, label, maxLength)
  return value.trim()
}

function parseBoundedTextRange(
  value: string,
  label: string,
  minLength: number,
  maxLength: number,
): string {
  const parsed = parseBoundedText(value, label, maxLength)
  if (parsed.length < minLength) {
    throw new Error(
      `${label} must contain ${String(minLength)}-${String(maxLength)} characters`,
    )
  }
  return parsed
}

function parseMachineTrustLifecycle(
  value: string,
): DurableTrustedMachinePeer['trustState'] {
  if (value === 'pending' || value === 'active' || value === 'revoking') {
    return value
  }
  throw new Error(`Unsupported trusted Machine state: ${value}`)
}

function parseRootPathKey(value: string): string {
  if (value.length === 0 || value.length > 4096 || value.trim() !== value) {
    throw new Error(
      'Project root path key must contain 1-4096 unpadded characters',
    )
  }
  if (value.includes('\0')) {
    throw new Error('Project root path key must not contain NUL')
  }
  return value
}

function parseCanonicalProjectRoot(value: string): string {
  if (value.length === 0 || value.length > 4096 || value.trim() !== value) {
    throw new Error(
      'Trusted Project root path must contain 1-4096 unpadded characters',
    )
  }
  if (value.includes('\0')) {
    throw new Error('Trusted Project root path must not contain NUL')
  }
  // `win32.isAbsolute('/home/...')` is true because Windows accepts a
  // root-relative slash. Prefer explicit POSIX syntax so a Windows Controller
  // never rewrites an authenticated Linux Node's canonical path.
  const path = value.startsWith('/') ? posix : win32
  if (!path.isAbsolute(value)) {
    throw new Error('Trusted Project root path must be absolute')
  }
  if (path.normalize(value) !== value) {
    throw new Error('Trusted Project root path must already be normalized')
  }
  return value
}

function parseConversationArchiveFilter(
  value: ConversationArchiveFilter | undefined,
): ConversationArchiveFilter {
  if (value === undefined) return 'active'
  if (isOneOf(value, conversationArchiveFilters)) return value
  throw new Error(`Unsupported Conversation archive filter: ${String(value)}`)
}

function parseConversationListLimit(value: number | undefined): number {
  const limit = value ?? conversationListLimits.default
  if (
    !Number.isSafeInteger(limit) ||
    limit <= 0 ||
    limit > conversationListLimits.maximum
  ) {
    throw new Error(
      `Conversation list limit must be an integer between 1 and ${String(conversationListLimits.maximum)}`,
    )
  }
  return limit
}

function parseConversationSearchLimit(value: number | undefined): number {
  const limit = value ?? conversationSearchLimits.default
  if (
    !Number.isSafeInteger(limit) ||
    limit <= 0 ||
    limit > conversationSearchLimits.maximum
  ) {
    throw new Error(
      `Conversation search limit must be an integer between 1 and ${String(conversationSearchLimits.maximum)}`,
    )
  }
  return limit
}

export function normalizeManualConversationTitle(value: string): string {
  return ManualConversationTitleSchema.parse(value)
}

function requireConversation(
  conversation: DurableConversation | undefined,
  conversationId: ConversationId,
): DurableConversation {
  if (conversation === undefined) {
    throw new Error(`Conversation ${String(conversationId)} does not exist`)
  }
  return conversation
}
