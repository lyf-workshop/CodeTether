import type { AttentionType } from '@codetether/protocol'

import {
  defaultDesktopNotificationPreferences,
  isAttentionNotificationEnabled,
  type DesktopNotificationPreferences,
} from '../notifications/desktop-notification-model.js'

export {
  defaultDesktopNotificationPreferences,
  type DesktopNotificationPreferences,
} from '../notifications/desktop-notification-model.js'

export interface NotificationPreferenceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const desktopNotificationPreferenceStorageKey =
  'codetether.desktop.notification-preferences.v1'

const notificationTypes = [
  'approval',
  'completed_review',
  'failed',
] as const satisfies readonly AttentionType[]

interface StoredDesktopNotificationPreferences {
  readonly version: 1
  readonly enabled: DesktopNotificationPreferences
}

/**
 * Reads the Desktop application's small preference record. Missing, partial,
 * malformed, or inaccessible storage safely falls back to enabled defaults.
 */
export function readDesktopNotificationPreferences(
  storage: NotificationPreferenceStorage | undefined,
): DesktopNotificationPreferences {
  if (storage === undefined) return defaultDesktopNotificationPreferences

  try {
    const raw = storage.getItem(desktopNotificationPreferenceStorageKey)
    if (raw === null) return defaultDesktopNotificationPreferences
    return parseStoredPreferences(JSON.parse(raw) as unknown)
  } catch {
    return defaultDesktopNotificationPreferences
  }
}

/** Writes the complete versioned record synchronously so a successful toggle is durable. */
export function persistDesktopNotificationPreferences(
  storage: NotificationPreferenceStorage | undefined,
  preferences: DesktopNotificationPreferences,
): boolean {
  if (storage === undefined) return false

  const stored: StoredDesktopNotificationPreferences = {
    version: 1,
    enabled: preferences,
  }
  try {
    storage.setItem(
      desktopNotificationPreferenceStorageKey,
      JSON.stringify(stored),
    )
    return true
  } catch {
    return false
  }
}

export function updateDesktopNotificationPreference(
  preferences: DesktopNotificationPreferences,
  type: AttentionType,
  enabled: boolean,
): DesktopNotificationPreferences {
  return { ...preferences, [type]: enabled }
}

export function isDesktopNotificationEnabled(
  preferences: DesktopNotificationPreferences,
  type: AttentionType,
): boolean {
  return isAttentionNotificationEnabled(type, preferences)
}

/** Resolves WebView storage without throwing in restricted or non-DOM runtimes. */
export function resolveNotificationPreferenceStorage(
  scope: unknown = globalThis,
): NotificationPreferenceStorage | undefined {
  try {
    if (typeof scope !== 'object' || scope === null) return undefined
    if (!('localStorage' in scope)) return undefined
    const storage = scope.localStorage
    if (
      typeof storage !== 'object' ||
      storage === null ||
      !('getItem' in storage) ||
      typeof storage.getItem !== 'function' ||
      !('setItem' in storage) ||
      typeof storage.setItem !== 'function'
    ) {
      return undefined
    }
    return storage as NotificationPreferenceStorage
  } catch {
    return undefined
  }
}

function parseStoredPreferences(
  value: unknown,
): DesktopNotificationPreferences {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.enabled)) {
    return defaultDesktopNotificationPreferences
  }

  const enabled = value.enabled
  return Object.fromEntries(
    notificationTypes.map((type) => [
      type,
      typeof enabled[type] === 'boolean'
        ? enabled[type]
        : defaultDesktopNotificationPreferences[type],
    ]),
  ) as unknown as DesktopNotificationPreferences
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
