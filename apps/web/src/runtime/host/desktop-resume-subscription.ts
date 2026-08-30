import type {
  BackgroundRuntimeCapability,
  DesktopResumeIntent,
} from '../native/native-capabilities.js'

export interface DesktopResumeRecoverableRuntime {
  recoverAfterDesktopResume(intent: DesktopResumeIntent): void
}

const RESUME_LISTENER_REGISTRATION_ATTEMPTS = 2
const RESUME_LISTENER_RETRY_DELAY_MS = 250

/**
 * Owns the one asynchronous native-listener registration independently from
 * React's StrictMode mount/release timing.
 */
export function subscribeRuntimeToDesktopResume(
  runtime: DesktopResumeRecoverableRuntime,
  capability: BackgroundRuntimeCapability,
): () => void {
  if (!capability.available) return () => undefined
  let active = true
  let unsubscribe: (() => void) | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined

  const register = async (attempt: number): Promise<void> => {
    try {
      const cleanup = await capability.subscribeToResume((intent) => {
        if (active) runtime.recoverAfterDesktopResume(intent)
      })
      if (!active) {
        cleanup()
        return
      }
      unsubscribe = cleanup
    } catch {
      if (!active) return
      if (attempt < RESUME_LISTENER_REGISTRATION_ATTEMPTS) {
        retryTimer = setTimeout(() => {
          retryTimer = undefined
          void register(attempt + 1)
        }, RESUME_LISTENER_RETRY_DELAY_MS)
      } else {
        console.warn(
          '[CodeTether] Desktop resume listener could not be registered.',
        )
      }
    }
  }

  void register(1)
  return () => {
    if (!active) return
    active = false
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer)
      retryTimer = undefined
    }
    unsubscribe?.()
  }
}
