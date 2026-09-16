import { createContext, useContext } from 'react'

export const WorkspaceChromeTargetContext =
  createContext<HTMLDivElement | null>(null)

export function useWorkspaceChromeTarget(): HTMLDivElement | null {
  return useContext(WorkspaceChromeTargetContext)
}
