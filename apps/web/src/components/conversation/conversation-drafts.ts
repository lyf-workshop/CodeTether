interface DraftStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** UI-only, unsubmitted text scoped to an exact conversation. */
export function createConversationDraftStore(
  getStorage: () => DraftStorage | undefined = optionalLocalStorage,
  saveDelayMs = 500,
) {
  const memory = new Map<string, string>()
  const pending = new Map<string, ReturnType<typeof setTimeout>>()
  const unsynced = new Set<string>()
  const key = (conversationId: string) => `composer-draft-${conversationId}`

  const cancelPending = (conversationId: string) => {
    const timer = pending.get(conversationId)
    if (timer !== undefined) clearTimeout(timer)
    pending.delete(conversationId)
  }

  const clear = (conversationId: string) => {
    cancelPending(conversationId)
    // Retain an empty tombstone if storage is disabled or removal fails, so a
    // stale stored prompt cannot reappear in this application session.
    memory.set(conversationId, '')
    try {
      const storage = getStorage()
      if (storage === undefined) {
        unsynced.add(conversationId)
        return
      }
      storage.removeItem(key(conversationId))
      unsynced.delete(conversationId)
    } catch {
      // Optional storage must not prevent editing or clearing a draft.
      unsynced.add(conversationId)
    }
  }

  return {
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
      pending.set(
        conversationId,
        setTimeout(() => {
          pending.delete(conversationId)
          if (memory.get(conversationId) !== value) return
          try {
            const storage = getStorage()
            if (storage === undefined) return
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
