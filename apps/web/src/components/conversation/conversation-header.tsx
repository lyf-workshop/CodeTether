import { AgentBadge, Badge } from '@codetether/ui'

import type {
  ConversationConnectionIndicatorViewModel,
  ConversationConnectionState,
  ConversationViewModel,
} from './conversation-view-model'
import type { ConversationDisplayContext } from './conversation-gate-presentation'

const connectionBadgeVariants = {
  connecting: 'info',
  connected: 'secondary',
  reconnecting: 'warning',
  unavailable: 'danger',
  incompatible: 'danger',
} as const satisfies Record<
  ConversationConnectionState,
  'secondary' | 'info' | 'warning' | 'danger'
>

interface ConversationHeaderProps {
  conversation: ConversationViewModel
  connectionIndicator?: ConversationConnectionIndicatorViewModel
  context?: ConversationDisplayContext
}

export function ConversationHeader({
  conversation,
  connectionIndicator,
  context,
}: ConversationHeaderProps) {
  return (
    <header className="w-full min-w-0 border-b border-border pt-3 pb-4">
      <h1
        title={conversation.title}
        className="min-w-0 truncate text-2xl leading-snug font-semibold text-text-primary"
      >
        {conversation.title}
      </h1>
      <div
        aria-label="会话模型设置"
        className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-secondary"
      >
        <AgentBadge agent={conversation.agent} size="sm" />
        <span className="min-w-0 truncate" title={conversation.model}>
          {conversation.model}
        </span>
        {context?.reasoning === undefined ? null : (
          <span className="min-w-0 truncate">· 推理：{context.reasoning}</span>
        )}
        {context?.importedFrom === undefined ? null : (
          <Badge variant="outline">从 {context.importedFrom} 导入</Badge>
        )}
        {connectionIndicator && connectionIndicator.state !== 'connected' ? (
          <Badge
            variant={connectionBadgeVariants[connectionIndicator.state]}
            role="status"
          >
            {connectionIndicator.label}
          </Badge>
        ) : null}
      </div>
    </header>
  )
}
