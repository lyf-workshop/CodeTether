import { randomUUID } from 'node:crypto'

import type {
  NativeProviderSessionCandidate,
  ProviderSessionDiscoveryPage,
} from '@codetether/agent-core'
import {
  DiscoveryCandidateIdSchema,
  ProviderSessionDiscoveryCursorSchema,
  providerSessionDiscoveryLimits,
  type ConversationId,
  type DiscoveryCandidateId,
  type DiscoverProviderSessionsResponse,
  type MachineId,
  type ProjectId,
  type ProviderId,
  type ProviderInstallationId,
  type ProviderInstallationRevision,
  type ProviderSessionDiscoveryCandidate,
  type ProviderSessionDiscoveryCursor,
  type ProviderSessionDiscoveryProviderResult,
} from '@codetether/protocol'

const DEFAULT_SNAPSHOT_TTL_MS = 5 * 60_000
const DEFAULT_MAXIMUM_SNAPSHOTS = 16
const DEFAULT_MAXIMUM_CANDIDATES = 4_000
const DEFAULT_MAXIMUM_CURSORS = 256

export interface PrivateDiscoveryCandidate {
  readonly projectId: ProjectId
  readonly machineId: MachineId
  readonly rootPath: string
  /** Exact private runtime context that owned this scan. */
  readonly providerInstallationId?: ProviderInstallationId
  readonly installationRevision?: ProviderInstallationRevision
  readonly native: NativeProviderSessionCandidate
  readonly createdAtMs: number
}

interface StoredCandidate extends PrivateDiscoveryCandidate {
  readonly candidateId: DiscoveryCandidateId
  readonly snapshotId: string
  adoptedConversationId?: ConversationId
}

interface DiscoverySnapshot {
  readonly snapshotId: string
  readonly projectId: ProjectId
  readonly machineId: MachineId
  readonly providerFilter?: ProviderId
  readonly candidateIds: readonly DiscoveryCandidateId[]
  readonly providers: readonly ProviderSessionDiscoveryProviderResult[]
  readonly createdAtMs: number
}

interface CursorEntry {
  readonly cursor: ProviderSessionDiscoveryCursor
  readonly snapshotId: string
  readonly offset: number
  readonly createdAtMs: number
}

export interface ProviderSessionDiscoveryRegistryOptions {
  readonly now?: () => number
  readonly randomId?: () => string
  readonly snapshotTtlMs?: number
  readonly maximumSnapshots?: number
  readonly maximumCandidates?: number
  readonly maximumCursors?: number
}

/**
 * Process-private bounded registry. Native Provider identities never become
 * public candidate ids or cursor material, and no cleanup timer is retained.
 */
export class ProviderSessionDiscoveryRegistry {
  readonly #now: () => number
  readonly #randomId: () => string
  readonly #snapshotTtlMs: number
  readonly #maximumSnapshots: number
  readonly #maximumCandidates: number
  readonly #maximumCursors: number
  readonly #snapshots = new Map<string, DiscoverySnapshot>()
  readonly #candidates = new Map<DiscoveryCandidateId, StoredCandidate>()
  readonly #cursors = new Map<ProviderSessionDiscoveryCursor, CursorEntry>()

  constructor(options: ProviderSessionDiscoveryRegistryOptions = {}) {
    this.#now = options.now ?? Date.now
    this.#randomId = options.randomId ?? randomUUID
    this.#snapshotTtlMs = positiveInteger(
      options.snapshotTtlMs,
      DEFAULT_SNAPSHOT_TTL_MS,
    )
    this.#maximumSnapshots = positiveInteger(
      options.maximumSnapshots,
      DEFAULT_MAXIMUM_SNAPSHOTS,
    )
    this.#maximumCandidates = positiveInteger(
      options.maximumCandidates,
      DEFAULT_MAXIMUM_CANDIDATES,
    )
    this.#maximumCursors = positiveInteger(
      options.maximumCursors,
      DEFAULT_MAXIMUM_CURSORS,
    )
  }

  createSnapshot(input: {
    readonly projectId: ProjectId
    readonly machineId: MachineId
    readonly rootPath: string
    readonly providerFilter?: ProviderId
    readonly pages: readonly ProviderSessionDiscoveryPage[]
    readonly installationForProvider?: (provider: ProviderId) =>
      | {
          readonly installationId: ProviderInstallationId
          readonly installationRevision: ProviderInstallationRevision
        }
      | undefined
    readonly adoptedConversation: (
      native: NativeProviderSessionCandidate,
    ) => ConversationId | undefined
    readonly limit: number
  }): DiscoverProviderSessionsResponse {
    this.#prune()
    const now = this.#now()
    const snapshotId = this.#newPrivateId('snapshot')
    const uniqueCandidates = new Map<string, NativeProviderSessionCandidate>()
    for (const candidate of input.pages.flatMap((page) => page.candidates)) {
      const key = `${candidate.provider}\0${candidate.nativeSessionId}`
      const existing = uniqueCandidates.get(key)
      if (
        existing === undefined ||
        compareCandidates(candidate, existing) < 0
      ) {
        uniqueCandidates.set(key, candidate)
      }
    }
    const candidates = [...uniqueCandidates.values()]
      .sort(compareCandidates)
      .slice(0, this.#maximumCandidates)
    while (
      this.#snapshots.size >= this.#maximumSnapshots ||
      this.#candidates.size + candidates.length > this.#maximumCandidates
    ) {
      const oldest = this.#snapshots.values().next().value as
        DiscoverySnapshot | undefined
      if (oldest === undefined) break
      this.#deleteSnapshot(oldest.snapshotId)
    }
    const candidateIds = candidates.map((native) => {
      const installation = input.installationForProvider?.(native.provider)
      const candidateId = DiscoveryCandidateIdSchema.parse(
        `candidate_${this.#randomId().replaceAll('-', '')}`,
      )
      this.#candidates.set(candidateId, {
        candidateId,
        snapshotId,
        projectId: input.projectId,
        machineId: input.machineId,
        rootPath: input.rootPath,
        ...(installation === undefined
          ? {}
          : {
              providerInstallationId: installation.installationId,
              installationRevision: installation.installationRevision,
            }),
        native,
        createdAtMs: now,
        adoptedConversationId: input.adoptedConversation(native),
      })
      return candidateId
    })
    const providers = input.pages.map(providerResult)
    const snapshot: DiscoverySnapshot = {
      snapshotId,
      projectId: input.projectId,
      machineId: input.machineId,
      ...(input.providerFilter === undefined
        ? {}
        : { providerFilter: input.providerFilter }),
      candidateIds,
      providers,
      createdAtMs: now,
    }
    this.#snapshots.set(snapshotId, snapshot)
    return this.#page(snapshot, 0, input.limit)
  }

  page(input: {
    readonly projectId: ProjectId
    readonly machineId: MachineId
    readonly providerFilter?: ProviderId
    readonly cursor: ProviderSessionDiscoveryCursor
    readonly limit: number
  }): DiscoverProviderSessionsResponse | undefined {
    this.#prune()
    const cursor = this.#cursors.get(input.cursor)
    if (cursor === undefined) return undefined
    const snapshot = this.#snapshots.get(cursor.snapshotId)
    if (
      snapshot === undefined ||
      snapshot.projectId !== input.projectId ||
      snapshot.machineId !== input.machineId ||
      snapshot.providerFilter !== input.providerFilter
    ) {
      return undefined
    }
    return this.#page(snapshot, cursor.offset, input.limit)
  }

  candidate(
    candidateId: DiscoveryCandidateId,
    scope: { readonly projectId: ProjectId; readonly machineId: MachineId },
  ): PrivateDiscoveryCandidate | undefined {
    this.#prune()
    const candidate = this.#candidates.get(candidateId)
    if (
      candidate === undefined ||
      candidate.projectId !== scope.projectId ||
      candidate.machineId !== scope.machineId
    ) {
      return undefined
    }
    return candidate
  }

  markAdopted(
    machineId: MachineId,
    provider: ProviderId,
    nativeSessionId: string,
    conversationId: ConversationId,
  ): void {
    this.#prune()
    for (const candidate of this.#candidates.values()) {
      if (
        candidate.machineId === machineId &&
        candidate.native.provider === provider &&
        candidate.native.nativeSessionId === nativeSessionId
      ) {
        candidate.adoptedConversationId = conversationId
      }
    }
  }

  clear(): void {
    this.#snapshots.clear()
    this.#candidates.clear()
    this.#cursors.clear()
  }

  counts(): {
    readonly snapshots: number
    readonly candidates: number
    readonly cursors: number
  } {
    this.#prune()
    return {
      snapshots: this.#snapshots.size,
      candidates: this.#candidates.size,
      cursors: this.#cursors.size,
    }
  }

  #page(
    snapshot: DiscoverySnapshot,
    offset: number,
    limit: number,
  ): DiscoverProviderSessionsResponse {
    const boundedLimit = Math.min(
      Math.max(1, limit),
      providerSessionDiscoveryLimits.maximumPageSize,
    )
    const candidateIds = snapshot.candidateIds.slice(
      offset,
      offset + boundedLimit,
    )
    const candidates = candidateIds.flatMap((candidateId) => {
      const candidate = this.#candidates.get(candidateId)
      return candidate === undefined ? [] : [publicCandidate(candidate)]
    })
    const nextOffset = offset + candidateIds.length
    const nextCursor =
      nextOffset < snapshot.candidateIds.length
        ? this.#newCursor(snapshot.snapshotId, nextOffset)
        : undefined
    return {
      protocolVersion: 1,
      candidates,
      providers: [...snapshot.providers],
      ...(nextCursor === undefined ? {} : { nextCursor }),
    }
  }

  #newCursor(
    snapshotId: string,
    offset: number,
  ): ProviderSessionDiscoveryCursor {
    while (this.#cursors.size >= this.#maximumCursors) {
      const oldest = this.#cursors.keys().next().value as
        ProviderSessionDiscoveryCursor | undefined
      if (oldest === undefined) break
      this.#cursors.delete(oldest)
    }
    const cursor = ProviderSessionDiscoveryCursorSchema.parse(
      `scan_${this.#randomId().replaceAll('-', '')}`,
    )
    this.#cursors.set(cursor, {
      cursor,
      snapshotId,
      offset,
      createdAtMs: this.#now(),
    })
    return cursor
  }

  #newPrivateId(prefix: string): string {
    return `${prefix}_${this.#randomId().replaceAll('-', '')}`
  }

  #prune(): void {
    const cutoff = this.#now() - this.#snapshotTtlMs
    for (const snapshot of [...this.#snapshots.values()]) {
      if (snapshot.createdAtMs <= cutoff)
        this.#deleteSnapshot(snapshot.snapshotId)
    }
    for (const [cursor, entry] of this.#cursors) {
      if (
        entry.createdAtMs <= cutoff ||
        !this.#snapshots.has(entry.snapshotId)
      ) {
        this.#cursors.delete(cursor)
      }
    }
  }

  #deleteSnapshot(snapshotId: string): void {
    const snapshot = this.#snapshots.get(snapshotId)
    if (snapshot === undefined) return
    this.#snapshots.delete(snapshotId)
    for (const candidateId of snapshot.candidateIds) {
      this.#candidates.delete(candidateId)
    }
    for (const [cursor, entry] of this.#cursors) {
      if (entry.snapshotId === snapshotId) this.#cursors.delete(cursor)
    }
  }
}

function publicCandidate(
  candidate: StoredCandidate,
): ProviderSessionDiscoveryCandidate {
  return {
    discoveryCandidateId: candidate.candidateId,
    provider: candidate.native.provider,
    machineId: candidate.machineId,
    title: candidate.native.title,
    ...(candidate.native.createdAt === undefined
      ? {}
      : { createdAt: candidate.native.createdAt }),
    ...(candidate.native.lastActiveAt === undefined
      ? {}
      : { lastActiveAt: candidate.native.lastActiveAt }),
    resumeStatus: candidate.native.resumeStatus,
    historicalTranscript: candidate.native.historicalTranscript,
    alreadyAdopted: candidate.adoptedConversationId !== undefined,
    ...(candidate.adoptedConversationId === undefined
      ? {}
      : { conversationId: candidate.adoptedConversationId }),
  }
}

function providerResult(
  page: ProviderSessionDiscoveryPage,
): ProviderSessionDiscoveryProviderResult {
  return {
    provider: page.provider,
    status: page.status,
    resumeStatus: page.resumeStatus,
    ...(page.providerVersion === undefined
      ? {}
      : { providerVersion: page.providerVersion }),
    candidateCount: page.candidates.length,
    corruptEntriesSkipped: page.metrics.corruptEntriesSkipped,
    ...(page.failureReason === undefined
      ? {}
      : { failureReason: page.failureReason }),
  }
}

function compareCandidates(
  left: NativeProviderSessionCandidate,
  right: NativeProviderSessionCandidate,
): number {
  return (
    (right.lastActiveAt ?? '').localeCompare(left.lastActiveAt ?? '') ||
    (right.createdAt ?? '').localeCompare(left.createdAt ?? '') ||
    left.provider.localeCompare(right.provider) ||
    left.nativeSessionId.localeCompare(right.nativeSessionId)
  )
}

function positiveInteger(value: number | undefined, fallback: number): number {
  const selected = value ?? fallback
  if (!Number.isSafeInteger(selected) || selected <= 0) {
    throw new TypeError('Discovery registry bounds must be positive integers')
  }
  return selected
}
