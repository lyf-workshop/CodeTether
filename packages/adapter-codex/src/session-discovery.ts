import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'

import type {
  NativeProviderSessionCandidate,
  NativeTranscriptEntry,
  NativeTranscriptPage,
  ProviderSessionCandidateValidationRequest,
  ProviderSessionDiscovery,
  ProviderSessionDiscoveryFailureReason,
  ProviderSessionDiscoveryPage,
  ProviderSessionDiscoveryRequest,
  ProviderSessionTranscriptReadRequest,
  ProviderSessionTranscriptReader,
} from '@codetether/agent-core'

import {
  CodexAppServerClient,
  MAX_CODEX_STORED_THREAD_CURSOR_CODE_UNITS,
  MAX_CODEX_STORED_THREAD_ID_CODE_UNITS,
  MAX_CODEX_STORED_THREAD_PAGE_SIZE,
} from './client.js'
import { CodexOwnedProcessCleanupError, CodexProtocolError } from './errors.js'
import type { RemoteCodexProcessFactory } from './process.js'
import type { CodexStoredThread, CodexStoredThreadPage } from './protocol.js'
import type { CodexStoredThreadItemPage } from './protocol.js'

const CODEX_DISCOVERY_CLIENT_INFO = {
  name: 'codetether-session-discovery',
  title: 'CodeTether Session Discovery',
  version: '1',
} as const
const MAX_TITLE_CODE_POINTS = 120
const MAX_REVISION_CODE_UNITS = 128
const REVISION_PATTERN = /^[A-Za-z0-9_-]+$/u
const MAX_TRANSCRIPT_ENTRY_BYTES = 64 * 1024
const MAX_TRANSCRIPT_PAGE_BYTES = 512 * 1024

export interface CodexSessionMetadataClient {
  listStoredThreads(options: {
    readonly cwd: string
    readonly cursor?: string
    readonly limit: number
  }): Promise<CodexStoredThreadPage>
  readStoredThread(options: {
    readonly threadId: string
  }): Promise<CodexStoredThread>
  listStoredThreadItems?(options: {
    readonly threadId: string
    readonly cursor?: string
    readonly limit: number
    readonly sortDirection?: 'asc' | 'desc'
  }): Promise<CodexStoredThreadItemPage>
  shutdown(): Promise<void>
}

export type CodexSessionMetadataClientFactory =
  () => Promise<CodexSessionMetadataClient>

export interface CodexSessionDiscoveryOptions {
  readonly executable?: string
  /** Supplying codexHome selects the existing fixed remote process profile. */
  readonly codexHome?: string
  readonly environment?: NodeJS.ProcessEnv
  readonly processFactory?: RemoteCodexProcessFactory
  readonly providerVersion?: string
  readonly requestTimeoutMs?: number
  readonly canonicalizePath?: (path: string) => Promise<string>
  /** Internal test seam; production uses the official Codex App Server. */
  readonly clientFactory?: CodexSessionMetadataClientFactory
}

/**
 * Request-scoped, metadata-only discovery through Codex's official app-server
 * thread/list and thread/read APIs. Discovery never starts, resumes, or sends a
 * turn, and every purpose-scoped process is awaited during cleanup.
 */
export class CodexSessionDiscovery
  implements ProviderSessionDiscovery, ProviderSessionTranscriptReader
{
  readonly provider = 'codex' as const
  readonly #clientFactory: CodexSessionMetadataClientFactory
  readonly #canonicalizePath: (path: string) => Promise<string>
  readonly #providerVersion?: string
  #cleanupFailure?: CodexOwnedProcessCleanupError

  constructor(options: CodexSessionDiscoveryOptions = {}) {
    if (options.codexHome !== undefined && !isAbsolute(options.codexHome)) {
      throw new TypeError('Codex discovery home must be an absolute path')
    }
    this.#providerVersion = options.providerVersion
    this.#canonicalizePath = options.canonicalizePath ?? realpath
    this.#clientFactory =
      options.clientFactory ?? createDefaultClientFactory(options)
  }

  async discover(
    request: ProviderSessionDiscoveryRequest,
  ): Promise<ProviderSessionDiscoveryPage> {
    this.#assertCleanupVerified()
    const startedAt = performance.now()
    assertDiscoveryRequest(request)
    throwIfAborted(request.signal)

    let canonicalProjectRoot: string
    try {
      canonicalProjectRoot = await this.#canonicalizeAbsolutePath(
        request.projectRoot,
        request.signal,
      )
    } catch (error) {
      if (error instanceof CodexOwnedProcessCleanupError) {
        throw this.#latchCleanupFailure(error)
      }
      if (isAbortError(error)) throw error
      return this.#failurePage(startedAt, 'provider_session_store_unreadable')
    }

    try {
      const page = await this.#withClient(
        request.signal,
        async (client) =>
          await client.listStoredThreads({
            cwd: canonicalProjectRoot,
            ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
            limit: request.limit,
          }),
      )
      throwIfAborted(request.signal)

      if (page.threads.length === 0 && page.invalidEntryCount > 0) {
        const failure = this.#failurePage(
          startedAt,
          'provider_session_format_unsupported',
        )
        return {
          ...failure,
          metrics: {
            ...failure.metrics,
            corruptEntriesSkipped: page.invalidEntryCount,
            truncated: page.nextCursor !== undefined,
          },
        }
      }

      const candidates: NativeProviderSessionCandidate[] = []
      const seen = new Set<string>()
      let pathEntriesSkipped = 0
      for (const thread of page.threads) {
        if (seen.has(thread.id)) continue
        if (thread.ephemeral || thread.status !== 'notLoaded') continue

        let canonicalThreadRoot: string
        try {
          canonicalThreadRoot = await this.#canonicalizeAbsolutePath(
            thread.cwd,
            request.signal,
          )
        } catch (error) {
          if (isAbortError(error)) throw error
          pathEntriesSkipped += 1
          continue
        }
        if (!sameMachinePath(canonicalThreadRoot, canonicalProjectRoot))
          continue
        seen.add(thread.id)
        candidates.push(candidateFromThread(thread, canonicalThreadRoot))
      }

      return {
        provider: this.provider,
        status: 'supported',
        resumeStatus: 'supported',
        ...(this.#providerVersion === undefined
          ? {}
          : { providerVersion: this.#providerVersion }),
        candidates,
        ...(page.nextCursor === undefined
          ? {}
          : { nextCursor: page.nextCursor }),
        metrics: {
          filesInspected: 0,
          candidatesParsed: page.threads.length,
          candidatesMatched: candidates.length,
          corruptEntriesSkipped: page.invalidEntryCount + pathEntriesSkipped,
          elapsedMs: elapsedMilliseconds(startedAt),
          truncated: page.nextCursor !== undefined,
        },
      }
    } catch (error) {
      if (error instanceof CodexOwnedProcessCleanupError) {
        throw this.#latchCleanupFailure(error)
      }
      if (isAbortError(error)) throw error
      return this.#failurePage(startedAt, failureReason(error))
    }
  }

  async validateCandidate(
    request: ProviderSessionCandidateValidationRequest,
  ): Promise<NativeProviderSessionCandidate | undefined> {
    this.#assertCleanupVerified()
    assertValidationRequest(request)
    throwIfAborted(request.signal)

    let canonicalProjectRoot: string
    try {
      canonicalProjectRoot = await this.#canonicalizeAbsolutePath(
        request.projectRoot,
        request.signal,
      )
      return await this.#withClient(request.signal, async (client) => {
        const thread = await client.readStoredThread({
          threadId: request.nativeSessionId,
        })
        if (thread.ephemeral || thread.status !== 'notLoaded') return undefined
        const canonicalThreadRoot = await this.#canonicalizeAbsolutePath(
          thread.cwd,
          request.signal,
        )
        if (!sameMachinePath(canonicalThreadRoot, canonicalProjectRoot)) {
          return undefined
        }
        const candidate = candidateFromThread(thread, canonicalThreadRoot)
        if (candidate.revision !== request.revision) return undefined
        try {
          const transcriptBoundary = await captureCodexTranscriptBoundary(
            client,
            thread.id,
          )
          return {
            ...candidate,
            ...(transcriptBoundary === undefined ? {} : { transcriptBoundary }),
          }
        } catch (error) {
          if (isAbortError(error)) throw error
          return { ...candidate, historicalTranscript: 'unavailable' }
        }
      })
    } catch (error) {
      if (error instanceof CodexOwnedProcessCleanupError) {
        throw this.#latchCleanupFailure(error)
      }
      if (isAbortError(error)) throw error
      return undefined
    }
  }

  async readSessionTranscript(
    request: ProviderSessionTranscriptReadRequest,
  ): Promise<NativeTranscriptPage> {
    const startedAt = performance.now()
    this.#assertCleanupVerified()
    assertTranscriptRequest(request)
    throwIfAborted(request.signal)
    if (request.boundary === undefined) {
      return transcriptFailurePage('partial', startedAt)
    }
    let boundary: CodexTranscriptBoundary
    try {
      boundary = decodeCodexTranscriptBoundary(request.boundary)
    } catch {
      return transcriptFailurePage('malformed', startedAt)
    }
    if (boundary.empty) return transcriptFailurePage('empty', startedAt)

    try {
      const canonicalProjectRoot = await this.#canonicalizeAbsolutePath(
        request.projectRoot,
        request.signal,
      )
      const result = await this.#withClient(request.signal, async (client) => {
        if (client.listStoredThreadItems === undefined) return undefined
        const thread = await client.readStoredThread({
          threadId: request.nativeSessionId,
        })
        const canonicalThreadRoot = await this.#canonicalizeAbsolutePath(
          thread.cwd,
          request.signal,
        )
        if (!sameMachinePath(canonicalThreadRoot, canonicalProjectRoot)) {
          return undefined
        }
        return await client.listStoredThreadItems({
          threadId: request.nativeSessionId,
          cursor: request.cursor ?? boundary.cursor,
          limit: request.limit,
          sortDirection: 'desc',
        })
      })
      if (result === undefined)
        return transcriptFailurePage('unsupported', startedAt)
      if (
        request.cursor === undefined &&
        result.items[0]?.id !== boundary.anchorItemId
      ) {
        return transcriptFailurePage('malformed', startedAt)
      }
      const bounded = normalizeCodexTranscriptItems(result, request.limit)
      const incomplete = result.nextCursor !== undefined
      const status =
        result.invalidEntryCount > 0 || bounded.truncated
          ? 'partial'
          : bounded.entries.length === 0
            ? 'empty'
            : 'available'
      return {
        provider: this.provider,
        status,
        entries: bounded.entries.reverse(),
        ...(result.nextCursor === undefined
          ? {}
          : { nextCursor: result.nextCursor }),
        complete: !incomplete,
        metrics: {
          bytesRead: bounded.bytes,
          recordsScanned: result.items.length + result.invalidEntryCount,
          entriesReturned: bounded.entries.length,
          elapsedMs: elapsedMilliseconds(startedAt),
          truncated:
            incomplete || result.invalidEntryCount > 0 || bounded.truncated,
        },
      }
    } catch (error) {
      if (error instanceof CodexOwnedProcessCleanupError) throw error
      if (isAbortError(error)) throw error
      return transcriptFailurePage(
        error instanceof CodexProtocolError ? 'malformed' : 'unavailable',
        startedAt,
      )
    }
  }

  async #canonicalizeAbsolutePath(
    path: string,
    signal?: AbortSignal,
  ): Promise<string> {
    if (!isAbsolute(path))
      throw new TypeError('Discovery path must be absolute')
    throwIfAborted(signal)
    const canonical = await raceWithAbort(this.#canonicalizePath(path), signal)
    if (!isAbsolute(canonical)) {
      throw new TypeError('Canonical discovery path must be absolute')
    }
    return resolve(canonical)
  }

  async #withClient<TResult>(
    signal: AbortSignal | undefined,
    operation: (client: CodexSessionMetadataClient) => Promise<TResult>,
  ): Promise<TResult> {
    throwIfAborted(signal)
    const clientPromise = this.#clientFactory()
    let client: CodexSessionMetadataClient
    try {
      client = await raceWithAbort(clientPromise, signal)
    } catch (error) {
      // If cancellation wins while initialization is in flight, wait for the
      // bounded launch and close the exact resulting child before returning.
      let lateClient: CodexSessionMetadataClient | undefined
      try {
        lateClient = await clientPromise
      } catch (lateError) {
        if (lateError instanceof CodexOwnedProcessCleanupError) {
          throw this.#latchCleanupFailure(lateError)
        }
      }
      if (lateClient !== undefined) await this.#shutdownClient(lateClient)
      throw error
    }

    try {
      return await raceWithAbort(operation(client), signal)
    } finally {
      await this.#shutdownClient(client)
    }
  }

  async #shutdownClient(client: CodexSessionMetadataClient): Promise<void> {
    try {
      await client.shutdown()
    } catch (error) {
      throw this.#latchCleanupFailure(
        error instanceof CodexOwnedProcessCleanupError
          ? error
          : new CodexOwnedProcessCleanupError({ cause: error }),
      )
    }
  }

  #assertCleanupVerified(): void {
    if (this.#cleanupFailure !== undefined) throw this.#cleanupFailure
  }

  #latchCleanupFailure(
    error: CodexOwnedProcessCleanupError,
  ): CodexOwnedProcessCleanupError {
    this.#cleanupFailure ??= error
    return this.#cleanupFailure
  }

  #failurePage(
    startedAt: number,
    reason: ProviderSessionDiscoveryFailureReason,
  ): ProviderSessionDiscoveryPage {
    return {
      provider: this.provider,
      status: 'unavailable',
      resumeStatus: 'unavailable',
      ...(this.#providerVersion === undefined
        ? {}
        : { providerVersion: this.#providerVersion }),
      candidates: [],
      failureReason: reason,
      metrics: {
        filesInspected: 0,
        candidatesParsed: 0,
        candidatesMatched: 0,
        corruptEntriesSkipped: 0,
        elapsedMs: elapsedMilliseconds(startedAt),
        truncated: false,
      },
    }
  }
}

function createDefaultClientFactory(
  options: CodexSessionDiscoveryOptions,
): CodexSessionMetadataClientFactory {
  if (options.codexHome !== undefined) {
    return async () =>
      await CodexAppServerClient.launchRemote({
        ...(options.executable === undefined
          ? {}
          : { executable: options.executable }),
        codexHome: options.codexHome as string,
        ...(options.environment === undefined
          ? {}
          : { environment: options.environment }),
        ...(options.processFactory === undefined
          ? {}
          : { processFactory: options.processFactory }),
        ...(options.requestTimeoutMs === undefined
          ? {}
          : { requestTimeoutMs: options.requestTimeoutMs }),
        clientInfo: CODEX_DISCOVERY_CLIENT_INFO,
      })
  }

  if (options.processFactory !== undefined) {
    throw new TypeError(
      'Remote Codex discovery options require an absolute codexHome',
    )
  }
  return async () =>
    await CodexAppServerClient.launch({
      ...(options.executable === undefined
        ? {}
        : { executable: options.executable }),
      ...(options.environment === undefined
        ? {}
        : { environment: options.environment }),
      ...(options.requestTimeoutMs === undefined
        ? {}
        : { requestTimeoutMs: options.requestTimeoutMs }),
      clientInfo: CODEX_DISCOVERY_CLIENT_INFO,
    })
}

function candidateFromThread(
  thread: CodexStoredThread,
  canonicalRoot: string,
): NativeProviderSessionCandidate {
  const createdAt = timestampToIso(thread.createdAt)
  const lastActiveAt = timestampToIso(thread.recencyAt ?? thread.updatedAt)
  const title = boundedTitle(thread.name, thread.createdAt)
  return {
    provider: 'codex',
    nativeSessionId: thread.id,
    revision: createHash('sha256')
      .update(
        JSON.stringify([
          thread.id,
          canonicalRoot,
          thread.name ?? null,
          thread.createdAt,
          thread.updatedAt,
          thread.recencyAt ?? null,
          thread.cliVersion,
          thread.source,
          thread.status,
          thread.ephemeral,
        ]),
      )
      .digest('base64url'),
    workingDirectory: canonicalRoot,
    title,
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(lastActiveAt === undefined ? {} : { lastActiveAt }),
    providerVersion: thread.cliVersion,
    resumeStatus: 'supported',
    historicalTranscript: 'supported',
  }
}

interface CodexTranscriptBoundary {
  readonly version: 1
  readonly empty: boolean
  readonly cursor?: string
  readonly anchorItemId?: string
}

async function captureCodexTranscriptBoundary(
  client: CodexSessionMetadataClient,
  threadId: string,
): Promise<string | undefined> {
  if (client.listStoredThreadItems === undefined) return undefined
  const page = await client.listStoredThreadItems({
    threadId,
    limit: 1,
    sortDirection: 'desc',
  })
  const item = page.items[0]
  return encodeCodexTranscriptBoundary(
    item === undefined
      ? { version: 1, empty: true }
      : {
          version: 1,
          empty: false,
          cursor: page.backwardsCursor,
          anchorItemId: item.id,
        },
  )
}

function encodeCodexTranscriptBoundary(
  boundary: CodexTranscriptBoundary,
): string {
  return `codex-v1:${Buffer.from(JSON.stringify(boundary), 'utf8').toString('base64url')}`
}

function decodeCodexTranscriptBoundary(value: string): CodexTranscriptBoundary {
  if (!value.startsWith('codex-v1:') || value.length > 2_048) {
    throw new TypeError('Codex transcript boundary is invalid')
  }
  const parsed = JSON.parse(
    Buffer.from(value.slice('codex-v1:'.length), 'base64url').toString('utf8'),
  ) as unknown
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('version' in parsed) ||
    parsed.version !== 1 ||
    !('empty' in parsed) ||
    typeof parsed.empty !== 'boolean'
  ) {
    throw new TypeError('Codex transcript boundary is invalid')
  }
  if (parsed.empty) return { version: 1, empty: true }
  if (
    !('cursor' in parsed) ||
    typeof parsed.cursor !== 'string' ||
    parsed.cursor.length === 0 ||
    parsed.cursor.length > MAX_CODEX_STORED_THREAD_CURSOR_CODE_UNITS ||
    !('anchorItemId' in parsed) ||
    typeof parsed.anchorItemId !== 'string' ||
    parsed.anchorItemId.length === 0 ||
    parsed.anchorItemId.length > MAX_CODEX_STORED_THREAD_ID_CODE_UNITS
  ) {
    throw new TypeError('Codex transcript boundary is invalid')
  }
  return {
    version: 1,
    empty: false,
    cursor: parsed.cursor,
    anchorItemId: parsed.anchorItemId,
  }
}

function normalizeCodexTranscriptItems(
  page: CodexStoredThreadItemPage,
  limit: number,
): { entries: NativeTranscriptEntry[]; bytes: number; truncated: boolean } {
  const entries: NativeTranscriptEntry[] = []
  let bytes = 0
  let truncated = false
  const entryByteLimit = Math.min(
    MAX_TRANSCRIPT_ENTRY_BYTES,
    Math.floor(MAX_TRANSCRIPT_PAGE_BYTES / Math.max(1, page.items.length)),
  )
  for (const [sequence, item] of page.items.entries()) {
    const retained = retainUtf8(item.text, entryByteLimit)
    bytes += retained.bytes
    truncated ||= retained.truncated
    entries.push({
      id: item.id,
      provider: 'codex',
      role: item.type === 'userMessage' ? 'user' : 'assistant',
      kind: 'message',
      content: retained.text,
      nativeSequence: Math.max(0, limit - sequence),
      readOnly: true,
    })
  }
  return { entries, bytes, truncated }
}

function retainUtf8(
  value: string,
  maximumBytes: number,
): { text: string; bytes: number; truncated: boolean } {
  const buffer = Buffer.from(value, 'utf8')
  if (buffer.byteLength <= maximumBytes) {
    return { text: value, bytes: buffer.byteLength, truncated: false }
  }
  let end = maximumBytes
  while (end > 0 && ((buffer[end] ?? 0) & 0xc0) === 0x80) end -= 1
  const text = buffer.subarray(0, end).toString('utf8')
  return { text, bytes: Buffer.byteLength(text), truncated: true }
}

function assertTranscriptRequest(
  request: ProviderSessionTranscriptReadRequest,
): void {
  assertValidationRequest({
    projectRoot: request.projectRoot,
    nativeSessionId: request.nativeSessionId,
    revision: 'transcript',
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  })
  if (
    !Number.isSafeInteger(request.limit) ||
    request.limit <= 0 ||
    request.limit > MAX_CODEX_STORED_THREAD_PAGE_SIZE ||
    (request.cursor !== undefined &&
      (request.cursor.length === 0 ||
        request.cursor.length > MAX_CODEX_STORED_THREAD_CURSOR_CODE_UNITS))
  ) {
    throw new TypeError('Codex transcript request is invalid')
  }
}

function transcriptFailurePage(
  status: NativeTranscriptPage['status'],
  startedAt: number,
): NativeTranscriptPage {
  return {
    provider: 'codex',
    status,
    entries: [],
    complete: true,
    metrics: {
      bytesRead: 0,
      recordsScanned: 0,
      entriesReturned: 0,
      elapsedMs: elapsedMilliseconds(startedAt),
      truncated: status === 'partial',
    },
  }
}

function boundedTitle(value: string | undefined, createdAt: number): string {
  const normalized = value?.normalize('NFC').replace(/\s+/gu, ' ').trim()
  if (normalized === undefined || normalized.length === 0) {
    const timestamp = timestampToIso(createdAt)
    return `Codex conversation${timestamp === undefined ? '' : ` — ${timestamp}`}`
  }
  const codePoints = [...normalized]
  return codePoints.length <= MAX_TITLE_CODE_POINTS
    ? normalized
    : `${codePoints.slice(0, MAX_TITLE_CODE_POINTS - 1).join('')}…`
}

function timestampToIso(seconds: number): string | undefined {
  const milliseconds = seconds * 1_000
  if (!Number.isSafeInteger(milliseconds)) return undefined
  const date = new Date(milliseconds)
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString()
}

function sameMachinePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right
}

function assertDiscoveryRequest(
  request: ProviderSessionDiscoveryRequest,
): void {
  if (!isAbsolute(request.projectRoot)) {
    throw new TypeError('Codex discovery projectRoot must be absolute')
  }
  if (
    !Number.isSafeInteger(request.limit) ||
    request.limit <= 0 ||
    request.limit > MAX_CODEX_STORED_THREAD_PAGE_SIZE
  ) {
    throw new RangeError(
      `Codex discovery limit must be between 1 and ${MAX_CODEX_STORED_THREAD_PAGE_SIZE}`,
    )
  }
  if (
    request.cursor !== undefined &&
    (request.cursor.length === 0 ||
      request.cursor.length > MAX_CODEX_STORED_THREAD_CURSOR_CODE_UNITS)
  ) {
    throw new RangeError('Codex discovery cursor is invalid')
  }
}

function assertValidationRequest(
  request: ProviderSessionCandidateValidationRequest,
): void {
  if (!isAbsolute(request.projectRoot)) {
    throw new TypeError('Codex candidate projectRoot must be absolute')
  }
  if (
    request.nativeSessionId.length === 0 ||
    request.nativeSessionId.length > MAX_CODEX_STORED_THREAD_ID_CODE_UNITS ||
    request.nativeSessionId.includes('\0') ||
    request.revision.length === 0 ||
    request.revision.length > MAX_REVISION_CODE_UNITS ||
    !REVISION_PATTERN.test(request.revision)
  ) {
    throw new TypeError('Codex candidate identity and revision are required')
  }
}

function failureReason(error: unknown): ProviderSessionDiscoveryFailureReason {
  return error instanceof CodexProtocolError
    ? 'provider_session_format_unsupported'
    : 'provider_session_discovery_unavailable'
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt))
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw abortError()
}

function abortError(): Error {
  const error = new Error('Codex session discovery was cancelled')
  error.name = 'AbortError'
  return error
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

async function raceWithAbort<TResult>(
  task: Promise<TResult>,
  signal?: AbortSignal,
): Promise<TResult> {
  if (signal === undefined) return await task
  throwIfAborted(signal)
  return await new Promise<TResult>((resolvePromise, rejectPromise) => {
    const onAbort = (): void => rejectPromise(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    void task.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolvePromise(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        rejectPromise(error)
      },
    )
  })
}
