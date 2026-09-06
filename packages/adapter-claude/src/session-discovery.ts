import { createHash, randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, opendir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { TextDecoder } from 'node:util'

import type {
  NativeProviderSessionCandidate,
  ProviderSessionCandidateValidationRequest,
  ProviderSessionDiscovery,
  ProviderSessionDiscoveryMetrics,
  ProviderSessionDiscoveryPage,
  ProviderSessionDiscoveryRequest,
} from '@codetether/agent-core'

const CLAUDE_PROVIDER = 'claude-code' as const
const UUID_FILE_PATTERN =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.jsonl$/iu
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const REVISION_PATTERN = /^[0-9a-f]{64}$/u
const SEMANTIC_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u

const SUPPORTED_CLAUDE_STORE_WRITERS = new Set([
  '2.1.250',
  '2.1.251',
  '2.1.263',
])

const MAXIMUM_PAGE_SIZE = 100
const DEFAULT_MAXIMUM_PROJECT_DIRECTORIES = 4_096
const DEFAULT_MAXIMUM_SESSION_FILES = 5_000
const DEFAULT_MAXIMUM_STORE_ENTRIES = 20_000
const DEFAULT_MAXIMUM_SESSION_FILE_BYTES = 16 * 1024 * 1024
const DEFAULT_MAXIMUM_SESSION_LINE_BYTES = 2 * 1024 * 1024
const DEFAULT_MAXIMUM_SCAN_BYTES = 256 * 1024 * 1024
const DEFAULT_MAXIMUM_CACHED_SNAPSHOTS = 8
const DEFAULT_SNAPSHOT_TTL_MS = 60_000
const MAXIMUM_PATH_CODE_UNITS = 4_096
// Keep titles inside both public Protocol v1's 240 UTF-16-unit bound and the
// private Machine protocol's 512 UTF-8-byte bound, including astral text.
const MAXIMUM_TITLE_CODE_POINTS = 120
const MAXIMUM_CURSOR_CODE_UNITS = 512

type CanonicalizePath = (path: string, signal?: AbortSignal) => Promise<string>

export interface ClaudeSessionDiscoveryOptions {
  readonly environment?: NodeJS.ProcessEnv
  /** Current detected CLI version. Unknown installed versions fail closed. */
  readonly providerVersion?: string
  readonly canonicalizePath?: CanonicalizePath
  readonly maximumProjectDirectories?: number
  readonly maximumSessionFiles?: number
  readonly maximumStoreEntries?: number
  readonly maximumSessionFileBytes?: number
  readonly maximumSessionLineBytes?: number
  readonly maximumScanBytes?: number
  readonly maximumCachedSnapshots?: number
  readonly snapshotTtlMs?: number
  readonly now?: () => number
}

interface MutableDiscoveryMetrics {
  filesInspected: number
  candidatesParsed: number
  candidatesMatched: number
  corruptEntriesSkipped: number
  elapsedMs: number
  truncated: boolean
}

interface ScanResult {
  readonly candidates: readonly NativeProviderSessionCandidate[]
  readonly metrics: ProviderSessionDiscoveryMetrics
}

interface InFlightScan {
  readonly controller: AbortController
  waiters: number
  settled: boolean
  promise: Promise<ScanResult>
}

interface DiscoverySnapshot {
  readonly id: string
  readonly projectKey: string
  readonly candidates: readonly NativeProviderSessionCandidate[]
  readonly metrics: ProviderSessionDiscoveryMetrics
  readonly expiresAt: number
}

interface CursorPayload {
  readonly version: 1
  readonly snapshotId: string
  readonly projectKey: string
  readonly offset: number
}

interface ParsedSessionFile {
  readonly candidate: NativeProviderSessionCandidate
  readonly bytesRead: number
}

class ClaudeSessionStoreUnreadableError extends Error {}
class ClaudeSessionEntryCorruptError extends Error {}

/**
 * Read-only Claude Code native-session discovery.
 *
 * This adapter deliberately reads only the configured Claude state root's
 * immediate UUID JSONL files below each projects directory entry. It never
 * reads settings/auth files, starts the Claude executable, contacts an
 * inference backend, or retains transcript content after parsing a bounded
 * JSONL record.
 */
export class ClaudeSessionDiscovery implements ProviderSessionDiscovery {
  readonly provider = CLAUDE_PROVIDER

  readonly #configurationDirectory: string | undefined
  readonly #providerVersion: string | undefined
  readonly #canonicalizePath: CanonicalizePath
  readonly #maximumProjectDirectories: number
  readonly #maximumSessionFiles: number
  readonly #maximumStoreEntries: number
  readonly #maximumSessionFileBytes: number
  readonly #maximumSessionLineBytes: number
  readonly #maximumScanBytes: number
  readonly #maximumCachedSnapshots: number
  readonly #snapshotTtlMs: number
  readonly #now: () => number
  readonly #inFlight = new Map<string, InFlightScan>()
  readonly #snapshots = new Map<string, DiscoverySnapshot>()

  constructor(options: ClaudeSessionDiscoveryOptions = {}) {
    this.#configurationDirectory = resolveClaudeConfigurationDirectory(
      options.environment ?? process.env,
    )
    this.#providerVersion = options.providerVersion
    this.#canonicalizePath = options.canonicalizePath ?? canonicalizeRealPath
    this.#maximumProjectDirectories = positiveInteger(
      options.maximumProjectDirectories ?? DEFAULT_MAXIMUM_PROJECT_DIRECTORIES,
      'maximumProjectDirectories',
    )
    this.#maximumSessionFiles = positiveInteger(
      options.maximumSessionFiles ?? DEFAULT_MAXIMUM_SESSION_FILES,
      'maximumSessionFiles',
    )
    this.#maximumStoreEntries = positiveInteger(
      options.maximumStoreEntries ?? DEFAULT_MAXIMUM_STORE_ENTRIES,
      'maximumStoreEntries',
    )
    this.#maximumSessionFileBytes = positiveInteger(
      options.maximumSessionFileBytes ?? DEFAULT_MAXIMUM_SESSION_FILE_BYTES,
      'maximumSessionFileBytes',
    )
    this.#maximumSessionLineBytes = positiveInteger(
      options.maximumSessionLineBytes ?? DEFAULT_MAXIMUM_SESSION_LINE_BYTES,
      'maximumSessionLineBytes',
    )
    this.#maximumScanBytes = positiveInteger(
      options.maximumScanBytes ?? DEFAULT_MAXIMUM_SCAN_BYTES,
      'maximumScanBytes',
    )
    this.#maximumCachedSnapshots = positiveInteger(
      options.maximumCachedSnapshots ?? DEFAULT_MAXIMUM_CACHED_SNAPSHOTS,
      'maximumCachedSnapshots',
    )
    this.#snapshotTtlMs = positiveInteger(
      options.snapshotTtlMs ?? DEFAULT_SNAPSHOT_TTL_MS,
      'snapshotTtlMs',
    )
    this.#now = options.now ?? Date.now
  }

  async discover(
    request: ProviderSessionDiscoveryRequest,
  ): Promise<ProviderSessionDiscoveryPage> {
    validatePageSize(request.limit)
    throwIfAborted(request.signal)

    if (isExplicitlyUnsupportedProviderVersion(this.#providerVersion)) {
      return this.#unavailablePage(
        'unsupported',
        'provider_session_format_unsupported',
      )
    }
    if (this.#configurationDirectory === undefined) {
      return this.#unavailablePage(
        'unavailable',
        'provider_session_discovery_unavailable',
      )
    }

    let canonicalProjectRoot: string
    try {
      canonicalProjectRoot = await this.#canonicalizePath(
        validatePath(request.projectRoot, 'projectRoot'),
        request.signal,
      )
    } catch (error) {
      if (isAbortError(error)) throw error
      return this.#unavailablePage(
        'unavailable',
        'provider_session_discovery_unavailable',
      )
    }
    throwIfAborted(request.signal)
    const projectKey = privateDigest(canonicalProjectRoot)

    if (request.cursor !== undefined) {
      return this.#pageFromCursor(
        request.cursor,
        projectKey,
        request.limit,
        request.signal,
      )
    }

    let result: ScanResult
    try {
      result = await this.#joinScan(
        canonicalProjectRoot,
        projectKey,
        request.signal,
      )
    } catch (error) {
      if (isAbortError(error)) throw error
      return this.#unavailablePage(
        'unavailable',
        error instanceof ClaudeSessionStoreUnreadableError
          ? 'provider_session_store_unreadable'
          : 'provider_session_discovery_unavailable',
      )
    }

    if (
      result.metrics.filesInspected > 0 &&
      result.metrics.candidatesParsed === 0 &&
      result.metrics.corruptEntriesSkipped > 0
    ) {
      return this.#unavailablePage(
        'unavailable',
        'provider_session_format_unsupported',
        result.metrics,
      )
    }

    const pageCandidates = result.candidates.slice(0, request.limit)
    if (result.candidates.length <= request.limit) {
      return this.#supportedPage(pageCandidates, result.metrics)
    }

    const snapshot = this.#storeSnapshot(
      projectKey,
      result.candidates,
      result.metrics,
    )
    return this.#supportedPage(pageCandidates, result.metrics, {
      version: 1,
      snapshotId: snapshot.id,
      projectKey,
      offset: pageCandidates.length,
    })
  }

  async validateCandidate(
    request: ProviderSessionCandidateValidationRequest,
  ): Promise<NativeProviderSessionCandidate | undefined> {
    throwIfAborted(request.signal)
    if (
      isExplicitlyUnsupportedProviderVersion(this.#providerVersion) ||
      this.#configurationDirectory === undefined ||
      !UUID_PATTERN.test(request.nativeSessionId) ||
      !REVISION_PATTERN.test(request.revision)
    ) {
      return undefined
    }

    let canonicalProjectRoot: string
    try {
      canonicalProjectRoot = await this.#canonicalizePath(
        validatePath(request.projectRoot, 'projectRoot'),
        request.signal,
      )
    } catch (error) {
      if (isAbortError(error)) throw error
      return undefined
    }

    const projectsDirectory = join(this.#configurationDirectory, 'projects')
    let projectDirectories: readonly string[]
    try {
      projectDirectories = await collectProjectDirectories(
        projectsDirectory,
        this.#maximumProjectDirectories,
        this.#maximumStoreEntries,
        request.signal,
      )
    } catch (error) {
      if (isAbortError(error)) throw error
      return undefined
    }

    let matched: NativeProviderSessionCandidate | undefined
    for (const projectDirectory of projectDirectories) {
      throwIfAborted(request.signal)
      const nativeSessionId = request.nativeSessionId.toLowerCase()
      const path = join(projectDirectory, `${nativeSessionId}.jsonl`)
      let parsed: ParsedSessionFile
      try {
        parsed = await this.#parseSessionFile(
          path,
          nativeSessionId,
          canonicalProjectRoot,
          request.signal,
        )
      } catch (error) {
        if (isAbortError(error)) throw error
        continue
      }
      if (parsed.candidate.revision !== request.revision) continue
      if (matched !== undefined) return undefined
      matched = parsed.candidate
    }
    return matched
  }

  async #joinScan(
    canonicalProjectRoot: string,
    projectKey: string,
    signal: AbortSignal | undefined,
  ): Promise<ScanResult> {
    throwIfAborted(signal)
    let entry = this.#inFlight.get(projectKey)
    if (entry === undefined) {
      const controller = new AbortController()
      const created: InFlightScan = {
        controller,
        waiters: 0,
        settled: false,
        promise: Promise.resolve({
          candidates: [],
          metrics: emptyMetrics(),
        }),
      }
      created.promise = this.#scan(
        canonicalProjectRoot,
        controller.signal,
      ).finally(() => {
        created.settled = true
        if (this.#inFlight.get(projectKey) === created) {
          this.#inFlight.delete(projectKey)
        }
      })
      this.#inFlight.set(projectKey, created)
      entry = created
    }

    entry.waiters += 1
    try {
      return await waitForPromise(entry.promise, signal)
    } finally {
      entry.waiters -= 1
      if (entry.waiters === 0 && !entry.settled) entry.controller.abort()
    }
  }

  async #scan(
    canonicalProjectRoot: string,
    signal: AbortSignal,
  ): Promise<ScanResult> {
    const startedAt = this.#now()
    const metrics: MutableDiscoveryMetrics = {
      filesInspected: 0,
      candidatesParsed: 0,
      candidatesMatched: 0,
      corruptEntriesSkipped: 0,
      elapsedMs: 0,
      truncated: false,
    }
    const projectsDirectory = join(
      this.#configurationDirectory as string,
      'projects',
    )
    const projectDirectories = await collectProjectDirectories(
      projectsDirectory,
      this.#maximumProjectDirectories,
      this.#maximumStoreEntries,
      signal,
      metrics,
    )
    const matched = new Map<string, NativeProviderSessionCandidate>()
    const ambiguous = new Set<string>()
    let bytesInspected = 0
    let storeEntriesInspected = 0

    outer: for (const projectDirectory of projectDirectories) {
      throwIfAborted(signal)
      let directory
      try {
        directory = await opendir(projectDirectory)
      } catch (error) {
        if (isAbortError(error)) throw error
        metrics.corruptEntriesSkipped += 1
        continue
      }
      try {
        for await (const entry of directory) {
          throwIfAborted(signal)
          storeEntriesInspected += 1
          if (storeEntriesInspected > this.#maximumStoreEntries) {
            metrics.truncated = true
            break outer
          }
          const identity = UUID_FILE_PATTERN.exec(
            entry.name,
          )?.[1]?.toLowerCase()
          if (identity === undefined || !entry.isFile()) continue
          if (metrics.filesInspected >= this.#maximumSessionFiles) {
            metrics.truncated = true
            break outer
          }
          const path = join(projectDirectory, entry.name)
          metrics.filesInspected += 1

          let size: number
          try {
            const info = await lstat(path)
            if (!info.isFile() || info.isSymbolicLink()) {
              metrics.corruptEntriesSkipped += 1
              continue
            }
            size = info.size
          } catch {
            metrics.corruptEntriesSkipped += 1
            continue
          }
          if (
            size <= 0 ||
            size > this.#maximumSessionFileBytes ||
            bytesInspected + size > this.#maximumScanBytes
          ) {
            metrics.corruptEntriesSkipped += 1
            if (bytesInspected + size > this.#maximumScanBytes) {
              metrics.truncated = true
              break outer
            }
            continue
          }
          bytesInspected += size

          let parsed: ParsedSessionFile
          try {
            parsed = await this.#parseSessionFile(
              path,
              identity,
              canonicalProjectRoot,
              signal,
            )
          } catch (error) {
            if (isAbortError(error)) throw error
            metrics.corruptEntriesSkipped += 1
            continue
          }
          metrics.candidatesParsed += 1
          if (
            !sameCanonicalPath(
              parsed.candidate.workingDirectory,
              canonicalProjectRoot,
            )
          ) {
            continue
          }
          metrics.candidatesMatched += 1

          if (ambiguous.has(identity)) continue
          const existing = matched.get(identity)
          if (existing === undefined) {
            matched.set(identity, parsed.candidate)
            continue
          }
          if (
            sameCanonicalPath(
              existing.workingDirectory,
              parsed.candidate.workingDirectory,
            )
          ) {
            continue
          }
          matched.delete(identity)
          ambiguous.add(identity)
          metrics.corruptEntriesSkipped += 1
        }
      } finally {
        await directory.close().catch(() => undefined)
      }
    }

    const candidates = Object.freeze(
      [...matched.values()].sort(compareCandidates),
    )
    metrics.elapsedMs = Math.max(0, this.#now() - startedAt)
    return { candidates, metrics: freezeMetrics(metrics) }
  }

  async #parseSessionFile(
    path: string,
    expectedSessionId: string,
    canonicalProjectRoot: string,
    signal: AbortSignal | undefined,
  ): Promise<ParsedSessionFile> {
    throwIfAborted(signal)
    const before = await lstat(path)
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.size <= 0 ||
      before.size > this.#maximumSessionFileBytes
    ) {
      throw new ClaudeSessionEntryCorruptError()
    }

    const digest = createHash('sha256')
    const sessionIds = new Set<string>()
    const workingDirectories = new Set<string>()
    const writerVersions = new Set<string>()
    let latestWriterVersion: string | undefined
    let latestTitle: string | undefined
    let createdAtMs: number | undefined
    let lastActiveAtMs: number | undefined
    let bytesRead = 0
    let lineNumber = 0

    const stream = createReadStream(path, {
      highWaterMark: 64 * 1024,
      ...(signal === undefined ? {} : { signal }),
    })
    let remainder: Buffer = Buffer.alloc(0)
    try {
      for await (const rawChunk of stream) {
        throwIfAborted(signal)
        const chunk = Buffer.isBuffer(rawChunk)
          ? rawChunk
          : Buffer.from(rawChunk)
        bytesRead += chunk.byteLength
        if (bytesRead > this.#maximumSessionFileBytes) {
          throw new ClaudeSessionEntryCorruptError()
        }
        digest.update(chunk)
        let start = 0
        for (;;) {
          const newline = chunk.indexOf(0x0a, start)
          if (newline === -1) break
          const fragment = chunk.subarray(start, newline)
          const line = appendBounded(
            remainder,
            fragment,
            this.#maximumSessionLineBytes,
          )
          remainder = Buffer.alloc(0)
          lineNumber += 1
          inspectSessionLine(line, lineNumber === 1, {
            expectedSessionId,
            sessionIds,
            workingDirectories,
            writerVersions,
            observeWriterVersion: (version) => {
              latestWriterVersion = version
            },
            observeTitle: (title) => {
              latestTitle = title
            },
            observeTimestamp: (timestamp) => {
              createdAtMs =
                createdAtMs === undefined
                  ? timestamp
                  : Math.min(createdAtMs, timestamp)
              lastActiveAtMs =
                lastActiveAtMs === undefined
                  ? timestamp
                  : Math.max(lastActiveAtMs, timestamp)
            },
          })
          start = newline + 1
        }
        remainder = appendBounded(
          remainder,
          chunk.subarray(start),
          this.#maximumSessionLineBytes,
        )
      }
      if (remainder.byteLength > 0) {
        lineNumber += 1
        inspectSessionLine(remainder, lineNumber === 1, {
          expectedSessionId,
          sessionIds,
          workingDirectories,
          writerVersions,
          observeWriterVersion: (version) => {
            latestWriterVersion = version
          },
          observeTitle: (title) => {
            latestTitle = title
          },
          observeTimestamp: (timestamp) => {
            createdAtMs =
              createdAtMs === undefined
                ? timestamp
                : Math.min(createdAtMs, timestamp)
            lastActiveAtMs =
              lastActiveAtMs === undefined
                ? timestamp
                : Math.max(lastActiveAtMs, timestamp)
          },
        })
      }
    } catch (error) {
      if (isAbortError(error)) throw error
      throw new ClaudeSessionEntryCorruptError()
    }

    if (
      lineNumber === 0 ||
      sessionIds.size !== 1 ||
      !sessionIds.has(expectedSessionId) ||
      workingDirectories.size !== 1
    ) {
      throw new ClaudeSessionEntryCorruptError()
    }
    const recordedWorkingDirectory = [...workingDirectories][0]
    if (recordedWorkingDirectory === undefined) {
      throw new ClaudeSessionEntryCorruptError()
    }

    let canonicalWorkingDirectory: string
    try {
      canonicalWorkingDirectory = await this.#canonicalizePath(
        recordedWorkingDirectory,
        signal,
      )
    } catch (error) {
      if (isAbortError(error)) throw error
      canonicalWorkingDirectory = recordedWorkingDirectory
    }

    const after = await lstat(path)
    if (!sameFileObservation(before, after) || bytesRead !== before.size) {
      throw new ClaudeSessionEntryCorruptError()
    }

    const createdAt = toIsoTimestamp(createdAtMs)
    const lastActiveAt = toIsoTimestamp(lastActiveAtMs)
    const providerVersion = latestWriterVersion
    const candidate: NativeProviderSessionCandidate = Object.freeze({
      provider: CLAUDE_PROVIDER,
      nativeSessionId: expectedSessionId,
      // This is a private opaque revision token, not a public digest label.
      // Plain lowercase hex is compatible with the bounded Machine wire token.
      revision: digest.digest('hex'),
      workingDirectory: sameCanonicalPath(
        canonicalWorkingDirectory,
        canonicalProjectRoot,
      )
        ? canonicalProjectRoot
        : canonicalWorkingDirectory,
      title: latestTitle ?? fallbackTitle(createdAt ?? lastActiveAt),
      ...(createdAt === undefined ? {} : { createdAt }),
      ...(lastActiveAt === undefined ? {} : { lastActiveAt }),
      ...(providerVersion === undefined ? {} : { providerVersion }),
      resumeStatus:
        writerVersions.size > 0 &&
        [...writerVersions].every((version) =>
          SUPPORTED_CLAUDE_STORE_WRITERS.has(version),
        )
          ? 'supported'
          : 'unavailable',
      historicalTranscript: 'unavailable',
    })
    return { candidate, bytesRead }
  }

  #pageFromCursor(
    encodedCursor: string,
    projectKey: string,
    limit: number,
    signal: AbortSignal | undefined,
  ): ProviderSessionDiscoveryPage {
    throwIfAborted(signal)
    this.#pruneSnapshots()
    const cursor = decodeCursor(encodedCursor)
    if (cursor.projectKey !== projectKey) {
      throw new TypeError('Discovery cursor does not match project')
    }
    const snapshot = this.#snapshots.get(cursor.snapshotId)
    if (
      snapshot === undefined ||
      snapshot.projectKey !== projectKey ||
      cursor.offset < 0 ||
      cursor.offset >= snapshot.candidates.length
    ) {
      throw new RangeError('Discovery cursor expired')
    }

    const candidates = snapshot.candidates.slice(
      cursor.offset,
      cursor.offset + limit,
    )
    const nextOffset = cursor.offset + candidates.length
    if (nextOffset >= snapshot.candidates.length) {
      this.#snapshots.delete(snapshot.id)
      return this.#supportedPage(candidates, emptyMetrics())
    }
    return this.#supportedPage(candidates, emptyMetrics(), {
      ...cursor,
      offset: nextOffset,
    })
  }

  #storeSnapshot(
    projectKey: string,
    candidates: readonly NativeProviderSessionCandidate[],
    metrics: ProviderSessionDiscoveryMetrics,
  ): DiscoverySnapshot {
    this.#pruneSnapshots()
    while (this.#snapshots.size >= this.#maximumCachedSnapshots) {
      const oldest = this.#snapshots.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.#snapshots.delete(oldest)
    }
    const snapshot: DiscoverySnapshot = Object.freeze({
      id: randomBytes(18).toString('base64url'),
      projectKey,
      candidates,
      metrics,
      expiresAt: this.#now() + this.#snapshotTtlMs,
    })
    this.#snapshots.set(snapshot.id, snapshot)
    return snapshot
  }

  #pruneSnapshots(): void {
    const now = this.#now()
    for (const [id, snapshot] of this.#snapshots) {
      if (snapshot.expiresAt <= now) this.#snapshots.delete(id)
    }
  }

  #supportedPage(
    candidates: readonly NativeProviderSessionCandidate[],
    metrics: ProviderSessionDiscoveryMetrics,
    cursor?: CursorPayload,
  ): ProviderSessionDiscoveryPage {
    return {
      provider: CLAUDE_PROVIDER,
      status: 'supported',
      resumeStatus: 'supported',
      ...(this.#providerVersion === undefined
        ? {}
        : { providerVersion: this.#providerVersion }),
      candidates,
      ...(cursor === undefined ? {} : { nextCursor: encodeCursor(cursor) }),
      metrics,
    }
  }

  #unavailablePage(
    status: 'unsupported' | 'unavailable',
    failureReason:
      | 'provider_session_discovery_unavailable'
      | 'provider_session_format_unsupported'
      | 'provider_session_store_unreadable',
    metrics: ProviderSessionDiscoveryMetrics = emptyMetrics(),
  ): ProviderSessionDiscoveryPage {
    return {
      provider: CLAUDE_PROVIDER,
      status,
      resumeStatus: status,
      ...(this.#providerVersion === undefined
        ? {}
        : { providerVersion: this.#providerVersion }),
      candidates: [],
      failureReason,
      metrics,
    }
  }
}

interface SessionLineObservation {
  readonly expectedSessionId: string
  readonly sessionIds: Set<string>
  readonly workingDirectories: Set<string>
  readonly writerVersions: Set<string>
  readonly observeWriterVersion: (version: string) => void
  readonly observeTitle: (title: string) => void
  readonly observeTimestamp: (timestamp: number) => void
}

function inspectSessionLine(
  line: Buffer,
  firstLine: boolean,
  observation: SessionLineObservation,
): void {
  if (line.byteLength === 0) return
  let decoded: string
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(line)
  } catch {
    throw new ClaudeSessionEntryCorruptError()
  }
  if (firstLine && decoded.charCodeAt(0) === 0xfeff) decoded = decoded.slice(1)
  let record: unknown
  try {
    record = JSON.parse(decoded)
  } catch {
    throw new ClaudeSessionEntryCorruptError()
  }
  if (!isRecord(record)) throw new ClaudeSessionEntryCorruptError()

  if ('sessionId' in record) {
    if (
      typeof record.sessionId !== 'string' ||
      !UUID_PATTERN.test(record.sessionId) ||
      record.sessionId.toLowerCase() !== observation.expectedSessionId
    ) {
      throw new ClaudeSessionEntryCorruptError()
    }
    observation.sessionIds.add(record.sessionId.toLowerCase())
  }
  if ('cwd' in record) {
    if (
      typeof record.cwd !== 'string' ||
      record.cwd.length === 0 ||
      record.cwd.length > MAXIMUM_PATH_CODE_UNITS ||
      record.cwd.includes('\0') ||
      !isAbsolute(record.cwd)
    ) {
      throw new ClaudeSessionEntryCorruptError()
    }
    observation.workingDirectories.add(record.cwd)
  }
  if (
    typeof record.version === 'string' &&
    record.version.length <= 120 &&
    SEMANTIC_VERSION_PATTERN.test(record.version)
  ) {
    observation.writerVersions.add(record.version)
    observation.observeWriterVersion(record.version)
  }
  if (typeof record.timestamp === 'string') {
    const timestamp = Date.parse(record.timestamp)
    if (Number.isFinite(timestamp)) observation.observeTimestamp(timestamp)
  }
  if (record.type === 'ai-title' && typeof record.aiTitle === 'string') {
    const title = normalizeTitle(record.aiTitle)
    if (title !== undefined) observation.observeTitle(title)
  }
}

async function collectProjectDirectories(
  projectsDirectory: string,
  maximumDirectories: number,
  maximumEntries: number,
  signal: AbortSignal | undefined,
  metrics?: MutableDiscoveryMetrics,
): Promise<readonly string[]> {
  throwIfAborted(signal)
  let directory
  try {
    directory = await opendir(projectsDirectory)
  } catch (error) {
    if (isAbortError(error)) throw error
    if (isMissingPathError(error)) return []
    throw new ClaudeSessionStoreUnreadableError()
  }
  const result: string[] = []
  let entriesInspected = 0
  try {
    for await (const entry of directory) {
      throwIfAborted(signal)
      entriesInspected += 1
      if (entriesInspected > maximumEntries) {
        if (metrics !== undefined) metrics.truncated = true
        break
      }
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      if (result.length >= maximumDirectories) {
        if (metrics !== undefined) metrics.truncated = true
        break
      }
      result.push(join(projectsDirectory, entry.name))
    }
  } catch (error) {
    if (isAbortError(error)) throw error
    throw new ClaudeSessionStoreUnreadableError()
  } finally {
    await directory.close().catch(() => undefined)
  }
  result.sort((left, right) => left.localeCompare(right, 'en'))
  return result
}

async function canonicalizeRealPath(
  path: string,
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal)
  const canonical = await realpath(path)
  throwIfAborted(signal)
  return canonical
}

function resolveClaudeConfigurationDirectory(
  environment: NodeJS.ProcessEnv,
): string | undefined {
  const configured = environment.CLAUDE_CONFIG_DIR?.trim()
  if (configured !== undefined && configured.length > 0) {
    return isSafeAbsolutePath(configured) ? configured : undefined
  }
  const home =
    environment.USERPROFILE?.trim() ||
    environment.HOME?.trim() ||
    homedir().trim()
  return isSafeAbsolutePath(home) ? join(home, '.claude') : undefined
}

function isSafeAbsolutePath(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAXIMUM_PATH_CODE_UNITS &&
    !value.includes('\0') &&
    isAbsolute(value)
  )
}

function validatePath(value: string, label: string): string {
  if (!isSafeAbsolutePath(value)) {
    throw new TypeError(`${label} must be a bounded absolute path`)
  }
  return value
}

function appendBounded(
  left: Buffer,
  right: Buffer,
  maximumBytes: number,
): Buffer {
  if (left.byteLength + right.byteLength > maximumBytes) {
    throw new ClaudeSessionEntryCorruptError()
  }
  if (left.byteLength === 0) return Buffer.from(right)
  if (right.byteLength === 0) return left
  return Buffer.concat([left, right], left.byteLength + right.byteLength)
}

function normalizeTitle(value: string): string | undefined {
  const normalized = value.normalize('NFC').replace(/\s+/gu, ' ').trim()
  if (normalized.length === 0 || normalized.includes('\0')) return undefined
  const points = [...normalized]
  if (points.length > MAXIMUM_TITLE_CODE_POINTS) return undefined
  return normalized
}

function fallbackTitle(timestamp: string | undefined): string {
  if (timestamp === undefined) return 'Claude conversation'
  return `Claude conversation - ${timestamp.slice(0, 16).replace('T', ' ')} UTC`
}

function toIsoTimestamp(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  try {
    return new Date(value).toISOString()
  } catch {
    return undefined
  }
}

function compareCandidates(
  left: NativeProviderSessionCandidate,
  right: NativeProviderSessionCandidate,
): number {
  const active = compareDescending(left.lastActiveAt, right.lastActiveAt)
  if (active !== 0) return active
  const created = compareDescending(left.createdAt, right.createdAt)
  if (created !== 0) return created
  return privateDigest(left.nativeSessionId).localeCompare(
    privateDigest(right.nativeSessionId),
    'en',
  )
}

function compareDescending(
  left: string | undefined,
  right: string | undefined,
): number {
  const leftValue = left ?? ''
  const rightValue = right ?? ''
  if (leftValue === rightValue) return 0
  return leftValue > rightValue ? -1 : 1
}

function sameCanonicalPath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? left.replaceAll('/', '\\').toLocaleLowerCase('en-US') ===
        right.replaceAll('/', '\\').toLocaleLowerCase('en-US')
    : left === right
}

function sameFileObservation(
  left: Awaited<ReturnType<typeof lstat>>,
  right: Awaited<ReturnType<typeof lstat>>,
): boolean {
  return (
    right.isFile() &&
    !right.isSymbolicLink() &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs
  )
}

function privateDigest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function encodeCursor(cursor: CursorPayload): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function decodeCursor(value: string): CursorPayload {
  if (value.length === 0 || value.length > MAXIMUM_CURSOR_CODE_UNITS) {
    throw new TypeError('Discovery cursor is invalid')
  }
  let decoded: unknown
  try {
    decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
  } catch {
    throw new TypeError('Discovery cursor is invalid')
  }
  if (
    !isRecord(decoded) ||
    decoded.version !== 1 ||
    typeof decoded.snapshotId !== 'string' ||
    decoded.snapshotId.length < 16 ||
    decoded.snapshotId.length > 64 ||
    typeof decoded.projectKey !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(decoded.projectKey) ||
    !Number.isSafeInteger(decoded.offset) ||
    (decoded.offset as number) <= 0
  ) {
    throw new TypeError('Discovery cursor is invalid')
  }
  return {
    version: 1,
    snapshotId: decoded.snapshotId,
    projectKey: decoded.projectKey,
    offset: decoded.offset as number,
  }
}

function freezeMetrics(
  metrics: MutableDiscoveryMetrics,
): ProviderSessionDiscoveryMetrics {
  return Object.freeze({ ...metrics })
}

function emptyMetrics(): ProviderSessionDiscoveryMetrics {
  return Object.freeze({
    filesInspected: 0,
    candidatesParsed: 0,
    candidatesMatched: 0,
    corruptEntriesSkipped: 0,
    elapsedMs: 0,
    truncated: false,
  })
}

function validatePageSize(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAXIMUM_PAGE_SIZE) {
    throw new RangeError(
      `limit must be an integer between 1 and ${String(MAXIMUM_PAGE_SIZE)}`,
    )
  }
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`)
  }
  return value
}

function isExplicitlyUnsupportedProviderVersion(
  version: string | undefined,
): boolean {
  return version !== undefined && !SUPPORTED_CLAUDE_STORE_WRITERS.has(version)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

function abortError(): Error {
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw abortError()
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function waitForPromise<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal === undefined) return promise
  throwIfAborted(signal)
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const onAbort = () => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      reject(abortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    void promise.then(
      (value) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        reject(error instanceof Error ? error : new Error('Discovery failed'))
      },
    )
  })
}
