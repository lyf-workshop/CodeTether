export const conversationInspectorWidthPreferenceKey =
  'codetether.conversation-inspector-width'

export const conversationInspectorWidthBounds = {
  minimum: 280,
  default: 348,
  maximum: 560,
  conversationMinimum: 512,
} as const

interface PreferenceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function conversationInspectorMaximumWidth(
  workspaceWidth?: number,
): number {
  if (workspaceWidth === undefined || !Number.isFinite(workspaceWidth)) {
    return conversationInspectorWidthBounds.maximum
  }

  return Math.max(
    conversationInspectorWidthBounds.minimum,
    Math.min(
      conversationInspectorWidthBounds.maximum,
      Math.floor(
        workspaceWidth - conversationInspectorWidthBounds.conversationMinimum,
      ),
    ),
  )
}

export function clampConversationInspectorWidth(
  width: number,
  workspaceWidth?: number,
): number {
  if (!Number.isFinite(width)) return conversationInspectorWidthBounds.default
  return Math.min(
    conversationInspectorMaximumWidth(workspaceWidth),
    Math.max(conversationInspectorWidthBounds.minimum, Math.round(width)),
  )
}

export function parseConversationInspectorWidth(value: string | null): number {
  if (value === null || value.trim() === '') {
    return conversationInspectorWidthBounds.default
  }
  return clampConversationInspectorWidth(Number(value))
}

export function readConversationInspectorWidth(
  storage: PreferenceStorage | undefined = browserStorage(),
): number {
  if (storage === undefined) return conversationInspectorWidthBounds.default
  try {
    return parseConversationInspectorWidth(
      storage.getItem(conversationInspectorWidthPreferenceKey),
    )
  } catch {
    return conversationInspectorWidthBounds.default
  }
}

export function writeConversationInspectorWidth(
  storage: PreferenceStorage | undefined,
  width: number,
): void {
  if (storage === undefined) return
  try {
    storage.setItem(
      conversationInspectorWidthPreferenceKey,
      String(clampConversationInspectorWidth(width)),
    )
  } catch {
    // Storage is optional in embedded and private browser contexts.
  }
}

function browserStorage(): PreferenceStorage | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}
