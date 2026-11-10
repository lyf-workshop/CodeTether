export const COMPOSER_SEND_SHORTCUT_KEY = 'composer-send-shortcut'
export const COMPOSER_SEND_SHORTCUT_EVENT = 'composer-send-shortcut-change'

export type ComposerSendShortcut = 'enter' | 'ctrl-enter'

export function readComposerSendShortcut(): ComposerSendShortcut {
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
  window.localStorage.setItem(COMPOSER_SEND_SHORTCUT_KEY, value)
  window.dispatchEvent(new Event(COMPOSER_SEND_SHORTCUT_EVENT))
}
