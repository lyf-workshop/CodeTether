import { createHash } from 'node:crypto'

import type { ActionId } from '@codetether/protocol'

const DEFAULT_MAX_ACTIONS = 256

interface ActionEntry {
  readonly fingerprint: string
  readonly operation: string
  readonly promise: Promise<unknown>
  settled: boolean
}

export interface ActionIdempotencyCacheOptions {
  readonly maxActions?: number
}

export class ActionIdConflictError extends Error {
  constructor(
    readonly actionId: string,
    readonly originalOperation: string,
    readonly attemptedOperation: string,
  ) {
    super(
      `Action id ${actionId} was already used for ${originalOperation} and cannot be reused for ${attemptedOperation}`,
    )
    this.name = 'ActionIdConflictError'
  }
}

export class ActionIdempotencyCapacityError extends Error {
  constructor(readonly maxActions: number) {
    super(
      `Action idempotency cache reached its ${maxActions} pending action limit`,
    )
    this.name = 'ActionIdempotencyCapacityError'
  }
}

/**
 * Keeps one Promise per recent client action. Settled entries are evicted
 * oldest-first; pending entries are never evicted because doing so could run
 * the same mutation twice.
 */
export class ActionIdempotencyCache {
  readonly #maxActions: number
  readonly #entries = new Map<ActionId, ActionEntry>()

  constructor(options: ActionIdempotencyCacheOptions = {}) {
    this.#maxActions = positiveInteger(
      options.maxActions,
      DEFAULT_MAX_ACTIONS,
      'maxActions',
    )
  }

  get size(): number {
    return this.#entries.size
  }

  execute<T>(
    actionId: ActionId,
    operation: string,
    input: unknown,
    action: () => T | Promise<T>,
  ): Promise<T> {
    nonEmptyString(actionId, 'actionId')
    nonEmptyString(operation, 'operation')
    const fingerprint = actionFingerprint(operation, input)
    const existing = this.#entries.get(actionId)
    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint) {
        return Promise.reject(
          new ActionIdConflictError(actionId, existing.operation, operation),
        )
      }
      this.#touch(actionId, existing)
      return existing.promise as Promise<T>
    }

    if (!this.#makeRoom()) {
      return Promise.reject(
        new ActionIdempotencyCapacityError(this.#maxActions),
      )
    }

    const promise = Promise.resolve().then(action)
    const entry: ActionEntry = {
      fingerprint,
      operation,
      promise,
      settled: false,
    }
    this.#entries.set(actionId, entry)
    void promise.then(
      () => {
        entry.settled = true
      },
      () => {
        entry.settled = true
      },
    )
    return promise
  }

  clear(): void {
    this.#entries.clear()
  }

  #makeRoom(): boolean {
    if (this.#entries.size < this.#maxActions) return true
    for (const [actionId, entry] of this.#entries) {
      if (!entry.settled) continue
      this.#entries.delete(actionId)
      return true
    }
    return false
  }

  #touch(actionId: ActionId, entry: ActionEntry): void {
    this.#entries.delete(actionId)
    this.#entries.set(actionId, entry)
  }
}

function actionFingerprint(operation: string, input: unknown): string {
  const canonical = canonicalJson(input, new Set())
  return createHash('sha256')
    .update(operation, 'utf8')
    .update('\u0000', 'utf8')
    .update(canonical, 'utf8')
    .digest('hex')
}

function canonicalJson(value: unknown, seen: Set<object>): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Action input must contain only finite JSON numbers')
    }
    return Object.is(value, -0) ? '0' : String(value)
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error('Action input must not be cyclic')
    seen.add(value)
    try {
      return `[${value.map((item) => canonicalJson(item, seen)).join(',')}]`
    } finally {
      seen.delete(value)
    }
  }
  if (typeof value === 'object') {
    if (seen.has(value)) throw new Error('Action input must not be cyclic')
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('Action input must contain only JSON objects')
    }
    seen.add(value)
    try {
      const record = value as Record<string, unknown>
      const properties = Object.keys(record)
        .sort()
        .map(
          (key) => `${JSON.stringify(key)}:${canonicalJson(record[key], seen)}`,
        )
      return `{${properties.join(',')}}`
    } finally {
      seen.delete(value)
    }
  }
  throw new Error('Action input must be JSON-compatible')
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

function nonEmptyString(value: string, name: string): void {
  if (value.trim().length === 0) throw new Error(`${name} must not be empty`)
}
