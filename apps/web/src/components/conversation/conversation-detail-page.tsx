import { useRef, useState, type Ref } from 'react'

import { Dialog, DialogContent, DialogTitle } from '@codetether/ui'
import type { ProjectId } from '@codetether/protocol'

import { ConversationRail } from './conversation-rail'
import type { ConversationControls } from './conversation-controls'
import type {
  ConversationConnectionIndicatorViewModel,
  ConversationRailViewModel,
  ConversationViewModel,
} from './conversation-view-model'
import { ConversationWorkspace } from './conversation-workspace'
import { InspectorPanel, type InspectorTab } from './inspector-panel'

export interface ConversationDetailPageProps {
  viewModel: ConversationViewModel
  rail: ConversationRailViewModel
  connectionIndicator?: ConversationConnectionIndicatorViewModel
  initialInspectorTab?: InspectorTab
  controls?: ConversationControls
  newConversationButtonRef?: Ref<HTMLButtonElement>
  newConversationDisabled?: boolean
  onNewConversation?: () => void
  projectId?: ProjectId
}

export function ConversationDetailPage({
  viewModel,
  rail,
  connectionIndicator,
  initialInspectorTab = 'overview',
  controls,
  newConversationButtonRef,
  newConversationDisabled = false,
  onNewConversation,
  projectId,
}: ConversationDetailPageProps) {
  const [inspectorOpen, setInspectorOpen] = useState(
    () =>
      initialInspectorTab !== 'overview' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(max-width: 1439px)').matches,
  )
  const inspectorTriggerRef = useRef<HTMLButtonElement>(null)

  const inspectorProps = {
    conversation: viewModel,
    changes: viewModel.changes,
    terminal: viewModel.terminal,
    context: viewModel.context,
    initialTab: initialInspectorTab,
  } as const

  return (
    <Dialog open={inspectorOpen} onOpenChange={setInspectorOpen}>
      <div className="grid h-full min-h-0 min-w-0 grid-cols-[var(--layout-conversation-rail-compact-width)_minmax(0,1fr)] bg-background min-[1440px]:grid-cols-[var(--layout-conversation-rail-width)_minmax(0,1fr)_var(--layout-conversation-inspector-width)]">
        <ConversationRail
          groups={rail.groups}
          currentConversationId={viewModel.id}
          {...(rail.archivedCount === undefined
            ? {}
            : { archivedCount: rail.archivedCount })}
          newConversationDisabled={newConversationDisabled}
          {...(newConversationButtonRef === undefined
            ? {}
            : { newConversationButtonRef })}
          {...(onNewConversation === undefined ? {} : { onNewConversation })}
          {...(projectId === undefined ? {} : { projectId })}
        />
        <ConversationWorkspace
          viewModel={viewModel}
          connectionIndicator={connectionIndicator}
          onOpenInspector={() => setInspectorOpen(true)}
          inspectorTriggerRef={inspectorTriggerRef}
          controls={controls}
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
          inspectorTriggerRef.current?.focus()
        }}
        className="top-[var(--layout-topbar-height)] right-0 bottom-0 left-auto block h-[calc(100dvh-var(--layout-topbar-height))] max-h-none w-[var(--layout-conversation-inspector-width)] max-w-[calc(100vw-var(--layout-sidebar-current-width))] translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-y-0 border-r-0 bg-surface-inset p-0 duration-200 data-[state=closed]:translate-x-full data-[state=closed]:scale-100 data-[state=open]:scale-100 motion-reduce:transition-none"
      >
        <DialogTitle className="sr-only">会话检查器</DialogTitle>
        <InspectorPanel
          {...inspectorProps}
          onClose={() => setInspectorOpen(false)}
          className="border-l-0"
        />
      </DialogContent>
    </Dialog>
  )
}
