import { mkdirSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import {
  ConversationIdSchema,
  TimestampSchema,
  TurnIdSchema,
  TurnInputRecordSchema,
  type ConversationId,
  type Timestamp,
  type TurnId,
  type TurnInputRecord,
} from '@codetether/protocol'

import {
  resolveCodeTetherDatabasePath,
  type DataDirectoryOptions,
} from './data-directory.js'
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

const durableTurnStatuses = [
  'starting',
  'running',
  'waiting',
  'completed',
  'failed',
  'interrupted',
] as const
export type DurableTurnStatus = (typeof durableTurnStatuses)[number]

export interface DurableConversation {
  readonly conversationId: ConversationId
  readonly provider: 'codex'
  readonly providerThreadId?: string
  readonly cwd: string
  readonly model?: string
  readonly reasoning?: string
  readonly status: DurableConversationStatus
  readonly createdAt: Timestamp
  readonly updatedAt: Timestamp
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

  createConversation(conversation: DurableConversation): void {
    const value = parseConversation(conversation)
    this.#statement(
      `INSERT INTO conversations (
        conversation_id, provider, provider_thread_id, cwd, model, reasoning,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      value.conversationId,
      value.provider,
      value.providerThreadId ?? null,
      value.cwd,
      value.model ?? null,
      value.reasoning ?? null,
      value.status,
      value.createdAt,
      value.updatedAt,
    )
  }

  updateConversation(conversation: DurableConversation): void {
    const value = parseConversation(conversation)
    const result = this.#statement(
      `UPDATE conversations SET
        provider = ?, provider_thread_id = ?, cwd = ?, model = ?,
        reasoning = ?, status = ?, created_at = ?, updated_at = ?
      WHERE conversation_id = ?`,
    ).run(
      value.provider,
      value.providerThreadId ?? null,
      value.cwd,
      value.model ?? null,
      value.reasoning ?? null,
      value.status,
      value.createdAt,
      value.updatedAt,
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
      'SELECT * FROM conversations ORDER BY updated_at DESC, conversation_id ASC',
    ).all() as unknown as ConversationRow[]
    return rows.map(conversationFromRow)
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
  readonly provider: string
  readonly provider_thread_id: string | null
  readonly cwd: string
  readonly model: string | null
  readonly reasoning: string | null
  readonly status: string
  readonly created_at: string
  readonly updated_at: string
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

function parseConversation(value: DurableConversation): DurableConversation {
  if (value.provider !== 'codex') throw new Error('Provider must be codex')
  assertBoundedText(value.cwd, 'Conversation cwd', 4096)
  assertOptionalBoundedText(value.providerThreadId, 'Provider Thread ID', 4096)
  assertOptionalBoundedText(value.model, 'Conversation model', 240)
  assertOptionalBoundedText(value.reasoning, 'Conversation reasoning', 120)
  if (!isOneOf(value.status, durableConversationStatuses)) {
    throw new Error(`Unsupported durable Conversation status: ${value.status}`)
  }
  return {
    conversationId: ConversationIdSchema.parse(value.conversationId),
    provider: 'codex',
    ...(value.providerThreadId === undefined
      ? {}
      : { providerThreadId: value.providerThreadId.trim() }),
    cwd: value.cwd.trim(),
    ...(value.model === undefined ? {} : { model: value.model.trim() }),
    ...(value.reasoning === undefined
      ? {}
      : { reasoning: value.reasoning.trim() }),
    status: value.status,
    createdAt: TimestampSchema.parse(value.createdAt),
    updatedAt: TimestampSchema.parse(value.updatedAt),
  }
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
  })
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

function assertDatabaseIntegrity(database: DatabaseSync): void {
  const result = database.prepare('PRAGMA quick_check').get() as
    Record<string, unknown> | undefined
  if (result === undefined || Object.values(result)[0] !== 'ok') {
    throw new Error('SQLite integrity check failed')
  }
}

function parseProvider(value: string): 'codex' {
  if (value !== 'codex') throw new Error(`Unsupported Provider: ${value}`)
  return value
}

function parseConversationStatus(value: string): DurableConversationStatus {
  if (!isOneOf(value, durableConversationStatuses)) {
    throw new Error(`Unsupported durable Conversation status: ${value}`)
  }
  return value
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
