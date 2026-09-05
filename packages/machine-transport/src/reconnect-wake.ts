export const reconnectWaitOutcomes = ['elapsed', 'woken', 'closed'] as const

export type ReconnectWaitOutcome = (typeof reconnectWaitOutcomes)[number]

export interface ReconnectWaitResult {
  readonly outcome: ReconnectWaitOutcome
  /** The jittered delay selected for this wait, or zero when already closed. */
  readonly scheduledDelayMs: number
}

export interface ReconnectWakeCoordinatorOptions {
  readonly initialDelayMs: number
  readonly maximumDelayMs: number
  readonly stableResetMs: number
  readonly random?: () => number
}

interface ActiveWait {
  readonly promise: Promise<ReconnectWaitResult>
  readonly settle: (outcome: ReconnectWaitOutcome) => void
}

/**
 * Owns only reconnect timing state. The caller remains the sole owner of its
 * socket, authentication, connection generation, and reconnect worker.
 *
 * Wake requests are level-triggered and coalesced until the reconnect worker
 * consumes the pending wake at the beginning of its next attempt. This lets a
 * burst of network/resume/timer signals expedite one attempt without creating
 * parallel sockets or timers.
 */
export class ReconnectWakeCoordinator {
  readonly #initialDelayMs: number
  readonly #maximumDelayMs: number
  readonly #stableResetMs: number
  readonly #random: () => number
  #currentDelayMs: number
  #connectedAt: number | undefined
  #wakePending = false
  #activeWait: ActiveWait | undefined
  #closed = false

  constructor(options: ReconnectWakeCoordinatorOptions) {
    this.#initialDelayMs = positiveInteger(
      options.initialDelayMs,
      'Reconnect initial delay',
    )
    this.#maximumDelayMs = positiveInteger(
      options.maximumDelayMs,
      'Reconnect maximum delay',
    )
    this.#stableResetMs = positiveInteger(
      options.stableResetMs,
      'Reconnect stable reset',
    )
    if (this.#initialDelayMs > this.#maximumDelayMs) {
      throw new TypeError('Reconnect delay bounds are invalid')
    }
    this.#random = options.random ?? Math.random
    this.#currentDelayMs = this.#initialDelayMs
  }

  get currentDelayMs(): number {
    return this.#currentDelayMs
  }

  get wakePending(): boolean {
    return this.#wakePending
  }

  get waiting(): boolean {
    return this.#activeWait !== undefined
  }

  get closed(): boolean {
    return this.#closed
  }

  /**
   * Requests one early reconnect attempt. Repeated signals coalesce until the
   * reconnect worker consumes the pending request.
   */
  requestWake(): boolean {
    if (this.#closed || this.#wakePending) return false
    this.#wakePending = true
    this.#activeWait?.settle('woken')
    return true
  }

  /** Called once at the beginning of each reconnect attempt. */
  consumePendingWake(): boolean {
    if (!this.#wakePending) return false
    this.#wakePending = false
    return true
  }

  /** Records the monotonic start of an authenticated stable connection. */
  noteConnected(monotonicNowMs: number): void {
    this.#connectedAt = monotonicTimestamp(monotonicNowMs)
  }

  /**
   * Ends the current stable interval and resets backoff only after the
   * configured duration. A backwards monotonic sample never causes a reset.
   */
  noteDisconnected(monotonicNowMs: number): boolean {
    const disconnectedAt = monotonicTimestamp(monotonicNowMs)
    const connectedAt = this.#connectedAt
    this.#connectedAt = undefined
    if (
      connectedAt === undefined ||
      disconnectedAt < connectedAt ||
      disconnectedAt - connectedAt < this.#stableResetMs
    ) {
      return false
    }
    this.#currentDelayMs = this.#initialDelayMs
    return true
  }

  /**
   * Waits for the next backoff deadline, a coalesced wake, or close. Only one
   * timer is owned even if the connection owner accidentally asks twice.
   */
  wait(minimumDelayMs = 0): Promise<ReconnectWaitResult> {
    if (this.#closed) {
      return Promise.resolve({ outcome: 'closed', scheduledDelayMs: 0 })
    }
    const existing = this.#activeWait
    if (existing !== undefined) return existing.promise

    const minimum = nonnegativeInteger(
      minimumDelayMs,
      'Reconnect minimum delay',
    )
    const boundedMinimumDelayMs = Math.min(minimum, this.#maximumDelayMs)
    const scheduledDelayMs = Math.max(
      boundedMinimumDelayMs,
      Math.min(
        this.#maximumDelayMs,
        jitteredDelay(this.#currentDelayMs, this.#random),
      ),
    )
    let timer: ReturnType<typeof setTimeout> | undefined
    let resolveWait: (result: ReconnectWaitResult) => void = () => undefined
    let settled = false
    const promise = new Promise<ReconnectWaitResult>((resolve) => {
      resolveWait = resolve
    })
    const activeWait: ActiveWait = {
      promise,
      settle: (outcome) => {
        if (settled) return
        settled = true
        if (timer !== undefined) clearTimeout(timer)
        if (this.#activeWait === activeWait) this.#activeWait = undefined
        if (outcome !== 'closed') {
          this.#currentDelayMs = Math.min(
            this.#currentDelayMs * 2,
            this.#maximumDelayMs,
          )
        }
        resolveWait({ outcome, scheduledDelayMs })
      },
    }
    this.#activeWait = activeWait

    if (this.#wakePending) {
      activeWait.settle('woken')
    } else {
      timer = setTimeout(() => activeWait.settle('elapsed'), scheduledDelayMs)
      timer.unref?.()
    }
    return promise
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#wakePending = false
    this.#connectedAt = undefined
    this.#activeWait?.settle('closed')
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`)
  }
  return value
}

function nonnegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer`)
  }
  return value
}

function monotonicTimestamp(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError('Reconnect monotonic timestamp must be non-negative')
  }
  return value
}

function jitteredDelay(delayMs: number, random: () => number): number {
  const sample = Math.min(1, Math.max(0, random()))
  return Math.max(1, Math.round(delayMs * (0.8 + sample * 0.4)))
}
