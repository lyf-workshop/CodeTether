import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'

import {
  Dialog,
  DialogContent,
  DialogTitle,
  TooltipProvider,
} from '@codetether/ui'
import type { ProjectRecord } from '@codetether/protocol'

import { NewConversationDialog } from '../conversations/new-conversation-dialog'
import { AddProjectDialog } from '../projects/add-project-dialog'
import { MainContent } from './main-content'
import { PrimarySidebar } from './primary-sidebar'
import { TopBar, type TopBarBreadcrumb } from './top-bar'
import { DesktopNotificationSettings } from '../settings'

interface AppShellProps {
  children: ReactNode
  breadcrumbs?: readonly TopBarBreadcrumb[]
  currentPage: string
  currentPath: string
  currentProject?: ProjectRecord
  inboxAttentionCount?: number
}

export function AppShell({
  breadcrumbs,
  children,
  currentPage,
  currentPath,
  currentProject,
  inboxAttentionCount = 0,
}: AppShellProps) {
  const navigate = useNavigate()
  const newConversationButtonRef = useRef<HTMLButtonElement>(null)
  const [globalDialog, setGlobalDialog] = useState<
    'add-project' | 'new-conversation' | null
  >(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault()
        setSettingsOpen(true)
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

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
          onNewConversation={() => setGlobalDialog('new-conversation')}
          onHelp={() =>
            void navigate({
              to: '/doctor',
              search:
                currentProject === undefined
                  ? {}
                  : { projectId: currentProject.projectId },
            })
          }
        />
        <div className="grid min-h-0 grid-cols-[var(--layout-sidebar-current-width)_minmax(0,1fr)]">
          <PrimarySidebar
            currentPath={currentPath}
            inboxAttentionCount={inboxAttentionCount}
            onSettingsClick={(event) => {
              event.preventDefault()
              setSettingsOpen(true)
            }}
          />
          <MainContent>{children}</MainContent>
        </div>
        <NewConversationDialog
          currentProject={currentProject}
          open={globalDialog === 'new-conversation'}
          onAddProject={() => setGlobalDialog('add-project')}
          onOpenChange={(open) =>
            setGlobalDialog(open ? 'new-conversation' : null)
          }
          returnFocusRef={newConversationButtonRef}
        />
        <AddProjectDialog
          open={globalDialog === 'add-project'}
          onOpenChange={(open) =>
            setGlobalDialog(open ? 'add-project' : 'new-conversation')
          }
          onProjectCreated={() => setGlobalDialog('new-conversation')}
        />
        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogContent
            aria-describedby={undefined}
            className="max-w-4xl overflow-y-auto p-0"
          >
            <DialogTitle className="sr-only">设置</DialogTitle>
            <DesktopNotificationSettings />
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  )
}

export type { AppShellProps }
