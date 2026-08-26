import { useCallback, useMemo, useState, type ReactNode } from 'react'

import { inboxMock, type InboxItemMock } from '../mocks/inbox'
import {
  DemoStateContext,
  type DemoStateContextValue,
} from './demo-state-context'

interface DemoStateProviderProps {
  children: ReactNode
}

export function DemoStateProvider({ children }: DemoStateProviderProps) {
  const [inboxItems, setInboxItems] = useState<readonly InboxItemMock[]>(
    inboxMock.items,
  )

  const markInboxItemRead = useCallback((itemId: string) => {
    setInboxItems((currentItems) =>
      currentItems.map((item) =>
        item.id === itemId ? { ...item, unread: false } : item,
      ),
    )
  }, [])

  const markAllInboxItemsRead = useCallback(() => {
    setInboxItems((currentItems) =>
      currentItems.map((item) => ({ ...item, unread: false })),
    )
  }, [])

  const resolveInboxItem = useCallback((itemId: string) => {
    setInboxItems((currentItems) =>
      currentItems.filter((item) => item.id !== itemId),
    )
  }, [])

  const value = useMemo<DemoStateContextValue>(
    () => ({
      inboxAttentionCount: inboxItems.length,
      inboxItems,
      markAllInboxItemsRead,
      markInboxItemRead,
      resolveInboxItem,
    }),
    [inboxItems, markAllInboxItemsRead, markInboxItemRead, resolveInboxItem],
  )

  return (
    <DemoStateContext.Provider value={value}>
      {children}
    </DemoStateContext.Provider>
  )
}
