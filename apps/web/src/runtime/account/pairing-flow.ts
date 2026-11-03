import {
  cancelPairingSession,
  createPairingSession,
  finishPairingSession,
  newPairingSessionId,
  readOwnerPairingSession,
  type PairingOwnerContext,
} from './pairing-client.js'
import { reconcileLocalSupervisorGrants } from './remote-supervisor.js'

export type OwnerPairingProgress =
  | {
      readonly status: 'pending'
      readonly code: string
      readonly expiresAt: string
    }
  | { readonly status: 'claimed' }
  | { readonly status: 'paired'; readonly label: string }
  | { readonly status: 'expired' | 'cancelled' | 'rate_limited' }

export function waitForPairingPoll(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, 2_000)
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

export async function runOwnerPairing(
  context: PairingOwnerContext,
  signal: AbortSignal,
  onProgress: (progress: OwnerPairingProgress) => void,
): Promise<void> {
  signal.throwIfAborted()
  const sessionId = newPairingSessionId()
  let paired = false
  try {
    // Preserve ordering with cancellation if the create response arrives late.
    // An unopened code is never shown until the create request succeeds.
    const created = await createPairingSession(
      { ...context, signal: AbortSignal.timeout(10_000) },
      sessionId,
    )
    signal.throwIfAborted()
    if (created.code === undefined) throw new Error('pairing_response_invalid')
    onProgress({
      status: 'pending',
      code: created.code,
      expiresAt: created.expiresAt,
    })
    for (;;) {
      await waitForPairingPoll(signal)
      if (Date.parse(created.expiresAt) <= Date.now()) {
        onProgress({ status: 'expired' })
        return
      }
      const current = await readOwnerPairingSession(
        { ...context, signal },
        sessionId,
      )
      signal.throwIfAborted()
      if (current.status === 'pending') continue
      if (
        current.status === 'expired' ||
        current.status === 'cancelled' ||
        current.status === 'rate_limited'
      ) {
        onProgress({ status: current.status })
        return
      }
      if (current.status !== 'claimed' || current.device === undefined)
        throw new Error('pairing_response_invalid')
      onProgress({ status: 'claimed' })
      await finishPairingSession({ ...context, signal }, current)
      paired = true
      signal.throwIfAborted()
      onProgress({ status: 'paired', label: current.device.label })
      // If activation is temporarily unavailable, the existing owner loop
      // materializes the grant on its next refresh.
      await reconcileLocalSupervisorGrants({ ...context, signal }).catch(
        () => undefined,
      )
      return
    }
  } finally {
    if (!paired) {
      await cancelPairingSession(
        { ...context, signal: AbortSignal.timeout(5_000) },
        sessionId,
      ).catch(() => undefined)
    }
  }
}
