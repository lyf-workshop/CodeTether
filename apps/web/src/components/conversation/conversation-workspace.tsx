import type { Ref } from 'react'

import type { ConversationDetailMock } from '../../mocks/conversation-detail'
import { Composer } from './composer'
import { ConversationHeader } from './conversation-header'
import { ConversationTimeline } from './conversation-timeline'

interface ConversationWorkspaceProps {
  conversation: ConversationDetailMock['conversation']
  timeline: ConversationDetailMock['timeline']
  inspectorTriggerRef?: Ref<HTMLButtonElement>
  onOpenInspector?: () => void
}

export function ConversationWorkspace({
  conversation,
  timeline,
  inspectorTriggerRef,
  onOpenInspector,
}: ConversationWorkspaceProps) {
  return (
    <section
      aria-label="会话工作区"
      className="grid h-full min-h-0 min-w-0 grid-rows-[var(--layout-conversation-header-height)_minmax(0,1fr)_var(--layout-conversation-composer-region-height)] bg-background"
    >
      <ConversationHeader
        conversation={conversation}
        inspectorTriggerRef={inspectorTriggerRef}
        onOpenInspector={onOpenInspector}
      />
      <ConversationTimeline agent={conversation.agent} timeline={timeline} />
      <div className="min-h-0 px-4 pb-5">
        <Composer conversation={conversation} />
      </div>
    </section>
  )
}
