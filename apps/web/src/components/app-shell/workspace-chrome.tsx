import { createContext, useContext, type ReactNode } from 'react'

const WorkspaceChromeTargetContext = createContext<HTMLDivElement | null>(null)

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

export function useWorkspaceChromeTarget(): HTMLDivElement | null {
  return useContext(WorkspaceChromeTargetContext)
}
