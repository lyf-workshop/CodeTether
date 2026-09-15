import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { useNavigate } from '@tanstack/react-router'

import {
  Dialog,
  DialogContent,
  DialogTitle,
  TooltipProvider,
} from '@codetether/ui'
import type { ConversationSummary, ProjectRecord } from '@codetether/protocol'

import { NewConversationDialog } from '../conversations/new-conversation-dialog'
import { AddProjectDialog } from '../projects/add-project-dialog'
import { MainContent } from './main-content'
import { WorkspaceSidebar } from './workspace-sidebar'
import {
  readWorkspaceSidebarCollapsed,
  readWorkspaceSidebarWidth,
  writeWorkspaceSidebarCollapsed,
  writeWorkspaceSidebarWidth,
} from './workspace-sidebar-layout'
import { WorkspaceSidebarResizeHandle } from './workspace-sidebar-resize-handle'
import { TopBar, type TopBarBreadcrumb } from './top-bar'
import { DesktopNotificationSettings } from '../settings'

interface AppShellProps {
  children: ReactNode
  breadcrumbs?: readonly TopBarBreadcrumb[]
  currentPage: string
  currentPath: string
  currentConversation?: ConversationSummary
  currentProject?: ProjectRecord
  inboxAttentionCount?: number
}

export function AppShell({
  breadcrumbs,
  children,
  currentPage,
  currentPath,
  currentConversation,
  currentProject,
  inboxAttentionCount = 0,
}: AppShellProps) {
  const navigate = useNavigate()
  const newConversationTriggerRef = useRef<HTMLButtonElement>(null)
  const [newConversationProject, setNewConversationProject] = useState<
    ProjectRecord | undefined
  >()
  const [globalDialog, setGlobalDialog] = useState<
    'add-project' | 'new-conversation' | null
  >(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    readWorkspaceSidebarCollapsed,
  )
  const [sidebarWidth, setSidebarWidth] = useState(readWorkspaceSidebarWidth)
  const [sidebarResizing, setSidebarResizing] = useState(false)

  useEffect(() => {
    writeWorkspaceSidebarWidth(optionalLocalStorage(), sidebarWidth)
  }, [sidebarWidth])

  useEffect(() => {
    writeWorkspaceSidebarCollapsed(optionalLocalStorage(), sidebarCollapsed)
  }, [sidebarCollapsed])

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
      <div
        data-sidebar-collapsed={sidebarCollapsed || undefined}
        data-sidebar-resizing={sidebarResizing || undefined}
        className="grid h-dvh grid-rows-[var(--layout-topbar-height)_minmax(0,1fr)] overflow-hidden bg-background text-text-primary"
        style={
          {
            '--layout-sidebar-width': `${sidebarWidth}px`,
            '--layout-sidebar-current-width': sidebarCollapsed
              ? '0px'
              : `${sidebarWidth}px`,
          } as CSSProperties
        }
      >
        <a
          href="#main-content"
          className="fixed top-2 left-2 z-50 -translate-y-20 rounded-sm bg-primary-action px-3 py-2 text-sm font-medium text-primary-foreground transition-transform focus-visible:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          跳到主要内容
        </a>
        <TopBar
          breadcrumbs={breadcrumbs}
          currentPage={currentPage}
          sidebarCollapsed={sidebarCollapsed}
          onRestoreSidebar={() => setSidebarCollapsed(false)}
          onDoctor={() =>
            void navigate({
              to: '/doctor',
              search:
                currentProject === undefined
                  ? {}
                  : { projectId: currentProject.projectId },
            })
          }
        />
        <div className="grid min-h-0 overflow-hidden grid-cols-[var(--layout-sidebar-current-width)_minmax(0,1fr)]">
          <div className="relative min-h-0 min-w-0">
            {sidebarCollapsed ? null : (
              <>
                <WorkspaceSidebar
                  currentPath={currentPath}
                  currentProjectId={currentProject?.projectId}
                  currentConversationId={conversationIdFromPath(currentPath)}
                  currentConversation={currentConversation}
                  inboxAttentionCount={inboxAttentionCount}
                  onCollapse={() => setSidebarCollapsed(true)}
                  onNewConversation={(project, trigger) => {
                    newConversationTriggerRef.current = trigger
                    setNewConversationProject(project)
                    setGlobalDialog('new-conversation')
                  }}
                  onSettingsClick={(event) => {
                    event.preventDefault()
                    setSettingsOpen(true)
                  }}
                />
                <WorkspaceSidebarResizeHandle
                  resizing={sidebarResizing}
                  setResizing={setSidebarResizing}
                  setWidth={setSidebarWidth}
                  width={sidebarWidth}
                />
              </>
            )}
          </div>
          <MainContent>{children}</MainContent>
        </div>
        <NewConversationDialog
          currentProject={newConversationProject}
          open={globalDialog === 'new-conversation'}
          onAddProject={() => setGlobalDialog('add-project')}
          onOpenChange={(open) => {
            setGlobalDialog(open ? 'new-conversation' : null)
            if (!open) setNewConversationProject(undefined)
          }}
          returnFocusRef={newConversationTriggerRef}
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

function conversationIdFromPath(pathname: string): string | undefined {
  const match = /^\/conversations\/([^/]+)\/?$/u.exec(pathname)
  if (match?.[1] === undefined) return undefined
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

function optionalLocalStorage(): Storage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}
