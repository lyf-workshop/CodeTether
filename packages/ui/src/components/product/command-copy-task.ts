export type CommandCopyState =
  'idle' | 'pending' | 'copied' | 'failed' | 'unavailable'

/** A user-initiated clipboard wait is UI-only and must not stay busy indefinitely. */
export const COMMAND_COPY_TIMEOUT_MS = 5_000

/** Per-mounted-command ownership; no shell, storage, environment or automatic retry. */
export class CommandCopyTask {
  #state: CommandCopyState = 'idle'
  #busy = false
  #disposed = false
  #generation = 0
  #listeners = new Set<() => void>()
  #cancelPending: (() => void) | undefined

  getSnapshot = (): CommandCopyState => this.#state

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  copy(
    code: string,
    writeText: ((text: string) => Promise<void>) | undefined,
  ): Promise<void> {
    if (this.#disposed || this.#busy) return Promise.resolve()
    if (writeText === undefined) {
      this.#publish('unavailable')
      return Promise.resolve()
    }
    this.#busy = true
    const generation = ++this.#generation
    this.#publish('pending')
    if (this.#disposed || generation !== this.#generation) {
      this.#busy = false
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      let finished = false
      const finish = (state?: CommandCopyState) => {
        if (finished) return
        finished = true
        clearTimeout(timeout)
        this.#cancelPending = undefined
        this.#busy = false
        if (
          !this.#disposed &&
          generation === this.#generation &&
          state !== undefined
        )
          this.#publish(state)
        resolve()
      }
      this.#cancelPending = () => finish()
      const timeout = setTimeout(
        () => finish('failed'),
        COMMAND_COPY_TIMEOUT_MS,
      )
      try {
        void writeText(code).then(
          () => finish('copied'),
          () => finish('failed'),
        )
      } catch {
        finish('failed')
      }
    })
  }

  dispose(): void {
    this.#disposed = true
    this.#generation += 1
    this.#cancelPending?.()
    this.#listeners.clear()
  }

  #publish(state: CommandCopyState): void {
    this.#state = state
    for (const listener of this.#listeners) listener()
  }
}
