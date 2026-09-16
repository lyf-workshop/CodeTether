import type { ReactNode } from 'react'

import { WorkspaceChromeTargetContext } from './workspace-chrome-context'

export function WorkspaceChromeTargetProvider({
  children,
  target,
}: {
  children: ReactNode
  target: HTMLDivElement | null
}) {
  return (
    <WorkspaceChromeTargetContext.Provider value={target}>
      {children}
    </WorkspaceChromeTargetContext.Provider>
  )
}
