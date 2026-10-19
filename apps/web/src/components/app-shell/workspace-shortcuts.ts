type WorkspaceShortcut = 'palette' | 'new-conversation' | 'settings'

export function workspaceNavigationBlocked(
  activeDialog: string | null,
  mountedDialog: boolean,
): boolean {
  return activeDialog !== null || mountedDialog
}

/** Presentation shortcuts never bypass another control's handled event or IME. */
export function workspaceShortcut(event: {
  readonly key: string
  readonly ctrlKey?: boolean
  readonly metaKey?: boolean
  readonly altKey?: boolean
  readonly shiftKey?: boolean
  readonly repeat?: boolean
  readonly isComposing?: boolean
  readonly defaultPrevented?: boolean
  readonly keyCode?: number
}): WorkspaceShortcut | undefined {
  if (
    !(event.metaKey || event.ctrlKey) ||
    event.altKey ||
    event.shiftKey ||
    event.repeat ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.defaultPrevented
  )
    return undefined
  const key = event.key.toLowerCase()
  if (key === 'k') return 'palette'
  if (key === 'n') return 'new-conversation'
  if (key === ',') return 'settings'
  return undefined
}
