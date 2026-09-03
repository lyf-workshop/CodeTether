const SAFE_ERROR_NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u

/** Returns one bounded token suitable for a single presentation-safe log field. */
export function safeErrorNameForLog(error: unknown): string {
  return error instanceof Error && SAFE_ERROR_NAME.test(error.name)
    ? error.name
    : 'Error'
}
