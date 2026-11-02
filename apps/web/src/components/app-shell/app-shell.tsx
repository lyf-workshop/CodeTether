import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { TooltipProvider } from '@codetether/ui'
import type {
  ConversationSummary,
  MachineId,
  ProjectId,
  ProjectRecord,
} from '@codetether/protocol'

import { NewConversationDialog } from '../conversations/new-conversation-dialog'
import type { NewConversationLaunchContext } from '../conversations/new-conversation-selection'
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
import { CommandPalette } from './command-palette'
import { MobileWorkspaceNavigation } from './mobile-workspace-navigation'
import {
  workspaceNavigationBlocked,
  workspaceShortcut,
} from './workspace-shortcuts'

interface AppShellProps {
  children: ReactNode
  breadcrumbs?: readonly TopBarBreadcrumb[]
  currentPage: string
  currentPath: string
  currentConversation?: ConversationSummary
  currentProject?: ProjectRecord
  currentProjectId?: ProjectId
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
  currentProjectId: requestedProjectId,
  currentMachineId,
  inboxAttentionCount,
}: AppShellProps) {
  const navigate = useNavigate()
  const newConversationTriggerRef = useRef<HTMLElement>(null)
  const commandPaletteTriggerRef = useRef<HTMLElement>(null)
  const [newConversationContext, setNewConversationContext] =
    useState<NewConversationLaunchContext>()
  const [addProjectMachineId, setAddProjectMachineId] = useState<
    MachineId | undefined
  >()
  const [returnToConversation, setReturnToConversation] = useState(false)
  type GlobalDialog =
    'add-project' | 'new-conversation' | 'command-palette' | null
  const [globalDialog, setGlobalDialogState] = useState<GlobalDialog>(null)
  const globalDialogRef = useRef<GlobalDialog>(null)
  const setGlobalDialog = useCallback((nextDialog: GlobalDialog) => {
    globalDialogRef.current = nextDialog
    setGlobalDialogState(nextDialog)
  }, [])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    readWorkspaceSidebarCollapsed,
  )
  const [sidebarResizing, setSidebarResizing] = useState(false)
  const [workspaceChromeTarget, setWorkspaceChromeTarget] =
    useState<HTMLDivElement | null>(null)
  const sidebarLayout = useWorkspaceSidebarWidth()
  const currentProjectId =
    currentConversation?.projectId ??
    requestedProjectId ??
    currentProject?.projectId

  useEffect(() => {
    writeWorkspaceSidebarCollapsed(optionalLocalStorage(), sidebarCollapsed)
  }, [sidebarCollapsed])
  function openPalette(trigger?: HTMLElement) {
    if (
      globalDialogRef.current !== null ||
      document.querySelector('[role="dialog"][data-state="open"]')
    )
      return
    commandPaletteTriggerRef.current =
      trigger ??
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null)
    setGlobalDialog('command-palette')
  }

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      const shortcut = workspaceShortcut(event)
      if (shortcut === undefined) return
      event.preventDefault()
      if (
        shortcut === 'palette' &&
        globalDialogRef.current === 'command-palette'
      ) {
        setGlobalDialog(null)
        return
      }
      const modalBlocksNavigation = workspaceNavigationBlocked(
        globalDialogRef.current,
        document.querySelector('[role="dialog"][data-state="open"]') !== null,
      )
      if (globalDialog !== null || modalBlocksNavigation) return
      if (shortcut === 'toggle-sidebar') {
        setSidebarCollapsed((current) => !current)
        return
      }
      if (event.key.toLowerCase() === 'n') {
        newConversationTriggerRef.current =
          document.activeElement instanceof HTMLElement &&
          document.activeElement !== document.body
            ? document.activeElement
            : document.querySelector<HTMLButtonElement>(
                '[data-slot="workspace-new-conversation"]',
              )
        setNewConversationContext({
          kind: 'preselected',
          ...(currentProjectId === undefined
            ? {}
            : { projectId: currentProjectId }),
          ...(currentMachineId === undefined
            ? {}
            : { machineId: currentMachineId }),
        })
        setGlobalDialog('new-conversation')
      } else if (shortcut === 'palette') {
        commandPaletteTriggerRef.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null
        setGlobalDialog('command-palette')
      } else {
        void navigate({
          to: '/settings/$section',
          params: { section: 'appearance' },
        })
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [
    currentMachineId,
    currentProjectId,
    globalDialog,
    navigate,
    setGlobalDialog,
  ])

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
                currentProjectId={currentProjectId}
                currentMachineId={currentMachineId}
                currentConversationId={conversationIdFromPath(currentPath)}
                currentConversation={currentConversation}
                inboxAttentionCount={inboxAttentionCount}
                onSearch={(event) => openPalette(event.currentTarget)}
                onAddProject={(machineId) => {
                  commandPaletteTriggerRef.current =
                    document.activeElement instanceof HTMLElement
                      ? document.activeElement
                      : null
                  setAddProjectMachineId(machineId)
                  setReturnToConversation(false)
                  setGlobalDialog('add-project')
                }}
                onNewConversation={(project, trigger, machineId, mode) => {
                  newConversationTriggerRef.current = trigger
                  const contextProjectId =
                    project?.projectId ?? currentProjectId
                  setNewConversationContext(
                    project !== undefined && mode !== 'preselected'
                      ? {
                          kind: 'fixed-project',
                          projectId: project.projectId,
                          ...(machineId === undefined ? {} : { machineId }),
                        }
                      : {
                          kind: 'preselected',
                          ...(contextProjectId === undefined
                            ? {}
                            : { projectId: contextProjectId }),
                          ...(machineId === undefined ? {} : { machineId }),
                        },
                  )
                  setGlobalDialog('new-conversation')
                }}
                onSettingsClick={(event) => {
                  event.preventDefault()
                  if (
                    globalDialogRef.current !== null ||
                    document.querySelector('[role="dialog"][data-state="open"]')
                  )
                    return
                  void navigate({
                    to: '/settings/$section',
                    params: { section: 'appearance' },
                  })
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
            onSearch={(event) => openPalette(event.currentTarget)}
          />
          <WorkspaceChromeTargetProvider target={workspaceChromeTarget}>
            <MainContent>{children}</MainContent>
          </WorkspaceChromeTargetProvider>
        </div>
        <MobileWorkspaceNavigation
          currentPath={currentPath}
          attentionCount={inboxAttentionCount}
        />
        <CommandPalette
          open={globalDialog === 'command-palette'}
          onOpenChange={(open) =>
            setGlobalDialog(open ? 'command-palette' : null)
          }
          returnFocusRef={commandPaletteTriggerRef}
          onNewConversation={() => {
            newConversationTriggerRef.current = commandPaletteTriggerRef.current
            setNewConversationContext({
              kind: 'preselected',
              ...(currentProjectId === undefined
                ? {}
                : { projectId: currentProjectId }),
              ...(currentMachineId === undefined
                ? {}
                : { machineId: currentMachineId }),
            })
            setGlobalDialog('new-conversation')
          }}
          onAddProject={() => {
            setAddProjectMachineId(currentMachineId)
            setReturnToConversation(false)
            setGlobalDialog('add-project')
          }}
          onAddDevice={() => {
            void navigate({ to: '/add' })
          }}
          onSettings={() => {
            void navigate({
              to: '/settings/$section',
              params: { section: 'appearance' },
            })
          }}
        />
        <NewConversationDialog
          key={
            newConversationContext === undefined
              ? 'global'
              : [
                  newConversationContext.kind,
                  newConversationContext.projectId,
                  newConversationContext.machineId,
                ].join(':')
          }
          launchContext={newConversationContext}
          open={globalDialog === 'new-conversation'}
          onAddProject={(machineId) => {
            setAddProjectMachineId(
              machineId ??
                newConversationContext?.machineId ??
                currentMachineId,
            )
            setReturnToConversation(true)
            setGlobalDialog('add-project')
          }}
          onOpenChange={(open) => {
            setGlobalDialog(open ? 'new-conversation' : null)
            if (!open) {
              setNewConversationContext(undefined)
            }
          }}
          returnFocusRef={newConversationTriggerRef}
        />
        <AddProjectDialog
          returnFocusRef={
            returnToConversation ? undefined : commandPaletteTriggerRef
          }
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
              setNewConversationContext({
                kind: 'preselected',
                projectId: project.projectId,
                ...(machineId === undefined ? {} : { machineId }),
              })
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
