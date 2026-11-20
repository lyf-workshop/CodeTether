import { dirname, basename, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  isCanonicalFailureReason,
  type AgentProvider,
  type CanonicalFailure,
} from '@codetether/agent-core'
import {
  CanonicalFailureSchema,
  HostErrorCodeSchema,
  MachineIdSchema,
  TurnIdSchema,
} from '@codetether/protocol'
import { ZodError } from 'zod'

import { BoundedLocalJsonl } from './bounded-local-jsonl.js'

export const HOST_RUNTIME_DIAGNOSTIC_MAX_FILE_BYTES = 256 * 1024
export const HOST_RUNTIME_DIAGNOSTIC_MAX_FILES = 8
export const HOST_RUNTIME_DIAGNOSTIC_MAX_TOTAL_BYTES =
  HOST_RUNTIME_DIAGNOSTIC_MAX_FILE_BYTES * HOST_RUNTIME_DIAGNOSTIC_MAX_FILES

const MAX_TURN_IDS = 32
const MAX_STACK_FRAMES = 20
const MAX_CAUSES = 4
const MAX_ZOD_ISSUES = 16
const MAX_ZOD_PATH_SEGMENTS = 8
const MAX_IDENTICAL_PER_MINUTE = 4
const MAX_RECORDS_PER_MINUTE = 256
const MAX_FINGERPRINTS_PER_MINUTE = 64
const REPOSITORY_ROOT = repositoryRoot()

const ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'URIError',
  'EvalError',
  'AggregateError',
  'ZodError',
  'AbortError',
  'TimeoutError',
  'SqliteError',
  'ActionIdConflictError',
  'ActionIdempotencyCapacityError',
  'UnsupportedApprovalAttentionError',
  'AttentionAlreadyResolvedError',
  'ControllerRelayCoordinatorError',
  'ProviderConversationUnavailableError',
  'ProviderItemCapacityError',
  'HostEventTooLargeError',
  'HostEventSequenceError',
  'HostPresenceDiagnosticError',
  'HostServiceError',
  'HttpBoundaryError',
  'MachineRegistryError',
  'ProjectRegistryError',
  'RemoteMachineCoordinatorError',
  'RemoteMachineRevocationPendingError',
  'RemoteProviderSessionBindingError',
  'SseSlowClientError',
  'SseClientLimitError',
  'SseConnectionPoolClosedError',
  'WorkspacePolicyError',
  'ConversationSearchCursorError',
  'ConversationOrganizationConflictError',
  'RemoteMachineTrustConflictError',
  'ProjectLocationConflictError',
  'ProjectLocationRemovalError',
  'NativeProviderSessionBindingConflictError',
  'RemoteMachineProjectLocationConflictError',
  'ProviderInstallationSelectionError',
  'UnsupportedSqliteSchemaMigrationError',
  'AgentEventQueueOverflowError',
  'DeltaIntegrityCapacityError',
  'ClaudeInstallationIoTimeoutError',
  'ClaudeCodeDetectionProbeError',
  'ClaudeCodeError',
  'ClaudeCodeNotInstalledError',
  'ClaudeCodeMisconfiguredError',
  'ClaudeCodeVersionUnsupportedError',
  'ClaudeCodeStartError',
  'ClaudeCodeProcessExitError',
  'ClaudeCodeOwnedProcessCleanupError',
  'ClaudeCodeSessionLostError',
  'ClaudeCodeProtocolError',
  'ClaudeCodeTurnInterruptedError',
  'ClaudeJsonLineTooLongError',
  'ClaudeSessionStoreUnreadableError',
  'ClaudeSessionEntryCorruptError',
  'UnsupportedClaudeTranscriptError',
  'CodexInstallationIoTimeoutError',
  'CodexExecutableNotFoundError',
  'CodexOwnedProcessCleanupError',
  'CodexProcessError',
  'CodexProcessExitError',
  'CodexProtocolError',
  'JsonRpcLineTooLongError',
  'JsonRpcRemoteError',
  'JsonRpcRequestTimeoutError',
  'MachineTransportError',
])

const OS_CODES = new Set([
  'EACCES',
  'EADDRINUSE',
  'EBUSY',
  'ECONNREFUSED',
  'ECONNRESET',
  'EEXIST',
  'EISDIR',
  'EMFILE',
  'ENOENT',
  'ENOSPC',
  'ENOTDIR',
  'ENOTEMPTY',
  'ENOTSUP',
  'EPERM',
  'EPIPE',
  'ESRCH',
  'ETIMEDOUT',
])
const NODE_CODES = new Set([
  'ABORT_ERR',
  'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
  'ERR_INVALID_ARG_TYPE',
  'ERR_MODULE_NOT_FOUND',
  'ERR_OUT_OF_RANGE',
  'ERR_STREAM_DESTROYED',
  'ERR_STREAM_PREMATURE_CLOSE',
])
const SQLITE_CODES = new Set([
  'SQLITE_BUSY',
  'SQLITE_CANTOPEN',
  'SQLITE_CONSTRAINT',
  'SQLITE_CONSTRAINT_UNIQUE',
  'SQLITE_CORRUPT',
  'SQLITE_ERROR',
  'SQLITE_FULL',
  'SQLITE_IOERR',
  'SQLITE_LOCKED',
  'SQLITE_READONLY',
])
const SIGNALS = new Set([
  'SIGABRT',
  'SIGBREAK',
  'SIGINT',
  'SIGKILL',
  'SIGQUIT',
  'SIGTERM',
])
const EVENT_TYPES = new Set([
  'conversation.started',
  'turn.started',
  'message.delta',
  'message.completed',
  'tool.started',
  'tool.output',
  'tool.completed',
  'file.changed',
  'approval.requested',
  'turn.completed',
  'turn.interrupted',
  'turn.failed',
])
const ITEM_KINDS = new Set([
  'read',
  'edit',
  'shell',
  'search',
  'generic',
  'added',
  'modified',
  'deleted',
  'renamed',
  'unknown',
  'command',
  'file-change',
])
const ZOD_CODES = new Set([
  'custom',
  'invalid_element',
  'invalid_format',
  'invalid_key',
  'invalid_type',
  'invalid_union',
  'invalid_value',
  'not_multiple_of',
  'too_big',
  'too_small',
  'unrecognized_keys',
])
const ZOD_FIELDS = new Set([
  'approvalId',
  'code',
  'content',
  'data',
  'delta',
  'error',
  'failure',
  'id',
  'item',
  'itemId',
  'kind',
  'message',
  'method',
  'name',
  'output',
  'params',
  'payload',
  'provider',
  'result',
  'status',
  'stream',
  'summary',
  'threadId',
  'timestamp',
  'turnId',
  'type',
])

type MachineKind = 'local' | 'remote'

export interface FailedTurnDiagnostic {
  readonly turnId: string
  readonly provider: AgentProvider
  readonly machineKind: MachineKind
}

export interface HostRuntimeFailureDiagnostic {
  readonly event: 'runtime.failure' | 'persistence.failure'
  readonly provider?: AgentProvider
  readonly machineKind?: MachineKind
  readonly machineId?: string
  readonly turnIds?: readonly string[]
  readonly affectedTurns?: readonly FailedTurnDiagnostic[]
  readonly canonical: CanonicalFailure
  readonly error: Error
  readonly providerEvent?: { readonly type: string; readonly itemKind?: string }
}

export interface HostRuntimeDiagnosticsOptions {
  readonly databasePath?: string
  readonly productVersion: string
  readonly hostVersion: string
}

/** Private, bounded diagnostic evidence. No messages or provider payloads enter it. */
export class HostRuntimeDiagnostics {
  readonly #writer: BoundedLocalJsonl
  readonly #version: string
  readonly #build: string
  readonly #counts = new Map<string, number>()
  #minute = -1
  #minuteTotal = 0
  #codexStarts = 0

  constructor(options: HostRuntimeDiagnosticsOptions) {
    this.#writer = new BoundedLocalJsonl(
      options.databasePath === undefined
        ? undefined
        : resolve(
            dirname(options.databasePath),
            'logs',
            'host-diagnostics.jsonl',
          ),
    )
    this.#version = safeVersion(options.productVersion)
    this.#build = safeVersion(options.hostVersion)
  }

  recordFailure(options: HostRuntimeFailureDiagnostic): void {
    try {
      const canonical = CanonicalFailureSchema.safeParse(options.canonical)
      const turnIds = safeTurnIds(options.turnIds)
      const affectedTurns = safeAffectedTurns(options.affectedTurns)
      this.#record(options.event, {
        ...(isProvider(options.provider) ? { provider: options.provider } : {}),
        ...(isMachineKind(options.machineKind)
          ? { machineKind: options.machineKind }
          : {}),
        ...(MachineIdSchema.safeParse(options.machineId).success
          ? { machineId: options.machineId }
          : {}),
        ...(canonical.success
          ? {
              reason: canonical.data.reason,
              source: canonical.data.source,
            }
          : {}),
        ...(turnIds.length > 0 ? { turnIds } : {}),
        ...(options.turnIds !== undefined &&
        options.turnIds.length > MAX_TURN_IDS
          ? { turnIdsTruncated: true }
          : {}),
        ...(affectedTurns.length > 0 ? { affectedTurns } : {}),
        ...(options.affectedTurns !== undefined &&
        options.affectedTurns.length > MAX_TURN_IDS
          ? { affectedTurnsTruncated: true }
          : {}),
        error: projectError(options.error),
        ...(options.providerEvent === undefined
          ? {}
          : { providerEvent: projectProviderEvent(options.providerEvent) }),
      })
    } catch {
      // A malformed diagnostic object cannot change a product failure.
    }
  }

  recordHostStart(options: { readonly port: number }): void {
    this.#record('host.start', {
      ...(Number.isInteger(options.port) &&
      options.port >= 0 &&
      options.port <= 65_535
        ? { port: options.port }
        : {}),
    })
  }

  recordHostReady(options: { readonly port: number }): void {
    this.#record('host.ready', {
      ...(Number.isInteger(options.port) &&
      options.port > 0 &&
      options.port <= 65_535
        ? { port: options.port }
        : {}),
    })
  }

  recordHostShutdown(): void {
    this.#record('host.shutdown', {})
  }

  recordHostStartupFailure(error: unknown): void {
    try {
      this.#record('host.startup_failure', { error: projectError(error) })
    } catch {
      // Even a malformed Error object cannot change Host startup behavior.
    }
  }

  recordHostUnhandled(options: {
    readonly kind: 'uncaught_exception' | 'unhandled_rejection'
    readonly error: unknown
  }): void {
    try {
      this.#record('host.unhandled', {
        kind:
          options.kind === 'uncaught_exception'
            ? options.kind
            : 'unhandled_rejection',
        error: projectError(options.error),
      })
    } catch {
      // The process's original fatal path remains authoritative.
    }
  }

  recordCodexStarted(options: {
    readonly pid?: number
    readonly version?: string
  }): void {
    if (this.#codexStarts > 0) this.recordCodexRestarted()
    this.#codexStarts++
    this.#record('codex.started', {
      ...(safePositiveInteger(options.pid) === undefined
        ? {}
        : { pid: options.pid }),
      ...(options.version === undefined
        ? {}
        : { codexVersion: safeVersion(options.version) }),
    })
  }

  recordCodexExited(options: {
    readonly code: number | null
    readonly signal: string | null
    readonly expected: boolean
  }): void {
    this.#record('codex.exited', {
      code: safeExitCode(options.code),
      signal: safeSignal(options.signal),
      expected: options.expected === true,
    })
  }

  recordCodexRestarted(): void {
    this.#record('codex.restarted', {})
  }

  #record(event: string, fields: Record<string, unknown>): void {
    try {
      const minute = Math.floor(Date.now() / 60_000)
      if (this.#minute !== minute) {
        this.#minute = minute
        this.#minuteTotal = 0
        this.#counts.clear()
      }
      if (this.#minuteTotal >= MAX_RECORDS_PER_MINUTE) return
      const fingerprint = JSON.stringify({ event, ...fields })
      const count = this.#counts.get(fingerprint) ?? 0
      if (count >= MAX_IDENTICAL_PER_MINUTE) return
      if (count === 0 && this.#counts.size >= MAX_FINGERPRINTS_PER_MINUTE)
        return
      this.#counts.set(fingerprint, count + 1)
      this.#minuteTotal++
      this.#writer.append(
        `${JSON.stringify({
          component: 'host',
          event,
          observedAt: new Date().toISOString(),
          version: this.#version,
          build: this.#build,
          ...fields,
        })}\n`,
      )
    } catch {
      // Diagnostics are never a Host runtime dependency.
    }
  }
}

function projectError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error) && !(error instanceof ZodError)) {
    return { name: 'NonError' }
  }
  const result: Record<string, unknown> = { name: safeErrorName(error) }
  const failureReason = read(error, 'failureReason')
  if (isCanonicalFailureReason(failureReason)) {
    result.failureReason = failureReason
  }
  const code = safeCode(read(error, 'code'))
  if (code !== undefined) result.code = code
  if (typeof code === 'string' && OS_CODES.has(code)) result.osCode = code
  const exitCode = safeExitCode(read(error, 'exitCode'))
  if (exitCode !== undefined) result.exitCode = exitCode
  const signal = safeSignal(read(error, 'signal'))
  if (signal !== undefined) result.signal = signal
  const errno = read(error, 'errno')
  if (typeof errno === 'number' && Number.isSafeInteger(errno)) {
    result.errno = errno
  }
  const causes = projectCauses(error)
  if (causes.length > 0) result.causes = causes
  const stack = projectStack(read(error, 'stack'))
  if (stack.length > 0) result.stack = stack
  const issues = projectZodIssues(error)
  if (issues !== undefined) result.zodIssues = issues
  return result
}

function projectZodIssues(
  error: unknown,
): readonly Record<string, unknown>[] | undefined {
  if (!(error instanceof ZodError) && safeErrorName(error) !== 'ZodError') {
    return undefined
  }
  const issues = read(error, 'issues')
  if (!Array.isArray(issues)) return undefined
  return issues.slice(0, MAX_ZOD_ISSUES).map((issue: unknown) => {
    const code = read(issue, 'code')
    const path = read(issue, 'path')
    return {
      code: typeof code === 'string' && ZOD_CODES.has(code) ? code : 'unknown',
      path: Array.isArray(path)
        ? path.slice(0, MAX_ZOD_PATH_SEGMENTS).map(safeZodPathSegment)
        : [],
    }
  })
}

function projectCauses(error: unknown): readonly Record<string, unknown>[] {
  const causes: Record<string, unknown>[] = []
  const seen = new Set<unknown>([error])
  let current: unknown = error
  for (let depth = 0; depth < MAX_CAUSES; depth++) {
    const cause = read(current, 'cause')
    if (cause === undefined || cause === null || seen.has(cause)) break
    seen.add(cause)
    if (!(cause instanceof Error) && !(cause instanceof ZodError)) {
      causes.push({ name: 'NonError' })
      break
    }
    const code = safeCode(read(cause, 'code'))
    causes.push({
      name: safeErrorName(cause),
      ...(code === undefined ? {} : { code }),
    })
    current = cause
  }
  return causes
}

function projectStack(stack: unknown): readonly Record<string, unknown>[] {
  if (typeof stack !== 'string') return []
  const frames: Record<string, unknown>[] = []
  for (const line of stack
    .slice(0, 64 * 1024)
    .split('\n')
    .slice(1, 80)) {
    if (frames.length >= MAX_STACK_FRAMES) break
    const frame = projectStackFrame(line)
    if (frame !== undefined) frames.push(frame)
  }
  return frames
}

function projectStackFrame(line: string): Record<string, unknown> | undefined {
  const trimmed = line.trim()
  if (!trimmed.startsWith('at ')) return undefined
  const body = trimmed.slice(3)
  const parenthesis = body.lastIndexOf(' (')
  const functionName =
    parenthesis >= 0 && body.endsWith(')')
      ? body.slice(0, parenthesis)
      : '<anonymous>'
  const location =
    parenthesis >= 0 && body.endsWith(')')
      ? body.slice(parenthesis + 2, -1)
      : body
  const match = /^(.*):(\d{1,7}):(\d{1,7})$/u.exec(location)
  if (match === null) return undefined
  const [, rawPath, rawLine, rawColumn] = match
  if (rawPath === undefined || rawLine === undefined || rawColumn === undefined)
    return undefined
  if (rawPath.includes('?') || rawPath.includes('#')) return undefined
  let path: string
  try {
    path = rawPath.startsWith('file://') ? fileURLToPath(rawPath) : rawPath
  } catch {
    return undefined
  }
  const file = basename(path)
  const packaged = file === 'codetether-host.mjs'
  if (!packaged) {
    if (!isAbsolute(path) || REPOSITORY_ROOT === undefined) return undefined
    const withinRepo = relative(REPOSITORY_ROOT, resolve(path))
    if (
      withinRepo === '' ||
      withinRepo === '..' ||
      withinRepo.startsWith(`..\\`) ||
      withinRepo.startsWith('../') ||
      isAbsolute(withinRepo)
    ) {
      return undefined
    }
    const source = withinRepo.replaceAll('\\', '/')
    if (
      !/^apps\/host\/(?:src|dist)\//u.test(source) &&
      !/^packages\/[a-z0-9-]+\/(?:src|dist)\//u.test(source)
    ) {
      return undefined
    }
  }
  if (!/^[A-Za-z][A-Za-z0-9._-]{0,79}\.(?:js|mjs|cjs|ts)$/u.test(file))
    return undefined
  const lineNumber = Number(rawLine)
  const column = Number(rawColumn)
  if (
    lineNumber < 1 ||
    column < 1 ||
    lineNumber > 1_000_000 ||
    column > 1_000_000
  )
    return undefined
  return {
    function: packaged ? '<bundle>' : safeFunctionName(functionName),
    file,
    line: lineNumber,
    column,
  }
}

function safeFunctionName(name: string): string {
  return /^(?:(?:async|new) )?[A-Za-z_$#][A-Za-z0-9_.$#]{0,95}$/u.test(name)
    ? name
    : '<anonymous>'
}

function safeErrorName(error: unknown): string {
  const name = read(error, 'name')
  if (typeof name === 'string' && ERROR_NAMES.has(name) && name !== 'Error') {
    return name
  }
  const className = read(read(error, 'constructor'), 'name')
  if (typeof className === 'string' && ERROR_NAMES.has(className)) {
    return className
  }
  return 'Error'
}

function safeCode(value: unknown): string | number | undefined {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && Math.abs(value) <= 1_000_000
      ? value
      : undefined
  }
  if (typeof value !== 'string') return undefined
  if (
    OS_CODES.has(value) ||
    NODE_CODES.has(value) ||
    SQLITE_CODES.has(value) ||
    HostErrorCodeSchema.safeParse(value).success
  ) {
    return value
  }
  return undefined
}

function safeExitCode(value: unknown): number | null | undefined {
  if (value === null) return null
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= -1 &&
    value <= 65_535
    ? value
    : undefined
}

function safeSignal(value: unknown): string | null | undefined {
  if (value === null) return null
  return typeof value === 'string' && SIGNALS.has(value) ? value : undefined
}

function safePositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= 2_147_483_647
    ? value
    : undefined
}

function safeVersion(value: unknown): string {
  if (typeof value !== 'string') return 'unknown'
  if (/^git-[0-9a-f]{7,12}(?:-dirty)?$/u.test(value)) return value
  if (
    /^\d{1,3}\.\d{1,3}\.\d{1,3}(?:-(?:alpha|beta|rc)\.\d{1,3})?$/u.test(value)
  ) {
    return value
  }
  const cliVersion = /^codex-cli (\d{1,3}\.\d{1,3}\.\d{1,3})$/u.exec(value)
  return cliVersion?.[1] ?? 'unknown'
}

function safeTurnIds(
  turnIds: readonly string[] | undefined,
): readonly string[] {
  if (turnIds === undefined) return []
  return [
    ...new Set(
      turnIds
        .slice(0, MAX_TURN_IDS)
        .filter((id) => TurnIdSchema.safeParse(id).success),
    ),
  ]
}

function safeAffectedTurns(
  turns: readonly FailedTurnDiagnostic[] | undefined,
): readonly FailedTurnDiagnostic[] {
  if (turns === undefined) return []
  return turns
    .slice(0, MAX_TURN_IDS)
    .filter(
      (turn) =>
        TurnIdSchema.safeParse(turn.turnId).success &&
        isProvider(turn.provider) &&
        isMachineKind(turn.machineKind),
    )
}

function projectProviderEvent(event: {
  readonly type: string
  readonly itemKind?: string
}): Record<string, unknown> {
  return {
    type: EVENT_TYPES.has(event.type) ? event.type : 'unknown',
    ...(event.itemKind !== undefined
      ? {
          itemKind: ITEM_KINDS.has(event.itemKind) ? event.itemKind : 'unknown',
        }
      : {}),
  }
}

function safeZodPathSegment(segment: PropertyKey): string | number {
  if (typeof segment === 'number') {
    return Number.isSafeInteger(segment) && segment >= 0 && segment < 1_000
      ? segment
      : '<dynamic>'
  }
  return typeof segment === 'string' && ZOD_FIELDS.has(segment)
    ? segment
    : '<dynamic>'
}

function isProvider(value: unknown): value is AgentProvider {
  return value === 'codex' || value === 'claude-code'
}

function isMachineKind(value: unknown): value is MachineKind {
  return value === 'local' || value === 'remote'
}

function read(object: unknown, key: string): unknown {
  if (
    (typeof object !== 'object' && typeof object !== 'function') ||
    object === null
  ) {
    return undefined
  }
  try {
    return Reflect.get(object, key)
  } catch {
    return undefined
  }
}

function repositoryRoot(): string | undefined {
  try {
    if (!import.meta.url.startsWith('file:')) return undefined
    return resolve(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
      '..',
    )
  } catch {
    // A single-executable Host can use a virtual module URL.
    return undefined
  }
}
