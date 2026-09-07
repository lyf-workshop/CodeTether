import type { Readable } from 'node:stream'

const MAXIMUM_IO_TIMEOUT_MS = 120_000

export class CodexInstallationIoTimeoutError extends Error {
  readonly code = 'codex_installation_io_timeout'

  constructor() {
    super('Codex installation filesystem observation timed out')
    this.name = 'CodexInstallationIoTimeoutError'
  }
}

export interface CodexInstallationIoDeadline {
  readonly signal: AbortSignal
  run<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T>
  throwIfAborted(): void
  dispose(): void
}

/**
 * Bounds an elapsed filesystem-observation window. Promise-backed filesystem
 * calls cannot all be cancelled by Node, so callers race every operation
 * against this signal and pass it through whenever the API supports abort.
 */
export function createCodexInstallationIoDeadline(
  timeoutMs: number,
  parentSignal?: AbortSignal,
): CodexInstallationIoDeadline {
  const boundedTimeoutMs = boundedIoTimeout(timeoutMs)
  const controller = new AbortController()
  const onParentAbort = (): void => {
    controller.abort(abortReason(parentSignal))
  }
  if (parentSignal?.aborted === true) onParentAbort()
  else parentSignal?.addEventListener('abort', onParentAbort, { once: true })

  const timer = setTimeout(() => {
    controller.abort(new CodexInstallationIoTimeoutError())
  }, boundedTimeoutMs)

  return {
    signal: controller.signal,
    async run<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
      throwIfSignalAborted(controller.signal)
      let onAbort: (() => void) | undefined
      const aborted = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(abortReason(controller.signal))
        controller.signal.addEventListener('abort', onAbort, { once: true })
        if (controller.signal.aborted) onAbort()
      })
      try {
        return await Promise.race([
          Promise.resolve().then(() => operation(controller.signal)),
          aborted,
        ])
      } finally {
        if (onAbort !== undefined) {
          controller.signal.removeEventListener('abort', onAbort)
        }
      }
    },
    throwIfAborted(): void {
      throwIfSignalAborted(controller.signal)
    },
    dispose(): void {
      clearTimeout(timer)
      parentSignal?.removeEventListener('abort', onParentAbort)
    },
  }
}

/** Consumes a stream inside a deadline and always destroys it on every exit. */
export async function consumeCodexInstallationStream(
  stream: Readable,
  deadline: CodexInstallationIoDeadline,
  consume: (chunk: Buffer) => void,
): Promise<void> {
  try {
    await deadline.run(async (signal) => {
      for await (const value of stream) {
        throwIfSignalAborted(signal)
        consume(Buffer.isBuffer(value) ? value : Buffer.from(value))
      }
    })
  } finally {
    stream.destroy()
  }
}

function boundedIoTimeout(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > MAXIMUM_IO_TIMEOUT_MS
  ) {
    throw new RangeError(
      'filesystem timeout must be a bounded positive integer',
    )
  }
  return value
}

function throwIfSignalAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortReason(signal)
}

function abortReason(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) return signal.reason
  return new DOMException('Operation aborted', 'AbortError')
}
