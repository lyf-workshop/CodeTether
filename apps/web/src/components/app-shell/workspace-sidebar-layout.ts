export const workspaceSidebarWidthPreferenceKey =
  'codetether.workspace-sidebar.width'
export const workspaceSidebarCollapsedPreferenceKey =
  'codetether.workspace-sidebar.collapsed'

export const workspaceSidebarWidthBounds = {
  minimum: 220,
  default: 280,
  maximum: 420,
} as const

interface PreferenceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function clampWorkspaceSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return workspaceSidebarWidthBounds.default
  return Math.min(
    workspaceSidebarWidthBounds.maximum,
    Math.max(workspaceSidebarWidthBounds.minimum, Math.round(width)),
  )
}

export function parseWorkspaceSidebarWidth(value: string | null): number {
  if (value === null || value.trim() === '') {
    return workspaceSidebarWidthBounds.default
  }
  return clampWorkspaceSidebarWidth(Number(value))
}

export function readWorkspaceSidebarWidth(
  storage: PreferenceStorage | undefined = browserStorage(),
): number {
  if (storage === undefined) return workspaceSidebarWidthBounds.default
  try {
    return parseWorkspaceSidebarWidth(
      storage.getItem(workspaceSidebarWidthPreferenceKey),
    )
  } catch {
    return workspaceSidebarWidthBounds.default
  }
}

export function readWorkspaceSidebarCollapsed(
  storage: PreferenceStorage | undefined = browserStorage(),
): boolean {
  if (storage === undefined) return false
  try {
    return storage.getItem(workspaceSidebarCollapsedPreferenceKey) === '1'
  } catch {
    return false
  }
}

export function writeWorkspaceSidebarWidth(
  storage: PreferenceStorage | undefined,
  width: number,
): void {
  if (storage === undefined) return
  try {
    storage.setItem(
      workspaceSidebarWidthPreferenceKey,
      String(clampWorkspaceSidebarWidth(width)),
    )
  } catch {
    // Storage is optional in embedded and private browser contexts.
  }
}

export function writeWorkspaceSidebarCollapsed(
  storage: PreferenceStorage | undefined,
  collapsed: boolean,
): void {
  if (storage === undefined) return
  try {
    storage.setItem(
      workspaceSidebarCollapsedPreferenceKey,
      collapsed ? '1' : '0',
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
