import { Link } from '@tanstack/react-router'

import {
  AgentIdentityMark,
  Badge,
  ConversationItem,
  agentDefinitions,
} from '@codetether/ui'
import type { ConversationSummary } from '@codetether/protocol'

import { formatConversationActivity } from './conversation-list-model'

interface ConversationGroupProps {
  provider: ConversationSummary['provider']
  conversations: readonly ConversationSummary[]
  selectedConversationId?: string
}

export function ConversationGroup({
  provider,
  conversations,
  selectedConversationId,
}: ConversationGroupProps) {
  const definition = agentDefinitions[provider]
  const headingId = `conversations-agent-${provider}`

  return (
    <section aria-labelledby={headingId}>
      <div className="flex h-[var(--layout-conversations-group-height)] min-w-0 items-center gap-3 rounded-md border border-border bg-surface/65 px-3.5">
        <AgentIdentityMark
          agent={provider}
          className="size-8 rounded-sm text-sm"
        />
        <h2
          id={headingId}
          className="min-w-0 truncate text-base font-semibold text-text-primary"
        >
          {definition.name}
        </h2>
        <Badge
          variant="secondary"
          aria-label={`${conversations.length} 个会话`}
          className="ml-auto h-6 min-w-7 border-transparent bg-surface-elevated px-2 text-xs font-regular tabular-nums"
        >
          {conversations.length}
        </Badge>
      </div>

      <ul className="mt-2 space-y-2 px-4">
        {conversations.map((conversation) => {
          const selected =
            conversation.conversationId === selectedConversationId

          return (
            <li key={conversation.conversationId}>
              <ConversationItem
                appearance="row"
                title={conversation.title}
                status={conversation.status}
                model={conversation.model}
                activity={formatConversationActivity(
                  conversation.lastActivityAt,
                )}
                selected={selected}
                primaryAction={
                  <Link
                    to="/conversations/$conversationId"
                    params={{
                      conversationId: conversation.conversationId,
                    }}
                    aria-label={`打开会话：${conversation.title}`}
                    title={conversation.title}
                    className="absolute inset-0 z-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  />
                }
              />
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export type { ConversationGroupProps }
