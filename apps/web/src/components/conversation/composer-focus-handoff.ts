export const COMPOSER_FOCUS_HANDOFF_TIMEOUT_MS = 5_000

interface ComposerFocusTarget {
  focus(): void
}

interface ComposerFocusHandoffOptions {
  readonly isBlocked: () => boolean
  readonly getTarget: () => ComposerFocusTarget | null
  readonly claim: () => boolean
  readonly clearIntent: () => void
  readonly observe: (onChange: () => void) => () => void
  readonly scheduleTimeout: (
    onTimeout: () => void,
    timeoutMs: number,
  ) => () => void
}

interface ComposerFocusHandoff {
  dispose(): void
}

export function startComposerFocusHandoff(
  options: ComposerFocusHandoffOptions,
): ComposerFocusHandoff {
  let settled = false
  let stopObserving: () => void = () => undefined
  let cancelTimeout: () => void = () => undefined

  const dispose = () => {
    stopObserving()
    cancelTimeout()
  }

  const settle = (target: ComposerFocusTarget | null) => {
    if (settled) return true

    settled = true
    dispose()
    if (!options.claim()) return true

    target?.focus()
    options.clearIntent()
    return true
  }

  const tryFocus = () => {
    if (settled || options.isBlocked()) return false
    const target = options.getTarget()
    if (target === null) return false
    return settle(target)
  }

  if (!tryFocus()) {
    stopObserving = options.observe(() => {
      tryFocus()
    })
    cancelTimeout = options.scheduleTimeout(() => {
      settle(null)
    }, COMPOSER_FOCUS_HANDOFF_TIMEOUT_MS)
  }

  return { dispose }
}
