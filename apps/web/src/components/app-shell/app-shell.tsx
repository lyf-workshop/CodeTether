import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  TooltipProvider,
} from '@codetether/ui'
import type {
  ConversationSummary,
  MachineId,
  ProjectRecord,
} from '@codetether/protocol'

import { NewConversationDialog } from '../conversations/new-conversation-dialog'
import { AddProjectDialog } from '../projects/add-project-dialog'
import { MainContent } from './main-content'
import { WorkspaceSidebar } from './workspace-sidebar'
import {
  readWorkspaceSidebarCollapsed,
  writeWorkspaceSidebarCollapsed,
} from './workspace-sidebar-layout'
import { useWorkspaceSidebarWidth } from './use-workspace-sidebar-width'
import { WorkspaceSidebarResizeHandle } from './workspace-sidebar-resize-handle'
import { TopBar, type TopBarBreadcrumb } from './top-bar'
import { WorkspaceChromeTargetProvider } from './workspace-chrome'
import { DesktopNotificationSettings } from '../settings'

interface AppShellProps {
  children: ReactNode
  breadcrumbs?: readonly TopBarBreadcrumb[]
  currentPage: string
  currentPath: string
  currentConversation?: ConversationSummary
  currentProject?: ProjectRecord
  currentMachineId?: MachineId
  inboxAttentionCount?: number
}

export function AppShell({
  breadcrumbs,
  children,
  currentPage,
  currentPath,
  currentConversation,
  currentProject,
  currentMachineId,
  inboxAttentionCount = 0,
}: AppShellProps) {
  const navigate = useNavigate()
  const newConversationTriggerRef = useRef<HTMLButtonElement>(null)
  const [newConversationProject, setNewConversationProject] = useState<
    ProjectRecord | undefined
  >()
  const [newConversationMachineId, setNewConversationMachineId] = useState<
    MachineId | undefined
  >()
  const [addProjectMachineId, setAddProjectMachineId] = useState<
    MachineId | undefined
  >()
  const [returnToConversation, setReturnToConversation] = useState(false)
  const [globalDialog, setGlobalDialog] = useState<
    'add-project' | 'new-conversation' | null
  >(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    readWorkspaceSidebarCollapsed,
  )
  const [sidebarResizing, setSidebarResizing] = useState(false)
  const [workspaceChromeTarget, setWorkspaceChromeTarget] =
    useState<HTMLDivElement | null>(null)
  const sidebarLayout = useWorkspaceSidebarWidth()

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
        data-slot="app-shell"
        data-workspace-layout={sidebarLayout.layoutId}
        data-sidebar-collapsed={sidebarCollapsed || undefined}
        data-sidebar-resizing={sidebarResizing || undefined}
        className="ct-workspace-shell grid h-dvh grid-cols-[var(--layout-sidebar-current-width)_minmax(0,1fr)] overflow-hidden bg-background text-text-primary"
      >
        <a
          href="#main-content"
          className="fixed top-2 left-2 z-50 -translate-y-20 rounded-sm bg-primary-action px-3 py-2 text-sm font-medium text-primary-foreground transition-transform focus-visible:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          跳到主要内容
        </a>
        <div
          data-slot="workspace-sidebar-column"
          className="relative min-h-0 min-w-0"
        >
          {sidebarCollapsed ? null : (
            <>
              <WorkspaceSidebar
                currentPath={currentPath}
                currentProjectId={currentProject?.projectId}
                currentMachineId={currentMachineId}
                currentConversationId={conversationIdFromPath(currentPath)}
                currentConversation={currentConversation}
                inboxAttentionCount={inboxAttentionCount}
                onAddProject={(machineId) => {
                  setAddProjectMachineId(machineId)
                  setReturnToConversation(false)
                  setGlobalDialog('add-project')
                }}
                onNewConversation={(project, trigger, machineId) => {
                  newConversationTriggerRef.current = trigger
                  setNewConversationProject(project)
                  setNewConversationMachineId(machineId)
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
                setWidth={sidebarLayout.setWidth}
                width={sidebarLayout.width}
              />
            </>
          )}
        </div>
        <div
          data-slot="workspace-content-column"
          className="grid min-h-0 min-w-0 grid-rows-[var(--layout-topbar-height)_minmax(0,1fr)] overflow-hidden"
        >
          <TopBar
            breadcrumbs={breadcrumbs}
            currentPage={currentPage}
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
            workspaceActionsRef={setWorkspaceChromeTarget}
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
          <WorkspaceChromeTargetProvider target={workspaceChromeTarget}>
            <MainContent>{children}</MainContent>
          </WorkspaceChromeTargetProvider>
        </div>
        <NewConversationDialog
          currentProject={newConversationProject}
          currentMachineId={newConversationMachineId}
          open={globalDialog === 'new-conversation'}
          onAddProject={() => {
            setAddProjectMachineId(newConversationMachineId ?? currentMachineId)
            setReturnToConversation(true)
            setGlobalDialog('add-project')
          }}
          onOpenChange={(open) => {
            setGlobalDialog(open ? 'new-conversation' : null)
            if (!open) {
              setNewConversationProject(undefined)
              setNewConversationMachineId(undefined)
            }
          }}
          returnFocusRef={newConversationTriggerRef}
        />
        <AddProjectDialog
          fixedMachineId={addProjectMachineId}
          open={globalDialog === 'add-project'}
          onOpenChange={(open) =>
            setGlobalDialog(
              open
                ? 'add-project'
                : returnToConversation
                  ? 'new-conversation'
                  : null,
            )
          }
          onProjectCreated={async (project, _created, machineId) => {
            if (returnToConversation) {
              setNewConversationProject(project)
              setNewConversationMachineId(machineId)
              setGlobalDialog('new-conversation')
            } else {
              setGlobalDialog(null)
              await navigate({
                to: '/projects/$projectId',
                params: { projectId: project.projectId },
                search: machineId === undefined ? {} : { machineId },
              })
            }
          }}
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
  const match = /^\/(?:conversations|c)\/([^/]+)\/?$/u.exec(pathname)
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
