import type { Ref } from 'react'

import { Composer } from './composer'
import { ConversationHeader } from './conversation-header'
import { ConversationTimeline } from './conversation-timeline'
import type { ConversationControls } from './conversation-controls'
import type {
  ConversationConnectionIndicatorViewModel,
  ConversationViewModel,
} from './conversation-view-model'

interface ConversationWorkspaceProps {
  viewModel: ConversationViewModel
  connectionIndicator?: ConversationConnectionIndicatorViewModel
  inspectorTriggerRef?: Ref<HTMLButtonElement>
  onOpenInspector?: () => void
  controls?: ConversationControls
}

export function ConversationWorkspace({
  viewModel,
  connectionIndicator,
  inspectorTriggerRef,
  onOpenInspector,
  controls,
}: ConversationWorkspaceProps) {
  return (
    <section
      aria-label="会话工作区"
      className="grid h-full min-h-0 min-w-0 grid-rows-[var(--layout-conversation-header-height)_minmax(0,1fr)_var(--layout-conversation-composer-region-height)] bg-background"
    >
      <ConversationHeader
        conversation={viewModel}
        capabilities={viewModel.capabilities}
        connectionIndicator={connectionIndicator}
        inspectorTriggerRef={inspectorTriggerRef}
        onOpenInspector={onOpenInspector}
        interruptController={controls?.interrupt}
      />
      <ConversationTimeline
        agent={viewModel.agent}
        timeline={viewModel.timeline}
        changes={viewModel.changes}
        pendingApprovals={viewModel.pendingApprovals}
        approvalController={controls?.approvals}
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
