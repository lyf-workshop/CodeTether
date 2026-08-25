import type { ReactNode } from 'react'

import { TooltipProvider } from '@codetether/ui'

import { MainContent } from './main-content'
import { PrimarySidebar } from './primary-sidebar'
import { TopBar } from './top-bar'

interface AppShellProps {
  children: ReactNode
  currentPage: string
  currentPath: string
  currentProject?: string
}

export function AppShell({
  children,
  currentPage,
  currentPath,
  currentProject = 'MyProject',
}: AppShellProps) {
  return (
    <TooltipProvider>
      <div className="grid h-dvh grid-rows-[var(--layout-topbar-height)_minmax(0,1fr)] overflow-hidden bg-background text-text-primary">
        <a
          href="#main-content"
          className="fixed top-2 left-2 z-50 -translate-y-20 rounded-sm bg-primary-action px-3 py-2 text-sm font-medium text-primary-foreground transition-transform focus-visible:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          跳到主要内容
        </a>
        <TopBar currentPage={currentPage} currentProject={currentProject} />
        <div className="grid min-h-0 grid-cols-[var(--layout-sidebar-current-width)_minmax(0,1fr)]">
          <PrimarySidebar currentPath={currentPath} />
          <MainContent>{children}</MainContent>
        </div>
      </div>
    </TooltipProvider>
  )
}

export type { AppShellProps }
