import { CodexProtocolError } from './errors.js'
import type { TurnTerminalResult } from './protocol.js'

interface TurnWaiter {
  readonly resolve: (result: TurnTerminalResult) => void
  readonly reject: (error: Error) => void
  readonly timer: NodeJS.Timeout
}

interface TurnState {
  readonly threadId: string
  readonly turnId: string
  readonly waiters: Set<TurnWaiter>
  finalMessage?: string
}

// A turn can finish before its caller starts waiting. Keep that race-safe
// result cache bounded, and remember more released ids so late duplicates do
// not immediately repopulate it.
const TERMINAL_RESULT_CACHE_LIMIT = 64
const RELEASED_TURN_TOMBSTONE_LIMIT = 256

/** Owns transient per-thread and per-turn memory for one App Server process. */
export class TurnLifecycleRegistry {
  readonly #activeTurns = new Map<string, string>()
  readonly #turns = new Map<string, TurnState>()
  readonly #terminalResults = new Map<string, TurnTerminalResult>()
  readonly #releasedTurns = new Set<string>()
  readonly #onRelease?: (threadId: string, turnId: string) => void
  #failure?: Error

  constructor(onRelease?: (threadId: string, turnId: string) => void) {
    this.#onRelease = onRelease
  }

  get activeTurnCount(): number {
    return this.#activeTurns.size
  }

  get retainedTurnCount(): number {
    return this.#turns.size + this.#terminalResults.size
  }

  get waiterCount(): number {
    let count = 0
    for (const state of this.#turns.values()) count += state.waiters.size
    return count
  }

  get failure(): Error | undefined {
    return this.#failure
  }

  activate(threadId: string, turnId: string): void {
    this.#assertAvailable()
    const key = turnKey(threadId, turnId)
    if (this.#terminalResults.has(key) || this.#releasedTurns.has(key)) return
    this.#activeTurns.set(threadId, turnId)
    this.#state(threadId, turnId)
  }

  activeTurn(threadId: string): string | undefined {
    return this.#activeTurns.get(threadId)
  }

  completeMessage(threadId: string, turnId: string, message: string): void {
    if (this.#isClosed(threadId, turnId)) return
    const state = this.#state(threadId, turnId)
    state.finalMessage = message
  }

  finalMessage(threadId: string, turnId: string): string | undefined {
    return this.#turns.get(turnKey(threadId, turnId))?.finalMessage
  }

  settle(result: TurnTerminalResult): void {
    const { threadId, turn } = result
    if (this.#activeTurns.get(threadId) === turn.id) {
      this.#activeTurns.delete(threadId)
    }
    if (this.#failure !== undefined) return

    const key = turnKey(threadId, turn.id)
    if (this.#releasedTurns.has(key) || this.#terminalResults.has(key)) return

    const state = this.#turns.get(key)
    if (state === undefined || state.waiters.size === 0) {
      this.#release(threadId, turn.id)
      this.#cacheTerminal(key, result)
      return
    }

    const waiters = [...state.waiters]
    state.waiters.clear()
    this.#release(threadId, turn.id)
    this.#rememberReleased(key)
    for (const waiter of waiters) {
      clearTimeout(waiter.timer)
      waiter.resolve(result)
    }
  }

  wait(
    threadId: string,
    turnId: string,
    timeoutMs: number,
  ): Promise<TurnTerminalResult> {
    if (this.#failure !== undefined) return Promise.reject(this.#failure)
    const key = turnKey(threadId, turnId)
    const terminal = this.#terminalResults.get(key)
    if (terminal !== undefined) {
      this.#terminalResults.delete(key)
      this.#rememberReleased(key)
      return Promise.resolve(terminal)
    }
    if (this.#releasedTurns.has(key)) {
      return Promise.reject(
        new CodexProtocolError(
          `Turn ${turnId} terminal result is no longer available`,
        ),
      )
    }

    const state = this.#state(threadId, turnId)

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        state.waiters.delete(waiter)
        if (state.waiters.size === 0) {
          this.#release(threadId, turnId)
          this.#rememberReleased(key)
        }
        reject(new CodexProtocolError(`Timed out waiting for turn ${turnId}`))
      }, timeoutMs)
      const waiter: TurnWaiter = { resolve, reject, timer }
      state.waiters.add(waiter)
    })
  }

  failAll(error: Error): void {
    if (this.#failure !== undefined) return
    this.#failure = error
    for (const state of this.#turns.values()) {
      for (const waiter of state.waiters) {
        clearTimeout(waiter.timer)
        waiter.reject(error)
      }
      this.#onRelease?.(state.threadId, state.turnId)
    }
    this.#turns.clear()
    this.#activeTurns.clear()
    this.#terminalResults.clear()
    this.#releasedTurns.clear()
  }

  #state(threadId: string, turnId: string): TurnState {
    const key = turnKey(threadId, turnId)
    const existing = this.#turns.get(key)
    if (existing !== undefined) return existing
    const created: TurnState = {
      threadId,
      turnId,
      waiters: new Set(),
    }
    this.#turns.set(key, created)
    return created
  }

  #release(threadId: string, turnId: string): void {
    const key = turnKey(threadId, turnId)
    if (!this.#turns.delete(key)) return
    this.#onRelease?.(threadId, turnId)
  }

  #cacheTerminal(key: string, result: TurnTerminalResult): void {
    this.#terminalResults.set(key, result)
    while (this.#terminalResults.size > TERMINAL_RESULT_CACHE_LIMIT) {
      const oldestKey = this.#terminalResults.keys().next().value
      if (oldestKey === undefined) break
      this.#terminalResults.delete(oldestKey)
      this.#rememberReleased(oldestKey)
    }
  }

  #rememberReleased(key: string): void {
    this.#terminalResults.delete(key)
    this.#releasedTurns.delete(key)
    this.#releasedTurns.add(key)
    while (this.#releasedTurns.size > RELEASED_TURN_TOMBSTONE_LIMIT) {
      const oldestKey = this.#releasedTurns.values().next().value
      if (oldestKey === undefined) break
      this.#releasedTurns.delete(oldestKey)
    }
  }

  #isClosed(threadId: string, turnId: string): boolean {
    if (this.#failure !== undefined) return true
    const key = turnKey(threadId, turnId)
    return this.#terminalResults.has(key) || this.#releasedTurns.has(key)
  }

  #assertAvailable(): void {
    if (this.#failure !== undefined) throw this.#failure
  }
}

function turnKey(threadId: string, turnId: string): string {
  return `${threadId}\u0000${turnId}`
}
