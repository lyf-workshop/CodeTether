interface DraftStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** UI-only, unsubmitted text: scoped to this browser tab, never durable history. */
export function createConversationDraftStore(
  getStorage: () => DraftStorage | undefined = optionalSessionStorage,
) {
  const memory = new Map<string, string>()
  const key = (conversationId: string) =>
    `codetether.conversation-draft.${conversationId}`

  const clear = (conversationId: string) => {
    // Retain an empty tombstone if storage is disabled or removal fails, so a
    // stale stored prompt cannot reappear in this mounted application session.
    memory.set(conversationId, '')
    try {
      getStorage()?.removeItem(key(conversationId))
    } catch {
      // Optional storage must not prevent editing or clearing a draft.
    }
  }

  return {
    read(conversationId: string): string {
      const cached = memory.get(conversationId)
      if (cached !== undefined) return cached
      let value = ''
      try {
        value = getStorage()?.getItem(key(conversationId)) ?? ''
      } catch {
        // Embedded/private windows can deny session storage entirely.
      }
      memory.set(conversationId, value)
      return value
    },
    write(conversationId: string, value: string): void {
      if (value === '') {
        clear(conversationId)
        return
      }
      memory.set(conversationId, value)
      try {
        getStorage()?.setItem(key(conversationId), value)
      } catch {
        // Keep the in-memory draft when storage is disabled or full.
      }
    },
    clear,
  }
}

function optionalSessionStorage(): DraftStorage | undefined {
  return typeof window === 'undefined' ? undefined : window.sessionStorage
}

export const conversationDrafts = createConversationDraftStore()
