import { AgentBadge, Badge, MachineBadge, StatusBadge } from '@codetether/ui'

import type {
  ConversationConnectionIndicatorViewModel,
  ConversationConnectionState,
  ConversationViewModel,
} from './conversation-view-model'

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
}

export function ConversationHeader({
  conversation,
  connectionIndicator,
}: ConversationHeaderProps) {
  return (
    <header className="flex h-[var(--layout-conversation-header-height)] min-w-0 items-start border-b border-border px-5 py-4">
      <div className="min-w-0">
        <h1
          title={conversation.title}
          className="truncate text-lg font-semibold text-text-primary"
        >
          {conversation.title}
        </h1>
        <div className="mt-2 flex min-w-0 items-center gap-2 overflow-hidden">
          <StatusBadge
            status={conversation.status}
            className="h-6 px-2 text-xs font-regular"
          />
          <AgentBadge
            agent={conversation.agent}
            variant="compact"
            className="h-6"
          />
          {conversation.model === '默认模型' ? null : (
            <Badge
              variant="outline"
              className="h-6 max-w-44 truncate rounded-sm px-2 font-regular"
              title={conversation.model}
            >
              {conversation.model}
            </Badge>
          )}
          <MachineBadge
            name={conversation.machine}
            className="h-6 font-regular"
          />
          {connectionIndicator && connectionIndicator.state !== 'connected' ? (
            <Badge
              variant={connectionBadgeVariants[connectionIndicator.state]}
              className="h-6 rounded-sm px-2 font-regular"
              role="status"
            >
              {connectionIndicator.label}
            </Badge>
          ) : null}
        </div>
      </div>
    </header>
  )
}
