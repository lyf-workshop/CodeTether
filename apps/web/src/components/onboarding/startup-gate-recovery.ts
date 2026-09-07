import type { HostConnectionState } from '../../runtime/host/host-runtime.js'

/**
 * A packaged Desktop window can render shortly before its Host sidecar starts
 * listening. Keep that bootstrap recovery local to the first-route gate and
 * finite so the permanent Host runtime/manual retry contract stays unchanged.
 */
export const startupGateRecoveryDelaysMs = [
  100, 400, 1_200, 3_000, 8_000,
] as const

export type StartupGateRecoveryAction = 'retry_host' | 'refetch_onboarding'

export function startupGateRecoveryAction(input: {
  readonly connectionState: HostConnectionState
  readonly onboardingReadFailed: boolean
  readonly onboardingReadFetching: boolean
}): StartupGateRecoveryAction | undefined {
  if (input.connectionState === 'unavailable') return 'retry_host'
  if (
    input.connectionState === 'connected' &&
    input.onboardingReadFailed &&
    !input.onboardingReadFetching
  ) {
    return 'refetch_onboarding'
  }
  return undefined
}

export function startupGateRecoveryDelay(
  completedAttempts: number,
): number | undefined {
  return startupGateRecoveryDelaysMs[completedAttempts]
}
