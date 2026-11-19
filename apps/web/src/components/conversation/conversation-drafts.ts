interface DraftStorage {
  readonly length?: number
  key?(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const draftPrefix = 'composer-draft-'
const draftTimestampKey = (conversationId: string) =>
  'composer-drafts-updated:' + conversationId
const draftLifetimeMs = 30 * 24 * 60 * 60 * 1000

/** UI-only, unsubmitted text scoped to an exact conversation. */
export function createConversationDraftStore(
  getStorage: () => DraftStorage | undefined = optionalLocalStorage,
  saveDelayMs = 500,
) {
  const memory = new Map<string, string>()
  const pending = new Map<string, ReturnType<typeof setTimeout>>()
  const unsynced = new Set<string>()
  const key = (conversationId: string) => draftPrefix + conversationId

  const cancelPending = (conversationId: string) => {
    const timer = pending.get(conversationId)
    if (timer !== undefined) clearTimeout(timer)
    pending.delete(conversationId)
  }

  const clear = (conversationId: string) => {
    cancelPending(conversationId)
    memory.delete(conversationId)
    // Keep the unsynced marker when removal fails so stale stored text stays hidden.
    try {
      const storage = getStorage()
      if (storage === undefined) {
        unsynced.add(conversationId)
        return
      }
      storage.removeItem(key(conversationId))
      storage.removeItem(draftTimestampKey(conversationId))
      unsynced.delete(conversationId)
    } catch {
      // Optional storage must not prevent editing or clearing a draft.
      unsynced.add(conversationId)
    }
  }

  return {
    pruneExpired(now = Date.now()): void {
      try {
        const storage = getStorage()
        if (storage?.length === undefined || storage.key === undefined) return
        const keys = Array.from({ length: storage.length }, (_, index) =>
          storage.key?.(index),
        )
        for (const storedKey of keys) {
          if (storedKey == null || !storedKey.startsWith(draftPrefix)) continue
          const conversationId = storedKey.slice(draftPrefix.length)
          if (pending.has(conversationId) || unsynced.has(conversationId))
            continue
          const timestampKey = draftTimestampKey(conversationId)
          const storedTimestamp = storage.getItem(timestampKey)
          const timestamp = Number(storedTimestamp)
          if (!storedTimestamp || !Number.isFinite(timestamp)) {
            // Old installations stored text alone. Start aging it today.
            storage.setItem(timestampKey, String(now))
          } else if (now - timestamp > draftLifetimeMs) {
            clear(conversationId)
          }
        }
      } catch {
        // Storage is optional during startup as well as during editing.
      }
    },
    read(conversationId: string): string {
      const cached = memory.get(conversationId)
      // A local unsaved edit or failed storage operation owns the current text.
      if (pending.has(conversationId) || unsynced.has(conversationId)) {
        return cached ?? ''
      }
      try {
        const storage = getStorage()
        if (storage === undefined) return cached ?? ''
        const value = storage.getItem(key(conversationId)) ?? ''
        memory.set(conversationId, value)
        return value
      } catch {
        // Embedded/private windows can deny local storage entirely.
        return cached ?? ''
      }
    },
    write(conversationId: string, value: string): void {
      if (value === '') {
        clear(conversationId)
        return
      }
      memory.set(conversationId, value)
      unsynced.add(conversationId)
      cancelPending(conversationId)
      const editedAt = Date.now()
      pending.set(
        conversationId,
        setTimeout(() => {
          pending.delete(conversationId)
          if (memory.get(conversationId) !== value) return
          try {
            const storage = getStorage()
            if (storage === undefined) return
            storage.setItem(draftTimestampKey(conversationId), String(editedAt))
            storage.setItem(key(conversationId), value)
            unsynced.delete(conversationId)
          } catch {
            // Keep the in-memory draft when storage is disabled or full.
          }
        }, saveDelayMs),
      )
    },
    clear,
  }
}

function optionalLocalStorage(): DraftStorage | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage
}

export const conversationDrafts = createConversationDraftStore()
