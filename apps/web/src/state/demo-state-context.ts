import { createContext, useContext } from 'react'

import type { InboxItemMock } from '../mocks/inbox'

export interface DemoStateContextValue {
  inboxAttentionCount: number
  inboxItems: readonly InboxItemMock[]
  markAllInboxItemsRead: () => void
  markInboxItemRead: (itemId: string) => void
  resolveInboxItem: (itemId: string) => void
}

export const DemoStateContext = createContext<DemoStateContextValue | null>(
  null,
)

export function useDemoState() {
  const value = useContext(DemoStateContext)

  if (!value) {
    throw new Error('useDemoState must be used within DemoStateProvider')
  }

  return value
}
