export const COMPOSER_SEND_SHORTCUT_KEY = 'composer-send-shortcut'
export const COMPOSER_SEND_SHORTCUT_EVENT = 'composer-send-shortcut-change'

export type ComposerSendShortcut = 'enter' | 'ctrl-enter'

let sessionShortcut: ComposerSendShortcut | undefined

export function readComposerSendShortcut(): ComposerSendShortcut {
  if (sessionShortcut !== undefined) return sessionShortcut
  if (typeof window === 'undefined') return 'enter'
  try {
    return window.localStorage.getItem(COMPOSER_SEND_SHORTCUT_KEY) ===
      'ctrl-enter'
      ? 'ctrl-enter'
      : 'enter'
  } catch {
    return 'enter'
  }
}

export function writeComposerSendShortcut(value: ComposerSendShortcut): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(COMPOSER_SEND_SHORTCUT_KEY, value)
    sessionShortcut = undefined
  } catch {
    sessionShortcut = value
  }
  window.dispatchEvent(new window.Event(COMPOSER_SEND_SHORTCUT_EVENT))
}
