import { Link } from '@tanstack/react-router'
import { Archive, ExternalLink, MoreHorizontal, Pencil } from 'lucide-react'

import {
  AgentIdentityMark,
  Badge,
  ConversationItem,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  agentDefinitions,
} from '@codetether/ui'

import type {
  ConversationListItemMock,
  ConversationsAgentMock,
} from '../../mocks/conversations'

interface ConversationGroupProps {
  agent: ConversationsAgentMock
  conversations: readonly ConversationListItemMock[]
  machineNames: ReadonlyMap<string, string>
  selectedConversationId?: string
}

interface ConversationMoreMenuProps {
  conversation: ConversationListItemMock
}

function ConversationMoreMenu({ conversation }: ConversationMoreMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          label={`打开“${conversation.title}”的更多操作`}
          size="sm"
          variant="ghost"
          className="size-8 text-text-muted opacity-65 hover:text-text-primary group-hover:opacity-100 data-[state=open]:bg-surface-elevated data-[state=open]:text-text-primary data-[state=open]:opacity-100"
        >
          <MoreHorizontal aria-hidden="true" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem asChild>
          <Link
            to="/conversations/$conversationId"
            params={{ conversationId: conversation.id }}
          >
            <ExternalLink aria-hidden="true" />
            打开会话
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <Pencil aria-hidden="true" />
          重命名（演示）
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <Archive aria-hidden="true" />
          归档（演示）
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ConversationGroup({
  agent,
  conversations,
  machineNames,
  selectedConversationId,
}: ConversationGroupProps) {
  const definition = agentDefinitions[agent.id]
  const headingId = `conversations-agent-${agent.id}`

  return (
    <section aria-labelledby={headingId}>
      <div className="flex h-[var(--layout-conversations-group-height)] min-w-0 items-center gap-3 rounded-md border border-border bg-surface/65 px-3.5">
        <AgentIdentityMark
          agent={agent.id}
          className="size-8 rounded-sm text-sm"
        />
        <h2
          id={headingId}
          className="min-w-0 truncate text-base font-semibold text-text-primary"
        >
          {definition.name}
        </h2>
        <p className="ml-8 hidden truncate text-xs font-regular text-text-muted sm:block">
          默认模型 {agent.defaultModel}
        </p>
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
          const selected = conversation.id === selectedConversationId
          const machineName = machineNames.get(conversation.machine)

          return (
            <li key={conversation.id}>
              <ConversationItem
                appearance="row"
                title={conversation.title}
                description={conversation.description}
                status={conversation.status}
                model={conversation.model}
                machine={machineName}
                activity={conversation.lastActivity}
                activityDetail={conversation.activityDetail}
                selected={selected}
                primaryAction={
                  <Link
                    to="/conversations/$conversationId"
                    params={{ conversationId: conversation.id }}
                    aria-label={`打开会话：${conversation.title}`}
                    className="absolute inset-0 z-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  />
                }
                action={<ConversationMoreMenu conversation={conversation} />}
              />
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export type { ConversationGroupProps }
