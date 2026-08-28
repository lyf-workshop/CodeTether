import { StringDecoder } from 'node:string_decoder'
import type { EventEmitter } from 'node:events'
import type { Readable } from 'node:stream'

const MAX_DESKTOP_COMMAND_BYTES = 1_024

export type HostShutdownReason =
  | 'SIGINT'
  | 'SIGTERM'
  | 'desktop_shutdown'
  | 'desktop_parent_eof'
  | 'desktop_channel_error'

export interface HostProcessLifecycle {
  readonly activated: Promise<boolean>
  readonly requested: Promise<HostShutdownReason>
  readonly isRequested: boolean
  dispose(): void
}

export interface HostProcessLifecycleOptions {
  readonly desktopManaged: boolean
  readonly input?: Readable
  readonly signalSource?: EventEmitter
  readonly maxDesktopCommandBytes?: number
}

/**
 * Observe process signals and, only in Desktop-managed mode, the private parent
 * pipe. The watcher is intentionally independent from Host business/runtime
 * state so it can be installed before asynchronous startup begins.
 */
export function createHostProcessLifecycle(
  options: HostProcessLifecycleOptions,
): HostProcessLifecycle {
  const signalSource = options.signalSource ?? process
  const input = options.input ?? process.stdin
  const maxDesktopCommandBytes =
    options.maxDesktopCommandBytes ?? MAX_DESKTOP_COMMAND_BYTES
  if (
    !Number.isSafeInteger(maxDesktopCommandBytes) ||
    maxDesktopCommandBytes <= 0
  ) {
    throw new Error('maxDesktopCommandBytes must be a positive integer')
  }

  let resolveRequest!: (reason: HostShutdownReason) => void
  let resolveActivation!: (activated: boolean) => void
  let activationSettled = false
  let settled = false
  let disposed = false
  let buffered = ''
  const decoder = new StringDecoder('utf8')
  const requested = new Promise<HostShutdownReason>((resolve) => {
    resolveRequest = resolve
  })
  const activated = options.desktopManaged
    ? new Promise<boolean>((resolve) => {
        resolveActivation = resolve
      })
    : Promise.resolve(true)

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    if (!activationSettled && options.desktopManaged) {
      activationSettled = true
      resolveActivation(false)
    }
    signalSource.off('SIGINT', onSigint)
    signalSource.off('SIGTERM', onSigterm)
    if (!options.desktopManaged) return
    input.off('data', onInputData)
    input.off('end', onInputEnd)
    input.off('close', onInputEnd)
    input.off('error', onInputError)
    // A still-open parent write handle otherwise keeps the resumed stdin pipe
    // referenced after a `shutdown` command and prevents the Host from exiting.
    input.destroy()
  }
  const settle = (reason: HostShutdownReason): void => {
    if (settled || disposed) return
    settled = true
    if (!activationSettled && options.desktopManaged) {
      activationSettled = true
      resolveActivation(false)
    }
    dispose()
    resolveRequest(reason)
  }
  const activate = (): void => {
    if (activationSettled || settled || disposed || !options.desktopManaged) {
      return
    }
    activationSettled = true
    resolveActivation(true)
  }
  const onSigint = (): void => settle('SIGINT')
  const onSigterm = (): void => settle('SIGTERM')
  const onInputEnd = (): void => settle('desktop_parent_eof')
  const onInputError = (): void => settle('desktop_channel_error')
  const onInputData = (chunk: Buffer | string): void => {
    buffered += typeof chunk === 'string' ? chunk : decoder.write(chunk)
    for (;;) {
      const newline = buffered.indexOf('\n')
      if (newline < 0) break
      let line = buffered.slice(0, newline)
      buffered = buffered.slice(newline + 1)
      if (line.endsWith('\r')) line = line.slice(0, -1)
      if (Buffer.byteLength(line, 'utf8') > maxDesktopCommandBytes) {
        settle('desktop_channel_error')
        return
      }
      if (line === 'shutdown') {
        settle('desktop_shutdown')
        return
      }
      if (line === 'start') {
        activate()
      }
    }
    if (Buffer.byteLength(buffered, 'utf8') > maxDesktopCommandBytes) {
      settle('desktop_channel_error')
    }
  }

  signalSource.once('SIGINT', onSigint)
  signalSource.once('SIGTERM', onSigterm)
  if (options.desktopManaged) {
    input.on('data', onInputData)
    input.once('end', onInputEnd)
    input.once('close', onInputEnd)
    input.once('error', onInputError)
    if (input.readableEnded || input.destroyed) {
      queueMicrotask(onInputEnd)
    } else {
      input.resume()
    }
  }

  return {
    activated,
    requested,
    get isRequested() {
      return settled
    },
    dispose,
  }
}
