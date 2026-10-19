import { useId, useLayoutEffect, useRef } from 'react'
import { clampConversationInspectorWidth } from './conversation-inspector-layout'

/** Own one scoped rule for the existing resize preference, never inline styles. */
export function useConversationInspectorStyle(width: number) {
  const layoutId = useId()
  const stylesheet = useRef<CSSStyleSheet | undefined>(undefined)
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
      '[data-conversation-layout=' +
        JSON.stringify(layoutId) +
        '] { --layout-conversation-inspector-width: ' +
        clampConversationInspectorWidth(width) +
        'px; }',
    )
  }, [layoutId, width])
  return layoutId
}
