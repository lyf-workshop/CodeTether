import { mkdirSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import {
  conversationSearchLimits,
  conversationListLimits,
  ConversationIdSchema,
  ConversationSummarySchema,
  ConversationTitleSourceSchema,
  MachineIdSchema,
  ManualConversationTitleSchema,
  ProjectIdSchema,
  ProviderIdSchema,
  RemoteMachineAddressSchema,
  TimestampSchema,
  TurnIdSchema,
  TurnInputRecordSchema,
  type ConversationId,
  type ConversationSummary,
  type ConversationTitleSource,
  type MachineId,
  type ProjectId,
  type ProviderId,
  type RemoteMachineAddress,
  type Timestamp,
  type TurnId,
  type TurnInputRecord,
} from '@codetether/protocol'

import { normalizeTrustedProjectRoot } from '../project-path.js'

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
  readonly location: DurableProjectLocation
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
  readonly address: RemoteMachineAddress
  readonly pairedAt: Timestamp
  readonly updatedAt: Timestamp
  readonly lastAuthenticatedAt?: Timestamp
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
  readonly providerThreadId?: string
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
  'titleSource' | 'pinnedAt' | 'archivedAt'
> &
  Partial<Pick<DurableConversation, 'titleSource' | 'pinnedAt' | 'archivedAt'>>

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
    peer: DurableTrustedMachinePeer,
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
          endpoint_host, endpoint_port, paired_at, updated_at,
          last_authenticated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        trusted.machineId,
        trusted.nodeIdentity,
        trusted.peerPublicKeySpki,
        trusted.peerKeyFingerprint,
        trusted.controllerCredentialRef,
        trusted.controllerKeyFingerprint,
        trusted.trustState,
        trusted.protocolVersion,
        trusted.address.host,
        trusted.address.port,
        trusted.pairedAt,
        trusted.updatedAt,
        trusted.lastAuthenticatedAt ?? null,
      )
    })
  }

  getTrustedMachinePeer(
    machineId: MachineId,
  ): DurableTrustedMachinePeer | undefined {
    const id = MachineIdSchema.parse(machineId)
    const row = this.#statement(
      'SELECT * FROM trusted_machine_peers WHERE machine_id = ?',
    ).get(id) as TrustedMachinePeerRow | undefined
    return row === undefined ? undefined : trustedMachinePeerFromRow(row)
  }

  listTrustedMachinePeers(): DurableTrustedMachinePeer[] {
    const rows = this.#statement(
      `SELECT * FROM trusted_machine_peers
       ORDER BY paired_at ASC, machine_id ASC`,
    ).all() as unknown as TrustedMachinePeerRow[]
    return rows.map(trustedMachinePeerFromRow)
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
    assertChanged(
      this.#statement(
        `UPDATE trusted_machine_peers SET
           trust_state = 'revoking', updated_at = ?
         WHERE machine_id = ? AND trust_state = 'active'`,
      ).run(timestamp, id).changes,
      'Active trusted Machine peer',
      id,
    )
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
  ): DurableTrustedMachinePeer {
    const id = MachineIdSchema.parse(machineId)
    const endpoint = RemoteMachineAddressSchema.parse(address)
    const timestamp = TimestampSchema.parse(authenticatedAt)
    this.runInTransaction(() => {
      assertChanged(
        this.#statement(
          `UPDATE trusted_machine_peers SET
             endpoint_host = ?, endpoint_port = ?, updated_at = ?,
             last_authenticated_at = ?
           WHERE machine_id = ?`,
        ).run(endpoint.host, endpoint.port, timestamp, timestamp, id).changes,
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

  deleteRemoteMachine(machineId: MachineId): boolean {
    const id = MachineIdSchema.parse(machineId)
    const machine = this.getMachine(id)
    if (machine === undefined) return false
    if (machine.kind !== 'remote') {
      throw new Error('The canonical local Machine cannot be unpaired')
    }
    return this.runInTransaction(
      () =>
        this.#statement(
          `DELETE FROM machines WHERE machine_id = ? AND kind = 'remote'`,
        ).run(id).changes > 0,
    )
  }

  createProject(project: DurableProject): void {
    const value = parseProject(project)
    this.runInTransaction(() => {
      this.#statement(
        `INSERT INTO projects (
          project_id, name, created_at, updated_at
        ) VALUES (?, ?, ?, ?)`,
      ).run(value.projectId, value.name, value.createdAt, value.updatedAt)
      this.#statement(
        `INSERT INTO project_locations (
          project_id, machine_id, root_path, root_path_key, created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        value.location.projectId,
        value.location.machineId,
        value.location.rootPath,
        value.location.rootPathKey,
        value.location.createdAt,
        value.location.updatedAt,
      )
    })
  }

  updateProject(project: DurableProject): void {
    const value = parseProject(project)
    const existing = this.getProject(value.projectId)
    if (existing === undefined) {
      throw new Error(`Project ${value.projectId} does not exist`)
    }
    if (
      existing.location.machineId !== value.location.machineId ||
      existing.location.rootPath !== value.location.rootPath ||
      existing.location.rootPathKey !== value.location.rootPathKey
    ) {
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
    const row = this.#statement(
      `${projectLocationSelect()}
       WHERE projects.project_id = ?`,
    ).get(id) as ProjectRow | undefined
    return row === undefined ? undefined : projectFromRow(row)
  }

  getProjectByRootPathKey(
    machineId: MachineId,
    rootPathKey: string,
  ): DurableProject | undefined {
    const machine = MachineIdSchema.parse(machineId)
    const key = parseRootPathKey(rootPathKey)
    const row = this.#statement(
      `${projectLocationSelect()}
       WHERE project_locations.machine_id = ? AND
         project_locations.root_path_key = ?`,
    ).get(machine, key) as ProjectRow | undefined
    return row === undefined ? undefined : projectFromRow(row)
  }

  listProjects(): DurableProject[] {
    const rows = this.#statement(
      `${projectLocationSelect()}
       ORDER BY projects.updated_at DESC, projects.project_id ASC`,
    ).all() as unknown as ProjectRow[]
    return rows.map(projectFromRow)
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

  createConversation(conversation: NewDurableConversation): void {
    const value = parseConversation(conversation)
    this.#statement(
      `INSERT INTO conversations (
        conversation_id, project_id, machine_id, title, title_source,
        pinned_at, archived_at, provider, provider_thread_id, cwd, model,
        reasoning, status, created_at, updated_at, last_activity_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      value.cwd,
      value.model ?? null,
      value.reasoning ?? null,
      value.status,
      value.createdAt,
      value.updatedAt,
      value.lastActivityAt,
    )
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
      existing.cwd !== value.cwd
    ) {
      throw new Error('Conversation execution binding is immutable')
    }
    const result = this.#statement(
      `UPDATE conversations SET
        title = ?, title_source = ?, pinned_at = ?, archived_at = ?,
        provider_thread_id = ?, model = ?, reasoning = ?, status = ?,
        created_at = ?, updated_at = ?, last_activity_at = ?
      WHERE conversation_id = ?`,
    ).run(
      value.title,
      value.titleSource,
      value.pinnedAt ?? null,
      value.archivedAt ?? null,
      value.providerThreadId ?? null,
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
      'SELECT * FROM conversations WHERE conversation_id = ?',
    ).get(id) as ConversationRow | undefined
    return row === undefined ? undefined : conversationFromRow(row)
  }

  listConversations(): DurableConversation[] {
    const rows = this.#statement(
      'SELECT * FROM conversations ORDER BY last_activity_at DESC, conversation_id ASC',
    ).all() as unknown as ConversationRow[]
    return rows.map(conversationFromRow)
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

  updateTurn(turn: DurableTurnSnapshot): void {
    const value = parseTurn(turn)
    const result = this.#statement(
      `UPDATE turns SET
        conversation_id = ?, provider_turn_id = ?, input = ?, status = ?,
        started_at = ?, completed_at = ?, snapshot_version = ?, snapshot_json = ?
      WHERE turn_id = ?`,
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
  readonly provider_thread_id: string | null
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

interface TrustedMachinePeerRow {
  readonly machine_id: string
  readonly node_identity: string
  readonly peer_public_key_spki: Uint8Array
  readonly peer_key_fingerprint: string
  readonly controller_credential_ref: string
  readonly controller_key_fingerprint: string
  readonly trust_state: string
  readonly protocol_version: number
  readonly endpoint_host: string
  readonly endpoint_port: number
  readonly paired_at: string
  readonly updated_at: string
  readonly last_authenticated_at: string | null
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
  const location = parseProjectLocation(value.location)
  if (location.projectId !== projectId) {
    throw new Error('Project location must belong to its Project')
  }
  return {
    projectId,
    name: parseBoundedText(value.name, 'Project name', 240),
    location,
    createdAt: TimestampSchema.parse(value.createdAt),
    updatedAt: TimestampSchema.parse(value.updatedAt),
  }
}

function parseProjectLocation(
  value: DurableProjectLocation,
): DurableProjectLocation {
  const root = normalizeTrustedProjectRoot(value.rootPath)
  const rootPathKey = parseRootPathKey(value.rootPathKey)
  if (root.rootPathKey !== rootPathKey) {
    throw new Error(
      'Project root path key does not match its trusted root path',
    )
  }
  return {
    projectId: ProjectIdSchema.parse(value.projectId),
    machineId: MachineIdSchema.parse(value.machineId),
    rootPath: root.rootPath,
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

function parseTrustedMachinePeer(
  value: DurableTrustedMachinePeer,
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
    address: RemoteMachineAddressSchema.parse(value.address),
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
    address: { host: row.endpoint_host, port: row.endpoint_port },
    pairedAt: row.paired_at,
    updatedAt: row.updated_at,
    ...(row.last_authenticated_at === null
      ? {}
      : { lastAuthenticatedAt: row.last_authenticated_at }),
  })
}

function parseConversation(
  value: DurableConversation | NewDurableConversation,
): DurableConversation {
  const provider = ProviderIdSchema.parse(value.provider)
  const cwd = normalizeTrustedProjectRoot(value.cwd).rootPath
  assertOptionalBoundedText(value.providerThreadId, 'Provider Thread ID', 4096)
  assertOptionalBoundedText(value.model, 'Conversation model', 240)
  assertOptionalBoundedText(value.reasoning, 'Conversation reasoning', 120)
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
    ...(value.providerThreadId === undefined
      ? {}
      : { providerThreadId: value.providerThreadId.trim() }),
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

function projectFromRow(row: ProjectRow): DurableProject {
  return parseProject({
    projectId: ProjectIdSchema.parse(row.project_id),
    name: row.name,
    location: {
      projectId: ProjectIdSchema.parse(row.project_id),
      machineId: MachineIdSchema.parse(row.machine_id),
      rootPath: row.root_path,
      rootPathKey: row.root_path_key,
      createdAt: TimestampSchema.parse(row.location_created_at),
      updatedAt: TimestampSchema.parse(row.location_updated_at),
    },
    createdAt: TimestampSchema.parse(row.project_created_at),
    updatedAt: TimestampSchema.parse(row.project_updated_at),
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
    ...(row.provider_thread_id === null
      ? {}
      : { providerThreadId: row.provider_thread_id }),
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
