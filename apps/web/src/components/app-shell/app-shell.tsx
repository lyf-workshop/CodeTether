import { useRef, useState, type ReactNode } from 'react'

import { TooltipProvider } from '@codetether/ui'
import type { ProjectRecord } from '@codetether/protocol'

import { NewConversationDialog } from '../conversations/new-conversation-dialog'
import { MainContent } from './main-content'
import { PrimarySidebar } from './primary-sidebar'
import { TopBar, type TopBarBreadcrumb } from './top-bar'

interface AppShellProps {
  children: ReactNode
  breadcrumbs?: readonly TopBarBreadcrumb[]
  currentPage: string
  currentPath: string
  currentProject?: ProjectRecord
  codexAvailable?: boolean
  inboxAttentionCount?: number
}

export function AppShell({
  breadcrumbs,
  children,
  currentPage,
  currentPath,
  currentProject,
  codexAvailable = false,
  inboxAttentionCount = 0,
}: AppShellProps) {
  const newConversationButtonRef = useRef<HTMLButtonElement>(null)
  const [newConversationOpen, setNewConversationOpen] = useState(false)

  return (
    <TooltipProvider>
      <div className="grid h-dvh grid-rows-[var(--layout-topbar-height)_minmax(0,1fr)] overflow-hidden bg-background text-text-primary">
        <a
          href="#main-content"
          className="fixed top-2 left-2 z-50 -translate-y-20 rounded-sm bg-primary-action px-3 py-2 text-sm font-medium text-primary-foreground transition-transform focus-visible:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          跳到主要内容
        </a>
        <TopBar
          breadcrumbs={breadcrumbs}
          currentPage={currentPage}
          newConversationButtonRef={newConversationButtonRef}
          onNewConversation={() => setNewConversationOpen(true)}
        />
        <div className="grid min-h-0 grid-cols-[var(--layout-sidebar-current-width)_minmax(0,1fr)]">
          <PrimarySidebar
            currentPath={currentPath}
            currentProject={currentProject}
            codexAvailable={codexAvailable}
            inboxAttentionCount={inboxAttentionCount}
          />
          <MainContent>{children}</MainContent>
        </div>
        <NewConversationDialog
          currentProject={currentProject}
          open={newConversationOpen}
          onOpenChange={setNewConversationOpen}
          returnFocusRef={newConversationButtonRef}
        />
      </div>
    </TooltipProvider>
  )
}

export type { AppShellProps }
