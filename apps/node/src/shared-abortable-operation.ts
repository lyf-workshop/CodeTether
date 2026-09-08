export interface SharedAbortableOperation<T> {
  readonly abort: AbortController
  readonly task: Promise<T>
  consumers: number
  persistentConsumer: boolean
  settled: boolean
}

export interface ArmedAbortDeadline {
  readonly expired: () => boolean
  readonly clear: () => void
}

/** Arms one unref'd creation-time deadline and makes its ownership explicit. */
export function armAbortDeadline(
  controller: AbortController,
  timeoutMs: number,
): ArmedAbortDeadline {
  let expired = false
  let cleared = false
  const clear = (): void => {
    if (cleared) return
    cleared = true
    clearTimeout(timer)
    controller.signal.removeEventListener('abort', clear)
  }
  const timer = setTimeout(() => {
    if (controller.signal.aborted) {
      clear()
      return
    }
    expired = true
    controller.abort(new DOMException('Operation timed out', 'TimeoutError'))
  }, timeoutMs)
  timer.unref?.()
  controller.signal.addEventListener('abort', clear, { once: true })
  return {
    expired: () => expired,
    clear,
  }
}

/**
 * Joins one Node-owned operation without letting a disconnected reader cancel
 * work that another authenticated consumer still owns. Once the last caller
 * leaves, the exact underlying operation is aborted and must clean its child
 * resources before settling.
 */
export function consumeSharedAbortableOperation<T>(
  operation: SharedAbortableOperation<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (signal === undefined) {
    operation.persistentConsumer = true
    return operation.task
  }
  if (signal?.aborted === true) {
    const reason = abortReason(signal)
    if (
      operation.consumers === 0 &&
      !operation.persistentConsumer &&
      !operation.settled
    ) {
      operation.abort.abort(reason)
      return operation.task.then(
        () => Promise.reject(reason),
        (error: unknown) => Promise.reject(error),
      )
    }
    return Promise.reject(reason)
  }
  operation.consumers += 1
  return new Promise<T>((resolve, reject) => {
    let released = false
    const release = (): boolean => {
      if (released) return false
      released = true
      signal?.removeEventListener('abort', onAbort)
      operation.consumers -= 1
      return (
        operation.consumers === 0 &&
        !operation.persistentConsumer &&
        !operation.settled
      )
    }
    const onAbort = (): void => {
      const reason = abortReason(signal)
      const ownsFinalCleanup = release()
      if (!ownsFinalCleanup) {
        reject(reason)
        return
      }
      operation.abort.abort(reason)
      // The final consumer retains request ownership until the exact shared
      // operation has observed cancellation and cleaned its children. This
      // also ensures a sequential Check Again cannot join the doomed entry.
      void operation.task.then(
        () => reject(reason),
        (error: unknown) => reject(error),
      )
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted === true) {
      onAbort()
      return
    }
    void operation.task.then(
      (value) => {
        if (released) return
        release()
        resolve(value)
      },
      (error: unknown) => {
        if (released) return
        release()
        reject(error)
      },
    )
  })
}

function abortReason(signal: AbortSignal | undefined): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException('Operation aborted', 'AbortError')
}
