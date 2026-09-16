import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'

import { Dialog, DialogContent, DialogTitle, cn } from '@codetether/ui'
import type { MachineId, ProjectId, TurnId } from '@codetether/protocol'
import type { ConversationSummary } from '@codetether/protocol'

import type { ConversationControls } from './conversation-controls'
import type {
  ConversationConnectionIndicatorViewModel,
  ConversationExecutionBoundaryViewModel,
  ConversationProjectBoundaryViewModel,
  ConversationViewModel,
} from './conversation-view-model'
import { ConversationWorkspace } from './conversation-workspace'
import { InspectorPanel, type InspectorTab } from './inspector-panel'
import {
  createConversationInspectorState,
  selectConversationInspectorTab,
  setConversationInspectorOpen,
} from './conversation-inspector-state'
import {
  clampConversationInspectorWidth,
  readConversationInspectorWidth,
  writeConversationInspectorWidth,
} from './conversation-inspector-layout'
import { ConversationInspectorResizeHandle } from './conversation-inspector-resize-handle'
import { ConversationChromeActions } from './conversation-chrome-actions'
import { useWorkspaceChromeTarget } from '../app-shell/workspace-chrome-context'

export interface ConversationDetailPageProps {
  anchorRequestKey?: string
  viewModel: ConversationViewModel
  connectionIndicator?: ConversationConnectionIndicatorViewModel
  executionBoundary?: ConversationExecutionBoundaryViewModel
  projectBoundary?: ConversationProjectBoundaryViewModel
  initialInspectorTab?: InspectorTab
  machineId?: MachineId
  controls?: ConversationControls
  projectId?: ProjectId
  targetTurnId?: TurnId
  onArchived?: (conversation: ConversationSummary) => void
}

export function ConversationDetailPage({
  anchorRequestKey,
  viewModel,
  connectionIndicator,
  executionBoundary,
  projectBoundary,
  initialInspectorTab = 'files',
  machineId,
  controls,
  projectId,
  targetTurnId,
  onArchived,
}: ConversationDetailPageProps) {
  const [inspectorDialogLayout, setInspectorDialogLayout] = useState(
    usesInspectorDialogLayout,
  )
  const [inspector, setInspector] = useState(() =>
    createConversationInspectorState(
      initialInspectorTab,
      initialInspectorTab !== 'files' && usesInspectorDialogLayout(),
    ),
  )
  const [inspectorCollapsed, setInspectorCollapsed] = useState(
    readInspectorCollapsedPreference,
  )
  const [inspectorWidth, setInspectorWidth] = useState(
    readConversationInspectorWidth,
  )
  const [inspectorResizing, setInspectorResizing] = useState(false)
  const [workspaceWidth, setWorkspaceWidth] = useState<number | undefined>()
  const [selectedChangeId, setSelectedChangeId] = useState<string | undefined>(
    undefined,
  )
  const [changeNavigationRequest, setChangeNavigationRequest] = useState(0)
  const inspectorTriggerRef = useRef<HTMLButtonElement>(null)
  const pendingChangeNavigationRef = useRef<string | undefined>(undefined)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const workspaceChromeTarget = useWorkspaceChromeTarget()

  useEffect(() => {
    const mediaQuery = window.matchMedia(INSPECTOR_DIALOG_MEDIA_QUERY)
    const handleLayoutChange = (event: MediaQueryListEvent) => {
      setInspectorDialogLayout(event.matches)
      if (!event.matches) {
        setInspector((current) => setConversationInspectorOpen(current, false))
      }
    }

    mediaQuery.addEventListener('change', handleLayoutChange)
    return () => mediaQuery.removeEventListener('change', handleLayoutChange)
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(
        'codetether.conversation-inspector-collapsed',
        inspectorCollapsed ? '1' : '0',
      )
    } catch {
      // Storage is optional in embedded and private browser contexts.
    }
  }, [inspectorCollapsed])

  useEffect(() => {
    writeConversationInspectorWidth(optionalLocalStorage(), inspectorWidth)
  }, [inspectorWidth])

  useEffect(() => {
    const workspace = workspaceRef.current
    if (workspace === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setWorkspaceWidth(entry.contentRect.width)
    })
    observer.observe(workspace)
    return () => observer.disconnect()
  }, [])

  const resolvedInspectorWidth = clampConversationInspectorWidth(
    inspectorWidth,
    workspaceWidth,
  )
  const inspectorOpen = inspectorDialogLayout
    ? inspector.open
    : !inspectorCollapsed

  const commitChangeNavigation = (changeId: string) => {
    setSelectedChangeId(changeId)
    setChangeNavigationRequest((current) => current + 1)
  }

  const selectChange = (changeId: string) => {
    if (inspectorDialogLayout) {
      pendingChangeNavigationRef.current = changeId
      setInspector((current) => setConversationInspectorOpen(current, false))
      return
    }
    commitChangeNavigation(changeId)
  }

  const inspectorProps = {
    conversation: viewModel,
    changes: viewModel.changes,
    terminal: viewModel.terminal,
    context: viewModel.context,
    tab: inspector.tab,
    onTabChange: (tab: InspectorTab) =>
      setInspector((current) => selectConversationInspectorTab(current, tab)),
    onChangeSelect: selectChange,
    selectedChangeId,
  } as const

  return (
    <Dialog
      open={inspectorDialogLayout && inspector.open}
      onOpenChange={(open) =>
        setInspector((current) => setConversationInspectorOpen(current, open))
      }
    >
      <div
        ref={workspaceRef}
        data-inspector-resizing={inspectorResizing || undefined}
        className={cn(
          'relative grid h-full min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] bg-background',
          inspectorCollapsed
            ? 'min-[1440px]:grid-cols-[minmax(0,1fr)]'
            : 'min-[1440px]:grid-cols-[minmax(32rem,1fr)_var(--layout-conversation-inspector-width)]',
        )}
        style={
          {
            '--layout-conversation-inspector-width': `${resolvedInspectorWidth}px`,
          } as CSSProperties
        }
      >
        {workspaceChromeTarget === null
          ? null
          : createPortal(
              <ConversationChromeActions
                conversation={viewModel}
                capabilities={viewModel.capabilities}
                inspectorOpen={inspectorOpen}
                inspectorTriggerRef={inspectorTriggerRef}
                interruptController={controls?.interrupt}
                projectId={projectId}
                onArchived={onArchived}
                onToggleInspector={() => {
                  if (inspectorDialogLayout) {
                    setInspector((current) =>
                      setConversationInspectorOpen(current, !current.open),
                    )
                    return
                  }
                  setInspectorCollapsed((current) => !current)
                }}
              />,
              workspaceChromeTarget,
            )}
        <ConversationWorkspace
          anchorRequestKey={anchorRequestKey}
          viewModel={viewModel}
          connectionIndicator={connectionIndicator}
          executionBoundary={executionBoundary}
          projectBoundary={projectBoundary}
          controls={controls}
          machineId={machineId}
          targetChangeId={selectedChangeId}
          targetChangeRequestKey={changeNavigationRequest}
          targetTurnId={targetTurnId}
          projectId={projectId}
        />
        {inspectorCollapsed ? null : (
          <div className="relative hidden min-h-0 min-w-0 min-[1440px]:block">
            <ConversationInspectorResizeHandle
              resizing={inspectorResizing}
              setResizing={setInspectorResizing}
              setWidth={setInspectorWidth}
              width={resolvedInspectorWidth}
              workspaceWidth={workspaceWidth}
            />
            <InspectorPanel {...inspectorProps} />
          </div>
        )}
      </div>

      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          const pendingChangeId = pendingChangeNavigationRef.current
          if (pendingChangeId !== undefined) {
            pendingChangeNavigationRef.current = undefined
            commitChangeNavigation(pendingChangeId)
            return
          }
          inspectorTriggerRef.current?.focus()
        }}
        className="top-[var(--layout-topbar-height)] right-0 bottom-0 left-auto block h-[calc(100dvh-var(--layout-topbar-height))] max-h-none w-[21.75rem] max-w-[calc(100vw-var(--layout-sidebar-current-width))] translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-y-0 border-r-0 bg-surface-inset p-0 duration-200 data-[state=closed]:translate-x-full data-[state=closed]:scale-100 data-[state=open]:scale-100 motion-reduce:transition-none"
      >
        <DialogTitle className="sr-only">会话检查器</DialogTitle>
        <InspectorPanel
          {...inspectorProps}
          onClose={() =>
            setInspector((current) =>
              setConversationInspectorOpen(current, false),
            )
          }
          className="border-l-0"
        />
      </DialogContent>
    </Dialog>
  )
}

const INSPECTOR_DIALOG_MEDIA_QUERY = '(max-width: 1439px)'

function readInspectorCollapsedPreference(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return (
      window.localStorage.getItem(
        'codetether.conversation-inspector-collapsed',
      ) === '1'
    )
  } catch {
    return false
  }
}

function optionalLocalStorage(): Storage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

function usesInspectorDialogLayout(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia(INSPECTOR_DIALOG_MEDIA_QUERY).matches
  )
}
