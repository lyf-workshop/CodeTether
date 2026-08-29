import { useRef, useState, type Ref } from 'react'

import { Dialog, DialogContent, DialogTitle } from '@codetether/ui'
import type { ProjectId, TurnId } from '@codetether/protocol'
import type { ConversationSummary } from '@codetether/protocol'

import { ConversationRail } from './conversation-rail'
import type { ConversationControls } from './conversation-controls'
import type {
  ConversationConnectionIndicatorViewModel,
  ConversationRailViewModel,
  ConversationViewModel,
} from './conversation-view-model'
import { ConversationWorkspace } from './conversation-workspace'
import { InspectorPanel, type InspectorTab } from './inspector-panel'
import {
  createConversationInspectorState,
  openConversationInspectorTab,
  selectConversationInspectorTab,
  setConversationInspectorOpen,
} from './conversation-inspector-state'

export interface ConversationDetailPageProps {
  anchorRequestKey?: string
  viewModel: ConversationViewModel
  rail: ConversationRailViewModel
  connectionIndicator?: ConversationConnectionIndicatorViewModel
  initialInspectorTab?: InspectorTab
  controls?: ConversationControls
  newConversationButtonRef?: Ref<HTMLButtonElement>
  newConversationDisabled?: boolean
  onNewConversation?: () => void
  projectId?: ProjectId
  targetTurnId?: TurnId
  onArchived?: (conversation: ConversationSummary) => void
}

export function ConversationDetailPage({
  anchorRequestKey,
  viewModel,
  rail,
  connectionIndicator,
  initialInspectorTab = 'overview',
  controls,
  newConversationButtonRef,
  newConversationDisabled = false,
  onNewConversation,
  projectId,
  targetTurnId,
  onArchived,
}: ConversationDetailPageProps) {
  const [inspector, setInspector] = useState(() =>
    createConversationInspectorState(
      initialInspectorTab,
      initialInspectorTab !== 'overview' && usesInspectorDialogLayout(),
    ),
  )
  const [selectedChangeId, setSelectedChangeId] = useState<string | undefined>(
    undefined,
  )
  const [changeNavigationRequest, setChangeNavigationRequest] = useState(0)
  const inspectorTriggerRef = useRef<HTMLButtonElement>(null)
  const pendingChangeNavigationRef = useRef<string | undefined>(undefined)

  const commitChangeNavigation = (changeId: string) => {
    setSelectedChangeId(changeId)
    setChangeNavigationRequest((current) => current + 1)
  }

  const selectChange = (changeId: string) => {
    if (usesInspectorDialogLayout()) {
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
      open={inspector.open}
      onOpenChange={(open) =>
        setInspector((current) => setConversationInspectorOpen(current, open))
      }
    >
      <div className="grid h-full min-h-0 min-w-0 grid-cols-[var(--layout-conversation-rail-compact-width)_minmax(0,1fr)] bg-background min-[1440px]:grid-cols-[var(--layout-conversation-rail-width)_minmax(0,1fr)_var(--layout-conversation-inspector-width)]">
        <ConversationRail
          groups={rail.groups}
          currentConversationId={viewModel.id}
          {...(rail.currentArchivedConversation === undefined
            ? {}
            : {
                currentArchivedConversation: rail.currentArchivedConversation,
              })}
          newConversationDisabled={newConversationDisabled}
          {...(newConversationButtonRef === undefined
            ? {}
            : { newConversationButtonRef })}
          {...(onNewConversation === undefined ? {} : { onNewConversation })}
          {...(projectId === undefined ? {} : { projectId })}
          onArchived={onArchived}
        />
        <ConversationWorkspace
          anchorRequestKey={anchorRequestKey}
          viewModel={viewModel}
          connectionIndicator={connectionIndicator}
          onOpenInspector={() =>
            setInspector((current) =>
              setConversationInspectorOpen(current, true),
            )
          }
          onOpenChanges={() =>
            setInspector((current) =>
              openConversationInspectorTab(
                current,
                'changes',
                usesInspectorDialogLayout(),
              ),
            )
          }
          inspectorTriggerRef={inspectorTriggerRef}
          controls={controls}
          targetChangeId={selectedChangeId}
          targetChangeRequestKey={changeNavigationRequest}
          targetTurnId={targetTurnId}
          projectId={projectId}
          onArchived={onArchived}
        />
        <div className="hidden min-h-0 min-w-0 min-[1440px]:block">
          <InspectorPanel {...inspectorProps} />
        </div>
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
        className="top-[var(--layout-topbar-height)] right-0 bottom-0 left-auto block h-[calc(100dvh-var(--layout-topbar-height))] max-h-none w-[var(--layout-conversation-inspector-width)] max-w-[calc(100vw-var(--layout-sidebar-current-width))] translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-y-0 border-r-0 bg-surface-inset p-0 duration-200 data-[state=closed]:translate-x-full data-[state=closed]:scale-100 data-[state=open]:scale-100 motion-reduce:transition-none"
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

function usesInspectorDialogLayout(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(max-width: 1439px)').matches
  )
}
