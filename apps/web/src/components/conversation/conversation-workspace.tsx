import type { Ref } from 'react'

import { Composer } from './composer'
import { ConversationHeader } from './conversation-header'
import { ConversationTimeline } from './conversation-timeline'
import type { ConversationControls } from './conversation-controls'
import type {
  ConversationConnectionIndicatorViewModel,
  ConversationViewModel,
} from './conversation-view-model'
import { PendingActionDock } from './pending-action-dock'

interface ConversationWorkspaceProps {
  viewModel: ConversationViewModel
  connectionIndicator?: ConversationConnectionIndicatorViewModel
  inspectorTriggerRef?: Ref<HTMLButtonElement>
  onOpenInspector?: () => void
  onOpenChanges?: () => void
  controls?: ConversationControls
}

export function ConversationWorkspace({
  viewModel,
  connectionIndicator,
  inspectorTriggerRef,
  onOpenInspector,
  onOpenChanges,
  controls,
}: ConversationWorkspaceProps) {
  return (
    <section
      aria-label="会话工作区"
      className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto_auto] bg-background"
    >
      <ConversationHeader
        conversation={viewModel}
        capabilities={viewModel.capabilities}
        connectionIndicator={connectionIndicator}
        inspectorTriggerRef={inspectorTriggerRef}
        onOpenInspector={onOpenInspector}
        onOpenChanges={onOpenChanges}
        interruptController={controls?.interrupt}
      />
      <ConversationTimeline
        agent={viewModel.agent}
        timeline={viewModel.timeline}
        changes={viewModel.changes}
        pendingApprovals={viewModel.pendingApprovals}
      />
      <PendingActionDock
        approvals={viewModel.pendingApprovals}
        controller={controls?.approvals}
        className="mx-4 mb-3"
      />
      <div className="min-h-0 px-4 pb-5">
        <Composer
          conversation={viewModel}
          capabilities={viewModel.capabilities}
          controller={controls?.composer}
          externalError={controls?.interrupt.error}
        />
      </div>
    </section>
  )
}
