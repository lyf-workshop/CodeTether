import type { ReactNode } from 'react'
import { UserRound } from 'lucide-react'

import {
  AgentIdentityMark,
  StatusBadge,
  agentDefinitions,
  cn,
  type AgentId,
} from '@codetether/ui'

import type {
  ConversationMessageViewModel,
  ConversationTurnHeaderViewModel,
} from './conversation-view-model'
import { MessageMarkdown } from './message-markdown'

interface MessageProps {
  message: ConversationMessageViewModel
  children?: ReactNode
  className?: string
}

export function UserMessage({ message, children, className }: MessageProps) {
  return (
    <article
      aria-label={`你在 ${message.time} 发送的消息`}
      className={cn(
        'grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-lg bg-timeline-message px-5 py-4',
        className,
      )}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-text-primary text-background">
        <UserRound aria-hidden="true" className="size-4" />
      </span>
      <div className="min-w-0">
        <header className="flex items-center justify-between gap-3">
          <span className="text-md font-semibold text-text-primary">你</span>
          <time className="text-xs text-text-muted">{message.time}</time>
        </header>
        {message.body.length > 0 ? (
          <p className="mt-2 whitespace-pre-wrap break-words text-timeline-message-size leading-normal text-text-primary">
            {message.body}
          </p>
        ) : null}
        {children}
      </div>
    </article>
  )
}

export function AgentTurnHeader({
  agent,
  header,
  turn,
}: {
  agent: AgentId
  header: ConversationTurnHeaderViewModel
  turn?: boolean
}) {
  return (
    <header
      data-turn-header={turn || undefined}
      className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3"
    >
      <AgentIdentityMark agent={agent} className="size-8 rounded-sm text-sm" />
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-md font-semibold text-text-primary">
          {agentDefinitions[agent].name}
        </span>
        {header.status === 'interrupted' ? (
          <span className="text-xs text-text-muted">已中断</span>
        ) : header.status === undefined ? null : (
          <StatusBadge
            status={header.status}
            showIcon={false}
            className="h-5 border-transparent bg-transparent px-1 text-xs"
          />
        )}
        <time className="ml-auto shrink-0 text-xs text-text-muted">
          {header.time}
        </time>
      </div>
    </header>
  )
}

export function AgentMessageBody({
  message,
  projectRootPath,
}: {
  message: ConversationMessageViewModel
  projectRootPath?: string
}) {
  return (
    <MessageMarkdown messageId={message.id} projectRootPath={projectRootPath}>
      {message.body}
    </MessageMarkdown>
  )
}

export function AgentMessage({
  agent,
  message,
  projectRootPath,
}: {
  agent: AgentId
  message: ConversationMessageViewModel
  projectRootPath?: string
}) {
  return (
    <article
      aria-label={`${agentDefinitions[agent].name} 在 ${message.time} 的工作记录`}
      className="min-w-0 rounded-lg bg-timeline-message px-5 py-4"
    >
      <AgentTurnHeader agent={agent} header={message} />
      <div className="mt-2 min-w-0 pl-11">
        <AgentMessageBody message={message} projectRootPath={projectRootPath} />
      </div>
    </article>
  )
}
