export const SIGN_IN_RESEND_COOLDOWN_MS = 30_000
export const SIGN_IN_RESEND_TICK_MS = 1_000

/** UI-only rate affordance; the account service remains the limiting authority. */
export function signInResendSeconds(
  availableAt: number,
  now = Date.now(),
): number {
  return Math.max(0, Math.ceil((availableAt - now) / SIGN_IN_RESEND_TICK_MS))
}
