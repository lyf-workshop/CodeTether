import { nativeCapabilities } from '../native/native-capabilities.js'

export type ThemePreference = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

export const themePreferenceStorageKey = 'ct-theme'

export interface ThemePreferenceStorage {
  getItem(key: string): string | null | undefined
  setItem(key: string, value: string): void
}

interface ThemeMediaQuery {
  readonly matches: boolean
  addEventListener(type: 'change', listener: () => void): void
  removeEventListener(type: 'change', listener: () => void): void
}

interface ThemeControllerOptions {
  root: { dataset: { theme?: string } }
  storage?: ThemePreferenceStorage | null
  mediaQuery?: ThemeMediaQuery
  setWindowTheme?: (theme: Theme | null) => Promise<void>
}

export function parseThemePreference(value: unknown): ThemePreference {
  return value === 'system' || value === 'dark' ? value : 'light'
}

export function resolveTheme(
  preference: ThemePreference,
  systemDark = false,
): Theme {
  return preference === 'system' ? (systemDark ? 'dark' : 'light') : preference
}

export function readThemePreference(
  storage?: Pick<ThemePreferenceStorage, 'getItem'> | null,
): ThemePreference {
  try {
    return parseThemePreference(storage?.getItem(themePreferenceStorageKey))
  } catch {
    return 'light'
  }
}

/** The single browser theme owner. It stores presentation preference only. */
export function createThemeController({
  root,
  storage,
  mediaQuery,
  setWindowTheme,
}: ThemeControllerOptions) {
  let preference = readThemePreference(storage)
  let theme = resolveTheme(preference, mediaQuery?.matches)
  const listeners = new Set<() => void>()
  root.dataset.theme = theme

  function applyWindowTheme() {
    if (setWindowTheme === undefined) return
    void setWindowTheme(preference === 'system' ? null : preference).catch(
      () => {
        console.warn('[CodeTether] Window theme could not be applied.')
      },
    )
  }

  applyWindowTheme()

  function notify() {
    for (const listener of listeners) listener()
  }

  function onSystemChange() {
    const next = resolveTheme(preference, mediaQuery?.matches)
    if (next === theme) return
    theme = next
    root.dataset.theme = theme
    notify()
  }

  mediaQuery?.addEventListener('change', onSystemChange)

  return {
    getPreference: () => preference,
    getTheme: () => theme,
    setPreference(next: ThemePreference) {
      if (next === preference) return
      preference = next
      theme = resolveTheme(preference, mediaQuery?.matches)
      try {
        storage?.setItem(themePreferenceStorageKey, preference)
      } catch {
        // A blocked storage origin still supports a preference for this window.
      }
      root.dataset.theme = theme
      applyWindowTheme()
      notify()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      mediaQuery?.removeEventListener('change', onSystemChange)
      listeners.clear()
    },
  }
}

let browserController: ReturnType<typeof createThemeController> | undefined

export function getThemeController() {
  if (browserController) return browserController
  let storage: Storage | undefined
  try {
    storage = window.localStorage
  } catch {
    // Storage can be unavailable in an embedded or privacy-restricted browser.
  }
  browserController = createThemeController({
    root: document.documentElement,
    storage,
    ...(nativeCapabilities.windowTheme.available
      ? {
          setWindowTheme: (theme: Theme | null) =>
            nativeCapabilities.windowTheme.setTheme(theme),
        }
      : {}),
    mediaQuery:
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : undefined,
  })
  return browserController
}
