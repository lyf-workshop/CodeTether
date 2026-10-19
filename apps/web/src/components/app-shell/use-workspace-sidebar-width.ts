import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import {
  clampWorkspaceSidebarWidth,
  parseWorkspaceSidebarWidth,
  workspaceSidebarWidthBounds,
  workspaceSidebarWidthPreferenceKey,
} from './workspace-sidebar-layout'

const narrowDesktopQuery = '(max-width: 1180px)'

function subscribeNarrowDesktop(onChange: () => void) {
  const media = window.matchMedia(narrowDesktopQuery)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

function readStoredWidth(): number | undefined {
  try {
    const stored = window.localStorage.getItem(
      workspaceSidebarWidthPreferenceKey,
    )
    return stored === null ? undefined : parseWorkspaceSidebarWidth(stored)
  } catch {
    return undefined
  }
}

/** Own one scoped stylesheet; drag widths never become inline element styles. */
export function useWorkspaceSidebarWidth() {
  const layoutId = useId()
  const [storedWidth, setStoredWidth] = useState(readStoredWidth)
  const stylesheet = useRef<CSSStyleSheet | undefined>(undefined)
  const narrow = useSyncExternalStore(
    subscribeNarrowDesktop,
    () => window.matchMedia(narrowDesktopQuery).matches,
    () => false,
  )

  useLayoutEffect(() => {
    const sheet = new CSSStyleSheet()
    stylesheet.current = sheet
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
    return () => {
      stylesheet.current = undefined
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
        (candidate) => candidate !== sheet,
      )
    }
  }, [])
  useLayoutEffect(() => {
    stylesheet.current?.replaceSync(
      storedWidth === undefined
        ? ''
        : '[data-workspace-layout=' +
            JSON.stringify(layoutId) +
            '] { --layout-sidebar-user-width: ' +
            clampWorkspaceSidebarWidth(storedWidth) +
            'px; }',
    )
  }, [layoutId, storedWidth])

  function setWidth(width: number) {
    const nextWidth = clampWorkspaceSidebarWidth(width)
    setStoredWidth(nextWidth)
    try {
      window.localStorage.setItem(
        workspaceSidebarWidthPreferenceKey,
        String(nextWidth),
      )
    } catch {
      /* Optional preference storage. */
    }
  }
  return {
    layoutId,
    width: storedWidth ?? (narrow ? 224 : workspaceSidebarWidthBounds.default),
    setWidth,
  }
}
